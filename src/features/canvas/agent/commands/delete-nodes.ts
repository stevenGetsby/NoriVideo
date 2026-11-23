import { fitCanvasGroupsToMembers } from '../../actions/layout'
import { removeDeletedCanvasReferences } from '../../reference-resolution'
import { createNodeResolver } from '../alias'
import type { AgentGraphChange } from '../bridge-types'
import type { AgentGraph } from '../digest'
import { CanvasAgentToolError } from '../tool-error'
import { cleanupAgentDisconnectedReferences } from './connect'
import { hasNodeMedia, isNodeBusy } from './node-state'

export function planDeleteNodes(input: { nodes: string[]; includeGroupMembers: boolean }, graph: AgentGraph) {
  const resolve = createNodeResolver(graph.nodes)
  const requested = input.nodes.map((ref) => resolve(ref))
  const ids = new Set(requested.map((node) => node.id))
  if (input.includeGroupMembers) {
    for (const node of graph.nodes) if (node.type === 'group' && ids.has(node.id)) {
      for (const id of node.data.memberIds ?? []) ids.add(id)
    }
  }
  const targets = graph.nodes.filter((node) => ids.has(node.id))
  if (targets.some(isNodeBusy)) throw new CanvasAgentToolError('RUNNING_NODE')
  const removed = graph.edges.filter((edge) => ids.has(edge.source) || ids.has(edge.target))
  const edges = graph.edges.filter((edge) => !ids.has(edge.source) && !ids.has(edge.target))
  const surviving = fitCanvasGroupsToMembers(graph.nodes.filter((node) => !ids.has(node.id)).map((node) =>
    node.type === 'group' ? {
      ...node, data: { ...node.data, memberIds: (node.data.memberIds ?? []).filter((id) => !ids.has(id)) },
    } : node))
  const nodes = cleanupAgentDisconnectedReferences(removeDeletedCanvasReferences(surviving, ids), removed, edges)
  const change: AgentGraphChange = {
    label: `删除 ${targets.length} 个节点`, nodes, edges,
    deletedNodeIds: targets.map((node) => node.id), deletedEdgeIds: removed.map((edge) => edge.id), touchedNodeIds: [],
  }
  return {
    change, targets, deleted: targets.length,
    needsConfirmation: targets.length > 3 || targets.some((node) =>
      hasNodeMedia(node) || (node.data.history?.length ?? 0) > 0 || (node.data.historyCount ?? 0) > 0),
  }
}
