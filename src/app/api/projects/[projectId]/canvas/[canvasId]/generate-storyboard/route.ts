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
  type CanvasStoryboardPlanTaskPayload,
} from '@/lib/canvas/generation-task'
import { normalizeCanvasImageGenerationOptions } from '@/lib/canvas/generator-options'
import { getProjectModelConfig, resolveProjectModelCapabilityGenerationOptions } from '@/lib/config-service'
import { prisma } from '@/lib/prisma'
import { resolveRequiredTaskLocale } from '@/lib/task/resolve-locale'
import { submitTask } from '@/lib/task/submitter'
import { TASK_TYPE } from '@/lib/task/types'

function cleanText(value: unknown, max: number) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function cleanStringArray(value: unknown) {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value
    .map((item) => cleanText(item, 191))
    .filter(Boolean)))
    .slice(0, 24)
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
  const nodeId = cleanText(body?.nodeId, 191)
  const prompt = cleanText(body?.prompt, 20_000)
  const count = Math.max(4, Math.min(8, Math.floor(Number(body?.count) || 4)))
  if (!nodeId || !prompt) throw new ApiError('INVALID_PARAMS', { message: '节点与剧情描述不能为空。' })
  const node = await prisma.canvasNode.findFirst({ where: { id: nodeId, canvasId, type: 'image' }, select: { id: true } })
  if (!node) throw new ApiError('NOT_FOUND')

  const config = await getProjectModelConfig(projectId, authResult.session.user.id)
  if (!config.analysisModel) throw new ApiError('INVALID_PARAMS', { message: '请先在服务配置中设置文本分析模型。' })
  const imageModelKey = cleanText(body?.modelKey, 240) || config.storyboardModel
  if (!imageModelKey) throw new ApiError('INVALID_PARAMS', { message: '请先选择故事版图片模型。' })
  let imageOptions: ReturnType<typeof normalizeCanvasImageGenerationOptions>
  try {
    imageOptions = normalizeCanvasImageGenerationOptions({
      aspectRatio: body?.aspectRatio,
      resolution: body?.resolution,
      quality: body?.quality,
    })
    await resolveProjectModelCapabilityGenerationOptions({
      projectId,
      userId: authResult.session.user.id,
      modelType: 'image',
      modelKey: imageModelKey,
      runtimeSelections: { resolution: imageOptions.resolution },
    })
  } catch (error) {
    throw new ApiError('INVALID_PARAMS', {
      message: error instanceof Error ? error.message : '当前图片模型不支持这组故事版参数。',
    })
  }
  const payload: CanvasStoryboardPlanTaskPayload = {
    kind: 'storyboard_plan',
    canvasId,
    nodeId,
    prompt,
    count,
    analysisModel: config.analysisModel,
    imageRequest: {
      modelKey: imageModelKey,
      modelLabel: cleanText(body?.modelLabel, 240) || null,
      referenceNodeIds: cleanStringArray(body?.referenceNodeIds),
      referenceMaterialIds: cleanStringArray(body?.referenceMaterialIds),
      inputMode: body?.inputMode === 'image' ? 'image' : 'text',
      aspectRatio: imageOptions.aspectRatio,
      resolution: imageOptions.resolution,
      quality: imageOptions.quality,
    },
    maxInputTokens: 8_000,
    maxOutputTokens: 5_000,
    retryOf: null,
  }
  const submitResult = await submitTask({
    userId: authResult.session.user.id,
    locale: resolveRequiredTaskLocale(request, body),
    requestId: getRequestId(request),
    projectId,
    type: TASK_TYPE.CANVAS_STORYBOARD_PLAN,
    targetType: 'CanvasNode',
    targetId: nodeId,
    payload,
    dedupeKey: buildCanvasGenerationDedupeKey(TASK_TYPE.CANVAS_STORYBOARD_PLAN, payload),
  })
  const bound = await bindCanvasGenerationTaskToNode({
    projectId,
    taskId: submitResult.taskId,
    runId: submitResult.runId,
    payload,
  })
  if (!bound) throw new ApiError('CONFLICT', { message: '故事版节点已被删除或类型已改变。' })
  const task = await findCanvasGenerationTask({
    taskId: submitResult.taskId,
    projectId,
    canvasId,
    nodeId,
  })
  if (!task) throw new ApiError('INTERNAL_ERROR', { message: '故事版规划任务创建后无法读取。' })
  return NextResponse.json({
    success: true,
    async: true,
    taskId: task.id,
    runId: submitResult.runId,
    task: serializeCanvasGenerationTask(task),
    links: canvasGenerationTaskLinks(projectId, canvasId, task.id),
  }, { status: 202 })
})
