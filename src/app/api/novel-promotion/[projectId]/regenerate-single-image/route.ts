import { NextRequest, NextResponse } from 'next/server'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError, getRequestId } from '@/lib/api-errors'
import { submitTask } from '@/lib/task/submitter'
import { resolveRequiredTaskLocale } from '@/lib/task/resolve-locale'
import { TASK_TYPE } from '@/lib/task/types'
import { buildDefaultTaskBillingInfo } from '@/lib/billing'
import { withTaskUiPayload } from '@/lib/task/ui-payload'
import { getProjectModelConfig, buildImageBillingPayload } from '@/lib/config-service'
import {
  hasCharacterAppearanceOutput,
  hasLocationImageOutput
} from '@/lib/task/has-output'
import { prisma } from '@/lib/prisma'

function toNumber(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
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
  const type = typeof body?.type === 'string' ? body.type.trim() : ''
  const id = typeof body?.id === 'string' ? body.id.trim() : ''
  const appearanceId = typeof body?.appearanceId === 'string' ? body.appearanceId.trim() : ''
  const imageIndex = body?.imageIndex

  const parsedImageIndex = toNumber(imageIndex)
  if (!type || !id || parsedImageIndex === null) {
    throw new ApiError('INVALID_PARAMS')
  }

  if (type !== 'character' && type !== 'location') {
    throw new ApiError('INVALID_PARAMS')
  }

  const taskType = type === 'character' ? TASK_TYPE.IMAGE_CHARACTER : TASK_TYPE.IMAGE_LOCATION
  const targetType = type === 'character' ? 'CharacterAppearance' : 'LocationImage'
  let targetId = type === 'character' ? (appearanceId || id) : id
  if (type === 'character') {
    if (appearanceId) {
      const appearance = await prisma.characterAppearance.findFirst({
        where: {
          id: appearanceId,
          characterId: id,
          character: {
            novelPromotionProject: {
              projectId,
            },
          },
        },
        select: { id: true },
      })
      if (!appearance) {
        throw new ApiError('NOT_FOUND')
      }
      targetId = appearance.id
    } else {
      const character = await prisma.novelPromotionCharacter.findFirst({
        where: {
          id,
          novelPromotionProject: {
            projectId,
          },
        },
        select: { id: true },
      })
      if (!character) {
        throw new ApiError('NOT_FOUND')
      }
      targetId = character.id
    }
  } else {
    const image = await prisma.locationImage.findFirst({
      where: {
        locationId: id,
        imageIndex: parsedImageIndex,
        location: {
          novelPromotionProject: {
            projectId,
          },
        },
      },
      select: { id: true },
    })
    if (!image) {
      throw new ApiError('NOT_FOUND')
    }
  }

  const hasOutputAtStart = type === 'character'
    ? await hasCharacterAppearanceOutput({
      appearanceId: appearanceId ? targetId : undefined,
      characterId: id
    })
    : await hasLocationImageOutput({
      locationId: id,
      imageIndex: parsedImageIndex
    })

  const projectModelConfig = await getProjectModelConfig(projectId, session.user.id)
  const imageModel = type === 'character'
    ? projectModelConfig.characterModel
    : projectModelConfig.locationModel
  const basePayload = {
    ...body,
    type,
    id,
    ...(appearanceId ? { appearanceId: targetId } : {}),
    imageIndex: parsedImageIndex,
  }

  let billingPayload: Record<string, unknown>
  try {
    billingPayload = await buildImageBillingPayload({
      projectId,
      userId: session.user.id,
      imageModel,
      basePayload,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Image model capability not configured'
    throw new ApiError('INVALID_PARAMS', { code: 'IMAGE_MODEL_CAPABILITY_NOT_CONFIGURED', message })
  }
  const result = await submitTask({
    userId: session.user.id,
    locale,
    requestId: getRequestId(request),
    projectId,
    type: taskType,
    targetType,
    targetId,
    payload: withTaskUiPayload(billingPayload, {
      intent: 'regenerate',
      hasOutputAtStart
    }),
    dedupeKey: `${taskType}:${targetId}:single:${imageIndex}`,
    billingInfo: buildDefaultTaskBillingInfo(taskType, billingPayload)
  })

  return NextResponse.json(result)
})
