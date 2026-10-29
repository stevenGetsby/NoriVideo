import { isStoryNodeType } from '@/lib/interactive/compile'
import { STORY_FLOW_ROLE, STORY_OUTPUT_HANDLE } from '@/lib/interactive/types'
import { STORY_MEDIA_SOURCE_TYPES, storySourceHandles } from './story-connection'
import { nodeBox, STORY_PORT_Y, type StoryGeometryNode, type StoryWireRole } from './story-geometry'

export type LayoutBox = { x: number; y: number; width: number; height: number }

/** Rendered sizes of freshly created story cards; React Flow measures the real height after mount. */
export const STORY_NEW_NODE_SIZES: Record<string, { width: number; height: number }> = {
  story_entry: { width: 240, height: 98 },
  story_scene: { width: 300, height: 330 },
  story_choice: { width: 300, height: 196 },
  story_condition: { width: 320, height: 214 },
  story_exit: { width: 240, height: 92 },
  story_ending: { width: 260, height: 150 },
}

const overlaps = (a: LayoutBox, b: LayoutBox, gap: number) =>
  a.x < b.x + b.width + gap && b.x < a.x + a.width + gap && a.y < b.y + b.height + gap && b.y < a.y + a.height + gap

/**
 * Slides `desired` vertically to the closest position that keeps `gap` clear of every obstacle,
 * so a new node lands where it was asked for without covering existing work.
 */
export function nearestFreeSpot(desired: LayoutBox, obstacles: readonly LayoutBox[], options: { gap?: number; upward?: boolean } = {}) {
  const gap = options.gap ?? 32
  const free = (y: number) => obstacles.every((box) => !overlaps({ ...desired, y }, box, gap))
  if (free(desired.y)) return { x: desired.x, y: desired.y }
  const column = obstacles.filter((box) => desired.x < box.x + box.width + gap && box.x < desired.x + desired.width + gap)
  const candidates = column
    .flatMap((box) => [box.y + box.height + gap, box.y - gap - desired.height])
    .filter((y) => !options.upward || y <= desired.y)
    .sort((a, b) => Math.abs(a - desired.y) - Math.abs(b - desired.y) || b - a)
  return { x: desired.x, y: candidates.find(free) ?? desired.y }
}

type IdBox = LayoutBox & { id: string }

/**
 * Room for a scene's picture directly above it. When cards already sit there, the scene and
 * everything stacked below it in its column move down together, so the picture never lands far
 * away with its wire running across other cards.
 */
export function roomAbove(scene: IdBox, picture: LayoutBox, cards: readonly IdBox[], gap = 32) {
  const inColumn = (box: LayoutBox) => [scene, picture].some((span) => span.x < box.x + box.width + gap && box.x < span.x + span.width + gap)
  const moved = cards.filter((box) => box.id === scene.id || (inColumn(box) && box.y >= scene.y)).map((box) => box.id)
  const fixed = cards.filter((box) => !moved.includes(box.id))
  let shift = 0
  for (;;) {
    const blockers = fixed.filter((box) => overlaps({ ...picture, y: picture.y + shift }, box, gap))
    if (!blockers.length) return { shift, moved: shift ? moved : [] }
    shift = Math.max(...blockers.map((box) => box.y + box.height + gap - picture.y))
  }
}

/**
 * A node created from a released wire puts the matching side on the drop point: its input for a
 * forward wire, its output for a backward one, its bottom edge for a scene's picture, and a new
 * scene's picture port for a wire pulled out of a video or image.
 */
export function storyDropBox(role: StoryWireRole, drop: { x: number; y: number }, size: { width: number; height: number }) {
  if (role === 'forward') return { box: { x: drop.x, y: drop.y - STORY_PORT_Y, ...size }, upward: false }
  if (role === 'backward') return { box: { x: drop.x - size.width, y: drop.y - STORY_PORT_Y, ...size }, upward: false }
  if (role === 'media') return { box: { x: drop.x - size.width / 2, y: drop.y, ...size }, upward: false }
  return { box: { x: drop.x - size.width / 2, y: drop.y - size.height, ...size }, upward: true }
}

/** The smallest pan, in pane pixels, that brings `box` inside the pane; oversized boxes align their top-left. */
export function revealOffset(
  box: LayoutBox,
  viewport: { x: number; y: number; zoom: number },
  pane: { width: number; height: number },
  margin = { side: 72, top: 72, bottom: 96 },
) {
  const axis = (start: number, size: number, min: number, max: number) => {
    const end = start + size
    if (end - start > max - min || start < min) return min - start
    return end > max ? max - end : 0
  }
  return {
    x: axis(box.x * viewport.zoom + viewport.x, box.width * viewport.zoom, margin.side, pane.width - margin.side),
    y: axis(box.y * viewport.zoom + viewport.y, box.height * viewport.zoom, margin.top, pane.height - margin.bottom),
  }
}

