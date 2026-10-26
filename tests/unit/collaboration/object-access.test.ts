import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthSession } from '@/lib/api-auth'
import {
  canActorSeeProject,
  getProjectCollaborationAccess,
  getWorkspaceActor,
  isProjectHiddenFromActor,
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
    expect(projectReadScopeWhere(auth)).toEqual({ userId: 'owner-1', deletedAt: null })
  })

  it('limits a subaccount to 作品 it created, joined, was assigned, or whose 项目 it leads', () => {
    const auth = session({ workspaceOwnerId: 'owner-1', actorId: 'writer-1', role: 'writer' })
    expect(projectReadScopeWhere(auth)).toEqual({
      userId: 'owner-1',
      deletedAt: null,
      OR: [
        { createdById: 'writer-1' },
        { members: { some: { userId: 'writer-1' } } },
        { workflowAssignments: { some: { assigneeUserId: 'writer-1' } } },
        { work: { createdById: 'writer-1' } },
        { work: { members: { some: { userId: 'writer-1', OR: [{ canManage: true }, { role: 'manager' }] } } } },
      ],
    })
    expect(projectReadWhere(auth, 'project-7')).toMatchObject({
      id: 'project-7',
      userId: 'owner-1',
      OR: expect.any(Array),
    })
    expect(workReadScopeWhere(auth)).toMatchObject({
      workspaceOwnerId: 'owner-1',
      OR: [
        { createdById: 'writer-1' },
        { members: { some: { userId: 'writer-1' } } },
        { projects: { some: expect.objectContaining({ deletedAt: null, OR: expect.any(Array) }) } },
      ],
    })
  })

  it('keeps the workspace-wide scope for management accounts', () => {
    const auth = session({ workspaceOwnerId: 'owner-1', actorId: 'owner-1', role: 'admin' })
    expect(workReadScopeWhere(auth)).toEqual({ workspaceOwnerId: 'owner-1' })
  })

  it('hides a teammate 作品 from a subaccount but not an unknown or global id', async () => {
    const actor = { workspaceOwnerId: 'owner-1', actorId: 'writer-1', isManagement: false, role: 'writer' as const }
    prismaMock.project.findFirst.mockResolvedValueOnce({
      createdById: 'writer-2',
      members: [],
      workflowAssignments: [],
      work: { createdById: 'owner-1', members: [] },
    })
    await expect(isProjectHiddenFromActor(actor, 'project-other')).resolves.toBe(true)

    prismaMock.project.findFirst.mockResolvedValueOnce({
      createdById: 'writer-2',
      members: [],
      workflowAssignments: [{ uuid: 'a-1' }],
      work: { createdById: 'owner-1', members: [] },
    })
    await expect(isProjectHiddenFromActor(actor, 'project-assigned')).resolves.toBe(false)

    prismaMock.project.findFirst.mockResolvedValueOnce(null)
    await expect(isProjectHiddenFromActor(actor, 'global-asset-hub')).resolves.toBe(false)

    prismaMock.project.findFirst.mockClear()
    await expect(isProjectHiddenFromActor({ ...actor, actorId: 'owner-1', isManagement: true }, 'project-other')).resolves.toBe(false)
    expect(prismaMock.project.findFirst).not.toHaveBeenCalled()
  })

  it('lets a 项目 manager see every 作品 in that 项目', () => {
    const actor = { workspaceOwnerId: 'owner-1', actorId: 'lead-1', isManagement: false, role: 'writer' as const }
    expect(canActorSeeProject(actor, {
      createdById: 'writer-2', isMember: false, isAssignee: false, workCreatedById: 'owner-1', isWorkManager: true,
    })).toBe(true)
    expect(canActorSeeProject(actor, {
      createdById: 'writer-2', isMember: false, isAssignee: false, workCreatedById: 'owner-1', isWorkManager: false,
    })).toBe(false)
  })

  it('grants participant read access without granting assignment management or review', async () => {
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
      where: expect.objectContaining({
        id: 'project-7',
        userId: 'owner-1',
        deletedAt: null,
        OR: expect.any(Array),
      }),
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
