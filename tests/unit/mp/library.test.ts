import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  consumerSave: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  consumerFavorite: { findUnique: vi.fn(), create: vi.fn(), delete: vi.fn() },
  consumerRating: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  mpWork: { update: vi.fn(), findUnique: vi.fn(), aggregate: vi.fn() },
  mpReport: { create: vi.fn() },
  $transaction: vi.fn(),
}))
const workBySlug = vi.hoisted(() => vi.fn())

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/mp/catalog', () => ({ workBySlug }))

import { createReport, getSave, putSave, setFavorite, setRating } from '@/lib/mp/library'

const WORK = { id: 'mpw1', slug: 'abcd1234', status: 'live', liveReleaseId: 'r1' }

beforeEach(() => {
  vi.clearAllMocks()
  workBySlug.mockResolvedValue({ ...WORK })
  prismaMock.$transaction.mockImplementation(async (arg: unknown) => {
    if (typeof arg === 'function') return (arg as (tx: unknown) => Promise<unknown>)(prismaMock)
    return Promise.all(arg as Promise<unknown>[])
  })
  prismaMock.consumerSave.findUnique.mockResolvedValue(null)
  prismaMock.consumerSave.create.mockResolvedValue({ id: 's1' })
  prismaMock.consumerSave.update.mockResolvedValue({ id: 's1' })
  prismaMock.consumerFavorite.findUnique.mockResolvedValue(null)
  prismaMock.consumerFavorite.create.mockResolvedValue({ id: 'f1' })
  prismaMock.consumerFavorite.delete.mockResolvedValue({ id: 'f1' })
  prismaMock.consumerRating.findUnique.mockResolvedValue(null)
  prismaMock.consumerRating.create.mockResolvedValue({ id: 'r1' })
  prismaMock.consumerRating.update.mockResolvedValue({ id: 'r1' })
  prismaMock.mpWork.update.mockResolvedValue({ ...WORK })
  prismaMock.mpWork.findUnique.mockResolvedValue({ ratingCount: 10, ratingSum: 50 })
  prismaMock.mpWork.aggregate.mockResolvedValue({ _sum: { ratingCount: 100, ratingSum: 400 } })
  prismaMock.mpReport.create.mockResolvedValue({ id: 'rep1' })
})

describe('getSave', () => {
  it('returns rev 0 and empty engine state when there is no save', async () => {
    const save = await getSave('abcd1234', 'c1')
    expect(save.rev).toBe(0)
    expect(save.releaseId).toBeNull()
    expect(save.profile).toEqual({ endings: [], segments: [], achievements: [], bought: [], equipped: { title: null, frame: null } })
    expect(save.permanent).toEqual({})
  })

  it('returns the stored row when present', async () => {
    prismaMock.consumerSave.findUnique.mockResolvedValue({ rev: 4, releaseId: 'r1', profile: { endings: ['p1:a'] }, saves: { auto: null }, permanent: { n: 2 } })
    const save = await getSave('abcd1234', 'c1')
    expect(save).toMatchObject({ rev: 4, releaseId: 'r1', permanent: { n: 2 } })
  })
})

describe('putSave', () => {
  const body = { baseRev: 0, releaseId: 'r1', profile: { endings: ['p1:b'] }, saves: {}, permanent: {}, progress: 0.5, endingsGot: 1 }

  it('creates rev 1 and bumps playerCount on first save', async () => {
    const result = await putSave('abcd1234', 'c1', body)
    expect(result.rev).toBe(1)
    expect(result.merged).toBe(false)
    expect(prismaMock.consumerSave.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ rev: 1, progress: 0.5, endingsGot: 1 }) }))
    expect(prismaMock.mpWork.update).toHaveBeenCalledWith({ where: { id: 'mpw1' }, data: { playerCount: { increment: 1 } } })
  })

  it('overwrites without merging when baseRev matches, and increments rev', async () => {
    prismaMock.consumerSave.findUnique.mockResolvedValue({ id: 's1', rev: 3, profile: { endings: ['p1:a'] }, saves: {}, permanent: {} })
    const result = await putSave('abcd1234', 'c1', { ...body, baseRev: 3 })
    expect(result.rev).toBe(4)
    expect(result.merged).toBe(false)
    expect(result.profile.endings).toEqual(['p1:b'])
  })

  it('merges server and client when baseRev is stale, and increments rev', async () => {
    prismaMock.consumerSave.findUnique.mockResolvedValue({ id: 's1', rev: 5, profile: { endings: ['p1:a'] }, saves: {}, permanent: { n: 5 } })
    const result = await putSave('abcd1234', 'c1', { ...body, baseRev: 3, permanent: { n: 3 } })
    expect(result.rev).toBe(6)
    expect(result.merged).toBe(true)
    expect(result.profile.endings).toEqual(['p1:a', 'p1:b'])
    expect(result.permanent.n).toBe(5)
  })

  it('rejects an invalid baseRev', async () => {
    await expect(putSave('abcd1234', 'c1', { ...body, baseRev: -1 })).rejects.toMatchObject({ code: 'MP_VALIDATION' })
    await expect(putSave('abcd1234', 'c1', { ...body, releaseId: '' })).rejects.toMatchObject({ code: 'MP_VALIDATION' })
  })
})

