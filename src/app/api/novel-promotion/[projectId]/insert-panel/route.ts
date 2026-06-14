import { NextRequest, NextResponse } from 'next/server'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError, getRequestId } from '@/lib/api-errors'
import { submitTask } from '@/lib/task/submitter'
import { resolveRequiredTaskLocale } from '@/lib/task/resolve-locale'
import { TASK_TYPE } from '@/lib/task/types'
import { buildDefaultTaskBillingInfo } from '@/lib/billing'
import { getProjectModelConfig } from '@/lib/config-service'
import { resolveInsertPanelUserInput } from '@/lib/novel-promotion/insert-panel'
import { prisma } from '@/lib/prisma'

export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params

  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  const body = await request.json()
  const locale = resolveRequiredTaskLocale(request, body)
  const storyboardId = typeof body?.storyboardId === 'string' ? body.storyboardId.trim() : ''
  const insertAfterPanelId = typeof body?.insertAfterPanelId === 'string' ? body.insertAfterPanelId.trim() : ''
  const userInput = resolveInsertPanelUserInput((body || {}) as Record<string, unknown>, locale)

  if (!storyboardId || !insertAfterPanelId) {
    throw new ApiError('INVALID_PARAMS', {
    })
  }

  const storyboard = await prisma.novelPromotionStoryboard.findFirst({
    where: {
      id: storyboardId,
      episode: {
        novelPromotionProject: {
          projectId,
        },
      },
    },
    select: { id: true },
  })
  if (!storyboard) {
    throw new ApiError('NOT_FOUND')
  }
  const insertAfterPanel = await prisma.novelPromotionPanel.findFirst({
    where: {
      id: insertAfterPanelId,
      storyboardId: storyboard.id,
    },
    select: { id: true },
  })
  if (!insertAfterPanel) {
    throw new ApiError('NOT_FOUND')
  }

  const projectModelConfig = await getProjectModelConfig(projectId, session.user.id)
  const billingPayload = {
    ...body,
    storyboardId: storyboard.id,
    insertAfterPanelId: insertAfterPanel.id,
    userInput,
    ...(projectModelConfig.analysisModel ? { analysisModel: projectModelConfig.analysisModel } : {}),
  }

  const result = await submitTask({
    userId: session.user.id,
    locale,
    requestId: getRequestId(request),
    projectId,
    type: TASK_TYPE.INSERT_PANEL,
    targetType: 'NovelPromotionStoryboard',
    targetId: storyboard.id,
    payload: billingPayload,
    dedupeKey: `insert_panel:${storyboard.id}:${insertAfterPanel.id}`,
    billingInfo: buildDefaultTaskBillingInfo(TASK_TYPE.INSERT_PANEL, billingPayload),
  })

  return NextResponse.json(result)
})
