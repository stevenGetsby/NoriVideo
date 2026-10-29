import { Position } from '@xyflow/react'
import { isStoryNodeType } from '@/lib/interactive/compile'
import { STORY_FLOW_ROLE, STORY_OUTPUT_HANDLE } from '@/lib/interactive/types'
import { STORY_MEDIA_HANDLE, STORY_MEDIA_SOURCE_TYPES, storySourceHandles } from './story-connection'

/** Distance from a story card's top edge to the centre of its header ports. */
export const STORY_PORT_Y = 22

export type StoryPoint = { x: number; y: number }
export type StoryBox = StoryPoint & { width: number; height: number }
type HandleBox = { id?: string | null; x: number; y: number; width: number; height: number }

/** The parts of a React Flow internal node that story geometry reads. */
export type StoryGeometryNode = {
  id: string
  type?: string
  data?: unknown
  width?: number
  height?: number
  measured?: { width?: number; height?: number }
  internals: {
    positionAbsolute: StoryPoint
    z?: number
    handleBounds?: { source?: HandleBox[] | null; target?: HandleBox[] | null }
  }
}

type FlowEdgeLike = { source: string; sourceHandle?: string | null; data?: { role?: unknown } }

const size = (value: number | undefined, fallback = 0) => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback)
const isLeftHandle = (handle: string | null | undefined) => handle === 'input' || handle === 'left'
const distance = (a: StoryPoint, b: StoryPoint) => Math.hypot(a.x - b.x, a.y - b.y)

const paneScaleCache = new WeakMap<Element, { width: number; scale: number }>()

/** Rendered ÷ layout width of the pane: the app shell's CSS zoom is invisible to React Flow. */
export function paneRenderedScale(domNode: HTMLElement | null | undefined, paneWidth: number): number {
  if (!domNode) return 1
  const cached = paneScaleCache.get(domNode)
  if (cached && cached.width === paneWidth) return cached.scale
  const rendered = domNode.getBoundingClientRect().width
  const layout = domNode.clientWidth
  if (!(rendered > 0) || !(layout > 0)) return 1
  const scale = rendered / layout
  paneScaleCache.set(domNode, { width: paneWidth, scale })
  return scale
}

export function nodeBox(node: StoryGeometryNode): StoryBox {
  return {
    x: node.internals.positionAbsolute.x,
    y: node.internals.positionAbsolute.y,
    width: size(node.measured?.width, size(node.width)),
    height: size(node.measured?.height, size(node.height)),
  }
}

/** React Flow measures handle offsets in zoomed pixels (÷ scale) but sizes in layout pixels. */
export function handleBoxCenter(origin: StoryPoint, handle: HandleBox, scale: number): StoryPoint {
  return { x: origin.x + handle.x / scale + handle.width / 2, y: origin.y + handle.y / scale + handle.height / 2 }
}

export function storyHandleCenter(node: StoryGeometryNode, handleId: string, scale: number): StoryPoint | null {
  const bounds = node.internals.handleBounds
  const handle = [...(bounds?.source ?? []), ...(bounds?.target ?? [])].find((item) => item.id === handleId)
  return handle ? handleBoxCenter(node.internals.positionAbsolute, handle, scale) : null
}

/** Media feeds a scene from above; side anchors keep the wire short when the media sits beside it. */
export function storyMediaAnchor(box: StoryBox, port: StoryPoint): { point: StoryPoint; position: Position } {
  if (box.y + box.height <= port.y - 24) return { point: { x: box.x + box.width / 2, y: box.y + box.height }, position: Position.Bottom }
  if (box.x + box.width / 2 > port.x) return { point: { x: box.x, y: box.y + box.height / 2 }, position: Position.Left }
  return { point: { x: box.x + box.width, y: box.y + box.height / 2 }, position: Position.Right }
}

export type StoryEdgeEnds = { source: StoryPoint; sourcePosition: Position; target: StoryPoint; targetPosition: Position }

/** Story flows run port centre to port centre (hidden under the port dots); media lands on the scene's top port. */
export function storyEdgeEnds(input: { source: StoryGeometryNode; target: StoryGeometryNode; sourceHandle?: string | null; flow: boolean; scale: number }): StoryEdgeEnds | null {
  if (input.flow) {
    const source = storyHandleCenter(input.source, input.sourceHandle || STORY_OUTPUT_HANDLE, input.scale)
    const target = storyHandleCenter(input.target, 'input', input.scale)
    return source && target ? { source, sourcePosition: Position.Right, target, targetPosition: Position.Left } : null
  }
  if (input.target.type !== 'story_scene') return null
  const port = storyHandleCenter(input.target, STORY_MEDIA_HANDLE, input.scale)
  if (!port) return null
  const anchor = storyMediaAnchor(nodeBox(input.source), port)
  return { source: anchor.point, sourcePosition: anchor.position, target: port, targetPosition: Position.Top }
}

export type StoryWireRole = 'forward' | 'backward' | 'media' | 'media-pick'

/** What a wire dragged from this handle means on a story canvas; null keeps the ordinary canvas behaviour. */
export function storyWireRole(node: { type?: string } | null | undefined, handleId: string | null | undefined): StoryWireRole | null {
  if (!node) return null
  if (isStoryNodeType(node.type)) {
    if (handleId === STORY_MEDIA_HANDLE) return node.type === 'story_scene' ? 'media-pick' : null
    if (isLeftHandle(handleId)) return node.type === 'story_entry' ? null : 'backward'
    return storySourceHandles(node).length ? 'forward' : null
  }
  return STORY_MEDIA_SOURCE_TYPES.has(node.type || '') && !isLeftHandle(handleId) ? 'media' : null
}

