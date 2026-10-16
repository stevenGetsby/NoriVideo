import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { requireCanvasInProject } from '@/lib/canvas/access'
import { recordCanvasSnapshotInTransaction } from '@/lib/canvas/persistence'
import { canvasProductionEdgeId, canvasProductionNodeId } from '@/lib/canvas/production-ids'
import { removeDeletedCanvasGroupMembers } from '@/lib/canvas/group-membership'
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

function parseSyncInput(value: unknown): { expectedRevision: number; clientId: string } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const source = value as Record<string, unknown>
  const expectedRevision = source.expectedRevision
  const clientId = typeof source.clientId === 'string' ? source.clientId.trim() : ''
  if (!Number.isSafeInteger(expectedRevision) || (expectedRevision as number) < 0) return null
  if (!clientId || clientId.length > 120) return null
  return { expectedRevision: expectedRevision as number, clientId }
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

    const episodeNodeId = canvasProductionNodeId(canvasId, 'episode', episodeId)
    nodes.push({
      id: episodeNodeId,
      type: 'production_episode',
      position: { x: 0, y: episodeY },
      size: { width: 300, height: 180 },
      data: {
        sourceType: 'episode',
        sourceId: episodeId,
        title: typeof episode.name === 'string' ? episode.name : `第 ${episodeIndex + 1} 集`,
        subtitle: `第 ${episode.episodeNumber || episodeIndex + 1} 集`,
        description: compactText(episode.description || episode.novelText, 220),
        episodeNumber: episode.episodeNumber,
        statusLabel: '剧集',
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
      const storyboardNodeId = canvasProductionNodeId(canvasId, 'storyboard', storyboardId)

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
          statusLabel: '分镜组',
          stats: {
            面板: storyboardPanels.length,
            视频: storyboardPanels.filter((panel) => typeof panel.videoUrl === 'string' && panel.videoUrl).length,
          },
        },
      })
      edges.push({
        id: canvasProductionEdgeId(canvasId, episodeNodeId, storyboardNodeId),
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
        const panelNodeId = canvasProductionNodeId(canvasId, 'panel', panelId)
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
          id: canvasProductionEdgeId(canvasId, storyboardNodeId, panelNodeId),
          sourceNodeId: storyboardNodeId,
          targetNodeId: panelNodeId,
          role: 'PRODUCTION_FLOW',
        })

        if (videoUrl) {
          const videoNodeId = canvasProductionNodeId(canvasId, 'video', panelId)
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
              statusLabel: '视频',
            },
            mediaObjectId: typeof panel.videoMediaId === 'string' ? panel.videoMediaId : null,
          })
          edges.push({
            id: canvasProductionEdgeId(canvasId, panelNodeId, videoNodeId),
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
  request: NextRequest,
  context: { params: Promise<{ projectId: string; canvasId: string }> }
) => {
  const { projectId, canvasId } = await context.params
  const authResult = await requireProjectAuthLight(projectId, ['canvasWrite'])
  if (isErrorResponse(authResult)) return authResult

  const current = await requireCanvasInProject(canvasId, projectId)
  const input = parseSyncInput(await request.json().catch(() => null))
  if (!input) throw new ApiError('INVALID_PARAMS', { message: '同步请求缺少有效的画布版本。' })
  if (current.revision !== input.expectedRevision) {
    throw new ApiError('CONFLICT', {
      message: '画布已在另一个标签页中更新，请加载服务端版本后重试同步。',
      expectedRevision: input.expectedRevision,
      actualRevision: current.revision,
    })
  }

  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      userId: authResult.session.user.id,
      deletedAt: null,
    },
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
  if (!project) {
    throw new ApiError('NOT_FOUND')
  }

  const withMedia = await attachMediaFieldsToProject(project)
  const { nodes, edges } = buildProductionGraph(canvasId, withMedia as {
    novelPromotionData?: { episodes?: Array<Record<string, unknown>> } | null
  })
  const nodeIds = nodes.map((node) => node.id)
  const nextRevision = input.expectedRevision + 1

  const graph = await prisma.$transaction(async (tx) => {
    const claimed = await tx.canvas.updateMany({
      where: { id: canvasId, projectId, revision: input.expectedRevision },
      data: { revision: { increment: 1 } },
    })
    if (claimed.count !== 1) {
      throw new ApiError('CONFLICT', {
        message: '画布已在另一个标签页中更新，请加载服务端版本后重试同步。',
        expectedRevision: input.expectedRevision,
      })
    }

    const staleNodes = await tx.canvasNode.findMany({
      where: {
        canvasId,
        type: { in: [...PRODUCTION_NODE_TYPES] },
        id: { notIn: nodeIds.length > 0 ? nodeIds : [''] },
      },
      select: { id: true },
    })
    const staleNodeIds = staleNodes.map((node) => node.id)

    if (staleNodeIds.length > 0) {
      const deletedNodeIds = new Set(staleNodeIds)
      const groups = await tx.canvasNode.findMany({
        where: { canvasId, type: 'group' },
        select: { id: true, data: true },
      })
      for (const group of groups) {
        const data = removeDeletedCanvasGroupMembers(group.data, deletedNodeIds)
        if (!data) continue
        await tx.canvasNode.update({
          where: { id: group.id },
          data: { data: data as Prisma.InputJsonValue },
        })
      }
    }

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

    const [canvas, syncedNodes, syncedEdges] = await Promise.all([
      tx.canvas.findUniqueOrThrow({
        where: { id: canvasId },
        select: {
          id: true,
          projectId: true,
          title: true,
          themeColor: true,
          viewport: true,
          visibility: true,
          forkedFromId: true,
          revision: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      tx.canvasNode.findMany({
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
      tx.canvasEdge.findMany({
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

    await recordCanvasSnapshotInTransaction(tx, {
      canvasId,
      revision: nextRevision,
      userId: authResult.session.user.actorId || authResult.session.user.id,
      clientId: input.clientId,
      changeSummary: '同步作品内容',
      document: {
        viewport: canvas.viewport || { x: 0, y: 0, zoom: 1 },
        nodes: syncedNodes,
        edges: syncedEdges,
      } as unknown as Prisma.InputJsonValue,
    })

    return { canvas, nodes: syncedNodes, edges: syncedEdges }
  })

  if (graph.canvas.revision !== nextRevision) {
    throw new ApiError('CONFLICT', {
      message: '同步后的画布版本异常，请重新加载画布。',
      expectedRevision: nextRevision,
      actualRevision: graph.canvas.revision,
    })
  }

  return NextResponse.json(graph)
})
