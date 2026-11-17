import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  mpWork: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  mpSubscription: { findMany: vi.fn(), update: vi.fn() },
  consumerUser: { findUnique: vi.fn() },
  storyRelease: { findUnique: vi.fn() },
  mpJobState: { findUnique: vi.fn() },
  mpEvent: { findMany: vi.fn() },
  mpWorkDailyStat: { upsert: vi.fn() },
  consumerSave: { groupBy: vi.fn() },
  consumerFavorite: { groupBy: vi.fn() },
  mpReservation: { groupBy: vi.fn() },
  $queryRaw: vi.fn(),
  $executeRaw: vi.fn(),
  $transaction: vi.fn(),
}))
const redisMock = vi.hoisted(() => ({ set: vi.fn(), del: vi.fn(), get: vi.fn(), incr: vi.fn(), lindex: vi.fn(), lpop: vi.fn() }))
const txMock = vi.hoisted(() => ({ $executeRaw: vi.fn(), mpJobState: { upsert: vi.fn() } }))
const goLive = vi.hoisted(() => vi.fn())
const sendSubscribe = vi.hoisted(() => vi.fn())

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/redis', () => ({ redis: redisMock }))
vi.mock('@/lib/logging/core', () => ({
  createScopedLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), event: vi.fn(), child: vi.fn() }),
}))
vi.mock('@/lib/mp/release/lifecycle', () => ({ goLive }))
vi.mock('@/lib/mp/wx', () => ({ sendSubscribe }))

import { aggregateDaily, aggregateEvents, dailyMaintenance, formatLiveTime, refreshWorkCounters, runMpJobs, runScheduledGoLive, sendNotifications } from '@/lib/mp/jobs'

const ENV_KEYS = ['MP_JOBS_ENABLED', 'MP_TPL_WORK_LIVE', 'MP_TPL_WORK_LIVE_FIELDS', 'MP_TPL_CHAPTER_UPDATE', 'MP_TPL_CHAPTER_UPDATE_FIELDS'] as const
let savedEnv: Record<string, string | undefined> = {}

const QUEUE_ITEM = JSON.stringify({ kind: 'work_live', mpWorkId: 'mpw1', releaseId: 'r1', enqueuedAt: '2026-11-17T00:00:00.000Z' })

beforeEach(() => {
  vi.clearAllMocks()
  vi.useRealTimers()
  savedEnv = {}
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key]
  process.env.MP_JOBS_ENABLED = '1'
  process.env.MP_TPL_WORK_LIVE = 'tpl1'
  process.env.MP_TPL_WORK_LIVE_FIELDS = JSON.stringify({ title: 'thing1', hint: 'thing2', time: 'time3' })
  process.env.MP_TPL_CHAPTER_UPDATE = 'tpl2'
  process.env.MP_TPL_CHAPTER_UPDATE_FIELDS = JSON.stringify({ title: 'thing4', hint: 'thing5', time: 'time6' })
  redisMock.set.mockResolvedValue('OK')
  redisMock.del.mockResolvedValue(1)
  redisMock.get.mockResolvedValue(null)
  redisMock.incr.mockResolvedValue(1)
  redisMock.lindex.mockResolvedValue(null)
  redisMock.lpop.mockResolvedValue(QUEUE_ITEM)
  prismaMock.mpWork.findMany.mockResolvedValue([])
  prismaMock.mpWork.findUnique.mockResolvedValue({ id: 'mpw1', slug: 'abcd1234', title: '测试作品' })
  prismaMock.mpWork.update.mockResolvedValue({ id: 'mpw1' })
  prismaMock.mpJobState.findUnique.mockResolvedValue(null)
  prismaMock.mpEvent.findMany.mockResolvedValue([])
  prismaMock.mpWorkDailyStat.upsert.mockResolvedValue({})
  prismaMock.consumerSave.groupBy.mockResolvedValue([])
  prismaMock.consumerFavorite.groupBy.mockResolvedValue([])
  prismaMock.mpReservation.groupBy.mockResolvedValue([])
  prismaMock.$queryRaw.mockResolvedValue([])
  prismaMock.$executeRaw.mockResolvedValue(0)
  prismaMock.$transaction.mockImplementation(async (fn: (tx: typeof txMock) => Promise<unknown>) => fn(txMock))
  txMock.$executeRaw.mockResolvedValue(1)
  txMock.mpJobState.upsert.mockResolvedValue({})
  prismaMock.storyRelease.findUnique.mockResolvedValue({ liveAt: new Date(2026, 10, 17, 9, 5) })
  prismaMock.mpSubscription.findMany.mockResolvedValue([])
  prismaMock.mpSubscription.update.mockResolvedValue({ id: 'sub1' })
  prismaMock.consumerUser.findUnique.mockResolvedValue({ openid: 'oABCDEF123' })
  goLive.mockResolvedValue(undefined)
  sendSubscribe.mockResolvedValue({ errcode: 0, errmsg: 'ok' })
})

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key]
    else process.env[key] = savedEnv[key]
  }
  vi.useRealTimers()
})

