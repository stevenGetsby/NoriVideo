import { describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/api-auth', () => ({
  requireUserAuth: vi.fn(async () => ({ session: { user: { id: 'user-1' } } })),
  isErrorResponse: (value: unknown) => value instanceof NextResponse,
}))

vi.mock('@/lib/prisma', () => {
  throw new Error('retired Seedance asset routes must not access stored credentials')
})

vi.mock('@/lib/volcengine/seedance-assets-config', () => {
  throw new Error('retired Seedance asset routes must not read provider config')
})

vi.mock('@/lib/volcengine/seedance-assets-client', () => {
  throw new Error('retired Seedance asset routes must not contact the provider')
})

const context = { params: Promise.resolve({}) }

describe('/api/user/seedance-assets-config retirement', () => {
  it.each(['GET', 'PUT'] as const)('%s returns 410 without reading or writing credentials', async (method) => {
    const route = await import('@/app/api/user/seedance-assets-config/route')
    const request = new NextRequest('http://localhost/api/user/seedance-assets-config', {
      method,
      ...(method === 'PUT' ? { body: JSON.stringify({ accessKeyId: 'must-not-be-saved' }) } : {}),
    })
    const response = await route[method](request as never, context)
    expect(response.status).toBe(410)
    expect(await response.json()).toMatchObject({
      success: false,
      configured: false,
      error: { code: 'SEEDANCE_ASSETS_RETIRED' },
    })
  })

  it('POST test returns 410 without contacting the provider', async () => {
    const { POST } = await import('@/app/api/user/seedance-assets-config/test/route')
    const response = await POST(
      new NextRequest('http://localhost/api/user/seedance-assets-config/test', { method: 'POST' }) as never,
      context,
    )
    expect(response.status).toBe(410)
    expect(await response.json()).toMatchObject({
      success: false,
      configured: false,
      error: { code: 'SEEDANCE_ASSETS_RETIRED' },
    })
  })
})
