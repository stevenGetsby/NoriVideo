import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireProjectAuthLight } from '@/lib/api-auth'
import { decodeImageUrlsFromDb, encodeImageUrls } from '@/lib/contracts/image-urls-contract'
import { resolveMediaRefFromLegacyValue } from '@/lib/media/service'
import { refreshProjectPanelReferenceAssets } from '@/lib/novel-promotion/refresh-panel-reference-assets'
import { prisma } from '@/lib/prisma'

type ImportAssetImageBody = {
  kind?: 'character' | 'location' | 'prop'
  assetId?: string
  appearanceId?: string | null
  imageIndex?: number
  materialId?: string
}

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeImageIndex(value: unknown): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 99) {
    throw new ApiError('INVALID_PARAMS', { message: '图片序号无效。' })
  }
  return parsed
}

export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params
  const authResult = await requireProjectAuthLight(projectId, ['assetWrite'])
  if (isErrorResponse(authResult)) return authResult

  const body = await request.json() as ImportAssetImageBody
  const kind = body.kind
  const assetId = cleanText(body.assetId)
  const appearanceId = cleanText(body.appearanceId)
  const materialId = cleanText(body.materialId)
  const imageIndex = normalizeImageIndex(body.imageIndex ?? 0)
  if ((kind !== 'character' && kind !== 'location' && kind !== 'prop') || !assetId || !materialId) {
    throw new ApiError('INVALID_PARAMS', { message: '请选择有效的图片素材和资产。' })
  }

  const material = await prisma.frameosMaterial.findFirst({
    where: {
      id: materialId,
      userId: authResult.session.user.id,
      type: 'image',
      status: 'ready',
      deletedAt: null,
    },
    select: {
      id: true,
      title: true,
      storageKey: true,
      resultUrl: true,
    },
  })
  const imageValue = material?.storageKey || material?.resultUrl || ''
  if (!material || !imageValue) {
    throw new ApiError('NOT_FOUND', { message: '所选图片素材不存在或当前账号不可用。' })
  }
  const media = await resolveMediaRefFromLegacyValue(imageValue)

  if (kind === 'character') {
    if (!appearanceId) {
      throw new ApiError('INVALID_PARAMS', { message: '角色形象记录不存在，请先重新解析资产。' })
    }
    const appearance = await prisma.characterAppearance.findFirst({
      where: {
        id: appearanceId,
        characterId: assetId,
        character: { novelPromotionProject: { projectId } },
      },
      select: {
        id: true,
        imageUrl: true,
        imageUrls: true,
        imageMediaId: true,
        selectedIndex: true,
      },
    })
    if (!appearance) throw new ApiError('NOT_FOUND', { message: '角色形象不存在。' })

    const imageUrls = decodeImageUrlsFromDb(appearance.imageUrls, 'characterAppearance.imageUrls')
    while (imageUrls.length <= imageIndex) imageUrls.push('')
    imageUrls[imageIndex] = imageValue
    const updatesMainImage = appearance.selectedIndex === imageIndex
      || (appearance.selectedIndex === null && imageIndex === 0)
      || imageUrls.filter(Boolean).length === 1

    await prisma.characterAppearance.update({
      where: { id: appearance.id },
      data: {
        previousImageUrl: appearance.imageUrl,
        previousImageUrls: appearance.imageUrls,
        imageUrls: encodeImageUrls(imageUrls),
        ...(updatesMainImage ? {
          imageUrl: imageValue,
          imageMediaId: media?.id || null,
        } : {}),
      },
    })
  } else {
    const location = await prisma.novelPromotionLocation.findFirst({
      where: {
        id: assetId,
        assetKind: kind === 'prop' ? 'prop' : { not: 'prop' },
        novelPromotionProject: { projectId },
      },
      select: {
        id: true,
        selectedImageId: true,
        images: {
          where: { imageIndex },
          take: 1,
          select: { id: true, imageUrl: true, isSelected: true },
        },
      },
    })
    if (!location) throw new ApiError('NOT_FOUND', { message: kind === 'prop' ? '物品资产不存在。' : '环境资产不存在。' })

    const currentImage = location.images[0]
    const nextImage = currentImage
      ? await prisma.locationImage.update({
          where: { id: currentImage.id },
          data: {
            previousImageUrl: currentImage.imageUrl,
            imageUrl: imageValue,
            imageMediaId: media?.id || null,
          },
          select: { id: true },
        })
      : await prisma.locationImage.create({
          data: {
            locationId: location.id,
            imageIndex,
            imageUrl: imageValue,
            imageMediaId: media?.id || null,
            description: material.title || '导入素材图',
            isSelected: !location.selectedImageId && imageIndex === 0,
          },
          select: { id: true },
        })
    if (!location.selectedImageId && imageIndex === 0) {
      await prisma.novelPromotionLocation.update({
        where: { id: location.id },
        data: { selectedImageId: nextImage.id },
      })
    }
  }

  await refreshProjectPanelReferenceAssets({ projectId })
  return NextResponse.json({
    success: true,
    materialId: material.id,
    imageUrl: media?.url || imageValue,
  })
})
