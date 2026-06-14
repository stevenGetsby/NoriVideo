import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { resolveAnalysisModel } from '@/lib/workers/handlers/resolve-analysis-model'
import { runExportPreflightReview } from '@/lib/novel-promotion/export-preflight-review'

function readText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params
  const body = await request.json().catch(() => ({}))
  const episodeId = readText(body?.episodeId)
  const exportTarget = readText(body?.exportTarget) || (episodeId ? 'episode delivery package' : 'project delivery package')

  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  const novelData = await prisma.novelPromotionProject.findUnique({
    where: { projectId },
    include: {
      characters: true,
      locations: {
        include: {
          images: {
            orderBy: { imageIndex: 'asc' },
          },
        },
      },
      episodes: {
        where: episodeId ? { id: episodeId } : undefined,
        orderBy: { episodeNumber: 'asc' },
        include: {
          voiceLines: {
            orderBy: { lineIndex: 'asc' },
          },
          storyboards: {
            orderBy: { createdAt: 'asc' },
            include: {
              clip: true,
              panels: {
                orderBy: { panelIndex: 'asc' },
              },
            },
          },
        },
      },
    },
  })
  if (!novelData) {
    throw new ApiError('NOT_FOUND')
  }
  if (episodeId && novelData.episodes.length === 0) {
    throw new ApiError('NOT_FOUND')
  }

  const model = await resolveAnalysisModel({
    userId: session.user.id,
    inputModel: body?.model,
    projectAnalysisModel: novelData.analysisModel,
  })
  const result = await runExportPreflightReview({
    userId: session.user.id,
    projectId,
    model,
    locale: request.nextUrl.searchParams.get('locale') === 'en' ? 'en' : 'zh',
    input: {
      exportTarget,
      episodes: novelData.episodes,
      characters: novelData.characters,
      locations: novelData.locations,
    },
  })

  return NextResponse.json({
    success: true,
    model,
    review: result.review,
    promptPayload: result.promptPayload,
    reasoning: result.reasoning,
  })
})

