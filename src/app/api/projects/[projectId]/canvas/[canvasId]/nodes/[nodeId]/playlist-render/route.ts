import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError, getRequestId } from '@/lib/api-errors'
import { isErrorResponse, requireProjectAuthLight } from '@/lib/api-auth'
import { requireCanvasInProject } from '@/lib/canvas/access'
import {
  canvasPlaylistFingerprint,
  normalizeCanvasPlaylistItems,
  resolveCanvasPlaylistTimeline,
} from '@/lib/canvas/playlist'
import {
  parseCanvasPlaylistRenderTaskPayload,
  serializeCanvasPlaylistRenderTask,
  type CanvasPlaylistRenderTaskPayload,
} from '@/lib/canvas/playlist-render-task'
import { getWorkspaceActor } from '@/lib/collaboration/access'
import { prisma } from '@/lib/prisma'
import { extractStorageKey } from '@/lib/storage'
import { resolveRequiredTaskLocale } from '@/lib/task/resolve-locale'
import { submitTask } from '@/lib/task/submitter'
import { TASK_STATUS, TASK_TYPE } from '@/lib/task/types'
import type { CanvasNodeData, CanvasPlaylistItem } from '@/features/canvas/types'

async function buildManifest(projectId: string, canvasId: string, nodeId: string, actorIds: string[]) {
  const [node, project] = await Promise.all([
    prisma.canvasNode.findFirst({
      where: { id: nodeId, canvasId, type: 'playlist' },
      select: { id: true, data: true },
    }),
    prisma.project.findUnique({ where: { id: projectId }, select: { name: true } }),
  ])
  if (!node || !project) throw new ApiError('NOT_FOUND', { message: '播放列表节点不存在。' })
  const nodeData = (node.data || {}) as CanvasNodeData
  const items = normalizeCanvasPlaylistItems(nodeData.playlistItems)
  const sourceNodeIds = Array.from(new Set(items.map((item) => item.sourceNodeId).filter((value): value is string => Boolean(value))))
  const sourceNodes = sourceNodeIds.length ? await prisma.canvasNode.findMany({
    where: { canvasId, id: { in: sourceNodeIds } },
    select: { id: true, type: true, data: true },
  }) : []
  const sourceById = new Map(sourceNodes.map((source) => [source.id, (source.data || {}) as CanvasNodeData]))
  const materialIds = Array.from(new Set(items.flatMap((item) => {
    const sourceData = item.sourceNodeId ? sourceById.get(item.sourceNodeId) : null
    return [sourceData?.materialId, item.materialId].filter((value): value is string => Boolean(value))
  })))
  const materials = materialIds.length ? await prisma.frameosMaterial.findMany({
    where: {
      id: { in: materialIds }, userId: { in: actorIds }, type: 'video', status: 'ready', deletedAt: null,
      projectId: { in: [projectId, 'global', 'global-asset-hub'] },
    },
    select: { id: true, storageKey: true, resultUrl: true },
  }) : []
  const materialById = new Map(materials.map((material) => [material.id, material]))
  const submission = resolveCanvasPlaylistTimeline({
    projectName: project.name,
    canvasId,
    nodeId,
    title: nodeData.title || '播放列表',
    items,
    sourceNodes: sourceNodes.map((source) => ({ id: source.id, type: source.type, data: (source.data || {}) as CanvasNodeData })),
    requireReady: true,
  })
  const itemById = new Map<string, CanvasPlaylistItem>(items.map((item) => [item.id, item]))
  const segments = submission.snapshot.segments.map((segment) => {
    const item = itemById.get(segment.clipId)
    const sourceData = item?.sourceNodeId ? sourceById.get(item.sourceNodeId) : null
    const materialId = sourceData?.materialId || item?.materialId || null
    const material = materialId ? materialById.get(materialId) : null
    const storageKey = material?.storageKey
      || extractStorageKey(material?.resultUrl)
      || extractStorageKey(sourceData?.contentUrl || sourceData?.videoUrl)
      || extractStorageKey(item?.videoUrl)
    if (!storageKey) throw new ApiError('CONFLICT', { message: `“${item?.title || segment.label}”尚未保存到项目素材库，无法渲染成片。` })
    return {
      clipId: segment.clipId,
      title: item?.title || segment.label,
      storageKey,
      trimStartMs: segment.trimStartMs,
      trimEndMs: segment.trimEndMs,
    }
  })
  return {
    fingerprint: canvasPlaylistFingerprint(items),
    title: nodeData.title || '播放列表',
    durationMs: submission.snapshot.durationMs,
    segments,
  }
}

