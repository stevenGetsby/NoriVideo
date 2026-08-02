import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CanvasStoryboardPlanTaskPayload } from '@/lib/canvas/generation-task'
import type { CanvasStoryboardShot } from '@/lib/canvas/storyboard-plan'
import { TaskTerminatedError } from '@/lib/task/errors'

type NodeRow = {
  id: string
  canvasId: string
  type: string
  position: unknown
  size: unknown
  data: Record<string, unknown>
  status: string
  taskId: string | null
  runId: string | null
  mediaObjectId: string | null
  parentNodeId: string | null
}

const state = vi.hoisted(() => ({
  nodes: new Map<string, NodeRow>(),
  edges: new Map<string, Record<string, unknown>>(),
  assets: new Map<string, Record<string, unknown>>(),
  tasks: new Map<string, {
    id: string
    userId: string
    projectId: string
    type: string
    targetType: string
    targetId: string
    status: string
  }>(),
  canvasRevision: 0,
  canvasSnapshots: [] as Array<Record<string, unknown>>,
  revisionClaimFails: false,
  submitFailureAssetId: '' as string,
  cancelPlanningAfterSubmitCount: 0,
  submitAttempts: [] as string[],
  submittedAssetIds: [] as string[],
}))

function matchesTaskId(node: NodeRow, where: Record<string, unknown>) {
  if (Object.prototype.hasOwnProperty.call(where, 'taskId') && node.taskId !== where.taskId) return false
  if (Array.isArray(where.OR)) {
    const alternatives = where.OR as Array<Record<string, unknown>>
    if (!alternatives.some((item) => item.taskId === node.taskId)) return false
  }
  return true
}

const canvasNode = vi.hoisted(() => ({
  findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
    const node = state.nodes.get(String(where.id || ''))
    if (!node || (where.canvasId && node.canvasId !== where.canvasId) || (where.type && node.type !== where.type)) return null
    if (!matchesTaskId(node, where)) return null
    return { ...node }
  }),
  findMany: vi.fn(async ({ where }: { where: { id?: { in?: string[] }; canvasId?: string } }) => {
    const ids = new Set(where.id?.in || [])
    return Array.from(state.nodes.values())
      .filter((node) => (!where.canvasId || node.canvasId === where.canvasId) && (ids.size === 0 || ids.has(node.id)))
      .map((node) => ({ ...node }))
  }),
  count: vi.fn(async ({ where }: { where: { canvasId: string } }) => (
    Array.from(state.nodes.values()).filter((node) => node.canvasId === where.canvasId).length
  )),
  create: vi.fn(async ({ data }: { data: NodeRow }) => {
    const node = { ...data, data: (data.data || {}) as Record<string, unknown> }
    state.nodes.set(node.id, node)
    return node
  }),
  updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Partial<NodeRow> }) => {
    const node = state.nodes.get(String(where.id || ''))
    if (!node || (where.canvasId && node.canvasId !== where.canvasId) || (where.type && node.type !== where.type)) return { count: 0 }
    if (!matchesTaskId(node, where)) return { count: 0 }
    state.nodes.set(node.id, { ...node, ...data, data: (data.data || node.data) as Record<string, unknown> })
    return { count: 1 }
  }),
}))

const canvasEdge = vi.hoisted(() => ({
  findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
    const ids = new Set((where.id as { in?: string[] } | undefined)?.in || [])
    return Array.from(state.edges.values()).filter((edge) => (
      (!where.canvasId || edge.canvasId === where.canvasId)
      && (!where.targetNodeId || edge.targetNodeId === where.targetNodeId)
      && (ids.size === 0 || ids.has(String(edge.id)))
    ))
  }),
  count: vi.fn(async () => state.edges.size),
  createMany: vi.fn(async ({ data }: { data: Array<Record<string, unknown>> }) => {
    data.forEach((edge) => state.edges.set(String(edge.id), edge))
    return { count: data.length }
  }),
}))

function taskMatches(task: {
  id: string
  userId: string
  projectId: string
  type: string
  targetType: string
  targetId: string
  status: string
}, where: Record<string, unknown>) {
  for (const key of ['id', 'userId', 'projectId', 'type', 'targetType', 'targetId'] as const) {
    if (typeof where[key] === 'string' && task[key] !== where[key]) return false
  }
  const status = where.status as { in?: string[] } | string | undefined
  if (typeof status === 'string' && task.status !== status) return false
  if (status && typeof status === 'object' && status.in && !status.in.includes(task.status)) return false
  return true
}

