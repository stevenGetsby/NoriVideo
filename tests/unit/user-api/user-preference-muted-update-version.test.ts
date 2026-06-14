import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const prismaMock = vi.hoisted(() => ({
  userPreference: {
    upsert: vi.fn(async (input: { create?: Record<string, unknown>; update?: Record<string, unknown> }) => ({
      id: 'pref-1',
      userId: input.create?.userId ?? 'user-1',
      ...input.create,
      ...input.update,
    })),
  },
}))

const authMock = vi.hoisted(() => ({
  requireUserAuth: vi.fn(async () => ({
    session: { user: { id: 'user-1' } },
  })),
  isErrorResponse: (value: unknown) => value instanceof NextResponse,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}))

vi.mock('@/lib/api-auth', () => authMock)

describe('/api/user-preference muted update version', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('persists dismissed update version as normalized user preference', async () => {
    const { PATCH } = await import('@/app/api/user-preference/route')

    const response = await PATCH(new NextRequest('http://localhost/api/user-preference', {
      method: 'PATCH',
      body: JSON.stringify({ mutedUpdateVersion: 'v0.3.0-rc.1' }),
    }) as never, { params: Promise.resolve({}) })
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.preference).toMatchObject({ mutedUpdateVersion: '0.3.0' })
    expect(prismaMock.userPreference.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 'user-1' },
      update: { mutedUpdateVersion: '0.3.0' },
      create: { userId: 'user-1', mutedUpdateVersion: '0.3.0' },
    }))
  })

  it('allows clearing dismissed update version', async () => {
    const { PATCH } = await import('@/app/api/user-preference/route')

    const response = await PATCH(new NextRequest('http://localhost/api/user-preference', {
      method: 'PATCH',
      body: JSON.stringify({ mutedUpdateVersion: null }),
    }) as never, { params: Promise.resolve({}) })
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.preference).toMatchObject({ mutedUpdateVersion: null })
    expect(prismaMock.userPreference.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: { mutedUpdateVersion: null },
      create: { userId: 'user-1', mutedUpdateVersion: null },
    }))
  })

  it('rejects malformed dismissed update version', async () => {
    const { PATCH } = await import('@/app/api/user-preference/route')

    const response = await PATCH(new NextRequest('http://localhost/api/user-preference', {
      method: 'PATCH',
      body: JSON.stringify({ mutedUpdateVersion: 'release-2026-06-13' }),
    }) as never, { params: Promise.resolve({}) })
    const payload = await response.json()

    expect(response.status).toBe(400)
    expect(payload.error?.details).toMatchObject({
      code: 'INVALID_MUTED_UPDATE_VERSION',
      field: 'mutedUpdateVersion',
    })
    expect(prismaMock.userPreference.upsert).not.toHaveBeenCalled()
  })
})
