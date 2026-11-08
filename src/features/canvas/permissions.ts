import { hasAccountPermissions, isAccountRole } from '@/lib/account/permissions'

/**
 * Every authenticated account shares creative capabilities; read-only is the
 * fallback for an unavailable or unrecognized session, not a legacy role.
 */
export function canEditInfiniteCanvas(account: { role?: unknown; permissions?: unknown } | null | undefined): boolean {
  if (!isAccountRole(account?.role)) return false
  return hasAccountPermissions(account || {}, ['canvasWrite'])
}
