import { Prisma } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  queryRaw: vi.fn(),
  logWarn: vi.fn(),
  logInfo: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    project: { findUnique: mocks.findUnique },
    $queryRaw: mocks.queryRaw,
  },
}))
vi.mock('@/lib/logging/core', () => ({
  logWarn: mocks.logWarn,
  logInfo: mocks.logInfo,
}))

import { snapshotProjectCostsBeforePurge } from '@/lib/compute-ledger/sync'

const p2021 = () => new Prisma.PrismaClientKnownRequestError('ledger tables missing', { code: 'P2021', clientVersion: '6.19.2' })

const linkedProject = { workId: 'w1', work: { workspaceOwnerId: 'owner-1', name: '作品' } }

beforeEach(() => {
  vi.clearAllMocks()
})

describe('snapshotProjectCostsBeforePurge', () => {
  it('returns silently when the project has no work linkage', async () => {
    mocks.findUnique.mockResolvedValueOnce({ workId: null, work: null })
    await expect(snapshotProjectCostsBeforePurge('p1')).resolves.toBeUndefined()
    expect(mocks.queryRaw).not.toHaveBeenCalled()
    expect(mocks.logWarn).not.toHaveBeenCalled()
  })

  it('returns silently when the project row is already gone', async () => {
    mocks.findUnique.mockResolvedValueOnce(null)
    await expect(snapshotProjectCostsBeforePurge('p1')).resolves.toBeUndefined()
    expect(mocks.queryRaw).not.toHaveBeenCalled()
  })

  it('returns without snapshotting when the project has no usage costs', async () => {
    mocks.findUnique.mockResolvedValueOnce(linkedProject)
    mocks.queryRaw.mockResolvedValueOnce([{ minAt: null, maxAt: null }])
    await expect(snapshotProjectCostsBeforePurge('p1')).resolves.toBeUndefined()
    expect(mocks.queryRaw).toHaveBeenCalledTimes(1)
    expect(mocks.logWarn).not.toHaveBeenCalled()
  })

  it('swallows P2021 (tables not migrated yet) with a warning instead of blocking purge', async () => {
    mocks.findUnique.mockResolvedValueOnce(linkedProject)
    mocks.queryRaw.mockRejectedValueOnce(p2021())
    await expect(snapshotProjectCostsBeforePurge('p1')).resolves.toBeUndefined()
    expect(mocks.logWarn).toHaveBeenCalledTimes(1)
    expect(mocks.logWarn.mock.calls[0][1]).toMatchObject({ projectId: 'p1' })
  })

  it('swallows P2021 raised while reading the project row itself', async () => {
    mocks.findUnique.mockRejectedValueOnce(p2021())
    await expect(snapshotProjectCostsBeforePurge('p1')).resolves.toBeUndefined()
    expect(mocks.logWarn).toHaveBeenCalledTimes(1)
  })

  it('rethrows any non-P2021 error so purge fails and retries (never lose the ledger)', async () => {
    mocks.findUnique.mockResolvedValueOnce(linkedProject)
    mocks.queryRaw.mockRejectedValueOnce(new Error('db connection lost'))
    await expect(snapshotProjectCostsBeforePurge('p1')).rejects.toThrow('db connection lost')
    expect(mocks.logWarn).not.toHaveBeenCalled()
  })

  it('rethrows a different Prisma known error (e.g. P2002) rather than treating it as missing tables', async () => {
    mocks.findUnique.mockResolvedValueOnce(linkedProject)
    mocks.queryRaw.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: '6.19.2' }))
    await expect(snapshotProjectCostsBeforePurge('p1')).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError)
    expect(mocks.logWarn).not.toHaveBeenCalled()
  })
})
