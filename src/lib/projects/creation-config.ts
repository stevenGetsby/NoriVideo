import { ApiError } from '@/lib/api-errors'

export const PROJECT_LEVEL = 'Nori1.0' as const

export const PROJECT_STYLES = ['live-action', 'anime'] as const
export type ProjectStyle = (typeof PROJECT_STYLES)[number]

export const TARGET_AUDIENCES = ['zh-platform', 'global-platform'] as const
export type TargetAudience = (typeof TARGET_AUDIENCES)[number]

export const VIDEO_RATIOS = ['9:16', '16:9'] as const
export type ProjectVideoRatio = (typeof VIDEO_RATIOS)[number]

export const VIDEO_RESOLUTIONS = ['480p', '720p'] as const
export type ProjectVideoResolution = (typeof VIDEO_RESOLUTIONS)[number]

export const TARGET_EPISODE_DURATIONS = [60, 90, 120] as const
export type TargetEpisodeDurationSeconds = (typeof TARGET_EPISODE_DURATIONS)[number]

export const CREATE_PROJECT_STYLE_PROMPT_MAX_LENGTH = 5000

export const PROJECT_STYLE_PROMPTS: Record<ProjectStyle, string> = {
  'live-action': [
    '真人实拍电影质感，真实演员、真实服化道与真实场景，肤色自然，面部表情细腻，镜头语言接近短剧/影视剧拍摄。',
    '画面保持统一的电影级光影、自然景深、真实材质纹理和连贯色调；避免卡通化、插画感、塑料质感、过度磨皮和夸张滤镜。',
    '角色、环境、道具在全项目中保持同一写实美术体系，适合生成真人分镜图、真人视频和连续镜头资产。',
  ].join('\n'),
  anime: [
    '高质量现代动漫短剧画风，稳定角色设定、清晰轮廓、干净线稿、精致赛璐璐上色和统一光影。',
    '画面保持二次元动画制作体系，表情可更有戏剧张力，但角色比例、服装、发型、场景和道具需要前后一致。',
    '避免真人照片质感、粗糙草图、低幼卡通感、过度写实皮肤和不稳定画风，适合生成动漫分镜图、动漫视频和连续镜头资产。',
  ].join('\n'),
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
  projectLevel: typeof PROJECT_LEVEL
  projectStyle: ProjectStyle
  targetAudience: TargetAudience
  targetAudiencePrompt: string
  videoRatio: ProjectVideoRatio
  videoResolution: ProjectVideoResolution
  targetEpisodeDurationSeconds: TargetEpisodeDurationSeconds
  artStyle: string
  artStylePrompt: string
  usesCustomArtStylePrompt: boolean
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

function normalizeTargetDuration(value: unknown): TargetEpisodeDurationSeconds {
  if (value === undefined || value === null || value === '') return 90
  const numeric = typeof value === 'number' ? value : Number.parseInt(String(value), 10)
  if (numeric === 60 || numeric === 90 || numeric === 120) return numeric
  throw new ApiError('INVALID_PARAMS', {
    code: 'TARGET_EPISODE_DURATION_INVALID',
    field: 'targetEpisodeDurationSeconds',
    allowedValues: [...TARGET_EPISODE_DURATIONS],
    message: 'targetEpisodeDurationSeconds must be 60, 90 or 120',
  })
}

export function normalizeProjectCreationConfig(body: Record<string, unknown>): ProjectCreationConfig {
  if (body.projectLevel !== undefined && body.projectLevel !== PROJECT_LEVEL) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'PROJECT_LEVEL_INVALID',
      field: 'projectLevel',
      allowedValues: [PROJECT_LEVEL],
      message: 'projectLevel must be Nori1.0',
    })
  }

  const projectStyle = normalizeRequiredEnum(
    body.projectStyle,
    PROJECT_STYLES,
    'live-action',
    'projectStyle',
    'PROJECT_STYLE_INVALID',
  )
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
    '720p',
    'videoResolution',
    'VIDEO_RESOLUTION_INVALID',
  )
  const targetEpisodeDurationSeconds = normalizeTargetDuration(
    body.targetEpisodeDurationSeconds ?? body.durationSeconds,
  )
  const customStylePrompt = normalizeOptionalText(
    body.artStylePrompt ?? body.stylePrompt ?? body.visualStylePrompt,
    CREATE_PROJECT_STYLE_PROMPT_MAX_LENGTH,
    'artStylePrompt',
  )

  return {
    projectLevel: PROJECT_LEVEL,
    projectStyle,
    targetAudience,
    targetAudiencePrompt: TARGET_AUDIENCE_PROMPTS[targetAudience],
    videoRatio,
    videoResolution,
    targetEpisodeDurationSeconds,
    artStyle: 'custom:nori-project-style',
    artStylePrompt: customStylePrompt || PROJECT_STYLE_PROMPTS[projectStyle],
    usesCustomArtStylePrompt: !!customStylePrompt,
  }
}

export function buildProjectDescription(
  config: ProjectCreationConfig,
  explicitDescription: string | null,
): string {
  const styleLabel = config.projectStyle === 'anime' ? '动漫' : '真人'
  const audienceLabel = config.targetAudience === 'global-platform' ? '出海平台' : '中文平台'
  return [
    config.projectLevel,
    styleLabel,
    audienceLabel,
    config.videoRatio,
    config.videoResolution,
    `${config.targetEpisodeDurationSeconds}s`,
    explicitDescription,
  ].filter(Boolean).join(' · ')
}

export function resolveTargetAudiencePrompt(targetAudience: string | null | undefined): string {
  return targetAudience === 'global-platform'
    ? TARGET_AUDIENCE_PROMPTS['global-platform']
    : TARGET_AUDIENCE_PROMPTS['zh-platform']
}
