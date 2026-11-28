import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  batchRun: { findFirst: vi.fn() },
  batchItem: { findFirst: vi.fn(), findUniqueOrThrow: vi.fn(), updateMany: vi.fn() },
  canvas: { findFirst: vi.fn(), create: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
  canvasNode: { findMany: vi.fn(), createMany: vi.fn(), updateMany: vi.fn() },
  canvasEdge: { findMany: vi.fn(), createMany: vi.fn(), deleteMany: vi.fn() },
  canvasSnapshot: { findFirst: vi.fn(), create: vi.fn() },
  project: { findFirst: vi.fn() },
  user: { findMany: vi.fn() },
  frameosMaterial: { findMany: vi.fn() },
  $transaction: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/collaboration/access', () => ({ workspaceUserWhere: (id: string) => ({ id }) }))

import { materializeBatchItemToCanvas, buildBatchItemCanvasGraph } from '@/lib/batch-workflow/materialize-canvas'
import type { BatchItemDTO } from '@/lib/batch-workflow/types'

function sourceItem(): BatchItemDTO {
  return {
    id: 'item-1', batchRunId: 'run-1', index: 0, title: 'Item', inputPayload: {}, revision: 0,
    currentStage: 'video_gen', status: 'waiting_review', stageStates: {}, errorMessage: null, createdAt: '', updatedAt: '',
    stageOutputs: {
      canvasId: 'canvas-1',
      storyboard: { aspectRatio: '9:16', totalDurationSec: 5, pacingStyle: '', videoModelKey: '', supportsFirstLastFrame: false, allowedDurationRange: { min: 1, max: 10 }, shots: [{ shotId: 'shot-1', shotIndex: 1, sceneIndex: 1, title: 'Shot', durationSec: 5, shotType: '', cameraMovement: '', visualDescription: '', videoPrompt: '', referencedAssetIds: [], referencedAssetNames: [], inputMode: 'text', negativeConstraints: '' }] },
      video_gen: { modelKey: '', aspectRatio: '9:16', resolution: '720p', generateAudio: true, inputMode: 'text', readyCount: 1, totalCount: 1, pendingCount: 0, failedCount: 0, shots: [{ shotId: 'shot-1', shotIndex: 1, title: 'Shot', durationSec: 5, prompt: '', referencedAssetIds: [], selectedTakeIndex: 0, takes: [{ takeIndex: 0, videoUrl: 'new.mp4', prompt: '', modelKey: '', inputMode: 'text', aspectRatio: '9:16', resolution: '720p', durationSec: 5, generateAudio: true, status: 'ready', submittedAt: '' }] }] },
    },
  } as unknown as BatchItemDTO
}
function row(item = sourceItem()) {
  return { ...item, createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01'), executionKey: null }
}
function runRow() {
  return {
    id: 'run-1', projectId: 'project-1', userId: 'owner-1', createdById: 'actor-1', workId: null,
    templateId: 'template-1', title: 'Run', track: 'short_video', runMode: 'gated', status: 'running',
    totalItems: 1, completedItems: 0, failedItems: 0, templateSnapshot: { modelConfig: {}, stages: [] },
    createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01'),
  }
}
function setupExisting(item = sourceItem()) {
  const graph = buildBatchItemCanvasGraph({ canvasId: 'canvas-1', item: { ...item, stageOutputs: { ...item.stageOutputs, canvasId: undefined } } })
  db.batchRun.findFirst.mockResolvedValue(runRow())
  db.batchItem.findFirst.mockResolvedValue(row(item))
  db.canvas.findFirst.mockResolvedValue({ id: 'canvas-1', revision: 4, viewport: graph.viewport, nodes: [graph.nodes.find((node) => node.type === 'playlist')], _count: { nodes: graph.nodes.length, edges: graph.edges.length } })
  db.canvasSnapshot.findFirst.mockResolvedValue({ document: { nodes: graph.nodes } })
  db.canvasNode.findMany.mockResolvedValue(graph.nodes)
  db.canvasEdge.findMany.mockResolvedValue(graph.edges)
  db.project.findFirst.mockResolvedValue({ id: 'project-1' })
  db.user.findMany.mockResolvedValue([])
  db.frameosMaterial.findMany.mockResolvedValue([])
  return graph
}
const params = { workspaceOwnerId: 'owner-1', actorId: 'actor-1', batchRunId: 'run-1', itemId: 'item-1' }

beforeEach(() => {
  vi.clearAllMocks()
  db.$transaction.mockImplementation(async (callback: (tx: typeof db) => unknown) => callback(db))
})

describe('materialize canvas modes', () => {
  it('check compares fingerprints without any writes', async () => {
    setupExisting()
    const result = await materializeBatchItemToCanvas({ ...params, mode: 'check' })
    expect(result).toMatchObject({ canvasId: 'canvas-1', reused: true, stale: false })
    expect(result.fingerprint).toBe(result.canvasFingerprint)
    expect(db.canvasNode.updateMany).not.toHaveBeenCalled()
    expect(db.canvas.updateMany).not.toHaveBeenCalled()
    expect(db.$transaction).not.toHaveBeenCalled()
    expect(db.batchItem.updateMany).not.toHaveBeenCalled()
  })

  it('legacy mode reports stale but never modifies the existing canvas', async () => {
    const item = sourceItem()
    setupExisting(item)
    item.stageOutputs.video_gen!.shots[0].takes[0].videoUrl = 'changed.mp4'
    const result = await materializeBatchItemToCanvas(params)
    expect(result).toMatchObject({ reused: true, stale: true })
    expect(db.$transaction).not.toHaveBeenCalled()
    expect(db.canvasNode.updateMany).not.toHaveBeenCalled()
  })

  it('sync CAS conflict returns CONFLICT and writes no nodes', async () => {
    const item = sourceItem()
    setupExisting(item)
    item.stageOutputs.video_gen!.shots[0].takes[0].videoUrl = 'changed.mp4'
    db.canvas.updateMany.mockResolvedValue({ count: 0 })
    await expect(materializeBatchItemToCanvas({ ...params, mode: 'sync' })).rejects.toMatchObject({ code: 'CONFLICT', status: 409 })
    expect(db.canvasNode.updateMany).not.toHaveBeenCalled()
    expect(db.canvasSnapshot.create).not.toHaveBeenCalled()
  })

  it('sync updates only owned node rows and leaves user nodes out of updates', async () => {
    const item = sourceItem()
    const graph = setupExisting(item)
    item.stageOutputs.video_gen!.shots[0].takes[0].videoUrl = 'changed.mp4'
    db.canvasNode.findMany.mockResolvedValue([...graph.nodes, { ...graph.nodes[0], id: 'user-node', data: { text: 'mine' } }])
    db.canvas.updateMany.mockResolvedValue({ count: 1 })
    db.canvasNode.updateMany.mockResolvedValue({ count: 1 })
    const result = await materializeBatchItemToCanvas({ ...params, mode: 'sync' })
    expect(result).toMatchObject({ reused: true, synced: true, stale: false, canvasFingerprint: expect.any(String) })
    expect(result.updatedNodeCount).toBeGreaterThan(0)
    expect(db.canvasNode.updateMany.mock.calls.every(([args]) => args.where.id !== 'user-node')).toBe(true)
    expect(db.canvas.updateMany.mock.calls[0][0].where).toMatchObject({ id: 'canvas-1', revision: 4 })
  })

  it('rejects stale item revision on sync before reading or writing canvas', async () => {
    setupExisting()
    await expect(materializeBatchItemToCanvas({ ...params, mode: 'sync', expectedRevision: 9 })).rejects.toMatchObject({ code: 'STALE_REVISION', status: 409 })
    expect(db.canvas.findFirst).not.toHaveBeenCalled()
    expect(db.canvas.updateMany).not.toHaveBeenCalled()
  })

  it('legacy canvas sync is rejected instead of guessing node ownership', async () => {
    const item = sourceItem()
    setupExisting(item)
    item.stageOutputs.video_gen!.shots[0].takes[0].videoUrl = 'changed.mp4'
    db.canvas.findFirst.mockResolvedValue({ id: 'canvas-1', revision: 4, viewport: {}, nodes: [], _count: { nodes: 3, edges: 2 } })
    db.canvasSnapshot.findFirst.mockResolvedValue({ document: { nodes: [] } })
    await expect(materializeBatchItemToCanvas({ ...params, mode: 'sync' })).rejects.toMatchObject({ code: 'CONFLICT', status: 409 })
    expect(db.$transaction).not.toHaveBeenCalled()
  })

  it('rejects stale item revision before creating anything', async () => {
    const item = sourceItem()
    item.stageOutputs.canvasId = undefined
    db.batchRun.findFirst.mockResolvedValue(runRow())
    db.batchItem.findFirst.mockResolvedValue(row(item))
    await expect(materializeBatchItemToCanvas({ ...params, expectedRevision: 1 })).rejects.toMatchObject({ code: 'STALE_REVISION', status: 409 })
    expect(db.$transaction).not.toHaveBeenCalled()
  })

  it('returns STALE_REVISION when item CAS loses to a non-canvas write', async () => {
    const item = sourceItem()
    item.stageOutputs.canvasId = undefined
    db.batchRun.findFirst.mockResolvedValue(runRow())
    db.batchItem.findFirst.mockResolvedValue(row(item))
    db.project.findFirst.mockResolvedValue({ id: 'project-1' })
    db.batchItem.updateMany.mockResolvedValue({ count: 0 })
    await expect(materializeBatchItemToCanvas(params)).rejects.toMatchObject({ code: 'STALE_REVISION', status: 409 })
    expect(db.canvas.deleteMany).not.toHaveBeenCalled()
  })

  it('invalid canvasId falls back to create and returns a new canvas', async () => {
    const item = sourceItem()
    db.batchRun.findFirst.mockResolvedValue(runRow())
    db.batchItem.findFirst.mockResolvedValue(row(item))
    db.canvas.findFirst.mockResolvedValue(null)
    db.project.findFirst.mockResolvedValue({ id: 'project-1' })
    db.batchItem.updateMany.mockResolvedValue({ count: 1 })
    db.batchItem.findUniqueOrThrow.mockResolvedValue({ ...row(item), revision: 1 })
    const result = await materializeBatchItemToCanvas(params)
    expect(result.reused).toBe(false)
    expect(result.canvasId).not.toBe('canvas-1')
    expect(db.canvas.create).toHaveBeenCalledTimes(1)
  })

  it('concurrent materialize calls persist one canvas and the loser reuses the winner', async () => {
    const item = sourceItem()
    item.stageOutputs.canvasId = undefined
    let current = row(item)
    db.batchRun.findFirst.mockResolvedValue(runRow())
    db.batchItem.findFirst.mockImplementation(async () => current)
    db.project.findFirst.mockResolvedValue({ id: 'project-1' })
    const created = new Map<string, { id: string; _count: { nodes: number; edges: number } }>()
    db.canvas.create.mockImplementation(async ({ data }) => {
      created.set(data.id, { id: data.id, _count: { nodes: 3, edges: 2 } })
      return data
    })
    db.canvas.deleteMany.mockImplementation(async ({ where }) => {
      created.delete(where.id)
      return { count: 1 }
    })
    db.canvas.findFirst.mockImplementation(async ({ where }) => created.get(where.id) || null)
    db.batchItem.updateMany.mockImplementation(async ({ where, data }) => {
      if (current.revision !== where.revision) return { count: 0 }
      current = { ...current, revision: (current.revision || 0) + 1, stageOutputs: data.stageOutputs }
      return { count: 1 }
    })
    db.batchItem.findUniqueOrThrow.mockImplementation(async () => current)
    const results = await Promise.all([
      materializeBatchItemToCanvas(params),
      materializeBatchItemToCanvas(params),
    ])
    expect(results.map((result) => result.reused).sort()).toEqual([false, true])
    expect(new Set(results.map((result) => result.canvasId)).size).toBe(1)
    expect(created.size).toBe(1)
  })
})
