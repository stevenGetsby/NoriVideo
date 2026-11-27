import { type Job } from 'bullmq'
import { prisma } from '@/lib/prisma'
import { type TaskJobData } from '@/lib/task/types'
import { reportTaskProgress } from '../shared'
import {
  assertTaskActive,
  getTaskExistingExternalId,
  resolveVideoSourceFromGeneration,
  uploadVideoSourceToCos,
} from '../utils'
import { normalizeSeedanceImageReference, normalizeSeedanceMediaReference } from '@/lib/media/seedance-reference'
import { registerFrameosMaterial } from '@/lib/frameos/material-service'
import { ownedMaterialScope } from '@/lib/frameos/material-ownership'
import { compileSeedanceMentionPrompt, type SeedanceMentionReference } from '@/lib/novel-promotion/seedance-prompt-assets'
import { projectCanvasToolboxTaskTerminal } from '@/lib/canvas/toolbox-node-binding'
import { workerTaskWillRetry } from '../retry-state'
import { normalizeCanvasGenerationMaterialReferences } from '@/lib/canvas/generation-reference-contract'
import { resolveBuiltinCapabilitiesByModelKey } from '@/lib/model-capabilities/lookup'
import { resolveCanvasGenerationInputSchema } from '@/lib/canvas/generation-input-schema'
import { extractVoiceAudioFromVideo } from '@/lib/media/video-audio'
import { generateUniqueKey, getObjectBuffer, uploadObject } from '@/lib/storage'
import { resolveMediaRefFromLegacyValue } from '@/lib/media/service'
import { ensureSeedanceCharacterAsset } from '@/lib/novel-promotion/seedance-character-asset'
import { frameosAssetCategoryFromMetadata, normalizeFrameosAssetCategory } from '@/lib/frameos/material-category'
import { pickVideoResultMetadata, type VideoResultMetadata } from '@/lib/video-result'
import { parseModelKeyStrict } from '@/lib/model-config-contract'
import { resolveRuntimeModelKey } from '@/lib/nori-model-catalog'
import { enhanceCanvasVideo, type CanvasVideoOperationHooks } from '@/lib/canvas/video-operations'
import { warmVideoPoster } from '../video-poster-warmup'

type AnyObj = Record<string, unknown>
type GeneratedVideo = VideoResultMetadata & {
  url: string
  actualVideoTokens?: number
  downloadHeaders?: Record<string, string>
}

