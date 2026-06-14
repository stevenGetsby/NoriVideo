import { NextRequest } from 'next/server'
import { requireProjectAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { TASK_TYPE } from '@/lib/task/types'
import { maybeSubmitLLMTask } from '@/lib/llm-observe/route-task'
import { prisma } from '@/lib/prisma'

/**
 * POST /api/novel-promotion/[projectId]/screenplay-conversion
 * 将 clips 转换为结构化剧本
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

  const authResult = await requireProjectAuth(projectId)
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
    type: TASK_TYPE.SCREENPLAY_CONVERT,
    targetType: 'NovelPromotionEpisode',
    targetId: episode.id,
    routePath: `/api/novel-promotion/${projectId}/screenplay-conversion`,
    body: {
      ...body,
      episodeId: episode.id,
      displayMode: 'detail',
    },
    dedupeKey: `screenplay_convert:${episode.id}`,
    priority: 2,
  })
  if (asyncTaskResponse) return asyncTaskResponse

  throw new ApiError('INVALID_PARAMS')
})
