import { beforeEach, describe, expect, it, vi } from 'vitest'

const getServerSessionMock = vi.hoisted(() => vi.fn())
const userFindUniqueMock = vi.hoisted(() => vi.fn())

vi.mock('next-auth/next', () => ({ getServerSession: getServerSessionMock }))
vi.mock('next/headers', () => ({ headers: vi.fn(async () => new Headers()) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: userFindUniqueMock },
  },
}))
vi.mock('@/lib/prisma-retry', () => ({
  withPrismaRetry: vi.fn(async (operation: () => Promise<unknown>) => await operation()),
}))
vi.mock('@/lib/test-mode', () => ({
  isTestModeEnabled: vi.fn(() => false),
  getOrCreateTestModeSession: vi.fn(),
}))

function session(overrides: Record<string, unknown> = {}) {
  return {
    user: {
      id: 'user-1',
      name: 'member-1',
      status: 'active',
      sessionVersion: 0,
      ...overrides,
    },
  }
}

function account(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user-1',
    name: 'member-1',
    email: null,
    role: 'writer',
    status: 'active',
    permissions: null,
    sessionVersion: 0,
    workspaceOwnerId: 'manager-1',
    parentAccountId: 'manager-1',
    parentAccount: { id: 'manager-1', role: 'admin', status: 'active' },
    coinCredits: 0,
    balance: { balance: 1.25 },
    ...overrides,
  }
}

describe('account session policy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getServerSessionMock.mockResolvedValue(session())
    userFindUniqueMock.mockResolvedValue(account())
  })

  it('rejects a member missing an explicitly required permission', async () => {
    const { requireUserPermission, isErrorResponse } = await import('@/lib/api-auth')
    const result = await requireUserPermission(['assetWrite'])
    expect(isErrorResponse(result)).toBe(true)
    expect((result as Response).status).toBe(403)
  })

  it('enforces permissions supplied by the API request context', async () => {
    const { withAccountPermissionContext } = await import('@/lib/account/request-context')
    const { requireUserAuth, isErrorResponse } = await import('@/lib/api-auth')
    const result = await withAccountPermissionContext(
      ['assetWrite'],
      async () => await requireUserAuth(),
    )
    expect(isErrorResponse(result)).toBe(true)
    expect((result as Response).status).toBe(403)
  })

  it('keeps toolbox and canvas enabled in every legacy role template', async () => {
    const { requireUserPermission, isErrorResponse } = await import('@/lib/api-auth')
    for (const role of ['admin', 'writer', 'asset', 'storyboard'] as const) {
      for (const permission of ['toolboxUse', 'canvasWrite'] as const) {
        userFindUniqueMock.mockResolvedValueOnce(account({
          role,
          ...(role === 'admin' ? { workspaceOwnerId: null, parentAccountId: 'root-1' } : {}),
        }))
        const result = await requireUserPermission([permission])
        expect(isErrorResponse(result), `${role}:${permission}`).toBe(false)
      }
    }
  })

  it('allows the management account to perform administrative operations', async () => {
    userFindUniqueMock.mockResolvedValue(account({ role: 'admin', workspaceOwnerId: null, parentAccountId: 'root-1' }))
    const { requireUserPermission, isErrorResponse } = await import('@/lib/api-auth')
    const result = await requireUserPermission(['admin', 'storyboardWrite'])
    expect(isErrorResponse(result)).toBe(false)
  })

  it('keeps reviewer accounts read-only at the functional permission layer', async () => {
    userFindUniqueMock.mockResolvedValue(account({ role: 'reviewer', permissions: ['read'] }))
    const { requireUserPermission, isErrorResponse } = await import('@/lib/api-auth')

    const readable = await requireUserPermission(['read'])
    expect(isErrorResponse(readable)).toBe(false)

    userFindUniqueMock.mockResolvedValue(account({ role: 'reviewer', permissions: ['read'] }))
    const writable = await requireUserPermission(['storyboardWrite'])
    expect(isErrorResponse(writable)).toBe(true)
    expect((writable as Response).status).toBe(403)
  })

  it('allows the platform Admin to perform administrative operations', async () => {
    userFindUniqueMock.mockResolvedValue(account({ role: 'super_admin', workspaceOwnerId: null, parentAccountId: null }))
    const { requireAdminAuth, isErrorResponse } = await import('@/lib/api-auth')
    const result = await requireAdminAuth()
    expect(isErrorResponse(result)).toBe(false)
  })

  it('uses the management account id as the shared data scope for subaccounts', async () => {
    const { requireUserAuth, isErrorResponse } = await import('@/lib/api-auth')
    const result = await requireUserAuth()
    expect(isErrorResponse(result)).toBe(false)
    if (isErrorResponse(result)) return
    expect(result.session.user.actorId).toBe('user-1')
    expect(result.session.user.id).toBe('manager-1')
    expect(result.session.user.role).toBe('writer')
    expect(result.session.user.pointCredits).toBe(125)
  })

  it('uses the current database role for permission checks after a role change', async () => {
    getServerSessionMock.mockResolvedValue(session({ role: 'writer' }))
    userFindUniqueMock.mockResolvedValue(account({
      role: 'storyboard',
      permissions: ['read', 'storyboardWrite'],
    }))
    const { requireUserPermission, isErrorResponse } = await import('@/lib/api-auth')
    const result = await requireUserPermission(['storyboardWrite'])
    expect(isErrorResponse(result)).toBe(false)
    if (isErrorResponse(result)) return
    expect(result.session.user.role).toBe('storyboard')
    expect(result.session.user.permissions).toEqual(['read', 'storyboardWrite'])
  })

  it('rejects disabled accounts immediately', async () => {
    userFindUniqueMock.mockResolvedValue(account({ status: 'disabled' }))
    const { requireUserAuth, isErrorResponse } = await import('@/lib/api-auth')
    const result = await requireUserAuth()
    expect(isErrorResponse(result)).toBe(true)
    expect((result as Response).status).toBe(403)
  })

  it('rejects permanently deleted subaccounts even when an old session remains', async () => {
    userFindUniqueMock.mockResolvedValue(account({ status: 'deleted' }))
    const { requireUserAuth, isErrorResponse } = await import('@/lib/api-auth')
    const result = await requireUserAuth()
    expect(isErrorResponse(result)).toBe(true)
    expect((result as Response).status).toBe(403)
  })

  it('rejects a subaccount when its management account is disabled', async () => {
    userFindUniqueMock.mockResolvedValue(account({
      parentAccount: { id: 'manager-1', role: 'admin', status: 'disabled' },
    }))
    const { requireUserAuth, isErrorResponse } = await import('@/lib/api-auth')
    const result = await requireUserAuth()
    expect(isErrorResponse(result)).toBe(true)
    expect((result as Response).status).toBe(403)
  })

  it('rejects sessions invalidated by a password reset', async () => {
    userFindUniqueMock.mockResolvedValue(account({ sessionVersion: 2 }))
    const { requireUserAuth, isErrorResponse } = await import('@/lib/api-auth')
    const result = await requireUserAuth()
    expect(isErrorResponse(result)).toBe(true)
    expect((result as Response).status).toBe(401)
  })
})
