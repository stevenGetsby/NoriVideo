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

  it('uses role templates only when a legacy subaccount has no assigned permission array', () => {
    expect(effectiveAccountPermissions('writer')).toEqual(['read', 'scriptWrite', 'toolboxUse', 'canvasWrite'])
    expect(effectiveAccountPermissions('asset')).toEqual(['read', 'assetWrite', 'toolboxUse', 'canvasWrite'])
    expect(effectiveAccountPermissions('storyboard')).toEqual(['read', 'storyboardWrite', 'toolboxUse', 'canvasWrite'])
    expect(hasAccountPermissions({ role: 'writer' }, ['storyboardWrite'])).toBe(false)
    expect(hasAccountPermissions({ role: 'writer' }, ['toolboxUse', 'canvasWrite'])).toBe(true)
  })

  it('authorizes subaccounts from their assigned functional areas instead of a fixed role', () => {
    const customAccount = {
      role: 'writer',
      permissions: ['projectCreate', 'assetWrite', 'storyboardWrite', 'toolboxUse'],
    }
    expect(effectiveAccountPermissions(customAccount.role, customAccount.permissions)).toEqual([
      'read',
      'projectCreate',
      'assetWrite',
      'storyboardWrite',
      'toolboxUse',
    ])
    expect(hasAccountPermissions(customAccount, ['assetWrite', 'storyboardWrite'])).toBe(true)
    expect(hasAccountPermissions(customAccount, ['projectCreate'])).toBe(true)
    expect(hasAccountPermissions(customAccount, ['scriptWrite'])).toBe(false)
    expect(effectiveAccountPermissions('asset', [])).toEqual(['read'])
    expect(effectiveAccountPermissions('writer', ['creativeGenerate'])).toEqual(['read', 'toolboxUse', 'canvasWrite'])
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
  })

  it('keeps project creation independently assignable while reserving project administration', () => {
    expect(requiredPermissionsForApiPath('/api/projects', 'POST')).toEqual(['projectCreate'])
    expect(requiredPermissionsForApiPath('/api/projects/p1', 'PATCH')).toEqual(['admin'])
    expect(requiredPermissionsForApiPath('/api/user/api-config', 'GET')).toEqual(['admin'])
    expect(requiredPermissionsForApiPath('/api/super-agent/execute', 'POST')).toEqual(['admin'])
    expect(requiredPermissionsForApiPath('/api/frameos/toolbox/generate', 'POST')).toEqual(['toolboxUse'])
    expect(requiredPermissionsForApiPath('/api/frameos/toolbox/materials', 'POST')).toEqual(['toolboxUse'])
    expect(requiredPermissionsForApiPath('/api/frameos/materials', 'POST')).toEqual(['assetWrite'])
  })

  it('lets the screenwriter role run and save video repaint scripts', () => {
    expect(requiredPermissionsForApiPath('/api/video-repaint/understand', 'POST')).toEqual(['scriptWrite'])
    expect(requiredPermissionsForApiPath('/api/video-repaint/adapt', 'POST')).toEqual(['scriptWrite'])
    expect(requiredPermissionsForApiPath('/api/video-repaint/scripts', 'GET')).toEqual(['read'])
  })

  it('reserves workspace structure for managers while deferring human task actions', () => {
    expect(requiredPermissionsForApiPath('/api/works', 'POST')).toEqual(['admin'])
    expect(requiredPermissionsForApiPath('/api/works/w1/members', 'DELETE')).toEqual(['admin'])
    expect(requiredPermissionsForApiPath('/api/projects/p1/members', 'POST')).toEqual(['admin'])
    expect(requiredPermissionsForApiPath('/api/collaboration/assignments/submit', 'POST')).toEqual(['read'])
    expect(requiredPermissionsForApiPath('/api/creative/projects/collaboration/assignments/approve', 'POST')).toEqual(['read'])
  })
})
