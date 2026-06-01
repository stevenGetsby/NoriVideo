import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { apiHandler } from '@/lib/api-errors'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { requireCanvasInProject } from '@/lib/canvas/access'
import { attachMediaFieldsToProject } from '@/lib/media/attach'

const PRODUCTION_NODE_TYPES = [
  'production_episode',
  'production_storyboard',
  'production_panel',
  'production_video',
] as const

type ProductionNodeType = (typeof PRODUCTION_NODE_TYPES)[number]

type NodeDraft = {
  id: string
  type: ProductionNodeType
  position: { x: number; y: number }
  size: { width: number; height: number }
  data: Record<string, unknown>
  mediaObjectId?: string | null
}

type EdgeDraft = {
  id: string
  sourceNodeId: string
  targetNodeId: string
  role: string
}

function compactText(value: unknown, max = 180): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (!normalized) return null
  return normalized.length > max ? `${normalized.slice(0, max - 1)}...` : normalized
}

function asArray<T>(value: T[] | null | undefined): T[] {
  return Array.isArray(value) ? value : []
}

function statusLabel(panel: Record<string, unknown>): string {
  if (typeof panel.videoUrl === 'string' && panel.videoUrl) return '已生视频'
  if (typeof panel.imageUrl === 'string' && panel.imageUrl) return '已生图'
  return '待生成'
}

