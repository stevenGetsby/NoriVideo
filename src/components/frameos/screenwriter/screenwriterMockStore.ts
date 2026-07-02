import { screenwriterDemoScripts, videoRepaintDemoTask } from './screenwriterDemoData'
import { getVideoRepaintRouteByStage, getVideoRepaintStageRoute } from './screenwriterRoutes'
import type {
  ScreenwriterScriptSummary,
  VideoRepaintAdvanceResult,
  VideoRepaintAutoAdvance,
  VideoRepaintCreateInput,
  VideoRepaintCreateResult,
  VideoRepaintRouteStage,
  VideoRepaintStageKey,
  VideoRepaintStageStatus,
  VideoRepaintTaskDetail,
  VideoRepaintTaskView,
} from './types'

const createdScripts: ScreenwriterScriptSummary[] = []
const createdTasks: VideoRepaintTaskView[] = []
const demoTaskOverrides = new Map<string, VideoRepaintTaskView>()

const STAGE_ORDER: VideoRepaintRouteStage[] = [
  'auto_split',
  'fact_extract',
  'source_settings',
  'episode_alignment',
  'target_settings',
  'episode_repaint',
  'target_script',
]

const CHECKPOINT_STAGES = new Set<VideoRepaintRouteStage>(['source_settings', 'target_settings'])
const AUTO_ADVANCE_DELAY_MS = 10000

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
  return [
    ...createdScripts.map(enrichScript),
    ...screenwriterDemoScripts.map(enrichScript),
  ]
}

export function getVideoRepaintTask(taskId: string): VideoRepaintTaskDetail | null {
  const task = findTask(taskId)
  if (!task) return null
  return {
    ...task,
    routeByStage: getVideoRepaintRouteByStage(taskId),
    canConfirmCurrentStage: task.currentStage === 'source_settings' || task.currentStage === 'target_settings',
    canRetryCurrentStage: task.stages.some((stage) => stage.status === 'failed'),
  }
}

export function createVideoRepaintTask(input: VideoRepaintCreateInput): VideoRepaintCreateResult {
  const taskId = `mock-video-repaint-${createdTasks.length + 1}`
  const title = input.title.trim()
  const requirement = input.requirement.trim()
  const now = new Date().toISOString()
  const nextRoute = getVideoRepaintStageRoute(taskId, 'auto_split')

  const task: VideoRepaintTaskView = {
    ...videoRepaintDemoTask,
    id: taskId,
    title,
    taskTypeLabel: input.transferForm === 'script' ? '剧本转绘 2.0' : '分镜转绘 2.0',
    requirement,
    currentStage: 'auto_split',
    stages: videoRepaintDemoTask.stages.map((stage) => ({
      ...stage,
      status: stage.key === 'auto_split' ? 'running' : 'not_started',
    })),
  }

  const script: ScreenwriterScriptSummary = {
    id: `${taskId}-script`,
    title,
    episodeCount: input.uploadMode === 'folder' ? 12 : 1,
    taskKind: 'video_repaint_2',
    taskLabel: input.transferForm === 'script' ? '视频转绘2.0任务' : '视频转分镜2.0任务',
    status: 'draft',
    activeTaskId: taskId,
    activeTaskLabel: '进行中',
    activeTaskStatus: 'running',
    currentStage: 'auto_split',
    currentStageStatus: 'running',
    nextRoute,
    updatedAt: now,
  }

  createdTasks.unshift(task)
  createdScripts.unshift(script)

  return { id: taskId, title, nextRoute }
}

export function advanceVideoRepaintTask(taskId: string, fromStage: VideoRepaintRouteStage): VideoRepaintAdvanceResult | null {
  const task = findTask(taskId)
  const nextStage = getNextStage(fromStage)
  if (!task || !nextStage) return null

  const updatedTask = updateTaskStage(task, nextStage)
  replaceTask(updatedTask)
  updateScriptForTask(taskId, nextStage, getStageStatus(nextStage), getVideoRepaintStageRoute(taskId, nextStage))

  return {
    taskId,
    nextStage,
    nextRoute: getVideoRepaintStageRoute(taskId, nextStage),
  }
}

export function getVideoRepaintAutoAdvance(taskId: string, stage: VideoRepaintRouteStage): VideoRepaintAutoAdvance | null {
  if (CHECKPOINT_STAGES.has(stage) || stage === 'target_script') return null
  const nextStage = getNextStage(stage)
  if (!nextStage) return null

  return {
    taskId,
    delayMs: AUTO_ADVANCE_DELAY_MS,
    nextStage,
    nextRoute: getVideoRepaintStageRoute(taskId, nextStage),
  }
}

export function resetScreenwriterMockStore() {
  createdScripts.splice(0)
  createdTasks.splice(0)
  demoTaskOverrides.clear()
}

function findTask(taskId: string): VideoRepaintTaskView | undefined {
  if (taskId === videoRepaintDemoTask.id) {
    return demoTaskOverrides.get(taskId) ?? videoRepaintDemoTask
  }
  return createdTasks.find((item) => item.id === taskId)
}

function getNextStage(stage: VideoRepaintRouteStage): VideoRepaintRouteStage | null {
  const index = STAGE_ORDER.indexOf(stage)
  if (index < 0 || index >= STAGE_ORDER.length - 1) return null
  return STAGE_ORDER[index + 1]
}

function getStageStatus(stage: VideoRepaintRouteStage): VideoRepaintStageStatus {
  if (CHECKPOINT_STAGES.has(stage)) return 'waiting_check'
  if (stage === 'target_script') return 'succeeded'
  return 'running'
}

function updateTaskStage(task: VideoRepaintTaskView, nextStage: VideoRepaintRouteStage): VideoRepaintTaskView {
  const nextIndex = STAGE_ORDER.indexOf(nextStage)
  const currentStage: VideoRepaintStageKey = nextStage === 'target_script' ? 'episode_repaint' : nextStage
  return {
    ...task,
    currentStage,
    stages: task.stages.map((stage) => {
      const stageIndex = STAGE_ORDER.indexOf(stage.key)
      if (stage.key === currentStage) {
        return { ...stage, status: getStageStatus(nextStage) }
      }
      if (stageIndex >= 0 && stageIndex < nextIndex) {
        return { ...stage, status: 'approved' }
      }
      return { ...stage, status: 'not_started' }
    }),
  }
}

function replaceTask(task: VideoRepaintTaskView) {
  if (task.id === videoRepaintDemoTask.id) {
    demoTaskOverrides.set(task.id, task)
    return
  }
  const index = createdTasks.findIndex((item) => item.id === task.id)
  if (index >= 0) {
    createdTasks[index] = task
  }
}

function updateScriptForTask(taskId: string, stage: VideoRepaintRouteStage, stageStatus: VideoRepaintStageStatus, nextRoute: string) {
  const script = createdScripts.find((item) => item.activeTaskId === taskId)
  if (!script) return
  script.currentStage = stage
  script.currentStageStatus = stageStatus
  script.activeTaskStatus = stageStatus
  script.nextRoute = nextRoute
  script.updatedAt = new Date().toISOString()
}