async function latestRenderTask(projectId: string, nodeId: string, fingerprint: string) {
  const tasks = await prisma.task.findMany({
    where: { projectId, targetType: 'CanvasNode', targetId: nodeId, type: TASK_TYPE.CANVAS_VIDEO_OPERATION },
    orderBy: { createdAt: 'desc' },
    take: 30,
  })
  return tasks.find((task) => parseCanvasPlaylistRenderTaskPayload(task.payload)?.fingerprint === fingerprint) || null
}

export const GET = apiHandler(async (
  _request: NextRequest,
  context: { params: Promise<{ projectId: string; canvasId: string; nodeId: string }> },
) => {
  const { projectId, canvasId, nodeId } = await context.params
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult
  await requireCanvasInProject(canvasId, projectId)
  const actor = getWorkspaceActor(authResult.session)
  const manifest = await buildManifest(projectId, canvasId, nodeId, [actor.actorId, actor.workspaceOwnerId])
  const task = await latestRenderTask(projectId, nodeId, manifest.fingerprint)
  return NextResponse.json({ render: serializeCanvasPlaylistRenderTask(task, manifest.fingerprint) })
})

export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string; canvasId: string; nodeId: string }> },
) => {
  const { projectId, canvasId, nodeId } = await context.params
  const authResult = await requireProjectAuthLight(projectId, ['canvasWrite', 'storyboardWrite'])
  if (isErrorResponse(authResult)) return authResult
  await requireCanvasInProject(canvasId, projectId)
  const actor = getWorkspaceActor(authResult.session)
  const manifest = await buildManifest(projectId, canvasId, nodeId, [actor.actorId, actor.workspaceOwnerId])
  const existing = await latestRenderTask(projectId, nodeId, manifest.fingerprint)
  if (existing && (
    existing.status === TASK_STATUS.QUEUED
    || existing.status === TASK_STATUS.PROCESSING
    || existing.status === TASK_STATUS.COMPLETED
  )) {
    return NextResponse.json({ render: serializeCanvasPlaylistRenderTask(existing, manifest.fingerprint) }, { status: existing.status === TASK_STATUS.COMPLETED ? 200 : 202 })
  }
  const payload: CanvasPlaylistRenderTaskPayload = {
    kind: 'canvas_playlist_render',
    canvasId,
    nodeId,
    title: manifest.title,
    fingerprint: manifest.fingerprint,
    durationMs: manifest.durationMs,
    segments: manifest.segments,
  }
  const result = await submitTask({
    userId: actor.actorId,
    locale: resolveRequiredTaskLocale(request, null),
    requestId: getRequestId(request),
    projectId,
    type: TASK_TYPE.CANVAS_VIDEO_OPERATION,
    targetType: 'CanvasNode',
    targetId: nodeId,
    payload,
    dedupeKey: `canvas-playlist-render:${nodeId}:${manifest.fingerprint}`,
    maxAttempts: 1,
  })
  const task = await prisma.task.findUnique({ where: { id: result.taskId } })
  if (!task) throw new ApiError('INTERNAL_ERROR', { message: '成片渲染任务创建后无法读取。' })
  return NextResponse.json({ render: serializeCanvasPlaylistRenderTask(task, manifest.fingerprint) }, { status: 202 })
})
