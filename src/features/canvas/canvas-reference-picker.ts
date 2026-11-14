import type { CanvasFlowNode } from './editor-types'

export type CanvasReferencePickerType = 'image' | 'video' | 'audio'
export type CanvasReferencePickerMode = 'all' | CanvasReferencePickerType

export interface CanvasReferencePickerItem {
  id: string
  title: string
  mediaType: CanvasReferencePickerType
  /** Still image (the poster for a video). */
  preview: string | null
  /** Video file used for a thumbnail when no poster exists. */
  videoSrc: string | null
  /** Already one of this generator's selected references. */
  referenced: boolean
  /** Connected to the generator by a wire (it may still be unselected). */
  wired: boolean
  character: boolean
}

export const CANVAS_REFERENCE_PICKER_TYPES: readonly CanvasReferencePickerType[] = ['image', 'video', 'audio']

type TypeLimits = Readonly<Record<CanvasReferencePickerType, { max: number }>>

export function canvasReferenceMediaType(node: CanvasFlowNode): CanvasReferencePickerType | null {
  const type = node.data.mediaType || node.type
  return type === 'image' || type === 'video' || type === 'audio' ? type : null
}

function firstUrl(...candidates: Array<string | null | undefined>): string | null {
  for (const candidate of candidates) {
    const value = typeof candidate === 'string' ? candidate.trim() : ''
    if (value) return value
  }
  return null
}

// Mirrors the server's materialUrl(): a node the picker offers must be one the
// materials endpoint can register, otherwise submit would fail later.
function referenceMediaUrl(node: CanvasFlowNode, type: CanvasReferencePickerType): string | null {
  const data = node.data
  if (type === 'image') return firstUrl(data.contentUrl, data.imageUrl, data.posterUrl)
  if (type === 'video') return firstUrl(data.contentUrl, data.videoUrl)
  return firstUrl(data.audioUrl, data.contentUrl)
}

/** Media types the generator can take as references; a type the model caps at 0 is not offered. */
export function canvasReferencePickerTypes(
  mode: CanvasReferencePickerMode | null,
  limits: TypeLimits | null,
): CanvasReferencePickerType[] {
  if (!mode) return []
  const candidates = mode === 'all' ? CANVAS_REFERENCE_PICKER_TYPES : [mode]
  return candidates.filter((type) => (limits ? limits[type].max : 1) > 0)
}

/** How many more references of each type the model still accepts. */
export function canvasReferenceRemaining(
  limits: TypeLimits | null,
  allowed: readonly CanvasReferencePickerType[],
  selectedNodes: readonly CanvasFlowNode[],
): Record<CanvasReferencePickerType, number> {
  const used: Record<CanvasReferencePickerType, number> = { image: 0, video: 0, audio: 0 }
  for (const node of selectedNodes) {
    const type = canvasReferenceMediaType(node)
    if (type) used[type] += 1
  }
  const remaining: Record<CanvasReferencePickerType, number> = { image: 0, video: 0, audio: 0 }
  for (const type of allowed) remaining[type] = Math.max(0, (limits ? limits[type].max : 9) - used[type])
  return remaining
}

/** Newest canvas nodes first: assets the user just dragged in or generated are the likely picks. */
export function buildCanvasReferencePickerItems({
  nodes,
  generatorNodeId,
  allowedTypes,
  selectedIds,
  wiredIds,
  isCharacter,
}: {
  nodes: readonly CanvasFlowNode[]
  generatorNodeId: string
  allowedTypes: readonly CanvasReferencePickerType[]
  selectedIds: readonly string[]
  wiredIds: ReadonlySet<string>
  isCharacter: (node: CanvasFlowNode) => boolean
}): CanvasReferencePickerItem[] {
  const selected = new Set(selectedIds)
  const items: CanvasReferencePickerItem[] = []
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index]
    if (node.id === generatorNodeId) continue
    const mediaType = canvasReferenceMediaType(node)
    if (!mediaType || !allowedTypes.includes(mediaType)) continue
    const url = referenceMediaUrl(node, mediaType)
    if (!url) continue
    const data = node.data
    items.push({
      id: node.id,
      title: data.title?.trim() || '未命名素材',
      mediaType,
      preview: mediaType === 'image'
        ? url
        : mediaType === 'video' ? firstUrl(data.posterUrl, data.imageUrl) : null,
      videoSrc: mediaType === 'video' ? firstUrl(data.videoUrl, data.contentUrl) : null,
      referenced: selected.has(node.id),
      wired: wiredIds.has(node.id),
      character: mediaType === 'image' && isCharacter(node),
    })
  }
  return items
}

/** Position badge text: the first two picks of first/last-frame mode are 首/尾. */
export function canvasReferenceOrderLabel(position: number, firstLastFrame: boolean): string {
  if (firstLastFrame && position < 2) return position === 0 ? '首' : '尾'
  return String(position + 1)
}

/** Appends picked ids after the current references, dropping repeats and keeping the pick order. */
export function mergePickedReferenceIds(current: readonly string[], picked: readonly string[]): string[] {
  const next = [...current]
  for (const id of picked) if (!next.includes(id)) next.push(id)
  return next
}
