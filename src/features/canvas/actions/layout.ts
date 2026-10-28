import type { CanvasFlowEdge, CanvasFlowNode } from '../editor-types'

const X_GAP = 132
const Y_GAP = 76
const MEMBER_X_GAP = 84
const MEMBER_Y_GAP = 48
export const CANVAS_GROUP_PADDING = { left: 42, right: 42, top: 64, bottom: 42 } as const
const MIN_GROUP_WIDTH = 260
const MIN_GROUP_HEIGHT = 180
const LANE_COLUMN_GAP = 64
const GROUP_LANE = 7

export type CanvasArrangeMode = 'grid' | 'horizontal' | 'vertical'
export type CanvasOrganizeMode = CanvasArrangeMode | 'type' | 'tidy'

export function canvasNodeWidth(node: CanvasFlowNode) {
  return node.width || node.measured?.width || (node.type === 'group' ? 680 : 300)
}

export function canvasNodeHeight(node: CanvasFlowNode) {
  return node.height || node.measured?.height || (node.type === 'group' ? 420 : 200)
}

type CanvasNodeBounds = {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}

export type CanvasGroupResizeRect = {
  x: number
  y: number
  width: number
  height: number
}

function nodesBounds(nodes: CanvasFlowNode[]): CanvasNodeBounds | null {
  if (nodes.length === 0) return null
  const left = Math.min(...nodes.map((node) => node.position.x))
  const top = Math.min(...nodes.map((node) => node.position.y))
  const right = Math.max(...nodes.map((node) => node.position.x + canvasNodeWidth(node)))
  const bottom = Math.max(...nodes.map((node) => node.position.y + canvasNodeHeight(node)))
  return { left, top, right, bottom, width: right - left, height: bottom - top }
}

function groupResizeViolations(rect: CanvasGroupResizeRect, required: CanvasNodeBounds) {
  return [
    Math.max(0, rect.x - required.left),
    Math.max(0, rect.y - required.top),
    Math.max(0, required.right - (rect.x + rect.width)),
    Math.max(0, required.bottom - (rect.y + rect.height)),
  ]
}

/**
 * Prevent a visual group from being resized through its own members.
 *
 * React Flow's minWidth/minHeight only constrain the total dimensions. They do
 * not know where members sit inside a visual group, so either edge could still
 * cross a node. This guard constrains all four proposed edges to the member
 * envelope plus the same padding used when groups are created and auto-fitted.
 * A legacy invalid frame may still be expanded (or resized on an unrelated
 * axis), but no resize is allowed to make an existing containment violation
 * worse.
 */
export function canResizeCanvasGroupToMembers(
  nodes: CanvasFlowNode[],
  groupId: string,
  nextRect: CanvasGroupResizeRect,
) {
  if (
    !Number.isFinite(nextRect.x)
    || !Number.isFinite(nextRect.y)
    || !Number.isFinite(nextRect.width)
    || !Number.isFinite(nextRect.height)
    || nextRect.width <= 0
    || nextRect.height <= 0
  ) return false

  const group = nodes.find((node) => node.id === groupId && node.type === 'group')
  if (!group) return false
  const memberIds = new Set(group.data.memberIds || [])
  const memberBounds = nodesBounds(nodes.filter((node) => memberIds.has(node.id) && node.type !== 'group'))
  if (!memberBounds) return true

  const required: CanvasNodeBounds = {
    left: memberBounds.left - CANVAS_GROUP_PADDING.left,
    top: memberBounds.top - CANVAS_GROUP_PADDING.top,
    right: memberBounds.right + CANVAS_GROUP_PADDING.right,
    bottom: memberBounds.bottom + CANVAS_GROUP_PADDING.bottom,
    width: memberBounds.width + CANVAS_GROUP_PADDING.left + CANVAS_GROUP_PADDING.right,
    height: memberBounds.height + CANVAS_GROUP_PADDING.top + CANVAS_GROUP_PADDING.bottom,
  }
  const currentRect: CanvasGroupResizeRect = {
    x: group.position.x,
    y: group.position.y,
    width: canvasNodeWidth(group),
    height: canvasNodeHeight(group),
  }
  const currentViolations = groupResizeViolations(currentRect, required)
  const nextViolations = groupResizeViolations(nextRect, required)
  const tolerance = 0.5
  return nextViolations.every((violation, index) => violation <= currentViolations[index] + tolerance)
}

