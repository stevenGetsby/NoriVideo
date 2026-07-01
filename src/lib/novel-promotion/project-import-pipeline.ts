import { ApiError } from '@/lib/api-errors'
import { prisma } from '@/lib/prisma'
import { getProjectModelConfig } from '@/lib/config-service'
import { LUMINA_GPT55_MODEL_KEY } from '@/lib/lumina-fixed-models'
import { splitNovelIntoEpisodes, type EpisodeSplitOutput } from './episode-split'
import { writeEpisodeFrameOSMetadataToSpeakerVoices } from './episode-frameos-metadata'
import {
  executeAssetExtraction,
  type AssetExtractionPackage,
  type CharacterAsset,
  type CharacterMainAppearance,
  type CharacterVariant,
  type CharacterVisualProfile,
  type EnvironmentAsset,
  type PropAsset,
} from './asset-extraction'
import {
  stringifyCharacterDescriptionsWithFrameOSMetadata,
  type CharacterAppearanceFrameOSMetadata,
} from './character-appearance-frameos-metadata'
import {
  buildEnvironmentFrameOSMetadata,
  buildItemFrameOSMetadata,
} from './asset-frameos-metadata'
import { seedProjectLocationBackedImageSlots } from '@/lib/assets/services/location-backed-assets'

type PersistAssetPackageResult = {
  characters: number
  environments: number
  props: number
}

export type RunProjectImportPipelineResult = {
  success: true
  episodes: Array<{
    id: string
    episodeNumber: number
    name: string
  }>
  assets: PersistAssetPackageResult
  usage: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
}

function readText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function rangeToEpisodes(range: { start: number; end: number }): number[] {
  const start = Math.max(1, Math.floor(range.start || 1))
  const end = Math.max(start, Math.floor(range.end || start))
  return Array.from({ length: end - start + 1 }, (_, index) => start + index)
}

function formatEpisodes(episodes: number[]) {
  return episodes.length > 0 ? episodes.map((episode) => `E${episode}`).join('、') : ''
}

function joinPromptSections(sections: Array<string | null | undefined>): string {
  return sections.map((section) => readText(section)).filter(Boolean).join('\n')
}

function formatAestheticBlock(artStylePrompt: string | null) {
  return joinPromptSections([
    '真人实拍摄影质感，自然皮肤毛孔与织物纹理，影棚级光影，35mm胶片质地。',
    artStylePrompt,
  ])
}

function formatCharacterArchive(profile: CharacterVisualProfile): string {
  return joinPromptSections([
    profile.subject ? `主体：${profile.subject}` : null,
    profile.face ? `面部：${profile.face}` : null,
    profile.clothing ? `服装：${profile.clothing}` : null,
    profile.accessories ? `配饰：${profile.accessories}` : null,
  ]).replace(/\n/g, '。')
}

function buildCharacterAppearancePrompt(input: {
  character: CharacterAsset
  appearanceName: string
  profile: CharacterVisualProfile
  artStylePrompt: string | null
}) {
  return joinPromptSections([
    '【整体美学】',
    '',
    formatAestheticBlock(input.artStylePrompt),
    '',
    '【画面规格】',
    '',
    `角色设定图，"${input.character.name}"。16:9 横版，纯白背景，平视视角。仅一个角色，画面中不得出现其他人物。`,
    '',
    '版面：左40%，右60%两区。',
    '',
    '左区（占画面宽度40%，全高，纯白背景）：',
    '3/4侧角面部大特写，头顶贴近画面上沿留5%留白，画面下沿到锁骨位置，面部横向居中，无表情闭嘴，脸部无阴影。',
    '右区（占画面宽度60%，纯白背景）：',
    '三张等尺全身像横向排列，依次为正面、侧面、背面。立正姿势，双手自然下垂，头顶贴近画面上沿留5%留白，全身完整入画，从头顶到鞋底无任何裁切。',
    '',
    '身材比例（身高 / 体型 / 头身比）严格按【角色档案】描述呈现。',
    '',
    '所有视图保持同一人物，服装、发型、配饰、身材比例、肤色完全一致。',
    '',
    '【角色档案】',
    '',
    `时期：${input.appearanceName}。`,
    formatCharacterArchive(input.profile),
    '',
    '（不出现任何字幕、文字、Logo、水印、UI；不出现其他人物；不要复制角色或分身同脸；不裁切头顶或脚部）',
  ])
}

