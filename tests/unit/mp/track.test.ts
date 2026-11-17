import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  mpWork: { findMany: vi.fn() },
  mpChannel: { findUnique: vi.fn() },
  mpEvent: { createMany: vi.fn() },
}))
const redisMock = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/redis', () => ({ redis: redisMock }))

import { ingestEvents, trackAnonId } from '@/lib/mp/track'

const NOW = new Date('2026-11-17T12:00:00Z').getTime()

function event(fields: Record<string, unknown> = {}): Record<string, unknown> {
  return { name: 'work_view', ts: NOW, sid: 'sid1', w: 'abcd1234', ...fields }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  redisMock.get.mockResolvedValue(null)
  redisMock.set.mockResolvedValue('OK')
  prismaMock.mpWork.findMany.mockResolvedValue([{ id: 'w1', slug: 'abcd1234' }])
  prismaMock.mpChannel.findUnique.mockResolvedValue({ id: 'ch1' })
  prismaMock.mpEvent.createMany.mockResolvedValue({ count: 1 })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('trackAnonId', () => {
  it('clips to 32 characters and rejects non-strings', () => {
    expect(trackAnonId({ anonId: 'a'.repeat(40) })).toBe('a'.repeat(32))
    expect(trackAnonId({ anonId: '' })).toBeNull()
    expect(trackAnonId({ anonId: 123 })).toBeNull()
    expect(trackAnonId(null)).toBeNull()
  })
})

describe('ingestEvents', () => {
  it('requires anonId', async () => {
    await expect(ingestEvents({ events: [event()] }, null)).rejects.toMatchObject({ code: 'MP_VALIDATION' })
    expect(prismaMock.mpEvent.createMany).not.toHaveBeenCalled()
  })

  it('maps slug, channel code and share id onto every row', async () => {
    const result = await ingestEvents({
      anonId: 'anon1',
      attr: { source: 'share', c: '234abc', s: 'abcd1234AB' },
      events: [event()],
    }, 'c1')
    expect(result).toEqual({ accepted: 1 })
    expect(prismaMock.mpEvent.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({
        name: 'work_view',
        consumerId: 'c1',
        anonId: 'anon1',
        sessionId: 'sid1',
        mpWorkId: 'w1',
        source: 'share',
        channelId: 'ch1',
        shareId: 'abcd1234AB',
        clientTs: new Date(NOW),
      })],
    })
    expect(redisMock.set).toHaveBeenCalledWith('mp:chan:234abc', 'ch1', 'EX', 600)
  })

  it('uses the channel cache and treats the empty sentinel as a miss', async () => {
    redisMock.get.mockResolvedValue('chCached')
    await ingestEvents({ anonId: 'anon1', attr: { c: '234abc' }, events: [event()] }, null)
    expect(prismaMock.mpChannel.findUnique).not.toHaveBeenCalled()
    expect(prismaMock.mpEvent.createMany.mock.calls[0][0].data[0].channelId).toBe('chCached')

    redisMock.get.mockResolvedValue('')
    await ingestEvents({ anonId: 'anon1', attr: { c: '234abc' }, events: [event()] }, null)
    expect(prismaMock.mpChannel.findUnique).not.toHaveBeenCalled()
    expect(prismaMock.mpEvent.createMany.mock.calls[1][0].data[0].channelId).toBeNull()
  })

  it('caches channel misses and ignores invalid codes and share ids', async () => {
    prismaMock.mpChannel.findUnique.mockResolvedValue(null)
    await ingestEvents({ anonId: 'anon1', attr: { c: '234abc', s: 'short' }, events: [event()] }, null)
    expect(redisMock.set).toHaveBeenCalledWith('mp:chan:234abc', '', 'EX', 600)
    expect(prismaMock.mpEvent.createMany.mock.calls[0][0].data[0].shareId).toBeNull()

    await ingestEvents({ anonId: 'anon1', attr: { c: '0ooooo' }, events: [event()] }, null)
    expect(prismaMock.mpEvent.createMany.mock.calls[1][0].data[0].channelId).toBeNull()
    expect(redisMock.get).toHaveBeenCalledTimes(1)
  })

  it('drops unknown names, missing sessions and unknown slugs', async () => {
    const result = await ingestEvents({
      anonId: 'anon1',
      events: [
        event({ name: 'not_whitelisted' }),
        event({ sid: '' }),
        event({ w: 'zzzz9999' }),
        event(),
      ],
    }, null)
    expect(result).toEqual({ accepted: 1 })
    expect(prismaMock.mpWork.findMany).toHaveBeenCalledWith({ where: { slug: { in: ['abcd1234', 'zzzz9999'] } }, select: { id: true, slug: true } })
    expect(prismaMock.mpEvent.createMany.mock.calls[0][0].data).toHaveLength(1)
  })

  it('clamps out-of-window timestamps to now and keeps valid ones', async () => {
    await ingestEvents({
      anonId: 'anon1',
      events: [
        event({ ts: NOW - 8 * 24 * 3600 * 1000 }),
        event({ ts: NOW + 10 * 60 * 1000 }),
        event({ ts: NOW - 3600 * 1000 }),
        event({ ts: 'yesterday' }),
      ],
    }, null)
    const rows = prismaMock.mpEvent.createMany.mock.calls[0][0].data as Array<{ clientTs: Date }>
    expect(rows[0].clientTs.getTime()).toBe(NOW)
    expect(rows[1].clientTs.getTime()).toBe(NOW)
    expect(rows[2].clientTs.getTime()).toBe(NOW - 3600 * 1000)
    expect(rows[3].clientTs.getTime()).toBe(NOW)
  })

  it('truncates values to int32 and only accepts boolean flags', async () => {
    await ingestEvents({
      anonId: 'anon1',
      events: [
        event({ name: 'rate', v: 4.9, f: true }),
        event({ name: 'rate', v: 3e9 }),
        event({ name: 'rate', v: -3e9 }),
        event({ name: 'rate', v: '5', f: 'true' }),
      ],
    }, null)
    const rows = prismaMock.mpEvent.createMany.mock.calls[0][0].data as Array<{ value: number | null; flag: boolean | null }>
    expect(rows[0]).toMatchObject({ value: 4, flag: true })
    expect(rows[1].value).toBe(2147483647)
    expect(rows[2].value).toBe(-2147483648)
    expect(rows[3]).toMatchObject({ value: null, flag: null })
  })

  it('truncates strings to column widths by code point', async () => {
    await ingestEvents({
      anonId: 'anon1',
      attr: { source: 's'.repeat(30) },
      events: [event({ n: '节'.repeat(70), o: 'o'.repeat(70), r: 'r'.repeat(200) })],
    }, null)
    const row = prismaMock.mpEvent.createMany.mock.calls[0][0].data[0] as Record<string, string>
    expect([...row.nodeId]).toHaveLength(64)
    expect([...row.optionId]).toHaveLength(64)
    expect(row.releaseId).toHaveLength(191)
    expect(row.source).toHaveLength(24)
  })

  it('caps a batch at 50 events and skips the write when nothing survives', async () => {
    const many = Array.from({ length: 60 }, () => event())
    const result = await ingestEvents({ anonId: 'anon1', events: many }, null)
    expect(result).toEqual({ accepted: 50 })
    expect(prismaMock.mpEvent.createMany.mock.calls[0][0].data).toHaveLength(50)

    const empty = await ingestEvents({ anonId: 'anon1', events: [event({ name: 'nope' })] }, null)
    expect(empty).toEqual({ accepted: 0 })
    expect(prismaMock.mpEvent.createMany).toHaveBeenCalledTimes(1)
  })
})
