import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  target: vi.fn(),
  recharge: vi.fn(),
  reclaim: vi.fn(),
  allocate: vi.fn(),
}))
vi.mock('@/lib/api-auth', () => ({
  requireAdminAuth: mocks.auth, isErrorResponse: (value: unknown) => value instanceof Response,
  forbidden: (message: string) => new Response(JSON.stringify({ message }), { status: 403 }),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: { user: { findFirst: mocks.target, findUniqueOrThrow: mocks.target } },
}))
vi.mock('@/lib/billing/credit-ledger', async (original) => ({
  ...await original<Record<string, unknown>>(),
  rechargeAccountPoints: mocks.recharge, reclaimAccountPoints: mocks.reclaim, allocateAccountPoints: mocks.allocate,
}))
import { POST } from '@/app/api/admin/accounts/[userId]/credits/route'
const child = {
  id: 'child', name: 'child', role: 'storyboard', status: 'active', permissions: [],
  parentAccountId: 'manager', workspaceOwnerId: 'manager', roleLabel: null,
  balance: { balance: 1 }, coinCredits: 0, dailyPointLimit: null,
  createdAt: new Date(), updatedAt: new Date(), lastLoginAt: null,
}
function request(body: Record<string, unknown>) {
  return POST(new NextRequest('http://localhost/api/admin/accounts/child/credits', {
    method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' },
  }) as never, { params: Promise.resolve({ userId: 'child' }) })
}

describe('shared-wallet management credit operations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.auth.mockResolvedValue({ session: { user: { id: 'manager', role: 'admin' } } })
    mocks.target.mockResolvedValue(child)
    mocks.reclaim.mockResolvedValue({ operation: 'reclaim', points: 100, amountCny: 1, idempotent: false })
  })
  it('rejects legacy monetary allocation instead of draining the shared generation wallet', async () => {
    const response = await request({ operation: 'allocate', points: 100, idempotencyKey: 'allocation' })
    expect(response.status).toBe(400)
    expect((await response.json()).message).toContain('设置额度')
    expect(mocks.allocate).not.toHaveBeenCalled()
    expect(mocks.reclaim).not.toHaveBeenCalled()
    expect(mocks.recharge).not.toHaveBeenCalled()
  })
  it('preserves the ability to reclaim legacy child funds without changing daily limits', async () => {
    const response = await request({ operation: 'reclaim', points: 100, idempotencyKey: 'reclaim' })
    expect(response.status).toBe(200)
    expect(mocks.reclaim).toHaveBeenCalledWith('manager', 'child', 100, expect.objectContaining({ operatorId: 'manager' }))
    expect((await response.json()).account.dailyLimitPoints).toBeNull()
  })
  it('does not allow another management account to reclaim a child wallet', async () => {
    mocks.auth.mockResolvedValueOnce({ session: { user: { id: 'other', role: 'admin' } } })
    const response = await request({ operation: 'reclaim', points: 100 })
    expect(response.status).toBe(403)
    expect(mocks.reclaim).not.toHaveBeenCalled()
  })
  it.each([true, false, null, '', ' ', {}, -1, 0, 1.23456])('rejects invalid credit amount %j before mutating any wallet', async (points) => {
    const response = await request({ operation: 'reclaim', points })
    expect(response.status).toBe(400)
    expect(mocks.reclaim).not.toHaveBeenCalled()
  })
  it('permits fractional legacy points to be reclaimed without leaving a stranded remainder', async () => {
    expect((await request({ operation: 'reclaim', points: 0.6789 })).status).toBe(200)
    expect(mocks.reclaim).toHaveBeenCalledWith('manager', 'child', 0.6789, expect.any(Object))
  })
})
