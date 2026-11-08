import { describe, expect, it } from 'vitest'
import {
  ALL_ACCOUNT_PERMISSIONS,
  effectiveAccountPermissions,
  hasAccountPermissions,
  isManagementRole,
  normalizeAccountRole,
  requiredPermissionsForApiPath,
} from '@/lib/account/permissions'

describe('account role permission policy', () => {
  it('gives the platform Admin and management accounts every permission', () => {
    expect(effectiveAccountPermissions('super_admin')).toEqual(ALL_ACCOUNT_PERMISSIONS)
    expect(effectiveAccountPermissions('admin')).toEqual(ALL_ACCOUNT_PERMISSIONS)
    expect(hasAccountPermissions({ role: 'super_admin' }, ALL_ACCOUNT_PERMISSIONS)).toBe(true)
    expect(hasAccountPermissions({ role: 'admin' }, ALL_ACCOUNT_PERMISSIONS)).toBe(true)
    expect(isManagementRole('super_admin')).toBe(true)
    expect(isManagementRole('admin')).toBe(true)
    expect(isManagementRole('writer')).toBe(false)
    expect(normalizeAccountRole('owner')).toBe('super_admin')
  })

  it('gives every subaccount the same creative capabilities regardless of historical role', () => {
    const shared = ['read', 'projectCreate', 'scriptWrite', 'assetWrite', 'storyboardWrite', 'toolboxUse', 'canvasWrite'] as const
    for (const role of ['writer', 'asset', 'storyboard', 'reviewer']) {
      expect(effectiveAccountPermissions(role)).toEqual(shared)
      expect(effectiveAccountPermissions(role, [])).toEqual(shared)
      expect(hasAccountPermissions({ role }, shared)).toBe(true)
      expect(hasAccountPermissions({ role }, ['workCreate', 'admin'])).toBe(false)
    }
  })

  it('ignores assigned functional areas and legacy aliases instead of narrowing creative access', () => {
    const customAccount = {
      role: 'writer',
      permissions: ['read', 'admin', 'workCreate'],
    }
    expect(effectiveAccountPermissions(customAccount.role, customAccount.permissions)).toEqual(effectiveAccountPermissions('reviewer'))
    expect(hasAccountPermissions(customAccount, ['scriptWrite', 'assetWrite', 'storyboardWrite', 'toolboxUse', 'canvasWrite'])).toBe(true)
    expect(hasAccountPermissions(customAccount, ['workCreate', 'admin'])).toBe(false)
    expect(effectiveAccountPermissions('asset', ['creativeGenerate'])).toEqual(effectiveAccountPermissions('writer'))
    expect(effectiveAccountPermissions('admin', [])).toEqual(ALL_ACCOUNT_PERMISSIONS)
  })

  it('allows all roles to read but scopes mutations by content domain', () => {
    expect(requiredPermissionsForApiPath('/api/projects', 'GET')).toEqual(['read'])
    expect(requiredPermissionsForApiPath('/api/novel-promotion/p1/episodes/e1', 'PATCH')).toEqual(['scriptWrite'])
    expect(requiredPermissionsForApiPath('/api/asset-hub/characters/c1', 'PATCH')).toEqual(['assetWrite'])
    expect(requiredPermissionsForApiPath('/api/novel-promotion/p1/storyboards', 'POST')).toEqual(['storyboardWrite'])
    expect(requiredPermissionsForApiPath('/api/novel-promotion/p1/script-to-storyboard-stream', 'POST')).toEqual(['storyboardWrite'])
    expect(requiredPermissionsForApiPath('/api/novel-promotion/p1/generate-video', 'POST')).toEqual(['storyboardWrite'])
    expect(requiredPermissionsForApiPath('/api/novel-promotion/p1/editor', 'PUT')).toEqual(['storyboardWrite'])
    expect(requiredPermissionsForApiPath('/api/novel-promotion/p1/regenerate-single-image', 'POST')).toEqual(['assetWrite'])
    expect(requiredPermissionsForApiPath('/api/novel-promotion/p1/import-asset-image', 'POST')).toEqual(['assetWrite'])
    expect(requiredPermissionsForApiPath('/api/novel-promotion/p1/panels/panel-1/materials', 'POST')).toEqual(['storyboardWrite'])
    expect(requiredPermissionsForApiPath('/api/projects/p1/canvas/c1/materials', 'POST')).toEqual(['canvasWrite'])
    expect(requiredPermissionsForApiPath('/api/projects/p1/canvas/c1/generate', 'POST')).toEqual(['canvasWrite'])
    expect(requiredPermissionsForApiPath('/api/interactive', 'GET')).toEqual(['read'])
    expect(requiredPermissionsForApiPath('/api/interactive', 'POST')).toEqual(['projectCreate', 'canvasWrite'])
    expect(requiredPermissionsForApiPath('/api/interactive/w1', 'PATCH')).toEqual(['canvasWrite'])
    expect(requiredPermissionsForApiPath('/api/interactive/w1/chapters', 'POST')).toEqual(['projectCreate', 'canvasWrite'])
  })

  it('keeps project creation independently assignable and defers administration to object scope', () => {
    expect(requiredPermissionsForApiPath('/api/projects', 'POST')).toEqual(['projectCreate'])
    expect(requiredPermissionsForApiPath('/api/projects/p1', 'PATCH')).toEqual(['read'])
    expect(requiredPermissionsForApiPath('/api/projects/p1', 'DELETE')).toEqual(['read'])
    expect(requiredPermissionsForApiPath('/api/novel-promotion/p1', 'PATCH')).toEqual(['read'])
    expect(requiredPermissionsForApiPath('/api/novel-promotion/p1', 'DELETE')).toEqual(['admin'])
    expect(requiredPermissionsForApiPath('/api/user/api-config', 'GET')).toEqual(['admin'])
    expect(requiredPermissionsForApiPath('/api/super-agent/execute', 'POST')).toEqual(['admin'])
    expect(requiredPermissionsForApiPath('/api/frameos/toolbox/generate', 'POST')).toEqual(['toolboxUse'])
    expect(requiredPermissionsForApiPath('/api/frameos/toolbox/materials', 'POST')).toEqual(['toolboxUse'])
    expect(requiredPermissionsForApiPath('/api/frameos/materials', 'POST')).toEqual(['assetWrite'])
  })

  it('allows participant edits without granting unrelated workspace administration', () => {
    expect(requiredPermissionsForApiPath('/api/projects/p1/', 'PATCH')).toEqual(['read'])
    expect(requiredPermissionsForApiPath('/api/projects/p1', 'PUT')).toEqual(['read'])
    expect(requiredPermissionsForApiPath('/api/projects/p1', 'DELETE')).toEqual(['read'])
    expect(requiredPermissionsForApiPath('/api/projects/p1/members', 'PATCH')).toEqual(['read'])
    expect(requiredPermissionsForApiPath('/api/projects/recycle-bin/p1', 'PATCH')).toEqual(['admin'])
  })

  it('lets the screenwriter role run and save video repaint scripts', () => {
    expect(requiredPermissionsForApiPath('/api/video-repaint/understand', 'POST')).toEqual(['scriptWrite'])
    expect(requiredPermissionsForApiPath('/api/video-repaint/adapt', 'POST')).toEqual(['scriptWrite'])
    expect(requiredPermissionsForApiPath('/api/video-repaint/scripts', 'GET')).toEqual(['read'])
  })

  it('defers workspace creation to the projectLeader flag and member management to object scope', () => {
    expect(requiredPermissionsForApiPath('/api/works', 'POST')).toEqual(['read'])
    expect(requiredPermissionsForApiPath('/api/works/w1/members', 'DELETE')).toEqual(['read'])
    expect(requiredPermissionsForApiPath('/api/projects/p1/members', 'POST')).toEqual(['read'])
    expect(requiredPermissionsForApiPath('/api/collaboration/assignments/submit', 'POST')).toEqual(['read'])
    expect(requiredPermissionsForApiPath('/api/creative/projects/collaboration/assignments/approve', 'POST')).toEqual(['read'])
  })
})
