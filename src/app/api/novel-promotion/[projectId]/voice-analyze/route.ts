import { NextRequest } from 'next/server'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { TASK_TYPE } from '@/lib/task/types'
import { maybeSubmitLLMTask } from '@/lib/llm-observe/route-task'
import { prisma } from '@/lib/prisma'

/**
 * POST /api/novel-promotion/[projectId]/voice-analyze
 * 台词分析（任务化）
 */
export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params
  const body = await request.json().catch(() => ({}))
  const episodeId = typeof body?.episodeId === 'string' ? body.episodeId.trim() : ''

  if (!episodeId) {
    throw new ApiError('INVALID_PARAMS')
  }

  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  const episode = await prisma.novelPromotionEpisode.findFirst({
    where: {
      id: episodeId,
      novelPromotionProject: {
        projectId,
      },
    },
    select: { id: true },
  })
  if (!episode) {
    throw new ApiError('NOT_FOUND')
  }

  const asyncTaskResponse = await maybeSubmitLLMTask({
    request,
    userId: session.user.id,
    projectId,
    episodeId: episode.id,
    type: TASK_TYPE.VOICE_ANALYZE,
    targetType: 'NovelPromotionEpisode',
    targetId: episode.id,
    routePath: `/api/novel-promotion/${projectId}/voice-analyze`,
    body: {
      ...body,
      episodeId: episode.id,
      displayMode: 'detail',
    },
    dedupeKey: `voice_analyze:${episode.id}`,
    priority: 1,
  })
  if (asyncTaskResponse) return asyncTaskResponse

  throw new ApiError('INVALID_PARAMS')
})