export type StoryWireConnection = { source: string; sourceHandle: string; target: string; targetHandle: string }
export type StoryWireTarget = { nodeId: string; point: StoryPoint; position: Position; connection: StoryWireConnection }
type Port = { node: StoryGeometryNode; handleId: string; point: StoryPoint; position: Position }

function port(node: StoryGeometryNode, handleId: string, position: Position, scale: number): Port[] {
  const point = storyHandleCenter(node, handleId, scale)
  return point ? [{ node, handleId, point, position }] : []
}

function portsFor(role: StoryWireRole, node: StoryGeometryNode, scale: number): Port[] {
  if (role === 'forward') return isStoryNodeType(node.type) && node.type !== 'story_entry' ? port(node, 'input', Position.Left, scale) : []
  if (role === 'backward') return isStoryNodeType(node.type) ? storySourceHandles(node).flatMap((id) => port(node, id, Position.Right, scale)) : []
  if (role === 'media') return node.type === 'story_scene' ? port(node, STORY_MEDIA_HANDLE, Position.Top, scale) : []
  return []
}

function topNodeAt(nodes: readonly StoryGeometryNode[], point: StoryPoint, pad: number) {
  let best: StoryGeometryNode | null = null
  for (const node of nodes) {
    const box = nodeBox(node)
    if (box.width <= 0 || box.height <= 0) continue
    if (point.x < box.x - pad || point.x > box.x + box.width + pad || point.y < box.y - pad || point.y > box.y + box.height + pad) continue
    if (!best || (node.internals.z ?? 0) >= (best.internals.z ?? 0)) best = node
  }
  return best
}

/** The node under the pointer, ignoring the wire's own node and groups. */
export function storyNodeAt(nodes: Iterable<StoryGeometryNode>, point: StoryPoint, excludeId: string) {
  return topNodeAt([...nodes].filter((node) => node.id !== excludeId && node.type !== 'group'), point, 12)
}

function areaPort(role: StoryWireRole, hit: StoryGeometryNode, from: StoryGeometryNode, point: StoryPoint, edges: readonly FlowEdgeLike[], scale: number): Port | null {
  const hitIsMedia = STORY_MEDIA_SOURCE_TYPES.has(hit.type || '')
  if (role === 'media-pick' || (from.type === 'story_scene' && hitIsMedia)) {
    const scenePort = hitIsMedia ? storyHandleCenter(from, STORY_MEDIA_HANDLE, scale) : null
    if (!scenePort) return null
    const anchor = storyMediaAnchor(nodeBox(hit), scenePort)
    return { node: hit, handleId: 'output', point: anchor.point, position: anchor.position }
  }
  const ports = portsFor(role, hit, scale)
  if (role !== 'backward' || ports.length <= 1) return ports[0] ?? null
  const used = new Set(edges.filter((edge) => edge.source === hit.id && edge.data?.role === STORY_FLOW_ROLE).map((edge) => edge.sourceHandle || STORY_OUTPUT_HANDLE))
  return ports.find((item) => !used.has(item.handleId)) ?? ports.reduce((a, b) => (distance(a.point, point) <= distance(b.point, point) ? a : b))
}

function connectionFor(role: StoryWireRole, from: StoryGeometryNode, fromHandle: string | null | undefined, target: Port): StoryWireConnection {
  if (role === 'media') return { source: from.id, sourceHandle: 'output', target: target.node.id, targetHandle: STORY_MEDIA_HANDLE }
  if (STORY_MEDIA_SOURCE_TYPES.has(target.node.type || '')) return { source: target.node.id, sourceHandle: 'output', target: from.id, targetHandle: STORY_MEDIA_HANDLE }
  if (role === 'backward') return { source: target.node.id, sourceHandle: target.handleId, target: from.id, targetHandle: 'input' }
  return { source: from.id, sourceHandle: fromHandle || STORY_OUTPUT_HANDLE, target: target.node.id, targetHandle: 'input' }
}

/**
 * Where a story wire released at `point` lands: the nearest compatible port within ~28 screen px,
 * else the node under the pointer (its input, a free exit, or its picture port).
 */
export function resolveStoryWireTarget(input: {
  from: StoryGeometryNode
  fromHandle: string | null | undefined
  point: StoryPoint
  nodes: Iterable<StoryGeometryNode>
  edges: readonly FlowEdgeLike[]
  scale: number
  zoom: number
}): StoryWireTarget | null {
  const role = storyWireRole(input.from, input.fromHandle)
  if (!role) return null
  const others = [...input.nodes].filter((node) => node.id !== input.from.id && node.type !== 'group')
  let target: Port | null = null
  let best = Math.min(28 / Math.max(input.zoom, 0.05), 120)
  for (const node of others) {
    for (const candidate of portsFor(role, node, input.scale)) {
      const gap = distance(candidate.point, input.point)
      if (gap <= best) { best = gap; target = candidate }
    }
  }
  if (!target) {
    const hit = topNodeAt(others, input.point, 12)
    target = hit ? areaPort(role, hit, input.from, input.point, input.edges, input.scale) : null
  }
  return target
    ? { nodeId: target.node.id, point: target.point, position: target.position, connection: connectionFor(role, input.from, input.fromHandle, target) }
    : null
}
