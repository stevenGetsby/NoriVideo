import type { z } from 'zod'
import type { canvasAgentToolSchemas } from '@/lib/canvas-agent/tool-schemas'
import type { CanvasFlowNode } from '../../editor-types'
import { createNodeResolver, nodeAlias } from '../alias'
import type { AgentGraphChange } from '../bridge-types'
import type { AgentGraph } from '../digest'
import { CanvasAgentToolError } from '../tool-error'
import { normalizeAgentGenerationParams } from './generation-params'
import { isNodeBusy } from './node-state'

type Input = z.output<typeof canvasAgentToolSchemas.update_nodes>

export function planUpdateNodes(input: Input, graph: AgentGraph) {
  const resolve = createNodeResolver(graph.nodes)
  const updates = new Map<string, CanvasFlowNode>()
  const results: { ref: string; ok: boolean; reason?: string }[] = []
  for (const patch of input.updates) {
    let ref = ''
    try {
      const base = resolve(patch.node)
      ref = nodeAlias(base.id)
      const node = updates.get(base.id) ?? base
      const kind = node.type
      if (isNodeBusy(node)) throw new CanvasAgentToolError('RUNNING_NODE')
      const generator = kind === 'image' || kind === 'video'
      if (kind?.startsWith('production_') || (patch.text !== undefined && kind !== 'text' && kind !== 'note')
        || ((patch.prompt !== undefined || patch.generation) && !generator)) throw new CanvasAgentToolError('UNSUPPORTED_NODE')
      if (patch.title === undefined && patch.text === undefined && patch.prompt === undefined && !patch.generation) throw new CanvasAgentToolError('BAD_INPUT')
      updates.set(node.id, {
        ...node,
        data: {
          ...node.data,
          ...(patch.title !== undefined ? { title: patch.title } : {}),
          ...(patch.text !== undefined ? { text: patch.text, textMarks: [] } : {}),
          ...(patch.prompt !== undefined ? { prompt: patch.prompt } : {}),
          ...(generator && patch.generation ? { generation: {
            ...node.data.generation, ...normalizeAgentGenerationParams(kind, patch.generation, node.data.generation),
          } } : {}),
        },
      })
      results.push({ ref, ok: true })
    } catch (error) {
      if (!(error instanceof CanvasAgentToolError)) throw error
      results.push({ ref, ok: false, reason: error.reason })
    }
  }
  if (!updates.size) throw new CanvasAgentToolError(results[0]?.reason ?? 'BAD_INPUT')
  const label = updates.size === 1 ? `修改「${updates.values().next().value?.data.title || '节点'}」` : `修改 ${updates.size} 个节点`
  const change: AgentGraphChange = {
    label, nodes: graph.nodes.map((node) => updates.get(node.id) ?? node), edges: [...graph.edges],
    touchedNodeIds: [...updates.keys()], deletedNodeIds: [], deletedEdgeIds: [],
  }
  return { change, results }
}
