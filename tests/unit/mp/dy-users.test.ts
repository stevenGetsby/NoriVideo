import { Prisma } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  dyUser: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  dySave: { findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
  dyShare: { updateMany: vi.fn() },
  $transaction: vi.fn(),
}))
const redisMock = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), del: vi.fn() }))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/redis', () => ({ redis: redisMock }))

import { loginDyUser } from '@/lib/mp/dy/users'

const APP = { id: 'a1', appId: 'ttTest0000000000', mpWorkId: 'mpw1', name: '测试', status: 'active', releaseIds: [], secretEnc: 'enc' }
const ATTR = { source: 'share', shareId: 'abcDEF0123' }

function userRow(over: Record<string, unknown> = {}) {
  return { id: 'u1', appId: APP.appId, openid: null, anonOpenid: null, unionid: null, status: 'active', tokenVersion: 0, firstSource: null, firstShareId: null, ...over }
}

function saveRow(userId: string, over: Record<string, unknown> = {}) {
  return {
    id: `save-${userId}`, userId, appId: APP.appId, releaseId: 'r1', rev: 1,
    profile: { endings: [], segments: [], achievements: [], bought: [], equipped: { title: null, frame: null } },
    saves: { auto: null, slots: [null, null, null], checkpoints: {} },
    permanent: {},
    ...over,
  }
}

// findUnique 按 where 形状分发：appId_openid / appId_anonOpenid / { id }
function mockLookup(a: unknown, b: unknown, byId: Record<string, unknown> = {}) {
  prismaMock.dyUser.findUnique.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
    if ('appId_openid' in where) return a
    if ('appId_anonOpenid' in where) return b
    if ('id' in where) return byId[String(where.id)] ?? a
    return null
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  redisMock.get.mockResolvedValue(null)
  prismaMock.$transaction.mockImplementation(async (arg: unknown) => {
    if (typeof arg === 'function') return (arg as (tx: unknown) => Promise<unknown>)(prismaMock)
    return Promise.all(arg as Promise<unknown>[])
  })
  prismaMock.dyShare.updateMany.mockResolvedValue({ count: 1 })
})

describe('loginDyUser（N6）', () => {
  it('都不存在：创建用户并给分享计数', async () => {
    mockLookup(null, null)
    prismaMock.dyUser.create.mockResolvedValue(userRow({ id: 'new', openid: 'o1', anonOpenid: 'ao1', firstSource: 'share', firstShareId: ATTR.shareId }))
    const res = await loginDyUser(APP, { openid: 'o1', anonOpenid: 'ao1', unionid: null }, ATTR)
    expect(res.isNew).toBe(true)
    expect(res.merged).toBe(false)
    expect(prismaMock.dyUser.create).toHaveBeenCalledTimes(1)
    expect(prismaMock.dyShare.updateMany).toHaveBeenCalledWith({ where: { id: ATTR.shareId }, data: { newUsers: { increment: 1 } } })
  })

  it('只有匿名行且带了 openid：升级', async () => {
    const b = userRow({ id: 'B', anonOpenid: 'ao1' })
    mockLookup(null, b)
    prismaMock.dyUser.update.mockResolvedValue({ ...b, openid: 'o1' })
    const res = await loginDyUser(APP, { openid: 'o1', anonOpenid: 'ao1', unionid: null }, ATTR)
    expect(res.isNew).toBe(false)
    expect(res.merged).toBe(false)
    expect(prismaMock.dyUser.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'B' }, data: expect.objectContaining({ openid: 'o1' }) }))
    expect(prismaMock.dyUser.create).not.toHaveBeenCalled()
  })

  it('A 和 B 都有存档：事务内合并，rev +1，B 标记 merged', async () => {
    const a = userRow({ id: 'A', openid: 'o1' })
    const b = userRow({ id: 'B', anonOpenid: 'ao1' })
    mockLookup(a, b, { A: { ...a, anonOpenid: 'ao1' } })
    const saveA = saveRow('A', { rev: 5, profile: { endings: ['p:a'], segments: [], achievements: [], bought: [], equipped: { title: null, frame: null } }, permanent: { clue: 1 } })
    const saveB = saveRow('B', { rev: 2, profile: { endings: ['p:b'], segments: [], achievements: [], bought: [], equipped: { title: null, frame: null } }, permanent: { clue: 3 } })
    prismaMock.dySave.findUnique.mockImplementation(async ({ where }: { where: { userId: string } }) => (where.userId === 'B' ? saveB : saveA))
    const res = await loginDyUser(APP, { openid: 'o1', anonOpenid: 'ao1', unionid: null }, ATTR)
    expect(res.merged).toBe(true)
    expect(res.user.id).toBe('A')
    // 合并写回 A：endings 并集服务端优先，permanent 数值取 max，rev 5+1
    const writeA = prismaMock.dySave.update.mock.calls.find((call) => (call[0] as { where: { id: string } }).where.id === 'save-A')
    expect(writeA).toBeTruthy()
    const data = (writeA![0] as { data: { rev: number; profile: { endings: string[] }; permanent: Record<string, number> } }).data
    expect(data.rev).toBe(6)
    expect(data.profile.endings).toEqual(['p:a', 'p:b'])
    expect(data.permanent.clue).toBe(3)
    expect(prismaMock.dySave.delete).toHaveBeenCalledWith({ where: { id: 'save-B' } })
    expect(prismaMock.dyUser.update).toHaveBeenCalledWith({ where: { id: 'B' }, data: { status: 'merged', anonOpenid: null, tokenVersion: { increment: 1 } } })
    expect(prismaMock.dyUser.update).toHaveBeenCalledWith({ where: { id: 'A' }, data: { anonOpenid: 'ao1' } })
  })

  it('A 没有存档时把 B 的存档改挂到 A', async () => {
    const a = userRow({ id: 'A', openid: 'o1' })
    const b = userRow({ id: 'B', anonOpenid: 'ao1' })
    mockLookup(a, b, { A: { ...a, anonOpenid: 'ao1' } })
    const saveB = saveRow('B')
    prismaMock.dySave.findUnique.mockImplementation(async ({ where }: { where: { userId: string } }) => (where.userId === 'B' ? saveB : null))
    const res = await loginDyUser(APP, { openid: 'o1', anonOpenid: 'ao1', unionid: null }, ATTR)
    expect(res.merged).toBe(true)
    expect(prismaMock.dySave.update).toHaveBeenCalledWith({ where: { id: 'save-B' }, data: { userId: 'A' } })
    expect(prismaMock.dySave.delete).not.toHaveBeenCalled()
  })

  it('创建撞 P2002 后重新查询一次', async () => {
    const existing = userRow({ id: 'A', openid: 'o1', anonOpenid: 'ao1' })
    prismaMock.dyUser.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValue(existing)
    prismaMock.dyUser.create.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '6.19.2' }))
    const res = await loginDyUser(APP, { openid: 'o1', anonOpenid: 'ao1', unionid: null }, ATTR)
    expect(res.isNew).toBe(false)
    expect(res.user.id).toBe('A')
    expect(prismaMock.dyUser.create).toHaveBeenCalledTimes(1)
  })

  it('被封禁时抛 MP_USER_BANNED', async () => {
    mockLookup(userRow({ id: 'A', openid: 'o1', status: 'banned' }), null)
    await expect(loginDyUser(APP, { openid: 'o1', anonOpenid: null, unionid: null }, ATTR)).rejects.toMatchObject({ code: 'MP_USER_BANNED' })
  })
})