describe('formatLiveTime', () => {
  it('formats with zero-padded clock time', () => {
    expect(formatLiveTime(new Date(2026, 10, 17, 9, 5))).toBe('2026年11月17日 09:05')
    expect(formatLiveTime(new Date(2026, 0, 2, 3, 4))).toBe('2026年1月2日 03:04')
  })
})

describe('runScheduledGoLive', () => {
  it('goes live for due scheduled works under a lock', async () => {
    prismaMock.mpWork.findMany.mockResolvedValue([{ id: 'mpw1', pendingReleaseId: 'r1' }])
    await runScheduledGoLive()
    expect(redisMock.set).toHaveBeenCalledWith('mp:job:golive', '1', 'EX', 60, 'NX')
    expect(goLive).toHaveBeenCalledWith('r1')
    expect(redisMock.del).toHaveBeenCalledWith('mp:job:golive')
  })

  it('skips when the lock is held elsewhere', async () => {
    redisMock.set.mockResolvedValue(null)
    await runScheduledGoLive()
    expect(prismaMock.mpWork.findMany).not.toHaveBeenCalled()
    expect(goLive).not.toHaveBeenCalled()
    expect(redisMock.del).not.toHaveBeenCalled()
  })

  it('continues with the next work when one goLive fails', async () => {
    prismaMock.mpWork.findMany.mockResolvedValue([
      { id: 'm1', pendingReleaseId: 'r1' },
      { id: 'm2', pendingReleaseId: 'r2' },
    ])
    goLive.mockRejectedValueOnce(new Error('boom'))
    await runScheduledGoLive()
    expect(goLive).toHaveBeenCalledTimes(2)
    expect(goLive).toHaveBeenNthCalledWith(2, 'r2')
    expect(redisMock.del).toHaveBeenCalledWith('mp:job:golive')
  })
})