function spatialNodeOrder(mode: CanvasArrangeMode) {
  return (left: CanvasFlowNode, right: CanvasFlowNode) => {
    if (mode === 'horizontal') {
      return left.position.x - right.position.x || left.position.y - right.position.y || left.id.localeCompare(right.id)
    }
    return left.position.y - right.position.y || left.position.x - right.position.x || left.id.localeCompare(right.id)
  }
}

/**
 * Keep a selection's visual reading order, but let real wire dependencies win.
 * This prevents a top-to-bottom arrangement from reversing an existing flow.
 */
function orderedLayoutNodes(
  nodes: CanvasFlowNode[],
  edges: CanvasFlowEdge[],
  mode: CanvasArrangeMode,
) {
  const fallbackOrder = spatialNodeOrder(mode)
  if (mode === 'grid' || edges.length === 0) return [...nodes].sort(fallbackOrder)

  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const incoming = new Map(nodes.map((node) => [node.id, 0]))
  const outgoing = new Map(nodes.map((node) => [node.id, new Set<string>()]))
  for (const edge of edges) {
    if (!nodeById.has(edge.source) || !nodeById.has(edge.target) || edge.source === edge.target) continue
    const targets = outgoing.get(edge.source)!
    if (targets.has(edge.target)) continue
    targets.add(edge.target)
    incoming.set(edge.target, (incoming.get(edge.target) || 0) + 1)
  }

  const queue = nodes.filter((node) => (incoming.get(node.id) || 0) === 0).sort(fallbackOrder)
  const ordered: CanvasFlowNode[] = []
  const emitted = new Set<string>()
  while (queue.length > 0) {
    const node = queue.shift()!
    if (emitted.has(node.id)) continue
    emitted.add(node.id)
    ordered.push(node)
    for (const targetId of outgoing.get(node.id) || []) {
      incoming.set(targetId, (incoming.get(targetId) || 0) - 1)
      if (incoming.get(targetId) === 0) queue.push(nodeById.get(targetId)!)
    }
    queue.sort(fallbackOrder)
  }

  // Cycles keep their original spatial order instead of jumping unpredictably.
  ordered.push(...nodes.filter((node) => !emitted.has(node.id)).sort(fallbackOrder))
  return ordered
}

/** Resize and reposition visual groups around their durable member list. */
export function fitCanvasGroupsToMembers(
  nodes: CanvasFlowNode[],
  requestedGroupIds?: Iterable<string>,
) {
  const requested = requestedGroupIds ? new Set(requestedGroupIds) : null
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  let changed = false
  const next = nodes.map((node) => {
    if (node.type !== 'group' || (requested && !requested.has(node.id))) return node
    const memberIds = Array.from(new Set(node.data.memberIds || [])).filter((id) => {
      const member = nodeById.get(id)
      return Boolean(member && member.type !== 'group')
    })
    const members = memberIds.map((id) => nodeById.get(id)).filter((member): member is CanvasFlowNode => Boolean(member))
    const bounds = nodesBounds(members)
    if (!bounds) {
      if (memberIds.length === (node.data.memberIds || []).length) return node
      changed = true
      return { ...node, data: { ...node.data, memberIds } }
    }

    const width = Math.max(MIN_GROUP_WIDTH, bounds.width + CANVAS_GROUP_PADDING.left + CANVAS_GROUP_PADDING.right)
    const height = Math.max(MIN_GROUP_HEIGHT, bounds.height + CANVAS_GROUP_PADDING.top + CANVAS_GROUP_PADDING.bottom)
    const position = {
      x: bounds.left - Math.max(CANVAS_GROUP_PADDING.left, (width - bounds.width) / 2),
      y: bounds.top - CANVAS_GROUP_PADDING.top,
    }
    if (
      Math.abs(node.position.x - position.x) < 0.01
      && Math.abs(node.position.y - position.y) < 0.01
      && Math.abs(canvasNodeWidth(node) - width) < 0.01
      && Math.abs(canvasNodeHeight(node) - height) < 0.01
      && memberIds.length === (node.data.memberIds || []).length
      && memberIds.every((id, index) => id === node.data.memberIds?.[index])
    ) return node
    changed = true
    return { ...node, position, width, height, data: { ...node.data, memberIds } }
  })
  return changed ? next : nodes
}