function buildProductionGraph(canvasId: string, project: {
  novelPromotionData?: {
    episodes?: Array<Record<string, unknown>>
  } | null
}): { nodes: NodeDraft[]; edges: EdgeDraft[] } {
  void canvasId
  const nodes: NodeDraft[] = []
  const edges: EdgeDraft[] = []
  const episodes = asArray(project.novelPromotionData?.episodes)

  episodes.forEach((episode, episodeIndex) => {
    const episodeId = String(episode.id || '')
    if (!episodeId) return

    const episodeY = episodeIndex * 920
    const storyboards = asArray(episode.storyboards as Array<Record<string, unknown>> | undefined)
    const panels = storyboards.flatMap((storyboard) => asArray(storyboard.panels as Array<Record<string, unknown>> | undefined))
    const videoCount = panels.filter((panel) => typeof panel.videoUrl === 'string' && panel.videoUrl).length
    const imageCount = panels.filter((panel) => typeof panel.imageUrl === 'string' && panel.imageUrl).length

    const episodeNodeId = `prod_episode_${episodeId}`
    nodes.push({
      id: episodeNodeId,
      type: 'production_episode',
      position: { x: 0, y: episodeY },
      size: { width: 300, height: 180 },
      data: {
        sourceType: 'episode',
        sourceId: episodeId,
        title: typeof episode.name === 'string' ? episode.name : `Episode ${episodeIndex + 1}`,
        subtitle: `第 ${episode.episodeNumber || episodeIndex + 1} 集`,
        description: compactText(episode.description || episode.novelText, 220),
        episodeNumber: episode.episodeNumber,
        statusLabel: 'Episode',
        stats: {
          分镜组: storyboards.length,
          面板: panels.length,
          图片: imageCount,
          视频: videoCount,
        },
      },
    })

    storyboards.forEach((storyboard, storyboardIndex) => {
      const storyboardId = String(storyboard.id || '')
      if (!storyboardId) return

      const clip = storyboard.clip && typeof storyboard.clip === 'object'
        ? storyboard.clip as Record<string, unknown>
        : {}
      const storyboardPanels = asArray(storyboard.panels as Array<Record<string, unknown>> | undefined)
      const rowY = episodeY + storyboardIndex * 330
      const storyboardNodeId = `prod_storyboard_${storyboardId}`

      nodes.push({
        id: storyboardNodeId,
        type: 'production_storyboard',
        position: { x: 360, y: rowY },
        size: { width: 300, height: 180 },
        data: {
          sourceType: 'storyboard',
          sourceId: storyboardId,
          title: typeof clip.summary === 'string' ? clip.summary : `分镜组 ${storyboardIndex + 1}`,
          subtitle: `面板 ${storyboardPanels.length}`,
          description: compactText(clip.content || storyboard.storyboardTextJson, 220),
          imageUrl: typeof storyboard.storyboardImageUrl === 'string' ? storyboard.storyboardImageUrl : null,
          statusLabel: 'Storyboard',
          stats: {
            面板: storyboardPanels.length,
            视频: storyboardPanels.filter((panel) => typeof panel.videoUrl === 'string' && panel.videoUrl).length,
          },
        },
      })
      edges.push({
        id: `prod_edge_${episodeNodeId}_${storyboardNodeId}`,
        sourceNodeId: episodeNodeId,
        targetNodeId: storyboardNodeId,
        role: 'PRODUCTION_FLOW',
      })

      storyboardPanels.forEach((panel, panelIndex) => {
        const panelId = String(panel.id || '')
        if (!panelId) return

        const column = panelIndex % 4
        const band = Math.floor(panelIndex / 4)
        const panelX = 720 + column * 300
        const panelY = rowY + band * 300
        const panelNodeId = `prod_panel_${panelId}`
        const imageUrl = typeof panel.imageUrl === 'string' ? panel.imageUrl : null
        const videoUrl = typeof panel.videoUrl === 'string' ? panel.videoUrl : null

        nodes.push({
          id: panelNodeId,
          type: 'production_panel',
          position: { x: panelX, y: panelY },
          size: { width: 260, height: 270 },
          data: {
            sourceType: 'panel',
            sourceId: panelId,
            title: `镜头 ${Number(panel.panelIndex ?? panelIndex) + 1}`,
            subtitle: compactText(panel.shotType || panel.cameraMove || panel.location, 64),
            description: compactText(panel.description || panel.srtSegment, 220),
            imageUrl,
            prompt: compactText(panel.imagePrompt, 220),
            panelIndex: panel.panelIndex,
            hasImage: Boolean(imageUrl),
            hasVideo: Boolean(videoUrl),
            statusLabel: statusLabel(panel),
          },
          mediaObjectId: typeof panel.imageMediaId === 'string' ? panel.imageMediaId : null,
        })
        edges.push({
          id: `prod_edge_${storyboardNodeId}_${panelNodeId}`,
          sourceNodeId: storyboardNodeId,
          targetNodeId: panelNodeId,
          role: 'PRODUCTION_FLOW',
        })

        if (videoUrl) {
          const videoNodeId = `prod_video_${panelId}`
          nodes.push({
            id: videoNodeId,
            type: 'production_video',
            position: { x: panelX, y: panelY + 300 },
            size: { width: 260, height: 240 },
            data: {
              sourceType: 'video',
              sourceId: panelId,
              title: `视频 ${Number(panel.panelIndex ?? panelIndex) + 1}`,
              subtitle: typeof panel.videoGenerationMode === 'string' ? panel.videoGenerationMode : 'normal',
              description: compactText(panel.videoPrompt || panel.firstLastFramePrompt, 180),
              imageUrl,
              videoUrl,
              prompt: compactText(panel.videoPrompt || panel.firstLastFramePrompt, 220),
              panelIndex: panel.panelIndex,
              hasImage: Boolean(imageUrl),
              hasVideo: true,
              statusLabel: 'Video',
            },
            mediaObjectId: typeof panel.videoMediaId === 'string' ? panel.videoMediaId : null,
          })
          edges.push({
            id: `prod_edge_${panelNodeId}_${videoNodeId}`,
            sourceNodeId: panelNodeId,
            targetNodeId: videoNodeId,
            role: 'PRODUCTION_FLOW',
          })
        }
      })
    })
  })

  return { nodes, edges }
}