function buildCharacterVariantEditPrompt(input: {
  character: CharacterAsset
  variant: CharacterVariant
  episodes: number[]
}) {
  const changes = joinPromptSections([
    input.variant.backgroundDelta,
    input.variant.reason,
    input.variant.profileOverride.subject ? `主体：${input.variant.profileOverride.subject}` : null,
    input.variant.profileOverride.face ? `面部：${input.variant.profileOverride.face}` : null,
    input.variant.profileOverride.clothing ? `服装：${input.variant.profileOverride.clothing}` : null,
    input.variant.profileOverride.accessories ? `配饰：${input.variant.profileOverride.accessories}` : null,
  ]).replace(/\n/g, '。')
  return joinPromptSections([
    '基于参考图生成角色变体设定图，必须保持同一人物身份连续性：脸型、五官结构、身高体型、肤色、年龄感与主形象一致。',
    `角色：${input.character.name}。变体：${input.variant.name}。`,
    '只改变变体要求中明确变化的服装、发型状态、面色、配饰状态，其余外观特征保持不变。',
    '16:9 横版，纯白背景，平视视角。角色设定图，左40%为3/4侧角面部大特写，右60%为正面、侧面、背面三张等尺全身像横向排列。',
    '仅一个角色，不出现其他人物；不出现任何字幕、文字、Logo、水印、UI；不裁切头顶或脚部。',
    input.episodes.length > 0 ? `覆盖分集：${formatEpisodes(input.episodes)}` : null,
    '【主形象参考】',
    formatCharacterArchive(input.character.mainAppearance.profile),
    '【变体变化】',
    changes,
  ])
}

function buildEnvironmentPrompt(input: {
  environment: EnvironmentAsset
  worldBackground: string
  artStylePrompt: string | null
}) {
  const { environment } = input
  return joinPromptSections([
    '【整体美学】',
    formatAestheticBlock(input.artStylePrompt),
    '',
    '【画面规格】',
    `环境概念图，"${environment.name}"。宽银幕构图，16:9比例，大全景，超广角镜头，平视视角，大气透视，建筑纹理细致。`,
    '',
    '【环境档案】',
    `背景功能：${environment.background}`,
    environment.relatedEpisodes.length > 0 ? `覆盖分集：${formatEpisodes(environment.relatedEpisodes)}` : null,
    `空间类型/主体：${environment.profile.subject}`,
    `空间布局：${environment.profile.layout}`,
    `环境氛围：${environment.profile.atmosphere}`,
    `视觉细节：${environment.profile.visualDetails}`,
    input.worldBackground ? `世界背景：${input.worldBackground}` : null,
    '',
    '(不出现任何字幕、文字、Logo、水印；不出现人物、人影、行人、路人)',
  ])
}

function buildPropPrompt(input: {
  prop: PropAsset
  worldBackground: string
  artStylePrompt: string | null
}) {
  const { prop } = input
  return joinPromptSections([
    '【整体美学】',
    formatAestheticBlock(input.artStylePrompt),
    '',
    '【画面规格】',
    `物品参考图，"${prop.name}"。完整物品展示，单个物品，垂直放置，居中构图，纯白背景，正面视角，清晰展示物品全貌与表面质感。`,
    '',
    '【物品档案】',
    prop.owner ? `主使用者：${prop.owner}` : null,
    `剧情意义：${prop.background}`,
    prop.relatedEpisodes.length > 0 ? `覆盖分集：${formatEpisodes(prop.relatedEpisodes)}` : null,
    `主体外观：${prop.profile.subject}`,
    `材质：${prop.profile.material}`,
    `形状结构：${prop.profile.shape}`,
    `视觉细节：${prop.profile.visualDetails}`,
    '',
    '(不出现任何字幕、文字、Logo、水印；不出现持握者、手、人物、人影；不出现背景环境)',
  ])
}