describe('sendNotifications', () => {
  it('does nothing on an empty queue', async () => {
    await sendNotifications()
    expect(redisMock.lpop).not.toHaveBeenCalled()
    expect(sendSubscribe).not.toHaveBeenCalled()
  })

  it('drops the item when the template is not configured', async () => {
    delete process.env.MP_TPL_WORK_LIVE
    redisMock.lindex.mockResolvedValue(QUEUE_ITEM)
    await sendNotifications()
    expect(sendSubscribe).not.toHaveBeenCalled()
    expect(redisMock.lpop).toHaveBeenCalledWith('mp:notify:queue')
  })

  it('drops the item when the work no longer exists', async () => {
    prismaMock.mpWork.findUnique.mockResolvedValue(null)
    redisMock.lindex.mockResolvedValue(QUEUE_ITEM)
    await sendNotifications()
    expect(sendSubscribe).not.toHaveBeenCalled()
    expect(redisMock.lpop).toHaveBeenCalledWith('mp:notify:queue')
  })

  it('drops malformed queue items without processing', async () => {
    redisMock.lindex.mockResolvedValue('not-json')
    await sendNotifications()
    expect(prismaMock.mpWork.findUnique).not.toHaveBeenCalled()
    expect(redisMock.lpop).toHaveBeenCalledTimes(1)
  })

  it('drops items with an unknown kind', async () => {
    redisMock.lindex.mockResolvedValue(JSON.stringify({ kind: 'daily', mpWorkId: 'mpw1', releaseId: 'r1' }))
    await sendNotifications()
    expect(prismaMock.mpWork.findUnique).not.toHaveBeenCalled()
    expect(redisMock.lpop).toHaveBeenCalledTimes(1)
  })

  it('sends work_live messages and consumes one credit', async () => {
    redisMock.lindex.mockResolvedValue(QUEUE_ITEM)
    prismaMock.mpSubscription.findMany.mockResolvedValue([{ id: 'sub1', consumerId: 'c1' }])
    await sendNotifications()
    expect(prismaMock.mpSubscription.findMany).toHaveBeenCalledTimes(1)
    expect(prismaMock.mpSubscription.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        mpWorkId: 'mpw1',
        kind: 'work_live',
        credits: { gt: 0 },
        OR: [{ lastSentRef: null }, { lastSentRef: { not: 'r1' } }],
      }),
    }))
    expect(sendSubscribe).toHaveBeenCalledWith('oABCDEF123', 'tpl1', 'pages/work/index?w=abcd1234&src=subscribe', {
      thing1: { value: '测试作品' },
      thing2: { value: '你预约的作品已上线，快来开始游玩' },
      time3: { value: '2026年11月17日 09:05' },
    })
    expect(prismaMock.mpSubscription.update).toHaveBeenCalledWith({ where: { id: 'sub1' }, data: { credits: { decrement: 1 }, lastSentRef: 'r1' } })
    expect(redisMock.lpop).toHaveBeenCalledTimes(1)
  })

  it('consumes a credit on 43101 (user refused) as well', async () => {
    redisMock.lindex.mockResolvedValue(QUEUE_ITEM)
    prismaMock.mpSubscription.findMany.mockResolvedValue([{ id: 'sub1', consumerId: 'c1' }])
    sendSubscribe.mockResolvedValue({ errcode: 43101, errmsg: 'refuse' })
    await sendNotifications()
    expect(prismaMock.mpSubscription.update).toHaveBeenCalledWith({ where: { id: 'sub1' }, data: { credits: { decrement: 1 }, lastSentRef: 'r1' } })
  })

  it('keeps the credit when sending fails with another errcode', async () => {
    redisMock.lindex.mockResolvedValue(QUEUE_ITEM)
    prismaMock.mpSubscription.findMany.mockResolvedValue([{ id: 'sub1', consumerId: 'c1' }])
    sendSubscribe.mockResolvedValue({ errcode: 40001, errmsg: 'bad token' })
    await sendNotifications()
    expect(prismaMock.mpSubscription.update).not.toHaveBeenCalled()
    expect(redisMock.lpop).toHaveBeenCalledTimes(1)
  })

  it('truncates long titles to 20 characters', async () => {
    redisMock.lindex.mockResolvedValue(QUEUE_ITEM)
    prismaMock.mpWork.findUnique.mockResolvedValue({ id: 'mpw1', slug: 'abcd1234', title: '一二三四五六七八九十一二三四五六七八九十一二三四' })
    prismaMock.mpSubscription.findMany.mockResolvedValue([{ id: 'sub1', consumerId: 'c1' }])
    await sendNotifications()
    const data = sendSubscribe.mock.calls[0][3] as Record<string, { value: string }>
    expect(data.thing1.value).toBe('一二三四五六七八九十一二三四五六七八九十')
    expect([...data.thing1.value]).toHaveLength(20)
  })

  it('uses the chapter_update template and hint', async () => {
    redisMock.lindex.mockResolvedValue(JSON.stringify({ kind: 'chapter_update', mpWorkId: 'mpw1', releaseId: 'r2' }))
    prismaMock.mpSubscription.findMany.mockResolvedValue([{ id: 'sub1', consumerId: 'c1' }])
    await sendNotifications()
    expect(sendSubscribe).toHaveBeenCalledWith('oABCDEF123', 'tpl2', 'pages/work/index?w=abcd1234&src=subscribe', {
      thing4: { value: '测试作品' },
      thing5: { value: '新章节已上线，快来继续你的故事' },
      time6: { value: '2026年11月17日 09:05' },
    })
    expect(prismaMock.mpSubscription.update).toHaveBeenCalledWith({ where: { id: 'sub1' }, data: { credits: { decrement: 1 }, lastSentRef: 'r2' } })
  })

  it('paginates with a cursor when a full page is returned', async () => {
    vi.useFakeTimers()
    redisMock.lindex.mockResolvedValue(QUEUE_ITEM)
    const page = Array.from({ length: 200 }, (_, i) => ({ id: `sub${String(i + 1).padStart(3, '0')}`, consumerId: 'c1' }))
    prismaMock.mpSubscription.findMany.mockResolvedValueOnce(page).mockResolvedValueOnce([{ id: 'sub201', consumerId: 'c1' }])
    const done = sendNotifications()
    await vi.advanceTimersByTimeAsync(20_000)
    await done
    expect(prismaMock.mpSubscription.findMany).toHaveBeenCalledTimes(2)
    expect(prismaMock.mpSubscription.findMany.mock.calls[1][0]).toMatchObject({ cursor: { id: 'sub200' }, skip: 1 })
    expect(sendSubscribe).toHaveBeenCalledTimes(201)
    expect(redisMock.lpop).toHaveBeenCalledTimes(1)
  })
})

