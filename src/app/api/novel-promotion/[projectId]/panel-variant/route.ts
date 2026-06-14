import { NextRequest, NextResponse } from 'next/server'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError, getRequestId } from '@/lib/api-errors'
import { buildDefaultTaskBillingInfo } from '@/lib/billing'
import { getProjectModelConfig, buildImageBillingPayload } from '@/lib/config-service'
import { prisma } from '@/lib/prisma'
import { submitTask } from '@/lib/task/submitter'
import { resolveRequiredTaskLocale } from '@/lib/task/resolve-locale'
import { TASK_TYPE } from '@/lib/task/types'

function createPanelVariantId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `panel-variant-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

async function rollbackCreatedVariantPanel(params: {
  panelId: string
  storyboardId: string
  panelIndex: number
}) {
  await prisma.$transaction(async (tx) => {
    await tx.novelPromotionPanel.delete({
      where: { id: params.panelId },
    })

    const maxPanel = await tx.novelPromotionPanel.findFirst({
      where: { storyboardId: params.storyboardId },
      orderBy: { panelIndex: 'desc' },
      select: { panelIndex: true },
    })
    const maxPanelIndex = maxPanel?.panelIndex ?? -1
    const offset = maxPanelIndex + 1000

    await tx.novelPromotionPanel.updateMany({
      where: {
        storyboardId: params.storyboardId,
        panelIndex: { gt: params.panelIndex },
      },
      data: {
        panelIndex: { increment: offset },
        panelNumber: { increment: offset },
      },
    })

    await tx.novelPromotionPanel.updateMany({
      where: {
        storyboardId: params.storyboardId,
        panelIndex: { gt: params.panelIndex + offset },
      },
      data: {
        panelIndex: { decrement: offset + 1 },
        panelNumber: { decrement: offset + 1 },
      },
    })

    const panelCount = await tx.novelPromotionPanel.count({
      where: { storyboardId: params.storyboardId },
    })

    await tx.novelPromotionStoryboard.update({
      where: { id: params.storyboardId },
      data: { panelCount },
    })
  })
}

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
  const sourcePanelId = typeof body?.sourcePanelId === 'string' ? body.sourcePanelId.trim() : ''
  const variant = body?.variant

  if (!storyboardId || !insertAfterPanelId || !sourcePanelId) {
    throw new ApiError('INVALID_PARAMS')
  }

  if (!variant || !variant.video_prompt) {
    throw new ApiError('INVALID_PARAMS')
  }

  const storyboard = await prisma.novelPromotionStoryboard.findUnique({
    where: { id: storyboardId },
    select: {
      id: true,
      episode: {
        select: {
          novelPromotionProject: {
            select: {
              projectId: true,
            },
          },
        },
      },
    },
  })
  if (!storyboard || storyboard.episode.novelPromotionProject.projectId !== projectId) {
    throw new ApiError('NOT_FOUND')
  }

  const sourcePanel = await prisma.novelPromotionPanel.findFirst({
    where: {
      id: sourcePanelId,
      storyboardId: storyboard.id,
    },
  })
  if (!sourcePanel) {
    throw new ApiError('INVALID_PARAMS')
  }

  const insertAfter = await prisma.novelPromotionPanel.findFirst({
    where: {
      id: insertAfterPanelId,
      storyboardId: storyboard.id,
    },
  })
  if (!insertAfter) {
    throw new ApiError('INVALID_PARAMS')
  }

  const projectModelConfig = await getProjectModelConfig(projectId, session.user.id)
  const imageModel = projectModelConfig.storyboardModel
  const createdPanelId = createPanelVariantId()

  let billingPayload: Record<string, unknown>
  try {
    billingPayload = await buildImageBillingPayload({
      projectId,
      userId: session.user.id,
      imageModel,
      basePayload: {
        ...body,
        storyboardId: storyboard.id,
        insertAfterPanelId: insertAfter.id,
        sourcePanelId: sourcePanel.id,
        newPanelId: createdPanelId,
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Image model capability not configured'
    throw new ApiError('INVALID_PARAMS', {
      code: 'IMAGE_MODEL_CAPABILITY_NOT_CONFIGURED',
      message,
    })
  }

  const createdPanel = await prisma.$transaction(async (tx) => {
    const affectedPanels = await tx.novelPromotionPanel.findMany({
      where: { storyboardId: storyboard.id, panelIndex: { gt: insertAfter.panelIndex } },
      select: { id: true, panelIndex: true },
      orderBy: { panelIndex: 'asc' },
    })

    for (const panel of affectedPanels) {
      await tx.novelPromotionPanel.update({
        where: { id: panel.id },
        data: { panelIndex: -(panel.panelIndex + 1) },
      })
    }

    for (const panel of affectedPanels) {
      await tx.novelPromotionPanel.update({
        where: { id: panel.id },
        data: { panelIndex: panel.panelIndex + 1 },
      })
    }

    const created = await tx.novelPromotionPanel.create({
      data: {
        id: createdPanelId,
        storyboardId: storyboard.id,
        panelIndex: insertAfter.panelIndex + 1,
        panelNumber: insertAfter.panelIndex + 2,
        shotType: variant.shot_type || sourcePanel.shotType,
        cameraMove: variant.camera_move || sourcePanel.cameraMove,
        description: variant.description || sourcePanel.description,
        videoPrompt: variant.video_prompt || sourcePanel.videoPrompt,
        location: variant.location || sourcePanel.location,
        characters: variant.characters ? JSON.stringify(variant.characters) : sourcePanel.characters,
        srtSegment: sourcePanel.srtSegment,
        duration: sourcePanel.duration,
      },
    })

    const panelCount = await tx.novelPromotionPanel.count({
      where: { storyboardId: storyboard.id },
    })

    await tx.novelPromotionStoryboard.update({
      where: { id: storyboard.id },
      data: { panelCount },
    })

    return created
  })

  let result: Awaited<ReturnType<typeof submitTask>>
  try {
    result = await submitTask({
      userId: session.user.id,
      locale,
      requestId: getRequestId(request),
      projectId,
      type: TASK_TYPE.PANEL_VARIANT,
      targetType: 'NovelPromotionPanel',
      targetId: createdPanel.id,
      payload: billingPayload,
      dedupeKey: `panel_variant:${storyboard.id}:${insertAfter.id}:${sourcePanel.id}`,
      billingInfo: buildDefaultTaskBillingInfo(TASK_TYPE.PANEL_VARIANT, billingPayload),
    })
  } catch (error) {
    await rollbackCreatedVariantPanel({
      panelId: createdPanel.id,
      storyboardId: storyboard.id,
      panelIndex: createdPanel.panelIndex,
    })
    throw error
  }

  return NextResponse.json({ ...result, panelId: createdPanel.id })
})
