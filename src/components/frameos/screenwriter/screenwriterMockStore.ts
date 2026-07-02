import { screenwriterDemoScripts, videoRepaintDemoTask } from './screenwriterDemoData'
import { getVideoRepaintRouteByStage, getVideoRepaintStageRoute } from './screenwriterRoutes'
import type { ScreenwriterScriptSummary, VideoRepaintTaskDetail } from './types'

function enrichScript(script: ScreenwriterScriptSummary): ScreenwriterScriptSummary {
  const currentStage = script.currentStage ?? videoRepaintDemoTask.currentStage
  const activeTaskId = script.activeTaskId ?? videoRepaintDemoTask.id
  return {
    ...script,
    activeTaskId,
    currentStage,
    currentStageStatus: script.currentStageStatus ?? videoRepaintDemoTask.stages.find((stage) => stage.key === currentStage)?.status ?? script.activeTaskStatus,
    nextRoute: script.nextRoute ?? getVideoRepaintStageRoute(activeTaskId, currentStage),
    updatedAt: script.updatedAt ?? '2026-07-02T00:00:00.000Z',
  }
}

export function listScreenwriterTasks(): ScreenwriterScriptSummary[] {
  return screenwriterDemoScripts.map(enrichScript)
}

export function getVideoRepaintTask(taskId: string): VideoRepaintTaskDetail | null {
  if (taskId !== videoRepaintDemoTask.id) return null
  return {
    ...videoRepaintDemoTask,
    routeByStage: getVideoRepaintRouteByStage(taskId),
    canConfirmCurrentStage: videoRepaintDemoTask.currentStage === 'source_settings' || videoRepaintDemoTask.currentStage === 'target_settings',
    canRetryCurrentStage: videoRepaintDemoTask.stages.some((stage) => stage.status === 'failed'),
  }
}
