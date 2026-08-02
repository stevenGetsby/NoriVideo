import type { CanvasFlowNode } from '../editor-types'

type NodeBounds = {
  left: number
  top: number
  right: number
  bottom: number
}

const GROUP_ENTRY_INSET = { left: 18, right: 18, top: 48, bottom: 18 }
const GROUP_RETAIN_OVERLAP_RATIO = 0.6

function finitePositive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function nodeBounds(node: CanvasFlowNode): NodeBounds {
  const width = finitePositive(node.width)
    ? node.width
    : finitePositive(node.measured?.width)
      ? node.measured.width
      : node.type === 'group' ? 680 : 300
  const height = finitePositive(node.height)
    ? node.height
    : finitePositive(node.measured?.height)
      ? node.measured.height
      : node.type === 'group' ? 420 : 200

  return {
    left: node.position.x,
    top: node.position.y,
    right: node.position.x + width,
    bottom: node.position.y + height,
  }
}

function fullyContains(container: NodeBounds, item: NodeBounds) {
  return item.left >= container.left
    && item.top >= container.top
    && item.right <= container.right
    && item.bottom <= container.bottom
}

function insetBounds(bounds: NodeBounds) {
  const horizontal = Math.min(GROUP_ENTRY_INSET.left + GROUP_ENTRY_INSET.right, Math.max(0, bounds.right - bounds.left - 2))
  const vertical = Math.min(GROUP_ENTRY_INSET.top + GROUP_ENTRY_INSET.bottom, Math.max(0, bounds.bottom - bounds.top - 2))
  const horizontalScale = horizontal / (GROUP_ENTRY_INSET.left + GROUP_ENTRY_INSET.right)
  const verticalScale = vertical / (GROUP_ENTRY_INSET.top + GROUP_ENTRY_INSET.bottom)
  return {
    left: bounds.left + GROUP_ENTRY_INSET.left * horizontalScale,
    top: bounds.top + GROUP_ENTRY_INSET.top * verticalScale,
    right: bounds.right - GROUP_ENTRY_INSET.right * horizontalScale,
    bottom: bounds.bottom - GROUP_ENTRY_INSET.bottom * verticalScale,
  }
}

function overlapArea(left: NodeBounds, right: NodeBounds) {
  const width = Math.max(0, Math.min(left.right, right.right) - Math.max(left.left, right.left))
  const height = Math.max(0, Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top))
  return width * height
}

function retainsMembership(group: NodeBounds, item: NodeBounds) {
  const center = {
    x: (item.left + item.right) / 2,
    y: (item.top + item.bottom) / 2,
  }
  const centerInside = center.x >= group.left
    && center.x <= group.right
    && center.y >= group.top
    && center.y <= group.bottom
  if (!centerInside) return false
  return overlapArea(group, item) / Math.max(1, boundsArea(item)) >= GROUP_RETAIN_OVERLAP_RATIO
}

function boundsArea(bounds: NodeBounds) {
  return Math.max(0, bounds.right - bounds.left) * Math.max(0, bounds.bottom - bounds.top)
}

/**
 * Reconciles membership for nodes that have just been dragged.
 *
 * A creative/production node can belong to at most one group. When several
 * group bounds contain it, the smallest group wins. Group nodes never become
 * members themselves. If a dragged selection contains a group, its existing
 * members are treated as being carried by that group and retain membership.
 */
export function reconcileDraggedNodeGroupMembership(
  nodes: CanvasFlowNode[],
  draggedNodeIds: Iterable<string>,
) {
  const draggedIds = new Set(draggedNodeIds)
  if (draggedIds.size === 0) return nodes

  const groups = nodes.filter((node) => node.type === 'group')
  if (groups.length === 0) return nodes

  const carriedMemberIds = new Set<string>()
  for (const group of groups) {
    if (!draggedIds.has(group.id)) continue
    for (const memberId of group.data.memberIds || []) carriedMemberIds.add(memberId)
  }

  const movedNodes = nodes.filter((node) => (
    draggedIds.has(node.id)
    && node.type !== 'group'
    && !carriedMemberIds.has(node.id)
  ))
  if (movedNodes.length === 0) return nodes

  const targetGroupByNodeId = new Map<string, string>()
  for (const movedNode of movedNodes) {
    const movedBounds = nodeBounds(movedNode)
    let target: { id: string; area: number } | null = null

    for (const group of groups) {
      const groupBounds = nodeBounds(group)
      if (!fullyContains(insetBounds(groupBounds), movedBounds)) continue
      const area = boundsArea(groupBounds)
      if (!target || area < target.area) target = { id: group.id, area }
    }

    // Existing members get a small hysteresis zone. A one-pixel boundary
    // crossing should not detach a node, while a deliberate drag outside does.
    if (!target) {
      for (const group of groups) {
        if (!group.data.memberIds?.includes(movedNode.id)) continue
        const groupBounds = nodeBounds(group)
        if (!retainsMembership(groupBounds, movedBounds)) continue
        const area = boundsArea(groupBounds)
        if (!target || area < target.area) target = { id: group.id, area }
      }
    }

    if (target) targetGroupByNodeId.set(movedNode.id, target.id)
  }

  const movedIds = new Set(movedNodes.map((node) => node.id))
  let changed = false
  const next = nodes.map((node) => {
    if (node.type !== 'group') return node

    const currentMemberIds = node.data.memberIds || []
    const retainedMemberIds = currentMemberIds.filter((id) => (
      !movedIds.has(id) || targetGroupByNodeId.get(id) === node.id
    ))
    const retainedIds = new Set(retainedMemberIds)
    const enteringMemberIds = movedNodes
      .filter((movedNode) => (
        targetGroupByNodeId.get(movedNode.id) === node.id
        && !retainedIds.has(movedNode.id)
      ))
      .map((movedNode) => movedNode.id)
    const memberIds = [...retainedMemberIds, ...enteringMemberIds]

    if (
      memberIds.length === currentMemberIds.length
      && memberIds.every((id, index) => id === currentMemberIds[index])
    ) return node

    changed = true
    return { ...node, data: { ...node.data, memberIds } }
  })

  return changed ? next : nodes
}
