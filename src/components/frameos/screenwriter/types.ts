import type { AppIconName } from '@/components/ui/icons'

export type ScreenwriterModeKey =
  | 'video-repaint-2'
  | 'script-repaint-2'
  | 'storyboard-repaint-2'
  | 'single-episode-test'
  | 'novel-to-script'
  | 'video2script'
  | 'video2board'
  | 'script2board'
  | 'board2board'

export type ScreenwriterScriptStatus = 'draft' | 'available' | 'archived'

export type VideoRepaintStageStatus =
  | 'not_started'
  | 'queued'
  | 'running'
  | 'waiting_check'
  | 'approved'
  | 'succeeded'
  | 'failed'
  | 'stale'

export type VideoRepaintStageKey =
  | 'auto_split'
  | 'fact_extract'
  | 'source_settings'
  | 'episode_alignment'
  | 'target_settings'
  | 'episode_repaint'

export type VideoRepaintRouteStage = VideoRepaintStageKey | 'target_script'

export type VideoRepaintTransferForm = 'script' | 'board'

export type VideoRepaintUploadMode = 'file' | 'folder'

export type EpisodeProcessStatus =
  | 'pending'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'retrying'

export interface ScreenwriterModeCard {
  key: ScreenwriterModeKey
  title: string
  subtitle: string
  icon: AppIconName
  accent: string
  iconBg: string
  badge?: string
  compact?: boolean
}

export interface ScreenwriterScriptSummary {
  id: string
  title: string
  episodeCount: number
  taskKind: 'video_repaint_2' | 'script_repaint_2' | 'storyboard_repaint_2'
  taskLabel: string
  status: ScreenwriterScriptStatus
  activeTaskId?: string
  activeTaskLabel?: string
  activeTaskStatus?: VideoRepaintStageStatus
  currentStage?: VideoRepaintRouteStage
  currentStageStatus?: VideoRepaintStageStatus
  nextRoute?: string
  updatedAt?: string
}

export interface VideoRepaintStageItem {
  key: VideoRepaintStageKey
  title: string
  subtitle: string
  status: VideoRepaintStageStatus
  checkpoint?: 'A' | 'B'
}

export interface VideoRepaintTaskView {
  id: string
  title: string
  taskTypeLabel: string
  requirement: string
  currentStage: VideoRepaintStageKey
  stages: VideoRepaintStageItem[]
  sourceSettings: SettingsReviewView
  targetSettings: SettingsReviewView
  alignmentEpisodes: EpisodeProcessItem[]
  repaintEpisodes: EpisodeProcessItem[]
}

export interface VideoRepaintTaskDetail extends VideoRepaintTaskView {
  routeByStage: Record<VideoRepaintRouteStage, string>
  canConfirmCurrentStage: boolean
  canRetryCurrentStage: boolean
}

export interface VideoRepaintCreateInput {
  title: string
  transferForm: VideoRepaintTransferForm
  uploadMode: VideoRepaintUploadMode
  sourceAssetName: string
  requirement: string
  checkpoints: Record<'A' | 'B', boolean>
}

export interface VideoRepaintCreateResult {
  id: string
  title: string
  nextRoute: string
}

export interface VideoRepaintAdvanceResult {
  taskId: string
  nextStage: VideoRepaintRouteStage
  nextRoute: string
}

export interface VideoRepaintAutoAdvance extends VideoRepaintAdvanceResult {
  delayMs: number
}

export interface SettingsReviewView {
  title: string
  checkpoint: 'A' | 'B'
  outlineTitle: string
  bodySections: Array<{
    heading: string
    body: string
  }>
  collapsedPanelTitle: string
  collapsedPanelCount: number
  nameIndexGroups: NameIndexGroup[]
  issuePanelTitle: string
  issueCount: number
  issues: ReviewIssue[]
  feedbackPlaceholder: string
}

export interface NameIndexGroup {
  title: string
  rows: Array<{
    sourceName: string
    targetName: string
    description?: string
  }>
}

export interface ReviewIssue {
  id: string
  label: string
  category: string
  currentHandling: string
  evidence: string
  risk: string
  confirmationPrompt: string
}

export interface EpisodeProcessItem {
  id: string
  episodeNumber: number
  status: EpisodeProcessStatus
  errorMessage?: string
}

export interface TargetScriptEpisode {
  id: string
  episodeNumber: number
  title: string
  status: EpisodeProcessStatus
  wordCount: number
  content: string
}
