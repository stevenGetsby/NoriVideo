import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { buildTimelineSummary } from '@/lib/novel-promotion/timeline-summary'

type TimelineUpdatePayload = {
  panelId?: unknown
  duration?: unknown
  shotType?: unknown
  cameraMove?: unknown
}

type TimelineReorderPayload = {
  panelId?: unknown
  direction?: unknown
}

function parseNullableDuration(value: unknown): number | null | undefined {
  if (value === undefined) return undefined
  if (value === null || value === '') return null
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new ApiError('INVALID_PARAMS', { message: 'duration must be a non-negative number or null' })
  }
  return parsed
}

function parseNullableText(value: unknown): string | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  if (typeof value !== 'string') {
    throw new ApiError('INVALID_PARAMS')
  }
  return value
}

function readPanelId(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ApiError('INVALID_PARAMS')
  }
  return value.trim()
}

function normalizeUpdates(value: unknown) {
  if (value === undefined) return []
  if (!Array.isArray(value)) {
    throw new ApiError('INVALID_PARAMS')
  }
  return value.map((item) => {
    const payload = item as TimelineUpdatePayload
    const data: {
      duration?: number | null
      shotType?: string | null
      cameraMove?: string | null
    } = {}
    const duration = parseNullableDuration(payload.duration)
    const shotType = parseNullableText(payload.shotType)
    const cameraMove = parseNullableText(payload.cameraMove)
    if (duration !== undefined) data.duration = duration
    if (shotType !== undefined) data.shotType = shotType
    if (cameraMove !== undefined) data.cameraMove = cameraMove
    return {
      panelId: readPanelId(payload.panelId),
      data,
    }
  }).filter((update) => Object.keys(update.data).length > 0)
}

function normalizeReorder(value: unknown): { panelId: string; direction: 'up' | 'down' } | null {
  if (value === undefined || value === null) return null
  const payload = value as TimelineReorderPayload
  const direction = payload.direction
  if (direction !== 'up' && direction !== 'down') {
    throw new ApiError('INVALID_PARAMS')
  }
  return {
    panelId: readPanelId(payload.panelId),
    direction,
  }
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values))
}

async function readTimelineEpisodes(projectId: string, episodeId: string | null) {
  return await prisma.novelPromotionEpisode.findMany({
    where: episodeId
      ? {
          id: episodeId,
          novelPromotionProject: { projectId },
        }
      : { novelPromotionProject: { projectId } },
    orderBy: { episodeNumber: 'asc' },
    select: {
      id: true,
      episodeNumber: true,
      name: true,
      description: true,
      storyboards: {
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          clipId: true,
          panelCount: true,
          clip: {
            select: {
              id: true,
              summary: true,
              start: true,
              end: true,
              duration: true,
              shotCount: true,
            },
          },
          panels: {
            orderBy: { panelIndex: 'asc' },
            select: {
              id: true,
              storyboardId: true,
              panelIndex: true,
              panelNumber: true,
              shotType: true,
              cameraMove: true,
              description: true,
              location: true,
              characters: true,
              props: true,
              duration: true,
              imagePrompt: true,
              imageUrl: true,
              videoPrompt: true,
              videoUrl: true,
              lipSyncVideoUrl: true,
              srtSegment: true,
              srtStart: true,
              srtEnd: true,
            },
          },
        },
      },
    },
  })
}

function buildTimelinePanelWhere(projectId: string, episodeId: string | null) {
  return {
    storyboard: {
      episode: {
        ...(episodeId ? { id: episodeId } : {}),
        novelPromotionProject: { projectId },
      },
    },
  }
}

export const GET = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params
  const episodeId = request.nextUrl.searchParams.get('episodeId')

  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const episodes = await readTimelineEpisodes(projectId, episodeId)

  if (episodeId && episodes.length === 0) {
    throw new ApiError('NOT_FOUND')
  }

  return NextResponse.json(buildTimelineSummary({
    projectId,
    scope: episodeId ? 'episode' : 'project',
    episodes,
  }))
})

export const PATCH = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const body = await request.json() as {
    episodeId?: unknown
    updates?: unknown
    reorder?: unknown
  }
  const episodeId = typeof body.episodeId === 'string' && body.episodeId.trim()
    ? body.episodeId.trim()
    : null
  const updates = normalizeUpdates(body.updates)
  const reorder = normalizeReorder(body.reorder)

  if (updates.length === 0 && !reorder) {
    throw new ApiError('INVALID_PARAMS', { message: 'timeline updates or reorder are required' })
  }

  const panelIds = uniqueStrings([
    ...updates.map((update) => update.panelId),
    ...(reorder ? [reorder.panelId] : []),
  ])
  const ownedPanels = await prisma.novelPromotionPanel.findMany({
    where: {
      id: { in: panelIds },
      ...buildTimelinePanelWhere(projectId, episodeId),
    },
    select: {
      id: true,
      storyboardId: true,
      panelIndex: true,
    },
  })
  if (ownedPanels.length !== panelIds.length) {
    throw new ApiError('NOT_FOUND')
  }
  const ownedPanelMap = new Map(ownedPanels.map((panel) => [panel.id, panel]))

  await prisma.$transaction(async (tx) => {
    for (const update of updates) {
      await tx.novelPromotionPanel.update({
        where: { id: update.panelId },
        data: update.data,
      })
    }

    if (!reorder) return
    const panel = ownedPanelMap.get(reorder.panelId)
    if (!panel) {
      throw new ApiError('NOT_FOUND')
    }
    const sibling = await tx.novelPromotionPanel.findFirst({
      where: {
        storyboardId: panel.storyboardId,
        panelIndex: reorder.direction === 'up'
          ? { lt: panel.panelIndex }
          : { gt: panel.panelIndex },
      },
      orderBy: {
        panelIndex: reorder.direction === 'up' ? 'desc' : 'asc',
      },
    })
    if (!sibling) return

    const tempIndex = Math.max(panel.panelIndex, sibling.panelIndex) + 10000
    await tx.novelPromotionPanel.update({
      where: { id: panel.id },
      data: {
        panelIndex: tempIndex,
        panelNumber: tempIndex + 1,
      },
    })
    await tx.novelPromotionPanel.update({
      where: { id: sibling.id },
      data: {
        panelIndex: panel.panelIndex,
        panelNumber: panel.panelIndex + 1,
      },
    })
    await tx.novelPromotionPanel.update({
      where: { id: panel.id },
      data: {
        panelIndex: sibling.panelIndex,
        panelNumber: sibling.panelIndex + 1,
      },
    })
  }, {
    maxWait: 15000,
    timeout: 30000,
  })

  const episodes = await readTimelineEpisodes(projectId, episodeId)
  return NextResponse.json(buildTimelineSummary({
    projectId,
    scope: episodeId ? 'episode' : 'project',
    episodes,
  }))
})
