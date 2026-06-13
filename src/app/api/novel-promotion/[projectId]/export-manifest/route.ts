import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'

function safeFileName(value: string) {
  return value.replace(/[\\/:*?"<>|]/g, '_').slice(0, 80) || 'export_manifest'
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
          clips: { orderBy: { createdAt: 'asc' } },
          storyboards: {
            orderBy: { createdAt: 'asc' },
            include: {
              clip: true,
              panels: { orderBy: { panelIndex: 'asc' } },
            },
          },
        },
      })
    : await prisma.novelPromotionEpisode.findMany({
        where: { novelPromotionProject: { projectId } },
        orderBy: { episodeNumber: 'asc' },
        include: {
          editorProject: true,
          clips: { orderBy: { createdAt: 'asc' } },
          storyboards: {
            orderBy: { createdAt: 'asc' },
            include: {
              clip: true,
              panels: { orderBy: { panelIndex: 'asc' } },
            },
          },
        },
      })

  if (episodes.length === 0) {
    throw new ApiError('NOT_FOUND')
  }

  const generatedAt = new Date().toISOString()
  const manifestEpisodes = episodes.map((episode) => {
    const panels = episode.storyboards.flatMap((storyboard) =>
      storyboard.panels.map((panel) => ({
        id: panel.id,
        storyboardId: storyboard.id,
        clipId: storyboard.clipId,
        clipSummary: storyboard.clip.summary,
        panelIndex: panel.panelIndex,
        panelNumber: panel.panelNumber,
        shotType: panel.shotType,
        cameraMove: panel.cameraMove,
        description: panel.description,
        location: panel.location,
        characters: panel.characters,
        props: panel.props,
        duration: panel.duration,
        imagePrompt: panel.imagePrompt,
        imageUrl: panel.imageUrl,
        videoPrompt: panel.videoPrompt,
        videoUrl: panel.videoUrl,
        lipSyncVideoUrl: panel.lipSyncVideoUrl,
        srtSegment: panel.srtSegment,
        srtStart: panel.srtStart,
        srtEnd: panel.srtEnd,
      })),
    )
    const generatedVideoCount = panels.filter((panel) => panel.videoUrl || panel.lipSyncVideoUrl).length
    const imageCount = panels.filter((panel) => panel.imageUrl).length

    return {
      id: episode.id,
      episodeNumber: episode.episodeNumber,
      name: episode.name,
      description: episode.description,
      stats: {
        clips: episode.clips.length,
        storyboards: episode.storyboards.length,
        panels: panels.length,
        images: imageCount,
        videos: generatedVideoCount,
        missingVideos: Math.max(panels.length - generatedVideoCount, 0),
      },
      editorProject: episode.editorProject
        ? {
            id: episode.editorProject.id,
            renderStatus: episode.editorProject.renderStatus,
            outputUrl: episode.editorProject.outputUrl,
            updatedAt: episode.editorProject.updatedAt.toISOString(),
          }
        : null,
      clips: episode.clips.map((clip, index) => ({
        id: clip.id,
        index: index + 1,
        summary: clip.summary,
        content: clip.content,
        screenplay: clip.screenplay,
        location: clip.location,
        characters: clip.characters,
        props: clip.props,
        duration: clip.duration,
        shotCount: clip.shotCount,
      })),
      panels,
    }
  })

  const manifest = {
    schema: 'nori-video.export-manifest.v1',
    generatedAt,
    project: {
      id: project.id,
      name: project.name,
      description: project.description,
    },
    scope: episodeId ? 'episode' : 'project',
    episodes: manifestEpisodes,
  }

  const fileName = safeFileName(
    `${project.name}_${episodes.length === 1 ? episodes[0]?.name || 'episode' : 'project'}_manifest.json`,
  )

  return Response.json(manifest, {
    headers: {
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    },
  })
})
