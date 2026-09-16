import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthSession } from '@/lib/api-auth'
import {
  getProjectCollaborationAccess,
  getWorkspaceActor,
  projectReadScopeWhere,
  projectReadWhere,
  workReadScopeWhere,
} from '@/lib/collaboration/access'

const prismaMock = vi.hoisted(() => ({
  project: { findFirst: vi.fn() },
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

function session(input: {
  workspaceOwnerId: string
  actorId: string
  role: 'admin' | 'writer' | 'reviewer'
}): AuthSession {
  return {
    user: {
      id: input.workspaceOwnerId,
      workspaceOwnerId: input.workspaceOwnerId,
      actorId: input.actorId,
      role: input.role,
    },
  }
}

describe('work and project object access', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('keeps a management account inside its own workspace without member filters', () => {
    const auth = session({ workspaceOwnerId: 'owner-1', actorId: 'owner-1', role: 'admin' })
    expect(getWorkspaceActor(auth)).toEqual({
      workspaceOwnerId: 'owner-1',
      actorId: 'owner-1',
      isManagement: true,
      role: 'admin',
    })
    expect(projectReadScopeWhere(auth)).toEqual({ userId: 'owner-1' })
  })

  it('lets a direct subaccount read every work and project in its management workspace', () => {
    const auth = session({ workspaceOwnerId: 'owner-1', actorId: 'writer-1', role: 'writer' })
    expect(projectReadScopeWhere(auth)).toEqual({ userId: 'owner-1' })
    expect(projectReadWhere(auth, 'project-7')).toMatchObject({
      id: 'project-7',
      userId: 'owner-1',
    })
    expect(workReadScopeWhere(auth)).toEqual({ workspaceOwnerId: 'owner-1' })
  })

  it('grants workspace read access without granting assignment management or review', async () => {
    const auth = session({ workspaceOwnerId: 'owner-1', actorId: 'writer-1', role: 'writer' })
    prismaMock.project.findFirst.mockResolvedValueOnce({
      id: 'project-7',
      createdById: 'owner-1',
      work: {
        createdById: 'owner-1',
        members: [],
      },
      members: [],
    })

    const access = await getProjectCollaborationAccess(auth, 'project-7')

    expect(prismaMock.project.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: 'project-7',
        userId: 'owner-1',
      },
    }))
    expect(access).toMatchObject({
      canRead: true,
      canManageProject: false,
      canManageAssignments: false,
      canReviewAssignments: false,
    })
  })

  it('lets a reviewer project member review even when the stored flag is still false', async () => {
    const auth = session({ workspaceOwnerId: 'owner-1', actorId: 'reviewer-1', role: 'reviewer' })
    prismaMock.project.findFirst.mockResolvedValueOnce({
      id: 'project-7',
      createdById: 'owner-1',
      work: {
        createdById: 'owner-1',
        members: [],
      },
      members: [{
        canManageAssignments: false,
        canReviewAssignments: false,
      }],
    })

    await expect(getProjectCollaborationAccess(auth, 'project-7')).resolves.toMatchObject({
      canRead: true,
      canManageProject: false,
      canManageAssignments: false,
      canReviewAssignments: true,
    })
  })
})