export function canvasGroupIdsContainingMembers(
  nodes: CanvasFlowNode[],
  memberIds: Iterable<string>,
) {
  const requested = new Set(memberIds)
  if (requested.size === 0) return []
  return nodes
    .filter((node) => node.type === 'group' && node.data.memberIds?.some((id) => requested.has(id)))
    .map((node) => node.id)
}

type LayoutUnit = {
  id: string
  nodeIds: string[]
  groupId: string | null
  memberIds: string[]
  origin: { x: number; y: number }
  width: number
  height: number
  offsets: Map<string, { x: number; y: number }>
  originalOrder: number
  lane: number
}

/** Production order of a unit's content: script, image, video, audio, 3D, edit list, other, then groups. */
function layoutLane(node: CanvasFlowNode) {
  if (node.type === 'group') return GROUP_LANE
  const kind = String(node.data.mediaType || node.type || '')
  if (kind === 'text' || kind === 'note') return 0
  if (kind === 'image') return 1
  if (kind === 'video' || kind === 'video_edit') return 2
  if (kind === 'audio') return 3
  if (kind === 'model3d' || kind === 'model_3d' || kind === 'studio_3d') return 4
  if (kind === 'playlist') return 5
  return 6
}

function overlapArea(left: CanvasNodeBounds, right: CanvasNodeBounds) {
  return Math.max(0, Math.min(left.right, right.right) - Math.max(left.left, right.left))
    * Math.max(0, Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top))
}

/**
 * A few legacy documents contain the same member id in multiple groups. Full
 * layout used to fit every frame around that duplicate before the first group
 * happened to claim it, which produced oversized or detached group frames.
 * Resolve one deterministic owner before constructing compound layout units.
 */
export function normalizeCanvasGroupMemberships(nodes: CanvasFlowNode[]) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const groups = nodes.filter((node) => node.type === 'group')
  const candidates = new Map<string, CanvasFlowNode[]>()

  for (const group of groups) {
    for (const memberId of new Set(group.data.memberIds || [])) {
      const member = nodeById.get(memberId)
      if (!member || member.type === 'group') continue
      candidates.set(memberId, [...(candidates.get(memberId) || []), group])
    }
  }

  const ownerByMemberId = new Map<string, string>()
  for (const [memberId, groupCandidates] of candidates) {
    if (groupCandidates.length === 1) {
      ownerByMemberId.set(memberId, groupCandidates[0].id)
      continue
    }
    const memberBounds = nodesBounds([nodeById.get(memberId)!])!
    const ranked = groupCandidates.map((group, index) => {
      const bounds = nodesBounds([group])!
      const contains = memberBounds.left >= bounds.left
        && memberBounds.top >= bounds.top
        && memberBounds.right <= bounds.right
        && memberBounds.bottom <= bounds.bottom
      const overlap = overlapArea(bounds, memberBounds) / Math.max(1, memberBounds.width * memberBounds.height)
      return { group, contains, overlap, area: bounds.width * bounds.height, index }
    }).sort((left, right) => (
      Number(right.contains) - Number(left.contains)
      || right.overlap - left.overlap
      || left.area - right.area
      || left.index - right.index
      || left.group.id.localeCompare(right.group.id)
    ))
    ownerByMemberId.set(memberId, ranked[0].group.id)
  }

  let changed = false
  const normalized = nodes.map((node) => {
    if (node.type !== 'group') return node
    const current = node.data.memberIds || []
    const memberIds = Array.from(new Set(current)).filter((id) => ownerByMemberId.get(id) === node.id)
    if (memberIds.length === current.length && memberIds.every((id, index) => id === current[index])) return node
    changed = true
    return { ...node, data: { ...node.data, memberIds } }
  })
  return changed ? normalized : nodes
}

