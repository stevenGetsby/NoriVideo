import { ApiError } from '@/lib/api-errors'

export const PROJECT_LEVEL = 'Nori1.0' as const
// Historical values remain readable so old projects and older clients do not
// break, while every new NoriVideo project is created as Nori1.0.
export const PROJECT_LEVELS = [PROJECT_LEVEL, 'premium2', 'premium'] as const
export type ProjectLevel = (typeof PROJECT_LEVELS)[number]

export const PROJECT_STYLES = ['live-action', 'anime-3d', 'anime-2.5d', 'anime-2d', 'anime'] as const
export type ProjectStyle = (typeof PROJECT_STYLES)[number]

export const TARGET_AUDIENCES = ['zh-platform', 'global-platform'] as const
export type TargetAudience = (typeof TARGET_AUDIENCES)[number]

export const VIDEO_RATIOS = ['9:16', '16:9'] as const
export type ProjectVideoRatio = (typeof VIDEO_RATIOS)[number]

export const VIDEO_RESOLUTIONS = ['480p', '720p', '1080p', '4K'] as const
export type ProjectVideoResolution = (typeof VIDEO_RESOLUTIONS)[number]

export const EPISODE_DURATION_MODES = ['per-episode', 'per-1000-chars'] as const
export type EpisodeDurationMode = (typeof EPISODE_DURATION_MODES)[number]
export type TargetEpisodeDurationSeconds = number

export const PROJECT_CONTENT_TYPES = ['story', 'narration'] as const
export type ProjectContentType = (typeof PROJECT_CONTENT_TYPES)[number]

export const PROJECT_MATERIAL_TYPES = ['script', 'novel-outline'] as const
export type ProjectMaterialType = (typeof PROJECT_MATERIAL_TYPES)[number]

export function workflowModeForContentType(contentType: ProjectContentType): 'srt' | 'narration' {
  return contentType === 'narration' ? 'narration' : 'srt'
}

export const CREATE_PROJECT_STYLE_PROMPT_MAX_LENGTH = 5000
export const INITIAL_EPISODE_MIN = 1
export const INITIAL_EPISODE_MAX = 100

export interface InitialEpisodeRange {
  start: number
  end: number
  count: number
}

export const PROJECT_STYLE_PROMPTS: Record<ProjectStyle, string> = {
  'live-action': [
    '真人实拍电影质感：必须像由真实演员、真实服化道和真实场景完成的摄影成片，保留自然皮肤毛孔、细小瑕疵、真实发丝与织物纤维，面部表情细腻。',
    '画面保持统一的电影级摄影光影、自然景深、真实材质纹理和连贯色调；肤色自然不过度磨皮，不使用夸张滤镜。',
    '严格避免 3D 建模、CGI、游戏引擎渲染、数字人、蜡像脸、塑料皮肤、树脂材质、动漫、插画、概念设计图或明显 AI 渲染感。',
    '角色、环境、道具在全项目中保持同一写实美术体系，适合生成真人分镜图、真人视频和连续镜头资产。',
  ].join('\n'),
  'anime-3d': [
    '高质量 3D 动漫短剧风格，角色采用统一的三维造型、材质、骨骼比例与影视级灯光渲染。',
    '保持角色模型、服装、发型、场景比例和道具材质跨镜一致，画面具有明确空间层次与真实景深。',
    '避免二维线稿、真人照片感、低模穿插、材质漂移和角色比例突变。',
  ].join('\n'),
  'anime-2.5d': [
    '高质量 2.5D 动漫短剧风格，以二维角色设计结合三维空间、景深、运镜和分层光影。',
    '保持线稿、上色、角色比例与三维场景透视统一，突出动画感并保留电影镜头的空间表现。',
    '避免纯真人质感、扁平无景深、模型塑料感和二维角色与三维背景比例失配。',
  ].join('\n'),
  'anime-2d': [
    '高质量 2D 动漫短剧风格，稳定角色设定、清晰轮廓、干净线稿、精致赛璐璐上色和统一光影。',
    '保持二维动画制作体系，角色比例、服装、发型、场景和道具在连续镜头中一致。',
    '避免真人照片质感、三维塑料感、粗糙草图、低幼卡通感和画风漂移。',
  ].join('\n'),
  anime: [
    '高质量现代动漫短剧画风，稳定角色设定、清晰轮廓、干净线稿、精致赛璐璐上色和统一光影。',
    '画面保持二次元动画制作体系，表情可更有戏剧张力，但角色比例、服装、发型、场景和道具需要前后一致。',
    '避免真人照片质感、粗糙草图、低幼卡通感、过度写实皮肤和不稳定画风，适合生成动漫分镜图、动漫视频和连续镜头资产。',
  ].join('\n'),
}