describe('runMpJobs', () => {
  it('does nothing unless MP_JOBS_ENABLED is 1', async () => {
    process.env.MP_JOBS_ENABLED = '0'
    await runMpJobs()
    expect(redisMock.set).not.toHaveBeenCalled()
    expect(redisMock.get).not.toHaveBeenCalled()
    process.env.MP_JOBS_ENABLED = ' 1 '
    await runMpJobs()
    expect(redisMock.set).toHaveBeenCalledWith('mp:job:golive', '1', 'EX', 60, 'NX')
    expect(redisMock.set).toHaveBeenCalledWith('mp:job:notify', '1', 'EX', 300, 'NX')
  })

  it('runs the jobs and swallows their failures', async () => {
    redisMock.set.mockRejectedValue(new Error('redis down'))
    redisMock.get.mockRejectedValue(new Error('redis down'))
    await expect(runMpJobs()).resolves.toBeUndefined()
    expect(redisMock.set).toHaveBeenCalledWith('mp:job:golive', '1', 'EX', 60, 'NX')
    expect(redisMock.set).toHaveBeenCalledWith('mp:job:notify', '1', 'EX', 300, 'NX')
  })

  it('skips stats jobs whose next-run key is still in the future', async () => {
    redisMock.get.mockImplementation(async (key: string) => (key.endsWith(':next') ? String(Date.now() + 600000) : null))
    await runMpJobs()
    expect(prismaMock.mpJobState.findUnique).not.toHaveBeenCalled()
    expect(prismaMock.$queryRaw).not.toHaveBeenCalled()
    expect(prismaMock.mpWork.update).not.toHaveBeenCalled()
  })
})

describe('aggregateEvents', () => {
  it('skips when the lock is held elsewhere', async () => {
    redisMock.set.mockResolvedValue(null)
    await aggregateEvents()
    expect(prismaMock.mpJobState.findUnique).not.toHaveBeenCalled()
    expect(redisMock.del).not.toHaveBeenCalled()
  })

  it('reads the watermark and does nothing on an empty batch', async () => {
    prismaMock.mpJobState.findUnique.mockResolvedValue({ key: 'agg.lastEventId', value: '42' })
    await aggregateEvents()
    expect(prismaMock.mpEvent.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { gt: BigInt(42) } }, take: 50000 }))
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
    expect(redisMock.del).toHaveBeenCalledWith('mp:job:agg')
  })

  it('advances the watermark inside the same transaction as the counters', async () => {
    prismaMock.mpEvent.findMany.mockResolvedValue([
      { id: BigInt(7), name: 'play_start', mpWorkId: 'w1', nodeId: null, optionId: null, flag: null, shareId: null },
    ])
    await aggregateEvents()
    expect(txMock.$executeRaw).not.toHaveBeenCalled()
    expect(txMock.mpJobState.upsert).toHaveBeenCalledWith({
      where: { key: 'agg.lastEventId' },
      create: { key: 'agg.lastEventId', value: '7' },
      update: { value: '7' },
    })
  })
})

