import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const authMock = vi.hoisted(() => ({
  requireAdminAuth: vi.fn(),
  isErrorResponse: (value: unknown) => value instanceof NextResponse,
  forbidden: (message: string) => NextResponse.json({ message }, { status: 403 }),
}))
const prismaMock = vi.hoisted(() => ({
  user: { findFirst: vi.fn(), update: vi.fn(), findUniqueOrThrow: vi.fn(), create: vi.fn() },
  userBalance: { create: vi.fn() },
  $transaction: vi.fn(),
}))
vi.mock('@/lib/api-auth', () => authMock)
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/logging/core', () => ({
  logInfo: vi.fn(),
  createScopedLogger: () => ({ debug: vi.fn(), event: vi.fn(), error: vi.fn() }),
}))

function account(overrides: Record<string, unknown> = {}) {
  return {
    id: 'child-1',
    name: 'member',
    role: 'writer',
    roleLabel: null,
    status: 'active',
    permissions: [],
    projectLeader: false,
    workspaceOwnerId: 'manager-1',
    parentAccountId: 'manager-1',
    coinCredits: 0,
    dailyPointLimit: null,
    balance: { balance: 0 },
    createdAt: new Date('2026-11-01T00:00:00.000Z'),
    updatedAt: new Date('2026-11-01T00:00:00.000Z'),
    lastLoginAt: null,
    ...overrides,
  }
}

function request(body: unknown, path = '/api/admin/accounts/child-1') {
  return new NextRequest(`http://localhost${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as never
}

describe('project leader account administration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMock.requireAdminAuth.mockResolvedValue({ session: { user: { id: 'manager-1', actorId: 'manager-1', role: 'admin' } } })
    prismaMock.user.findFirst.mockResolvedValue(account())
    prismaMock.user.findUniqueOrThrow.mockImplementation(async () => account({ projectLeader: prismaMock.user.update.mock.calls.at(-1)?.[0]?.data?.projectLeader === true }))
    prismaMock.$transaction.mockImplementation(async (callback: (tx: typeof prismaMock) => unknown) => callback(prismaMock))
  })

  it('sets and revokes project leadership without accepting functional role grants', async () => {
    const { PATCH } = await import('@/app/api/admin/accounts/[userId]/route')
    for (const projectLeader of [true, false]) {
      const response = await PATCH(request({ projectLeader }), { params: Promise.resolve({ userId: 'child-1' }) })
      const payload = await response.json()
      expect(response.status).toBe(200)
      expect(prismaMock.user.update).toHaveBeenLastCalledWith({ where: { id: 'child-1' }, data: { projectLeader } })
      expect(payload.account.projectLeader).toBe(projectLeader)
    }
    expect(prismaMock.user.update).toHaveBeenCalledTimes(2)
  })

  it.each([null, 'true', 1, []])('rejects a non-boolean projectLeader value: %j', async (projectLeader) => {
    const { PATCH } = await import('@/app/api/admin/accounts/[userId]/route')
    const response = await PATCH(request({ projectLeader }), { params: Promise.resolve({ userId: 'child-1' }) })
    expect(response.status).toBe(400)
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })

  it('does not allow a platform admin to turn a management account into a project leader', async () => {
    authMock.requireAdminAuth.mockResolvedValueOnce({ session: { user: { id: 'root-1', actorId: 'root-1', role: 'super_admin' } } })
    prismaMock.user.findFirst.mockResolvedValueOnce(account({ id: 'manager-2', role: 'admin', workspaceOwnerId: null, parentAccountId: 'root-1' }))
    const { PATCH } = await import('@/app/api/admin/accounts/[userId]/route')
    const response = await PATCH(request({ projectLeader: true }), { params: Promise.resolve({ userId: 'manager-2' }) })
    expect(response.status).toBe(400)
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })

  it('rejects cross-workspace updates and old permission fields without updating the account', async () => {
    const { PATCH } = await import('@/app/api/admin/accounts/[userId]/route')
    const crossWorkspace = await PATCH(request({ projectLeader: true }), { params: Promise.resolve({ userId: 'child-1' }) })
    expect(crossWorkspace.status).toBe(200)
    prismaMock.user.findFirst.mockResolvedValueOnce(account({ workspaceOwnerId: 'another-manager', parentAccountId: 'another-manager' }))
    const forbidden = await PATCH(request({ projectLeader: true }), { params: Promise.resolve({ userId: 'child-1' }) })
    expect(forbidden.status).toBe(403)
    const noFields = await PATCH(request({ role: 'storyboard', permissions: ['admin'] }), { params: Promise.resolve({ userId: 'child-1' }) })
    expect(noFields.status).toBe(400)
    expect(prismaMock.user.update).toHaveBeenCalledTimes(1)
  })

  it('creates multiple subaccounts with the same creative permissions and an explicit leader flag', async () => {
    const { POST } = await import('@/app/api/admin/accounts/route')
    prismaMock.user.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => account({ id: String(data.name), name: data.name, projectLeader: data.projectLeader, permissions: data.permissions, roleLabel: data.roleLabel }))
    for (const [name, projectLeader] of [['member-a', false], ['leader-b', true]] as const) {
      const response = await POST(new NextRequest('http://localhost/api/admin/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountType: 'subaccount', username: name, password: 'not-a-real-password', projectLeader, permissions: ['admin'], role: 'reviewer' }),
      }) as never, { params: Promise.resolve({}) })
      expect(response.status).toBe(201)
      const payload = await response.json()
      expect(payload.account.projectLeader).toBe(projectLeader)
      expect(payload.account.permissions).toEqual(['read', 'projectCreate', 'scriptWrite', 'assetWrite', 'storyboardWrite', 'toolboxUse', 'canvasWrite'])
    }
    expect(prismaMock.user.create).toHaveBeenCalledTimes(2)
    expect(prismaMock.user.create.mock.calls.every(([input]) => input.data.role === 'writer' && input.data.workspaceOwnerId === 'manager-1')).toBe(true)
  })
})
