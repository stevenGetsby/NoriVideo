import { NextRequest } from 'next/server'
import { requireProjectAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { TASK_TYPE } from '@/lib/task/types'
import { maybeSubmitLLMTask } from '@/lib/llm-observe/route-task'
import { prisma } from '@/lib/prisma'

/**
 * 确认角色档案并生成视觉描述
 * POST /api/novel-promotion/[projectId]/character-profile/confirm
 */
export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params
  const body = await request.json().catch(() => ({}))
  const characterId = typeof body?.characterId === 'string' ? body.characterId.trim() : ''

  if (!characterId) {
    throw new ApiError('INVALID_PARAMS')
  }

  const authResult = await requireProjectAuth(projectId)
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  const character = await prisma.novelPromotionCharacter.findFirst({
    where: {
      id: characterId,
      novelPromotionProject: {
        projectId,
      },
    },
    select: { id: true },
  })
  if (!character) {
    throw new ApiError('NOT_FOUND')
  }

  const asyncTaskResponse = await maybeSubmitLLMTask({
    request,
    userId: session.user.id,
    projectId,
    type: TASK_TYPE.CHARACTER_PROFILE_CONFIRM,
    targetType: 'NovelPromotionCharacter',
    targetId: character.id,
    routePath: `/api/novel-promotion/${projectId}/character-profile/confirm`,
    body: {
      ...body,
      characterId: character.id,
    },
    dedupeKey: `character_profile_confirm:${character.id}`})
  if (asyncTaskResponse) return asyncTaskResponse

  throw new ApiError('INVALID_PARAMS')
})
