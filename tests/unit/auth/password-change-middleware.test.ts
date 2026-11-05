import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const getTokenMock = vi.hoisted(() => vi.fn())
vi.mock('next-auth/jwt', () => ({ getToken: getTokenMock }))
vi.mock('next-intl/middleware', async () => {
  const { NextResponse } = await import('next/server')
  return { default: () => () => NextResponse.next() }
})

import workspaceMiddleware from '@/middleware'
import combinedMiddleware from '../../../middleware'

describe.each([
  ['workspace entry', workspaceMiddleware],
  ['combined entry', combinedMiddleware],
])('initial password change middleware: %s', (_name, middleware) => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('NORI_APP_SURFACE', 'workspace')
    vi.stubEnv('NEXTAUTH_URL', 'http://localhost:3000')
    vi.stubEnv('ADMIN_PUBLIC_PORT', '8080')
  })

  it('redirects an account requiring a password change away from workspace pages', async () => {
    getTokenMock.mockResolvedValue({ id: 'member-1', passwordChangeRequired: true })
    const response = await middleware(new NextRequest('http://localhost:3000/zh/works'))
    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('http://localhost:3000/zh/auth/change-password')
    expect(getTokenMock).toHaveBeenCalledWith(expect.objectContaining({ cookieName: 'nori-workspace.session-token' }))
  })

  it('does not redirect the change-password page back to itself', async () => {
    getTokenMock.mockResolvedValue({ id: 'member-1', passwordChangeRequired: true })
    const response = await middleware(new NextRequest('http://localhost:3000/zh/auth/change-password'))
    expect(response.headers.get('location')).toBeNull()
    expect(response.status).not.toBe(307)
  })

  it('lets the page component send an account back after the flag is cleared', async () => {
    getTokenMock.mockResolvedValue({ id: 'member-1', passwordChangeRequired: false })
    const response = await middleware(new NextRequest('http://localhost:3000/zh/auth/change-password'))
    expect(response.status).not.toBe(307)
  })

  it('does not block ordinary APIs, whose handlers enforce the database policy', async () => {
    getTokenMock.mockResolvedValue({ id: 'member-1', passwordChangeRequired: true })
    const response = await middleware(new NextRequest('http://localhost:3000/api/user/projects'))
    expect(response.status).toBe(200)
    expect(response.headers.get('location')).toBeNull()
  })
})

describe('platform Admin initial password change', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('NORI_APP_SURFACE', 'admin')
    vi.stubEnv('NEXTAUTH_URL', 'http://localhost:8080')
    vi.stubEnv('ADMIN_PUBLIC_PORT', '8080')
  })

  it('allows a required password change on the Admin surface', async () => {
    getTokenMock.mockResolvedValue({ id: 'admin-1', passwordChangeRequired: true })
    const response = await workspaceMiddleware(new NextRequest('http://localhost:8080/zh/auth/change-password'))
    expect(response.status).not.toBe(307)
    expect(getTokenMock).toHaveBeenCalledWith(expect.objectContaining({ cookieName: 'nori-admin.session-token' }))
  })

  it('returns a completed Admin account to account management rather than looping', async () => {
    getTokenMock.mockResolvedValue({ id: 'admin-1', passwordChangeRequired: false })
    const response = await workspaceMiddleware(new NextRequest('http://localhost:8080/zh/auth/change-password'))
    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('http://localhost:8080/zh/admin/accounts')
  })

  it('returns unauthenticated Admin visitors to the Admin sign-in page', async () => {
    getTokenMock.mockResolvedValue(null)
    const response = await workspaceMiddleware(new NextRequest('http://localhost:8080/zh/auth/change-password'))
    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('http://localhost:8080/zh/admin/signin')
  })
})
