import { canvasGroupIdsContainingMembers, fitCanvasGroupsToMembers } from '../../actions/layout'
import type { CanvasFlowNode } from '../../editor-types'
import { createNodeResolver } from '../alias'
import type { AgentGraphChange, AgentGraphLimits } from '../bridge-types'
import type { AgentGraph } from '../digest'
import { CanvasAgentToolError } from '../tool-error'

export function canvasAgentBounds(nodes: readonly CanvasFlowNode[]) {
  if (!nodes.length) return { x: 0, y: 0, width: 0, height: 0 }
  let x = Infinity, y = Infinity, right = -Infinity, bottom = -Infinity
  for (const node of nodes) {
    x = Math.min(x, node.position.x)
    y = Math.min(y, node.position.y)
    right = Math.max(right, node.position.x + (node.width || node.measured?.width || 300))
    bottom = Math.max(bottom, node.position.y + (node.height || node.measured?.height || 200))
  }
  return { x, y, width: right - x, height: bottom - y }
}

export function groupAgentMembers(graph: AgentGraph, members: CanvasFlowNode[], title: string, color?: string | null): AgentGraphChange {
  if (members.length < 2) throw new CanvasAgentToolError('BAD_INPUT')
  const bounds = canvasAgentBounds(members)
  const memberIds = new Set(members.map((node) => node.id))
  const affected = canvasGroupIdsContainingMembers([...graph.nodes], memberIds)
  const affectedSet = new Set(affected)
  const deletedNodeIds: string[] = []
  const detached = graph.nodes.flatMap((node) => {
    if (!affectedSet.has(node.id)) return [node]
    const rest = (node.data.memberIds ?? []).filter((id) => !memberIds.has(id))
    if (!rest.length) { deletedNodeIds.push(node.id); return [] }
    return [{ ...node, data: { ...node.data, memberIds: rest } }]
  })
  const group: CanvasFlowNode = {
    id: crypto.randomUUID(), type: 'group', position: { x: bounds.x - 42, y: bounds.y - 64 },
    width: bounds.width + 84, height: bounds.height + 106, zIndex: -10, selected: false,
    data: {
      title, memberIds: [...memberIds], groupColor: color ?? null,
      __server: { status: 'IDLE', taskId: null, runId: null, mediaObjectId: null, parentNodeId: null },
    },
  }
  const deleted = new Set(deletedNodeIds)
  const edges = graph.edges.filter((edge) => !deleted.has(edge.source) && !deleted.has(edge.target))
  const keptEdges = new Set(edges.map((edge) => edge.id))
  return {
    label: `分组「${title}」`, nodes: [...fitCanvasGroupsToMembers(detached, affected), group], edges,
    deletedNodeIds, deletedEdgeIds: graph.edges.filter((edge) => !keptEdges.has(edge.id)).map((edge) => edge.id),
    touchedNodeIds: [group.id, ...memberIds],
  }
}

export function planGroupNodes(input: { nodes: string[]; title?: string; color?: string }, graph: AgentGraph, limits: AgentGraphLimits) {
  if (graph.nodes.length >= limits.maxNodes) throw new CanvasAgentToolError('NODE_LIMIT')
  const resolve = createNodeResolver(graph.nodes)
  const members = input.nodes.map((ref) => resolve(ref))
  if (members.some((node) => node.type === 'group')) throw new CanvasAgentToolError('UNSUPPORTED_NODE', '组不能嵌套')
  const colors: Record<string, string> = {
    sky: '#38bdf8', violet: '#a78bfa', pink: '#f472b6', green: '#34d399',
    amber: '#fbbf24', orange: '#fb923c', blue: '#6e7bff', red: '#f87171',
  }
  return groupAgentMembers(graph, [...new Map(members.map((item) => [item.id, item])).values()], input.title ?? '组', input.color ? colors[input.color] : undefined)
}
