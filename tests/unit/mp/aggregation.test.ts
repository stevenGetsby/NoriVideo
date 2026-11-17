import { beforeEach, describe, expect, it, vi } from 'vitest'

const txMock = vi.hoisted(() => ({ $executeRaw: vi.fn(), mpJobState: { upsert: vi.fn() } }))
const prismaMock = vi.hoisted(() => ({
  mpJobState: { findUnique: vi.fn() },
  mpEvent: { findMany: vi.fn() },
  mpWork: { findFirst: vi.fn() },
  mpBranchStat: { findMany: vi.fn() },
  $transaction: vi.fn(),
}))
const redisMock = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), del: vi.fn() }))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/redis', () => ({ redis: redisMock }))
vi.mock('@/lib/logging/core', () => ({
  createScopedLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), event: vi.fn(), child: vi.fn() }),
}))
vi.mock('@/lib/mp/release/lifecycle', () => ({ goLive: vi.fn() }))
vi.mock('@/lib/mp/wx', () => ({ sendSubscribe: vi.fn() }))

import { aggregateEvents } from '@/lib/mp/jobs'
import { releaseStats } from '@/lib/mp/stats'

// 固定样本，手算期望：
// (w1,n1,a)=2、(w1,n1,b)=1、(w1,e1,'')=1（flag=false 的 ending_reached 不计）、
// share abcd1234AB opens+2、水位推进到 9；play_start 与缺 mpWorkId 的 choice_made 不参与聚合。
const SAMPLE = [
  { id: BigInt(1), name: 'choice_made', mpWorkId: 'w1', nodeId: 'n1', optionId: 'a', flag: null, shareId: null },
  { id: BigInt(2), name: 'choice_made', mpWorkId: 'w1', nodeId: 'n1', optionId: 'a', flag: null, shareId: null },
  { id: BigInt(3), name: 'choice_made', mpWorkId: 'w1', nodeId: 'n1', optionId: 'b', flag: null, shareId: null },
  { id: BigInt(4), name: 'ending_reached', mpWorkId: 'w1', nodeId: 'e1', optionId: null, flag: true, shareId: null },
  { id: BigInt(5), name: 'ending_reached', mpWorkId: 'w1', nodeId: 'e1', optionId: null, flag: false, shareId: null },
  { id: BigInt(6), name: 'app_launch', mpWorkId: null, nodeId: null, optionId: null, flag: null, shareId: 'abcd1234AB' },
  { id: BigInt(7), name: 'app_launch', mpWorkId: null, nodeId: null, optionId: null, flag: null, shareId: 'abcd1234AB' },
  { id: BigInt(8), name: 'play_start', mpWorkId: 'w1', nodeId: null, optionId: null, flag: false, shareId: null },
  { id: BigInt(9), name: 'choice_made', mpWorkId: null, nodeId: 'n1', optionId: 'a', flag: null, shareId: null },
]

beforeEach(() => {
  vi.clearAllMocks()
  redisMock.get.mockResolvedValue(null)
  redisMock.set.mockResolvedValue('OK')
  redisMock.del.mockResolvedValue(1)
  prismaMock.mpJobState.findUnique.mockResolvedValue(null)
  prismaMock.mpEvent.findMany.mockResolvedValue([])
  prismaMock.mpWork.findFirst.mockResolvedValue(null)
  prismaMock.mpBranchStat.findMany.mockResolvedValue([])
  prismaMock.$transaction.mockImplementation(async (fn: (tx: typeof txMock) => Promise<unknown>) => fn(txMock))
  txMock.$executeRaw.mockResolvedValue(1)
  txMock.mpJobState.upsert.mockResolvedValue({})
})

