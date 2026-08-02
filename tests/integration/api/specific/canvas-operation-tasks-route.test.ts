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
const registerFrameosMaterialMock = vi.hoisted(() => vi.fn())
const materializeSyncOperationMock = vi.hoisted(() => vi.fn())
const requireProjectAuthLightMock = vi.hoisted(() => vi.fn(async (projectId: string) => ({
  session: { user: { id: 'user-1', name: '测试用户' } },
  project: { id: projectId, userId: 'user-1' },
})))

const prismaMock = vi.hoisted(() => ({
  canvasNode: {
    findFirst: vi.fn(async () => ({
      id: 'node-1',
      data: { title: '源图', materialId: 'material-source-1', imageUrl: 'images/source.jpg' },
    })),
  },
  frameosMaterial: {
    findFirst: vi.fn(async () => ({ storageKey: 'images/source.jpg', resultUrl: null })),
  },
  task: {
    findFirst: vi.fn(async ({ where }: { where: { id?: string } }) => (
      where.id ? state.tasks.get(where.id) || null : null
    )),
    findMany: vi.fn(async () => Array.from(state.tasks.values()).reverse()),
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/api-auth', () => ({
  requireProjectAuthLight: requireProjectAuthLightMock,
  isErrorResponse: (value: unknown) => value instanceof Response,
}))
vi.mock('@/lib/canvas/access', () => ({ requireCanvasInProject: vi.fn(async () => ({ id: 'canvas-1' })) }))
vi.mock('@/lib/task/submitter', () => ({ submitTask: submitTaskMock }))
vi.mock('@/lib/task/resolve-locale', () => ({
  resolveRequiredTaskLocale: vi.fn(() => 'zh'),
  resolveTaskLocaleFromBody: vi.fn(() => 'zh'),
}))
vi.mock('@/lib/task/service', () => ({ cancelTask: cancelTaskMock }))
vi.mock('@/lib/task/queues', () => ({ removeTaskJob: removeTaskJobMock }))
vi.mock('@/lib/task/publisher', () => ({ publishTaskEvent: publishTaskEventMock }))
vi.mock('@/lib/storage', () => ({
  extractStorageKey: vi.fn((value: string | null | undefined) => value || null),
  generateUniqueKey: vi.fn(() => 'generated.jpg'),
  getObjectBuffer: vi.fn(async () => Buffer.from('source')),
  uploadObject: vi.fn(async () => undefined),
}))
vi.mock('@/lib/frameos/material-service', () => ({ registerFrameosMaterial: registerFrameosMaterialMock }))
vi.mock('@/lib/canvas/image-operations', () => ({
  splitCanvasImage: vi.fn(async () => ([
    { row: 0, col: 0, width: 640, height: 360, body: Buffer.from('tile-1') },
    { row: 0, col: 1, width: 640, height: 360, body: Buffer.from('tile-2') },
  ])),
  cropCanvasImage: vi.fn(async () => ({ row: 0, col: 0, width: 320, height: 180, body: Buffer.from('crop') })),
}))
vi.mock('@/lib/canvas/sync-operation-output-nodes', () => ({
  materializeCanvasSyncImageOperation: materializeSyncOperationMock,
}))

import { GET as getOperations, POST as createOperation } from '@/app/api/projects/[projectId]/canvas/[canvasId]/operations/route'
import { GET as getTask, DELETE as cancelTaskRoute } from '@/app/api/projects/[projectId]/canvas/[canvasId]/operations/tasks/[taskId]/route'
import { POST as retryTask } from '@/app/api/projects/[projectId]/canvas/[canvasId]/operations/tasks/[taskId]/retry/route'

function taskRow(params: {
  id: string
  status?: string
  type?: string
  operation?: 'superresolve' | 'video_superresolve' | 'subtitle_erase'
  payload?: Record<string, unknown>
  errorCode?: string | null
  errorMessage?: string | null
}) {
  const operation = params.operation || 'superresolve'
  const image = operation === 'superresolve'
  return {
    id: params.id,
    userId: 'user-1',
    projectId: 'project-1',
    episodeId: null,
    type: params.type || (image ? TASK_TYPE.CANVAS_IMAGE_OPERATION : TASK_TYPE.CANVAS_VIDEO_OPERATION),
    targetType: 'CanvasNode',
    targetId: 'node-1',
    status: params.status || 'queued',
    progress: params.status === 'completed' ? 100 : 0,
    attempt: params.status === 'queued' ? 0 : 1,
    maxAttempts: 1,
    priority: 0,
    dedupeKey: null,
    externalId: null,
    payload: params.payload || {
      canvasId: 'canvas-1',
      sourceNodeId: 'node-1',
      sourceStorageKey: image ? 'images/source.jpg' : 'video/source.mp4',
      sourceTitle: image ? '源图' : '源视频',
      operation,
      engineKey: image ? 'local-sharp' : 'local-ffmpeg',
      modelKey: image ? 'local-sharp' : 'local-ffmpeg',
      parameters: image ? { scale: 2 } : { target: '1080p', interpolate: false },
      meta: { locale: 'zh' },
    },
    result: params.status === 'completed' ? { operation, results: [{ materialId: 'material-1', url: 'result' }] } : null,
    errorCode: params.errorCode ?? null,
    errorMessage: params.errorMessage ?? null,
    billingInfo: null,
    billedAt: null,
    queuedAt: new Date('2026-07-17T00:00:00.000Z'),
    startedAt: params.status === 'queued' ? null : new Date('2026-07-17T00:00:01.000Z'),
    finishedAt: ['completed', 'failed', 'canceled'].includes(params.status || '') ? new Date('2026-07-17T00:00:02.000Z') : null,
    heartbeatAt: null,
    enqueuedAt: new Date('2026-07-17T00:00:00.000Z'),
    enqueueAttempts: 0,
    lastEnqueueError: null,
    createdAt: new Date('2026-07-17T00:00:00.000Z'),
    updatedAt: new Date('2026-07-17T00:00:02.000Z'),
  }
}

const operationsContext = { params: Promise.resolve({ projectId: 'project-1', canvasId: 'canvas-1' }) }
function taskContext(taskId: string) {
  return { params: Promise.resolve({ projectId: 'project-1', canvasId: 'canvas-1', taskId }) }
}

describe('canvas asynchronous operation routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.tasks.clear()
    state.nextTask = 1
    registerFrameosMaterialMock.mockReset()
    materializeSyncOperationMock.mockReset()
    registerFrameosMaterialMock
      .mockResolvedValueOnce({ id: 'material-tile-1', title: '源图 · 1-1', resultUrl: 'tiles/1.jpg', storageKey: 'generated-1.jpg' })
      .mockResolvedValueOnce({ id: 'material-tile-2', title: '源图 · 1-2', resultUrl: 'tiles/2.jpg', storageKey: 'generated-2.jpg' })
    materializeSyncOperationMock.mockResolvedValue({
      materialized: true,
      outputNodeIds: ['output-1', 'output-2'],
      canvasRevision: 7,
      reason: 'created',
    })
    submitTaskMock.mockImplementation(async (params: {
      type: string
      targetId: string
      payload: Record<string, unknown>
    }) => {
      const id = `task-${state.nextTask++}`
      state.tasks.set(id, taskRow({ id, type: params.type, payload: { ...params.payload, meta: { locale: 'zh' } } }))
      return { success: true, async: true, taskId: id, runId: null, status: 'queued', deduped: false }
    })
    cancelTaskMock.mockImplementation(async (taskId: string) => {
      const current = state.tasks.get(taskId) as TaskRow | undefined
      if (!current) return { task: null, cancelled: false }
      const updated = { ...current, status: 'canceled', errorCode: 'TASK_CANCELLED', errorMessage: 'Canvas operation cancelled by user' }
      state.tasks.set(taskId, updated)
      return { task: updated, cancelled: true }
    })
  })

  it('returns the engine catalog and the latest scoped task for refresh recovery', async () => {
    state.tasks.set('task-complete', taskRow({ id: 'task-complete', status: 'completed' }))
    const response = await getOperations(buildMockRequest({
      path: '/api/projects/project-1/canvas/canvas-1/operations',
      method: 'GET',
      query: { sourceNodeId: 'node-1', operation: 'superresolve' },
    }), operationsContext)
    const payload = await response.json() as Record<string, unknown>

    expect(response.status).toBe(200)
    expect(payload.engines).toEqual(expect.arrayContaining([
      expect.objectContaining({ operation: 'superresolve', engineKey: 'local-sharp' }),
      expect.objectContaining({ operation: 'video_superresolve', engineKey: 'local-ffmpeg' }),
    ]))
    expect(payload.latestTask).toEqual(expect.objectContaining({ id: 'task-complete', status: 'completed' }))
    expect(payload.links).toEqual(expect.objectContaining({ retry: expect.stringContaining('/task-complete/retry') }))
    expect(prismaMock.task.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        userId: 'user-1',
        projectId: 'project-1',
        targetType: 'CanvasNode',
        targetId: 'node-1',
      }),
      orderBy: { createdAt: 'desc' },
    }))
  })

  it('creates image superresolve as a persistent queued task and returns HTTP 202', async () => {
    const response = await createOperation(buildMockRequest({
      path: '/api/projects/project-1/canvas/canvas-1/operations',
      method: 'POST',
      headers: { 'accept-language': 'zh' },
      body: { sourceNodeId: 'node-1', operation: 'superresolve', scale: 2, modelKey: 'local-sharp' },
    }), operationsContext)
    const payload = await response.json() as Record<string, unknown>

    expect(response.status).toBe(202)
    expect(submitTaskMock).toHaveBeenCalledWith(expect.objectContaining({
      type: TASK_TYPE.CANVAS_IMAGE_OPERATION,
      targetType: 'CanvasNode',
      targetId: 'node-1',
      maxAttempts: 1,
      payload: expect.objectContaining({
        sourceStorageKey: 'images/source.jpg',
        operation: 'superresolve',
        engineKey: 'local-sharp',
        parameters: { scale: 2 },
      }),
    }))
    expect(payload).toMatchObject({ success: true, async: true, taskId: 'task-1', engineKey: 'local-sharp' })
    expect(payload.task).toEqual(expect.objectContaining({ id: 'task-1', status: 'queued', canCancel: true }))
  })

  it('persists synchronous grid outputs into the Canvas graph before returning success', async () => {
    const response = await createOperation(buildMockRequest({
      path: '/api/projects/project-1/canvas/canvas-1/operations',
      method: 'POST',
      body: {
        sourceNodeId: 'node-1',
        targetNodeId: 'target-1',
        operationRequestId: 'grid-request-1',
        operation: 'grid_split',
        rows: 1,
        cols: 2,
      },
    }), operationsContext)
    const payload = await response.json() as Record<string, unknown>

    expect(response.status).toBe(200)
    expect(materializeSyncOperationMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      projectId: 'project-1',
      canvasId: 'canvas-1',
      sourceNodeId: 'node-1',
      targetNodeId: 'target-1',
      operationRequestId: 'grid-request-1',
      operation: 'grid_split',
      results: [
        expect.objectContaining({ materialId: 'material-tile-1', url: 'tiles/1.jpg' }),
        expect.objectContaining({ materialId: 'material-tile-2', url: 'tiles/2.jpg' }),
      ],
    }))
    expect(payload).toMatchObject({
      success: true,
      operation: 'grid_split',
      materialization: { materialized: true, canvasRevision: 7 },
    })
  })

  it('reports failure details and cancels active tasks through the scoped endpoint', async () => {
    state.tasks.set('task-failed', taskRow({
      id: 'task-failed',
      status: 'failed',
      errorCode: 'INTERNAL_ERROR',
      errorMessage: 'ffmpeg failed',
    }))
    const failedResponse = await getTask(buildMockRequest({
      path: '/api/projects/project-1/canvas/canvas-1/operations/tasks/task-failed',
      method: 'GET',
    }), taskContext('task-failed'))
    const failedPayload = await failedResponse.json() as { task: Record<string, unknown> }
    expect(failedPayload.task.error).toEqual(expect.objectContaining({ code: 'INTERNAL_ERROR', message: 'ffmpeg failed' }))
    expect(failedPayload.task.canRetry).toBe(true)

    state.tasks.set('task-active', taskRow({ id: 'task-active', status: 'processing' }))
    const cancelResponse = await cancelTaskRoute(buildMockRequest({
      path: '/api/projects/project-1/canvas/canvas-1/operations/tasks/task-active',
      method: 'DELETE',
    }), taskContext('task-active'))
    const cancelPayload = await cancelResponse.json() as { cancelled: boolean; task: { status: string } }
    expect(cancelPayload).toMatchObject({ cancelled: true, task: { status: 'canceled' } })
    expect(removeTaskJobMock).toHaveBeenCalledWith('task-active')
    expect(publishTaskEventMock).toHaveBeenCalledWith(expect.objectContaining({ taskId: 'task-active' }))
  })

  it('retries only terminal failed/canceled operations as a new idempotent task', async () => {
    state.tasks.set('task-original', taskRow({ id: 'task-original', status: 'failed' }))
    const response = await retryTask(buildMockRequest({
      path: '/api/projects/project-1/canvas/canvas-1/operations/tasks/task-original/retry',
      method: 'POST',
      headers: { 'accept-language': 'zh' },
      body: {},
    }), taskContext('task-original'))
    const payload = await response.json() as Record<string, unknown>

    expect(response.status).toBe(202)
    expect(submitTaskMock).toHaveBeenCalledWith(expect.objectContaining({
      type: TASK_TYPE.CANVAS_IMAGE_OPERATION,
      payload: expect.objectContaining({ retryOf: 'task-original' }),
    }))
    expect(payload).toMatchObject({ success: true, async: true, retryOf: 'task-original', taskId: 'task-1' })
  })
})