function roleLevelFromImportance(importance: CharacterAsset['importance']): 'S' | 'A' | 'B' | 'C' {
  if (importance === 'lead') return 'S'
  if (importance === 'core_supporting') return 'A'
  return 'C'
}

function buildCharacterProfileData(input: {
  character: CharacterAsset
  prompt: string
  variants: Array<{ variant: CharacterVariant; prompt: string }>
}) {
  const { character } = input
  return {
    role_type: character.importance,
    role_level: roleLevelFromImportance(character.importance),
    description: character.background,
    archetype: character.importance,
    personality_tags: [],
    era_period: '',
    social_class: character.mainAppearance.facts.socialStatus,
    occupation: character.mainAppearance.facts.identity,
    background: character.background,
    identity_lock: [
      character.mainAppearance.facts.identity,
      ...character.mainAppearance.facts.explicitVisualCues,
    ].filter(Boolean),
    relationships: [],
    coverage_scenes: [],
    coverage_episodes: character.relatedEpisodes,
    prompt: input.prompt,
    costume_tier: character.importance === 'lead' ? 4 : 3,
    suggested_colors: [],
    primary_identifier: character.mainAppearance.profile.accessories,
    visual_keywords: [
      character.mainAppearance.profile.subject,
      character.mainAppearance.profile.face,
      character.mainAppearance.profile.clothing,
      character.mainAppearance.profile.accessories,
    ].filter(Boolean),
    gender: '',
    age_range: '',
    variants: input.variants.map(({ variant, prompt }) => ({
      variant_id: variant.id,
      label: variant.name,
      variant_type: variant.backgroundDelta || variant.name,
      prompt,
      coverage_episodes: rangeToEpisodes(variant.episodeRange),
    })),
  }
}

function buildMainAppearanceMetadata(input: {
  appearance: CharacterMainAppearance
  prompt: string
}): CharacterAppearanceFrameOSMetadata {
  return {
    appearance_id: input.appearance.id,
    appearance_index: 0,
    change_reason: input.appearance.name,
    prompt: input.prompt,
    coverage_episodes: rangeToEpisodes(input.appearance.episodeRange),
  }
}

function buildVariantAppearanceMetadata(input: {
  variant: CharacterVariant
  appearanceIndex: number
  prompt: string
}): CharacterAppearanceFrameOSMetadata {
  return {
    appearance_id: input.variant.id,
    appearance_index: input.appearanceIndex,
    change_reason: input.variant.name,
    variant_id: input.variant.id,
    variant_type: input.variant.backgroundDelta || input.variant.name,
    label: input.variant.name,
    prompt: input.prompt,
    coverage_episodes: rangeToEpisodes(input.variant.episodeRange),
  }
}

