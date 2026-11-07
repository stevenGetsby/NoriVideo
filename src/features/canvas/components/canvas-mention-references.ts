import type { MentionPromptAsset } from '@/components/frameos/materials/MentionPromptEditor'
import type { FrameosMaterialItem } from '@/components/frameos/materials/contracts'
import { FRAMEOS_ASSET_CATEGORY_LABELS, frameosAssetCategoryFromMetadata, type FrameosAssetCategory } from '@/lib/frameos/material-category'
import type { CanvasFlowNode } from '../editor-types'

export type CanvasMentionMediaType = 'image' | 'video' | 'audio'
export type CanvasMentionCategory = 'favorites' | FrameosAssetCategory

export type CanvasMentionAsset = MentionPromptAsset & {
  id: string
  mediaType: CanvasMentionMediaType
  materialId: string | null
  section: 'connected' | 'library'
  category?: CanvasMentionCategory
  material?: FrameosMaterialItem
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
 * Builds stable @mention options from actual wired inputs. Library materials
 * are converted separately so an unconnected canvas node cannot appear here.
 */
export function buildCanvasMentionAssets(
  nodes: CanvasFlowNode[],
  targetNodeId: string,
  allowedTypes: readonly CanvasMentionMediaType[],
  incomingNodeIds: ReadonlySet<string> = new Set(),
): CanvasMentionAsset[] {
  const allowed = new Set(allowedTypes)
  const candidates = nodes.flatMap((node) => {
    if (node.id === targetNodeId || !incomingNodeIds.has(node.id)) return []
    const mediaType = canvasMentionMediaType(node)
    if (!mediaType || !allowed.has(mediaType)) return []
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

  const assets = candidates.map(({ node, mediaType, title }) => {
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
      section: 'connected' as const,
      description: `${mediaLabel(mediaType)} · 已连接节点${node.data.materialId ? '' : ' · 将自动建立引用'}`,
    }
  })

  return assets.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' }))
}

export function canvasMentionCategoryLabel(category: CanvasMentionCategory): string {
  return category === 'favorites' ? '收藏' : FRAMEOS_ASSET_CATEGORY_LABELS[category].replace('资产', '').replace('素材', '')
}

export function buildCanvasLibraryMentionAssets(
  materials: FrameosMaterialItem[],
  allowedTypes: readonly CanvasMentionMediaType[],
): CanvasMentionAsset[] {
  const allowed = new Set(allowedTypes)
  const titleCounts = new Map<string, number>()
  const usable = materials.filter((material) => (
    material.status === 'ready'
    && Boolean(material.url)
    && allowed.has(material.type as CanvasMentionMediaType)
  ))
  for (const material of usable) {
    const title = material.title?.trim() || '未命名素材'
    const key = `${title}::${material.type}`
    titleCounts.set(key, (titleCounts.get(key) || 0) + 1)
  }
  const occurrence = new Map<string, number>()
  const names = new Map<string, string>()
  for (const material of usable) {
    const title = material.title?.trim() || '未命名素材'
    const mediaType = material.type as CanvasMentionMediaType
    const key = `${title}::${material.type}`
    const current = (occurrence.get(key) || 0) + 1
    occurrence.set(key, current)
    const duplicate = (titleCounts.get(key) || 0) > 1
    names.set(material.id, duplicate ? `${title}·${mediaLabel(mediaType)}${current}` : title)
  }
  return usable.flatMap((material): CanvasMentionAsset[] => {
    const mediaType = material.type as CanvasMentionMediaType
    const title = material.title?.trim() || '未命名素材'
    const category = frameosAssetCategoryFromMetadata(material.metadata)
    const categories: CanvasMentionCategory[] = material.isFavorited ? ['favorites', category] : [category]
    return categories.map((category): CanvasMentionAsset => {
      const name = names.get(material.id) || title
      return {
        id: `library:${category}:${material.id}`,
        name,
        mediaType,
        materialId: material.id,
        material,
        imageUrl: mediaType === 'audio' ? null : material.url,
        section: 'library',
        category,
        description: `${canvasMentionCategoryLabel(category)} · ${mediaLabel(mediaType)} · ${material.projectName}`,
      }
    })
  }).sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' }))
}

/** Adds a mention reference without reordering or dropping wired references. */
export function mergeCanvasReferenceNodeIds(current: string[], nodeId: string | undefined): string[] {
  if (!nodeId || current.includes(nodeId)) return current
  return [...current, nodeId]
}
