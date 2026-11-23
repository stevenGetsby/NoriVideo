import { isCanvasConnectionAllowed } from '../../batch-node-connection'
import type { CanvasFlowNode } from '../../editor-types'
import { appendCanvasVideoSourceToPlaylist, isCanvasVideoSource } from '../../playlist-node-drop'
import { createNodeResolver, nodeAlias } from '../alias'
import type { AgentGraphChange, AgentGraphLimits } from '../bridge-types'
import type { AgentGraph } from '../digest'
import { CanvasAgentToolError } from '../tool-error'
import { isNodeBusy } from './node-state'

export function planPlaylist(input: { playlist: string; videos: string[] }, graph: AgentGraph, limits: AgentGraphLimits) {
  const resolve = createNodeResolver(graph.nodes)
  const playlist = resolve(input.playlist)
  if (playlist.type !== 'playlist') throw new CanvasAgentToolError('UNSUPPORTED_NODE')
  if (isNodeBusy(playlist)) throw new CanvasAgentToolError('RUNNING_NODE')
  const edges = [...graph.edges]
  let items = playlist.data.playlistItems
  let added = 0
  const skipped: { ref: string; reason: string }[] = []
  for (const ref of input.videos) {
    let source: CanvasFlowNode
    try { source = resolve(ref) } catch (error) {
      if (!(error instanceof CanvasAgentToolError)) throw error
      skipped.push({ ref: '', reason: error.reason }); continue
    }
    const alias = nodeAlias(source.id)
    if (!isCanvasVideoSource(source)) { skipped.push({ ref: alias, reason: 'unsupported' }); continue }
    if (isNodeBusy(source)) { skipped.push({ ref: alias, reason: 'not_ready' }); continue }
    const result = appendCanvasVideoSourceToPlaylist(items, source)
    if (result.outcome !== 'added') { skipped.push({ ref: alias, reason: result.outcome }); continue }
    items = result.items; added += 1
    const connection = { source: source.id, target: playlist.id, sourceHandle: 'output', targetHandle: 'input' }
    if (isCanvasConnectionAllowed(connection, graph.nodes, edges, limits.maxEdges, false)) {
      edges.push({ ...connection, id: crypto.randomUUID(), type: 'bezier', data: { role: 'INPUT_DEFAULT' } })
    }
  }
  if (!added) throw new CanvasAgentToolError('INCOMPATIBLE', skipped[0]?.reason)
  const change: AgentGraphChange = {
    label: `加入播放列表 ${added} 段`, edges, nodes: graph.nodes.map((node) => node.id === playlist.id
      ? { ...node, data: { ...node.data, playlistItems: items } } : node),
    deletedNodeIds: [], deletedEdgeIds: [], touchedNodeIds: [playlist.id],
  }
  return { change, added, skipped }
}