function buildLayoutUnits(nodes: CanvasFlowNode[]) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const claimedMembers = new Set<string>()
  const units: LayoutUnit[] = []
  const unitByNodeId = new Map<string, string>()

  nodes.forEach((group, groupIndex) => {
    if (group.type !== 'group') return
    const members = (group.data.memberIds || [])
      .map((id) => nodeById.get(id))
      .filter((node): node is CanvasFlowNode => Boolean(node && node.type !== 'group' && !claimedMembers.has(node.id)))
    members.forEach((node) => claimedMembers.add(node.id))

    const left = group.position.x
    const top = group.position.y
    const right = group.position.x + canvasNodeWidth(group)
    const bottom = group.position.y + canvasNodeHeight(group)
    const offsets = new Map<string, { x: number; y: number }>([
      [group.id, { x: 0, y: 0 }],
      ...members.map((node) => [node.id, { x: node.position.x - left, y: node.position.y - top }] as const),
    ])
    const unit: LayoutUnit = {
      id: `group:${group.id}`,
      nodeIds: [group.id, ...members.map((node) => node.id)],
      groupId: group.id,
      memberIds: members.map((node) => node.id),
      origin: { x: left, y: top },
      width: Math.max(MIN_GROUP_WIDTH, right - left),
      height: Math.max(MIN_GROUP_HEIGHT, bottom - top),
      offsets,
      originalOrder: groupIndex,
      lane: GROUP_LANE,
    }
    units.push(unit)
    unit.nodeIds.forEach((id) => unitByNodeId.set(id, unit.id))
  })

  nodes.forEach((node, index) => {
    if (node.type === 'group' || claimedMembers.has(node.id)) return
    const unit: LayoutUnit = {
      id: `node:${node.id}`,
      nodeIds: [node.id],
      groupId: null,
      memberIds: [],
      origin: { ...node.position },
      width: canvasNodeWidth(node),
      height: canvasNodeHeight(node),
      offsets: new Map([[node.id, { x: 0, y: 0 }]]),
      originalOrder: index,
      lane: layoutLane(node),
    }
    units.push(unit)
    unitByNodeId.set(node.id, unit.id)
  })

  return { units, unitByNodeId }
}

function unitGraph(units: LayoutUnit[], edges: CanvasFlowEdge[], unitByNodeId: Map<string, string>) {
  const incoming = new Map(units.map((unit) => [unit.id, 0]))
  const predecessors = new Map(units.map((unit) => [unit.id, [] as string[]]))
  const outgoing = new Map(units.map((unit) => [unit.id, [] as string[]]))
  for (const edge of edges) {
    const source = unitByNodeId.get(edge.source)
    const target = unitByNodeId.get(edge.target)
    if (!source || !target || source === target || outgoing.get(source)?.includes(target)) continue
    outgoing.get(source)?.push(target)
    predecessors.get(target)?.push(source)
    incoming.set(target, (incoming.get(target) || 0) + 1)
  }
  const unitById = new Map(units.map((unit) => [unit.id, unit]))
  const originalSort = (left: string, right: string) => {
    const a = unitById.get(left)!
    const b = unitById.get(right)!
    return a.origin.y - b.origin.y || a.origin.x - b.origin.x || a.originalOrder - b.originalOrder
  }
  const queue = units.filter((unit) => (incoming.get(unit.id) || 0) === 0).map((unit) => unit.id).sort(originalSort)
  const levels = new Map(queue.map((id) => [id, 0]))
  const processed = new Set<string>()
  while (queue.length) {
    const current = queue.shift()!
    processed.add(current)
    for (const next of outgoing.get(current) || []) {
      levels.set(next, Math.max(levels.get(next) || 0, (levels.get(current) || 0) + 1))
      incoming.set(next, (incoming.get(next) || 0) - 1)
      if (incoming.get(next) === 0) queue.push(next)
    }
    queue.sort(originalSort)
  }
  const finalLevel = Math.max(0, ...levels.values()) + 1
  units.forEach((unit) => { if (!processed.has(unit.id)) levels.set(unit.id, finalLevel) })
  return { levels, predecessors }
}