const LIVE_ACTION_ASSET_PHOTOGRAPHY_PROMPT = [
  '真实真人摄影，不是 3D 或数字绘画：使用真实演员的自然五官、真实皮肤毛孔与细微瑕疵、独立发丝、真实布料纤维和物理可信的服装褶皱。',
  '影棚实拍级布光与 35mm 胶片质地，肤色自然，五官比例真实，不做过度磨皮。',
  '负面约束：不要 3D 建模、CGI、游戏引擎渲染、数字人、蜡像脸、塑料皮肤、树脂光泽、动漫、插画、概念设计图、卡通化或明显 AI 渲染感。',
].join('\n')

export function buildAssetAestheticPrompt(artStylePrompt: string | null | undefined): string {
  const style = artStylePrompt?.trim() || ''
  const isAnimationStyle = /(?:3D\s*动漫|2\.5D\s*动漫|2D\s*动漫|二次元|赛璐璐|动画制作体系)/i.test(style)
  if (isAnimationStyle) return style
  return [LIVE_ACTION_ASSET_PHOTOGRAPHY_PROMPT, style].filter(Boolean).join('\n')
}

export const TARGET_AUDIENCE_PROMPTS: Record<TargetAudience, string> = {
  'zh-platform': [
    '目标受众为中文平台视频消费者，默认使用简体中文叙事语境。',
    '剧情节奏、台词表达、情绪钩子和信息密度应贴合抖音、快手、小红书、视频号等中文短视频平台。',
    '可以使用中文网络语境和本土生活细节，但避免难以生成或过度依赖字幕解释的表达。',
  ].join('\n'),
  'global-platform': [
    '目标受众为出海平台视频消费者，默认采用更全球化、易本地化的叙事语境。',
    '剧情节奏、视觉表达和人物动机应适合 TikTok、Reels、Shorts 等海外短视频平台。',
    '减少强中文平台梗、地域限定表达和复杂文化前提；台词与画面应便于后续翻译、配音或本地化改写。',
  ].join('\n'),
}

export interface ProjectCreationConfig {
  projectLevel: ProjectLevel
  contentType: ProjectContentType
  projectStyle: ProjectStyle
  materialType: ProjectMaterialType
  targetEpisodeCount: number
  targetAudience: TargetAudience
  targetAudiencePrompt: string
  videoRatio: ProjectVideoRatio
  videoResolution: ProjectVideoResolution
  episodeDurationMode: EpisodeDurationMode
  episodeDurationValue: number
  targetEpisodeDurationSeconds: TargetEpisodeDurationSeconds
  artStyle: string
  baseArtStylePrompt: string
  referenceArtStylePrompt: string | null
  customArtStylePrompt: string | null
  artStylePrompt: string
  usesCustomArtStylePrompt: boolean
  usesReferenceArtStylePrompt: boolean
}

export function buildUnifiedArtStylePrompt(input: {
  projectStyle: ProjectStyle
  referenceArtStylePrompt?: string | null
  customArtStylePrompt?: string | null
}): string {
  const base = PROJECT_STYLE_PROMPTS[input.projectStyle]
  const reference = input.referenceArtStylePrompt?.trim() || null
  const custom = input.customArtStylePrompt?.trim() || null
  return [
    `【Nori1.0 项目基础画风】\n${base}`,
    reference ? `【画风参考解析】\n${reference}` : null,
    custom ? `【用户自定义画风】\n${custom}` : null,
    '【全流程一致性】\n以上画风是本项目资产图、分镜图与视频生成的统一视觉约束；不得因镜头、角色或生成批次变化而漂移。',
  ].filter((part): part is string => Boolean(part)).join('\n\n')
}

export function appendProjectArtStyleConstraint(
  prompt: string,
  artStylePrompt: string | null | undefined,
): string {
  const base = prompt.trim()
  const style = artStylePrompt?.trim() || ''
  if (!style || base.includes(style)) return base
  return [
    base,
    '【项目统一画风（全局强约束）】',
    style,
    '资产外观、色彩、材质、光影和渲染方式必须遵守以上项目画风，不得在本镜头中切换美术体系。',
  ].filter(Boolean).join('\n\n')
}

function isOneOf<T extends readonly string[]>(value: unknown, allowed: T): value is T[number] {
  return typeof value === 'string' && allowed.includes(value)
}

function normalizeOptionalText(value: unknown, maxLength: number, field: string): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  if (trimmed.length > maxLength) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'FIELD_TOO_LONG',
      field,
      limit: maxLength,
      message: `${field} is too long`,
    })
  }
  return trimmed
}