export async function persistAssetExtractionPackage(input: {
  projectId: string
  package: AssetExtractionPackage
  clearExisting?: boolean
  artStylePrompt?: string | null
}): Promise<PersistAssetPackageResult> {
  const novelProject = await prisma.novelPromotionProject.findUnique({
    where: { projectId: input.projectId },
    select: { id: true },
  })
  if (!novelProject) {
    throw new ApiError('NOT_FOUND')
  }

  const pkg = input.package
  const artStylePrompt = readText(input.artStylePrompt)
  const result: PersistAssetPackageResult = {
    characters: 0,
    environments: 0,
    props: 0,
  }

  await prisma.$transaction(async (tx) => {
    if (input.clearExisting !== false) {
      await tx.novelPromotionCharacter.deleteMany({
        where: { novelPromotionProjectId: novelProject.id },
      })
      await tx.novelPromotionLocation.deleteMany({
        where: { novelPromotionProjectId: novelProject.id },
      })
    }

    await tx.novelPromotionProject.update({
      where: { id: novelProject.id },
      data: {
        globalAssetText: pkg.worldBackground || null,
      },
    })

    for (const character of pkg.characters) {
      const mainPrompt = buildCharacterAppearancePrompt({
        character,
        appearanceName: character.mainAppearance.name,
        profile: character.mainAppearance.profile,
        artStylePrompt,
      })
      const variantPrompts = character.variants.map((variant) => {
        const episodes = rangeToEpisodes(variant.episodeRange)
        return {
          variant,
          prompt: buildCharacterVariantEditPrompt({
            character,
            variant,
            episodes,
          }),
        }
      })

      const created = await tx.novelPromotionCharacter.create({
        data: {
          novelPromotionProjectId: novelProject.id,
          name: character.name,
          aliases: JSON.stringify(character.aliases),
          introduction: character.background,
          profileData: JSON.stringify(buildCharacterProfileData({
            character,
            prompt: mainPrompt,
            variants: variantPrompts,
          })),
          profileConfirmed: true,
        },
      })

      await tx.characterAppearance.createMany({
        data: [
          {
            characterId: created.id,
            appearanceIndex: 0,
            changeReason: character.mainAppearance.name || '初始形象',
            description: mainPrompt,
            descriptions: stringifyCharacterDescriptionsWithFrameOSMetadata(
              [mainPrompt],
              buildMainAppearanceMetadata({
                appearance: character.mainAppearance,
                prompt: mainPrompt,
              }),
            ),
            imageUrls: JSON.stringify([]),
            previousImageUrls: JSON.stringify([]),
          },
          ...variantPrompts.map(({ variant, prompt }, index) => ({
            characterId: created.id,
            appearanceIndex: index + 1,
            changeReason: variant.name,
            description: prompt,
            descriptions: stringifyCharacterDescriptionsWithFrameOSMetadata(
              [prompt],
              buildVariantAppearanceMetadata({
                variant,
                appearanceIndex: index + 1,
                prompt,
              }),
            ),
            imageUrls: JSON.stringify([]),
            previousImageUrls: JSON.stringify([]),
          })),
        ],
      })
      result.characters += 1
    }

    for (const environment of pkg.environments) {
      const prompt = buildEnvironmentPrompt({
        environment,
        worldBackground: pkg.worldBackground,
        artStylePrompt,
      })
      const created = await tx.novelPromotionLocation.create({
        data: {
          novelPromotionProjectId: novelProject.id,
          name: environment.name,
          summary: environment.background,
          assetKind: 'location',
        },
      })
      await seedProjectLocationBackedImageSlots({
        locationId: created.id,
        descriptions: [prompt],
        fallbackDescription: prompt,
        availableSlots: [],
        frameosMetadata: buildEnvironmentFrameOSMetadata({
          name: environment.name,
          summary: environment.background,
          background: environment.background,
          prompt,
          coverage_episodes: environment.relatedEpisodes,
        }),
        locationImageModel: tx.locationImage,
      })
      result.environments += 1
    }

    for (const prop of pkg.props) {
      const prompt = buildPropPrompt({
        prop,
        worldBackground: pkg.worldBackground,
        artStylePrompt,
      })
      const created = await tx.novelPromotionLocation.create({
        data: {
          novelPromotionProjectId: novelProject.id,
          name: prop.name,
          summary: prop.background,
          assetKind: 'prop',
        },
      })
      await seedProjectLocationBackedImageSlots({
        locationId: created.id,
        descriptions: [prompt],
        fallbackDescription: prompt,
        availableSlots: [],
        frameosMetadata: buildItemFrameOSMetadata({
          name: prop.name,
          summary: prop.background,
          background: prop.background,
          prompt,
          coverage_episodes: prop.relatedEpisodes,
        }),
        locationImageModel: tx.locationImage,
      })
      result.props += 1
    }
  }, {
    timeout: 30_000,
  })

  return result
}

