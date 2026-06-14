import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { attachMediaFieldsToProject } from '@/lib/media/attach'
import { extractModelKey } from '@/lib/config-service'

const USER_MODEL_DEFAULT_SELECT = {
  analysisModel: true,
  characterModel: true,
  locationModel: true,
  storyboardModel: true,
  editModel: true,
  videoModel: true,
  audioModel: true,
} as const

type ModelDefaults = Record<keyof typeof USER_MODEL_DEFAULT_SELECT, string | null | undefined>

function readAssetKind(value: Record<string, unknown>): string {
  return typeof value.assetKind === 'string' ? value.assetKind : 'location'
}

function applyEffectiveProjectModelDefaults<T extends ModelDefaults>(
  projectConfig: T,
  userDefaults: ModelDefaults | null | undefined,
): T {
  return {
    ...projectConfig,
    analysisModel: extractModelKey(projectConfig.analysisModel) || extractModelKey(userDefaults?.analysisModel),
    characterModel: extractModelKey(projectConfig.characterModel) || extractModelKey(userDefaults?.characterModel),
    locationModel: extractModelKey(projectConfig.locationModel) || extractModelKey(userDefaults?.locationModel),
    storyboardModel: extractModelKey(projectConfig.storyboardModel) || extractModelKey(userDefaults?.storyboardModel),
    editModel: extractModelKey(projectConfig.editModel) || extractModelKey(userDefaults?.editModel),
    videoModel: extractModelKey(projectConfig.videoModel) || extractModelKey(userDefaults?.videoModel),
    audioModel: extractModelKey(projectConfig.audioModel) || extractModelKey(userDefaults?.audioModel),
  }
}

export const GET = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params

  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      userId: session.user.id,
    },
    include: {
      novelPromotionData: {
        include: {
          characters: {
            include: {
              appearances: { orderBy: { appearanceIndex: 'asc' } },
            },
            orderBy: { createdAt: 'asc' },
          },
          locations: {
            include: {
              images: { orderBy: { imageIndex: 'asc' } },
            },
            orderBy: { createdAt: 'asc' },
          },
          episodes: {
            orderBy: { episodeNumber: 'asc' },
            select: {
              id: true,
              episodeNumber: true,
              name: true,
              description: true,
              novelText: true,
              audioUrl: true,
              audioMediaId: true,
              srtContent: true,
              createdAt: true,
              updatedAt: true,
            },
          },
        },
      },
    },
  })

  if (!project) {
    throw new ApiError('NOT_FOUND')
  }

  if (!project.novelPromotionData) {
    throw new ApiError('NOT_FOUND')
  }

  await prisma.project.update({
    where: { id: project.id },
    data: { lastAccessedAt: new Date() },
  }).catch(() => undefined)

  const userPreference = await prisma.userPreference.findUnique({
    where: { userId: session.user.id },
    select: USER_MODEL_DEFAULT_SELECT,
  })
  const novelPromotionDataWithMedia = await attachMediaFieldsToProject(project.novelPromotionData)
  const effectiveNovelPromotionData = applyEffectiveProjectModelDefaults(
    novelPromotionDataWithMedia as typeof novelPromotionDataWithMedia & ModelDefaults,
    userPreference,
  )
  const locations = (novelPromotionDataWithMedia.locations || []).filter((item) => readAssetKind(item) !== 'prop')
  const props = (novelPromotionDataWithMedia.locations || []).filter((item) => readAssetKind(item) === 'prop')

  return NextResponse.json({
    project: {
      ...project,
      novelPromotionData: {
        ...effectiveNovelPromotionData,
        locations,
        props,
      },
    },
  })
})