function normalizeRequiredEnum<T extends readonly string[]>(
  value: unknown,
  allowed: T,
  fallback: T[number],
  field: string,
  code: string,
): T[number] {
  if (value === undefined || value === null || value === '') return fallback
  if (isOneOf(value, allowed)) return value
  throw new ApiError('INVALID_PARAMS', {
    code,
    field,
    allowedValues: [...allowed],
    message: `${field} must be one of: ${allowed.join(', ')}`,
  })
}

function normalizeDurationMode(value: unknown): EpisodeDurationMode {
  return normalizeRequiredEnum(
    value,
    EPISODE_DURATION_MODES,
    'per-episode',
    'episodeDurationMode',
    'EPISODE_DURATION_MODE_INVALID',
  )
}

function normalizeTargetDuration(
  value: unknown,
  mode: EpisodeDurationMode,
  level: ProjectLevel,
): TargetEpisodeDurationSeconds {
  if (value === undefined || value === null || value === '') return 120
  const numeric = typeof value === 'number' ? value : Number.parseInt(String(value), 10)
  const minimum = level === 'premium' ? 60 : mode === 'per-episode' ? 10 : 1
  const maximum = level === 'premium' ? 600 : mode === 'per-episode' ? 3600 : 600
  if (Number.isInteger(numeric) && numeric >= minimum && numeric <= maximum) return numeric
  throw new ApiError('INVALID_PARAMS', {
    code: 'TARGET_EPISODE_DURATION_INVALID',
    field: 'episodeDurationValue',
    minimum,
    maximum,
    message: `episodeDurationValue must be an integer between ${minimum} and ${maximum}`,
  })
}

function normalizeTargetEpisodeCount(value: unknown): number {
  if (value === undefined || value === null || value === '') return 0
  const numeric = typeof value === 'number' ? value : Number(value)
  if (Number.isInteger(numeric) && numeric >= 0 && numeric <= 100) return numeric
  throw new ApiError('INVALID_PARAMS', {
    code: 'TARGET_EPISODE_COUNT_INVALID',
    field: 'targetEpisodeCount',
    minimum: 0,
    maximum: 100,
    message: 'targetEpisodeCount must be an integer between 0 and 100',
  })
}

function readStrictInteger(value: unknown): number | null {
  if (typeof value === 'number') return Number.isInteger(value) ? value : null
  if (typeof value !== 'string' || !/^\d+$/.test(value.trim())) return null
  const numeric = Number(value)
  return Number.isSafeInteger(numeric) ? numeric : null
}

export function normalizeInitialEpisodeRange(body: Record<string, unknown>): InitialEpisodeRange | null {
  const rawStart = body.initialEpisodeStart ?? body.initial_episode_start
  const rawEnd = body.initialEpisodeEnd ?? body.initial_episode_end
  if (rawStart === undefined && rawEnd === undefined) return null

  const start = readStrictInteger(rawStart)
  const end = readStrictInteger(rawEnd)
  if (
    start === null
    || end === null
    || start < INITIAL_EPISODE_MIN
    || end > INITIAL_EPISODE_MAX
    || start > end
  ) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'INITIAL_EPISODE_RANGE_INVALID',
      field: 'initialEpisodeRange',
      minimum: INITIAL_EPISODE_MIN,
      maximum: INITIAL_EPISODE_MAX,
      message: `initialEpisodeStart and initialEpisodeEnd must form an ascending range between ${INITIAL_EPISODE_MIN} and ${INITIAL_EPISODE_MAX}`,
    })
  }
  return { start, end, count: end - start + 1 }
}

