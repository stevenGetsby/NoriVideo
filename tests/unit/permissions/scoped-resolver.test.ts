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
  accountPermissions: ['projectCreate'],
}
const work = { createdById: 'admin-1' }
const project = { createdById: 'artist-1', work }
const otherProject = { createdById: 'artist-2', work }

describe('scoped permission resolver', () => {
  it('gives management accounts full access without membership rows', () => {
    const admin = { ...memberActor, actorId: 'admin-1', isManagement: true }
    expect(canAccessWork(admin, 'workDelete', work)).toBe(true)
    expect(canAccessProject(admin, 'projectDelete', otherProject)).toBe(true)
  })

  it('supports leader and legacy manager/canManage membership presets', () => {
    for (const membership of [{ role: 'leader' }, { role: 'manager' }, { role: 'member', canManage: true }]) {
      expect(canAccessWork(memberActor, 'workMemberManage', work, membership)).toBe(true)
      expect(canAccessProject(memberActor, 'projectManage', otherProject, membership)).toBe(true)
      expect(canAccessProject(memberActor, 'projectDelete', otherProject, membership)).toBe(true)
    }
  })

  it('lets ordinary project participants create works but not manage them', () => {
    expect(canAccessWork(memberActor, 'projectCreate', work, { role: 'member' })).toBe(true)
    expect(canAccessProject(memberActor, 'projectManage', otherProject, { role: 'member' })).toBe(false)
    expect(canAccessProject(memberActor, 'projectDelete', otherProject, { role: 'member' })).toBe(false)
  })

  it('allows creators to manage only their own work without project leadership', () => {
    expect(canAccessProject(memberActor, 'projectManage', project, { role: 'member' })).toBe(true)
    expect(canAccessProject(memberActor, 'projectDelete', project, { role: 'member' })).toBe(true)
    expect(canAccessProject(memberActor, 'projectManage', otherProject, { role: 'member' })).toBe(false)
    expect(canAccessWork(memberActor, 'workManage', work, { role: 'member' })).toBe(false)
  })

  it('uses explicit permissions instead of the role preset and ignores unknown keys', () => {
    expect(effectiveWorkMemberPermissions({ role: 'leader', permissions: ['projectCreate', 'invalid'] })).toEqual(['projectCreate'])
    expect(canAccessWork(memberActor, 'workManage', work, { role: 'leader', permissions: ['projectCreate'] })).toBe(false)
    expect(effectiveProjectMemberPermissions({ role: 'member', permissions: ['assignmentManage'] })).toEqual(['assignmentManage'])
    expect(effectiveProjectMemberPermissions({ role: 'owner', permissions: [] })).toEqual([])
  })

  it('keeps explicit work-level permissions scoped to their project', () => {
    const scopedActor = { ...memberActor, accountPermissions: [] }
    expect(canAccessWork(scopedActor, 'workManage', work, { permissions: ['workManage'] })).toBe(true)
    expect(canAccessWork(scopedActor, 'workDelete', work, { permissions: ['workManage'] })).toBe(false)
  })
})

describe('account-level creation permission', () => {
  it('defaults subaccount work creation off and permits individual opt-in', () => {
    expect(effectiveAccountPermissions('writer')).not.toContain('workCreate')
    expect(effectiveAccountPermissions('writer', ['read', 'projectCreate', 'workCreate'])).toContain('workCreate')
    expect(effectiveAccountPermissions('writer', ['admin', 'workCreate'])).not.toContain('admin')
    expect(effectiveAccountPermissions('admin')).toContain('workCreate')
  })

  it('lets scope-aware project routes through the account gate', () => {
    expect(requiredPermissionsForApiPath('/api/works', 'POST')).toEqual(['workCreate'])
    expect(requiredPermissionsForApiPath('/api/works/work-1/members', 'POST')).toEqual(['read'])
    expect(requiredPermissionsForApiPath('/api/projects/project-1', 'DELETE')).toEqual(['read'])
  })
})
