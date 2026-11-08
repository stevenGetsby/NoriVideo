import { describe, expect, it } from 'vitest'
import {
  canAccessProject,
  canAccessWork,
  effectiveProjectMemberPermissions,
  effectiveWorkMemberPermissions,
  type ScopedActor,
} from '@/lib/permissions/resolve'
import { effectiveAccountPermissions, requiredPermissionsForApiPath } from '@/lib/account/permissions'

const memberActor: ScopedActor = {
  actorId: 'artist-1',
  isManagement: false,
  projectLeader: false,
}
const leaderActor = { ...memberActor, projectLeader: true }
const work = { createdById: 'admin-1' }
const project = { createdById: 'artist-1', work }
const otherProject = { createdById: 'artist-2', work }

describe('scoped permission resolver', () => {
  it('gives management accounts full workspace and object access without membership rows', () => {
    const admin = { ...memberActor, actorId: 'admin-1', isManagement: true }
    expect(canAccessWork(admin, 'workDelete', work)).toBe(true)
    expect(canAccessProject(admin, 'projectManage', otherProject)).toBe(true)
    expect(canAccessProject(admin, 'projectMemberManage', otherProject)).toBe(true)
  })

  it('authorizes workspace leaders independently of membership role and grants', () => {
    for (const membership of [null, { role: 'member' }, { role: 'leader', canManage: false }]) {
      expect(canAccessWork(leaderActor, 'workMemberManage', work, membership)).toBe(true)
      expect(canAccessWork(leaderActor, 'workManage', work, membership)).toBe(true)
      expect(canAccessProject(leaderActor, 'projectMemberManage', otherProject, membership)).toBe(true)
    }
  })

  it('never treats legacy leader, manager, canManage, or admin JSON as project leadership', () => {
    for (const membership of [
      { role: 'leader' },
      { role: 'manager' },
      { role: 'member', canManage: true },
      { role: 'leader', permissions: ['workManage', 'workDelete', 'projectDelete', 'admin'] },
    ]) {
      expect(canAccessWork(memberActor, 'workManage', work, membership)).toBe(false)
      expect(canAccessWork(memberActor, 'workMemberManage', work, membership)).toBe(false)
      expect(canAccessWork(memberActor, 'workDelete', work, membership)).toBe(false)
      expect(canAccessProject(memberActor, 'projectMemberManage', otherProject, membership)).toBe(false)
    }
  })

  it('lets ordinary project participants create and manage works, but not administer their parent project', () => {
    const membership = { role: 'member' }
    expect(canAccessWork(memberActor, 'projectCreate', work, membership)).toBe(true)
    expect(canAccessProject(memberActor, 'projectManage', otherProject, membership)).toBe(true)
    expect(canAccessWork(memberActor, 'workManage', work, membership)).toBe(false)
    expect(canAccessWork(memberActor, 'workMemberManage', work, membership)).toBe(false)
  })

  it('does not leak access to nonmembers or across workspaces', () => {
    expect(canAccessWork(memberActor, 'projectCreate', work, null)).toBe(false)
    expect(canAccessProject(memberActor, 'projectManage', otherProject, null, null)).toBe(false)
    expect(canAccessWork({ ...memberActor, accountPermissions: ['workCreate', 'projectManage'] }, 'workManage', work, null)).toBe(false)
  })

  it('preserves historical creator capabilities without granting project membership administration', () => {
    expect(canAccessProject(memberActor, 'projectManage', project, null, null)).toBe(true)
    expect(canAccessProject(memberActor, 'projectMove', project, null, null)).toBe(true)
    expect(canAccessProject(memberActor, 'projectMemberManage', project, { role: 'leader', canManage: true })).toBe(false)
    expect(canAccessWork(memberActor, 'workManage', work, { role: 'creator', canManage: true })).toBe(false)
  })

  it('only accepts compatible historical work permissions and always supplies member creation access', () => {
    expect(effectiveWorkMemberPermissions({ role: 'leader', permissions: ['projectCreate', 'invalid'] })).toEqual(['projectCreate', 'projectManage'])
    expect(effectiveWorkMemberPermissions({ permissions: ['workManage', 'workDelete'] })).toEqual(['projectCreate', 'projectManage'])
    expect(effectiveProjectMemberPermissions({ role: 'member', permissions: ['assignmentReview'] })).toEqual(['projectManage', 'assignmentReview'])
    expect(effectiveProjectMemberPermissions({ role: 'owner', permissions: [] })).toEqual(['projectManage'])
    expect(effectiveProjectMemberPermissions({ role: 'owner' })).toEqual(['projectManage', 'projectMove', 'assignmentManage', 'assignmentReview'])
  })

  it('keeps review and assignment flags out of project membership administration', () => {
    const membership = { canManageAssignments: true, canReviewAssignments: true, role: 'member', permissions: ['projectMemberManage'] }
    expect(canAccessProject(memberActor, 'assignmentReview', otherProject, null, membership)).toBe(false)
    expect(canAccessProject(memberActor, 'projectManage', otherProject, null, membership)).toBe(true)
    expect(canAccessProject(memberActor, 'projectMemberManage', otherProject, null, membership)).toBe(false)
  })
})

describe('account-level creation gate', () => {
  it('does not allow legacy JSON to opt a subaccount into project creation or administration', () => {
    expect(effectiveAccountPermissions('writer', ['workCreate'])).not.toContain('workCreate')
    expect(effectiveAccountPermissions('writer', ['admin', 'workCreate'])).not.toContain('admin')
    expect(effectiveAccountPermissions('admin')).toContain('workCreate')
  })

  it('lets scope-aware project routes through the account gate', () => {
    expect(requiredPermissionsForApiPath('/api/works', 'POST')).toEqual(['read'])
    expect(requiredPermissionsForApiPath('/api/works/work-1/members', 'POST')).toEqual(['read'])
    expect(requiredPermissionsForApiPath('/api/projects/project-1', 'DELETE')).toEqual(['read'])
    expect(requiredPermissionsForApiPath('/api/admin/accounts', 'POST')).toEqual(['admin'])
  })
})
