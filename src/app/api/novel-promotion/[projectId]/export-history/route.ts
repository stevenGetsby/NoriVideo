import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import {
  appendExportHistoryRecord,
  readExportHistory,
  type ExportHistoryRecord,
} from '@/lib/novel-promotion/export-history-store'

function safeName(value: string) {
  return value.replace(/[\\/:*?"<>|]/g, '_').slice(0, 80) || 'export'
}

function latestIso(values: Date[]) {
  const latest = values.reduce<Date | null>((current, value) => (
    !current || value.getTime() > current.getTime() ? value : current
  ), null)
  return (latest || new Date()).toISOString()
}

export const GET = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params
  const episodeId = request.nextUrl.searchParams.get('episodeId')

  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult
  const { project } = authResult

  const episodes = episodeId
    ? await prisma.novelPromotionEpisode.findMany({
        where: {
          id: episodeId,
          novelPromotionProject: { projectId },
        },
        include: {
          editorProject: true,
          storyboards: {
            orderBy: { createdAt: 'asc' },
            include: {
              panels: {
                orderBy: { panelIndex: 'asc' },
                select: {
                  id: true,
                  imageUrl: true,
                  videoUrl: true,
                  lipSyncVideoUrl: true,
                  updatedAt: true,
                },
              },
            },
          },
          clips: { select: { id: true } },
        },
      })
    : await prisma.novelPromotionEpisode.findMany({
        where: { novelPromotionProject: { projectId } },
        orderBy: { episodeNumber: 'asc' },
        include: {
          editorProject: true,
          storyboards: {
            orderBy: { createdAt: 'asc' },
            include: {
              panels: {
                orderBy: { panelIndex: 'asc' },
                select: {
                  id: true,
                  imageUrl: true,
                  videoUrl: true,
                  lipSyncVideoUrl: true,
                  updatedAt: true,
                },
              },
            },
          },
          clips: { select: { id: true } },
        },
      })

  if (episodes.length === 0) {
    throw new ApiError('NOT_FOUND')
  }

  const derivedRecords = episodes.flatMap((episode) => {
    const panels = episode.storyboards.flatMap((storyboard) => storyboard.panels)
    const videoPanels = panels.filter((panel) => panel.videoUrl || panel.lipSyncVideoUrl)
    const imagePanels = panels.filter((panel) => panel.imageUrl)
    const touchedAt = latestIso([
      episode.updatedAt,
      ...panels.map((panel) => panel.updatedAt),
      ...(episode.editorProject ? [episode.editorProject.updatedAt] : []),
    ])
    const baseName = safeName(`${project.name}_${episode.name}`)
    const episodeRecords = []

    if (videoPanels.length > 0) {
      episodeRecords.push({
        id: `server-${episode.id}-final-video`,
        cardId: 'final-video',
        title: 'Final Video',
        fileName: `${baseName}_videos.zip`,
        createdAt: touchedAt,
        status: 'completed',
        source: 'server',
        scope: 'episode',
        stats: {
          clips: episode.clips.length,
          panels: panels.length,
          images: imagePanels.length,
          videos: videoPanels.length,
        },
      })
    }

    if (imagePanels.length > 0) {
      episodeRecords.push({
        id: `server-${episode.id}-asset-package`,
        cardId: 'asset-package',
        title: 'Asset Package',
        fileName: `${baseName}_images.zip`,
        createdAt: touchedAt,
        status: 'completed',
        source: 'server',
        scope: 'episode',
        stats: {
          clips: episode.clips.length,
          panels: panels.length,
          images: imagePanels.length,
          videos: videoPanels.length,
        },
      })
    }

    if (panels.length > 0 || episode.editorProject) {
      episodeRecords.push({
        id: `server-${episode.id}-jianying-draft`,
        cardId: 'jianying-draft',
        title: 'Editing Draft',
        fileName: episode.editorProject?.outputUrl ? `${baseName}_editor_project.json` : `${baseName}_manifest.json`,
        createdAt: touchedAt,
        status: 'completed',
        source: 'server',
        scope: 'episode',
        stats: {
          clips: episode.clips.length,
          panels: panels.length,
          images: imagePanels.length,
          videos: videoPanels.length,
        },
      })
    }

    return episodeRecords
  })

  const persistedRecords = episodeId
    ? await readExportHistory({
        userId: authResult.session.user.id,
        projectId,
        episodeId,
      })
    : []
  const records = new Map<string, unknown>()
  for (const record of derivedRecords) records.set(record.id, record)
  for (const record of persistedRecords) records.set(record.id, record)

  return Response.json({
    records: Array.from(records.values()).sort((a, b) => (
      new Date((b as { createdAt: string }).createdAt).getTime() - new Date((a as { createdAt: string }).createdAt).getTime()
    )),
  })
})

export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params
  const episodeId = request.nextUrl.searchParams.get('episodeId')
  if (!episodeId) {
    throw new ApiError('INVALID_PARAMS', { message: 'episodeId is required' })
  }

  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const body = await request.json().catch(() => ({})) as Partial<ExportHistoryRecord>
  if (!body.cardId || !body.title || !body.fileName) {
    throw new ApiError('INVALID_PARAMS')
  }

  const record: ExportHistoryRecord = {
    id: body.id || `${Date.now()}-${body.cardId}`,
    cardId: body.cardId,
    title: body.title,
    fileName: body.fileName,
    createdAt: body.createdAt || new Date().toISOString(),
    status: 'completed',
    source: 'persistent',
    ...(body.stats ? { stats: body.stats } : {}),
  }

  const records = await appendExportHistoryRecord({
    userId: authResult.session.user.id,
    projectId,
    episodeId,
    record,
  })

  return Response.json({
    success: true,
    record,
    records,
  })
})