describe('aggregateDaily', () => {
  it('recomputes yesterday and today as Beijing days and upserts idempotently', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-17T12:00:00Z'))
    prismaMock.$queryRaw
      .mockResolvedValueOnce([{ mpWorkId: 'w1', views: 10, starts: 5, players: 4, completions: 2, shares: 1, watchSec: 600, favorites: 1, reserves: 0 }])
      .mockResolvedValueOnce([{ mpWorkId: 'w1', n: 2 }])
      .mockResolvedValueOnce([{ mpWorkId: 'w1', n: 3 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
    await aggregateDaily()
    expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(6)
    const firstWindow = prismaMock.$queryRaw.mock.calls[0].slice(1)
    expect(firstWindow[0]).toEqual(new Date('2026-11-15T16:00:00Z'))
    expect(firstWindow[1]).toEqual(new Date('2026-11-16T16:00:00Z'))
    const data = { views: 10, starts: 5, players: 4, completions: 2, shares: 1, shareOpens: 3, newUsers: 2, watchSec: 600, favorites: 1, reserves: 0 }
    expect(prismaMock.mpWorkDailyStat.upsert).toHaveBeenCalledTimes(1)
    expect(prismaMock.mpWorkDailyStat.upsert).toHaveBeenCalledWith({
      where: { mpWorkId_date: { mpWorkId: 'w1', date: new Date('2026-11-16T00:00:00Z') } },
      create: { mpWorkId: 'w1', date: new Date('2026-11-16T00:00:00Z'), ...data },
      update: data,
    })
  })
})

describe('refreshWorkCounters', () => {
  it('recomputes counters with the H.6 formulas and bumps the cache version', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-17T12:00:00Z'))
    prismaMock.mpWork.findMany.mockResolvedValue([
      { id: 'w1', firstLiveAt: new Date('2026-11-15T12:00:00Z'), ratingCount: 10, ratingSum: 45 },
      { id: 'w2', firstLiveAt: null, ratingCount: 0, ratingSum: 0 },
    ])
    prismaMock.consumerSave.groupBy.mockResolvedValue([{ mpWorkId: 'w1', _count: { _all: 7 } }])
    prismaMock.$queryRaw.mockResolvedValue([{ mpWorkId: 'w1', players: 5, completions: 2, shares: 1, favorites: 3 }])
    await refreshWorkCounters()
    expect(prismaMock.mpWork.update).toHaveBeenCalledTimes(2)
    const w1 = prismaMock.mpWork.update.mock.calls[0][0] as { where: { id: string }; data: Record<string, number> }
    expect(w1.where).toEqual({ id: 'w1' })
    expect(w1.data.playerCount).toBe(7)
    expect(w1.data.players7d).toBe(5)
    expect(w1.data.hotScore).toBeCloseTo(18 * (1 + 0.5 * (1 - 2 / 14)), 6)
    expect(w1.data.ratingScore).toBeCloseTo(4.5, 6)
    const w2 = prismaMock.mpWork.update.mock.calls[1][0] as { data: Record<string, number> }
    expect(w2.data).toEqual({ playerCount: 0, players7d: 0, hotScore: 0, ratingScore: 4.5 })
    expect(redisMock.incr).toHaveBeenCalledWith('mp:cache:ver')
  })
})

describe('dailyMaintenance', () => {
  it('only runs inside the 03:00–03:10 Beijing window', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-17T12:00:00Z'))
    await dailyMaintenance()
    expect(redisMock.set).not.toHaveBeenCalled()
  })

  it('runs at most once per day', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-16T19:05:00Z'))
    redisMock.set.mockResolvedValue(null)
    await dailyMaintenance()
    expect(prismaMock.mpWork.findMany).not.toHaveBeenCalled()
  })

  it('recounts favorites and reserves and deletes old events in batches', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-16T19:05:00Z'))
    prismaMock.mpWork.findMany.mockResolvedValue([{ id: 'w1', favoriteCount: 5, reserveCount: 2 }])
    prismaMock.consumerFavorite.groupBy.mockResolvedValue([{ mpWorkId: 'w1', _count: { _all: 3 } }])
    prismaMock.mpReservation.groupBy.mockResolvedValue([])
    prismaMock.$executeRaw.mockResolvedValueOnce(5000).mockResolvedValueOnce(12)
    const done = dailyMaintenance()
    await vi.advanceTimersByTimeAsync(400)
    await done
    expect(redisMock.set).toHaveBeenCalledWith('mp:job:maint:2026-11-17', '1', 'EX', 86400, 'NX')
    expect(prismaMock.mpWork.update).toHaveBeenCalledWith({ where: { id: 'w1' }, data: { favoriteCount: 3, reserveCount: 0 } })
    expect(prismaMock.$executeRaw).toHaveBeenCalledTimes(2)
    const cutoff = prismaMock.$executeRaw.mock.calls[0][1] as Date
    expect(cutoff.toISOString()).toBe('2026-08-18T19:05:00.000Z')
  })
})