function layeredUnitPositions(units: LayoutUnit[], edges: CanvasFlowEdge[], unitByNodeId: Map<string, string>, mode: 'horizontal' | 'vertical') {
  const { levels, predecessors } = unitGraph(units, edges, unitByNodeId)
  const buckets = new Map<number, LayoutUnit[]>()
  units.forEach((unit) => {
    const level = levels.get(unit.id) || 0
    buckets.set(level, [...(buckets.get(level) || []), unit])
  })
  const orderedLevels = Array.from(buckets.keys()).sort((left, right) => left - right)
  const orderByUnit = new Map<string, number>()
  orderedLevels.forEach((level) => {
    const bucket = buckets.get(level) || []
    bucket.sort((left, right) => {
      const parentOrder = (unit: LayoutUnit) => {
        const known = (predecessors.get(unit.id) || []).map((id) => orderByUnit.get(id)).filter((value): value is number => value !== undefined)
        return known.length ? known.reduce((sum, value) => sum + value, 0) / known.length : unit.origin.y
      }
      return parentOrder(left) - parentOrder(right) || left.origin.y - right.origin.y || left.originalOrder - right.originalOrder
    })
    bucket.forEach((unit, index) => orderByUnit.set(unit.id, index))
  })

  const left = Math.min(...units.map((unit) => unit.origin.x))
  const top = Math.min(...units.map((unit) => unit.origin.y))
  const secondaryTotals = orderedLevels.map((level) => {
    const bucket = buckets.get(level) || []
    return bucket.reduce((sum, unit) => sum + (mode === 'horizontal' ? unit.height : unit.width), 0) + Math.max(0, bucket.length - 1) * (mode === 'horizontal' ? Y_GAP : X_GAP)
  })
  const maxSecondary = Math.max(0, ...secondaryTotals)
  const positions = new Map<string, { x: number; y: number }>()
  let primary = mode === 'horizontal' ? left : top

  orderedLevels.forEach((level, levelIndex) => {
    const bucket = buckets.get(level) || []
    let secondary = (mode === 'horizontal' ? top : left) + Math.max(0, (maxSecondary - secondaryTotals[levelIndex]) / 2)
    let primarySize = 0
    bucket.forEach((unit) => {
      positions.set(unit.id, mode === 'horizontal' ? { x: primary, y: secondary } : { x: secondary, y: primary })
      secondary += (mode === 'horizontal' ? unit.height + Y_GAP : unit.width + X_GAP)
      primarySize = Math.max(primarySize, mode === 'horizontal' ? unit.width : unit.height)
    })
    primary += primarySize + (mode === 'horizontal' ? X_GAP : Y_GAP)
  })
  return positions
}

function gridUnitPositions(units: LayoutUnit[]) {
  const arranged = [...units].sort((left, right) => left.origin.y - right.origin.y || left.origin.x - right.origin.x || left.originalOrder - right.originalOrder)
  const columns = Math.max(1, Math.ceil(Math.sqrt(arranged.length * 1.35)))
  const rows = Math.ceil(arranged.length / columns)
  const columnWidths = Array.from({ length: columns }, () => 0)
  const rowHeights = Array.from({ length: rows }, () => 0)
  arranged.forEach((unit, index) => {
    columnWidths[index % columns] = Math.max(columnWidths[index % columns], unit.width)
    rowHeights[Math.floor(index / columns)] = Math.max(rowHeights[Math.floor(index / columns)], unit.height)
  })
  const left = Math.min(...units.map((unit) => unit.origin.x))
  const top = Math.min(...units.map((unit) => unit.origin.y))
  const xOffsets = columnWidths.map((_, index) => left + columnWidths.slice(0, index).reduce((sum, value) => sum + value + X_GAP, 0))
  const yOffsets = rowHeights.map((_, index) => top + rowHeights.slice(0, index).reduce((sum, value) => sum + value + Y_GAP, 0))
  return new Map(arranged.map((unit, index) => [unit.id, { x: xOffsets[index % columns], y: yOffsets[Math.floor(index / columns)] }]))
}

function readingOrder(left: LayoutUnit, right: LayoutUnit) {
  return left.origin.y - right.origin.y || left.origin.x - right.origin.x || left.originalOrder - right.originalOrder
}

/**
 * One kanban-style column per content type, in production order. Within a
 * column units keep their on-canvas reading order; a crowded type wraps into
 * evenly filled sub-columns so no single column grows into a long strip.
 */
