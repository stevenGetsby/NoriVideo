import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  batchItem: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    updateMany: vi.fn(),
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

import {
  readBatchItemRow,
  updateBatchItemForUser,
  updateBatchItemWithRetry,
} from '@/lib/batch-workflow/item-store'
import { mapBatchItemRow } from '@/lib/batch-workflow/service'

function row(revision: number | undefined, extra: Record<string, unknown> = {}) {
  return {
    id: 'item-1',
    batchRunId: 'run-1',
    revision,
    executionKey: null,
    index: 0,
    title: 'Item',
    inputPayload: {},
    currentStage: 'script_analysis',
    status: 'queued',
    stageStates: {},
    stageOutputs: {},
    errorMessage: null,
    createdAt: new Date('2026-11-28T00:00:00.000Z'),
    updatedAt: new Date('2026-11-28T00:00:00.000Z'),
    ...extra,
  }
}

describe('BatchItem revision-checked store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(Math, 'random').mockReturnValue(0)
  })

  it('increments a matching revision and serializes JSON without undefined properties', async () => {
    prismaMock.batchItem.findUnique
      .mockResolvedValueOnce(row(2))
      .mockResolvedValueOnce(row(3, { status: 'running' }))
    prismaMock.batchItem.updateMany.mockResolvedValue({ count: 1 })

    await expect(updateBatchItemForUser({
      itemId: 'item-1',
      expectedRevision: 2,
      patch: {
        status: 'running',
        executionKey: 'exec-1',
        stageOutputs: { storyboard: { optional: undefined, keep: true } },
      },
    })).resolves.toMatchObject({ revision: 3, status: 'running' })

    expect(prismaMock.batchItem.updateMany).toHaveBeenCalledWith({
      where: { id: 'item-1', revision: 2 },
      data: {
        revision: { increment: 1 },
        status: 'running',
        executionKey: 'exec-1',
        stageOutputs: { storyboard: { keep: true } },
      },
    })
  })

  it('throws STALE_REVISION without writing when the expected revision is old', async () => {
    prismaMock.batchItem.findUnique.mockResolvedValue(row(3))

    await expect(updateBatchItemForUser({
      itemId: 'item-1',
      expectedRevision: 2,
      patch: { status: 'failed' },
    })).rejects.toMatchObject({ code: 'STALE_REVISION', status: 409 })
    expect(prismaMock.batchItem.updateMany).not.toHaveBeenCalled()
  })

  it('throws STALE_REVISION when a concurrent write wins the user CAS', async () => {
    prismaMock.batchItem.findUnique.mockResolvedValue(row(2))
    prismaMock.batchItem.updateMany.mockResolvedValue({ count: 0 })

    await expect(updateBatchItemForUser({
      itemId: 'item-1',
      expectedRevision: 2,
      patch: { status: 'running' },
    })).rejects.toMatchObject({ code: 'STALE_REVISION' })
    expect(prismaMock.batchItem.updateMany).toHaveBeenCalledTimes(1)
  })

  it('recomputes a system patch on the latest row after one conflict', async () => {
    prismaMock.batchItem.findUnique
      .mockResolvedValueOnce(row(2, { errorMessage: 'old' }))
      .mockResolvedValueOnce(row(3, { errorMessage: 'newest' }))
      .mockResolvedValueOnce(row(4, { errorMessage: null }))
    prismaMock.batchItem.updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 })
    const seen: unknown[] = []

    await expect(updateBatchItemWithRetry('item-1', (latest) => {
      seen.push(latest.errorMessage)
      return { errorMessage: null }
    })).resolves.toMatchObject({ revision: 4 })

    expect(seen).toEqual(['old', 'newest'])
    expect(prismaMock.batchItem.updateMany.mock.calls.map(([args]) => args.where.revision)).toEqual([2, 3])
  })

  it('throws after continuous conflicts exhaust the retry budget', async () => {
    prismaMock.batchItem.findUnique.mockImplementation(async () => row(2))
    prismaMock.batchItem.updateMany.mockResolvedValue({ count: 0 })

    await expect(updateBatchItemWithRetry(
      'item-1',
      () => ({ status: 'running' }),
      { maxAttempts: 3 },
    )).rejects.toMatchObject({ code: 'STALE_REVISION' })
    expect(prismaMock.batchItem.updateMany).toHaveBeenCalledTimes(3)
  })

  it.each([null, undefined, {}])('does not write for an empty system mutation: %j', async (patch) => {
    prismaMock.batchItem.findUnique.mockResolvedValue(row(1))
    const current = await updateBatchItemWithRetry('item-1', () => patch)
    expect(current).toMatchObject({ revision: 1 })
    expect(prismaMock.batchItem.updateMany).not.toHaveBeenCalled()
  })

  it.each([0, undefined])('treats a legacy revision %s as zero', async (revision) => {
    prismaMock.batchItem.findUnique
      .mockResolvedValueOnce(row(revision))
      .mockResolvedValueOnce(row(1))
    prismaMock.batchItem.updateMany.mockResolvedValue({ count: 1 })

    await updateBatchItemForUser({
      itemId: 'item-1',
      expectedRevision: 0,
      patch: { status: 'running' },
    })
    expect(prismaMock.batchItem.updateMany.mock.calls[0][0].where).toEqual({ id: 'item-1', revision: 0 })
  })

  it('allows only one of two concurrent writers with the same expected revision', async () => {
    prismaMock.batchItem.findUnique.mockImplementation(async () => row(0))
    let remaining = 1
    prismaMock.batchItem.updateMany.mockImplementation(async () => {
      const count = remaining
      remaining = 0
      return { count }
    })

    const results = await Promise.allSettled([
      updateBatchItemForUser({ itemId: 'item-1', expectedRevision: 0, patch: { status: 'running' } }),
      updateBatchItemForUser({ itemId: 'item-1', expectedRevision: 0, patch: { status: 'failed' } }),
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
    expect(results.find((result) => result.status === 'rejected')).toMatchObject({
      reason: { code: 'STALE_REVISION' },
    })
  })

  it('scopes workspace reads through the owning BatchRun relation', async () => {
    prismaMock.batchItem.findFirst.mockResolvedValue(row(1))
    await expect(readBatchItemRow('item-1', 'owner-1')).resolves.toMatchObject({ id: 'item-1' })
    expect(prismaMock.batchItem.findFirst).toHaveBeenCalledWith({
      where: { id: 'item-1', batchRun: { userId: 'owner-1' } },
    })
    expect(prismaMock.batchItem.findUnique).not.toHaveBeenCalled()
  })
})

describe('mapBatchItemRow revision contract', () => {
  it('maps revision and executionKey, with legacy rows defaulting to revision zero', () => {
    const mapped = mapBatchItemRow({ ...row(undefined), revision: undefined, executionKey: undefined } as Parameters<typeof mapBatchItemRow>[0])
    expect(mapped.revision).toBe(0)
    expect(mapped.executionKey).toBeNull()
    expect(mapBatchItemRow(row(7, { executionKey: 'exec-7' }))).toMatchObject({
      revision: 7,
      executionKey: 'exec-7',
    })
  })
})
