import { planCanvasBatchConnections } from '../../batch-node-connection'
import type { CanvasFlowEdge, CanvasFlowNode } from '../../editor-types'
import { removeDisconnectedCanvasReferences } from '../../types'
import { createNodeResolver, nodeAlias } from '../alias'
import type { AgentGraphChange, AgentGraphLimits } from '../bridge-types'
import type { AgentGraph } from '../digest'
import { CanvasAgentToolError } from '../tool-error'

type Link = { from: string; to: string }
export function cleanupAgentDisconnectedReferences(nodes: CanvasFlowNode[], removed: CanvasFlowEdge[], remaining: CanvasFlowEdge[]) {
  if (!removed.length) return nodes
  return nodes.map((node) => {
    const before = node.data.generation?.referenceNodeIds
    const after = removeDisconnectedCanvasReferences(before, node.id, removed, remaining)
    return before === after ? node : {
      ...node, data: { ...node.data, generation: { ...node.data.generation, referenceNodeIds: after } },
    }
  })
}

export function planConnect(links: readonly Link[], graph: AgentGraph, limits: AgentGraphLimits) {
  const resolve = createNodeResolver(graph.nodes)
  let nodes = [...graph.nodes]
  let edges = [...graph.edges]
  let added = 0
  const touched = new Set<string>()
  const skipped: (Link & { reason: string })[] = []
  for (const link of links) {
    let source: CanvasFlowNode, target: CanvasFlowNode
    try { source = resolve(link.from); target = resolve(link.to) } catch (error) {
      if (!(error instanceof CanvasAgentToolError)) throw error
      skipped.push({ ...link, reason: error.reason }); continue
    }
    if (edges.length >= limits.maxEdges) { skipped.push({ ...link, reason: 'EDGE_LIMIT' }); continue }
    const result = planCanvasBatchConnections({ nodes, edges, sourceNodeIds: [source.id], targetNodeId: target.id, maxEdges: limits.maxEdges, allowStory: false })
    if (!result.added) { skipped.push({ ...link, reason: 'INCOMPATIBLE' }); continue }
    nodes = result.nodes; edges = result.edges; added += result.added
    touched.add(source.id); touched.add(target.id)
  }
  if (!added) throw new CanvasAgentToolError(skipped.every((item) => item.reason === 'EDGE_LIMIT') ? 'EDGE_LIMIT' : 'INCOMPATIBLE')
  const change: AgentGraphChange = { label: `连线 ${added} 条`, nodes, edges, deletedNodeIds: [], deletedEdgeIds: [], touchedNodeIds: [...touched] }
  return { change, added, skipped }
}

export function planDisconnect(links: readonly Link[], graph: AgentGraph) {
  const resolve = createNodeResolver(graph.nodes)
  const pairs = new Set(links.map((link) => `${resolve(link.from).id}\0${resolve(link.to).id}`))
  const removed = graph.edges.filter((edge) => pairs.has(`${edge.source}\0${edge.target}`))
  if (!removed.length) throw new CanvasAgentToolError('NODE_NOT_FOUND', '这两个节点之间没有连线')
  const deleted = new Set(removed.map((item) => item.id))
  const edges = graph.edges.filter((edge) => !deleted.has(edge.id))
  const change: AgentGraphChange = {
    label: `断开 ${removed.length} 条连线`, nodes: cleanupAgentDisconnectedReferences([...graph.nodes], removed, edges),
    edges, deletedNodeIds: [], deletedEdgeIds: [...deleted],
    touchedNodeIds: [...new Set(removed.flatMap(({ source, target }) => [source, target]))],
  }
  return { change, removed: removed.length }
}

export function aliasLink(source: string, target: string): Link {
  return { from: nodeAlias(source), to: nodeAlias(target) }
}
