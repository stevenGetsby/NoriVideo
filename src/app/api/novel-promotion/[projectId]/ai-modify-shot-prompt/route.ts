import { NextRequest } from 'next/server'
import { requireProjectAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { TASK_TYPE } from '@/lib/task/types'
import { maybeSubmitLLMTask } from '@/lib/llm-observe/route-task'
import { prisma } from '@/lib/prisma'

export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params
  const authResult = await requireProjectAuth(projectId)
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  const body = await request.json().catch(() => ({}))
  const currentPrompt = typeof body?.currentPrompt === 'string' ? body.currentPrompt.trim() : ''
  const modifyInstruction = typeof body?.modifyInstruction === 'string' ? body.modifyInstruction.trim() : ''
  if (!currentPrompt || !modifyInstruction) {
    throw new ApiError('INVALID_PARAMS')
  }
  const panelId = typeof body?.panelId === 'string' ? body.panelId.trim() : ''
  const episodeId = typeof body?.episodeId === 'string' ? body.episodeId.trim() : ''
  let scopedPanelId = panelId
  let scopedEpisodeId = episodeId || null

  if (panelId) {
    const panel = await prisma.novelPromotionPanel.findFirst({
      where: {
        id: panelId,
        storyboard: {
          episode: {
            novelPromotionProject: {
              projectId,
            },
          },
        },
      },
      select: {
        id: true,
        storyboard: {
          select: {
            episode: {
              select: { id: true },
            },
          },
        },
      },
    })
    if (!panel) {
      throw new ApiError('NOT_FOUND')
    }
    scopedPanelId = panel.id
    scopedEpisodeId = panel.storyboard.episode.id
  } else if (episodeId) {
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
    scopedEpisodeId = episode.id
  }

  const asyncTaskResponse = await maybeSubmitLLMTask({
    request,
    userId: session.user.id,
    projectId,
    episodeId: scopedEpisodeId,
    type: TASK_TYPE.AI_MODIFY_SHOT_PROMPT,
    targetType: scopedPanelId ? 'NovelPromotionPanel' : 'NovelPromotionProject',
    targetId: scopedPanelId || projectId,
    routePath: `/api/novel-promotion/${projectId}/ai-modify-shot-prompt`,
    body: {
      ...body,
      ...(scopedPanelId ? { panelId: scopedPanelId } : {}),
      ...(scopedEpisodeId ? { episodeId: scopedEpisodeId } : {}),
    },
    dedupeKey: scopedPanelId ? `ai_modify_shot_prompt:${scopedPanelId}` : `ai_modify_shot_prompt:${projectId}`})
  if (asyncTaskResponse) return asyncTaskResponse

  throw new ApiError('INVALID_PARAMS')
})
