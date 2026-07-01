import { type Job } from 'bullmq'
import { prisma } from '@/lib/prisma'
import { CHARACTER_ASSET_IMAGE_RATIO, addCharacterPromptSuffix, getArtStylePrompt, isArtStyleValue, isCustomArtStyleValue, PRIMARY_APPEARANCE_INDEX } from '@/lib/constants'
import { type TaskJobData } from '@/lib/task/types'
import { encodeImageUrls } from '@/lib/contracts/image-urls-contract'
import { normalizeImageGenerationCount } from '@/lib/image-generation/count'
import { reportTaskProgress } from '../shared'
import {
  assertTaskActive,
  getProjectModels,
  toSignedUrlIfCos,
} from '../utils'
import { normalizeReferenceImagesForGeneration } from '@/lib/media/outbound-image'
import { refreshProjectPanelReferenceAssets } from '@/lib/novel-promotion/refresh-panel-reference-assets'
import {
  AnyObj,
  generateCleanImageToStorage,
  parseImageUrls,
  parseJsonStringArray,
  pickFirstString,
} from './image-task-handler-shared'

function resolvePayloadArtStyle(payload: AnyObj): string | undefined {
  if (!Object.prototype.hasOwnProperty.call(payload, 'artStyle')) return undefined
  const parsedArtStyle = typeof payload.artStyle === 'string' ? payload.artStyle.trim() : ''
  if (!isArtStyleValue(parsedArtStyle) && !isCustomArtStyleValue(parsedArtStyle)) {
    throw new Error('Invalid artStyle in IMAGE_CHARACTER payload')
  }
  return parsedArtStyle
}

interface CharacterAppearanceRecord {
  id: string
  characterId: string
  appearanceIndex: number
  descriptions: string | null
  description: string | null
  imageUrls: string | null
  selectedIndex: number | null
  imageUrl: string | null
  changeReason: string | null
}

interface CharacterAppearanceWithCharacter extends CharacterAppearanceRecord {
  character: {
    name: string
  }
}

interface CharacterRecord {
  id: string
  name: string
  appearances: CharacterAppearanceRecord[]
}

interface PrimaryAppearanceRecord {
  imageUrl: string | null
  imageUrls: string | null
  description?: string | null
  descriptions?: string | null
  changeReason?: string | null
}

interface CharacterImageDb {
  characterAppearance: {
    findUnique(args: Record<string, unknown>): Promise<CharacterAppearanceWithCharacter | null>
    findFirst(args: Record<string, unknown>): Promise<PrimaryAppearanceRecord | null>
    update(args: Record<string, unknown>): Promise<unknown>
  }
  novelPromotionCharacter: {
    findUnique(args: Record<string, unknown>): Promise<CharacterRecord | null>
  }
}

