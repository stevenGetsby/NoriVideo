import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  user: { findUnique: vi.fn(), update: vi.fn(async () => ({})) },
  userBalance: { findUnique: vi.fn() },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/prisma-retry', () => ({ withPrismaRetry: async (run: () => unknown) => run() }))
vi.mock('@next-auth/prisma-adapter', () => ({ PrismaAdapter: () => ({}) }))
vi.mock('bcryptjs', () => ({ default: { compare: vi.fn(async () => true) } }))
vi.mock('@/lib/logging/semantic', () => ({ logAuthAction: vi.fn() }))
import { authOptions } from '@/lib/auth'
import { getGenerationWalletPoints } from '@/lib/account/generation-wallet'

const child = {
  id: 'child', name: 'member', password: 'unit-test-hash', status: 'active', role: 'storyboard',
  roleLabel: null, permissions: [], sessionVersion: 0, workspaceOwnerId: 'manager', parentAccountId: 'manager',
  parentAccount: { id: 'manager', role: 'admin', status: 'active' }, coinCredits: 0, balance: { balance: 0 },
}
describe('shared generation wallet login/session', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    db.user.findUnique.mockResolvedValue(child)
    db.userBalance.findUnique.mockResolvedValue({ balance: 3.5 })
  })
  it('credentials login already exposes shared points for a zero-balance child', async () => {
    const result = await authOptions.providers[0].options.authorize({ username: 'member', password: 'unit-test-password' })
    expect(result).toMatchObject({ id: 'child', workspaceOwnerId: 'manager', pointCredits: 350 })
    expect(db.user.update).toHaveBeenCalledWith({ where: { id: 'child' }, data: { lastLoginAt: expect.any(Date) } })
  })
  it('JWT and session use manager points, not the zero-valued child wallet', async () => {
    const token = await authOptions.callbacks.jwt({ token: { id: 'child', sessionVersion: 0 } })
    expect(token.pointCredits).toBe(350)
    const session = await authOptions.callbacks.session({ session: { user: {} }, token })
    expect(session.user.id).toBe('child')
    expect(session.user.workspaceOwnerId).toBe('manager')
    expect(session.user.pointCredits).toBe(350)
    expect(db.userBalance.findUnique).toHaveBeenCalledWith({ where: { userId: 'manager' }, select: { balance: true } })
  })
  it('a missing shared wallet never falls back to positive personal/legacy credits', async () => {
    db.userBalance.findUnique.mockResolvedValue(null)
    expect(await getGenerationWalletPoints({ ...child, balance: { balance: 999 } })).toBe(0)
  })
  it('management accounts retain their own wallet snapshot without fetching a parent wallet', async () => {
    expect(await getGenerationWalletPoints({ ...child, role: 'admin', balance: { balance: 1.25 } })).toBe(125)
    expect(db.userBalance.findUnique).not.toHaveBeenCalled()
  })
})
