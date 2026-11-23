import type { z } from 'zod'
import type { canvasAgentToolSchemas } from '@/lib/canvas-agent/tool-schemas'
import { arrangeCanvasGroupMembers, arrangeCanvasGroupNodes, arrangeCanvasNodes, canvasGroupIdsContainingMembers, fitCanvasGroupsToMembers } from '../../actions/layout'
import { createNodeResolver } from '../alias'
import type { AgentGraphChange } from '../bridge-types'
import type { AgentGraph } from '../digest'
import { CanvasAgentToolError } from '../tool-error'
import { canvasAgentBounds } from './group'

export function planArrange(input: z.output<typeof canvasAgentToolSchemas.arrange>, graph: AgentGraph): AgentGraphChange {
  const mode = input.mode === 'type' || input.mode === 'tidy' ? 'grid' : input.mode
  const resolve = createNodeResolver(graph.nodes)
  const edges = [...graph.edges]
  let nodes = [...graph.nodes]
  if (input.scope === 'canvas') {
    nodes = arrangeCanvasNodes(nodes, edges, input.mode)
  } else if (input.scope === 'group') {
    if (!input.group) throw new CanvasAgentToolError('BAD_INPUT')
    const group = resolve(input.group)
    if (group.type !== 'group') throw new CanvasAgentToolError('UNSUPPORTED_NODE')
    nodes = arrangeCanvasGroupMembers(nodes, group.id, mode, edges)
  } else {
    if (!input.nodes?.length) throw new CanvasAgentToolError('BAD_INPUT')
    const ids = new Set(input.nodes.map((ref) => resolve(ref, { allowGroup: false }).id))
    const subset = nodes.filter((node) => ids.has(node.id))
    const original = canvasAgentBounds(subset)
    const arranged = arrangeCanvasGroupNodes(subset, mode, edges)
    const after = canvasAgentBounds(arranged)
    const byId = new Map(arranged.map((node) => [node.id, {
      x: node.position.x + original.x - after.x,
      y: node.position.y + original.y - after.y,
    }]))
    nodes = fitCanvasGroupsToMembers(nodes.map((node) => {
      const position = byId.get(node.id)
      return position ? { ...node, position } : node
    }), canvasGroupIdsContainingMembers(nodes, ids))
  }
  const before = new Map(graph.nodes.map((node) => [node.id, node]))
  const touchedNodeIds = nodes.filter((item) => {
    const old = before.get(item.id)
    return old?.position.x !== item.position.x || old?.position.y !== item.position.y
      || old?.width !== item.width || old?.height !== item.height || old?.data.memberIds !== item.data.memberIds
  }).map((item) => item.id)
  return { label: `整理 ${touchedNodeIds.length} 个节点`, nodes, edges, touchedNodeIds, deletedNodeIds: [], deletedEdgeIds: [] }
}
