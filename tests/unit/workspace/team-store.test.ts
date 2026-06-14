import { describe, expect, it } from 'vitest'
import {
  countWorkspaceTeamPermissions,
  defaultWorkspaceTeamPermissions,
  normalizeWorkspaceTeamPermissions,
  normalizeWorkspaceTeamSeatPatch,
  normalizeWorkspaceTeamSeatStatus,
} from '@/lib/workspace/team-store'

describe('workspace team store helpers', () => {
  it('keeps the owner seat enabled with full permissions', () => {
    expect(normalizeWorkspaceTeamSeatStatus('owner', 'reserved')).toBe('enabled')
    expect(normalizeWorkspaceTeamPermissions('owner', ['projects'])).toEqual([
      'projects',
      'scripts',
      'assets',
      'production',
      'records',
    ])
    expect(countWorkspaceTeamPermissions('owner', [])).toBe(5)
  })

  it('normalizes configurable reserved seats', () => {
    expect(normalizeWorkspaceTeamSeatStatus('writer', 'enabled')).toBe('enabled')
    expect(normalizeWorkspaceTeamSeatStatus('writer', 'disabled')).toBe('reserved')
    expect(normalizeWorkspaceTeamPermissions('producer', {
      projects: true,
      production: true,
      unknown: true,
      records: false,
    })).toEqual(['projects', 'production'])
  })

  it('falls back to role defaults when permissions are empty or invalid', () => {
    expect(normalizeWorkspaceTeamPermissions('asset', ['invalid'])).toEqual(defaultWorkspaceTeamPermissions('asset'))
  })

  it('normalizes patch payloads and rejects invalid roles', () => {
    expect(normalizeWorkspaceTeamSeatPatch({ role: 'unknown' })).toBeNull()
    expect(normalizeWorkspaceTeamSeatPatch({
      role: 'writer',
      status: 'enabled',
      displayName: '  Writer Seat  ',
      email: '',
      permissions: ['scripts', 'records', 'bad'],
    })).toEqual({
      role: 'writer',
      status: 'enabled',
      displayName: 'Writer Seat',
      email: null,
      permissions: ['scripts', 'records'],
    })
  })
})
