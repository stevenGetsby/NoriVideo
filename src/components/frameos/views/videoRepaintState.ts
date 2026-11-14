import {
  REPAINT_OUTLINE_SECTION_TITLES,
  type RepaintUsage,
  type RepaintValidation,
} from '@/lib/video-repaint/contract'

export type RepaintRunState = 'setup' | 'processing' | 'review' | 'saving' | 'done'
export type RepaintTrackStatus = 'queued' | 'running' | 'done' | 'failed'

export const MAX_REPAINT_TITLE_CHARS = 40
export const MAX_REPAINT_BRIEF_CHARS = 800
export const MAX_REPAINT_VIDEO_BYTES = 512 * 1024 * 1024

export interface RepaintSetupValues {
  title: string
  brief: string
  videoCount: number
}

export interface RepaintSetupErrors {
  title?: string
  videos?: string
}

export interface LocalVideoItem {
  id: string
  file: File
  url: string
}

export interface VideoUnderstandingEpisode {
  fileName: string
  fileHandle: string
  script: string
  analysis: Record<string, unknown> | null
  durationSeconds: number
  cutHints: number[]
  usage: RepaintUsage
  validation: RepaintValidation
}

export interface RepaintTargetScriptTrack {
  status: RepaintTrackStatus
  error: string
  text: string
  model: string
  usage: RepaintUsage
}

/** Stage C's document, plus enough run state for the progress row and review panel. */
export interface RepaintOutlineTrack {
  status: RepaintTrackStatus
  error: string
  text: string
  model: string
  missingSections: number[]
  usage: RepaintUsage
}

/** Stage B's document. `warnings` belongs to the last completed round. */
export interface RepaintStoryboardTrack {
  status: RepaintTrackStatus
  error: string
  text: string
  complete: boolean
  round: number
  shotCount: number
  coveredSeconds: number
  durationSeconds: number
  warnings: string[]
  usage: RepaintUsage
  sessionExpired: boolean
}

export function createEmptyTargetScriptTrack(): RepaintTargetScriptTrack {
  return { status: 'queued', error: '', text: '', model: '', usage: { inputTokens: 0, outputTokens: 0 } }
}

export function createEmptyOutlineTrack(): RepaintOutlineTrack {
  return {
    status: 'queued',
    error: '',
    text: '',
    model: '',
    missingSections: [],
    usage: { inputTokens: 0, outputTokens: 0 },
  }
}

export function createEmptyStoryboardTrack(): RepaintStoryboardTrack {
  return {
    status: 'queued',
    error: '',
    text: '',
    complete: false,
    round: 0,
    shotCount: 0,
    coveredSeconds: 0,
    durationSeconds: 0,
    warnings: [],
    usage: { inputTokens: 0, outputTokens: 0 },
    sessionExpired: false,
  }
}

export function validateRepaintSetup(values: RepaintSetupValues): RepaintSetupErrors {
  const errors: RepaintSetupErrors = {}
  if (!values.title.trim()) errors.title = '请填写任务名称'
  if (values.videoCount !== 1) errors.videos = '请上传 1 个视频文件；当前一个视频固定作为一集处理'
  return errors
}

/** mm:ss, used for both the covered and the total running time of the storyboard. */
export function formatRepaintClock(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0
  const total = Math.round(safe)
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

/** Turns the server's 1-based missing chapter numbers into "9. 逐集转绘约束" labels. */
export function outlineMissingSectionLabels(missingSections: number[]): string[] {
  return missingSections
    .filter((section) => Number.isInteger(section) && section >= 1 && section <= REPAINT_OUTLINE_SECTION_TITLES.length)
    .map((section) => `${section}. ${REPAINT_OUTLINE_SECTION_TITLES[section - 1]}`)
}

export function isSessionExpiredMessage(message: string): boolean {
  return /会话已失效|重新上传视频|请重新上传/.test(message)
}