const task = vi.hoisted(() => ({
  findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => (
    Array.from(state.tasks.values()).find((candidate) => taskMatches(candidate, where)) || null
  )),
}))

const canvas = vi.hoisted(() => ({
  updateMany: vi.fn(async ({ where }: { where: { revision?: number } }) => {
    if (
      state.revisionClaimFails
      || (typeof where.revision === 'number' && where.revision !== state.canvasRevision)
    ) return { count: 0 }
    state.canvasRevision += 1
    return { count: 1 }
  }),
}))

const canvasSnapshot = vi.hoisted(() => ({
  create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
    state.canvasSnapshots.push(data)
    return { id: `snapshot-${state.canvasSnapshots.length}` }
  }),
  findMany: vi.fn(async () => []),
  deleteMany: vi.fn(async () => ({ count: 0 })),
}))

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(async (run: (tx: Record<string, unknown>) => Promise<unknown>) => await run({
    $queryRaw: vi.fn(async () => [{ id: 'canvas-1', revision: state.canvasRevision, viewport: { x: 0, y: 0, zoom: 1 } }]),
    canvas,
    canvasNode,
    canvasEdge,
    canvasSnapshot,
    task,
  })),
  canvas,
  canvasNode,
  canvasEdge,
  canvasSnapshot,
  frameosMaterial: {
    findMany: vi.fn(async () => []),
    findFirst: vi.fn(async () => null),
  },
  frameosToolboxAsset: {
    upsert: vi.fn(async ({ where, create }: { where: { id: string }; create: Record<string, unknown> }) => {
      const current = state.assets.get(where.id) || create
      state.assets.set(where.id, current)
      return current
    }),
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => state.assets.get(where.id) || null),
    updateMany: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const asset = state.assets.get(where.id)
      if (!asset) return { count: 0 }
      state.assets.set(where.id, { ...asset, ...data })
      return { count: 1 }
    }),
  },
  task,
}))

