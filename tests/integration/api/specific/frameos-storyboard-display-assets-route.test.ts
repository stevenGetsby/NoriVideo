import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockRequest } from '../../../helpers/request'

const authMock = vi.hoisted(() => ({
  requireProjectAuthLight: vi.fn(async (projectId: string) => ({
    session: { user: { id: 'user-1' } },
    project: { id: projectId, userId: 'user-1' },
  })),
  isErrorResponse: vi.fn((value: unknown) => value instanceof Response),
}))

const prismaMock = vi.hoisted(() => ({
  novelPromotionEpisode: { findFirst: vi.fn() },
  novelPromotionStoryboard: { findMany: vi.fn() },
  characterAppearance: { findMany: vi.fn() },
}))

vi.mock('@/lib/api-auth', () => authMock)
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/media/attach', () => ({
  attachMediaFieldsToProject: vi.fn(async (value: unknown) => value),
}))

describe('FrameOS storyboard display assets route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValue({
      id: 'episode-1',
      episodeNumber: 1,
      novelPromotionProject: {
        characters: [],
        locations: [],
      },
    })
    prismaMock.novelPromotionStoryboard.findMany.mockResolvedValue([{
      id: 'storyboard-1',
      clip: { id: 'clip-1' },
      panels: [{
        id: 'panel-1',
        panelIndex: 0,
        actingNotes: JSON.stringify({
          _seedanceReferenceAssets: [{
            kind: 'character',
            name: '苏晚卿',
            imageUrl: 'asset://character-private-1',
            role: 'reference_image',
          }],
        }),
      }],
    }])
    prismaMock.characterAppearance.findMany.mockResolvedValue([{
      seedanceAssetUri: 'asset://character-private-1',
      imageUrl: 'images/su-wanqing.png',
      imageUrls: JSON.stringify(['images/su-wanqing-alt.png']),
      selectedIndex: 0,
    }])
  })

  it('keeps the private asset reference in storage while returning a browser-displayable image', async () => {
    const { GET } = await import('@/app/api/novel-promotion/[projectId]/storyboards/route')
    const response = await GET(
      buildMockRequest({
        path: '/api/novel-promotion/project-1/storyboards',
        method: 'GET',
        query: { episodeId: 'episode-1' },
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )
    const payload = await response.json() as {
      storyboards: Array<{
        panels: Array<{
          actingNotes: string
          assetBindings: Array<{ name: string; imageUrl: string | null }>
        }>
      }>
    }

    expect(response.status).toBe(200)
    expect(payload.storyboards[0].panels[0].assetBindings).toEqual([{
      materialId: null,
      kind: '角色',
      name: '苏晚卿',
      imageUrl: 'images/su-wanqing.png',
      appearanceId: null,
      appearance: null,
    }])
    expect(payload.storyboards[0].panels[0].actingNotes).toContain('asset://character-private-1')
    expect(prismaMock.characterAppearance.findMany).toHaveBeenCalledWith({
      where: {
        seedanceAssetUri: { in: ['asset://character-private-1'] },
        character: {
          novelPromotionProject: { projectId: 'project-1' },
        },
      },
      select: {
        seedanceAssetUri: true,
        imageUrl: true,
        imageUrls: true,
        selectedIndex: true,
      },
    })
  })
})
