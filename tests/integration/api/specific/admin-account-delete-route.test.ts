import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockRequest } from '../../../helpers/request'

const requireAdminAuthMock = vi.hoisted(() => vi.fn())
const transactionMock = vi.hoisted(() => ({
  user: { updateMany: vi.fn() },
  workMember: { deleteMany: vi.fn() },
  projectMember: { deleteMany: vi.fn() },
  workflowAssignment: { updateMany: vi.fn() },
  workspaceTeamSeat: { updateMany: vi.fn() },
  session: { deleteMany: vi.fn() },
}))
const prismaMock = vi.hoisted(() => ({
  user: {
    count: vi.fn(),
    deleteMany: vi.fn(),
    findFirst: vi.fn(),
  },
  work: { count: vi.fn() },
  project: { count: vi.fn() },
  globalCharacter: { count: vi.fn() },
  globalLocation: { count: vi.fn() },
  globalVoice: { count: vi.fn() },
  task: { count: vi.fn() },
  $transaction: vi.fn(),
}))

vi.mock('@/lib/api-auth', () => ({
  requireAdminAuth: requireAdminAuthMock,
  isErrorResponse: (value: unknown) => value instanceof Response,
  forbidden: (message: string) => Response.json({ error: message }, { status: 403 }),
}))
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

const childAccount = {
  id: 'child-1',
  name: 'writer-child',
  role: 'writer',
  status: 'active',
  permissions: null,
  workspaceOwnerId: 'manager-1',
  parentAccountId: 'manager-1',
  coinCredits: 0,
  pointCredits: 0,
  createdAt: new Date('2026-07-18T00:00:00.000Z'),
  updatedAt: new Date('2026-07-18T00:00:00.000Z'),
  lastLoginAt: null,
}

async function deleteChild() {
  const { DELETE } = await import('@/app/api/admin/accounts/[userId]/route')
  return DELETE(
    buildMockRequest({ path: '/api/admin/accounts/child-1', method: 'DELETE' }),
    { params: Promise.resolve({ userId: 'child-1' }) },
  )
}

describe('management account subaccount deletion', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireAdminAuthMock.mockResolvedValue({
      session: {
        user: {
          id: 'manager-1',
          actorId: 'manager-1',
          role: 'admin',
        },
      },
    })
    prismaMock.user.findFirst.mockResolvedValue(childAccount)
    prismaMock.$transaction.mockImplementation(async (callback: (tx: typeof transactionMock) => unknown) => callback(transactionMock))
    transactionMock.user.updateMany.mockResolvedValue({ count: 1 })
    transactionMock.workMember.deleteMany.mockResolvedValue({ count: 0 })
    transactionMock.projectMember.deleteMany.mockResolvedValue({ count: 0 })
    transactionMock.workflowAssignment.updateMany.mockResolvedValue({ count: 0 })
    transactionMock.workspaceTeamSeat.updateMany.mockResolvedValue({ count: 0 })
    transactionMock.session.deleteMany.mockResolvedValue({ count: 0 })
  })

  it('deletes a direct subaccount without deleting or blocking on team projects', async () => {
    prismaMock.project.count.mockResolvedValue(5)
    prismaMock.work.count.mockResolvedValue(2)

    const response = await deleteChild()

    expect(response.status).toBe(200)
    expect(prismaMock.project.count).not.toHaveBeenCalled()
    expect(prismaMock.work.count).not.toHaveBeenCalled()
    expect(prismaMock.user.deleteMany).not.toHaveBeenCalled()
    await expect(response.json()).resolves.toMatchObject({ success: true, deletedUserId: 'child-1' })
  })

  it('tombstones login identity and removes memberships while preserving audit data', async () => {
    await deleteChild()

    expect(transactionMock.user.updateMany).toHaveBeenCalledWith({
      where: { id: 'child-1', status: { not: 'deleted' } },
      data: {
        name: 'deleted-child-1',
        email: null,
        image: null,
        password: null,
        status: 'deleted',
        permissions: [],
        sessionVersion: { increment: 1 },
      },
    })
    expect(transactionMock.workMember.deleteMany).toHaveBeenCalledWith({ where: { userId: 'child-1' } })
    expect(transactionMock.projectMember.deleteMany).toHaveBeenCalledWith({ where: { userId: 'child-1' } })
    expect(transactionMock.workflowAssignment.updateMany).toHaveBeenCalledWith({
      where: {
        assigneeUserId: 'child-1',
        status: { in: ['in_progress', 'rejected'] },
      },
      data: {
        assigneeUserId: null,
        assignedAt: null,
        submittedAt: null,
        status: 'unassigned',
      },
    })
    expect(transactionMock.session.deleteMany).toHaveBeenCalledWith({ where: { userId: 'child-1' } })
  })

  it('returns a conflict when another request already removed the account', async () => {
    transactionMock.user.updateMany.mockResolvedValueOnce({ count: 0 })

    const response = await deleteChild()

    expect(response.status).toBe(409)
    expect(transactionMock.workMember.deleteMany).not.toHaveBeenCalled()
  })

  it('does not let a manager delete another workspace child', async () => {
    prismaMock.user.findFirst.mockResolvedValueOnce({
      ...childAccount,
      workspaceOwnerId: 'manager-2',
      parentAccountId: 'manager-2',
    })

    const response = await deleteChild()

    expect(response.status).toBe(403)
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })
})