export function normalizeProjectCreationConfig(body: Record<string, unknown>): ProjectCreationConfig {
  const projectLevel = normalizeRequiredEnum(
    body.projectLevel,
    PROJECT_LEVELS,
    PROJECT_LEVEL,
    'projectLevel',
    'PROJECT_LEVEL_INVALID',
  )

  const projectStyle = normalizeRequiredEnum(
    body.projectStyle,
    PROJECT_STYLES,
    'live-action',
    'projectStyle',
    'PROJECT_STYLE_INVALID',
  )
  const contentType = normalizeRequiredEnum(
    body.contentType ?? body.projectType,
    PROJECT_CONTENT_TYPES,
    'story',
    'contentType',
    'PROJECT_CONTENT_TYPE_INVALID',
  )
  const materialType = normalizeRequiredEnum(
    body.materialType,
    PROJECT_MATERIAL_TYPES,
    'script',
    'materialType',
    'PROJECT_MATERIAL_TYPE_INVALID',
  )
  const targetEpisodeCount = normalizeTargetEpisodeCount(body.targetEpisodeCount)
  const targetAudience = normalizeRequiredEnum(
    body.targetAudience,
    TARGET_AUDIENCES,
    'zh-platform',
    'targetAudience',
    'TARGET_AUDIENCE_INVALID',
  )
  const videoRatio = normalizeRequiredEnum(
    body.videoRatio,
    VIDEO_RATIOS,
    '9:16',
    'videoRatio',
    'VIDEO_RATIO_INVALID',
  )
  const videoResolution = normalizeRequiredEnum(
    body.videoResolution,
    VIDEO_RESOLUTIONS,
    '480p',
    'videoResolution',
    'VIDEO_RESOLUTION_INVALID',
  )
  const episodeDurationMode = normalizeDurationMode(
    body.episodeDurationMode ?? body.durationMode,
  )
  const episodeDurationValue = normalizeTargetDuration(
    body.episodeDurationValue ?? body.targetEpisodeDurationSeconds ?? body.durationSeconds,
    episodeDurationMode,
    projectLevel,
  )
  const customStylePrompt = normalizeOptionalText(
    body.customArtStylePrompt ?? body.artStylePrompt ?? body.stylePrompt ?? body.visualStylePrompt,
    CREATE_PROJECT_STYLE_PROMPT_MAX_LENGTH,
    'customArtStylePrompt',
  )
  const referenceStylePrompt = normalizeOptionalText(
    body.referenceArtStylePrompt ?? body.reference_style_prompt,
    CREATE_PROJECT_STYLE_PROMPT_MAX_LENGTH,
    'referenceArtStylePrompt',
  )
  const baseArtStylePrompt = PROJECT_STYLE_PROMPTS[projectStyle]

  return {
    projectLevel,
    contentType,
    projectStyle,
    materialType,
    targetEpisodeCount,
    targetAudience,
    targetAudiencePrompt: TARGET_AUDIENCE_PROMPTS[targetAudience],
    videoRatio,
    videoResolution,
    episodeDurationMode,
    episodeDurationValue,
    // Kept for older generation code and API clients. In per-thousand mode the
    // explicit mode/value fields disambiguate that this is a pacing ratio.
    targetEpisodeDurationSeconds: episodeDurationValue,
    artStyle: 'custom:nori-project-style',
    baseArtStylePrompt,
    referenceArtStylePrompt: referenceStylePrompt,
    customArtStylePrompt: customStylePrompt,
    artStylePrompt: buildUnifiedArtStylePrompt({
      projectStyle,
      referenceArtStylePrompt: referenceStylePrompt,
      customArtStylePrompt: customStylePrompt,
    }),
    usesCustomArtStylePrompt: !!customStylePrompt,
    usesReferenceArtStylePrompt: !!referenceStylePrompt,
  }
}

export function buildProjectDescription(
  config: ProjectCreationConfig,
  explicitDescription: string | null,
): string {
  const levelLabel = config.projectLevel === 'Nori1.0'
    ? 'Nori1.0'
    : config.projectLevel === 'premium2'
      ? '精品版 2.0（历史）'
      : '精品版（历史）'
  const styleLabel = config.projectStyle === 'live-action'
    ? '仿真人'
    : config.projectStyle === 'anime-3d'
      ? '3D 动漫'
      : config.projectStyle === 'anime-2.5d'
        ? '2.5D 动漫'
        : config.projectStyle === 'anime-2d'
          ? '2D 动漫'
          : '动漫'
  const contentTypeLabel = config.contentType === 'narration' ? '解说模式' : '剧情模式'
  const materialTypeLabel = config.materialType === 'novel-outline' ? '小说/大纲' : '剧本'
  const audienceLabel = config.targetAudience === 'global-platform' ? '出海平台' : '中文平台'
  const durationLabel = config.episodeDurationMode === 'per-1000-chars'
    ? `${config.episodeDurationValue}s/千字`
    : `${config.episodeDurationValue}s/集`
  return [
    levelLabel,
    config.projectLevel === 'premium' ? contentTypeLabel : null,
    styleLabel,
    config.projectLevel === 'premium' ? materialTypeLabel : null,
    config.targetEpisodeCount > 0 ? `目标 ${config.targetEpisodeCount} 集` : null,
    audienceLabel,
    config.videoRatio,
    config.videoResolution,
    durationLabel,
    explicitDescription,
  ].filter(Boolean).join(' · ')
}

export function resolveTargetAudiencePrompt(targetAudience: string | null | undefined): string {
  return targetAudience === 'global-platform'
    ? TARGET_AUDIENCE_PROMPTS['global-platform']
    : TARGET_AUDIENCE_PROMPTS['zh-platform']
}
