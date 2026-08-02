import { describe, expect, it } from 'vitest'
import {
  authCookieNamespace,
  isAllowedAdminSurfaceApi,
  isPlatformAdminPage,
  isRoleAllowedOnSurface,
  resolveAppSurface,
  resolveRequestSurface,
  stripSupportedLocale,
  surfaceLoginError,
  SURFACE_LOGIN_ERRORS,
} from '@/lib/app-surface'

describe('application surface isolation', () => {
  it('normalizes deployment surface values', () => {
    expect(resolveAppSurface('workspace')).toBe('workspace')
    expect(resolveAppSurface('admin')).toBe('admin')
    expect(resolveAppSurface('unexpected')).toBe('combined')
  })

  it('resolves immutable-image middleware surfaces from the request port', () => {
    expect(resolveRequestSurface({ host: '14.103.22.173' })).toBe('workspace')
    expect(resolveRequestSurface({ host: '14.103.22.173:8080' })).toBe('admin')
    expect(resolveRequestSurface({ host: '[::1]:8080' })).toBe('admin')
    expect(resolveRequestSurface({
      host: 'app.internal:3000',
      forwardedHost: '14.103.22.173',
      forwardedPort: '8080',
    })).toBe('admin')
    expect(resolveRequestSurface({ host: 'localhost:9000' }, '9000')).toBe('admin')
  })

  it('recognizes localized and unlocalized platform Admin pages', () => {
    expect(isPlatformAdminPage('/zh/admin/accounts')).toBe(true)
    expect(isPlatformAdminPage('/admin/signin')).toBe(true)
    expect(isPlatformAdminPage('/zh/account-management')).toBe(false)
    expect(stripSupportedLocale('/en/admin/services')).toEqual({ locale: 'en', pathname: '/admin/services' })
  })

  it('limits the dedicated Admin service API surface', () => {
    expect(isAllowedAdminSurfaceApi('/api/auth/session')).toBe(true)
    expect(isAllowedAdminSurfaceApi('/api/admin/accounts')).toBe(true)
    expect(isAllowedAdminSurfaceApi('/api/novel-promotion/project-1')).toBe(false)
  })

  it('keeps platform and production account roles on separate surfaces', () => {
    expect(isRoleAllowedOnSurface('super_admin', 'admin')).toBe(true)
    expect(isRoleAllowedOnSurface('admin', 'admin')).toBe(false)
    expect(isRoleAllowedOnSurface('super_admin', 'workspace')).toBe(false)
    expect(isRoleAllowedOnSurface('writer', 'workspace')).toBe(true)
    expect(authCookieNamespace('admin')).not.toBe(authCookieNamespace('workspace'))
    expect(surfaceLoginError('super_admin')).toBe(SURFACE_LOGIN_ERRORS.adminRequired)
    expect(surfaceLoginError('storyboard')).toBe(SURFACE_LOGIN_ERRORS.workspaceRequired)
  })
})
