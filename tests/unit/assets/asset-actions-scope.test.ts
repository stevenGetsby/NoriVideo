import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const prismaMock = vi.hoisted(() => ({
  novelPromotionLocation: {
    findFirst: vi.fn(),
    update: vi.fn(),
  },
  novelPromotionCharacter: {
    findFirst: vi.fn(),
    update: vi.fn(),
  },
  characterAppearance: {
    findFirst: vi.fn(),
    update: vi.fn(),
    deleteMany: vi.fn(),
    create: vi.fn(),
  },
  locationImage: {
    findFirst: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    deleteMany: vi.fn(),
    create: vi.fn(),
  },
  globalCharacter: {
    findFirst: vi.fn(),
  },
  globalLocation: {
    findFirst: vi.fn(),
  },
  globalVoice: {
    findFirst: vi.fn(),
  },
}))

const submitTaskMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}))
vi.mock('@/lib/task/submitter', () => ({
  submitTask: submitTaskMock,
}))
vi.mock('@/lib/config-service', () => ({
  getProjectModelConfig: vi.fn(async () => ({
    characterModel: 'fal::character',
    locationModel: 'fal::location',
  })),
  getUserModelConfig: vi.fn(async () => ({
    characterModel: 'fal::character',
    locationModel: 'fal::location',
  })),
  buildImageBillingPayload: vi.fn(async ({ basePayload }) => basePayload),
  buildImageBillingPayloadFromUserConfig: vi.fn(({ basePayload }) => basePayload),
}))
vi.mock('@/lib/billing', () => ({
  buildDefaultTaskBillingInfo: vi.fn(() => ({ unit: 'test' })),
}))
vi.mock('@/lib/task/resolve-locale', () => ({
  resolveRequiredTaskLocale: vi.fn(() => 'zh'),
}))
vi.mock('@/lib/task/ui-payload', () => ({
  withTaskUiPayload: vi.fn((payload, ui) => ({ ...payload, ui })),
}))
vi.mock('@/lib/image-generation/location-slots', () => ({
  ensureGlobalLocationImageSlots: vi.fn(),
  ensureProjectLocationImageSlots: vi.fn(),
}))
vi.mock('@/lib/task/has-output', () => ({
  hasCharacterAppearanceOutput: vi.fn(async () => false),
  hasGlobalCharacterAppearanceOutput: vi.fn(async () => false),
  hasGlobalCharacterOutput: vi.fn(async () => false),
  hasGlobalLocationImageOutput: vi.fn(async () => false),
  hasGlobalLocationOutput: vi.fn(async () => false),
  hasLocationImageOutput: vi.fn(async () => false),
}))
vi.mock('@/lib/image-label', () => ({
  createProjectCharacterLabeledCopies: vi.fn(async () => []),
  createProjectLocationLabeledCopies: vi.fn(async () => []),
}))
vi.mock('@/lib/storage', () => ({
  deleteObject: vi.fn(),
}))
vi.mock('@/lib/media/service', () => ({
  resolveMediaRefFromLegacyValue: vi.fn(async () => null),
  resolveStorageKeyFromMediaValue: vi.fn(async () => null),
}))

describe('project asset action scoping', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    submitTaskMock.mockResolvedValue({ success: true, taskId: 'task-1' })
  })

  it('submitAssetGenerateTask rejects project character appearance outside project before queue submit', async () => {
    prismaMock.characterAppearance.findFirst.mockResolvedValueOnce(null)
    const { submitAssetGenerateTask } = await import('@/lib/assets/services/asset-actions')

    await expect(submitAssetGenerateTask({
      request: new NextRequest('http://localhost/api/test', { method: 'POST' }),
      kind: 'character',
      assetId: 'character-other',
      body: { appearanceId: 'appearance-other', count: 1 },
      access: {
        scope: 'project',
        userId: 'user-1',
        projectId: 'project-1',
      },
    })).rejects.toMatchObject({ status: 404 })

    expect(prismaMock.characterAppearance.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: 'appearance-other',
        characterId: 'character-other',
        character: {
          novelPromotionProject: {
            projectId: 'project-1',
          },
        },
      },
    }))
    expect(submitTaskMock).not.toHaveBeenCalled()
  })

  it('updateAsset scopes project character update by projectId', async () => {
    prismaMock.novelPromotionCharacter.findFirst.mockResolvedValueOnce(null)
    const { updateAsset } = await import('@/lib/assets/services/asset-actions')

    await expect(updateAsset({
      kind: 'character',
      assetId: 'character-other',
      body: { name: 'Alice' },
      access: {
        scope: 'project',
        userId: 'user-1',
        projectId: 'project-1',
      },
    })).rejects.toMatchObject({ status: 404 })

    expect(prismaMock.novelPromotionCharacter.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: 'character-other',
        novelPromotionProject: {
          projectId: 'project-1',
        },
      },
    }))
    expect(prismaMock.novelPromotionCharacter.update).not.toHaveBeenCalled()
  })

  it('updateAssetVariant scopes project location image by projectId', async () => {
    prismaMock.locationImage.findFirst.mockResolvedValueOnce(null)
    const { updateAssetVariant } = await import('@/lib/assets/services/asset-actions')

    await expect(updateAssetVariant({
      kind: 'location',
      assetId: 'location-other',
      variantId: 'image-other',
      body: { description: 'new description' },
      access: {
        scope: 'project',
        userId: 'user-1',
        projectId: 'project-1',
      },
    })).rejects.toMatchObject({ status: 404 })

    expect(prismaMock.locationImage.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: 'image-other',
        locationId: 'location-other',
        location: {
          novelPromotionProject: {
            projectId: 'project-1',
          },
        },
      },
    }))
    expect(prismaMock.locationImage.update).not.toHaveBeenCalled()
  })
})
