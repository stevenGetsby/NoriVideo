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
describe('personal generation wallet login/session', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    db.user.findUnique.mockResolvedValue(child)
    db.userBalance.findUnique.mockResolvedValue({ balance: 3.5 })
  })
  it('credentials login exposes the member own wallet snapshot', async () => {
    const result = await authOptions.providers[0].options.authorize({ username: 'member', password: 'unit-test-password' })
    expect(result).toMatchObject({ id: 'child', workspaceOwnerId: 'manager', pointCredits: 0 })
    expect(db.user.update).toHaveBeenCalledWith({ where: { id: 'child' }, data: { lastLoginAt: expect.any(Date) } })
  })
  it('JWT and session use the member own wallet, never the manager wallet', async () => {
    const token = await authOptions.callbacks.jwt({ token: { id: 'child', sessionVersion: 0 } })
    expect(token.pointCredits).toBe(0)
    const session = await authOptions.callbacks.session({ session: { user: {} }, token })
    expect(session.user.id).toBe('child')
    expect(session.user.workspaceOwnerId).toBe('manager')
    expect(session.user.pointCredits).toBe(0)
    expect(db.userBalance.findUnique).not.toHaveBeenCalled()
  })
  it('uses the personal balance snapshot even when a manager wallet exists', async () => {
    db.userBalance.findUnique.mockResolvedValue(null)
    expect(await getGenerationWalletPoints({ ...child, balance: { balance: 999 } })).toBe(99900)
  })
  it('management accounts retain their own wallet snapshot without fetching a parent wallet', async () => {
    expect(await getGenerationWalletPoints({ ...child, role: 'admin', balance: { balance: 1.25 } })).toBe(125)
    expect(db.userBalance.findUnique).not.toHaveBeenCalled()
  })
})
