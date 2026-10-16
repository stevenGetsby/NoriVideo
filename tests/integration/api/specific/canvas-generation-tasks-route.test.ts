import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_TYPE } from '@/lib/task/types'
import { buildMockRequest } from '../../../helpers/request'

type TaskRow = ReturnType<typeof taskRow>

const state = vi.hoisted(() => ({
  nextTask: 1,
  tasks: new Map<string, Record<string, unknown>>(),
}))
const submitTaskMock = vi.hoisted(() => vi.fn())
const cancelTaskMock = vi.hoisted(() => vi.fn())
const removeTaskJobMock = vi.hoisted(() => vi.fn(async () => true))
const publishTaskEventMock = vi.hoisted(() => vi.fn(async () => undefined))
const requireProjectAuthLightMock = vi.hoisted(() => vi.fn(async (projectId: string) => ({
  session: { user: { id: 'user-1', name: '测试用户' } },
  project: { id: projectId, userId: 'user-1' },
})))
const prismaMock = vi.hoisted(() => ({
  canvasNode: {
    findFirst: vi.fn(async () => ({ id: 'node-1', data: { title: '画布节点', generation: {} } })),
    updateMany: vi.fn(async () => ({ count: 1 })),
  },
  task: {
    findFirst: vi.fn(async ({ where }: { where: { id?: string } }) => (
      where.id ? state.tasks.get(where.id) || null : null
    )),
    findMany: vi.fn(async ({ where }: { where?: { targetId?: string } } = {}) => (
      Array.from(state.tasks.values())
        .filter((task) => !where?.targetId || task.targetId === where.targetId)
        .reverse()
    )),
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/api-auth', () => ({
  requireProjectAuthLight: requireProjectAuthLightMock,
  isErrorResponse: (value: unknown) => value instanceof Response,
}))
vi.mock('@/lib/canvas/access', () => ({ requireCanvasInProject: vi.fn(async () => ({ id: 'canvas-1' })) }))
vi.mock('@/lib/config-service', () => ({
  getProjectModelConfig: vi.fn(async () => ({
    analysisModel: 'openai::gpt-5',
    storyboardModel: 'volcengine::seedream-4',
  })),
  resolveProjectModelCapabilityGenerationOptions: vi.fn(async ({ runtimeSelections }: { runtimeSelections?: Record<string, unknown> }) => runtimeSelections || {}),
}))
vi.mock('@/lib/task/submitter', () => ({ submitTask: submitTaskMock }))
vi.mock('@/lib/task/resolve-locale', () => ({
  resolveRequiredTaskLocale: vi.fn(() => 'zh'),
  resolveTaskLocaleFromBody: vi.fn(() => 'zh'),
}))
vi.mock('@/lib/task/service', () => ({ cancelTask: cancelTaskMock }))
vi.mock('@/lib/task/queues', () => ({ removeTaskJob: removeTaskJobMock }))
vi.mock('@/lib/task/publisher', () => ({ publishTaskEvent: publishTaskEventMock }))

import { POST as createTextTask } from '@/app/api/projects/[projectId]/canvas/[canvasId]/generate-text/route'
import { POST as createStoryboardTask } from '@/app/api/projects/[projectId]/canvas/[canvasId]/generate-storyboard/route'
import { GET as getLatestTask } from '@/app/api/projects/[projectId]/canvas/[canvasId]/generation-tasks/route'
import { GET as getTask, DELETE as cancelTaskRoute } from '@/app/api/projects/[projectId]/canvas/[canvasId]/generation-tasks/[taskId]/route'
import { POST as retryTask } from '@/app/api/projects/[projectId]/canvas/[canvasId]/generation-tasks/[taskId]/retry/route'

function taskRow(params: {
  id: string
  type: string
  payload: Record<string, unknown>
  status?: string
  errorCode?: string | null
  errorMessage?: string | null
  billingInfo?: Record<string, unknown>
}) {
  const status = params.status || 'queued'
  return {
    id: params.id,
    userId: 'user-1',
    projectId: 'project-1',
    episodeId: null,
    type: params.type,
    targetType: 'CanvasNode',
    targetId: 'node-1',
    status,
    progress: status === 'completed' ? 100 : 0,
    attempt: status === 'queued' ? 0 : 1,
    maxAttempts: 5,
    priority: 0,
    dedupeKey: null,
    externalId: null,
    payload: params.payload,
    result: status === 'completed'
      ? (params.type === TASK_TYPE.CANVAS_TEXT_GENERATION
        ? { text: '生成正文' }
        : { shots: [{ index: 1, title: '镜头 1', prompt: '镜头提示词' }] })
      : null,
    errorCode: params.errorCode ?? null,
    errorMessage: params.errorMessage ?? null,
    billingInfo: params.billingInfo ?? null,
    billedAt: null,
    queuedAt: new Date('2026-07-17T00:00:00.000Z'),
    startedAt: status === 'queued' ? null : new Date('2026-07-17T00:00:01.000Z'),
    finishedAt: ['completed', 'failed', 'canceled'].includes(status) ? new Date('2026-07-17T00:00:02.000Z') : null,
    heartbeatAt: null,
    enqueuedAt: new Date('2026-07-17T00:00:00.000Z'),
    enqueueAttempts: 0,
    lastEnqueueError: null,
    createdAt: new Date('2026-07-17T00:00:00.000Z'),
    updatedAt: new Date('2026-07-17T00:00:02.000Z'),
  }
}

const canvasContext = { params: Promise.resolve({ projectId: 'project-1', canvasId: 'canvas-1' }) }
function taskContext(taskId: string) {
  return { params: Promise.resolve({ projectId: 'project-1', canvasId: 'canvas-1', taskId }) }
}

describe('canvas persistent generation task routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.tasks.clear()
    state.nextTask = 1
    submitTaskMock.mockImplementation(async (params: {
      type: string
      targetId: string
      payload: Record<string, unknown>
    }) => {
      const id = `task-${state.nextTask++}`
      state.tasks.set(id, taskRow({
        id,
        type: params.type,
        payload: { ...params.payload, meta: { locale: 'zh' } },
      }))
      return { success: true, async: true, taskId: id, runId: `run-${id}`, status: 'queued', deduped: false }
    })
    cancelTaskMock.mockImplementation(async (taskId: string) => {
      const current = state.tasks.get(taskId) as TaskRow | undefined
      if (!current) return { task: null, cancelled: false }
      const updated = { ...current, status: 'canceled', errorCode: 'TASK_CANCELLED', errorMessage: 'Canvas generation cancelled by user' }
      state.tasks.set(taskId, updated)
      return { task: updated, cancelled: true }
    })
  })

  it('queues text generation, binds the node, and returns HTTP 202', async () => {
    const response = await createTextTask(buildMockRequest({
      path: '/api/projects/project-1/canvas/canvas-1/generate-text',
      method: 'POST',
      headers: { 'accept-language': 'zh' },
      body: { nodeId: 'node-1', prompt: '续写这场戏', modelKey: 'openai::gpt-5' },
    }), canvasContext)
    const payload = await response.json() as Record<string, unknown>

    expect(response.status).toBe(202)
    expect(submitTaskMock).toHaveBeenCalledWith(expect.objectContaining({
      type: TASK_TYPE.CANVAS_TEXT_GENERATION,
      targetType: 'CanvasNode',
      targetId: 'node-1',
      payload: expect.objectContaining({
        canvasId: 'canvas-1',
        nodeId: 'node-1',
        prompt: '续写这场戏',
        analysisModel: 'openai::gpt-5',
      }),
    }))
    expect(prismaMock.canvasNode.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'RUNNING', taskId: 'task-1', runId: 'run-task-1' }),
    }))
    expect(payload).toMatchObject({ success: true, async: true, taskId: 'task-1', runId: 'run-task-1' })
  })

  it('queues storyboard planning with all downstream image-generation inputs', async () => {
    const response = await createStoryboardTask(buildMockRequest({
      path: '/api/projects/project-1/canvas/canvas-1/generate-storyboard',
      method: 'POST',
      headers: { 'accept-language': 'zh' },
      body: {
        nodeId: 'node-1',
        prompt: '女孩走进雨夜车站',
        count: 4,
        modelKey: 'volcengine::seedream-4',
        modelLabel: 'Seedream 4',
        referenceNodeIds: ['ref-1'],
        referenceMaterialIds: ['material-1'],
        inputMode: 'image',
        aspectRatio: '9:16',
        resolution: '2k',
        quality: 'medium',
      },
    }), canvasContext)

    expect(response.status).toBe(202)
    expect(submitTaskMock).toHaveBeenCalledWith(expect.objectContaining({
      type: TASK_TYPE.CANVAS_STORYBOARD_PLAN,
      payload: expect.objectContaining({
        count: 4,
        analysisModel: 'openai::gpt-5',
        imageRequest: {
          modelKey: 'volcengine::seedream-4',
          modelLabel: 'Seedream 4',
          referenceNodeIds: ['ref-1'],
          referenceMaterialIds: ['material-1'],
          inputMode: 'image',
          aspectRatio: '9:16',
          resolution: '2K',
          quality: 'medium',
        },
      }),
    }))
  })

  it('recovers the latest task and exposes terminal result/error state', async () => {
    const payload = {
      canvasId: 'canvas-1',
      nodeId: 'node-1',
      prompt: '续写',
      modelKey: 'openai::gpt-5',
      analysisModel: 'openai::gpt-5',
    }
    state.tasks.set('task-complete', taskRow({
      id: 'task-complete', type: TASK_TYPE.CANVAS_TEXT_GENERATION, payload, status: 'completed',
      billingInfo: { billable: true, chargedCost: 0.1234 },
    }))
    const latestResponse = await getLatestTask(buildMockRequest({
      path: '/api/projects/project-1/canvas/canvas-1/generation-tasks',
      method: 'GET',
      query: { nodeId: 'node-1' },
    }), canvasContext)
    const latest = await latestResponse.json() as { task: Record<string, unknown> }
    expect(latest.task).toMatchObject({ id: 'task-complete', status: 'completed', result: { text: '生成正文' }, cost: { costCny: 0.1234, points: 12.34 } })

    state.tasks.set('task-failed', taskRow({
      id: 'task-failed', type: TASK_TYPE.CANVAS_TEXT_GENERATION, payload, status: 'failed',
      errorCode: 'EXTERNAL_ERROR', errorMessage: 'provider timeout',
    }))
    const failedResponse = await getTask(buildMockRequest({
      path: '/api/projects/project-1/canvas/canvas-1/generation-tasks/task-failed',
      method: 'GET',
    }), taskContext('task-failed'))
    const failed = await failedResponse.json() as { task: Record<string, unknown> }
    expect(failed.task).toMatchObject({
      status: 'failed',
      canRetry: true,
      error: { code: 'EXTERNAL_ERROR', message: 'provider timeout', retryable: true },
    })
  })

  it('cancels active tasks and retries only a terminal task as a new task', async () => {
    const payload = {
      canvasId: 'canvas-1',
      nodeId: 'node-1',
      prompt: '续写',
      modelKey: 'openai::gpt-5',
      analysisModel: 'openai::gpt-5',
      maxInputTokens: 8000,
      maxOutputTokens: 6000,
      meta: { locale: 'zh' },
    }
    state.tasks.set('task-active', taskRow({
      id: 'task-active', type: TASK_TYPE.CANVAS_TEXT_GENERATION, payload, status: 'processing',
    }))
    const cancelResponse = await cancelTaskRoute(buildMockRequest({
      path: '/api/projects/project-1/canvas/canvas-1/generation-tasks/task-active',
      method: 'DELETE',
    }), taskContext('task-active'))
    expect(await cancelResponse.json()).toMatchObject({ cancelled: true, task: { status: 'canceled' } })
    expect(removeTaskJobMock).toHaveBeenCalledWith('task-active')

    state.tasks.set('task-original', taskRow({
      id: 'task-original', type: TASK_TYPE.CANVAS_TEXT_GENERATION, payload, status: 'failed',
    }))
    const retryResponse = await retryTask(buildMockRequest({
      path: '/api/projects/project-1/canvas/canvas-1/generation-tasks/task-original/retry',
      method: 'POST',
      headers: { 'accept-language': 'zh' },
      body: {},
    }), taskContext('task-original'))
    expect(retryResponse.status).toBe(202)
    expect(submitTaskMock).toHaveBeenCalledWith(expect.objectContaining({
      type: TASK_TYPE.CANVAS_TEXT_GENERATION,
      payload: expect.objectContaining({ retryOf: 'task-original' }),
    }))
  })
})