describe('aggregateEvents 手算对照', () => {
  it('accumulates branch counts, share opens and the watermark in one transaction', async () => {
    prismaMock.mpEvent.findMany.mockResolvedValue(SAMPLE)
    await aggregateEvents()
    expect(prismaMock.mpEvent.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: { gt: BigInt(0) } },
      orderBy: { id: 'asc' },
      take: 50000,
    }))
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1)
    expect(txMock.$executeRaw).toHaveBeenCalledTimes(4)

    const inserts = txMock.$executeRaw.mock.calls.filter((call) => String(call[0][0]).includes('INSERT INTO mp_branch_stats'))
    expect(inserts).toHaveLength(3)
    const valuesOf = (nodeId: string, optionId: string) => {
      const call = inserts.find((item) => item[2] === nodeId && item[3] === optionId)
      expect(call).toBeDefined()
      return call as unknown[]
    }
    expect(valuesOf('n1', 'a')[4]).toBe(2)
    expect(valuesOf('n1', 'b')[4]).toBe(1)
    expect(valuesOf('e1', '')[4]).toBe(1)
    for (const call of inserts) {
      expect(call[1]).toBe('w1')
      expect(String(call[0].join('?'))).toContain('ON DUPLICATE KEY UPDATE count = count + VALUES(count)')
    }

    const shareCall = txMock.$executeRaw.mock.calls.find((call) => String(call[0][0]).includes('UPDATE mp_shares'))
    expect(shareCall?.[1]).toBe(2)
    expect(shareCall?.[2]).toBe('abcd1234AB')
    expect(txMock.mpJobState.upsert).toHaveBeenCalledWith({
      where: { key: 'agg.lastEventId' },
      create: { key: 'agg.lastEventId', value: '9' },
      update: { value: '9' },
    })
  })

  it('resumes after the stored watermark so events are never double-counted', async () => {
    prismaMock.mpJobState.findUnique.mockResolvedValue({ key: 'agg.lastEventId', value: '5' })
    prismaMock.mpEvent.findMany.mockResolvedValue(SAMPLE.slice(5))
    await aggregateEvents()
    expect(prismaMock.mpEvent.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { gt: BigInt(5) } } }))
    expect(txMock.mpJobState.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: { value: '9' } }))
    const inserts = txMock.$executeRaw.mock.calls.filter((call) => String(call[0][0]).includes('INSERT INTO mp_branch_stats'))
    expect(inserts).toHaveLength(0)
  })
})

describe('releaseStats 样本门槛', () => {
  beforeEach(() => {
    prismaMock.mpWork.findFirst.mockResolvedValue({ id: 'w1', playerCount: 100 })
  })

  it('hides choices below MP_BRANCH_MIN_SAMPLES and endings below MP_ENDING_MIN_SAMPLES', async () => {
    prismaMock.mpBranchStat.findMany.mockResolvedValue([
      { nodeId: 'n1', optionId: 'a', count: 20 },
      { nodeId: 'n1', optionId: 'b', count: 10 },
      { nodeId: 'n2', optionId: 'a', count: 5 },
      { nodeId: 'n2', optionId: 'b', count: 5 },
      { nodeId: 'e1', optionId: '', count: 60 },
      { nodeId: 'e2', optionId: '', count: 49 },
      { nodeId: 'e3', optionId: '', count: 50 },
    ])
    const stats = await releaseStats('r1')
    // n1 合计 30 恰好达标：20/30=66.7、10/30=33.3；n2 合计 10 不返回。
    expect(stats.choices).toEqual({ n1: { a: 66.7, b: 33.3 } })
    // 结局稀有度 = 首达人数 / playerCount；49 < 50 不返回，50 恰好达标。
    expect(stats.endings).toEqual({ e1: 60, e3: 50 })
    expect(redisMock.set).toHaveBeenCalledWith('mp:stats:release:r1', expect.any(String), 'EX', 600)
  })

  it('returns 404 for releases that are not visible, even with a warm cache', async () => {
    redisMock.get.mockResolvedValue(JSON.stringify({ choices: { n1: { a: 100 } }, endings: {} }))
    prismaMock.mpWork.findFirst.mockResolvedValue(null)
    await expect(releaseStats('rX')).rejects.toMatchObject({ code: 'MP_WORK_NOT_FOUND' })
    expect(prismaMock.mpBranchStat.findMany).not.toHaveBeenCalled()
  })

  it('serves the cached payload without re-querying branch stats', async () => {
    redisMock.get.mockResolvedValue(JSON.stringify({ choices: { n1: { a: 66.7 } }, endings: { e1: 60 } }))
    const stats = await releaseStats('r1')
    expect(stats).toEqual({ choices: { n1: { a: 66.7 } }, endings: { e1: 60 } })
    expect(prismaMock.mpBranchStat.findMany).not.toHaveBeenCalled()
  })
})