function typeUnitPositions(units: LayoutUnit[]) {
  const lanes = new Map<number, LayoutUnit[]>()
  for (const unit of [...units].sort(readingOrder)) lanes.set(unit.lane, [...(lanes.get(unit.lane) || []), unit])
  const busiest = Math.max(...Array.from(lanes.values(), (members) => members.length))
  const rowsPerColumn = Math.max(4, Math.ceil(Math.sqrt(busiest * 1.6)))
  const top = Math.min(...units.map((unit) => unit.origin.y))
  const positions = new Map<string, { x: number; y: number }>()
  let x = Math.min(...units.map((unit) => unit.origin.x))

  for (const lane of Array.from(lanes.keys()).sort((left, right) => left - right)) {
    const members = lanes.get(lane)!
    const columnCount = Math.ceil(members.length / rowsPerColumn)
    const perColumn = Math.ceil(members.length / columnCount)
    for (let index = 0; index < columnCount; index += 1) {
      const column = members.slice(index * perColumn, (index + 1) * perColumn)
      const width = Math.max(...column.map((unit) => unit.width))
      let y = top
      for (const unit of column) {
        positions.set(unit.id, { x: x + (width - unit.width) / 2, y })
        y += unit.height + Y_GAP
      }
      x += width + (index < columnCount - 1 ? LANE_COLUMN_GAP : 0)
    }
    x += X_GAP
  }
  return positions
}

/**
 * Keep the author's rows and left-to-right order, but make them tidy: units
 * that already share a horizontal band become one row, rows are stacked with
 * even gaps, left-aligned and centred on the row's tallest unit.
 */
function tidyUnitPositions(units: LayoutUnit[]) {
  const centreY = (unit: LayoutUnit) => unit.origin.y + unit.height / 2
  const byCentre = [...units].sort((left, right) => centreY(left) - centreY(right) || readingOrder(left, right))
  const rows: LayoutUnit[][] = []
  let anchor: LayoutUnit | null = null
  for (const unit of byCentre) {
    const shared = anchor
      ? Math.min(anchor.origin.y + anchor.height, unit.origin.y + unit.height) - Math.max(anchor.origin.y, unit.origin.y)
      : 0
    if (anchor && shared >= Math.min(anchor.height, unit.height) * 0.5) {
      rows[rows.length - 1].push(unit)
    } else {
      rows.push([unit])
      anchor = unit
    }
  }

  const left = Math.min(...units.map((unit) => unit.origin.x))
  let y = Math.min(...units.map((unit) => unit.origin.y))
  const positions = new Map<string, { x: number; y: number }>()
  for (const row of rows) {
    row.sort((a, b) => a.origin.x - b.origin.x || a.originalOrder - b.originalOrder)
    const rowHeight = Math.max(...row.map((unit) => unit.height))
    let x = left
    for (const unit of row) {
      positions.set(unit.id, { x, y: y + (rowHeight - unit.height) / 2 })
      x += unit.width + X_GAP
    }
    y += rowHeight + Y_GAP
  }
  return positions
}

/**
 * Arrange the entire graph as compound units. A group and its members move as
 * one block, so automatic layout can never leave a group behind or scatter its
 * children. Cross-group edges determine the left-to-right tree levels.
 */
export function arrangeCanvasNodes(
  nodes: CanvasFlowNode[],
  edges: CanvasFlowEdge[],
  mode: CanvasOrganizeMode,
) {
  if (nodes.length === 0) return nodes
  const preparedNodes = fitCanvasGroupsToMembers(normalizeCanvasGroupMemberships(nodes))
  const { units, unitByNodeId } = buildLayoutUnits(preparedNodes)
  if (units.length === 0) return nodes
  const positions = mode === 'grid'
    ? gridUnitPositions(units)
    : mode === 'type'
      ? typeUnitPositions(units)
      : mode === 'tidy'
        ? tidyUnitPositions(units)
        : layeredUnitPositions(units, edges, unitByNodeId, mode)
  const placement = new Map<string, { unit: LayoutUnit; position: { x: number; y: number } }>()
  units.forEach((unit) => {
    const position = positions.get(unit.id) || unit.origin
    unit.nodeIds.forEach((id) => placement.set(id, { unit, position }))
  })

  return preparedNodes.map((node) => {
    const entry = placement.get(node.id)
    if (!entry) return node
    const offset = entry.unit.offsets.get(node.id) || { x: 0, y: 0 }
    const next = { ...node, position: { x: entry.position.x + offset.x, y: entry.position.y + offset.y } }
    if (node.id !== entry.unit.groupId) return next
    return {
      ...next,
      width: entry.unit.width,
      height: entry.unit.height,
      data: { ...next.data, memberIds: entry.unit.memberIds },
    }
  })
}

