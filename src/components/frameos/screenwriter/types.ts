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
}
