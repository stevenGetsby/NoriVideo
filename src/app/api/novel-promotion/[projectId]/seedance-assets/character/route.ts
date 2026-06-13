import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { decodeImageUrlsFromDb } from '@/lib/contracts/image-urls-contract'
import { extractStorageKey, getSignedObjectUrl, getStorageType } from '@/lib/storage'
import { getSeedanceAssetsConfig } from '@/lib/volcengine/seedance-assets-config'
import { SeedanceAssetsClient, type SeedanceAssetResult } from '@/lib/volcengine/seedance-assets-client'
import { replacePanelSeedanceReferenceAssetForCharacter } from '@/lib/novel-promotion/seedance-reference-assets'

type CharacterWithAppearances = NonNullable<Awaited<ReturnType<typeof loadCharacter>>>

function readTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function isPublicHttpUrl(value: string): boolean {
  if (!value.startsWith('http://') && !value.startsWith('https://')) return false
  try {
    const parsed = new URL(value)
    const host = parsed.hostname.toLowerCase()
    return host !== 'localhost' && host !== '127.0.0.1' && host !== '::1'
  } catch {
    return false
  }
}

async function resolvePublicImageUrl(imageValue: string): Promise<string> {
  if (isPublicHttpUrl(imageValue)) return imageValue

  const storageKey = extractStorageKey(imageValue)
  if (!storageKey) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'SEEDANCE_ASSET_IMAGE_URL_INVALID',
      field: 'imageUrl',
    })
  }

  if (getStorageType() === 'local') {
    throw new ApiError('INVALID_PARAMS', {
      code: 'SEEDANCE_ASSET_PUBLIC_URL_REQUIRED',
      field: 'storage',
      message: '上传火山素材库需要公网可访问图片 URL。当前是本地存储，请先配置 TOS/MinIO 公网访问后再上传。',
    })
  }

  const signedUrl = await getSignedObjectUrl(storageKey, 12 * 60 * 60)
  if (!isPublicHttpUrl(signedUrl)) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'SEEDANCE_ASSET_PUBLIC_URL_REQUIRED',
      field: 'storage',
      message: '存储签名 URL 不是公网 HTTP(S) 地址，火山素材库无法拉取该图片。',
    })
  }
  return signedUrl
}

async function loadCharacter(projectId: string, characterId: string) {
  return await prisma.novelPromotionCharacter.findFirst({
    where: {
      id: characterId,
      novelPromotionProject: {
        projectId,
      },
    },
    include: {
      appearances: {
        orderBy: { appearanceIndex: 'asc' },
      },
    },
  })
}

function pickAppearanceImage(input: {
  appearance: CharacterWithAppearances['appearances'][number]
  imageIndex: number | null
}): { imageUrl: string; imageIndex: number | null } {
  const imageUrls = decodeImageUrlsFromDb(input.appearance.imageUrls, 'characterAppearance.imageUrls')
  if (input.imageIndex !== null && input.imageIndex >= 0) {
    const selected = imageUrls[input.imageIndex]
    if (selected) return { imageUrl: selected, imageIndex: input.imageIndex }
  }
  if (input.appearance.imageUrl) return { imageUrl: input.appearance.imageUrl, imageIndex: input.appearance.selectedIndex }
  const selectedIndex = input.appearance.selectedIndex ?? 0
  const selected = imageUrls[selectedIndex] || imageUrls.find(Boolean)
  if (!selected) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'SEEDANCE_ASSET_IMAGE_REQUIRED',
      field: 'appearanceId',
    })
  }
  return { imageUrl: selected, imageIndex: selectedIndex }
}

async function ensureAssetGroup(input: {
  client: SeedanceAssetsClient
  character: CharacterWithAppearances
  projectName: string
}) {
  if (
    input.character.seedanceAssetGroupId
    && (input.character.seedanceAssetsProjectName || 'default') === input.projectName
  ) {
    return input.character.seedanceAssetGroupId
  }

  const group = await input.client.createAssetGroup({
    name: input.character.name,
    description: `Nori virtual human asset group for ${input.character.name}`,
    projectName: input.projectName,
  })
  if (!group.Id) throw new Error('CreateAssetGroup did not return group id')

  await prisma.novelPromotionCharacter.update({
    where: { id: input.character.id },
    data: {
      seedanceAssetGroupId: group.Id,
      seedanceAssetsProjectName: input.projectName,
    },
  })
  return group.Id
}

