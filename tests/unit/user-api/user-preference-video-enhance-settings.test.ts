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

describe('/api/user-preference video enhance settings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('persists a bounded video url draft without local-only request fields', async () => {
    const { PATCH } = await import('@/app/api/user-preference/route')

    const response = await PATCH(new NextRequest('http://localhost/api/user-preference', {
      method: 'PATCH',
      body: JSON.stringify({
        videoEnhanceSettings: {
          sourceMode: 'url',
          videoUrlsDraft: ' https://example.com/a.mp4 \nhttps://example.com/b.mp4 ',
          clientToken: 'token-should-not-persist',
          callbackArgs: '{"secret":true}',
          downloadDirectoryPath: '/Users/me/Downloads',
        },
      }),
    }) as never, { params: Promise.resolve({}) })
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.preference.videoEnhanceSettings).toMatchObject({
      sourceMode: 'url',
      videoUrlsDraft: 'https://example.com/a.mp4\nhttps://example.com/b.mp4',
    })
    expect(JSON.stringify(payload.preference.videoEnhanceSettings)).not.toContain('token-should-not-persist')
    expect(JSON.stringify(payload.preference.videoEnhanceSettings)).not.toContain('downloadDirectoryPath')
    expect(prismaMock.userPreference.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 'user-1' },
      update: {
        videoEnhanceSettings: expect.objectContaining({
          sourceMode: 'url',
          videoUrlsDraft: 'https://example.com/a.mp4\nhttps://example.com/b.mp4',
        }),
      },
    }))
  })
})
