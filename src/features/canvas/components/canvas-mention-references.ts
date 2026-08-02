import type { MentionPromptAsset } from '@/components/frameos/materials/MentionPromptEditor'
import type { CanvasFlowNode } from '../editor-types'

export type CanvasMentionMediaType = 'image' | 'video' | 'audio'

export type CanvasMentionAsset = MentionPromptAsset & {
  id: string
  mediaType: CanvasMentionMediaType
  materialId: string | null
}

/**
 * Audio generators currently accept text only. Audio mentions remain useful
 * prompt tokens, but must not be misrepresented as provider reference inputs.
 */
export function shouldBindCanvasMentionReference(targetType: string): boolean {
  return targetType === 'image' || targetType === 'video'
}

function canvasMentionMediaType(node: CanvasFlowNode): CanvasMentionMediaType | null {
  const mediaType = node.data.mediaType || node.type
  return mediaType === 'image' || mediaType === 'video' || mediaType === 'audio'
    ? mediaType
    : null
}

function mediaLabel(mediaType: CanvasMentionMediaType): string {
  if (mediaType === 'video') return '视频'
  if (mediaType === 'audio') return '音频'
  return '图片'
}

function referencePreview(node: CanvasFlowNode, mediaType: CanvasMentionMediaType): string | null {
  if (mediaType === 'audio') return null
  if (mediaType === 'video') return node.data.posterUrl || node.data.imageUrl || null
  return node.data.contentUrl || node.data.imageUrl || node.data.posterUrl || null
}

function hasUsableContent(node: CanvasFlowNode, mediaType: CanvasMentionMediaType) {
  if (typeof node.data.materialId === 'string' && node.data.materialId.trim()) return true
  if (mediaType === 'image') return Boolean(node.data.contentUrl || node.data.imageUrl || node.data.posterUrl)
  if (mediaType === 'video') return Boolean(node.data.contentUrl || node.data.videoUrl)
  return Boolean(node.data.audioUrl || node.data.contentUrl)
}

/**
 * Builds stable @mention options from canvas entities. Duplicate node titles get
 * a visible media suffix so choosing a token always maps back to one node id.
 */
export function buildCanvasMentionAssets(
  nodes: CanvasFlowNode[],
  targetNodeId: string,
  allowedTypes: readonly CanvasMentionMediaType[],
  incomingNodeIds: ReadonlySet<string> = new Set(),
): CanvasMentionAsset[] {
  const allowed = new Set(allowedTypes)
  const candidates = nodes.flatMap((node) => {
    if (node.id === targetNodeId) return []
    const mediaType = canvasMentionMediaType(node)
    if (!mediaType || !allowed.has(mediaType)) return []
    // Legacy/imported canvas nodes can predate the material index. They remain
    // selectable when they have real media; submission promotes the URL to a
    // project material before calling a generation provider.
    if (!hasUsableContent(node, mediaType)) return []
    const title = node.data.title?.trim() || `未命名${mediaLabel(mediaType)}`
    return [{ node, mediaType, title }]
  })
  const titleCounts = new Map<string, number>()
  const titleTypeCounts = new Map<string, number>()
  candidates.forEach(({ title }) => titleCounts.set(title, (titleCounts.get(title) || 0) + 1))
  candidates.forEach(({ title, mediaType }) => {
    const key = `${title}\u0000${mediaType}`
    titleTypeCounts.set(key, (titleTypeCounts.get(key) || 0) + 1)
  })
  const occurrence = new Map<string, number>()

  return candidates.map(({ node, mediaType, title }) => {
    const titleTypeKey = `${title}\u0000${mediaType}`
    const current = (occurrence.get(titleTypeKey) || 0) + 1
    occurrence.set(titleTypeKey, current)
    const duplicate = (titleCounts.get(title) || 0) > 1
    const sameTypeDuplicate = (titleTypeCounts.get(titleTypeKey) || 0) > 1
    const name = duplicate
      ? `${title}·${mediaLabel(mediaType)}${sameTypeDuplicate ? current : ''}`
      : title
    return {
      id: node.id,
      name,
      mediaType,
      materialId: typeof node.data.materialId === 'string' && node.data.materialId.trim()
        ? node.data.materialId.trim()
        : null,
      imageUrl: referencePreview(node, mediaType),
      description: `${mediaLabel(mediaType)} · ${incomingNodeIds.has(node.id) ? '已连接上游' : '画布素材'}${node.data.materialId ? '' : ' · 将自动建立引用'}`,
    }
  })
}

/** Adds a mention reference without reordering or dropping wired references. */
export function mergeCanvasReferenceNodeIds(current: string[], nodeId: string | undefined): string[] {
  if (!nodeId || current.includes(nodeId)) return current
  return [...current, nodeId]
}
