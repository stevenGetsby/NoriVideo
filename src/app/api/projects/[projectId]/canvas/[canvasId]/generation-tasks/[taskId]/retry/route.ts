import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError, getRequestId } from '@/lib/api-errors'
import { isErrorResponse, requireProjectAuthLight } from '@/lib/api-auth'
import { requireCanvasInProject } from '@/lib/canvas/access'
import {
  bindCanvasGenerationTaskToNode,
  buildCanvasGenerationDedupeKey,
  canvasGenerationTaskLinks,
  findCanvasGenerationTask,
  parseCanvasGenerationTaskPayload,
  serializeCanvasGenerationTask,
  taskTypeForCanvasGeneration,
} from '@/lib/canvas/generation-task'
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

  const original = await findCanvasGenerationTask({ taskId, projectId, canvasId })
  if (!original) throw new ApiError('NOT_FOUND')
  if (original.status !== TASK_STATUS.FAILED && original.status !== TASK_STATUS.CANCELED) {
    throw new ApiError('CONFLICT', { message: '只有失败或已取消的画布生成任务可以重试。' })
  }
  const originalPayload = parseCanvasGenerationTaskPayload(original.type, original.payload)
  if (!originalPayload) throw new ApiError('INVALID_PARAMS', { message: '原画布生成任务参数已损坏，无法重试。' })

  const requestBody = await request.json().catch(() => null)
  const payload = { ...originalPayload, retryOf: original.id }
  const type = taskTypeForCanvasGeneration(payload.kind)
  const submitResult = await submitTask({
    userId: authResult.session.user.id,
    locale: resolveTaskLocaleFromBody(original.payload) || resolveRequiredTaskLocale(request, requestBody),
    requestId: getRequestId(request),
    projectId,
    type,
    targetType: 'CanvasNode',
    targetId: payload.nodeId,
    payload,
    dedupeKey: buildCanvasGenerationDedupeKey(type, payload),
  })
  const bound = await bindCanvasGenerationTaskToNode({
    projectId,
    taskId: submitResult.taskId,
    runId: submitResult.runId,
    payload,
  })
  if (!bound) throw new ApiError('CONFLICT', { message: '目标画布节点已被删除或类型已改变。' })
  const task = await findCanvasGenerationTask({
    taskId: submitResult.taskId,
    projectId,
    canvasId,
    nodeId: payload.nodeId,
  })
  if (!task) throw new ApiError('INTERNAL_ERROR', { message: '重试任务创建后无法读取。' })
  return NextResponse.json({
    success: true,
    async: true,
    retryOf: original.id,
    taskId: task.id,
    runId: submitResult.runId,
    task: serializeCanvasGenerationTask(task),
    links: canvasGenerationTaskLinks(projectId, canvasId, task.id),
  }, { status: 202 })
})