describe('setFavorite', () => {
  it('creates and increments favoriteCount only when not already favorited', async () => {
    await setFavorite('abcd1234', 'c1', true)
    expect(prismaMock.consumerFavorite.create).toHaveBeenCalledWith({ data: { consumerId: 'c1', mpWorkId: 'mpw1' } })
    expect(prismaMock.mpWork.update).toHaveBeenCalledWith({ where: { id: 'mpw1' }, data: { favoriteCount: { increment: 1 } } })
  })

  it('is a no-op when already favorited', async () => {
    prismaMock.consumerFavorite.findUnique.mockResolvedValue({ id: 'f1' })
    const result = await setFavorite('abcd1234', 'c1', true)
    expect(result.favorited).toBe(true)
    expect(prismaMock.consumerFavorite.create).not.toHaveBeenCalled()
  })

  it('deletes and decrements favoriteCount when unfavoriting an existing favorite', async () => {
    prismaMock.consumerFavorite.findUnique.mockResolvedValue({ id: 'f1' })
    await setFavorite('abcd1234', 'c1', false)
    expect(prismaMock.consumerFavorite.delete).toHaveBeenCalledWith({ where: { id: 'f1' } })
    expect(prismaMock.mpWork.update).toHaveBeenCalledWith({ where: { id: 'mpw1' }, data: { favoriteCount: { decrement: 1 } } })
  })
})

describe('setRating', () => {
  it('creates a rating, bumps count and sum, and stores the Bayesian score', async () => {
    const result = await setRating('abcd1234', 'c1', 5)
    expect(result.score).toBe(5)
    expect(prismaMock.mpWork.update).toHaveBeenCalledWith({ where: { id: 'mpw1' }, data: { ratingCount: { increment: 1 }, ratingSum: { increment: 5 } } })
    // v=10, R=5, C=400/100=4, m=20 → (10/30)*5 + (20/30)*4 = 4.3333
    const scoreUpdate = prismaMock.mpWork.update.mock.calls.at(-1)?.[0] as { data: { ratingScore: number } }
    expect(scoreUpdate.data.ratingScore).toBeCloseTo(4.3333, 3)
  })

  it('adjusts only the sum when changing an existing rating', async () => {
    prismaMock.consumerRating.findUnique.mockResolvedValue({ id: 'r1', score: 3 })
    await setRating('abcd1234', 'c1', 5)
    expect(prismaMock.consumerRating.update).toHaveBeenCalledWith({ where: { id: 'r1' }, data: { score: 5 } })
    expect(prismaMock.mpWork.update).toHaveBeenCalledWith({ where: { id: 'mpw1' }, data: { ratingSum: { increment: 2 } } })
  })

  it('rejects scores outside 1..5', async () => {
    await expect(setRating('abcd1234', 'c1', 0)).rejects.toMatchObject({ code: 'MP_VALIDATION' })
    await expect(setRating('abcd1234', 'c1', 6)).rejects.toMatchObject({ code: 'MP_VALIDATION' })
    await expect(setRating('abcd1234', 'c1', 4.5)).rejects.toMatchObject({ code: 'MP_VALIDATION' })
  })
})

describe('createReport', () => {
  it('stores a report with a valid reason', async () => {
    const result = await createReport('abcd1234', 'c1', 'vulgar', '  低俗内容  ')
    expect(result.ok).toBe(true)
    expect(prismaMock.mpReport.create).toHaveBeenCalledWith({ data: { consumerId: 'c1', mpWorkId: 'mpw1', reason: 'vulgar', detail: '低俗内容' } })
  })

  it('rejects an unknown reason or an over-long detail', async () => {
    await expect(createReport('abcd1234', 'c1', 'spam', '')).rejects.toMatchObject({ code: 'MP_VALIDATION' })
    await expect(createReport('abcd1234', 'c1', 'other', 'x'.repeat(201))).rejects.toMatchObject({ code: 'MP_VALIDATION' })
  })
})
