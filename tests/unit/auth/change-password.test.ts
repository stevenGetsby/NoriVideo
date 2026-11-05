import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const getAuthSessionMock = vi.hoisted(() => vi.fn())
const findUniqueMock = vi.hoisted(() => vi.fn())
const updateManyMock = vi.hoisted(() => vi.fn())
const deleteManyMock = vi.hoisted(() => vi.fn())
const checkRateLimitMock = vi.hoisted(() => vi.fn())
const compareMock = vi.hoisted(() => vi.fn())
const hashMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api-auth', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/api-auth')>(),
  getAuthSession: getAuthSessionMock,
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: findUniqueMock, updateMany: updateManyMock },
    session: { deleteMany: deleteManyMock },
  },
}))
vi.mock('@/lib/rate-limit', () => ({
  AUTH_LOGIN_LIMIT: { windowSeconds: 60, maxRequests: 5 },
  checkRateLimit: checkRateLimitMock,
  getClientIp: vi.fn(() => '127.0.0.1'),
}))
vi.mock('bcryptjs', () => ({ default: { compare: compareMock, hash: hashMock } }))
vi.mock('@/lib/logging/core', () => ({
  logInfo: vi.fn(),
  logError: vi.fn(),
  logWarn: vi.fn(),
  createScopedLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
}))

function request(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/auth/change-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const validBody = { currentPassword: 'initial-password', newPassword: 'new-password-1', confirmPassword: 'new-password-1' }

describe('initial password change API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    checkRateLimitMock.mockResolvedValue({ limited: false })
    getAuthSessionMock.mockResolvedValue({ user: { id: 'member-1', status: 'active', sessionVersion: 0 } })
    findUniqueMock.mockResolvedValue({
      id: 'member-1', password: 'stored-hash', status: 'active', sessionVersion: 0,
      passwordChangeRequired: true, parentAccount: { status: 'active' },
    })
    compareMock.mockResolvedValue(true)
    hashMock.mockResolvedValue('new-hash')
    updateManyMock.mockResolvedValue({ count: 1 })
    deleteManyMock.mockResolvedValue({ count: 0 })
  })

  it('clears the required flag without revoking the current JWT session', async () => {
    const { POST } = await import('@/app/api/auth/change-password/route')
    const response = await POST(request(validBody), { params: Promise.resolve({}) })
    expect(response.status).toBe(200)
    expect(updateManyMock).toHaveBeenCalledWith({
      where: { id: 'member-1', sessionVersion: 0, passwordChangeRequired: true },
      data: { password: 'new-hash', passwordChangeRequired: false },
    })
    expect(deleteManyMock).toHaveBeenCalledWith({ where: { userId: 'member-1' } })
  })

  it('rejects a wrong initial password without changing the account', async () => {
    compareMock.mockResolvedValue(false)
    const { POST } = await import('@/app/api/auth/change-password/route')
    const response = await POST(request(validBody), { params: Promise.resolve({}) })
    expect(response.status).toBe(401)
    expect(updateManyMock).not.toHaveBeenCalled()
  })

  it.each([
    ['mismatched confirmation', { ...validBody, confirmPassword: 'different-password' }],
    ['a short new password', { ...validBody, newPassword: 'short', confirmPassword: 'short' }],
    ['the unchanged initial password', { ...validBody, newPassword: 'initial-password', confirmPassword: 'initial-password' }],
  ])('rejects %s', async (_name, body) => {
    const { POST } = await import('@/app/api/auth/change-password/route')
    const response = await POST(request(body), { params: Promise.resolve({}) })
    expect(response.status).toBe(400)
    expect(compareMock).not.toHaveBeenCalled()
  })

  it('does not allow an old session after an administrator reset', async () => {
    findUniqueMock.mockResolvedValue({
      id: 'member-1', password: 'new-admin-hash', status: 'active', sessionVersion: 1,
      passwordChangeRequired: true, parentAccount: { status: 'active' },
    })
    const { POST } = await import('@/app/api/auth/change-password/route')
    const response = await POST(request(validBody), { params: Promise.resolve({}) })
    expect(response.status).toBe(401)
    expect(compareMock).not.toHaveBeenCalled()
    expect(updateManyMock).not.toHaveBeenCalled()
  })

  it('does not change the password when a concurrent update wins', async () => {
    updateManyMock.mockResolvedValue({ count: 0 })
    const { POST } = await import('@/app/api/auth/change-password/route')
    const response = await POST(request(validBody), { params: Promise.resolve({}) })
    expect(response.status).toBe(409)
    expect(deleteManyMock).not.toHaveBeenCalled()
  })

  it('requires authentication', async () => {
    getAuthSessionMock.mockResolvedValue(null)
    const { POST } = await import('@/app/api/auth/change-password/route')
    const response = await POST(request(validBody), { params: Promise.resolve({}) })
    expect(response.status).toBe(401)
    expect(findUniqueMock).not.toHaveBeenCalled()
  })
})
