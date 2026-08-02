import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'
import { extractStorageKey, getSignedObjectUrl, getStorageType } from '@/lib/storage'
import { getSeedanceAssetsConfig } from '@/lib/volcengine/seedance-assets-config'
import { SeedanceAssetsClient, type SeedanceAssetResult } from '@/lib/volcengine/seedance-assets-client'
import { ensureSeedanceProjectAssetGroup } from './seedance-project-asset-group'

const ASSET_READY_TIMEOUT_MS = 3 * 60 * 1_000
const ASSET_POLL_INTERVAL_MS = 2_000

type AssetStatusCallback = (status: string, attempt: number) => Promise<void> | void

type ToolboxPrivateAssetMetadata = {
  groupId?: string
  assetId?: string
  assetUri?: string
  status?: string
  sourceImage?: string
  projectName?: string
  syncedAt?: string
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function readToolboxPrivateAssetMetadata(value: unknown): ToolboxPrivateAssetMetadata {
  const metadata = readRecord(value)
  return readRecord(metadata.seedancePrivateAsset) as ToolboxPrivateAssetMetadata
}

function mergeToolboxPrivateAssetMetadata(
  value: unknown,
  privateAsset: ToolboxPrivateAssetMetadata,
): Prisma.InputJsonValue {
  return {
    ...readRecord(value),
    seedancePrivateAsset: privateAsset,
  } as Prisma.InputJsonValue
}

function isPublicHttpUrl(value: string): boolean {
  if (!value.startsWith('http://') && !value.startsWith('https://')) return false
  try {
    const host = new URL(value).hostname.toLowerCase()
    return host !== 'localhost' && host !== '127.0.0.1' && host !== '::1'
  } catch {
    return false
  }
}

async function resolvePublicImageUrl(imageValue: string): Promise<string> {
  if (isPublicHttpUrl(imageValue)) return imageValue
  const storageKey = extractStorageKey(imageValue)
  if (!storageKey) throw new Error('SEEDANCE_ASSET_IMAGE_URL_INVALID: 角色图片没有可上传的存储地址')
  if (getStorageType() === 'local') {
    throw new Error('SEEDANCE_ASSET_PUBLIC_URL_REQUIRED: 真人素材注册需要公网 TOS 图片地址')
  }
  const signedUrl = await getSignedObjectUrl(storageKey, 12 * 60 * 60)
  if (!isPublicHttpUrl(signedUrl)) {
    throw new Error('SEEDANCE_ASSET_PUBLIC_URL_REQUIRED: 火山素材库无法访问角色图片签名地址')
  }
  return signedUrl
}

function assetError(asset: SeedanceAssetResult): string {
  return [asset.Error?.Code, asset.Error?.Message].filter(Boolean).join(': ')
}

async function waitForActiveAsset(input: {
  client: SeedanceAssetsClient
  assetId: string
  projectName: string
  onStatus?: AssetStatusCallback
}): Promise<SeedanceAssetResult> {
  const startedAt = Date.now()
  let attempt = 0
  while (Date.now() - startedAt <= ASSET_READY_TIMEOUT_MS) {
    attempt += 1
    const asset = await input.client.getAsset({
      assetId: input.assetId,
      projectName: input.projectName,
    })
    const status = asset.Status || 'Processing'
    await input.onStatus?.(status, attempt)
    if (status === 'Active') return asset
    if (status === 'Failed') {
      throw new Error(`SEEDANCE_ASSET_CREATE_FAILED: ${assetError(asset) || '真人素材审核失败'}`)
    }
    await new Promise((resolve) => setTimeout(resolve, ASSET_POLL_INTERVAL_MS))
  }
  throw new Error('SEEDANCE_ASSET_CREATE_TIMEOUT: 真人素材注册超时，请稍后重试')
}

export async function ensureSeedanceCharacterAsset(input: {
  userId: string
  projectId: string
  characterId: string
  onStatus?: AssetStatusCallback
}): Promise<{ assetId: string; assetUri: string; appearanceId: string }> {
  const character = await prisma.novelPromotionCharacter.findFirst({
    where: {
      id: input.characterId,
      novelPromotionProject: { projectId: input.projectId },
    },
    include: {
      appearances: { orderBy: { appearanceIndex: 'asc' }, take: 1 },
    },
  })
  const appearance = character?.appearances[0]
  const imageUrl = appearance?.imageUrl?.trim() || ''
  if (!character || !appearance || !imageUrl) {
    throw new Error('SEEDANCE_ASSET_IMAGE_REQUIRED: 角色缺少已选定的设定图')
  }

  const config = await getSeedanceAssetsConfig(input.userId)
  const client = new SeedanceAssetsClient(config)
  const groupId = await ensureSeedanceProjectAssetGroup({
    projectId: input.projectId,
    volcengineProjectName: config.projectName,
    client,
  })
  const existingMatchesImage = appearance.seedanceAssetImageUrl === imageUrl
  const existingBelongsToProjectGroup = character.seedanceAssetGroupId === groupId
    && character.seedanceAssetsProjectName === config.projectName
  if (
    existingBelongsToProjectGroup
    && existingMatchesImage
    && appearance.seedanceAssetStatus === 'Active'
    && appearance.seedanceAssetId
    && appearance.seedanceAssetUri?.startsWith('asset://')
  ) {
    return {
      assetId: appearance.seedanceAssetId,
      assetUri: appearance.seedanceAssetUri,
      appearanceId: appearance.id,
    }
  }

  let assetId = existingBelongsToProjectGroup && existingMatchesImage && appearance.seedanceAssetId
    && appearance.seedanceAssetStatus !== 'Failed'
    ? appearance.seedanceAssetId
    : ''
  if (!assetId) {
    const created = await client.createImageAsset({
      groupId,
      url: await resolvePublicImageUrl(imageUrl),
      name: `${character.name}-${appearance.changeReason || 'appearance'}`,
      projectName: config.projectName,
    })
    if (!created.Id) throw new Error('CreateAsset did not return asset id')
    assetId = created.Id
    await prisma.$transaction([
      prisma.novelPromotionCharacter.update({
        where: { id: character.id },
        data: {
          seedanceAssetGroupId: groupId,
          seedanceAssetsProjectName: config.projectName,
        },
      }),
      prisma.characterAppearance.update({
        where: { id: appearance.id },
        data: {
          seedanceAssetId: assetId,
          seedanceAssetUri: `asset://${assetId}`,
          seedanceAssetStatus: created.Status || 'Processing',
          seedanceAssetError: assetError(created) || null,
          seedanceAssetImageUrl: imageUrl,
          seedanceAssetSyncedAt: new Date(),
        },
      }),
    ])
    if (created.Status === 'Failed') {
      throw new Error(`SEEDANCE_ASSET_CREATE_FAILED: ${assetError(created) || '真人素材审核失败'}`)
    }
  }

  const active = await waitForActiveAsset({
    client,
    assetId,
    projectName: config.projectName,
    onStatus: input.onStatus,
  })
  const activeId = active.Id || assetId
  const assetUri = `asset://${activeId}`
  await prisma.characterAppearance.update({
    where: { id: appearance.id },
    data: {
      seedanceAssetId: activeId,
      seedanceAssetUri: assetUri,
      seedanceAssetStatus: 'Active',
      seedanceAssetError: null,
      seedanceAssetImageUrl: imageUrl,
      seedanceAssetSyncedAt: new Date(),
    },
  })
  return { assetId: activeId, assetUri, appearanceId: appearance.id }
}

/**
 * Registers toolbox image references only after Ark identifies the request as
 * containing a real person. The resulting asset:// references are persisted in
 * material metadata so subsequent video generations skip the rejected public URL.
 */
export async function ensureSeedanceToolboxReferenceAssets(input: {
  userId: string
  projectId: string
  materialIds: string[]
  onStatus?: (input: { materialId: string; status: string; attempt: number }) => Promise<void> | void
}): Promise<string[]> {
  const uniqueIds = Array.from(new Set(input.materialIds.map((value) => value.trim()).filter(Boolean)))
  if (uniqueIds.length === 0) {
    throw new Error('SEEDANCE_ASSET_MATERIAL_REQUIRED: 真人参考图缺少素材记录')
  }
  const materials = await prisma.frameosMaterial.findMany({
    where: {
      id: { in: uniqueIds },
      userId: input.userId,
      projectId: input.projectId,
      type: 'image',
      deletedAt: null,
    },
    select: {
      id: true,
      title: true,
      storageKey: true,
      resultUrl: true,
      metadata: true,
    },
  })
  const byId = new Map(materials.map((material) => [material.id, material]))
  const ordered = uniqueIds.map((id) => byId.get(id)).filter((value): value is NonNullable<typeof value> => Boolean(value))
  if (ordered.length === 0) {
    throw new Error('SEEDANCE_ASSET_MATERIAL_REQUIRED: 没有可注册的真人图片素材')
  }

  const config = await getSeedanceAssetsConfig(input.userId)
  const client = new SeedanceAssetsClient(config)
  const groupId = await ensureSeedanceProjectAssetGroup({
    projectId: input.projectId,
    volcengineProjectName: config.projectName,
    client,
  })

  const assetUris: string[] = []
  for (const material of ordered) {
    const imageValue = material.storageKey?.trim() || material.resultUrl?.trim() || ''
    if (!imageValue) throw new Error(`SEEDANCE_ASSET_IMAGE_REQUIRED: 素材 ${material.title || material.id} 没有图片`)
    const existing = readToolboxPrivateAssetMetadata(material.metadata)
    if (
      existing.projectName === config.projectName
      && existing.groupId === groupId
      && existing.sourceImage === imageValue
      && existing.status === 'Active'
      && existing.assetUri?.startsWith('asset://')
    ) {
      assetUris.push(existing.assetUri)
      continue
    }

    const created = await client.createImageAsset({
      groupId,
      url: await resolvePublicImageUrl(imageValue),
      name: material.title || `toolbox-${material.id.slice(0, 8)}`,
      projectName: config.projectName,
    })
    if (!created.Id) throw new Error('CreateAsset did not return asset id')
    if (created.Status === 'Failed') {
      throw new Error(`SEEDANCE_ASSET_CREATE_FAILED: ${assetError(created) || '真人素材审核失败'}`)
    }
    const processingMetadata: ToolboxPrivateAssetMetadata = {
      groupId,
      assetId: created.Id,
      assetUri: `asset://${created.Id}`,
      status: created.Status || 'Processing',
      sourceImage: imageValue,
      projectName: config.projectName,
      syncedAt: new Date().toISOString(),
    }
    await prisma.frameosMaterial.update({
      where: { id: material.id },
      data: { metadata: mergeToolboxPrivateAssetMetadata(material.metadata, processingMetadata) },
    })

    const active = await waitForActiveAsset({
      client,
      assetId: created.Id,
      projectName: config.projectName,
      onStatus: async (status, attempt) => {
        await input.onStatus?.({ materialId: material.id, status, attempt })
      },
    })
    const activeId = active.Id || created.Id
    const assetUri = `asset://${activeId}`
    await prisma.frameosMaterial.update({
      where: { id: material.id },
      data: {
        metadata: mergeToolboxPrivateAssetMetadata(material.metadata, {
          ...processingMetadata,
          assetId: activeId,
          assetUri,
          status: 'Active',
          syncedAt: new Date().toISOString(),
        }),
      },
    })
    assetUris.push(assetUri)
  }
  return assetUris
}
