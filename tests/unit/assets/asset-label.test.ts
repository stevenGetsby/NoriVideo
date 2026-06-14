import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  novelPromotionCharacter: {
    findFirst: vi.fn(),
  },
  novelPromotionLocation: {
    findFirst: vi.fn(),
  },
  characterAppearance: {
    update: vi.fn(),
  },
  locationImage: {
    update: vi.fn(),
  },
}))

const updateImageLabelMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}))
vi.mock('@/lib/image-label', () => ({
  updateImageLabel: updateImageLabelMock,
}))

describe('project asset label updates', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    updateImageLabelMock.mockResolvedValue('renamed.png')
  })

  it('scopes project character lookup by projectId', async () => {
    prismaMock.novelPromotionCharacter.findFirst.mockResolvedValue({
      id: 'character-1',
      appearances: [],
    })
    const { updateAssetRenderLabel } = await import('@/lib/assets/services/asset-label')

    await updateAssetRenderLabel({
      scope: 'project',
      kind: 'character',
      assetId: 'character-1',
      projectId: 'project-1',
      newName: 'Alice',
    })

    expect(prismaMock.novelPromotionCharacter.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'character-1',
        novelPromotionProject: {
          projectId: 'project-1',
        },
      },
      include: { appearances: true },
    })
  })

  it('scopes project location lookup by projectId', async () => {
    prismaMock.novelPromotionLocation.findFirst.mockResolvedValue({
      id: 'location-1',
      images: [],
    })
    const { updateAssetRenderLabel } = await import('@/lib/assets/services/asset-label')

    await updateAssetRenderLabel({
      scope: 'project',
      kind: 'location',
      assetId: 'location-1',
      projectId: 'project-1',
      newName: 'Market',
    })

    expect(prismaMock.novelPromotionLocation.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'location-1',
        novelPromotionProject: {
          projectId: 'project-1',
        },
      },
      include: { images: true },
    })
  })
})
