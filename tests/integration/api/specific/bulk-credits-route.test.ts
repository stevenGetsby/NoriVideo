import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  targets: vi.fn(),
  bulk: vi.fn(),
}))
vi.mock('@/lib/api-auth', () => ({
  requireUserAuth: mocks.auth,
  isErrorResponse: (value: unknown) => value instanceof Response,
  forbidden: (message: string) => new Response(JSON.stringify({ message }), { status: 403 }),
}))
vi.mock('@/lib/prisma', () => ({ prisma: { user: { findMany: mocks.targets } } }))
vi.mock('@/lib/billing/credit-ledger', async (original) => ({ ...await original<Record<string, unknown>>(), allocateAccountPointsBulk: mocks.bulk }))
import { POST } from '@/app/api/admin/accounts/bulk-credits/route'

const account = (id: string, ownerId = 'manager') => ({
  id, role: 'writer', parentAccountId: ownerId, workspaceOwnerId: ownerId,
})
function request(body: unknown) {
  return POST(new NextRequest('http://localhost/api/admin/accounts/bulk-credits', { method: 'POST', body: JSON.stringify(body) }) as never, { params: Promise.resolve({}) })
}

describe('bulk account credits route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.auth.mockResolvedValue({ session: { user: { id: 'manager', role: 'admin' } } })
    mocks.targets.mockImplementation(async ({ where }: { where: { id: { in: string[] } } }) => where.id.in.map((id) => account(id)))
    mocks.bulk.mockResolvedValue({ allocated: [{ userId: 'member', points: 10, idempotent: false }], operatorBalancePoints: 90 })
  })
  it('only accepts direct active subaccounts and rejects the entire mixed request', async () => {
    mocks.targets.mockResolvedValue([account('member'), account('other', 'other-manager')])
    const response = await request({ points: 10, userIds: ['member', 'other'], idempotencyKey: 'bulk' })
    expect(response.status).toBe(403)
    expect(mocks.bulk).not.toHaveBeenCalled()
  })
  it('deduplicates member ids before allocating', async () => {
    const response = await request({ points: 10, userIds: ['member', 'member'], idempotencyKey: 'bulk' })
    expect(response.status).toBe(200)
    expect(mocks.bulk).toHaveBeenCalledWith(expect.objectContaining({ targetUserIds: ['member'] }))
  })
  it.each([0, 1.5, true, 2_000_000_001])('rejects invalid allocation amount %j', async (points) => {
    expect((await request({ points, userIds: ['member'], idempotencyKey: 'bulk' })).status).toBe(400)
    expect(mocks.bulk).not.toHaveBeenCalled()
  })
  it('does not let a member allocate team credits', async () => {
    mocks.auth.mockResolvedValue({ session: { user: { id: 'manager', actorId: 'member', role: 'writer' } } })
    expect((await request({ points: 10, userIds: ['member'], idempotencyKey: 'bulk' })).status).toBe(403)
  })
})
