import type { Job } from 'bullmq'
import { executeAiTextStep } from '@/lib/ai-runtime'
import {
  bindCanvasGenerationTaskToNode,
  parseCanvasGenerationTaskPayload,
} from '@/lib/canvas/generation-task'
import {
  CanvasStoryboardFanoutSupersededError,
  materializeCanvasStoryboardFanout,
} from '@/lib/canvas/storyboard-fanout'
import { canvasStoryboardSystemPrompt, parseCanvasStoryboardPlan } from '@/lib/canvas/storyboard-plan'
import { withInternalLLMStreamCallbacks } from '@/lib/llm-observe/internal-stream-context'
import type { TaskJobData } from '@/lib/task/types'
import { reportTaskProgress } from '@/lib/workers/shared'
import { assertTaskActive } from '@/lib/workers/utils'
import { createWorkerLLMStreamCallbacks, createWorkerLLMStreamContext } from './llm-stream'

function taskInputError(message: string) {
  return Object.assign(new Error(message), { code: 'INVALID_PARAMS', retryable: false })
}

function externalResultError(message: string) {
  return Object.assign(new Error(message), { code: 'EXTERNAL_ERROR', retryable: true })
}

function runIdFromPayload(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const runId = (value as Record<string, unknown>).runId
  return typeof runId === 'string' && runId.trim() ? runId.trim() : null
}

export async function handleCanvasGenerationTask(job: Job<TaskJobData>) {
  const payload = parseCanvasGenerationTaskPayload(job.data.type, job.data.payload)
  if (!payload) throw taskInputError('Canvas generation task payload is invalid')
  if (job.data.targetType !== 'CanvasNode' || job.data.targetId !== payload.nodeId) {
    throw taskInputError('Canvas generation task target does not match payload')
  }

  await assertTaskActive(job, 'canvas_generation_prepare')
  const bound = await bindCanvasGenerationTaskToNode({
    projectId: job.data.projectId,
    taskId: job.data.taskId,
    runId: runIdFromPayload(job.data.payload),
    payload,
    onlyIfUnboundOrSame: true,
  })
  if (!bound) {
    return {
      kind: payload.kind,
      canvasId: payload.canvasId,
      nodeId: payload.nodeId,
      superseded: true,
    }
  }

  if (payload.kind === 'text') {
    await reportTaskProgress(job, 15, {
      stage: 'canvas_text_prepare',
      displayMode: 'loading',
    })
    await assertTaskActive(job, 'canvas_text_generate')
    await reportTaskProgress(job, 35, {
      stage: 'canvas_text_generate',
      displayMode: 'detail',
    })

    const streamContext = createWorkerLLMStreamContext(job, 'canvas_text')
    const streamCallbacks = createWorkerLLMStreamCallbacks(job, streamContext)
    const completion = await withInternalLLMStreamCallbacks(
      streamCallbacks,
      async () => await executeAiTextStep({
        userId: job.data.userId,
        model: payload.modelKey,
        messages: [
          {
            role: 'system',
            content: '你是影视创作无限画布中的文本生成助手。严格完成用户要求，直接输出可使用的正文，不解释过程，不添加 Markdown 代码围栏。',
          },
          { role: 'user', content: payload.prompt },
        ],
        projectId: job.data.projectId,
        action: 'canvas-text-generation',
        reasoning: false,
        maxTokens: payload.maxOutputTokens,
        meta: {
          stepId: 'canvas_text_generate',
          stepTitle: '画布文本生成',
          stepIndex: 1,
          stepTotal: 1,
        },
      }),
    )
    await streamCallbacks.flush()
    await assertTaskActive(job, 'canvas_text_done')

    const text = completion.text.trim()
    if (!text) throw externalResultError('文本模型没有返回可用内容。')
    await reportTaskProgress(job, 96, {
      stage: 'canvas_text_done',
      displayMode: 'loading',
    })
    return {
      kind: payload.kind,
      canvasId: payload.canvasId,
      nodeId: payload.nodeId,
      modelKey: payload.modelKey,
      text,
    }
  }

  await reportTaskProgress(job, 15, {
    stage: 'canvas_storyboard_prepare',
    displayMode: 'loading',
  })
  await assertTaskActive(job, 'canvas_storyboard_plan')
  await reportTaskProgress(job, 35, {
    stage: 'canvas_storyboard_plan',
    displayMode: 'detail',
  })

  const streamContext = createWorkerLLMStreamContext(job, 'canvas_storyboard')
  const streamCallbacks = createWorkerLLMStreamCallbacks(job, streamContext)
  const completion = await withInternalLLMStreamCallbacks(
    streamCallbacks,
    async () => await executeAiTextStep({
      userId: job.data.userId,
      model: payload.analysisModel,
      messages: [
        { role: 'system', content: canvasStoryboardSystemPrompt(payload.count) },
        { role: 'user', content: `剧情片段：\n${payload.prompt}` },
      ],
      projectId: job.data.projectId,
      action: 'canvas-storyboard-plan',
      reasoning: false,
      maxTokens: payload.maxOutputTokens,
      meta: {
        stepId: 'canvas_storyboard_plan',
        stepTitle: '连续故事版规划',
        stepIndex: 1,
        stepTotal: 1,
      },
    }),
  )
  await streamCallbacks.flush()
  await assertTaskActive(job, 'canvas_storyboard_done')

  const raw = completion.text.trim()
  if (!raw) throw externalResultError('文本模型没有返回分镜规划。')
  let shots: ReturnType<typeof parseCanvasStoryboardPlan>
  try {
    shots = parseCanvasStoryboardPlan(raw, payload.count)
  } catch (error) {
    throw externalResultError(error instanceof Error ? error.message : '分镜规划格式无效')
  }
  await assertTaskActive(job, 'canvas_storyboard_fanout')
  await reportTaskProgress(job, 72, {
    stage: 'canvas_storyboard_fanout',
    displayMode: 'detail',
    shotCount: shots.length,
  })
  let fanout: Awaited<ReturnType<typeof materializeCanvasStoryboardFanout>>
  try {
    fanout = await materializeCanvasStoryboardFanout({
      planningTaskId: job.data.taskId,
      userId: job.data.userId,
      projectId: job.data.projectId,
      locale: job.data.locale,
      requestId: job.data.trace?.requestId,
      payload,
      shots,
    })
  } catch (error) {
    if (error instanceof CanvasStoryboardFanoutSupersededError) {
      return {
        kind: payload.kind,
        canvasId: payload.canvasId,
        nodeId: payload.nodeId,
        superseded: true,
      }
    }
    throw error
  }
  await reportTaskProgress(job, 96, {
    stage: 'canvas_storyboard_done',
    displayMode: 'loading',
    shotCount: shots.length,
    submittedCount: fanout.submittedCount,
    failedCount: fanout.failedCount,
  })
  return {
    kind: payload.kind,
    canvasId: payload.canvasId,
    nodeId: payload.nodeId,
    modelKey: payload.analysisModel,
    imageRequest: payload.imageRequest,
    shots,
    fanout,
  }
}