const submitTaskMock = vi.hoisted(() => vi.fn(async (input: { targetId: string }) => {
  state.submitAttempts.push(input.targetId)
  if (input.targetId === state.submitFailureAssetId) throw new Error('该镜头余额不足')
  const reusable = Array.from(state.tasks.values()).find((candidate) => (
    candidate.targetId === input.targetId
    && candidate.targetType === 'FrameosToolboxAsset'
    && (candidate.status === 'queued' || candidate.status === 'processing')
  ))
  if (reusable) return { taskId: reusable.id, runId: null, deduped: true }
  state.submittedAssetIds.push(input.targetId)
  const submitted = {
    id: `task-image-${input.targetId}-${state.submittedAssetIds.length}`,
    userId: 'user-1',
    projectId: 'project-1',
    type: 'toolbox_image',
    targetType: 'FrameosToolboxAsset',
    targetId: input.targetId,
    status: 'queued',
  }
  state.tasks.set(submitted.id, submitted)
  if (
    state.cancelPlanningAfterSubmitCount > 0
    && state.submittedAssetIds.length >= state.cancelPlanningAfterSubmitCount
  ) {
    const planning = state.tasks.get('task-plan')
    if (planning) planning.status = 'canceled'
  }
  return { taskId: submitted.id, runId: null, deduped: false }
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/api-config', () => ({ resolveModelSelection: vi.fn(async () => ({ id: 'model' })) }))
vi.mock('@/lib/config-service', () => ({ resolveProjectModelCapabilityGenerationOptions: vi.fn(async () => ({})) }))
vi.mock('@/lib/task/submitter', () => ({ submitTask: submitTaskMock }))
vi.mock('@/lib/task/service', () => ({ cancelTask: vi.fn(async () => ({ cancelled: true })) }))

import {
  CanvasStoryboardFanoutSupersededError,
  canvasStoryboardFanoutGroupId,
  canvasStoryboardFanoutIds,
  materializeCanvasStoryboardFanout,
} from '@/lib/canvas/storyboard-fanout'

const shots: CanvasStoryboardShot[] = Array.from({ length: 4 }, (_, index) => ({
  index: index + 1,
  title: `镜头 ${index + 1}`,
  prompt: `中景，雨夜车站里的连续动作镜头 ${index + 1}，保持人物服装、站位、环境与电影光影一致。`,
}))

const payload: CanvasStoryboardPlanTaskPayload = {
  kind: 'storyboard_plan',
  canvasId: 'canvas-1',
  nodeId: 'node-source',
  prompt: '女孩在雨夜车站逃离追踪者',
  count: 4,
  analysisModel: 'openai::gpt-5',
  imageRequest: {
    modelKey: 'volcengine::seedream-4',
    modelLabel: 'Seedream 4',
    referenceNodeIds: [],
    referenceMaterialIds: [],
    inputMode: 'text',
    aspectRatio: '16:9',
    resolution: '2K',
    quality: 'high',
  },
  maxInputTokens: 8_000,
  maxOutputTokens: 5_000,
  retryOf: null,
}

function resetSource() {
  state.nodes = new Map([['node-source', {
    id: 'node-source',
    canvasId: 'canvas-1',
    type: 'image',
    position: { x: 100, y: 200 },
    size: { width: 300, height: 200 },
    data: {
      title: '追逐戏',
      prompt: payload.prompt,
      generation: { count: 4, modelKey: payload.imageRequest.modelKey },
      generationTask: { kind: 'storyboard_plan', taskId: 'task-plan' },
    },
    status: 'RUNNING',
    taskId: 'task-plan',
    runId: 'run-plan',
    mediaObjectId: null,
    parentNodeId: null,
  }]])
  state.edges = new Map([['edge-reference', {
    id: 'edge-reference',
    canvasId: 'canvas-1',
    sourceNodeId: 'reference-node',
    targetNodeId: 'node-source',
    sourceHandle: 'output',
    targetHandle: 'input',
    role: 'REF',
    createdAt: new Date(),
  }]])
  state.assets = new Map()
  state.tasks = new Map([['task-plan', {
    id: 'task-plan',
    userId: 'user-1',
    projectId: 'project-1',
    type: 'canvas_storyboard_plan',
    targetType: 'CanvasNode',
    targetId: 'node-source',
    status: 'processing',
  }]])
  state.canvasRevision = 0
  state.canvasSnapshots = []
  state.revisionClaimFails = false
  state.submitFailureAssetId = ''
  state.cancelPlanningAfterSubmitCount = 0
  state.submitAttempts = []
  state.submittedAssetIds = []
}

describe('server storyboard fan-out', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetSource()
  })

  it('creates one stable node per shot, a group and cloned incoming edges without an online client', async () => {
    const first = await materializeCanvasStoryboardFanout({
      planningTaskId: 'task-plan',
      userId: 'user-1',
      projectId: 'project-1',
      locale: 'zh',
      payload,
      shots,
    })

    expect(first).toMatchObject({ status: 'submitted', submittedCount: 4, failedCount: 0 })
    expect(state.nodes.has(canvasStoryboardFanoutGroupId('task-plan'))).toBe(true)
    expect(first.shots.map((shot) => shot.nodeId)).toEqual([
      'node-source',
      canvasStoryboardFanoutIds('task-plan', 'node-source', 2).nodeId,
      canvasStoryboardFanoutIds('task-plan', 'node-source', 3).nodeId,
      canvasStoryboardFanoutIds('task-plan', 'node-source', 4).nodeId,
    ])
    expect(Array.from(state.edges.values()).filter((edge) => edge.targetNodeId !== 'node-source')).toHaveLength(3)
    expect(state.submittedAssetIds).toHaveLength(4)
    expect(state.canvasRevision).toBe(1)
    expect(state.canvasSnapshots).toHaveLength(1)
    expect(state.canvasSnapshots[0]).toMatchObject({
      revision: 1,
      clientId: 'worker:storyboard-fanout',
      document: expect.objectContaining({
        schema_version: 1,
        nodes: expect.arrayContaining([expect.objectContaining({ id: 'node-source' })]),
      }),
    })
    expect((state.nodes.get('node-source')?.data.generation as Record<string, unknown>).assetId).toBeTruthy()
    expect(state.nodes.get('node-source')?.data.generationTask).toBeNull()

    const second = await materializeCanvasStoryboardFanout({
      planningTaskId: 'task-plan',
      userId: 'user-1',
      projectId: 'project-1',
      locale: 'zh',
      payload,
      shots,
    })

    expect(second.shots.map((shot) => shot.assetId)).toEqual(first.shots.map((shot) => shot.assetId))
    expect(state.submittedAssetIds).toHaveLength(4)
    expect(state.submitAttempts).toHaveLength(8)
    expect(state.canvasRevision).toBe(1)
    expect(state.canvasSnapshots).toHaveLength(1)
    expect(state.nodes.size).toBe(5)
    expect(state.edges.size).toBe(4)
  })

  it('reuses the first durable plan when a worker retry receives different LLM wording', async () => {
    await materializeCanvasStoryboardFanout({
      planningTaskId: 'task-plan',
      userId: 'user-1',
      projectId: 'project-1',
      locale: 'zh',
      payload,
      shots,
    })
    const retryShots = shots.map((shot) => ({
      ...shot,
      title: `重试变化标题 ${shot.index}`,
      prompt: `重试时模型返回了不同提示词 ${shot.index}`,
    }))

    await materializeCanvasStoryboardFanout({
      planningTaskId: 'task-plan',
      userId: 'user-1',
      projectId: 'project-1',
      locale: 'zh',
      payload,
      shots: retryShots,
    })

    const retryPrompts = submitTaskMock.mock.calls.slice(shots.length).map(([input]) => (
      (input as unknown as { payload: { prompt: string } }).payload.prompt
    ))
    expect(retryPrompts).toEqual([shots[1].prompt, shots[2].prompt, shots[3].prompt, shots[0].prompt])
    expect(state.nodes.get('node-source')?.data.prompt).toBe(shots[0].prompt)
    expect(state.nodes.get(canvasStoryboardFanoutIds('task-plan', 'node-source', 2).nodeId)?.data.prompt).toBe(shots[1].prompt)
  })

  it('keeps successful siblings running when one shot submission fails', async () => {
    state.submitFailureAssetId = canvasStoryboardFanoutIds('task-plan', 'node-source', 2).assetId

    const result = await materializeCanvasStoryboardFanout({
      planningTaskId: 'task-plan',
      userId: 'user-1',
      projectId: 'project-1',
      locale: 'zh',
      payload,
      shots,
    })

    expect(result).toMatchObject({ status: 'partial', submittedCount: 3, failedCount: 1 })
    expect(result.shots[1]).toMatchObject({ status: 'failed', errorMessage: '该镜头余额不足' })
    expect(state.nodes.get(result.shots[1].nodeId)).toMatchObject({ status: 'FAILED', taskId: null })
    expect(result.shots.filter((shot) => shot.status === 'submitted')).toHaveLength(3)
    expect(result.shots.filter((shot) => shot.status === 'submitted').every((shot) => (
      state.nodes.get(shot.nodeId)?.status === 'RUNNING'
    ))).toBe(true)

    state.submitFailureAssetId = ''
    const retried = await materializeCanvasStoryboardFanout({
      planningTaskId: 'task-plan',
      userId: 'user-1',
      projectId: 'project-1',
      locale: 'zh',
      payload,
      shots,
    })
    const recoveredShot = retried.shots[1]
    expect(retried).toMatchObject({ status: 'submitted', submittedCount: 4, failedCount: 0 })
    expect(recoveredShot.status).toBe('submitted')
    expect(state.assets.get(recoveredShot.assetId!)).toMatchObject({ status: 'pending', errorMessage: null })
    expect(state.nodes.get(recoveredShot.nodeId)).toMatchObject({ status: 'RUNNING' })
  })

  it('atomically refuses a graph write when its locked revision claim is stale', async () => {
    state.revisionClaimFails = true

    await expect(materializeCanvasStoryboardFanout({
      planningTaskId: 'task-plan',
      userId: 'user-1',
      projectId: 'project-1',
      locale: 'zh',
      payload,
      shots,
    })).rejects.toThrow('画布 revision 已变化')

    expect(state.canvasRevision).toBe(0)
    expect(state.canvasSnapshots).toHaveLength(0)
    expect(state.submitAttempts).toHaveLength(0)
  })

  it('does not create a graph or paid child when the planning task was cancelled', async () => {
    state.tasks.get('task-plan')!.status = 'canceled'

    await expect(materializeCanvasStoryboardFanout({
      planningTaskId: 'task-plan',
      userId: 'user-1',
      projectId: 'project-1',
      locale: 'zh',
      payload,
      shots,
    })).rejects.toBeInstanceOf(TaskTerminatedError)

    expect(state.nodes.size).toBe(1)
    expect(state.submitAttempts).toHaveLength(0)
    expect(state.canvasRevision).toBe(0)
  })

  it('stops before fan-out when a newer planning task owns the source node', async () => {
    const source = state.nodes.get('node-source')!
    source.taskId = 'task-plan-new'
    source.data.generationTask = { kind: 'storyboard_plan', taskId: 'task-plan-new' }

    await expect(materializeCanvasStoryboardFanout({
      planningTaskId: 'task-plan',
      userId: 'user-1',
      projectId: 'project-1',
      locale: 'zh',
      payload,
      shots,
    })).rejects.toBeInstanceOf(CanvasStoryboardFanoutSupersededError)

    expect(state.nodes.size).toBe(1)
    expect(state.submitAttempts).toHaveLength(0)
    expect(state.canvasRevision).toBe(0)
  })

  it('checks planning activity before every child and stops after cancellation', async () => {
    state.cancelPlanningAfterSubmitCount = 1

    await expect(materializeCanvasStoryboardFanout({
      planningTaskId: 'task-plan',
      userId: 'user-1',
      projectId: 'project-1',
      locale: 'zh',
      payload,
      shots,
    })).rejects.toBeInstanceOf(TaskTerminatedError)

    expect(state.submitAttempts).toHaveLength(1)
    expect(state.submittedAssetIds).toHaveLength(1)
  })

  it('delegates an existing or orphan child task to submitTask dedupe instead of bypassing it', async () => {
    const shotTwoAssetId = canvasStoryboardFanoutIds('task-plan', 'node-source', 2).assetId
    state.tasks.set('task-existing-or-orphan', {
      id: 'task-existing-or-orphan',
      userId: 'user-1',
      projectId: 'project-1',
      type: 'toolbox_image',
      targetType: 'FrameosToolboxAsset',
      targetId: shotTwoAssetId,
      status: 'processing',
    })

    const result = await materializeCanvasStoryboardFanout({
      planningTaskId: 'task-plan',
      userId: 'user-1',
      projectId: 'project-1',
      locale: 'zh',
      payload,
      shots,
    })

    expect(result.shots[1]).toMatchObject({
      assetId: shotTwoAssetId,
      taskId: 'task-existing-or-orphan',
      status: 'submitted',
    })
    expect(state.submitAttempts).toContain(shotTwoAssetId)
    expect(task.findFirst.mock.calls.some(([args]) => (
      (args as { where: Record<string, unknown> }).where.targetType === 'FrameosToolboxAsset'
    ))).toBe(false)
  })

  it('does not treat a completed child task as ready while its asset is still pending', async () => {
    const shotTwoAssetId = canvasStoryboardFanoutIds('task-plan', 'node-source', 2).assetId
    state.assets.set(shotTwoAssetId, {
      id: shotTwoAssetId,
      userId: 'user-1',
      projectId: 'project-1',
      type: 'image',
      status: 'pending',
      resultUrl: null,
    })
    state.tasks.set('task-completed-without-asset', {
      id: 'task-completed-without-asset',
      userId: 'user-1',
      projectId: 'project-1',
      type: 'toolbox_image',
      targetType: 'FrameosToolboxAsset',
      targetId: shotTwoAssetId,
      status: 'completed',
    })

    const result = await materializeCanvasStoryboardFanout({
      planningTaskId: 'task-plan',
      userId: 'user-1',
      projectId: 'project-1',
      locale: 'zh',
      payload,
      shots,
    })

    expect(result.shots[1].status).toBe('submitted')
    expect(result.shots[1].taskId).not.toBe('task-completed-without-asset')
    expect(state.submittedAssetIds).toContain(shotTwoAssetId)
  })

  it('never projects metadata from a deleted or cross-workspace material', async () => {
    const shotTwoAssetId = canvasStoryboardFanoutIds('task-plan', 'node-source', 2).assetId
    state.assets.set(shotTwoAssetId, {
      id: shotTwoAssetId,
      userId: 'user-1',
      projectId: 'project-1',
      type: 'image',
      status: 'ready',
      resultUrl: 'images/storyboard-shot-2.png',
      materialId: 'material-shot-2',
      errorMessage: null,
    })

    const result = await materializeCanvasStoryboardFanout({
      planningTaskId: 'task-plan',
      userId: 'user-1',
      projectId: 'project-1',
      locale: 'zh',
      payload,
      shots,
    })

    expect(result.shots[1].status).toBe('ready')
    expect(prismaMock.frameosMaterial.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'material-shot-2',
        userId: 'user-1',
        projectId: { in: ['project-1', 'global', 'global-asset-hub'] },
        deletedAt: null,
      },
      select: { metadata: true },
    })
  })
})
