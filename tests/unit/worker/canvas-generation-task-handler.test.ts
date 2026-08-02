import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'

const executeAiTextStepMock = vi.hoisted(() => vi.fn())
const bindTaskMock = vi.hoisted(() => vi.fn(async () => true))
const reportTaskProgressMock = vi.hoisted(() => vi.fn(async () => undefined))
const assertTaskActiveMock = vi.hoisted(() => vi.fn(async () => undefined))
const flushMock = vi.hoisted(() => vi.fn(async () => undefined))
const materializeStoryboardFanoutMock = vi.hoisted(() => vi.fn(async () => ({
  planningTaskId: 'task-storyboard',
  groupId: 'canvas-storyboard-group-task-storyboard',
  status: 'submitted',
  submittedCount: 4,
  failedCount: 0,
  shots: [],
})))
const FanoutSupersededErrorMock = vi.hoisted(() => class extends Error {})

vi.mock('@/lib/ai-runtime', () => ({ executeAiTextStep: executeAiTextStepMock }))
vi.mock('@/lib/canvas/generation-task', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/canvas/generation-task')>()),
  bindCanvasGenerationTaskToNode: bindTaskMock,
}))
vi.mock('@/lib/llm-observe/internal-stream-context', () => ({
  withInternalLLMStreamCallbacks: vi.fn(async (_callbacks, run: () => Promise<unknown>) => await run()),
}))
vi.mock('@/lib/workers/handlers/llm-stream', () => ({
  createWorkerLLMStreamContext: vi.fn(() => ({ streamRunId: 'stream-1', nextSeqByStepLane: {} })),
  createWorkerLLMStreamCallbacks: vi.fn(() => ({ flush: flushMock })),
}))
vi.mock('@/lib/workers/shared', () => ({ reportTaskProgress: reportTaskProgressMock }))
vi.mock('@/lib/workers/utils', () => ({ assertTaskActive: assertTaskActiveMock }))
vi.mock('@/lib/canvas/storyboard-fanout', () => ({
  CanvasStoryboardFanoutSupersededError: FanoutSupersededErrorMock,
  materializeCanvasStoryboardFanout: materializeStoryboardFanoutMock,
}))

import { handleCanvasGenerationTask } from '@/lib/workers/handlers/canvas-generation-task-handler'

function job(type: TaskJobData['type'], payload: Record<string, unknown>): Job<TaskJobData> {
  return {
    data: {
      taskId: type === TASK_TYPE.CANVAS_TEXT_GENERATION ? 'task-text' : 'task-storyboard',
      type,
      locale: 'zh',
      projectId: 'project-1',
      targetType: 'CanvasNode',
      targetId: 'node-1',
      payload: {
        canvasId: 'canvas-1',
        nodeId: 'node-1',
        prompt: '雨夜里，女孩推开废弃车站的大门。',
        maxInputTokens: 8_000,
        maxOutputTokens: 5_000,
        retryOf: null,
        ...payload,
      },
      userId: 'user-1',
    },
  } as unknown as Job<TaskJobData>
}

