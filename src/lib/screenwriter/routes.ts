import type { VideoRepaintRouteStage } from './types'

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
