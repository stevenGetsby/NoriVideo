import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  mpWork: { findUnique: vi.fn(), findMany: vi.fn() },
  mpWorkDailyStat: { findMany: vi.fn() },
  storyRelease: { findUnique: vi.fn() },
  mpBranchStat: { findMany: vi.fn() },
  mpEvent: { groupBy: vi.fn(), count: vi.fn(), findMany: vi.fn() },
  mpChannel: { findMany: vi.fn() },
  mpTopic: { findMany: vi.fn() },
  consumerUser: { groupBy: vi.fn(), count: vi.fn() },
  $queryRaw: vi.fn(),
}))
const redisMock = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/redis', () => ({ redis: redisMock }))

import { adminStats, creatorStats } from '@/lib/mp/stats'

const NOW = new Date('2026-11-17T12:00:00Z')

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  redisMock.get.mockResolvedValue(null)
  redisMock.set.mockResolvedValue('OK')
  prismaMock.$queryRaw.mockResolvedValue([])
  prismaMock.mpEvent.groupBy.mockResolvedValue([])
  prismaMock.mpEvent.count.mockResolvedValue(0)
  prismaMock.mpEvent.findMany.mockResolvedValue([])
  prismaMock.mpChannel.findMany.mockResolvedValue([])
  prismaMock.mpTopic.findMany.mockResolvedValue([])
  prismaMock.mpWork.findMany.mockResolvedValue([])
  prismaMock.consumerUser.groupBy.mockResolvedValue([])
  prismaMock.consumerUser.count.mockResolvedValue(0)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('creatorStats', () => {
  beforeEach(() => {
    prismaMock.mpWork.findUnique.mockResolvedValue({ id: 'w1', playerCount: 100, liveReleaseId: 'r1' })
    prismaMock.mpWorkDailyStat.findMany.mockResolvedValue([
      { date: new Date('2026-11-16T00:00:00Z'), views: 10, starts: 5, players: 4, completions: 2, shares: 1, shareOpens: 0, newUsers: 2, watchSec: 600, favorites: 0, reserves: 0 },
      { date: new Date('2026-11-17T00:00:00Z'), views: 20, starts: 10, players: 6, completions: 4, shares: 2, shareOpens: 0, newUsers: 3, watchSec: 1200, favorites: 0, reserves: 0 },
    ])
    prismaMock.$queryRaw.mockResolvedValue([{ players: BigInt(8) }])
    prismaMock.storyRelease.findUnique.mockResolvedValue({
      program: {
        chapters: [{
          nodes: [
            { id: 'e1', kind: 'ending', title: '真结局', endingType: 'hidden' },
            { id: 'n1', kind: 'choice', title: '关键抉择', options: [{ id: 'a', label: '向左' }, { id: 'b', label: '向右' }] },
            { id: 's1', kind: 'scene', title: '开场' },
          ],
        }],
      },
    })
    prismaMock.mpBranchStat.findMany.mockResolvedValue([
      { nodeId: 'e1', optionId: '', count: 60 },
      { nodeId: 'n1', optionId: 'a', count: 20 },
      { nodeId: 'n1', optionId: 'b', count: 10 },
    ])
    prismaMock.mpEvent.groupBy.mockResolvedValue([{ nodeId: 's1', _count: { _all: 7 } }])
    prismaMock.mpChannel.findMany.mockResolvedValue([{ id: 'ch1', code: '234abc', name: '公众号', createdAt: NOW }])
    prismaMock.consumerUser.groupBy.mockResolvedValue([{ firstChannelId: 'ch1', _count: { _all: 2 } }])
    prismaMock.mpEvent.findMany.mockResolvedValue([
      { consumerId: 'c1', channelId: 'ch1' },
      { consumerId: 'c2', channelId: 'ch1' },
    ])
  })

  it('returns 404 when the work is not published', async () => {
    prismaMock.mpWork.findUnique.mockResolvedValue(null)
    await expect(creatorStats('missing', '7d')).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('sums daily stats, resolves program titles and zero-fills the day axis', async () => {
    const stats = await creatorStats('work1', '7d')
    expect(stats.kpis).toEqual({ views: 30, starts: 15, players: 8, completionRate: 0.4, avgWatchMin: 3.8, shares: 3, newUsers: 5 })
    expect(stats.daily).toHaveLength(7)
    expect(stats.daily[0]).toEqual({ date: '2026-11-11', players: 0, starts: 0, completions: 0 })
    expect(stats.daily[5]).toEqual({ date: '2026-11-16', players: 4, starts: 5, completions: 2 })
    expect(stats.daily[6]).toEqual({ date: '2026-11-17', players: 6, starts: 10, completions: 4 })
    expect(stats.endings).toEqual([{ nodeId: 'e1', title: '真结局', endingType: 'hidden', count: 60, pct: 60 }])
    expect(stats.choices).toEqual([{
      nodeId: 'n1',
      title: '关键抉择',
      options: [
        { optionId: 'a', label: '向左', count: 20, pct: 66.7 },
        { optionId: 'b', label: '向右', count: 10, pct: 33.3 },
      ],
    }])
    expect(stats.dropoffs).toEqual([{ nodeId: 's1', title: '开场', exits: 7 }])
    expect(stats.channels).toEqual([{ code: '234abc', name: '公众号', newUsers: 2, players: 2 }])
    expect(redisMock.set).toHaveBeenCalledWith('mp:cache:stats:w1:7d', expect.any(String), 'EX', 600)
  })

  it('keys the cache by range and serves hits without querying', async () => {
    await creatorStats('work1', '30d')
    expect(stats_dailyLength()).toBe(30)
    expect(redisMock.set).toHaveBeenCalledWith('mp:cache:stats:w1:30d', expect.any(String), 'EX', 600)

    const cached = { kpis: { views: 1, starts: 0, players: 0, completionRate: 0, avgWatchMin: 0, shares: 0, newUsers: 0 }, daily: [], endings: [], choices: [], dropoffs: [], channels: [] }
    redisMock.get.mockResolvedValue(JSON.stringify(cached))
    const hit = await creatorStats('work1', '7d')
    expect(hit).toEqual(cached)
    expect(prismaMock.mpWorkDailyStat.findMany).toHaveBeenCalledTimes(1)
  })

  function stats_dailyLength(): number {
    const payload = JSON.parse(redisMock.set.mock.calls[0][1] as string) as { daily: unknown[] }
    return payload.daily.length
  }
})

describe('adminStats', () => {
  it('aggregates platform KPIs, rankings, sources and channels', async () => {
    prismaMock.consumerUser.count.mockResolvedValueOnce(12).mockResolvedValueOnce(4)
    prismaMock.mpEvent.count.mockResolvedValueOnce(100).mockResolvedValueOnce(40).mockResolvedValueOnce(10)
    prismaMock.$queryRaw
      .mockResolvedValueOnce([{ n: BigInt(30) }])
      .mockResolvedValueOnce([{ day: '2026-11-17', n: 12 }])
      .mockResolvedValueOnce([{ day: '2026-11-17', n: 40 }])
      .mockResolvedValueOnce([{ mpWorkId: 'w1', players: BigInt(8), starts: BigInt(15), completions: BigInt(6), shares: BigInt(3) }])
    prismaMock.consumerUser.groupBy
      .mockResolvedValueOnce([{ firstSource: 'share', _count: { _all: 7 } }, { firstSource: null, _count: { _all: 5 } }])
      .mockResolvedValueOnce([{ firstChannelId: 'ch1', _count: { _all: 2 } }])
    prismaMock.mpChannel.findMany.mockResolvedValue([
      { id: 'ch1', name: '公众号推文', mpWorkId: 'w1', topicId: null },
      { id: 'ch2', name: '专题渠道', mpWorkId: null, topicId: 't1' },
      { id: 'ch3', name: '首页渠道', mpWorkId: null, topicId: null },
    ])
    prismaMock.mpWork.findMany.mockResolvedValue([{ id: 'w1', title: '测试作品', ratingScore: 4.5, ratingCount: 10 }])
    prismaMock.mpTopic.findMany.mockResolvedValue([{ id: 't1', title: '悬疑专题' }])
    prismaMock.mpEvent.findMany.mockResolvedValue([{ consumerId: 'c1', channelId: 'ch1' }])

    const stats = await adminStats('7d')
    expect(stats.kpis).toEqual({ newUsers: 12, activeUsers: 30, starts: 100, completions: 40, shares: 10, shareNewUsers: 4 })
    expect(stats.daily).toHaveLength(7)
    expect(stats.daily[6]).toEqual({ date: '2026-11-17', newUsers: 12, starts: 40 })
    expect(stats.works).toEqual([{ title: '测试作品', players: 8, completionRate: 0.4, shares: 3, ratingScore: 4.5, ratingCount: 10 }])
    expect(stats.sources).toEqual([{ source: 'share', newUsers: 7 }, { source: 'other', newUsers: 5 }])
    expect(stats.channels).toEqual([
      { name: '公众号推文', target: '测试作品', newUsers: 2, players: 1 },
      { name: '专题渠道', target: '悬疑专题', newUsers: 0, players: 0 },
      { name: '首页渠道', target: '首页', newUsers: 0, players: 0 },
    ])
    expect(redisMock.set).toHaveBeenCalledWith('mp:stats:admin:7d', expect.any(String), 'EX', 300)
  })
})