describe('canvas generation task handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    bindTaskMock.mockResolvedValue(true)
  })

  it('generates text and returns a durable task result', async () => {
    executeAiTextStepMock.mockResolvedValue({ text: '  可直接使用的正文  ', reasoning: '', usage: {} })
    const taskJob = job(TASK_TYPE.CANVAS_TEXT_GENERATION, {
      kind: 'text',
      modelKey: 'openai::gpt-5',
      analysisModel: 'openai::gpt-5',
    })

    const result = await handleCanvasGenerationTask(taskJob)

    expect(bindTaskMock).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-1',
      taskId: 'task-text',
      payload: expect.objectContaining({ kind: 'text', nodeId: 'node-1' }),
    }))
    expect(executeAiTextStepMock).toHaveBeenCalledWith(expect.objectContaining({
      model: 'openai::gpt-5',
      action: 'canvas-text-generation',
      reasoning: false,
    }))
    expect(result).toMatchObject({
      kind: 'text',
      nodeId: 'node-1',
      text: '可直接使用的正文',
    })
    expect(reportTaskProgressMock).toHaveBeenCalledWith(taskJob, 96, expect.objectContaining({
      stage: 'canvas_text_done',
    }))
    expect(flushMock).toHaveBeenCalled()
  })

  it('rejects an empty text completion as a retryable external result failure', async () => {
    executeAiTextStepMock.mockResolvedValue({ text: '   ', reasoning: '', usage: {} })
    const taskJob = job(TASK_TYPE.CANVAS_TEXT_GENERATION, {
      kind: 'text',
      modelKey: 'openai::gpt-5',
      analysisModel: 'openai::gpt-5',
    })

    await expect(handleCanvasGenerationTask(taskJob)).rejects.toMatchObject({
      code: 'EXTERNAL_ERROR',
      retryable: true,
    })
  })

  it('parses an exact-count storyboard plan and preserves downstream image input', async () => {
    const shots = Array.from({ length: 4 }, (_, index) => ({
      index: index + 1,
      title: `镜头 ${index + 1}`,
      prompt: `中景，雨夜废弃车站，女孩向前移动，电影光影与连续构图细节 ${index + 1}，保持人物服装环境一致。`,
    }))
    executeAiTextStepMock.mockResolvedValue({ text: JSON.stringify({ shots }), reasoning: '', usage: {} })
    const taskJob = job(TASK_TYPE.CANVAS_STORYBOARD_PLAN, {
      kind: 'storyboard_plan',
      count: 4,
      analysisModel: 'openai::gpt-5',
      imageRequest: {
        modelKey: 'volcengine::seedream-4',
        modelLabel: 'Seedream 4',
        referenceNodeIds: ['ref-node'],
        referenceMaterialIds: ['material-1'],
        inputMode: 'image',
        aspectRatio: '16:9',
        resolution: '2k',
      },
    })

    const result = await handleCanvasGenerationTask(taskJob)

    expect(executeAiTextStepMock).toHaveBeenCalledWith(expect.objectContaining({
      model: 'openai::gpt-5',
      action: 'canvas-storyboard-plan',
    }))
    expect(result).toMatchObject({
      kind: 'storyboard_plan',
      imageRequest: { modelKey: 'volcengine::seedream-4', resolution: '2K', quality: 'high' },
      shots: expect.arrayContaining([expect.objectContaining({ index: 1, title: '镜头 1' })]),
      fanout: { submittedCount: 4, failedCount: 0 },
    })
    expect(materializeStoryboardFanoutMock).toHaveBeenCalledWith(expect.objectContaining({
      planningTaskId: 'task-storyboard',
      projectId: 'project-1',
      userId: 'user-1',
      payload: expect.objectContaining({ kind: 'storyboard_plan' }),
      shots: expect.arrayContaining([expect.objectContaining({ index: 1 })]),
    }))
  })

  it('finishes an old planning worker as superseded when a newer source binding wins', async () => {
    const shots = Array.from({ length: 4 }, (_, index) => ({
      index: index + 1,
      title: `镜头 ${index + 1}`,
      prompt: `中景，雨夜废弃车站，女孩向前奔跑并回头观察追踪者，镜头保持连续动作、人物服装、环境陈设与电影光影一致 ${index + 1}。`,
    }))
    executeAiTextStepMock.mockResolvedValue({ text: JSON.stringify({ shots }), reasoning: '', usage: {} })
    materializeStoryboardFanoutMock.mockRejectedValueOnce(new FanoutSupersededErrorMock())
    const taskJob = job(TASK_TYPE.CANVAS_STORYBOARD_PLAN, {
      kind: 'storyboard_plan',
      count: 4,
      analysisModel: 'openai::gpt-5',
      imageRequest: {
        modelKey: 'volcengine::seedream-4',
        referenceNodeIds: [],
        referenceMaterialIds: [],
        inputMode: 'text',
        aspectRatio: '16:9',
        resolution: '2K',
      },
    })

    await expect(handleCanvasGenerationTask(taskJob)).resolves.toMatchObject({
      kind: 'storyboard_plan',
      nodeId: 'node-1',
      superseded: true,
    })
    expect(reportTaskProgressMock).not.toHaveBeenCalledWith(
      taskJob,
      96,
      expect.anything(),
    )
  })

  it('treats malformed storyboard output as a retryable provider failure', async () => {
    executeAiTextStepMock.mockResolvedValue({ text: '{"shots":[]}', reasoning: '', usage: {} })
    const taskJob = job(TASK_TYPE.CANVAS_STORYBOARD_PLAN, {
      kind: 'storyboard_plan',
      count: 4,
      analysisModel: 'openai::gpt-5',
      imageRequest: {
        modelKey: 'volcengine::seedream-4',
        referenceNodeIds: [],
        referenceMaterialIds: [],
        inputMode: 'text',
        aspectRatio: '16:9',
        resolution: '',
      },
    })

    await expect(handleCanvasGenerationTask(taskJob)).rejects.toMatchObject({
      code: 'EXTERNAL_ERROR',
      retryable: true,
    })
  })

  it('rejects a mismatched task target before calling the model', async () => {
    const taskJob = job(TASK_TYPE.CANVAS_TEXT_GENERATION, {
      kind: 'text',
      modelKey: 'openai::gpt-5',
      analysisModel: 'openai::gpt-5',
    })
    taskJob.data.targetId = 'another-node'

    await expect(handleCanvasGenerationTask(taskJob)).rejects.toMatchObject({ code: 'INVALID_PARAMS' })
    expect(executeAiTextStepMock).not.toHaveBeenCalled()
  })
})
