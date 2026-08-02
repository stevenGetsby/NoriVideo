import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireProjectAuthLight } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'
import {
  buildPanelSeedanceReferenceAssets,
  mergePanelSeedanceReferenceAssets,
  readPanelSeedanceReferenceAssetsFromActingNotes,
  writePanelSeedanceReferenceAssetsToActingNotes,
  type PanelSeedanceReferenceAsset,
  type SeedanceReferenceAssetKind,
} from '@/lib/novel-promotion/seedance-reference-assets'
import { readPanelFrameOSMetadataFromActingNotes } from '@/lib/novel-promotion/panel-frameos-metadata'

function isReferenceKind(value: unknown): value is SeedanceReferenceAssetKind {
  return value === 'character' || value === 'location' || value === 'prop'
}

async function readPanel(projectId: string, panelId: string) {
  const panel = await prisma.novelPromotionPanel.findFirst({
    where: {
      id: panelId,
      storyboard: {
        episode: {
          novelPromotionProject: { projectId },
        },
      },
    },
    include: {
      storyboard: {
        include: {
          episode: {
            include: {
              novelPromotionProject: {
                include: {
                  characters: {
                    include: {
                      appearances: { orderBy: { appearanceIndex: 'asc' } },
                    },
                  },
                  locations: {
                    include: {
                      selectedImage: true,
                      images: { orderBy: { imageIndex: 'asc' } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  })
  if (!panel) throw new ApiError('NOT_FOUND')
  return panel
}

function serialize(assets: PanelSeedanceReferenceAsset[]) {
  return assets.map((asset) => ({
    materialId: asset.materialId || null,
    kind: asset.kind,
    name: asset.name,
    imageUrl: asset.imageUrl,
    role: asset.role,
    appearance: asset.appearance || null,
    appearanceId: asset.appearanceId || null,
  }))
}

function resolvePanelReferences(
  panel: Awaited<ReturnType<typeof readPanel>>,
  persisted: PanelSeedanceReferenceAsset[],
): PanelSeedanceReferenceAsset[] {
  const episode = panel.storyboard.episode
  const projectAssets = episode.novelPromotionProject
  const generated = buildPanelSeedanceReferenceAssets({
    panel: {
      characters: panel.characters,
      location: panel.location,
      props: panel.props,
      videoPrompt: panel.videoPrompt,
    },
    characterAssets: projectAssets.characters,
    locationAssets: projectAssets.locations,
    episodeNumber: episode.episodeNumber,
    sceneId: readPanelFrameOSMetadataFromActingNotes(panel.actingNotes)?.panel_id?.match(/^S\d+/i)?.[0] || null,
  })
  return mergePanelSeedanceReferenceAssets(generated, persisted)
}

export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string; panelId: string }> },
) => {
  const { projectId, panelId } = await context.params
  const authResult = await requireProjectAuthLight(projectId, ['storyboardWrite'])
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult
  const body = await request.json() as { materialId?: unknown; kind?: unknown }
  const materialId = typeof body.materialId === 'string' ? body.materialId.trim() : ''
  if (!materialId || !isReferenceKind(body.kind)) {
    throw new ApiError('INVALID_PARAMS')
  }

  const [panel, material] = await Promise.all([
    readPanel(projectId, panelId),
    prisma.frameosMaterial.findFirst({
      where: {
        id: materialId,
        userId: session.user.id,
        type: 'image',
        status: 'ready',
        deletedAt: null,
        projectId: { in: [projectId, 'global', 'global-asset-hub'] },
      },
    }),
  ])
  if (!material) throw new ApiError('NOT_FOUND')

  const current = readPanelSeedanceReferenceAssetsFromActingNotes(panel.actingNotes)
  if (!current.some((asset) => asset.materialId === material.id || asset.imageUrl === (material.storageKey || material.resultUrl))) {
    if (current.length >= 9) {
      throw new ApiError('INVALID_PARAMS', { message: '单个分镜最多添加 9 张参考图片。' })
    }
    current.push({
      materialId: material.id,
      kind: body.kind,
      name: material.title?.trim() || '未命名素材',
      imageUrl: material.storageKey || material.resultUrl || '',
      role: 'reference_image',
    })
  }

  const references = resolvePanelReferences(panel, current)
  const actingNotes = writePanelSeedanceReferenceAssetsToActingNotes(panel.actingNotes, references)
  await prisma.novelPromotionPanel.update({
    where: { id: panel.id },
    data: { actingNotes },
  })
  return NextResponse.json({ success: true, assets: serialize(references) })
})

export const DELETE = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string; panelId: string }> },
) => {
  const { projectId, panelId } = await context.params
  const authResult = await requireProjectAuthLight(projectId, ['storyboardWrite'])
  if (isErrorResponse(authResult)) return authResult
  const materialId = request.nextUrl.searchParams.get('materialId')?.trim() || ''
  if (!materialId) throw new ApiError('INVALID_PARAMS')
  const panel = await readPanel(projectId, panelId)
  const current = readPanelSeedanceReferenceAssetsFromActingNotes(panel.actingNotes)
  const next = resolvePanelReferences(
    panel,
    current.filter((asset) => asset.materialId !== materialId),
  )
  const actingNotes = writePanelSeedanceReferenceAssetsToActingNotes(panel.actingNotes, next)
  await prisma.novelPromotionPanel.update({
    where: { id: panel.id },
    data: { actingNotes },
  })
  return NextResponse.json({ success: true, assets: serialize(next) })
})
