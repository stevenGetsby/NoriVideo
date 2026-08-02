import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireProjectAuthLight } from '@/lib/api-auth'
import { requireCanvasInProject } from '@/lib/canvas/access'
import {
  canvasGenerationTaskLinks,
  findCanvasGenerationTask,
  serializeCanvasGenerationTask,
} from '@/lib/canvas/generation-task'
import { removeTaskJob } from '@/lib/task/queues'
import { publishTaskEvent } from '@/lib/task/publisher'
import { cancelTask } from '@/lib/task/service'
import { TASK_EVENT_TYPE } from '@/lib/task/types'

type RouteContext = {
  params: Promise<{ projectId: string; canvasId: string; taskId: string }>
}

export const GET = apiHandler(async (_request: NextRequest, context: RouteContext) => {
  const { projectId, canvasId, taskId } = await context.params
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult
  await requireCanvasInProject(canvasId, projectId)

  const task = await findCanvasGenerationTask({ taskId, projectId, canvasId })
  if (!task) throw new ApiError('NOT_FOUND')
  return NextResponse.json({
    task: serializeCanvasGenerationTask(task),
    links: canvasGenerationTaskLinks(projectId, canvasId, task.id),
  })
})

export const DELETE = apiHandler(async (_request: NextRequest, context: RouteContext) => {
  const { projectId, canvasId, taskId } = await context.params
  const authResult = await requireProjectAuthLight(projectId, ['canvasWrite'])
  if (isErrorResponse(authResult)) return authResult
  await requireCanvasInProject(canvasId, projectId)

  const existing = await findCanvasGenerationTask({ taskId, projectId, canvasId })
  if (!existing) throw new ApiError('NOT_FOUND')
  const cancelledResult = await cancelTask(taskId, 'Canvas generation cancelled by user', { projectId })
  if (!cancelledResult.task) throw new ApiError('NOT_FOUND')

  if (cancelledResult.cancelled) {
    await removeTaskJob(taskId).catch(() => false)
    await publishTaskEvent({
      taskId,
      projectId,
      userId: cancelledResult.task.userId,
      type: TASK_EVENT_TYPE.FAILED,
      taskType: cancelledResult.task.type,
      targetType: cancelledResult.task.targetType,
      targetId: cancelledResult.task.targetId,
      episodeId: null,
      payload: {
        stage: 'cancelled',
        stageLabel: '任务已取消',
        cancelled: true,
        message: cancelledResult.task.errorMessage || 'Canvas generation cancelled by user',
      },
      persist: false,
    })
  }

  return NextResponse.json({
    success: true,
    cancelled: cancelledResult.cancelled,
    task: serializeCanvasGenerationTask(cancelledResult.task),
    links: canvasGenerationTaskLinks(projectId, canvasId, taskId),
  })
})