async function syncPanelReferences(input: {
  projectId: string
  characterName: string
  assetUri: string
}) {
  const panels = await prisma.novelPromotionPanel.findMany({
    where: {
      storyboard: {
        episode: {
          novelPromotionProject: {
            projectId: input.projectId,
          },
        },
      },
      actingNotes: {
        contains: input.characterName,
      },
    },
    select: {
      id: true,
      actingNotes: true,
    },
  })

  for (const panel of panels) {
    const nextActingNotes = replacePanelSeedanceReferenceAssetForCharacter(panel.actingNotes, {
      characterName: input.characterName,
      assetUri: input.assetUri,
    })
    if (nextActingNotes === panel.actingNotes) continue
    await prisma.novelPromotionPanel.update({
      where: { id: panel.id },
      data: { actingNotes: nextActingNotes },
    })
  }
}

function normalizeAssetStatus(asset: SeedanceAssetResult): {
  status: string
  error: string | null
} {
  const status = asset.Status || 'Processing'
  const error = [asset.Error?.Code, asset.Error?.Message].filter(Boolean).join(': ') || null
  return { status, error }
}

export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  const characterId = readTrimmedString(body.characterId)
  const appearanceId = readTrimmedString(body.appearanceId)
  const imageIndexRaw = body.imageIndex
  const imageIndex = typeof imageIndexRaw === 'number' && Number.isInteger(imageIndexRaw) ? imageIndexRaw : null
  if (!characterId || !appearanceId) {
    throw new ApiError('INVALID_PARAMS', { code: 'SEEDANCE_ASSET_TARGET_REQUIRED' })
  }

  const character = await loadCharacter(projectId, characterId)
  if (!character) throw new ApiError('NOT_FOUND')
  const appearance = character.appearances.find((item) => item.id === appearanceId)
  if (!appearance) throw new ApiError('NOT_FOUND')

  const { imageUrl } = pickAppearanceImage({ appearance, imageIndex })
  const publicImageUrl = await resolvePublicImageUrl(imageUrl)
  const config = await getSeedanceAssetsConfig(authResult.session.user.id)
  const client = new SeedanceAssetsClient(config)
  const groupId = await ensureAssetGroup({
    client,
    character,
    projectName: config.projectName,
  })

  const created = await client.createImageAsset({
    groupId,
    url: publicImageUrl,
    name: `${character.name}-${appearance.changeReason || 'appearance'}`,
    projectName: config.projectName,
  })
  if (!created.Id) throw new Error('CreateAsset did not return asset id')

  const assetUri = `asset://${created.Id}`
  const { status, error } = normalizeAssetStatus(created)
  await prisma.characterAppearance.update({
    where: { id: appearance.id },
    data: {
      seedanceAssetId: created.Id,
      seedanceAssetUri: assetUri,
      seedanceAssetStatus: status,
      seedanceAssetError: error,
      seedanceAssetImageUrl: imageUrl,
      seedanceAssetSyncedAt: new Date(),
    },
  })

  if (status === 'Active') {
    await syncPanelReferences({
      projectId,
      characterName: character.name,
      assetUri,
    })
  }

  return NextResponse.json({
    success: true,
    assetId: created.Id,
    assetUri,
    status,
    error,
    groupId,
  })
})

export const PATCH = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  const characterId = readTrimmedString(body.characterId)
  const appearanceId = readTrimmedString(body.appearanceId)
  if (!characterId || !appearanceId) {
    throw new ApiError('INVALID_PARAMS', { code: 'SEEDANCE_ASSET_TARGET_REQUIRED' })
  }

  const character = await loadCharacter(projectId, characterId)
  if (!character) throw new ApiError('NOT_FOUND')
  const appearance = character.appearances.find((item) => item.id === appearanceId)
  if (!appearance?.seedanceAssetId) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'SEEDANCE_ASSET_ID_REQUIRED',
      field: 'appearanceId',
    })
  }

  const config = await getSeedanceAssetsConfig(authResult.session.user.id)
  const client = new SeedanceAssetsClient(config)
  const asset = await client.getAsset({
    assetId: appearance.seedanceAssetId,
    projectName: config.projectName,
  })
  const assetUri = `asset://${asset.Id || appearance.seedanceAssetId}`
  const { status, error } = normalizeAssetStatus(asset)

  await prisma.characterAppearance.update({
    where: { id: appearance.id },
    data: {
      seedanceAssetUri: assetUri,
      seedanceAssetStatus: status,
      seedanceAssetError: error,
      seedanceAssetSyncedAt: new Date(),
    },
  })

  if (status === 'Active') {
    await syncPanelReferences({
      projectId,
      characterName: character.name,
      assetUri,
    })
  }

  return NextResponse.json({
    success: true,
    assetId: asset.Id || appearance.seedanceAssetId,
    assetUri,
    status,
    error,
  })
})
