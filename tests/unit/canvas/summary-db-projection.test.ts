import { expect, it, vi } from 'vitest'
import { readCanvasNodeSummaries } from '@/lib/canvas/summary-db-reader'

const db = vi.hoisted(() => ({ $queryRaw: vi.fn(), canvasNode: { findMany: vi.fn() } }))
const reconcile = vi.hoisted(() => ({ reconcileCanvasGenerationNodes: vi.fn(async ({ nodes }: { nodes: unknown[] }) => nodes) }))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/canvas/generation-reconciliation', () => reconcile)

const row = {
  canvasId: 'canvas-a', type: 'image', position: { x: 20, y: 10 }, size: null, updatedAt: new Date('2026-11-22T00:00:00Z'),
  taskId: null, runId: null, mediaObjectId: null, parentNodeId: null,
}

it('reads no idle node bodies or history payloads, and reconciles only running nodes', async () => {
  db.$queryRaw.mockResolvedValueOnce([
    { ...row, id: 'idle', status: 'IDLE', cardEntries: [['title', '图像'], ['mediaType', 'image']], historyCount: BigInt(14), currentCostEntry: [3, 4], detailVersion: 'db1-version-abc' },
    { ...row, id: 'running', status: 'RUNNING', cardEntries: [], historyCount: BigInt(0), currentCostEntry: null, detailVersion: 'db1-version-def' },
  ])
  const running = { ...row, id: 'running', status: 'RUNNING', data: { title: '执行中', history: [], prompt: 'private prompt' } }
  db.canvasNode.findMany.mockResolvedValueOnce([running])

  const result = await readCanvasNodeSummaries('project-a', 'canvas-a')
  expect(db.$queryRaw.mock.calls[0][0]).toMatchObject({ values: expect.arrayContaining(['canvas-a']) })
  expect(db.canvasNode.findMany).toHaveBeenCalledWith(expect.objectContaining({
    where: { canvasId: 'canvas-a', id: { in: ['running'] } },
  }))
  expect(reconcile.reconcileCanvasGenerationNodes).toHaveBeenCalledWith({
    projectId: 'project-a', canvasId: 'canvas-a', nodes: [running],
  })
  expect(result.map((node) => node.id)).toEqual(['idle', 'running'])
  expect(result[0]).toMatchObject({ detailVersion: 'db1-version-abc', historyCount: 14, data: { title: '图像', currentCost: { kind: 'actual', points: 3 } } })
  expect(result[0]?.data).not.toHaveProperty('history')
  expect(result[1]?.data).not.toHaveProperty('prompt')
})
