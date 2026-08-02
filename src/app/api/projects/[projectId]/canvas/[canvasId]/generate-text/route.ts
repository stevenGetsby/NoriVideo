import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError, getRequestId } from '@/lib/api-errors'
import { isErrorResponse, requireProjectAuthLight } from '@/lib/api-auth'
import { requireCanvasInProject } from '@/lib/canvas/access'
import {
  bindCanvasGenerationTaskToNode,
  buildCanvasGenerationDedupeKey,
  canvasGenerationTaskLinks,
  findCanvasGenerationTask,
  serializeCanvasGenerationTask,
  type CanvasTextGenerationTaskPayload,
} from '@/lib/canvas/generation-task'
import { prisma } from '@/lib/prisma'
import { resolveRequiredTaskLocale } from '@/lib/task/resolve-locale'
import { submitTask } from '@/lib/task/submitter'
import { TASK_TYPE } from '@/lib/task/types'

function cleanString(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string; canvasId: string }> },
) => {
  const { projectId, canvasId } = await context.params
  const authResult = await requireProjectAuthLight(projectId, ['canvasWrite'])
  if (isErrorResponse(authResult)) return authResult
  await requireCanvasInProject(canvasId, projectId)

  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  const nodeId = cleanString(body?.nodeId, 191)
  const prompt = cleanString(body?.prompt, 30_000)
  const modelKey = cleanString(body?.modelKey, 240)
  if (!nodeId || !prompt || !modelKey) throw new ApiError('INVALID_PARAMS', { message: '节点、提示词和文本模型均为必填项。' })
  const node = await prisma.canvasNode.findFirst({ where: { id: nodeId, canvasId }, select: { id: true } })
  if (!node) throw new ApiError('NOT_FOUND')

  const payload: CanvasTextGenerationTaskPayload = {
    kind: 'text',
    canvasId,
    nodeId,
    prompt,
    modelKey,
    analysisModel: modelKey,
    maxInputTokens: 8_000,
    maxOutputTokens: 6_000,
    retryOf: null,
  }
  const submitResult = await submitTask({
    userId: authResult.session.user.id,
    locale: resolveRequiredTaskLocale(request, body),
    requestId: getRequestId(request),
    projectId,
    type: TASK_TYPE.CANVAS_TEXT_GENERATION,
    targetType: 'CanvasNode',
    targetId: nodeId,
    payload,
    dedupeKey: buildCanvasGenerationDedupeKey(TASK_TYPE.CANVAS_TEXT_GENERATION, payload),
  })
  const bound = await bindCanvasGenerationTaskToNode({
    projectId,
    taskId: submitResult.taskId,
    runId: submitResult.runId,
    payload,
  })
  if (!bound) throw new ApiError('CONFLICT', { message: '文本节点已被删除或类型已改变。' })
  const task = await findCanvasGenerationTask({
    taskId: submitResult.taskId,
    projectId,
    canvasId,
    nodeId,
  })
  if (!task) throw new ApiError('INTERNAL_ERROR', { message: '画布文本任务创建后无法读取。' })
  return NextResponse.json({
    success: true,
    async: true,
    taskId: task.id,
    runId: submitResult.runId,
    task: serializeCanvasGenerationTask(task),
    links: canvasGenerationTaskLinks(projectId, canvasId, task.id),
  }, { status: 202 })
})
