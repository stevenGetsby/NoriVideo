import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  revision: 7,
  preparedNodeIds: new Set<string>(),
}))

const applyOperationsMock = vi.hoisted(() => vi.fn())
const prismaMock = vi.hoisted(() => ({
  canvas: {
    findFirst: vi.fn(async () => ({ revision: state.revision })),
  },
  canvasNode: {
    findFirst: vi.fn(async () => ({
      id: 'image-source',
      type: 'image',
      position: { x: 120, y: 80 },
      size: { width: 320, height: 220 },
      data: {
        title: '概念图',
        mediaType: 'image',
        contentUrl: 'old.jpg',
        imageUrl: 'old.jpg',
        materialId: 'old-material',
        generation: { modelKey: 'image::model', assetId: 'old-asset', taskId: 'old-task' },
        history: [{ id: 'old-history', status: 'ready' }],
      },
      parentNodeId: null,
    })),
    findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) => (
      where.id.in.filter((id) => state.preparedNodeIds.has(id)).map((id) => ({ id }))
    )),
  },
  canvasEdge: {
    findMany: vi.fn(async () => ([
      { id: 'edge-text', sourceNodeId: 'text-1', sourceHandle: 'output', targetHandle: 'input', role: 'INPUT_TEXT' },
      { id: 'edge-image', sourceNodeId: 'image-ref', sourceHandle: 'output', targetHandle: 'input', role: 'INPUT_IMAGE' },
    ])),
  },
  $transaction: vi.fn(async (run: (tx: Record<string, never>) => Promise<unknown>) => await run({})),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/canvas/persistence', () => ({
  applyCanvasOperationsInTransaction: applyOperationsMock,
}))

import {
  prepareCanvasToolboxImageOutputs,
  stableCanvasToolboxOutputNodeId,
} from '@/lib/canvas/toolbox-output-nodes'

const input = {
  userId: 'workspace-user',
  actorUserId: 'editor-user',
  projectId: 'project-1',
  canvasId: 'canvas-1',
  sourceNodeId: 'image-source',
  idempotencyKey: 'request-1',
  expectedRevision: 7,
  clientId: 'browser-1',
  count: 4,
  title: '概念图',
  prompt: '四张连续概念图',
}

describe('canvas toolbox multi-image output preparation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.revision = 7
    state.preparedNodeIds = new Set()
    applyOperationsMock.mockImplementation(async (_tx, args: {
      input: { ops: Array<{ type: string; node?: { id: string }; edge?: { id: string } }> }
    }) => {
      for (const operation of args.input.ops) {
        if (operation.type === 'node.upsert' && operation.node) state.preparedNodeIds.add(operation.node.id)
      }
      state.revision += 1
      return {
        canvas: { id: 'canvas-1', revision: state.revision },
        nodes: args.input.ops.flatMap((operation) => operation.node ? [operation.node] : []),
        edges: args.input.ops.flatMap((operation) => operation.edge ? [operation.edge] : []),
      }
    })
  })

  it('persists every extra output and cloned incoming edge in one revision before tasks are submitted', async () => {
    const prepared = await prepareCanvasToolboxImageOutputs(input)

    expect(prepared.created).toBe(true)
    expect(prepared.canvasRevision).toBe(8)
    expect(prepared.nodeIds).toHaveLength(4)
    expect(new Set(prepared.nodeIds).size).toBe(4)
    expect(prepared.nodeIds[0]).toBe('image-source')

    const mutation = applyOperationsMock.mock.calls[0]?.[1] as {
      userId: string
      input: {
        expectedRevision: number
        clientId: string
        ops: Array<{
          type: string
          node?: { id: string; position: { x: number; y: number }; data: Record<string, unknown>; taskId: string | null }
          edge?: { id: string; sourceNodeId: string; targetNodeId: string; role: string }
        }>
      }
    }
    expect(mutation.userId).toBe('editor-user')
    expect(mutation.input).toMatchObject({ expectedRevision: 7, clientId: 'browser-1' })
    const nodeOps = mutation.input.ops.filter((operation) => operation.type === 'node.upsert')
    const edgeOps = mutation.input.ops.filter((operation) => operation.type === 'edge.add')
    expect(nodeOps).toHaveLength(3)
    expect(edgeOps).toHaveLength(6)
    expect(nodeOps.map((operation) => operation.node?.id)).toEqual(prepared.nodeIds.slice(1))
    expect(nodeOps.map((operation) => operation.node?.position.x)).toEqual([486, 852, 1218])
    expect(nodeOps[0]?.node).toMatchObject({
      taskId: null,
      data: {
        title: '概念图 2',
        contentUrl: null,
        imageUrl: null,
        materialId: null,
        history: [],
        generation: { modelKey: 'image::model' },
        toolboxOutput: { sourceNodeId: 'image-source', index: 1 },
      },
    })
    expect((nodeOps[0]?.node?.data.generation as Record<string, unknown>)).not.toHaveProperty('assetId')
    expect(new Set(edgeOps.map((operation) => operation.edge?.id)).size).toBe(6)
    expect(edgeOps.filter((operation) => operation.edge?.targetNodeId === prepared.nodeIds[1])).toHaveLength(2)
  })

  it('reuses the same nodes after a lost response without changing the revision or duplicating edges', async () => {
    const first = await prepareCanvasToolboxImageOutputs(input)
    const second = await prepareCanvasToolboxImageOutputs(input)

    expect(second).toEqual({ nodeIds: first.nodeIds, canvasRevision: 8, created: false })
    expect(applyOperationsMock).toHaveBeenCalledTimes(1)
    expect(prismaMock.canvasEdge.findMany).toHaveBeenCalledTimes(2)
  })

  it('derives different stable node identities for each output and request', () => {
    const first = stableCanvasToolboxOutputNodeId({
      userId: input.userId,
      projectId: input.projectId,
      canvasId: input.canvasId,
      sourceNodeId: input.sourceNodeId,
      idempotencyKey: input.idempotencyKey,
      index: 1,
    })
    const retry = stableCanvasToolboxOutputNodeId({
      userId: input.userId,
      projectId: input.projectId,
      canvasId: input.canvasId,
      sourceNodeId: input.sourceNodeId,
      idempotencyKey: input.idempotencyKey,
      index: 1,
    })
    const sibling = stableCanvasToolboxOutputNodeId({
      userId: input.userId,
      projectId: input.projectId,
      canvasId: input.canvasId,
      sourceNodeId: input.sourceNodeId,
      idempotencyKey: input.idempotencyKey,
      index: 2,
    })
    const nextRequest = stableCanvasToolboxOutputNodeId({
      userId: input.userId,
      projectId: input.projectId,
      canvasId: input.canvasId,
      sourceNodeId: input.sourceNodeId,
      idempotencyKey: 'request-2',
      index: 1,
    })

    expect(retry).toBe(first)
    expect(sibling).not.toBe(first)
    expect(nextRequest).not.toBe(first)
  })

  it('rejects a stale revision instead of creating assets against an incomplete output graph', async () => {
    state.revision = 9
    await expect(prepareCanvasToolboxImageOutputs(input)).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(applyOperationsMock).not.toHaveBeenCalled()
  })
})
