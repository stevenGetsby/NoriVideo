import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockRequest } from '../../../helpers/request'

const authMock = vi.hoisted(() => ({
  requireProjectAuthLight: vi.fn(),
  isErrorResponse: (value: unknown) => value instanceof Response,
}))

const prismaMock = vi.hoisted(() => ({
  frameosMaterial: { findFirst: vi.fn() },
  characterAppearance: { findFirst: vi.fn(), update: vi.fn() },
  novelPromotionLocation: { findFirst: vi.fn(), update: vi.fn() },
  locationImage: { update: vi.fn(), create: vi.fn() },
}))

const resolveMediaMock = vi.hoisted(() => vi.fn())
const refreshReferencesMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api-auth', () => authMock)
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/media/service', () => ({
  resolveMediaRefFromLegacyValue: resolveMediaMock,
}))
vi.mock('@/lib/novel-promotion/refresh-panel-reference-assets', () => ({
  refreshProjectPanelReferenceAssets: refreshReferencesMock,
}))

describe('POST /api/novel-promotion/[projectId]/import-asset-image', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMock.requireProjectAuthLight.mockResolvedValue({
      session: { user: { id: 'workspace-1', actorId: 'asset-editor-1' } },
      project: { id: 'project-1' },
    })
    prismaMock.frameosMaterial.findFirst.mockResolvedValue({
      id: 'material-1',
      title: '雨夜角色参考',
      storageKey: 'materials/reference-1.png',
      resultUrl: null,
    })
    resolveMediaMock.mockResolvedValue({
      id: 'media-1',
      storageKey: 'materials/reference-1.png',
      url: 'https://media.example/reference-1.png',
    })
    refreshReferencesMock.mockResolvedValue(undefined)
  })

  it('imports a material into the requested character variant without replacing a different selected render', async () => {
    prismaMock.characterAppearance.findFirst.mockResolvedValue({
      id: 'appearance-1',
      imageUrl: 'characters/selected.png',
      imageUrls: JSON.stringify(['characters/selected.png', 'characters/old-variant.png']),
      imageMediaId: 'media-old',
      selectedIndex: 0,
    })
    prismaMock.characterAppearance.update.mockResolvedValue({ id: 'appearance-1' })

    const { POST } = await import('@/app/api/novel-promotion/[projectId]/import-asset-image/route')
    const response = await POST(buildMockRequest({
      path: '/api/novel-promotion/project-1/import-asset-image',
      method: 'POST',
      body: {
        kind: 'character',
        assetId: 'character-1',
        appearanceId: 'appearance-1',
        imageIndex: 1,
        materialId: 'material-1',
      },
    }), { params: Promise.resolve({ projectId: 'project-1' }) })

    expect(response.status).toBe(200)
    expect(authMock.requireProjectAuthLight).toHaveBeenCalledWith('project-1', ['assetWrite'])
    expect(prismaMock.frameosMaterial.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: 'material-1',
        userId: 'workspace-1',
        type: 'image',
        status: 'ready',
        deletedAt: null,
      }),
    }))
    expect(prismaMock.characterAppearance.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: 'appearance-1',
        characterId: 'character-1',
        character: { novelPromotionProject: { projectId: 'project-1' } },
      },
    }))
    const update = prismaMock.characterAppearance.update.mock.calls[0]?.[0]
    expect(JSON.parse(update.data.imageUrls)).toEqual([
      'characters/selected.png',
      'materials/reference-1.png',
    ])
    expect(update.data).toMatchObject({
      previousImageUrl: 'characters/selected.png',
      previousImageUrls: JSON.stringify(['characters/selected.png', 'characters/old-variant.png']),
    })
    expect(update.data).not.toHaveProperty('imageUrl')
    expect(refreshReferencesMock).toHaveBeenCalledWith({ projectId: 'project-1' })
  })

  it('creates and selects the first imported prop image when the asset has no render yet', async () => {
    prismaMock.novelPromotionLocation.findFirst.mockResolvedValue({
      id: 'prop-1',
      selectedImageId: null,
      images: [],
    })
    prismaMock.locationImage.create.mockResolvedValue({ id: 'prop-image-1' })
    prismaMock.novelPromotionLocation.update.mockResolvedValue({ id: 'prop-1' })

    const { POST } = await import('@/app/api/novel-promotion/[projectId]/import-asset-image/route')
    const response = await POST(buildMockRequest({
      path: '/api/novel-promotion/project-1/import-asset-image',
      method: 'POST',
      body: {
        kind: 'prop',
        assetId: 'prop-1',
        imageIndex: 0,
        materialId: 'material-1',
      },
    }), { params: Promise.resolve({ projectId: 'project-1' }) })

    expect(response.status).toBe(200)
    expect(prismaMock.novelPromotionLocation.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: 'prop-1',
        assetKind: 'prop',
        novelPromotionProject: { projectId: 'project-1' },
      },
    }))
    expect(prismaMock.locationImage.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        locationId: 'prop-1',
        imageIndex: 0,
        imageUrl: 'materials/reference-1.png',
        imageMediaId: 'media-1',
        isSelected: true,
      }),
      select: { id: true },
    })
    expect(prismaMock.novelPromotionLocation.update).toHaveBeenCalledWith({
      where: { id: 'prop-1' },
      data: { selectedImageId: 'prop-image-1' },
    })
    expect(refreshReferencesMock).toHaveBeenCalledWith({ projectId: 'project-1' })
  })

  it('does not mutate an asset when the chosen material is outside the workspace scope', async () => {
    prismaMock.frameosMaterial.findFirst.mockResolvedValue(null)

    const { POST } = await import('@/app/api/novel-promotion/[projectId]/import-asset-image/route')
    const response = await POST(buildMockRequest({
      path: '/api/novel-promotion/project-1/import-asset-image',
      method: 'POST',
      body: {
        kind: 'location',
        assetId: 'location-1',
        imageIndex: 0,
        materialId: 'foreign-material',
      },
    }), { params: Promise.resolve({ projectId: 'project-1' }) })

    expect(response.status).toBe(404)
    expect(prismaMock.characterAppearance.update).not.toHaveBeenCalled()
    expect(prismaMock.locationImage.update).not.toHaveBeenCalled()
    expect(prismaMock.locationImage.create).not.toHaveBeenCalled()
    expect(refreshReferencesMock).not.toHaveBeenCalled()
  })
})