function isKuaiziSeedanceModel(modelKey: string): boolean {
  const parsed = parseModelKeyStrict(resolveRuntimeModelKey(modelKey) || modelKey)
  return parsed?.provider === 'kuaizi'
    && /^doubao-seedance-2-(?:0|5)(?:-|$)/i.test(parsed.modelId)
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readNumber(value: unknown): number | undefined {
  const number = Number(value)
  return Number.isFinite(number) ? number : undefined
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : []
}

function readJsonObject(value: unknown): AnyObj {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as AnyObj : {}
}

function readNestedStringArray(value: unknown): string[][] {
  return Array.isArray(value) ? value.map(readStringArray) : []
}

type OmniReferenceTaskType = 'auto' | 'reference' | 'edit' | 'extend'

function readOmniReferenceTaskType(value: unknown): OmniReferenceTaskType | undefined {
  const normalized = readString(value).toLowerCase()
  if (normalized === 'auto' || normalized === 'reference' || normalized === 'edit' || normalized === 'extend') {
    return normalized
  }
  return undefined
}

export type SeedanceReferenceRetryPatch = {
  reason: 'task_type_constraint' | 'pe_classification_mismatch'
  omniReferenceTaskType?: 'reference' | 'edit' | 'extend'
  omitOmniReferenceTaskType?: boolean
  aspectRatio?: 'adaptive'
  duration?: -1
}

/**
 * Classifies synchronous Seedance 2.5 400 task-type errors for a single safe
 * fallback retry before any upstream externalId is created.
 */
export function classifySeedanceReferenceRetry(
  error: unknown,
  current: {
    omniReferenceTaskType?: OmniReferenceTaskType
    aspectRatio?: string
  } = {},
): SeedanceReferenceRetryPatch | null {
  const message = error instanceof Error ? error.message : String(error || '')
  if (!message) return null
  if (/HTTP_ERROR\((?!400\b)\d+\)/i.test(message)) return null
  if (/External task (?:failed|polling timeout)/i.test(message)) return null

  const currentTaskType = current.omniReferenceTaskType && current.omniReferenceTaskType !== 'auto'
    ? current.omniReferenceTaskType
    : undefined

  const isPeMismatch = /pe_classification/i.test(message)
    || /You requested the .+ task type.*classified your task as/i.test(message)
  if (isPeMismatch) {
    const classifiedMatch = message.match(/classified your task as\s+([^.,;\n]+)/i)
    const classifiedText = (classifiedMatch?.[1] || '').toLowerCase()
    if (/video\s*edit|编辑/.test(classifiedText)) {
      if (currentTaskType === 'edit' && current.aspectRatio === 'adaptive') return null
      return {
        reason: 'pe_classification_mismatch',
        omniReferenceTaskType: 'edit',
        aspectRatio: 'adaptive',
        duration: -1,
      }
    }
    if (/video\s*exten|延长/.test(classifiedText)) {
      if (!currentTaskType && current.aspectRatio === 'adaptive') return null
      return {
        reason: 'pe_classification_mismatch',
        omitOmniReferenceTaskType: true,
        aspectRatio: 'adaptive',
      }
    }
    if (!currentTaskType) return null
    return {
      reason: 'pe_classification_mismatch',
      omitOmniReferenceTaskType: true,
    }
  }

  if (/TaskTypeConstraint/i.test(message)) {
    const mentionsEdit = /video\s*edit|视频编辑/i.test(message)
      || (/adaptive/i.test(message) && /duration[^.\n]*-1/i.test(message))
    if (mentionsEdit) {
      if (currentTaskType === 'edit' && current.aspectRatio === 'adaptive') return null
      return {
        reason: 'task_type_constraint',
        omniReferenceTaskType: 'edit',
        aspectRatio: 'adaptive',
        duration: -1,
      }
    }
    const mentionsExtend = /video\s*exten|视频延长/i.test(message)
    if (mentionsExtend) {
      if (currentTaskType === 'extend' && current.aspectRatio === 'adaptive') return null
      return {
        reason: 'task_type_constraint',
        omniReferenceTaskType: 'extend',
        aspectRatio: 'adaptive',
      }
    }
    if (/adaptive/i.test(message) && current.aspectRatio !== 'adaptive') {
      return {
        reason: 'task_type_constraint',
        aspectRatio: 'adaptive',
      }
    }
  }

  return null
}

async function normalizeReferenceMedia(values: string[], modelKey: string): Promise<string[]> {
  return await Promise.all(values.map(async (value) => await normalizeSeedanceMediaReference(value, modelKey)))
}

/**
 * Prompt text addresses images as 图片N, so every submitted image must keep a
 * known position. A failed image aborts the task instead of silently shifting
 * every later reference onto the wrong character.
 */
async function normalizeIndexedImageReferences(values: string[], names: string[], modelKey: string) {
  const positions = new Map<string, number>()
  const unique: Array<{ value: string; name: string }> = []
  const imageNumbers = values.map((value, index) => {
    const key = value.trim()
    let position = positions.get(key)
    if (position === undefined) {
      position = unique.length
      positions.set(key, position)
      unique.push({ value: key, name: names[index] || `第 ${index + 1} 张参考图` })
    }
    return position + 1
  })
  const urls = await Promise.all(unique.map(async ({ value, name }) => {
    try {
      return await normalizeSeedanceImageReference(value, modelKey)
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      throw new Error(`参考图片「${name}」无法读取，已停止生成以免图片编号错位：${reason}`)
    }
  }))
  return { urls, imageNumbers }
}

export async function handleToolboxVideoTask(job: Job<TaskJobData>) {
  const payload = (job.data.payload || {}) as AnyObj
  const asset = await prisma.frameosToolboxAsset.findFirst({
    where: { id: job.data.targetId, userId: job.data.userId, type: 'video' },
  })
  if (!asset) throw new Error('Toolbox video asset not found')
  const rawPrompt = readString(payload.prompt)
  const modelId = readString(payload.videoModel) || readString(payload.modelId)
  if (!rawPrompt || !modelId) throw new Error('Toolbox video prompt/model missing')
  const referenceImages = readStringArray(payload.referenceImages)
  const referenceVideos = readStringArray(payload.referenceVideos)
  const referenceAudios = readStringArray(payload.referenceAudios)
  const referenceNames = readStringArray(payload.referenceNames)
  const referenceImageNames = readStringArray(payload.referenceImageNames)
  const referenceVideoNames = readStringArray(payload.referenceVideoNames)
  const referenceAudioNames = readStringArray(payload.referenceAudioNames)
  const referenceImageMentionNames = readNestedStringArray(payload.referenceImageMentionNames)
  const referenceImageAliases = readNestedStringArray(payload.referenceImageAliases)
  const referenceVideoMentionNames = readNestedStringArray(payload.referenceVideoMentionNames)
  const referenceAudioMentionNames = readNestedStringArray(payload.referenceAudioMentionNames)
  const inputMode = readString(payload.inputMode) || 'text'
  const videoCapabilities = resolveBuiltinCapabilitiesByModelKey('video', modelId)
  const videoInputSchema = resolveCanvasGenerationInputSchema('video', videoCapabilities)
  const referenceLimit = videoInputSchema.image.max + videoInputSchema.video.max + videoInputSchema.audio.max
  const materialReferenceContract = normalizeCanvasGenerationMaterialReferences({
    value: payload.referenceMaterials,
    legacyMaterialIds: readStringArray(payload.referenceMaterialIds),
    inputMode,
    limit: referenceLimit,
  })
  const referenceImageRoles = readStringArray(payload.referenceImageRoles)
  const title = readString(payload.title) || '工具箱生成视频'

  await prisma.frameosToolboxAsset.update({ where: { id: asset.id }, data: { status: 'processing', errorMessage: null } })
  try {
    if (!materialReferenceContract.success) throw new Error(materialReferenceContract.message)
    await reportTaskProgress(job, 15, { stage: 'generate_toolbox_video' })
    const imageTitles = referenceImageNames.length > 0 ? referenceImageNames : referenceNames
    let normalized: string[]
    let imageNumbers: number[]
    if (asset.bizType === 'character_audition' && isKuaiziSeedanceModel(modelId)) {
      const characterId = readString(readJsonObject(asset.params).characterId)
      if (!characterId) throw new Error('角色试镜任务缺少 characterId。')
      await reportTaskProgress(job, 18, { stage: 'prepare_character_private_asset' })
      const privateAsset = await ensureSeedanceCharacterAsset({
        userId: job.data.userId,
        projectId: job.data.projectId,
        characterId,
        modelKey: modelId,
        onStatus: async (status, attempt) => {
          await assertTaskActive(job, 'prepare_character_private_asset')
          await reportTaskProgress(job, Math.min(32, 18 + attempt), {
            stage: 'prepare_character_private_asset',
            assetStatus: status,
          })
        },
      })
      normalized = [privateAsset.assetUri]
      imageNumbers = referenceImages.length > 0 ? referenceImages.map(() => 1) : [1]
    } else {
      const indexed = await normalizeIndexedImageReferences(referenceImages, imageTitles, modelId)
      normalized = indexed.urls
      imageNumbers = indexed.imageNumbers
    }
    const imageAt = (position: number) => (position >= 0 && imageNumbers[position] ? normalized[imageNumbers[position] - 1] || '' : '')
    // Declarations name the asset kind (角色/场景) when the material library knows
    // it; unknown categories fall back to 资产 inside the compiler. Reference
    // materials keep submission order, so filtering type=image aligns with
    // referenceImages position by position.
    const kindMaterialIds = materialReferenceContract.references.map((item) => item.materialId)
    const kindRows = kindMaterialIds.length > 0
      ? await prisma.frameosMaterial.findMany({ where: { id: { in: kindMaterialIds } }, select: { id: true, type: true, metadata: true } })
      : []
    const kindRowById = new Map(kindRows.map((row) => [row.id, row]))
    const imageKindByPosition = kindMaterialIds
      .map((materialId) => kindRowById.get(materialId))
      .filter((row) => row?.type === 'image')
      .map((row) => {
        const category = frameosAssetCategoryFromMetadata(row?.metadata)
        return category === 'character' || category === 'location' || category === 'prop' ? category : undefined
      })
    const isFirstLastFrame = inputMode === 'firstlastframe'
    const isImageToVideo = inputMode === 'image'
    const useReferenceMode = !isImageToVideo && !isFirstLastFrame
    const mentionReferences: SeedanceMentionReference[] = [
      ...imageNumbers.map((imageNumber, index) => ({
        type: 'image' as const,
        index: imageNumber,
        names: referenceImageMentionNames[index] || [],
        aliases: referenceImageAliases[index],
        fallbackNames: imageTitles[index] ? [imageTitles[index]] : [],
        kind: imageKindByPosition[index],
      })),
      ...referenceVideos.map((_, index) => ({
        type: 'video' as const,
        index: index + 1,
        names: referenceVideoMentionNames[index] || [],
        fallbackNames: referenceVideoNames[index] ? [referenceVideoNames[index]] : [],
      })),
      ...referenceAudios.map((_, index) => ({
        type: 'audio' as const,
        index: index + 1,
        names: referenceAudioMentionNames[index] || [],
        fallbackNames: referenceAudioNames[index] ? [referenceAudioNames[index]] : [],
      })),
    ]
    const prompt = compileSeedanceMentionPrompt(rawPrompt, mentionReferences, { mediaReferences: useReferenceMode }).prompt
    const expectedImageRoles = materialReferenceContract.references.map((item) => item.role)
    if (
      isFirstLastFrame
      && (
        referenceImageRoles.length !== expectedImageRoles.length
        || referenceImageRoles.some((role, index) => role !== expectedImageRoles[index])
      )
    ) {
      throw new Error('First/last frame roles were not preserved in the queued task')
    }
    const firstFrameIndex = isFirstLastFrame ? referenceImageRoles.indexOf('FIRST_FRAME') : 0
    const lastFrameIndex = isFirstLastFrame ? referenceImageRoles.indexOf('LAST_FRAME') : -1
    const sourceImage = (isImageToVideo || isFirstLastFrame) ? imageAt(firstFrameIndex) : ''
    if ((isImageToVideo || isFirstLastFrame) && !sourceImage) {
      throw new Error('Toolbox video mode requires a reference image')
    }
    const lastFrameImage = isFirstLastFrame ? imageAt(lastFrameIndex) : ''
    if (isFirstLastFrame && !lastFrameImage) {
      throw new Error('First/last frame mode requires two images')
    }
    const normalizedVideos = useReferenceMode ? await normalizeReferenceMedia(referenceVideos, modelId) : []
    const normalizedAudios = useReferenceMode ? await normalizeReferenceMedia(referenceAudios, modelId) : []
    const requestedOmniTaskType = readOmniReferenceTaskType(
      payload.omniReferenceTaskType ?? readJsonObject(payload.generationOptions).omniReferenceTaskType,
    )
    const explicitOmniTaskType = useReferenceMode
      && normalizedVideos.length > 0
      && requestedOmniTaskType
      && requestedOmniTaskType !== 'auto'
      ? requestedOmniTaskType
      : undefined
    const payloadAspectRatio = readString(payload.aspectRatio)
    const payloadDuration = readNumber(payload.duration)
    const buildGenerationOptions = (images: string[], retryOverride?: SeedanceReferenceRetryPatch) => {
      const effectiveOmniTaskType = retryOverride?.omitOmniReferenceTaskType
        ? undefined
        : retryOverride?.omniReferenceTaskType ?? explicitOmniTaskType
      const effectiveAspectRatio = retryOverride?.aspectRatio
        ?? (effectiveOmniTaskType === 'edit' || effectiveOmniTaskType === 'extend'
          ? 'adaptive'
          : payloadAspectRatio)
      // Keep capability duration positive (4..30) when calling
      // resolveVideoSourceFromGeneration; kuaizi/video.ts and huimengi/video.ts
      // force upstream ratio='adaptive' and duration=-1 for omniReferenceTaskType='edit'.
      return {
        prompt,
        ...(useReferenceMode && images.length > 0 ? { referenceImages: images } : {}),
        ...(useReferenceMode && normalizedVideos.length > 0 ? { videos: normalizedVideos } : {}),
        ...(useReferenceMode && normalizedAudios.length > 0 ? { audios: normalizedAudios } : {}),
        ...(isFirstLastFrame ? { lastFrameImageUrl: lastFrameImage } : {}),
        ...(payloadDuration !== undefined && payloadDuration > 0 ? { duration: payloadDuration } : {}),
        ...(readNumber(payload.fps) !== undefined ? { fps: readNumber(payload.fps) } : {}),
        ...(readString(payload.resolution) ? { resolution: readString(payload.resolution) } : {}),
        ...(effectiveAspectRatio ? { aspectRatio: effectiveAspectRatio } : {}),
        ...(typeof payload.generateAudio === 'boolean' ? { generateAudio: payload.generateAudio } : {}),
        ...(effectiveOmniTaskType ? { omniReferenceTaskType: effectiveOmniTaskType } : {}),
        generationMode: isFirstLastFrame ? 'firstlastframe' as const : 'normal' as const,
      }
    }
    const initialOptions = buildGenerationOptions(normalized)
    let generated: GeneratedVideo
    try {
      generated = await resolveVideoSourceFromGeneration(job, {
        userId: job.data.userId,
        modelId,
        imageUrl: sourceImage,
        options: initialOptions,
      })
    } catch (firstError) {
      const retryPatch = useReferenceMode && normalizedVideos.length > 0
        ? classifySeedanceReferenceRetry(firstError, {
            omniReferenceTaskType: initialOptions.omniReferenceTaskType,
            aspectRatio: initialOptions.aspectRatio,
          })
        : null
      if (!retryPatch || await getTaskExistingExternalId(job.data.taskId)) {
        throw firstError
      }
      await assertTaskActive(job, 'retry_toolbox_video_seedance_task_type')
      await reportTaskProgress(job, 22, {
        stage: 'retry_toolbox_video_seedance_task_type',
        retryReason: retryPatch.reason,
        omniReferenceTaskType: retryPatch.omitOmniReferenceTaskType ? 'auto' : (retryPatch.omniReferenceTaskType || 'auto'),
      })
      generated = await resolveVideoSourceFromGeneration(job, {
        userId: job.data.userId,
        modelId,
        imageUrl: sourceImage,
        options: buildGenerationOptions(normalized, retryPatch),
      })
    }
    let storageKey = await uploadVideoSourceToCos(generated.url, 'toolbox-video', asset.id, generated.downloadHeaders)
    const superresolveTarget = readString(payload.superresolveTarget)
    const actualResolution = readString(payload.resolution) || readString(generated.resolution)
    let outputMetadata: Record<string, unknown> = {}
    if (superresolveTarget === '720p' || superresolveTarget === '1080p' || superresolveTarget === '4k') {
      await assertTaskActive(job, 'superresolve_toolbox_video')
      await reportTaskProgress(job, 75, { stage: 'superresolve_toolbox_video', superresolveTarget })
      const source = await getObjectBuffer(storageKey)
      let lastReportedProgress = 75
      const hooks: CanvasVideoOperationHooks = {
        assertActive: async () => await assertTaskActive(job, 'superresolve_toolbox_video'),
        onProgress: async (ratio) => {
          const progress = 75 + Math.floor(Math.max(0, Math.min(1, ratio)) * 18)
          if (progress < lastReportedProgress + 2) return
          lastReportedProgress = progress
          await reportTaskProgress(job, progress, { stage: 'superresolve_toolbox_video', progressDetails: { mediaProgress: ratio } })
        },
      }
      const enhanced = await enhanceCanvasVideo(source, { target: superresolveTarget, allowNoop: true }, hooks)
      if (enhanced.enhanced) {
        storageKey = await uploadObject(enhanced.body, `toolbox-video-superresolved/${job.data.userId}/${job.data.taskId}.mp4`, 1, 'video/mp4')
        outputMetadata = {
          width: enhanced.width,
          height: enhanced.height,
          durationSeconds: enhanced.duration,
          fps: enhanced.fps,
          superresolveTarget,
          outputResolution: superresolveTarget,
        }
      } else {
        outputMetadata = { superresolveSkipped: 'already_meets_target' }
      }
      await assertTaskActive(job, 'persist_toolbox_video_superresolve')
    }
    warmVideoPoster(storageKey)
    await assertTaskActive(job, 'persist_toolbox_video')
    let auditionAudioUrl = ''
    if (asset.bizType === 'character_audition') {
      const characterId = readString(readJsonObject(asset.params).characterId)
      const character = characterId
        ? await prisma.novelPromotionCharacter.findFirst({
            where: { id: characterId, novelPromotionProject: { projectId: job.data.projectId } },
            select: { id: true },
          })
        : null
      if (!character) throw new Error('角色试镜任务对应的角色不存在。')

      await reportTaskProgress(job, 95, { stage: 'extract_character_audition_audio' })
      const videoBody = await getObjectBuffer(storageKey)
      const audioBody = await extractVoiceAudioFromVideo(videoBody)
      const audioKey = generateUniqueKey(`voice/custom/${job.data.projectId}/${character.id}`, 'mp3')
      auditionAudioUrl = await uploadObject(audioBody, audioKey, 1, 'audio/mpeg')
      await resolveMediaRefFromLegacyValue(auditionAudioUrl)
      await assertTaskActive(job, 'persist_character_audition_audio')
    }
    const material = await registerFrameosMaterial({
      userId: job.data.userId,
      ...ownedMaterialScope({ projectId: job.data.projectId, personalOwnerId: readString(payload.personalOwnerId) }),
      ownerName: readString(payload.ownerName) || undefined,
      title,
      type: 'video',
      source: 'toolbox',
      storageKey,
      metadata: {
        taskId: job.data.taskId,
        originType: 'toolbox-video',
        originId: asset.id,
        assetCategory: normalizeFrameosAssetCategory(payload.assetCategory),
        inputMode,
        prompt: rawPrompt,
        referenceNames,
        referenceImageNames,
        referenceVideoNames,
        referenceAudioNames,
        referenceMaterials: materialReferenceContract.references,
        referenceImageRoles,
        ...pickVideoResultMetadata(generated),
        ...outputMetadata,
      },
    })
    await prisma.frameosToolboxAsset.update({
      where: { id: asset.id },
      data: { status: 'ready', resultUrl: storageKey, materialId: material.id, errorMessage: null },
    })
    await projectCanvasToolboxTaskTerminal({
      projectId: job.data.projectId,
      canvasId: readString(payload.canvasId),
      nodeId: readString(payload.nodeId),
      assetId: asset.id,
      taskId: job.data.taskId,
      type: 'video',
      status: 'ready',
      resultUrl: storageKey,
      materialId: material.id,
      materialMetadata: material.metadata,
    })
    return {
      assetId: asset.id,
      materialId: material.id,
      videoUrl: storageKey,
      ...(auditionAudioUrl ? { audioUrl: auditionAudioUrl } : {}),
      ...pickVideoResultMetadata(generated),
      ...outputMetadata,
      ...(actualResolution && Object.keys(outputMetadata).length > 0 ? { resolution: actualResolution } : {}),
    }
  } catch (error) {
    const willRetry = workerTaskWillRetry(job, error)
    await prisma.frameosToolboxAsset.update({
      where: { id: asset.id },
      data: { status: willRetry ? 'processing' : 'failed', errorMessage: error instanceof Error ? error.message : String(error) },
    }).catch(() => undefined)
    if (!willRetry) {
      await projectCanvasToolboxTaskTerminal({
        projectId: job.data.projectId,
        canvasId: readString(payload.canvasId),
        nodeId: readString(payload.nodeId),
        assetId: asset.id,
        taskId: job.data.taskId,
        type: 'video',
        status: 'failed',
        errorMessage: error instanceof Error ? error.message : String(error),
      }).catch(() => undefined)
    }
    throw error
  }
}
