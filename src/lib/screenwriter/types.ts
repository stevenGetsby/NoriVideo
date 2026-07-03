export const SCREENWRITER_TASK_KIND = {
  VIDEO_REPAINT_2: 'video_repaint_2',
  SCRIPT_REPAINT_2: 'script_repaint_2',
  STORYBOARD_REPAINT_2: 'storyboard_repaint_2',
} as const

export type ScreenwriterTaskKind = (typeof SCREENWRITER_TASK_KIND)[keyof typeof SCREENWRITER_TASK_KIND]

export const SCREENWRITER_TASK_STATUS = {
  DRAFT: 'draft',
  AVAILABLE: 'available',
  ARCHIVED: 'archived',
} as const

export type ScreenwriterTaskStatus = (typeof SCREENWRITER_TASK_STATUS)[keyof typeof SCREENWRITER_TASK_STATUS]

export const VIDEO_REPAINT_STAGE = {
  AUTO_SPLIT: 'auto_split',
  FACT_EXTRACT: 'fact_extract',
  SOURCE_SETTINGS: 'source_settings',
  EPISODE_ALIGNMENT: 'episode_alignment',
  TARGET_SETTINGS: 'target_settings',
  EPISODE_REPAINT: 'episode_repaint',
} as const

export type VideoRepaintStageKey = (typeof VIDEO_REPAINT_STAGE)[keyof typeof VIDEO_REPAINT_STAGE]
export type VideoRepaintRouteStage = VideoRepaintStageKey | 'target_script'

export const VIDEO_REPAINT_STAGE_STATUS = {
  NOT_STARTED: 'not_started',
  QUEUED: 'queued',
  RUNNING: 'running',
  WAITING_CHECK: 'waiting_check',
  APPROVED: 'approved',
  SUCCEEDED: 'succeeded',
  FAILED: 'failed',
  STALE: 'stale',
} as const

export type VideoRepaintStageStatus = (typeof VIDEO_REPAINT_STAGE_STATUS)[keyof typeof VIDEO_REPAINT_STAGE_STATUS]

export type VideoRepaintTransferForm = 'script' | 'board'
export type VideoRepaintUploadMode = 'file' | 'folder'
export type EpisodeProcessStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'retrying'

export type ScreenwriterTaskSummaryDto = {
  id: string
  title: string
  episodeCount: number
  taskKind: ScreenwriterTaskKind
  taskLabel: string
  status: ScreenwriterTaskStatus
  activeTaskId: string
  activeTaskLabel?: string
  activeTaskStatus?: VideoRepaintStageStatus
  currentStage?: VideoRepaintRouteStage
  currentStageStatus?: VideoRepaintStageStatus
  nextRoute?: string
  updatedAt?: string
}

export type VideoRepaintStageItemDto = {
  key: VideoRepaintStageKey
  title: string
  subtitle: string
  status: VideoRepaintStageStatus
  checkpoint?: 'A' | 'B'
}

export type SettingsReviewDto = {
  title: string
  checkpoint: 'A' | 'B'
  outlineTitle: string
  bodySections: Array<{ heading: string; body: string }>
  collapsedPanelTitle: string
  collapsedPanelCount: number
  nameIndexGroups: Array<{
    title: string
    rows: Array<{ sourceName: string; targetName: string; description?: string }>
  }>
  issuePanelTitle: string
  issueCount: number
  issues: Array<{
    id: string
    label: string
    category: string
    currentHandling: string
    evidence: string
    risk: string
    confirmationPrompt: string
  }>
  feedbackPlaceholder: string
}

export type EpisodeProcessDto = {
  id: string
  episodeNumber: number
  status: EpisodeProcessStatus
  errorMessage?: string
}

export type TargetScriptEpisodeDto = {
  id: string
  episodeNumber: number
  title: string
  status: EpisodeProcessStatus
  wordCount: number
  content: string
}

export type VideoRepaintTaskDetailDto = {
  id: string
  title: string
  taskTypeLabel: string
  requirement: string
  currentStage: VideoRepaintStageKey
  stages: VideoRepaintStageItemDto[]
  sourceSettings: SettingsReviewDto
  targetSettings: SettingsReviewDto
  alignmentEpisodes: EpisodeProcessDto[]
  repaintEpisodes: EpisodeProcessDto[]
  routeByStage: Record<VideoRepaintRouteStage, string>
  canConfirmCurrentStage: boolean
  canRetryCurrentStage: boolean
}

export type VideoRepaintCreateInput = {
  userId: string
  title: string
  transferForm: VideoRepaintTransferForm
  uploadMode: VideoRepaintUploadMode
  sourceAssetName: string
  requirement: string
  checkpoints: Record<'A' | 'B', boolean>
}

export type VideoRepaintCreateResponse = {
  id: string
  title: string
  nextRoute: string
}
