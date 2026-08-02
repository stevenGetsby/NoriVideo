import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError, getRequestId } from '@/lib/api-errors'
import { isErrorResponse, requireProjectAuthLight } from '@/lib/api-auth'
import { requireCanvasInProject } from '@/lib/canvas/access'
import {
  buildCanvasOperationDedupeKey,
  canvasOperationTaskLinks,
  findCanvasOperationTask,
  parseCanvasOperationTaskPayload,
  serializeCanvasOperationTask,
  taskTypeForCanvasOperation,
} from '@/lib/canvas/operation-task'
import { resolveRequiredTaskLocale, resolveTaskLocaleFromBody } from '@/lib/task/resolve-locale'
import { submitTask } from '@/lib/task/submitter'
import { TASK_STATUS } from '@/lib/task/types'

export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string; canvasId: string; taskId: string }> },
) => {
  const { projectId, canvasId, taskId } = await context.params
  const authResult = await requireProjectAuthLight(projectId, ['canvasWrite'])
  if (isErrorResponse(authResult)) return authResult
  await requireCanvasInProject(canvasId, projectId)

  const original = await findCanvasOperationTask({
    taskId,
    userId: authResult.session.user.id,
    projectId,
    canvasId,
  })
  if (!original) throw new ApiError('NOT_FOUND')
  if (original.status !== TASK_STATUS.FAILED && original.status !== TASK_STATUS.CANCELED) {
    throw new ApiError('CONFLICT', { message: '只有失败或已取消的画布处理任务可以重试。' })
  }
  const originalPayload = parseCanvasOperationTaskPayload(original.payload)
  if (!originalPayload) throw new ApiError('INVALID_PARAMS', { message: '原画布处理任务参数已损坏，无法重试。' })

  const requestBody = await request.json().catch(() => null)
  const payload = {
    ...originalPayload,
    retryOf: original.id,
  }
  const submitResult = await submitTask({
    userId: authResult.session.user.id,
    locale: resolveTaskLocaleFromBody(original.payload) || resolveRequiredTaskLocale(request, requestBody),
    requestId: getRequestId(request),
    projectId,
    type: taskTypeForCanvasOperation(payload.operation),
    targetType: 'CanvasNode',
    targetId: payload.sourceNodeId,
    payload,
    dedupeKey: buildCanvasOperationDedupeKey(payload),
    maxAttempts: 1,
  })
  const task = await findCanvasOperationTask({
    taskId: submitResult.taskId,
    userId: authResult.session.user.id,
    projectId,
    canvasId,
  })
  if (!task) throw new ApiError('INTERNAL_ERROR', { message: '重试任务创建后无法读取。' })

  return NextResponse.json({
    success: true,
    async: true,
    retryOf: original.id,
    taskId: task.id,
    task: serializeCanvasOperationTask(task),
    links: canvasOperationTaskLinks(projectId, canvasId, task.id),
  }, { status: 202 })
})
