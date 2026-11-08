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
  projectLeader?: boolean
}): AuthSession {
  return {
    user: {
      id: input.workspaceOwnerId,
      workspaceOwnerId: input.workspaceOwnerId,
      actorId: input.actorId,
      role: input.role,
      projectLeader: input.projectLeader === true,
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
      projectLeader: false,
      accountPermissions: expect.arrayContaining(['workCreate', 'projectCreate']),
      role: 'admin',
    })
    expect(projectReadScopeWhere(auth)).toEqual({ userId: 'owner-1', deletedAt: null })
  })

  it('limits subaccount creative visibility to created or joined business projects', () => {
    const auth = session({ workspaceOwnerId: 'owner-1', actorId: 'writer-1', role: 'writer' })
    const participation = {
      OR: [
        { createdById: 'writer-1' },
        { members: { some: { userId: 'writer-1' } } },
      ],
    }
    const membership = { work: participation }
    expect(projectReadScopeWhere(auth)).toEqual({
      userId: 'owner-1',
      deletedAt: null,
      ...membership,
    })
    expect(projectReadWhere(auth, 'project-7')).toMatchObject({
      id: 'project-7',
      userId: 'owner-1',
      ...membership,
    })
    expect(workReadScopeWhere(auth)).toMatchObject({
      workspaceOwnerId: 'owner-1',
      deletedAt: null,
      ...participation,
    })
  })

  it('keeps the workspace-wide scope for management accounts', () => {
    const auth = session({ workspaceOwnerId: 'owner-1', actorId: 'owner-1', role: 'admin' })
    expect(workReadScopeWhere(auth)).toEqual({ workspaceOwnerId: 'owner-1', deletedAt: null })
  })

  it('hides a teammate work from a nonmember but not an unknown or global id', async () => {
    const actor = { workspaceOwnerId: 'owner-1', actorId: 'writer-1', isManagement: false, role: 'writer' as const }
    prismaMock.project.findFirst.mockResolvedValueOnce({
      work: { createdById: 'owner-1', members: [] },
    })
    await expect(isProjectHiddenFromActor(actor, 'project-other')).resolves.toBe(true)

    prismaMock.project.findFirst.mockResolvedValueOnce({
      work: { createdById: 'owner-1', members: [] },
    })
    await expect(isProjectHiddenFromActor(actor, 'project-assigned')).resolves.toBe(true)

    prismaMock.project.findFirst.mockResolvedValueOnce({
      work: { createdById: 'owner-1', members: [{ id: 'membership-1' }] },
    })
    await expect(isProjectHiddenFromActor(actor, 'project-shared')).resolves.toBe(false)

    prismaMock.project.findFirst.mockResolvedValueOnce({
      work: { createdById: 'writer-1', members: [] },
    })
    await expect(isProjectHiddenFromActor(actor, 'project-created')).resolves.toBe(false)

    prismaMock.project.findFirst.mockResolvedValueOnce(null)
    await expect(isProjectHiddenFromActor(actor, 'global-asset-hub')).resolves.toBe(false)

    prismaMock.project.findFirst.mockClear()
    await expect(isProjectHiddenFromActor({ ...actor, actorId: 'owner-1', isManagement: true }, 'project-other')).resolves.toBe(false)
    expect(prismaMock.project.findFirst).not.toHaveBeenCalled()
  })

  it('shares every work with creators and current project members without legacy bypasses', () => {
    const actor = { workspaceOwnerId: 'owner-1', actorId: 'lead-1', isManagement: false, role: 'writer' as const }
    expect(canActorSeeProject(actor, { isWorkMember: true })).toBe(true)
    expect(canActorSeeProject(actor, { isWorkMember: false })).toBe(false)
    expect(canActorSeeProject(actor, { isWorkMember: false, isWorkCreator: true })).toBe(true)
    expect(canActorSeeProject({ ...actor, isManagement: true }, { isWorkMember: false })).toBe(true)
  })

  it('grants participant creative access without granting membership administration', async () => {
    const auth = session({ workspaceOwnerId: 'owner-1', actorId: 'writer-1', role: 'writer' })
    prismaMock.project.findFirst.mockResolvedValueOnce({
      id: 'project-7',
      createdById: 'owner-1',
      work: {
        createdById: 'owner-1',
        members: [{ role: 'member', canManage: false }],
      },
      members: [],
    })

    const access = await getProjectCollaborationAccess(auth, 'project-7')

    expect(prismaMock.project.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: 'project-7',
        userId: 'owner-1',
        deletedAt: null,
        work: {
          OR: [
            { createdById: 'writer-1' },
            { members: { some: { userId: 'writer-1' } } },
          ],
        },
      }),
    }))
    expect(access).toMatchObject({
      canRead: true,
      canManageProject: true,
      canManageMembers: false,
      canManageAssignments: false,
      canReviewAssignments: false,
      canDelete: false,
    })
  })

  it('does not grant review or management from a reviewer account or legacy work membership', async () => {
    const auth = session({ workspaceOwnerId: 'owner-1', actorId: 'reviewer-1', role: 'reviewer' })
    prismaMock.project.findFirst.mockResolvedValueOnce({
      id: 'project-7',
      createdById: 'owner-1',
      work: {
        createdById: 'owner-1',
        members: [{ role: 'leader', canManage: true }],
      },
      members: [{ role: 'member', canManageAssignments: false, canReviewAssignments: false }],
    })

    await expect(getProjectCollaborationAccess(auth, 'project-7')).resolves.toMatchObject({
      canRead: true,
      canManageProject: true,
      canManageMembers: false,
      canManageAssignments: false,
      canReviewAssignments: false,
      canDelete: false,
    })
  })

  it('revokes member administration immediately when projectLeader is removed', async () => {
    const auth = session({ workspaceOwnerId: 'owner-1', actorId: 'lead-1', role: 'writer', projectLeader: true })
    const row = {
      id: 'project-7',
      createdById: 'writer-2',
      work: { createdById: 'owner-1', members: [{ role: 'member', canManage: false }] },
      members: [],
    }
    prismaMock.project.findFirst.mockResolvedValueOnce(row)
    await expect(getProjectCollaborationAccess(auth, 'project-7')).resolves.toMatchObject({
      canManageMembers: true,
      canManageAssignments: true,
      canDelete: false,
    })

    const revoked = session({ workspaceOwnerId: 'owner-1', actorId: 'lead-1', role: 'writer', projectLeader: false })
    prismaMock.project.findFirst.mockResolvedValueOnce({ ...row, work: { ...row.work, members: [{ role: 'leader', canManage: true }] } })
    await expect(getProjectCollaborationAccess(revoked, 'project-7')).resolves.toMatchObject({
      canManageMembers: false,
      canManageAssignments: false,
      canDelete: false,
    })
  })
})
