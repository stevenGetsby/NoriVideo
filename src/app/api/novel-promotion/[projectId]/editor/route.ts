import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import {
  normalizeRoughCutProject,
  parseRoughCutProject,
  roughCutDimensionsForRatio,
  type RoughCutSourcePanel,
} from '@/lib/novel-promotion/rough-cut'

async function readEpisode(projectId: string, episodeId: string) {
  return await prisma.novelPromotionEpisode.findFirst({
    where: {
      id: episodeId,
      novelPromotionProject: { projectId },
    },
    select: {
      id: true,
      novelPromotionProject: { select: { videoRatio: true } },
      editorProject: true,
      storyboards: {
        select: {
          id: true,
          createdAt: true,
          clip: { select: { start: true } },
          panels: {
            orderBy: { panelIndex: 'asc' },
            select: {
              id: true,
              panelIndex: true,
              panelNumber: true,
              shotType: true,
              cameraMove: true,
              description: true,
              location: true,
              characters: true,
              props: true,
              srtSegment: true,
              duration: true,
              imageUrl: true,
              videoPrompt: true,
              videoUrl: true,
              videoMedia: { select: { durationMs: true } },
              lipSyncVideoUrl: true,
              lipSyncVideoMedia: { select: { durationMs: true } },
            },
          },
        },
      },
    },
  })
}

function readNames(value: string | null | undefined): string[] {
  if (!value?.trim()) return []
  try {
    const parsed = JSON.parse(value) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.map((item) => {
      if (typeof item === 'string') return item.trim()
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        const name = (item as Record<string, unknown>).name
        return typeof name === 'string' ? name.trim() : ''
      }
      return ''
    }).filter(Boolean)
  } catch {
    return []
  }
}

function buildSources(episode: NonNullable<Awaited<ReturnType<typeof readEpisode>>>): RoughCutSourcePanel[] {
  const storyboards = [...episode.storyboards].sort((left, right) => (
    (left.clip?.start ?? Number.MAX_SAFE_INTEGER) - (right.clip?.start ?? Number.MAX_SAFE_INTEGER)
    || left.createdAt.getTime() - right.createdAt.getTime()
    || left.id.localeCompare(right.id)
  ))
  return storyboards.flatMap((storyboard, sceneIndex) => (
    storyboard.panels.flatMap((panel) => {
      const lipSyncUrl = panel.lipSyncVideoUrl?.trim() || ''
      const videoUrl = lipSyncUrl || panel.videoUrl?.trim() || ''
      if (!videoUrl) return []
      const mediaDurationMs = lipSyncUrl
        ? panel.lipSyncVideoMedia?.durationMs
        : panel.videoMedia?.durationMs
      const durationMs = typeof mediaDurationMs === 'number' && mediaDurationMs > 0
        ? Math.round(mediaDurationMs)
        : typeof panel.duration === 'number' && panel.duration > 0
          ? Math.round(panel.duration * 1_000)
          : 5_000
      const segmentNumber = panel.panelNumber ?? panel.panelIndex + 1
      return [{
        panelId: panel.id,
        storyboardId: storyboard.id,
        sceneLabel: `S${String(sceneIndex + 1).padStart(2, '0')}`,
        segmentLabel: `Segment ${String(segmentNumber).padStart(2, '0')}`,
        description: panel.description?.trim() || null,
        imageUrl: panel.imageUrl?.trim() || null,
        videoUrl,
        durationMs,
        sourceText: panel.srtSegment?.trim() || null,
        videoPrompt: panel.videoPrompt?.trim() || null,
        location: panel.location?.trim() || null,
        shotType: panel.shotType?.trim() || null,
        cameraMove: panel.cameraMove?.trim() || null,
        characters: readNames(panel.characters),
        props: readNames(panel.props),
      }]
    })
  ))
}

export const GET = apiHandler(async (
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await params
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const episodeId = request.nextUrl.searchParams.get('episodeId')?.trim()
  if (!episodeId) throw new ApiError('INVALID_PARAMS', { message: '缺少 episodeId。' })

  const episode = await readEpisode(projectId, episodeId)
  if (!episode) throw new ApiError('NOT_FOUND')
  const sourcePanels = buildSources(episode)
  const editorProject = episode.editorProject
  const projectData = parseRoughCutProject(editorProject?.projectData, episodeId, sourcePanels)
  const videoRatio = episode.novelPromotionProject?.videoRatio || '9:16'
  const dimensions = roughCutDimensionsForRatio(videoRatio)
  if (projectData) projectData.config = { ...projectData.config, ...dimensions }

  return NextResponse.json({
    id: editorProject?.id || null,
    episodeId,
    projectData,
    sourcePanels,
    videoRatio,
    renderStatus: editorProject?.renderStatus || null,
    outputUrl: editorProject?.outputUrl || null,
    updatedAt: editorProject?.updatedAt || null,
  })
})

export const PUT = apiHandler(async (
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await params
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const body = await request.json() as { episodeId?: unknown; projectData?: unknown }
  const episodeId = typeof body.episodeId === 'string' ? body.episodeId.trim() : ''
  if (!episodeId || !body.projectData) throw new ApiError('INVALID_PARAMS')

  const episode = await readEpisode(projectId, episodeId)
  if (!episode) throw new ApiError('NOT_FOUND')
  const sourcePanels = buildSources(episode)
  const projectData = normalizeRoughCutProject(body.projectData, episodeId, sourcePanels)
  if (!projectData) {
    throw new ApiError('INVALID_PARAMS', { message: '粗剪工程格式无效，请刷新后重试。' })
  }
  projectData.config = {
    ...projectData.config,
    ...roughCutDimensionsForRatio(episode.novelPromotionProject?.videoRatio || '9:16'),
  }

  const editorProject = await prisma.videoEditorProject.upsert({
    where: { episodeId },
    create: {
      episodeId,
      projectData: JSON.stringify(projectData),
    },
    update: {
      projectData: JSON.stringify(projectData),
      renderStatus: null,
      renderTaskId: null,
      outputUrl: null,
      updatedAt: new Date(),
    },
  })

  return NextResponse.json({
    success: true,
    id: editorProject.id,
    projectData,
    updatedAt: editorProject.updatedAt,
  })
})

export const DELETE = apiHandler(async (
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await params
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const episodeId = request.nextUrl.searchParams.get('episodeId')?.trim()
  if (!episodeId) throw new ApiError('INVALID_PARAMS')
  const editorProject = await prisma.videoEditorProject.findFirst({
    where: {
      episodeId,
      episode: { novelPromotionProject: { projectId } },
    },
    select: { id: true },
  })
  if (!editorProject) throw new ApiError('NOT_FOUND')
  await prisma.videoEditorProject.delete({ where: { id: editorProject.id } })
  return NextResponse.json({ success: true })
})
