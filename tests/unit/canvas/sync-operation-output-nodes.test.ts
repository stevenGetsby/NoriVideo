import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/api-errors'

const state = vi.hoisted(() => ({
  revision: 8,
  sourceExists: true,
  targetExists: true,
  outputIds: new Set<string>(),
}))
const applyOperationsMock = vi.hoisted(() => vi.fn())
const prismaMock = vi.hoisted(() => ({
  canvas: {
    findFirst: vi.fn(async () => ({ revision: state.revision })),
  },
  canvasNode: {
    findFirst: vi.fn(async ({ where }: { where: { id: string } }) => {
      if (where.id === 'source-1') {
        if (!state.sourceExists) return null
        return {
          id: 'source-1',
          type: 'image',
          position: { x: 100, y: 200 },
          size: { width: 320, height: 180 },
          data: { title: '源图' },
          status: 'SUCCEEDED',
          taskId: null,
          runId: null,
          mediaObjectId: null,
          parentNodeId: null,
        }
      }
      if (where.id === 'target-1' && state.targetExists) {
        return {
          id: 'target-1',
          type: 'image',
          position: { x: 900, y: 200 },
          size: { width: 300, height: 200 },
          data: { title: '生成节点', generation: { referenceNodeIds: ['older-ref'] } },
          status: 'IDLE',
          taskId: null,
          runId: null,
          mediaObjectId: null,
          parentNodeId: null,
        }
      }
      return null
    }),
    findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) => (
      where.id.in.filter((id) => state.outputIds.has(id)).map((id) => ({ id }))
    )),
  },
  $transaction: vi.fn(async (callback: (tx: Record<string, unknown>) => Promise<unknown>) => await callback({})),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/canvas/persistence', () => ({
  applyCanvasOperationsInTransaction: applyOperationsMock,
}))

import {
  canvasSyncOperationGroupNodeId,
  canvasSyncOperationOutputNodeId,
  materializeCanvasSyncImageOperation,
} from '@/lib/canvas/sync-operation-output-nodes'

const gridInput = {
  userId: 'user-1',
  projectId: 'project-1',
  canvasId: 'canvas-1',
  sourceNodeId: 'source-1',
  operationRequestId: 'request-grid-1',
  operation: 'grid_split' as const,
  results: [
    { index: 0, row: 0, col: 0, width: 800, height: 600, title: '源图 · 1-1', materialId: 'material-1', url: 'tiles/1.jpg' },
    { index: 1, row: 0, col: 1, width: 800, height: 600, title: '源图 · 1-2', materialId: 'material-2', url: 'tiles/2.jpg' },
  ],
}

describe('synchronous Canvas image operation materialization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.revision = 8
    state.sourceExists = true
    state.targetExists = true
    state.outputIds = new Set()
    applyOperationsMock.mockImplementation(async (_tx, args: {
      input: { ops: Array<{ type: string; node?: { id: string; data?: Record<string, unknown> } }> }
    }) => {
      for (const operation of args.input.ops) {
        if (operation.type === 'node.upsert' && operation.node?.data?.canvasOperationRequestId) {
          state.outputIds.add(operation.node.id)
        }
      }
      state.revision += 1
      return { canvas: { revision: state.revision } }
    })
  })

  it('persists all grid results, source edges, and their visual group in one revision', async () => {
    const result = await materializeCanvasSyncImageOperation(gridInput)

    expect(result).toEqual({
      materialized: true,
      outputNodeIds: [
        canvasSyncOperationOutputNodeId('request-grid-1', 0),
        canvasSyncOperationOutputNodeId('request-grid-1', 1),
      ],
      canvasRevision: 9,
      reason: 'created',
    })
    const transaction = applyOperationsMock.mock.calls[0]?.[1] as {
      input: { expectedRevision: number; clientId: string; ops: Array<Record<string, unknown>> }
    }
    expect(transaction.input).toMatchObject({
      expectedRevision: 8,
      clientId: 'server:canvas-sync-operation',
    })
    expect(transaction.input.ops).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'node.upsert',
        node: expect.objectContaining({
          id: canvasSyncOperationOutputNodeId('request-grid-1', 0),
          status: 'SUCCEEDED',
          data: expect.objectContaining({ materialId: 'material-1', processType: 'grid_split' }),
        }),
      }),
      expect.objectContaining({
        type: 'node.upsert',
        node: expect.objectContaining({
          id: canvasSyncOperationGroupNodeId('request-grid-1'),
          type: 'group',
          data: expect.objectContaining({
            memberIds: [
              canvasSyncOperationOutputNodeId('request-grid-1', 0),
              canvasSyncOperationOutputNodeId('request-grid-1', 1),
            ],
          }),
        }),
      }),
      expect.objectContaining({
        type: 'edge.add',
        edge: expect.objectContaining({ sourceNodeId: 'source-1', role: 'REF' }),
      }),
    ]))

    const recovered = await materializeCanvasSyncImageOperation(gridInput)
    expect(recovered).toMatchObject({ materialized: true, reason: 'existing', canvasRevision: 9 })
    expect(applyOperationsMock).toHaveBeenCalledTimes(1)
  })

  it('atomically connects a lens crop to the requested generation target', async () => {
    const result = await materializeCanvasSyncImageOperation({
      ...gridInput,
      targetNodeId: 'target-1',
      operationRequestId: 'request-focus-1',
      operation: 'lens_focus',
      results: [gridInput.results[0]],
    })

    expect(result).toMatchObject({ materialized: true, reason: 'created' })
    const operations = (applyOperationsMock.mock.calls[0]?.[1] as {
      input: { ops: Array<Record<string, unknown>> }
    }).input.ops
    const outputId = canvasSyncOperationOutputNodeId('request-focus-1', 0)
    expect(operations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'node.upsert',
        node: expect.objectContaining({
          id: 'target-1',
          data: expect.objectContaining({
            generation: expect.objectContaining({ referenceNodeIds: ['older-ref', outputId] }),
          }),
        }),
      }),
      expect.objectContaining({
        type: 'edge.add',
        edge: expect.objectContaining({ sourceNodeId: outputId, targetNodeId: 'target-1', role: 'INPUT_IMAGE' }),
      }),
    ]))
  })

  it('retries revision races with stable output identities', async () => {
    applyOperationsMock
      .mockRejectedValueOnce(new ApiError('CONFLICT'))
      .mockImplementationOnce(async (_tx, args: {
        input: { ops: Array<{ type: string; node?: { id: string; data?: Record<string, unknown> } }> }
      }) => {
        for (const operation of args.input.ops) {
          if (operation.node?.data?.canvasOperationRequestId) state.outputIds.add(operation.node.id)
        }
        state.revision = 10
        return { canvas: { revision: 10 } }
      })

    await expect(materializeCanvasSyncImageOperation(gridInput)).resolves.toMatchObject({
      materialized: true,
      reason: 'created',
      canvasRevision: 10,
    })
    expect(applyOperationsMock).toHaveBeenCalledTimes(2)
  })

  it('keeps saved materials detached instead of recreating a deleted source node', async () => {
    state.sourceExists = false

    await expect(materializeCanvasSyncImageOperation(gridInput)).resolves.toEqual({
      materialized: false,
      outputNodeIds: [],
      canvasRevision: 8,
      reason: 'source-missing',
    })
    expect(applyOperationsMock).not.toHaveBeenCalled()
  })
})
