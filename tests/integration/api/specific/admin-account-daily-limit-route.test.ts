import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockRequest } from '../../../helpers/request'

const requireAdminAuthMock = vi.hoisted(() => vi.fn())
const prismaMock = vi.hoisted(() => ({
  user: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    update: vi.fn(),
    create: vi.fn(),
  },
  userBalance: { create: vi.fn(), upsert: vi.fn() },
  project: { findMany: vi.fn(async () => []) },
  globalCharacter: { findMany: vi.fn(async () => []) },
  globalLocation: { findMany: vi.fn(async () => []) },
  globalVoice: { findMany: vi.fn(async () => []) },
  usageCost: { findMany: vi.fn(async () => []) },
  balanceTransaction: {
    groupBy: vi.fn(async (): Promise<Array<{ userId: string; _sum: { amount: unknown } }>> => []),
    findMany: vi.fn(async () => []),
  },
  balanceFreeze: { groupBy: vi.fn(async (): Promise<unknown[]> => []), findMany: vi.fn(async () => []) },
  $transaction: vi.fn(),
}))

vi.mock('@/lib/api-auth', () => ({
  requireAdminAuth: requireAdminAuthMock,
  isErrorResponse: (value: unknown) => value instanceof Response,
  forbidden: (message: string) => Response.json({ error: message }, { status: 403 }),
}))
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

const managerRecord = {
  id: 'manager-1',
  name: 'manager-1',
  role: 'admin',
  roleLabel: null,
  status: 'active',
  permissions: null,
  workspaceOwnerId: null,
  parentAccountId: 'root-1',
  coinCredits: 0,
  dailyPointLimit: 5000,
  balance: { balance: 10 },
  createdAt: new Date('2026-07-18T00:00:00.000Z'),
  updatedAt: new Date('2026-07-18T00:00:00.000Z'),
  lastLoginAt: null,
}

const childRecord = {
  ...managerRecord,
  id: 'child-1',
  name: 'writer-1',
  role: 'writer',
  workspaceOwnerId: 'manager-1',
  parentAccountId: 'manager-1',
  dailyPointLimit: null,
}

function authAs(role: 'super_admin' | 'admin') {
  requireAdminAuthMock.mockResolvedValue({
    session: { user: { id: role === 'super_admin' ? 'root-1' : 'manager-1', actorId: role === 'super_admin' ? 'root-1' : 'manager-1', role } },
  })
}

async function patchAccount(userId: string, body: Record<string, unknown>) {
  const { PATCH } = await import('@/app/api/admin/accounts/[userId]/route')
  return PATCH(
    buildMockRequest({ path: `/api/admin/accounts/${userId}`, method: 'PATCH', body }),
    { params: Promise.resolve({ userId }) },
  )
}

async function listAccounts() {
  const { GET } = await import('@/app/api/admin/accounts/route')
  return GET(buildMockRequest({ path: '/api/admin/accounts', method: 'GET' }), { params: Promise.resolve({}) })
}

describe('管理账号设置每日用量上限', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authAs('admin')
    prismaMock.user.findFirst.mockResolvedValue(childRecord)
    prismaMock.$transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback({
      user: {
        update: prismaMock.user.update,
        findUniqueOrThrow: prismaMock.user.findUniqueOrThrow,
      },
    }))
    prismaMock.user.findUniqueOrThrow.mockResolvedValue({ ...childRecord, dailyPointLimit: 800 })
  })

  it('把每日上限写入账号，并在响应里回显', async () => {
    const response = await patchAccount('child-1', { dailyPointLimit: 800 })

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: 'child-1' },
      data: { dailyPointLimit: 800 },
    })
    const payload = await response.json() as { account?: { dailyLimitPoints?: number | null } }
    expect(payload.account?.dailyLimitPoints).toBe(800)
  })

  it('0 禁止生成，unlimited 才表示取消限制', async () => {
    prismaMock.user.findUniqueOrThrow.mockResolvedValue({ ...childRecord, dailyPointLimit: 0 })

    const disabled = await patchAccount('child-1', { dailyPointLimit: 0 })
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: 'child-1' },
      data: { dailyPointLimit: 0 },
    })
    expect((await disabled.json()).account.dailyLimitPoints).toBe(0)

    prismaMock.user.update.mockClear()
    prismaMock.user.findUniqueOrThrow.mockResolvedValue({ ...childRecord, dailyPointLimit: null })
    const unlimited = await patchAccount('child-1', { dailyPointLimit: 'unlimited' })
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: 'child-1' },
      data: { dailyPointLimit: null },
    })
    expect((await unlimited.json()).account.dailyLimitPoints).toBeNull()
  })

  it('拒绝非法上限，且不写库', async () => {
    for (const invalid of [-1, 'abc', 100_000_001, '', true, 0.5]) {
      const response = await patchAccount('child-1', { dailyPointLimit: invalid })
      expect(response.status).toBe(400)
    }
    expect(prismaMock.user.update).not.toHaveBeenCalled()
  })

  it('仅改上限也算有效更新，不会被判成空请求', async () => {
    const response = await patchAccount('child-1', { dailyPointLimit: 800 })
    const payload = await response.json() as { success?: boolean }
    expect(payload.success).toBe(true)
  })

  it('账号列表同时返回上限与今日用量', async () => {
    authAs('admin')
    prismaMock.user.findMany.mockImplementation(async (args: { where?: { id?: { in?: string[] }; OR?: unknown } }) => {
      // 每日用量批量统计按 id in 查询；子账号明细带 OR 条件；其余是管理账号查询。
      if (args?.where?.id?.in) return [managerRecord, childRecord]
      if (args?.where?.OR) return [childRecord]
      return [managerRecord]
    })
    prismaMock.balanceTransaction.groupBy.mockResolvedValue([
      { userId: 'child-1', _sum: { amount: -3 } },
    ])

    const response = await listAccounts()
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toContain('no-store')
    const payload = await response.json() as {
      workspaces?: Array<{
        manager: { dailyLimitPoints: number | null; usageToday?: { limitPoints: number | null; usedPoints: number } | null }
      }>
    }
    const manager = payload.workspaces?.[0]?.manager
    expect(manager?.dailyLimitPoints).toBe(5000)
    expect(manager?.usageToday?.limitPoints).toBe(5000)
    expect(manager?.usageToday?.usedPoints).toBe(0)
  })
})
