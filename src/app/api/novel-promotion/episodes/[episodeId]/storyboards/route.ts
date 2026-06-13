import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { attachMediaFieldsToProject } from '@/lib/media/attach'

function mapPanelToGroupPanel(panel: {
  id: string
  panelIndex: number
  imageUrl?: string | null
  videoUrl?: string | null
  videoGenerationMode?: string | null
  videoPrompt?: string | null
  srtSegment?: string | null
  imagePrompt?: string | null
  lastError?: string | null
}) {
  return {
    id: panel.id,
    shotId: panel.id,
    stageIndex: panel.panelIndex,
    shotIndex: panel.panelIndex,
    imageUrl: panel.imageUrl || null,
    motionPrompt: panel.videoPrompt || null,
    voiceText: panel.srtSegment || null,
    voiceUrl: null,
    videoUrl: panel.videoUrl || null,
    videoGenerationMode: panel.videoGenerationMode || null,
    errorMessage: panel.lastError || null,
    candidates: [],
    pendingCandidateCount: 0,
    imagePrompt: panel.imagePrompt || null,
  }
}

export const GET = apiHandler(async (
  _request: Request,
  context: { params: Promise<{ episodeId: string }> },
) => {
  const { episodeId } = await context.params
  if (!episodeId) {
    throw new ApiError('INVALID_PARAMS')
  }

  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  const episode = await prisma.novelPromotionEpisode.findUnique({
    where: { id: episodeId },
    select: {
      id: true,
      novelPromotionProject: {
        select: {
          project: {
            select: { userId: true },
          },
        },
      },
    },
  })

  if (!episode) {
    throw new ApiError('NOT_FOUND')
  }
  if (episode.novelPromotionProject.project.userId !== session.user.id) {
    throw new ApiError('FORBIDDEN')
  }

  const storyboards = await prisma.novelPromotionStoryboard.findMany({
    where: { episodeId },
    include: {
      clip: true,
      panels: { orderBy: { panelIndex: 'asc' } },
    },
    orderBy: { createdAt: 'asc' },
  })

  const withMedia = await attachMediaFieldsToProject({ storyboards })
  const processedStoryboards = withMedia.storyboards || storyboards
  const groups = processedStoryboards.map((storyboard, index) => ({
    id: storyboard.id,
    stageIndex: index,
    panels: (storyboard.panels || []).map(mapPanelToGroupPanel),
  }))

  return NextResponse.json({
    storyboards: processedStoryboards,
    groups,
  })
})