export async function runProjectImportPipeline(input: {
  userId: string
  projectId: string
  content?: string | null
}): Promise<RunProjectImportPipelineResult> {
  const novelProject = await prisma.novelPromotionProject.findUnique({
    where: { projectId: input.projectId },
    select: {
      id: true,
      pendingImportText: true,
      artStylePrompt: true,
    },
  })
  if (!novelProject) {
    throw new ApiError('NOT_FOUND')
  }

  const importText = readText(input.content) || readText(novelProject.pendingImportText)
  if (!importText) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'IMPORT_TEXT_REQUIRED',
      message: '没有可解析的剧本文本',
    })
  }

  await prisma.novelPromotionProject.update({
    where: { id: novelProject.id },
    data: { importStatus: 'processing' },
  })

  try {
    const episodes = await splitNovelIntoEpisodes({
      userId: input.userId,
      projectId: input.projectId,
      content: importText,
      locale: 'zh',
    })

    const createdEpisodes = await persistEpisodesFromSplit({
      novelPromotionProjectId: novelProject.id,
      episodes,
    })

    const config = await getProjectModelConfig(input.projectId, input.userId)
    const extraction = await executeAssetExtraction({
      userId: input.userId,
      projectId: input.projectId,
      model: config.analysisModel || LUMINA_GPT55_MODEL_KEY,
      episodes: createdEpisodes.map((episode) => ({
        episodeNumber: episode.episodeNumber,
        title: episode.name,
        sourceText: episode.novelText || '',
      })),
      batchConcurrency: 1,
    })

    const assets = await persistAssetExtractionPackage({
      projectId: input.projectId,
      package: extraction.package,
      clearExisting: true,
      artStylePrompt: novelProject.artStylePrompt,
    })

    await prisma.novelPromotionProject.update({
      where: { id: novelProject.id },
      data: {
        importStatus: 'completed',
        pendingImportText: null,
        pendingImportEpisodeName: null,
      },
    })

    return {
      success: true,
      episodes: createdEpisodes.map((episode) => ({
        id: episode.id,
        episodeNumber: episode.episodeNumber,
        name: episode.name,
      })),
      assets,
      usage: extraction.usage,
    }
  } catch (error) {
    await prisma.novelPromotionProject.update({
      where: { id: novelProject.id },
      data: { importStatus: 'failed' },
    })
    throw error
  }
}

async function persistEpisodesFromSplit(input: {
  novelPromotionProjectId: string
  episodes: EpisodeSplitOutput[]
}) {
  if (input.episodes.length === 0) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'EPISODE_SPLIT_EMPTY',
      message: '分集结果为空',
    })
  }

  return await prisma.$transaction(async (tx) => {
    await tx.novelPromotionEpisode.deleteMany({
      where: { novelPromotionProjectId: input.novelPromotionProjectId },
    })

    const created = []
    for (let index = 0; index < input.episodes.length; index += 1) {
      const episode = input.episodes[index]
      created.push(await tx.novelPromotionEpisode.create({
        data: {
          novelPromotionProjectId: input.novelPromotionProjectId,
          episodeNumber: index + 1,
          name: episode.title || `第${index + 1}集`,
          description: episode.summary || null,
          novelText: episode.content,
          speakerVoices: writeEpisodeFrameOSMetadataToSpeakerVoices(null, episode.frameosMetadata || null),
        },
      }))
    }

    await tx.novelPromotionProject.update({
      where: { id: input.novelPromotionProjectId },
      data: {
        lastEpisodeId: created[0]?.id || null,
      },
    })

    return created
  }, {
    timeout: 30_000,
  })
}
