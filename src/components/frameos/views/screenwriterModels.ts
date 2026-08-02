import type { AppIconName } from '@/components/ui/icons'

export type ScriptStatus = 'draft' | 'available' | 'archived'

export interface WriterEpisode {
  id: string
  title: string
  body: string
}

export interface WriterScript {
  id: string
  title: string
  type: string
  status: ScriptStatus
  createdAt: string
  updatedAt: string
  episodes: WriterEpisode[]
  lineage?: string
}

export interface WriterTool {
  title: string
  subtitle: string
  icon: AppIconName
  tone: 'redraw2'
  badge?: string
}

export const WRITER_TOOL: WriterTool = {
  title: '视频转绘',
  subtitle: '整剧视频一键转为目标版本，保持全剧角色、场景和设定一致',
  icon: 'sparklesAlt',
  tone: 'redraw2',
}

export const SCRIPT_STATUS_LABELS: Record<ScriptStatus, string> = {
  draft: '草稿',
  available: '可用',
  archived: '已归档',
}
