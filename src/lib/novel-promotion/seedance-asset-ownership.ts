import { prisma } from '@/lib/prisma'
import { getSeedanceAssetsProvider } from '@/lib/volcengine/seedance-assets-provider'
import { readSeedanceAssetUri } from '@/lib/media/seedance-reference'

/** Never reuse an Ark ID on Kuaizi, another account, or another Nori project. */
export async function assertSeedanceAssetOwnership(input: {
  userId: string
  projectId: string
  modelKey: string
  references: string[]
}): Promise<void> {
  const uris = Array.from(new Set(input.references
    .map((value) => readSeedanceAssetUri(value, input.modelKey)).filter((value): value is string => Boolean(value))))
  if (!uris.length) return
  const { scope } = await getSeedanceAssetsProvider(input)
  const [appearances, materials] = await Promise.all([
    prisma.characterAppearance.findMany({
      where: {
        seedanceAssetUri: { in: uris },
        seedanceAssetScope: scope,
        seedanceAssetStatus: 'Active',
        character: { novelPromotionProject: { projectId: input.projectId } },
      },
      select: { seedanceAssetUri: true },
    }),
    prisma.frameosMaterial.findMany({
      where: {
        userId: input.userId, projectId: input.projectId, deletedAt: null,
        OR: uris.map((uri) => ({ metadata: { path: '$.seedancePrivateAsset.assetUri', equals: uri } })),
      },
      select: { metadata: true },
    }),
  ])
  const owned = new Set(appearances.map((item) => item.seedanceAssetUri))
  for (const material of materials) {
    const metadata = material.metadata as { seedancePrivateAsset?: { projectName?: string; status?: string; assetUri?: string } } | null
    const asset = metadata?.seedancePrivateAsset
    if (asset?.projectName === scope && asset.status === 'Active' && asset.assetUri) owned.add(asset.assetUri)
  }
  if (uris.some((uri) => !owned.has(uri))) {
    throw new Error('SEEDANCE_ASSET_PROVIDER_CHANGED: 素材未就绪或不属于当前项目的视频服务账号，请重新注册素材')
  }
}
