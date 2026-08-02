import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireProjectAuthLight } from '@/lib/api-auth'
import { requireCanvasInProject } from '@/lib/canvas/access'
import {
  canvasOperationTaskLinks,
  findCanvasOperationTask,
  serializeCanvasOperationTask,
} from '@/lib/canvas/operation-task'
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

  const task = await findCanvasOperationTask({
    taskId,
    userId: authResult.session.user.id,
    projectId,
    canvasId,
  })
  if (!task) throw new ApiError('NOT_FOUND')
  return NextResponse.json({
    task: serializeCanvasOperationTask(task),
    links: canvasOperationTaskLinks(projectId, canvasId, task.id),
  })
})

export const DELETE = apiHandler(async (_request: NextRequest, context: RouteContext) => {
  const { projectId, canvasId, taskId } = await context.params
  const authResult = await requireProjectAuthLight(projectId, ['canvasWrite'])
  if (isErrorResponse(authResult)) return authResult
  await requireCanvasInProject(canvasId, projectId)

  const existing = await findCanvasOperationTask({
    taskId,
    userId: authResult.session.user.id,
    projectId,
    canvasId,
  })
  if (!existing) throw new ApiError('NOT_FOUND')

  const cancelledResult = await cancelTask(taskId, 'Canvas operation cancelled by user', {
    userId: authResult.session.user.id,
    projectId,
  })
  if (!cancelledResult.task) throw new ApiError('NOT_FOUND')

  if (cancelledResult.cancelled) {
    await removeTaskJob(taskId).catch(() => false)
    await publishTaskEvent({
      taskId,
      projectId,
      userId: authResult.session.user.id,
      type: TASK_EVENT_TYPE.FAILED,
      taskType: cancelledResult.task.type,
      targetType: cancelledResult.task.targetType,
      targetId: cancelledResult.task.targetId,
      episodeId: null,
      payload: {
        stage: 'cancelled',
        stageLabel: '任务已取消',
        cancelled: true,
        message: cancelledResult.task.errorMessage || 'Canvas operation cancelled by user',
      },
      persist: false,
    })
  }

  return NextResponse.json({
    success: true,
    cancelled: cancelledResult.cancelled,
    task: serializeCanvasOperationTask(cancelledResult.task),
    links: canvasOperationTaskLinks(projectId, canvasId, taskId),
  })
})
