import { CANVAS_PLAYLIST_MAX_ITEMS, normalizeCanvasPlaylistItems } from '@/lib/canvas/playlist'
import type { CanvasPlaylistItem } from './types'
import type { CanvasFlowNode } from './editor-types'

export type CanvasPlaylistDropOutcome = 'added' | 'duplicate' | 'full' | 'not_ready'

function finiteDurationMs(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : null
}

function nodeSize(node: CanvasFlowNode) {
  return {
    width: node.width || node.measured?.width || 300,
    height: node.height || node.measured?.height || 200,
  }
}

export function canvasVideoUrl(node: CanvasFlowNode) {
  return node.data.videoUrl || (node.data.mediaType === 'video' ? node.data.contentUrl : null) || null
}

export function canvasVideoDurationMs(node: CanvasFlowNode) {
  const metadata = node.data.sourceMetadata
  const metadataMs = finiteDurationMs(metadata?.durationMs)
  if (metadataMs) return metadataMs
  const metadataSeconds = Number(metadata?.durationSeconds)
  if (Number.isFinite(metadataSeconds) && metadataSeconds > 0) return Math.round(metadataSeconds * 1_000)
  const generationSeconds = node.data.generation?.duration
  return typeof generationSeconds === 'number' && Number.isFinite(generationSeconds) && generationSeconds > 0
    ? Math.round(generationSeconds * 1_000)
    : null
}

export function isCanvasVideoSource(node: CanvasFlowNode) {
  const mediaType = node.data.mediaType || (node.type === 'note' ? 'text' : node.type === 'model_3d' ? 'model3d' : node.type) || 'image'
  return mediaType === 'video' || node.type === 'production_video' || Boolean(canvasVideoUrl(node))
}

export function playlistItemFromNode(
  node: CanvasFlowNode,
  createId: () => string = () => (typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `playlist-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`),
): CanvasPlaylistItem {
  const durationMs = canvasVideoDurationMs(node)
  return {
    id: createId(),
    sourceNodeId: node.id,
    materialId: node.data.materialId || null,
    title: node.data.title || '视频节点',
    videoUrl: canvasVideoUrl(node),
    posterUrl: node.data.posterUrl || node.data.imageUrl || null,
    sourceInMs: 0,
    sourceOutMs: durationMs,
    durationMs,
  }
}

export function appendCanvasVideoSourceToPlaylist(
  value: unknown,
  source: CanvasFlowNode,
  createId?: () => string,
): { items: CanvasPlaylistItem[]; outcome: CanvasPlaylistDropOutcome } {
  const items = normalizeCanvasPlaylistItems(value)
  if (!canvasVideoUrl(source)) return { items, outcome: 'not_ready' }
  if (items.some((item) => item.sourceNodeId === source.id)) return { items, outcome: 'duplicate' }
  if (items.length >= CANVAS_PLAYLIST_MAX_ITEMS) return { items, outcome: 'full' }
  return {
    items: [...items, playlistItemFromNode(source, createId)],
    outcome: 'added',
  }
}

/**
 * Treat a video node as being dropped into a Playlist when its centre enters
 * the Playlist, or when at least 35% of the video node overlaps it. Requiring a
 * meaningful overlap prevents a large review node from stealing ordinary
 * nearby moves while still making the drop target forgiving at low zoom.
 */
export function findCanvasPlaylistDropTargetId(nodes: CanvasFlowNode[], draggedNode: CanvasFlowNode) {
  const draggedSize = nodeSize(draggedNode)
  const draggedRect = {
    left: draggedNode.position.x,
    top: draggedNode.position.y,
    right: draggedNode.position.x + draggedSize.width,
    bottom: draggedNode.position.y + draggedSize.height,
  }
  const center = {
    x: (draggedRect.left + draggedRect.right) / 2,
    y: (draggedRect.top + draggedRect.bottom) / 2,
  }
  const draggedArea = Math.max(1, draggedSize.width * draggedSize.height)

  let best: { id: string; score: number } | null = null
  for (const node of nodes) {
    if (node.id === draggedNode.id || node.type !== 'playlist') continue
    const size = nodeSize(node)
    const rect = {
      left: node.position.x,
      top: node.position.y,
      right: node.position.x + size.width,
      bottom: node.position.y + size.height,
    }
    const overlapWidth = Math.max(0, Math.min(draggedRect.right, rect.right) - Math.max(draggedRect.left, rect.left))
    const overlapHeight = Math.max(0, Math.min(draggedRect.bottom, rect.bottom) - Math.max(draggedRect.top, rect.top))
    const overlapArea = overlapWidth * overlapHeight
    const centerInside = center.x >= rect.left && center.x <= rect.right && center.y >= rect.top && center.y <= rect.bottom
    if (!centerInside && overlapArea / draggedArea < 0.35) continue
    const score = (centerInside ? draggedArea : 0) + overlapArea
    if (!best || score > best.score) best = { id: node.id, score }
  }
  return best?.id || null
}
