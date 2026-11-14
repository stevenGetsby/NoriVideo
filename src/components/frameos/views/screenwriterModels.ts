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
  /** 视频转绘 documents keep the 目标设定总纲 and 分镜 as two flat documents instead of episodes. */
  layout?: 'documents'
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
  subtitle: '上传一个视频，生成目标设定总纲与逐镜分镜两份文档',
  icon: 'sparklesAlt',
  tone: 'redraw2',
}

export const SCRIPT_STATUS_LABELS: Record<ScriptStatus, string> = {
  draft: '草稿',
  available: '可用',
  archived: '已归档',
}

export function writerScriptUnitLabel(script: Pick<WriterScript, 'layout' | 'episodes'>): string {
  return script.layout === 'documents'
    ? `${script.episodes.length} 份文档`
    : `${script.episodes.length} 集`
}

export function writerScriptExportText(script: Pick<WriterScript, 'layout' | 'episodes'>): string {
  if (script.layout === 'documents') {
    return script.episodes.map((document) => `${document.title}\n\n${document.body}`).join('\n\n--------------------\n\n')
  }
  return script.episodes.map((episode, index) => `第 ${index + 1} 集  ${episode.title}\n\n${episode.body}`).join('\n\n--------------------\n\n')
}
