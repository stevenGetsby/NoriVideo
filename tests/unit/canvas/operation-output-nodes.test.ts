import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/api-errors'

const state = vi.hoisted(() => ({
  revision: 4,
  sourceExists: true,
  outputIds: new Set<string>(),
}))
const applyOperationsMock = vi.hoisted(() => vi.fn())
const prismaMock = vi.hoisted(() => ({
  canvas: {
    findFirst: vi.fn(async () => ({ revision: state.revision })),
  },
  canvasNode: {
    findFirst: vi.fn(async ({ where }: { where: { id: string } }) => {
      if (state.outputIds.has(where.id)) return { id: where.id }
      if (!state.sourceExists || where.id !== 'source-1') return null
      return {
        id: 'source-1',
        type: 'image',
        position: { x: 100, y: 200 },
        size: { width: 320, height: 180 },
        data: { title: '源图' },
      }
    }),
  },
  $transaction: vi.fn(async (callback: (tx: Record<string, unknown>) => Promise<unknown>) => await callback({})),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/canvas/persistence', () => ({
  applyCanvasOperationsInTransaction: applyOperationsMock,
}))

import {
  canvasOperationOutputEdgeId,
  canvasOperationOutputNodeId,
  materializeCanvasAsyncOperationResult,
} from '@/lib/canvas/operation-output-nodes'

const input = {
  userId: 'user-1',
  projectId: 'project-1',
  canvasId: 'canvas-1',
  sourceNodeId: 'source-1',
  taskId: 'task-upscale-1',
  operation: 'superresolve' as const,
  modelKey: 'local-sharp',
  parameters: { scale: 2 },
  result: {
    width: 2000,
    height: 1200,
    title: '源图 · 超清',
    materialId: 'material-1',
    url: 'canvas-operations/task-upscale-1.jpg',
  },
}

describe('canvas operation output materialization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.revision = 4
    state.sourceExists = true
    state.outputIds = new Set()
    applyOperationsMock.mockImplementation(async (_tx, args: {
      input: { ops: Array<{ type: string; node?: { id: string } }> }
    }) => {
      const node = args.input.ops.find((operation) => operation.type === 'node.upsert')?.node
      if (node) state.outputIds.add(node.id)
      state.revision += 1
      return { canvas: { revision: state.revision } }
    })
  })

  it('atomically creates a stable result node and source edge with task recovery metadata', async () => {
    const result = await materializeCanvasAsyncOperationResult(input)

    expect(result).toEqual({
      materialized: true,
      outputNodeId: canvasOperationOutputNodeId(input.taskId),
      canvasRevision: 5,
      reason: 'created',
    })
    const transactionInput = applyOperationsMock.mock.calls[0]?.[1] as {
      input: { expectedRevision: number; clientId: string; ops: Array<Record<string, unknown>> }
    }
    expect(transactionInput.input).toMatchObject({
      expectedRevision: 4,
      clientId: 'worker:canvas-operation',
    })
    expect(transactionInput.input.ops).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'node.upsert',
        node: expect.objectContaining({
          id: canvasOperationOutputNodeId(input.taskId),
          type: 'image',
          status: 'SUCCEEDED',
          taskId: input.taskId,
          data: expect.objectContaining({
            materialId: 'material-1',
            canvasOperationTaskId: input.taskId,
            canvasOperationSourceNodeId: 'source-1',
          }),
        }),
      }),
      expect.objectContaining({
        type: 'edge.add',
        edge: expect.objectContaining({
          id: canvasOperationOutputEdgeId(input.taskId),
          sourceNodeId: 'source-1',
          targetNodeId: canvasOperationOutputNodeId(input.taskId),
        }),
      }),
    ]))

    const retried = await materializeCanvasAsyncOperationResult(input)
    expect(retried).toMatchObject({ materialized: true, reason: 'existing', canvasRevision: 5 })
    expect(applyOperationsMock).toHaveBeenCalledTimes(1)
  })

  it('retries a revision race without creating a second identity', async () => {
    applyOperationsMock
      .mockRejectedValueOnce(new ApiError('CONFLICT'))
      .mockImplementationOnce(async (_tx, args: { input: { ops: Array<{ type: string; node?: { id: string } }> } }) => {
        const node = args.input.ops.find((operation) => operation.type === 'node.upsert')?.node
        if (node) state.outputIds.add(node.id)
        state.revision = 6
        return { canvas: { revision: 6 } }
      })

    const result = await materializeCanvasAsyncOperationResult(input)

    expect(result).toMatchObject({ materialized: true, reason: 'created', canvasRevision: 6 })
    expect(applyOperationsMock).toHaveBeenCalledTimes(2)
    expect(new Set(applyOperationsMock.mock.calls.map((call) => (
      (call[1] as { input: { ops: Array<{ node?: { id: string } }> } }).input.ops[0].node?.id
    )))).toEqual(new Set([canvasOperationOutputNodeId(input.taskId)]))
  })

  it('keeps the material result but does not recreate a deleted source node', async () => {
    state.sourceExists = false

    await expect(materializeCanvasAsyncOperationResult(input)).resolves.toEqual({
      materialized: false,
      outputNodeId: null,
      canvasRevision: 4,
      reason: 'source-missing',
    })
    expect(applyOperationsMock).not.toHaveBeenCalled()
  })
})