export const POST = apiHandler(async (
  _request: NextRequest,
  context: { params: Promise<{ projectId: string; canvasId: string }> }
) => {
  const { projectId, canvasId } = await context.params
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  await requireCanvasInProject(canvasId, projectId)

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      novelPromotionData: {
        include: {
          episodes: {
            orderBy: { episodeNumber: 'asc' },
            include: {
              storyboards: {
                orderBy: { createdAt: 'asc' },
                include: {
                  clip: true,
                  panels: { orderBy: { panelIndex: 'asc' } },
                },
              },
            },
          },
        },
      },
    },
  })

  const withMedia = await attachMediaFieldsToProject(project || {})
  const { nodes, edges } = buildProductionGraph(canvasId, withMedia as {
    novelPromotionData?: { episodes?: Array<Record<string, unknown>> } | null
  })
  const nodeIds = nodes.map((node) => node.id)

  const staleNodes = await prisma.canvasNode.findMany({
    where: {
      canvasId,
      type: { in: [...PRODUCTION_NODE_TYPES] },
      id: { notIn: nodeIds.length > 0 ? nodeIds : [''] },
    },
    select: { id: true },
  })
  const staleNodeIds = staleNodes.map((node) => node.id)

  await prisma.$transaction(async (tx) => {
    await tx.canvasEdge.deleteMany({
      where: {
        canvasId,
        OR: [
          { role: 'PRODUCTION_FLOW' },
          ...(staleNodeIds.length > 0
            ? [
                { sourceNodeId: { in: staleNodeIds } },
                { targetNodeId: { in: staleNodeIds } },
              ]
            : []),
        ],
      },
    })

    if (staleNodeIds.length > 0) {
      await tx.canvasNode.deleteMany({
        where: { canvasId, id: { in: staleNodeIds } },
      })
    }

    for (const node of nodes) {
      await tx.canvasNode.upsert({
        where: { id: node.id },
        create: {
          id: node.id,
          canvasId,
          type: node.type,
          position: node.position as unknown as Prisma.InputJsonValue,
          size: node.size as unknown as Prisma.InputJsonValue,
          data: node.data as Prisma.InputJsonValue,
          status: 'IDLE',
          mediaObjectId: node.mediaObjectId ?? null,
        },
        update: {
          type: node.type,
          data: node.data as Prisma.InputJsonValue,
          size: node.size as unknown as Prisma.InputJsonValue,
          mediaObjectId: node.mediaObjectId ?? null,
        },
      })
    }

    for (const edge of edges) {
      await tx.canvasEdge.upsert({
        where: { id: edge.id },
        create: {
          id: edge.id,
          canvasId,
          sourceNodeId: edge.sourceNodeId,
          targetNodeId: edge.targetNodeId,
          role: edge.role,
        },
        update: {
          sourceNodeId: edge.sourceNodeId,
          targetNodeId: edge.targetNodeId,
          role: edge.role,
        },
      })
    }

    await tx.canvas.update({
      where: { id: canvasId },
      data: { updatedAt: new Date() },
    })
  })

  const [canvas, syncedNodes, syncedEdges] = await Promise.all([
    prisma.canvas.findUnique({
      where: { id: canvasId },
      select: {
        id: true,
        projectId: true,
        title: true,
        themeColor: true,
        viewport: true,
        visibility: true,
        forkedFromId: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.canvasNode.findMany({
      where: { canvasId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        canvasId: true,
        type: true,
        position: true,
        size: true,
        data: true,
        status: true,
        taskId: true,
        runId: true,
        mediaObjectId: true,
        parentNodeId: true,
      },
    }),
    prisma.canvasEdge.findMany({
      where: { canvasId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        canvasId: true,
        sourceNodeId: true,
        targetNodeId: true,
        sourceHandle: true,
        targetHandle: true,
        role: true,
      },
    }),
  ])

  return NextResponse.json({ canvas, nodes: syncedNodes, edges: syncedEdges })
})
