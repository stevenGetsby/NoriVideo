/**
 * What the 转绘 routes and the writer workbench agree on. One uploaded video yields a 目标剧本 and a
 * 目标设定总纲, written by the text model. The 分镜 is a separate optional shot-level breakdown written by
 * the video model, with machine-detected cuts as a timing aid.
 */

export const REPAINT_EPISODE_NUMBER = 1

/** Billing and usage records of the 转绘 routes are filed under this stand-in project. */
export const VIDEO_REPAINT_PROJECT_ID = 'video-repaint'

/** The client keeps asking for more shots while the storyboard stops short of the video's end; this caps the loop. */
export const REPAINT_MAX_STORYBOARD_ROUNDS = 8

export const REPAINT_OUTLINE_TITLE = '目标设定总纲'
export const REPAINT_SCRIPT_TITLE = '目标剧本'
export const REPAINT_STORYBOARD_TITLE = '分镜'
export const REPAINT_DOCUMENTS_LAYOUT = 'documents'

export const repaintOutlineDocId = (scriptId: string): string => `${scriptId}-doc-outline`
export const repaintScriptDocId = (scriptId: string): string => `${scriptId}-doc-script`
export const repaintStoryboardDocId = (scriptId: string): string => `${scriptId}-doc-storyboard`

/** The ten chapters of the 总纲, in order. The heading lines are written as "1. 标题". */
export const REPAINT_OUTLINE_SECTION_TITLES = [
  '目标市场版故事核与类型承诺',
  '目标语言与文字系统合同',
  '本地化总策略',
  '权力结构映射',
  '主要人物小传',
  '阶段变体和身份伪装',
  '关键道具和身份锚点',
  '尺度、禁忌和平台表达',
  '逐集转绘约束',
  '文化契合度审计',
] as const

export interface RepaintUsage {
  inputTokens: number
  outputTokens: number
}

export interface RepaintValidation {
  valid: boolean
  errors: string[]
  warnings: string[]
}

/** Progress events of the streamed understanding routes. `shots` is how many complete shots the storyboard has so far. */
export interface RepaintProgress {
  stage: 'upload' | 'preprocess' | 'analyze' | 'storyboard'
  elapsedSeconds?: number
  outputChars?: number
  shots?: number
}

/** Stage A: `POST /api/video-repaint/understand` as multipart, streamed. The `result` event carries `{ success, result }`. */
export interface RepaintUnderstandResult {
  fileHandle: string
  /** The source script as plain text (第1集 / 1-1 / 场景 / 人物 / △ …). */
  script: string
  analysis: Record<string, unknown>
  durationSeconds: number
  /** Seconds at which the picture visibly cuts, found by ffmpeg while the video was uploading. May be empty. */
  cutHints: number[]
  usage: RepaintUsage
  validation: RepaintValidation
}

/** Stage B: `POST /api/video-repaint/understand` as JSON, streamed. Send again with `continuation` until `complete`. */
export interface RepaintStoryboardRequest {
  stage: 'storyboard'
  fileHandle: string
  sourceAnalysis: Record<string, unknown>
  episodeNumber?: number
  cutHints?: number[]
  /** The storyboard text received so far; the model carries on after its last shot. */
  continuation?: { storyboard: string }
}

export interface RepaintStoryboardResult {
  fileHandle: string
  /** The whole storyboard so far (earlier rounds included), renumbered. */
  storyboard: string
  /** True once the last shot reaches the end of the video. */
  complete: boolean
  coveredSeconds: number
  durationSeconds: number
  shotCount: number
  /** Shots this round added; zero twice in a row means the model has nothing more to give. */
  addedShots: number
  usage: RepaintUsage
  validation: RepaintValidation
}

/** Stage C: `POST /api/video-repaint/outline`. */
export interface RepaintOutlineRequest {
  title: string
  /** The user's repaint brief: target market, audience, language, platform, naming, style. May be empty. */
  adaptationBrief: string
  sourceScript: string
  sourceAnalysis?: Record<string, unknown>
}

export interface RepaintOutlineResult {
  outline: string
  model: string
  usage: RepaintUsage
  /** Chapter numbers (1-10) the text model left out. */
  missingSections: number[]
}

/** Stage D: `POST /api/video-repaint/script`, independent of the optional storyboard. */
export interface RepaintTargetScriptRequest {
  title: string
  adaptationBrief: string
  sourceScript: string
  sourceAnalysis?: Record<string, unknown>
  durationSeconds?: number
  outline: string
}

export interface RepaintTargetScriptResult {
  targetScript: string
  model: string
  usage: RepaintUsage
}

/** Save: `POST /api/video-repaint/scripts`. Any generated document can be saved; 分镜 is not required. */
export interface RepaintSaveRequest {
  clientRequestId: string
  title: string
  outline?: string
  targetScript?: string
  storyboard?: string
  sourceScript: string
  adaptationBrief?: string
  model?: string
  sourceFileName?: string
  sourceAnalysis?: Record<string, unknown>
}