export function layoutObstacles(nodes: Iterable<StoryGeometryNode>, excludeIds: ReadonlySet<string> = new Set()): LayoutBox[] {
  return [...nodes].filter((node) => node.type !== 'group' && !excludeIds.has(node.id)).map(nodeBox).filter((box) => box.width > 0 && box.height > 0)
}

type SizedNode = { id: string; type?: string; data?: unknown; position: { x: number; y: number }; width: number; height: number }
type LayoutEdge = { source: string; target: string; sourceHandle?: string | null; data?: { role?: unknown } }

const COLUMN_GAP = 150
const ROW_GAP = 44
const MEDIA_GAP = 56

/**
 * Story-aware 整理: columns follow the longest path from the entries (loops ignored), children
 * stack in option / branch order beside their parent, and each scene keeps its picture above it.
 * Nodes outside the story graph stay where they are.
 */
export function layoutStoryChapter(nodes: readonly SizedNode[], edges: readonly LayoutEdge[]): Map<string, { x: number; y: number }> {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const story = nodes.filter((node) => isStoryNodeType(node.type))
  const positions = new Map<string, { x: number; y: number }>()
  if (!story.length) return positions

  const outgoing = new Map<string, LayoutEdge[]>()
  const incoming = new Set<string>()
  const mediaOf = new Map<string, SizedNode>()
  const placedMedia = new Set<string>()
  for (const edge of edges) {
    const source = byId.get(edge.source)
    const target = byId.get(edge.target)
    if (!source || !target) continue
    if (edge.data?.role === STORY_FLOW_ROLE) {
      outgoing.set(source.id, [...(outgoing.get(source.id) ?? []), edge])
      incoming.add(target.id)
    } else if (target.type === 'story_scene' && STORY_MEDIA_SOURCE_TYPES.has(source.type || '') && !mediaOf.has(target.id) && !placedMedia.has(source.id)) {
      mediaOf.set(target.id, source)
      placedMedia.add(source.id)
    }
  }
  for (const [id, list] of outgoing) {
    const handles = storySourceHandles(byId.get(id)!)
    list.sort((a, b) => handles.indexOf(a.sourceHandle || STORY_OUTPUT_HANDLE) - handles.indexOf(b.sourceHandle || STORY_OUTPUT_HANDLE))
  }

  const rootRank = (node: SizedNode) => (node.type === 'story_entry' ? 0 : incoming.has(node.id) ? 2 : 1)
  const roots = [...story].sort((a, b) => rootRank(a) - rootRank(b) || a.position.y - b.position.y || a.position.x - b.position.x)
  const state = new Map<string, 'active' | 'done'>()
  const backEdges = new Set<LayoutEdge>()
  const postOrder: string[] = []
  const rank = new Map<string, number>()
  const visit = (id: string) => {
    state.set(id, 'active')
    rank.set(id, rank.size)
    for (const edge of outgoing.get(id) ?? []) {
      const seen = state.get(edge.target)
      if (seen === 'active') backEdges.add(edge)
      else if (!seen) visit(edge.target)
    }
    state.set(id, 'done')
    postOrder.push(id)
  }
  for (const root of roots) if (!state.has(root.id)) visit(root.id)

  const depth = new Map<string, number>()
  const parent = new Map<string, string>()
  for (const id of postOrder.reverse()) {
    const level = depth.get(id) ?? 0
    depth.set(id, level)
    for (const edge of outgoing.get(id) ?? []) {
      if (backEdges.has(edge)) continue
      if (level + 1 > (depth.get(edge.target) ?? -1)) { depth.set(edge.target, level + 1); parent.set(edge.target, id) }
    }
  }

  const columns: SizedNode[][] = []
  for (const node of story) (columns[depth.get(node.id) ?? 0] ??= []).push(node)
  const mediaLift = (node: SizedNode) => { const media = mediaOf.get(node.id); return media ? media.height + MEDIA_GAP : 0 }
  let x = Math.min(...story.map((node) => node.position.x))
  const top = Math.min(...story.map((node) => node.position.y - mediaLift(node)))
  for (const column of columns) {
    if (!column) continue
    column.sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0))
    let bottom = -Infinity
    let width = 0
    for (const node of column) {
      const lift = mediaLift(node)
      const anchor = parent.get(node.id)
      const desired = anchor ? positions.get(anchor)!.y : top + lift
      const y = Math.max(desired, bottom + ROW_GAP + lift)
      positions.set(node.id, { x, y })
      const media = mediaOf.get(node.id)
      if (media) positions.set(media.id, { x: x + node.width / 2 - media.width / 2, y: y - lift })
      bottom = y + node.height
      width = Math.max(width, node.width, media?.width ?? 0)
    }
    x += width + COLUMN_GAP
  }
  return positions
}
