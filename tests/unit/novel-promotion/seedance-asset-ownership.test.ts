import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ appearances: vi.fn(), materials: vi.fn(), provider: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: {
  characterAppearance: { findMany: mocks.appearances }, frameosMaterial: { findMany: mocks.materials },
} }))
vi.mock('@/lib/volcengine/seedance-assets-provider', () => ({ getSeedanceAssetsProvider: mocks.provider }))
import { assertSeedanceAssetOwnership } from '@/lib/novel-promotion/seedance-asset-ownership'

describe('Seedance private-asset ownership', () => {
  const input = { userId: 'u1', projectId: 'p1', modelKey: 'kuaizi::doubao-seedance-2-5-260628', references: ['asset://1800657071180349888'] }
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.provider.mockResolvedValue({ scope: 'kuaizi:account-a' })
    mocks.appearances.mockResolvedValue([])
    mocks.materials.mockResolvedValue([])
  })
  it('skips asset queries for public media references', async () => {
    await assertSeedanceAssetOwnership({ ...input, references: ['https://test/image.png'] })
    expect(mocks.provider).not.toHaveBeenCalled()
  })
  it('only accepts Active character assets within the current project and account scope', async () => {
    mocks.appearances.mockResolvedValue([{ seedanceAssetUri: input.references[0] }])
    await assertSeedanceAssetOwnership(input)
    expect(mocks.appearances).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      seedanceAssetScope: 'kuaizi:account-a', seedanceAssetStatus: 'Active',
      character: { novelPromotionProject: { projectId: 'p1' } },
    }) }))
  })
  it('rejects another provider/account, Processing assets and unregistered references', async () => {
    mocks.materials.mockResolvedValue([{ metadata: { seedancePrivateAsset: {
      projectName: 'ark:old-account', status: 'Active', assetUri: input.references[0],
    } } }])
    await expect(assertSeedanceAssetOwnership(input)).rejects.toThrow('SEEDANCE_ASSET_PROVIDER_CHANGED')
    mocks.materials.mockResolvedValue([{ metadata: { seedancePrivateAsset: {
      projectName: 'kuaizi:account-a', status: 'Processing', assetUri: input.references[0],
    } } }])
    await expect(assertSeedanceAssetOwnership(input)).rejects.toThrow('SEEDANCE_ASSET_PROVIDER_CHANGED')
  })
})
