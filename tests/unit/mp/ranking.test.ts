import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  mpWork: { findMany: vi.fn() },
  storyRelease: { findMany: vi.fn() },
}))
const redisMock = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/redis', () => ({ redis: redisMock }))
vi.mock('@/lib/storage/cdn', () => ({
  mpMediaUrl: vi.fn(async (key: string) => `https://cdn.example/${key}`),
  mpUrlExpiresAt: vi.fn(() => '2026-01-01T00:00:00Z'),
}))
vi.mock('@/lib/logging/core', () => ({
  createScopedLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), event: vi.fn(), child: vi.fn() }),
}))

import { ranking } from '@/lib/mp/catalog'
import { MP_RATING_MIN_COUNT, MP_RATING_PRIOR_M } from '@/lib/mp/constants'
import { bayesianRating, globalRatingAvg, hotScore, HOT_NEWNESS_DAYS, RATING_FALLBACK_AVG } from '@/lib/mp/ranking'

describe('hotScore (H.6)', () => {
  it('weights players + 2×completions + 3×shares + 2×favorites', () => {
    // base = 10 + 2×2 + 3×3 + 2×4 = 31
    expect(hotScore(10, 2, 3, 4, HOT_NEWNESS_DAYS)).toBe(31)
    expect(hotScore(10, 2, 3, 4, 0)).toBe(46.5)
    expect(hotScore(10, 2, 3, 4, 7)).toBe(31 * 1.25)
    expect(hotScore(0, 0, 0, 0, 0)).toBe(0)
  })

  it('newness decays linearly to 1 at day 14 and never goes below 1', () => {
    expect(HOT_NEWNESS_DAYS).toBe(14)
    expect(hotScore(1, 0, 0, 0, 0)).toBe(1.5)
    expect(hotScore(1, 0, 0, 0, 14)).toBe(1)
    expect(hotScore(1, 0, 0, 0, 28)).toBe(1)
    expect(hotScore(1, 0, 0, 0, 100)).toBe(1)
  })
})

describe('bayesianRating (H.6, m = 20)', () => {
  it('pulls small samples toward the global average', () => {
    expect(MP_RATING_PRIOR_M).toBe(20)
    // v=100 sum=450 C=4 → (100/120)×4.5 + (20/120)×4
    expect(bayesianRating(100, 450, 4)).toBeCloseTo((100 / 120) * 4.5 + (20 / 120) * 4, 10)
    // v=5 sum=25 C=4 → (5/25)×5 + (20/25)×4 = 4.2
    expect(bayesianRating(5, 25, 4)).toBeCloseTo(4.2, 10)
  })

  it('returns the global average when there are no ratings', () => {
    expect(bayesianRating(0, 0, 4.3)).toBe(4.3)
    expect(bayesianRating(-1, 0, 4.3)).toBe(4.3)
  })
})

describe('globalRatingAvg', () => {
  it('is the pooled mean with a 4.0 fallback', () => {
    expect(globalRatingAvg([{ ratingCount: 10, ratingSum: 40 }, { ratingCount: 30, ratingSum: 150 }])).toBeCloseTo(190 / 40, 10)
    expect(globalRatingAvg([])).toBe(RATING_FALLBACK_AVG)
    expect(globalRatingAvg([{ ratingCount: 0, ratingSum: 0 }])).toBe(4.0)
  })
})

const META = {
  title: '迷雾之城', tagline: '一夜之间', cover: 'mp/releases/r1/cover.jpg', accentColor: '#3366ff',
  tags: ['悬疑'], endings: [],
}

function workRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'w1', slug: 'abcd1234', status: 'live', scheduledAt: null, liveReleaseId: 'r1', pendingReleaseId: null,
    firstLiveAt: new Date('2026-11-01T00:00:00Z'), playerCount: 10, reserveCount: 0, ratingCount: 30, ratingScore: 4.5,
    ...overrides,
  }
}

