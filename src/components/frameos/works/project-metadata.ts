import type { WorkProject } from './types'

const WORKFLOW_MODE_LABELS: Readonly<Record<string, string>> = {
  srt: '剧情模式',
  script: '剧情模式',
  screenplay: '剧情模式',
  story: '剧情模式',
  narration: '解说模式',
  'video-repaint': '视频转绘',
  video_repaint: '视频转绘',
}

/** Prefer an explicit project genre, then a real workflow mode, then “未分类”. */
export function projectGenreLabel(project: WorkProject): string {
  const explicit = project.genreName?.trim() || project.genre?.trim()
  if (explicit) return explicit
  const contentType = project.novelPromotionData?.contentType?.trim()
  if (contentType) return WORKFLOW_MODE_LABELS[contentType] || contentType
  const workflowMode = project.novelPromotionData?.workflowMode?.trim()
  if (!workflowMode) return '未分类'
  return WORKFLOW_MODE_LABELS[workflowMode] || workflowMode
}

/** FrameOS hides the ratio tag when the project has no ratio. */
export function projectAspectRatio(project: WorkProject): string | null {
  return project.aspectRatio?.trim() || project.novelPromotionData?.videoRatio?.trim() || null
}
