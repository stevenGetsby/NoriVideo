import type { ScreenwriterScriptSummary, VideoRepaintRouteStage } from './types'

const STAGE_SEGMENTS: Record<VideoRepaintRouteStage, string> = {
  auto_split: '',
  fact_extract: '',
  source_settings: 'source-settings',
  episode_alignment: 'episode-alignment',
  target_settings: 'target-settings',
  episode_repaint: 'episode-repaint',
  target_script: 'target-script',
}

export function getVideoRepaintTaskRoute(taskId: string) {
  return `/screenwriter/video-repaint/${taskId}`
}

export function getVideoRepaintStageRoute(taskId: string, stage: VideoRepaintRouteStage) {
  const base = getVideoRepaintTaskRoute(taskId)
  const segment = STAGE_SEGMENTS[stage]
  return segment ? `${base}/${segment}` : base
}

export function getVideoRepaintRouteByStage(taskId: string): Record<VideoRepaintRouteStage, string> {
  return {
    auto_split: getVideoRepaintStageRoute(taskId, 'auto_split'),
    fact_extract: getVideoRepaintStageRoute(taskId, 'fact_extract'),
    source_settings: getVideoRepaintStageRoute(taskId, 'source_settings'),
    episode_alignment: getVideoRepaintStageRoute(taskId, 'episode_alignment'),
    target_settings: getVideoRepaintStageRoute(taskId, 'target_settings'),
    episode_repaint: getVideoRepaintStageRoute(taskId, 'episode_repaint'),
    target_script: getVideoRepaintStageRoute(taskId, 'target_script'),
  }
}

export function getScriptRepaintTaskRoute(taskId: string) {
  return `/screenwriter/script-repaint/${taskId}`
}

export function getScriptRepaintStageRoute(taskId: string, stage: VideoRepaintRouteStage) {
  const base = getScriptRepaintTaskRoute(taskId)
  if (stage === 'episode_alignment') return `${base}/target-settings`
  const segment = STAGE_SEGMENTS[stage]
  return segment ? `${base}/${segment}` : base
}

export function getScriptRepaintRouteByStage(taskId: string): Record<VideoRepaintRouteStage, string> {
  return {
    auto_split: getScriptRepaintStageRoute(taskId, 'auto_split'),
    fact_extract: getScriptRepaintStageRoute(taskId, 'fact_extract'),
    source_settings: getScriptRepaintStageRoute(taskId, 'source_settings'),
    episode_alignment: getScriptRepaintStageRoute(taskId, 'episode_alignment'),
    target_settings: getScriptRepaintStageRoute(taskId, 'target_settings'),
    episode_repaint: getScriptRepaintStageRoute(taskId, 'episode_repaint'),
    target_script: getScriptRepaintStageRoute(taskId, 'target_script'),
  }
}

export function getScreenwriterStageRoute(task: Pick<ScreenwriterScriptSummary, 'taskKind'>, taskId: string, stage: VideoRepaintRouteStage) {
  if (task.taskKind === 'script_repaint_2') return getScriptRepaintStageRoute(taskId, stage)
  return getVideoRepaintStageRoute(taskId, stage)
}

export function getScreenwriterTaskNextRoute(task: ScreenwriterScriptSummary) {
  if (task.nextRoute) return task.nextRoute
  if (task.activeTaskId && task.currentStage) return getScreenwriterStageRoute(task, task.activeTaskId, task.currentStage)
  if (task.activeTaskId && task.taskKind === 'script_repaint_2') return getScriptRepaintTaskRoute(task.activeTaskId)
  if (task.activeTaskId) return getVideoRepaintTaskRoute(task.activeTaskId)
  return '/screenwriter'
}