describe('catalog ranking (H.6 C-side)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    redisMock.get.mockResolvedValue(null)
    redisMock.set.mockResolvedValue('OK')
    prismaMock.mpWork.findMany.mockResolvedValue([workRow()])
    prismaMock.storyRelease.findMany.mockResolvedValue([{ id: 'r1', meta: META }])
  })

  it('rejects unknown kinds', async () => {
    await expect(ranking('weekly')).rejects.toMatchObject({ code: 'MP_VALIDATION' })
    expect(prismaMock.mpWork.findMany).not.toHaveBeenCalled()
  })

  it('hot ranks live works by hotScore then players', async () => {
    await ranking('hot')
    expect(prismaMock.mpWork.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: 'live' }),
      orderBy: [{ hotScore: 'desc' }, { playerCount: 'desc' }, { id: 'asc' }],
      take: 50,
    }))
  })

  it('rating ranks only works with at least MP_RATING_MIN_COUNT ratings', async () => {
    const result = await ranking('rating')
    expect(prismaMock.mpWork.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: 'live', ratingCount: { gte: MP_RATING_MIN_COUNT } }),
      orderBy: [{ ratingScore: 'desc' }, { ratingCount: 'desc' }, { id: 'asc' }],
    }))
    expect(result.items[0].ratingScore).toBe(4.5)
  })

  it('hides the score on cards below the rating threshold', async () => {
    prismaMock.mpWork.findMany.mockResolvedValue([workRow({ ratingCount: MP_RATING_MIN_COUNT - 1, ratingScore: 5 })])
    const result = await ranking('hot')
    expect(result.items[0].ratingScore).toBeNull()
  })

  it('new ranks live works first-live within 30 days', async () => {
    await ranking('new')
    expect(prismaMock.mpWork.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: 'live', firstLiveAt: { gte: expect.any(Date) } }),
      orderBy: [{ firstLiveAt: 'desc' }, { id: 'asc' }],
    }))
    const where = prismaMock.mpWork.findMany.mock.calls[0][0].where as { firstLiveAt: { gte: Date } }
    expect(Date.now() - where.firstLiveAt.gte.getTime()).toBeGreaterThanOrEqual(30 * 24 * 3600 * 1000 - 5000)
    expect(Date.now() - where.firstLiveAt.gte.getTime()).toBeLessThanOrEqual(30 * 24 * 3600 * 1000 + 5000)
  })

  it('reserve ranks scheduled works by reserveCount and exposes the count', async () => {
    prismaMock.mpWork.findMany.mockResolvedValue([workRow({
      status: 'scheduled', liveReleaseId: null, pendingReleaseId: 'r1',
      scheduledAt: new Date('2026-12-01T00:00:00Z'), reserveCount: 7,
    })])
    const result = await ranking('reserve')
    expect(prismaMock.mpWork.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: 'scheduled' }),
      orderBy: [{ reserveCount: 'desc' }, { id: 'asc' }],
    }))
    expect(result.items[0]).toMatchObject({ status: 'scheduled', reserveCount: 7, scheduledAt: '2026-12-01T00:00:00.000Z' })
  })

  it('caches unsigned sources for 300s and signs covers after the cache read', async () => {
    const first = await ranking('hot')
    expect(first.items[0].cover).toBe('https://cdn.example/mp/releases/r1/cover.jpg')
    const setCall = redisMock.set.mock.calls.find(([key]) => String(key).includes(':rank:hot'))
    expect(setCall?.[2]).toBe('EX')
    expect(setCall?.[3]).toBe(300)
    expect(JSON.parse(String(setCall?.[1]))[0].coverKey).toBe('mp/releases/r1/cover.jpg')
    redisMock.get.mockImplementation(async (key: string) => (String(key).includes(':rank:hot') ? String(setCall?.[1]) : null))
    const second = await ranking('hot')
    expect(prismaMock.mpWork.findMany).toHaveBeenCalledTimes(1)
    expect(second.items[0].cover).toBe('https://cdn.example/mp/releases/r1/cover.jpg')
  })
})