export function arrangeCanvasGroupNodes(
  nodes: CanvasFlowNode[],
  mode: CanvasArrangeMode,
  edges: CanvasFlowEdge[] = [],
) {
  if (nodes.length === 0) return nodes
  const arranged = orderedLayoutNodes(nodes, edges, mode)
  const left = Math.min(...arranged.map((node) => node.position.x))
  const top = Math.min(...arranged.map((node) => node.position.y))
  const positions = new Map<string, { x: number; y: number }>()

  if (mode === 'grid') {
    const columns = Math.max(1, Math.ceil(Math.sqrt(arranged.length * 1.35)))
    const rows = Math.ceil(arranged.length / columns)
    const columnWidths = Array.from({ length: columns }, () => 0)
    const rowHeights = Array.from({ length: rows }, () => 0)
    arranged.forEach((node, index) => {
      columnWidths[index % columns] = Math.max(columnWidths[index % columns], canvasNodeWidth(node))
      rowHeights[Math.floor(index / columns)] = Math.max(rowHeights[Math.floor(index / columns)], canvasNodeHeight(node))
    })
    const xOffsets = columnWidths.map((_, index) => left + columnWidths.slice(0, index).reduce((sum, value) => sum + value + MEMBER_X_GAP, 0))
    const yOffsets = rowHeights.map((_, index) => top + rowHeights.slice(0, index).reduce((sum, value) => sum + value + MEMBER_Y_GAP, 0))
    arranged.forEach((node, index) => {
      const column = index % columns
      const row = Math.floor(index / columns)
      positions.set(node.id, {
        x: xOffsets[column] + (columnWidths[column] - canvasNodeWidth(node)) / 2,
        y: yOffsets[row] + (rowHeights[row] - canvasNodeHeight(node)) / 2,
      })
    })
  } else if (mode === 'horizontal') {
    const maxHeight = Math.max(...arranged.map(canvasNodeHeight))
    let x = left
    arranged.forEach((node) => {
      positions.set(node.id, { x, y: top + (maxHeight - canvasNodeHeight(node)) / 2 })
      x += canvasNodeWidth(node) + MEMBER_X_GAP
    })
  } else {
    const maxWidth = Math.max(...arranged.map(canvasNodeWidth))
    let y = top
    arranged.forEach((node) => {
      positions.set(node.id, { x: left + (maxWidth - canvasNodeWidth(node)) / 2, y })
      y += canvasNodeHeight(node) + MEMBER_Y_GAP
    })
  }
  return nodes.map((node) => ({ ...node, position: positions.get(node.id) || node.position }))
}

/**
 * Arrange one group's members while keeping the frame anchored. The frame is
 * resized from the final member geometry, so members can never visually leave
 * a group while still being carried by it.
 */
export function arrangeCanvasGroupMembers(
  nodes: CanvasFlowNode[],
  groupId: string,
  mode: CanvasArrangeMode,
  edges: CanvasFlowEdge[] = [],
) {
  const group = nodes.find((node) => node.id === groupId && node.type === 'group')
  if (!group) return nodes
  const memberIdSet = new Set(group.data.memberIds || [])
  const members = nodes.filter((node) => memberIdSet.has(node.id) && node.type !== 'group')
  if (members.length === 0) return nodes

  const arranged = arrangeCanvasGroupNodes(members, mode, edges)
  const bounds = nodesBounds(arranged)
  if (!bounds) return nodes
  const width = Math.max(MIN_GROUP_WIDTH, bounds.width + CANVAS_GROUP_PADDING.left + CANVAS_GROUP_PADDING.right)
  const height = Math.max(MIN_GROUP_HEIGHT, bounds.height + CANVAS_GROUP_PADDING.top + CANVAS_GROUP_PADDING.bottom)
  const desiredLeft = group.position.x + Math.max(CANVAS_GROUP_PADDING.left, (width - bounds.width) / 2)
  const desiredTop = group.position.y + CANVAS_GROUP_PADDING.top
  const dx = desiredLeft - bounds.left
  const dy = desiredTop - bounds.top
  const positionById = new Map(arranged.map((node) => [node.id, {
    x: node.position.x + dx,
    y: node.position.y + dy,
  }]))
  const memberIds = arranged.map((node) => node.id)

  return nodes.map((node) => {
    if (node.id === group.id) {
      return { ...node, width, height, data: { ...node.data, memberIds } }
    }
    const position = positionById.get(node.id)
    return position ? { ...node, position } : node
  })
}