export async function handleCharacterImageTask(job: Job<TaskJobData>) {
  const db = prisma as unknown as CharacterImageDb
  const payload = (job.data.payload || {}) as AnyObj
  const projectId = job.data.projectId
  const userId = job.data.userId
  const models = await getProjectModels(projectId, userId)
  const modelId = models.characterModel
  if (!modelId) throw new Error('Character model not configured')

  const appearanceId = pickFirstString(job.data.targetId, payload.appearanceId)
  let appearance: CharacterAppearanceRecord | null = null
  let characterName = '角色'

  if (appearanceId) {
    const appearanceWithCharacter = await db.characterAppearance.findUnique({
      where: { id: appearanceId },
      include: { character: true },
    })
    if (appearanceWithCharacter) {
      appearance = appearanceWithCharacter
      characterName = appearanceWithCharacter.character.name
    }
  }

  const characterId = typeof payload.id === 'string' ? payload.id : null
  if (!appearance && characterId) {
    const character = await db.novelPromotionCharacter.findUnique({
      where: { id: characterId },
      include: { appearances: { orderBy: { appearanceIndex: 'asc' } } },
    })
    appearance = character?.appearances?.[0] || null
    if (character && appearance) {
      characterName = character.name
    }
  }

  if (!appearance) throw new Error('Character appearance not found')

  const payloadArtStyle = resolvePayloadArtStyle(payload)
  const artStyle = getArtStylePrompt(payloadArtStyle ?? models.artStyle, job.data.locale, models.artStylePrompt)
  const descriptions = parseJsonStringArray(appearance.descriptions)
  const baseDescriptions = descriptions.length > 0 ? descriptions : [appearance.description || '']

  // 子形象（不是主形象）生成时，引用主形象图片保持一致性
  const primaryReferenceInputs: string[] = []
  let primaryReferenceArchive = ''
  if (appearance.appearanceIndex > PRIMARY_APPEARANCE_INDEX) {
    const primaryAppearance = await db.characterAppearance.findFirst({
      where: {
        characterId: appearance.characterId,
        appearanceIndex: PRIMARY_APPEARANCE_INDEX,
      },
      select: { imageUrl: true, imageUrls: true, description: true, descriptions: true, changeReason: true },
    })
    if (primaryAppearance) {
      primaryReferenceArchive = extractCharacterArchiveForVariant(
        parseJsonStringArray(primaryAppearance.descriptions)[0] || primaryAppearance.description || '',
      )
      const primaryMainUrl = primaryAppearance.imageUrl
        ? toSignedUrlIfCos(primaryAppearance.imageUrl, 3600)
        : null
      if (primaryMainUrl) {
        primaryReferenceInputs.push(primaryMainUrl)
      }
    }
  }
  const primaryReferenceImages = await normalizeReferenceImagesForGeneration(primaryReferenceInputs)

  const singleIndex = payload.imageIndex ?? payload.descriptionIndex
  const count = normalizeImageGenerationCount('character', payload.count)
  const indexes = singleIndex !== undefined
    ? [Number(singleIndex)]
    : Array.from({ length: count }, (_value, index) => index)

  const imageUrls = parseImageUrls(appearance.imageUrls, 'characterAppearance.imageUrls')
  const nextImageUrls = [...imageUrls]

  for (let i = 0; i < indexes.length; i++) {
    const index = indexes[i]
    const raw = baseDescriptions[index] || baseDescriptions[0]
    const promptBody = appearance.appearanceIndex > PRIMARY_APPEARANCE_INDEX
      ? normalizeVariantImagePrompt({
        raw,
        characterName,
        variantName: appearance.changeReason || '变体',
        mainArchive: primaryReferenceArchive,
      })
      : raw
    const prompt = artStyle ? `${addCharacterPromptSuffix(promptBody)}，${artStyle}` : addCharacterPromptSuffix(promptBody)

    await reportTaskProgress(job, 15 + Math.floor((i / Math.max(indexes.length, 1)) * 55), {
      stage: 'generate_character_image',
      index,
    })

    const imageKey = await generateCleanImageToStorage({
      job,
      userId,
      modelId,
      prompt,
      targetId: `${appearance.id}-${index}`,
      keyPrefix: 'character',
      options: {
        referenceImages: primaryReferenceImages.length > 0 ? primaryReferenceImages : undefined,
        aspectRatio: CHARACTER_ASSET_IMAGE_RATIO,
      },
    })

    while (nextImageUrls.length <= index) {
      nextImageUrls.push('')
    }
    nextImageUrls[index] = imageKey
  }

  function extractLegacyVariantChangeText(prompt: string): string {
    const marker = '【变体变化】'
    const markerIndex = prompt.indexOf(marker)
    const body = markerIndex >= 0 ? prompt.slice(markerIndex + marker.length).trim() : prompt

    const visualMarker = '视觉档案：'
    const visualIndex = body.indexOf(visualMarker)
    if (visualIndex >= 0) {
      const lines = body.slice(visualIndex + visualMarker.length).split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
      const changeLines: string[] = []
      for (const line of lines) {
        if (/^(世界背景|统一画风|近代|民国|院线|真人实拍)/.test(line)) break
        if (/^(主体|面部|服装|配饰)[：:]/.test(line)) changeLines.push(line)
      }
      if (changeLines.length > 0) return changeLines.join('\n')
    }

    return body
  }

  function extractCharacterArchiveForVariant(prompt: string): string {
    const archiveMarker = '【角色档案】'
    const archiveIndex = prompt.indexOf(archiveMarker)
    if (archiveIndex >= 0) {
      return prompt
        .slice(archiveIndex + archiveMarker.length)
        .split('（不出现任何字幕')[0]
        .trim()
    }
    const visualMarker = '视觉档案：'
    const visualIndex = prompt.indexOf(visualMarker)
    if (visualIndex >= 0) {
      return extractLegacyVariantChangeText(prompt)
    }
    return prompt
  }

  function normalizeVariantImagePrompt(input: {
    raw: string
    characterName: string
    variantName: string
    mainArchive: string
  }): string {
    if (input.raw.includes('基于参考图生成角色变体设定图') && input.raw.includes('【变体变化】')) {
      return input.raw
    }
    const changeText = extractLegacyVariantChangeText(input.raw)
    return [
      '基于参考图生成角色变体设定图，必须保持同一人物身份连续性：脸型、五官结构、身高体型、肤色、年龄感与主形象一致。',
      `角色：${input.characterName}。变体：${input.variantName}。`,
      '只改变变体要求中明确变化的服装、发型状态、面色、配饰状态，其余外观特征保持不变。',
      '16:9 横版，纯白背景，平视视角。角色设定图，左40%为3/4侧角面部大特写，右60%为正面、侧面、背面三张等尺全身像横向排列。',
      '仅一个角色，不出现其他人物；不出现任何字幕、文字、Logo、水印、UI；不裁切头顶或脚部。',
      input.mainArchive ? `【主形象参考】\n${input.mainArchive}` : null,
      `【变体变化】\n${changeText}`,
    ].filter(Boolean).join('\n')
  }

  const selectedIndex = appearance.selectedIndex
  const fallbackMain = nextImageUrls.find((url) => typeof url === 'string' && url) || appearance.imageUrl
  const mainImage = selectedIndex !== null && selectedIndex !== undefined && nextImageUrls[selectedIndex]
    ? nextImageUrls[selectedIndex]
    : fallbackMain

  await assertTaskActive(job, 'persist_character_image')
  await db.characterAppearance.update({
    where: { id: appearance.id },
    data: {
      imageUrls: encodeImageUrls(nextImageUrls),
      imageUrl: mainImage || null,
    },
  })
  await refreshProjectPanelReferenceAssets({
    projectId,
    episodeId: job.data.episodeId,
  })

  return {
    appearanceId: appearance.id,
    imageCount: nextImageUrls.filter(Boolean).length,
    imageUrl: mainImage || null,
  }
}
