import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockRequest } from '../../helpers/request'

const prismaMock = vi.hoisted(() => ({
  dyApp: { findUnique: vi.fn() },
  dyEvent: { createMany: vi.fn() },
  dyUser: { findUnique: vi.fn(), update: vi.fn() },
}))
const redisMock = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), del: vi.fn(), keys: vi.fn() }))
const rateMock = vi.hoisted(() => ({ checkRateLimit: vi.fn(), getClientIp: vi.fn() }))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/redis', () => ({ redis: redisMock }))
vi.mock('@/lib/rate-limit', () => rateMock)
vi.mock('@/lib/logging/core', () => ({
  createScopedLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), event: vi.fn(), child: vi.fn() }),
}))

import { ingestDyEvents } from '@/lib/mp/dy/events'
import { POST as trackPOST } from '@/app/api/mp/dy/track/route'

const APP_ID = 'ttTest0000000000'
const APP_ROW = { id: 'a1', appId: APP_ID, mpWorkId: 'mpw1', name: '测试', status: 'active', releaseIds: ['r1'], secretEnc: 'enc' }

function event(over: Record<string, unknown> = {}) {
  return { name: 'play_start', sid: 'sess1', ts: Date.now(), r: 'r1', ...over }
}

beforeEach(() => {
  vi.clearAllMocks()
  redisMock.get.mockResolvedValue(null)
  redisMock.set.mockResolvedValue('OK')
  redisMock.del.mockResolvedValue(0)
  redisMock.keys.mockResolvedValue([])
  prismaMock.dyApp.findUnique.mockResolvedValue({ ...APP_ROW })
  prismaMock.dyEvent.createMany.mockResolvedValue({ count: 1 })
  rateMock.checkRateLimit.mockResolvedValue({ limited: false, retryAfterSeconds: 0 })
  rateMock.getClientIp.mockReturnValue('1.2.3.4')
})

describe('ingestDyEvents（N9）', () => {
  it('不在白名单的事件被丢弃，控制器事件全部接收', async () => {
    const names = ['play_start', 'segment_view', 'choice_made', 'interaction_result', 'ending_reached', 'play_exit', 'favorite', 'rate', 'work_view']
    const res = await ingestDyEvents(APP_ID, { anonId: 'anon1', attr: { source: 'share', s: 'abcDEF0123' }, events: names.map((name) => event({ name })) }, 'u1')
    expect(res.accepted).toBe(6)
    const rows = prismaMock.dyEvent.createMany.mock.calls[0][0].data as Array<{ name: string; appId: string; userId: string | null; shareId: string | null }>
    expect(rows.map((row) => row.name)).toEqual(['play_start', 'segment_view', 'choice_made', 'interaction_result', 'ending_reached', 'play_exit'])
    expect(rows[0].appId).toBe(APP_ID)
    expect(rows[0].userId).toBe('u1')
    expect(rows[0].shareId).toBe('abcDEF0123')
  })

  it('缺少 sid 的事件被丢弃，单批上限 50', async () => {
    const events = [...Array.from({ length: 60 }, () => event()), event({ sid: '' })]
    const res = await ingestDyEvents(APP_ID, { anonId: 'anon1', events }, null)
    expect(res.accepted).toBe(50)
    const dropped = await ingestDyEvents(APP_ID, { anonId: 'anon1', events: [event({ sid: '' })] }, null)
    expect(dropped.accepted).toBe(0)
  })

  it('缺少 anonId 抛 MP_VALIDATION', async () => {
    await expect(ingestDyEvents(APP_ID, { events: [event()] }, null)).rejects.toMatchObject({ code: 'MP_VALIDATION' })
  })

  it('时间戳窗口沿用微信端：过去 7 天到未来 5 分钟之外回落到 now', async () => {
    const now = Date.now()
    const old = now - 8 * 24 * 3600 * 1000
    const future = now + 6 * 60 * 1000
    await ingestDyEvents(APP_ID, { anonId: 'anon1', events: [event({ ts: old }), event({ ts: future })] }, null)
    const rows = prismaMock.dyEvent.createMany.mock.calls[0][0].data as Array<{ clientTs: Date }>
    for (const row of rows) expect(Math.abs(row.clientTs.getTime() - now)).toBeLessThan(5000)
  })
})

describe('POST /api/mp/dy/track（N11）', () => {
  it('缺少 X-Dy-App 时被拒', async () => {
    const res = await trackPOST(buildMockRequest({ path: '/api/mp/dy/track', method: 'POST', body: { anonId: 'anon1', events: [event()] } }), undefined as never)
    expect(res.status).toBe(400)
    expect(prismaMock.dyEvent.createMany).not.toHaveBeenCalled()
  })

  it('app 不存在时被拒', async () => {
    prismaMock.dyApp.findUnique.mockResolvedValue(null)
    const res = await trackPOST(buildMockRequest({ path: '/api/mp/dy/track', method: 'POST', headers: { 'x-dy-app': APP_ID }, body: { anonId: 'anon1', events: [event()] } }), undefined as never)
    expect(res.status).toBe(409)
    expect(prismaMock.dyEvent.createMany).not.toHaveBeenCalled()
  })

  it('合法请求写入事件并返回 204', async () => {
    const res = await trackPOST(buildMockRequest({ path: '/api/mp/dy/track', method: 'POST', headers: { 'x-dy-app': APP_ID }, body: { anonId: 'anon1', events: [event()] } }), undefined as never)
    expect(res.status).toBe(204)
    expect(prismaMock.dyEvent.createMany).toHaveBeenCalledTimes(1)
  })
})
