export const APP_SURFACES = ['combined', 'workspace', 'admin'] as const

export type AppSurface = (typeof APP_SURFACES)[number]

export const SURFACE_LOGIN_ERRORS = {
  adminRequired: 'AdminSurfaceRequired',
  workspaceRequired: 'WorkspaceSurfaceRequired',
} as const

export type SurfaceLoginError = (typeof SURFACE_LOGIN_ERRORS)[keyof typeof SURFACE_LOGIN_ERRORS]

type RequestSurfaceHeaders = {
  host?: string | null
  forwardedHost?: string | null
  forwardedPort?: string | null
  urlPort?: string | null
}

export function resolveAppSurface(value: unknown = process.env.NORI_APP_SURFACE): AppSurface {
  if (value === 'workspace' || value === 'admin') return value
  return 'combined'
}

function portFromHost(value: string | null | undefined): string {
  const host = value?.split(',')[0]?.trim() || ''
  if (!host) return ''
  try {
    return new URL(`http://${host}`).port
  } catch {
    return ''
  }
}

/** Middleware environment variables are compiled into the Next.js bundle.
 * Resolve the deployed surface from the incoming port so one immutable image
 * can safely serve both the workspace and the dedicated Admin container. */
export function resolveRequestSurface(
  headers: RequestSurfaceHeaders,
  adminPort = '8080',
): 'workspace' | 'admin' {
  const ports = [
    portFromHost(headers.forwardedHost),
    portFromHost(headers.host),
    headers.forwardedPort?.split(',')[0]?.trim() || '',
    headers.urlPort?.trim() || '',
  ]
  return ports.includes(adminPort) ? 'admin' : 'workspace'
}

export function stripSupportedLocale(pathname: string): { locale: 'zh' | 'en'; pathname: string } {
  const match = pathname.match(/^\/(zh|en)(?=\/|$)/)
  const locale = match?.[1] === 'en' ? 'en' : 'zh'
  const withoutLocale = match ? pathname.slice(match[0].length) : pathname
  return {
    locale,
    pathname: withoutLocale.startsWith('/') ? withoutLocale : `/${withoutLocale}`,
  }
}

export function isPlatformAdminPage(pathname: string): boolean {
  const route = stripSupportedLocale(pathname).pathname
  return route === '/admin' || route.startsWith('/admin/')
}

export function isApiPath(pathname: string): boolean {
  return pathname === '/api' || pathname.startsWith('/api/')
}

export function isAllowedAdminSurfaceApi(pathname: string): boolean {
  return pathname === '/api/auth'
    || pathname.startsWith('/api/auth/')
    || pathname === '/api/admin'
    || pathname.startsWith('/api/admin/')
}

export function isRoleAllowedOnSurface(role: string, surface: AppSurface): boolean {
  if (surface === 'admin') return role === 'super_admin'
  if (surface === 'workspace') return role !== 'super_admin'
  return true
}

export function surfaceLoginError(role: string): SurfaceLoginError {
  return role === 'super_admin'
    ? SURFACE_LOGIN_ERRORS.adminRequired
    : SURFACE_LOGIN_ERRORS.workspaceRequired
}

export function authCookieNamespace(surface: AppSurface): string {
  if (surface === 'admin') return 'nori-admin'
  if (surface === 'workspace') return 'nori-workspace'
  return 'nori'
}
