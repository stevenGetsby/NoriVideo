import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  dyApp: { findUnique: vi.fn() },
  dySave: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  mpWork: { update: vi.fn() },
  $transaction: vi.fn(),
}))
const redisMock = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), del: vi.fn(), keys: vi.fn() }))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/redis', () => ({ redis: redisMock }))

import { getDySave, putDySave } from '@/lib/mp/dy/saves'
import type { DyUserRow } from '@/lib/mp/dy/auth'

const USER: DyUserRow = { id: 'u1', appId: 'ttTest0000000000', openid: 'o1', anonOpenid: null, unionid: null, status: 'active', tokenVersion: 0, firstSource: null, firstShareId: null }
const APP_ROW = { id: 'a1', appId: USER.appId, mpWorkId: 'mpw1', name: '测试', status: 'active', releaseIds: ['r1'], secretEnc: 'enc' }

function body(over: Record<string, unknown> = {}) {
  return {
    baseRev: 0, releaseId: 'r1',
    profile: { endings: ['p:b'], segments: [], achievements: [], bought: [], equipped: { title: null, frame: null } },
    saves: { auto: null, slots: [null, null, null], checkpoints: {} },
    permanent: {}, progress: 0.5, endingsGot: 1,
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  redisMock.get.mockResolvedValue(null)
  redisMock.set.mockResolvedValue('OK')
  redisMock.del.mockResolvedValue(0)
  redisMock.keys.mockResolvedValue([])
  prismaMock.dyApp.findUnique.mockResolvedValue({ ...APP_ROW })
  prismaMock.dySave.findUnique.mockResolvedValue(null)
  prismaMock.$transaction.mockImplementation(async (arg: unknown) => {
    if (typeof arg === 'function') return (arg as (tx: unknown) => Promise<unknown>)(prismaMock)
    return Promise.all(arg as Promise<unknown>[])
  })
})

describe('getDySave / putDySave（N8）', () => {
  it('没有存档时返回 rev 0 和空引擎状态', async () => {
    const save = await getDySave(USER)
    expect(save.rev).toBe(0)
    expect(save.releaseId).toBeNull()
    expect(save.profile).toEqual({ endings: [], segments: [], achievements: [], bought: [], equipped: { title: null, frame: null } })
  })

  it('首次写入 rev 1，不增加 playerCount', async () => {
    const res = await putDySave(USER, body())
    expect(res.rev).toBe(1)
    expect(res.merged).toBe(false)
    expect(prismaMock.dySave.create).toHaveBeenCalledTimes(1)
    expect(prismaMock.mpWork.update).not.toHaveBeenCalled()
  })

  it('baseRev 与行 rev 一致时不合并', async () => {
    prismaMock.dySave.findUnique.mockResolvedValue({ id: 's1', userId: 'u1', rev: 3, releaseId: 'r1', profile: { endings: ['p:a'] }, saves: {}, permanent: {} })
    const res = await putDySave(USER, body({ baseRev: 3 }))
    expect(res.merged).toBe(false)
    expect(res.rev).toBe(4)
    expect(res.profile.endings).toEqual(['p:b'])
  })

  it('rev 冲突时合并：并集服务端优先，rev +1', async () => {
    prismaMock.dySave.findUnique.mockResolvedValue({
      id: 's1', userId: 'u1', rev: 3, releaseId: 'r1',
      profile: { endings: ['p:a'], segments: [], achievements: [], bought: [], equipped: { title: null, frame: null } },
      saves: { auto: null, slots: [null, null, null], checkpoints: {} },
      permanent: { clue: 2 },
    })
    const res = await putDySave(USER, body({ baseRev: 1, permanent: { clue: 5 } }))
    expect(res.merged).toBe(true)
    expect(res.rev).toBe(4)
    expect(res.profile.endings).toEqual(['p:a', 'p:b'])
    expect(res.permanent.clue).toBe(5)
  })

  it('releaseId 不在白名单时被拒', async () => {
    await expect(putDySave(USER, body({ releaseId: 'rX' }))).rejects.toMatchObject({ code: 'MP_VALIDATION', message: '版本不在白名单' })
    expect(prismaMock.dySave.create).not.toHaveBeenCalled()
  })

  it('baseRev 和 releaseId 校验文案与微信端一致', async () => {
    await expect(putDySave(USER, body({ baseRev: -1 }))).rejects.toMatchObject({ code: 'MP_VALIDATION', message: '存档版本无效' })
    await expect(putDySave(USER, body({ baseRev: 1.5 }))).rejects.toMatchObject({ message: '存档版本无效' })
    await expect(putDySave(USER, body({ releaseId: '' }))).rejects.toMatchObject({ code: 'MP_VALIDATION', message: '缺少版本信息' })
  })
})
