import { hasAccountPermissions, isAccountRole } from '@/lib/account/permissions'

/**
 * The toolbox and infinite canvas are shared creative surfaces. Every
 * authenticated work-front role can build and generate here, while the
 * script/asset/storyboard panels keep their role-specific write boundaries.
 */
export function canEditInfiniteCanvas(account: { role?: unknown; permissions?: unknown } | null | undefined): boolean {
  if (!isAccountRole(account?.role)) return false
  return hasAccountPermissions(account || {}, ['canvasWrite'])
}
