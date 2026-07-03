import { SCREENWRITER_TASK_KIND, type ScreenwriterTaskKind, type VideoRepaintRouteStage } from './types'

export const VIDEO_REPAINT_ROUTE_STAGE_SEGMENTS: Record<VideoRepaintRouteStage, string> = {
  auto_split: '',
  fact_extract: '',
  source_settings: 'source-settings',
  episode_alignment: 'episode-alignment',
  target_settings: 'target-settings',
  episode_repaint: 'episode-repaint',
  target_script: 'target-script',
}

export function getVideoRepaintTaskRoute(taskId: string) {
  return `/screenwriter/video-repaint/${encodeURIComponent(taskId)}`
}

export function getVideoRepaintStageRoute(taskId: string, stage: VideoRepaintRouteStage) {
  const base = getVideoRepaintTaskRoute(taskId)
  const segment = VIDEO_REPAINT_ROUTE_STAGE_SEGMENTS[stage]
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
  return `/screenwriter/script-repaint/${encodeURIComponent(taskId)}`
}

export function getScriptRepaintStageRoute(taskId: string, stage: VideoRepaintRouteStage) {
  const base = getScriptRepaintTaskRoute(taskId)
  const segment = VIDEO_REPAINT_ROUTE_STAGE_SEGMENTS[stage]
  if (stage === 'episode_alignment') {
    return `${base}/target-settings`
  }
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

export function getScreenwriterTaskRoute(taskKind: ScreenwriterTaskKind, taskId: string) {
  if (taskKind === SCREENWRITER_TASK_KIND.SCRIPT_REPAINT_2) {
    return getScriptRepaintTaskRoute(taskId)
  }
  return getVideoRepaintTaskRoute(taskId)
}

export function getScreenwriterStageRoute(taskKind: ScreenwriterTaskKind, taskId: string, stage: VideoRepaintRouteStage) {
  if (taskKind === SCREENWRITER_TASK_KIND.SCRIPT_REPAINT_2) {
    return getScriptRepaintStageRoute(taskId, stage)
  }
  return getVideoRepaintStageRoute(taskId, stage)
}

export function getScreenwriterRouteByStage(taskKind: ScreenwriterTaskKind, taskId: string) {
  if (taskKind === SCREENWRITER_TASK_KIND.SCRIPT_REPAINT_2) {
    return getScriptRepaintRouteByStage(taskId)
  }
  return getVideoRepaintRouteByStage(taskId)
}
