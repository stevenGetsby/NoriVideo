import type { z } from 'zod'
import type { canvasAgentToolSchemas } from '@/lib/canvas-agent/tool-schemas'
import type { CanvasFlowNode } from '../../editor-types'
import { createNodeResolver, nodeAlias } from '../alias'
import { hasNodeMedia, isNodeBusy } from '../commands/node-state'
import { canvasAgentDigestRow, isAgentNodeVisible, redactCanvasAgentText } from '../digest'
import type { CanvasAgentExecutionContext } from '../executor'

function statusOf(node: CanvasFlowNode) {
  if (isNodeBusy(node)) return 'running'
  if (node.data.__server?.status === 'FAILED' || node.data.errorMessage) return 'failed'
  if (hasNodeMedia(node) || ((node.type === 'text' || node.type === 'note') && node.data.text?.trim())) return 'ready'
  return 'empty'
}

export function findAgentNodes(input: z.output<typeof canvasAgentToolSchemas.find_nodes>, ctx: CanvasAgentExecutionContext) {
  const { nodes } = ctx.bridge.getGraph()
  const bounds = ctx.bridge.getViewportBounds()
  const group = input.inGroup ? createNodeResolver(nodes)(input.inGroup) : null
  const members = group ? new Set(group.data.memberIds ?? []) : null
  const query = input.query?.trim().toLocaleLowerCase()
  const types = input.types?.length ? new Set<string>(input.types) : null
  const touched = ctx.turn.touchedNodeIds
  const matched = nodes.flatMap((node, index) => {
    if ((members && !members.has(node.id)) || (types && !types.has(node.type || 'image'))
      || (input.status && statusOf(node) !== input.status) || (input.selectedOnly && !node.selected)
      || (input.hasMedia !== undefined && input.hasMedia !== hasNodeMedia(node))) return []
    if (query && ![node.data.title, node.data.text, node.data.prompt].some((text) => text?.toLocaleLowerCase().includes(query))) return []
    const visible = isAgentNodeVisible(node, bounds)
    const recent = touched?.has(node.id) ?? false
    return [{ node, index, visible, recent, rank: node.selected ? 0 : visible ? 1 : recent ? 2 : 3 }]
  }).sort((a, b) => a.rank - b.rank || a.node.position.x - b.node.position.x || a.node.position.y - b.node.position.y)
  return { status: 'done', total: matched.length, nodes: matched.slice(0, input.limit).map(({ node, index, visible, recent }) =>
    canvasAgentDigestRow(node, index, { visible, touched: recent })) }
}

export async function readAgentNode(ref: string, ctx: CanvasAgentExecutionContext) {
  const { nodes, edges } = ctx.bridge.getGraph()
  const shell = createNodeResolver(nodes)(ref)
  const node = shell.data.__canvasUnhydrated && ctx.bridge.readNodeDetails ? await ctx.bridge.readNodeDetails(shell.id) : shell
  const byId = new Map(nodes.map((item, index) => [item.id, { item, index }]))
  const relation = (id: string, role: string | undefined) => {
    const entry = byId.get(id)
    if (!entry) return []
    return [{ ref: nodeAlias(id), title: canvasAgentDigestRow(entry.item, entry.index).title, role: redactCanvasAgentText(role, 40) }]
  }
  const generation = node.data.generation
  return {
    status: 'done', node: canvasAgentDigestRow(node, byId.get(node.id)?.index ?? 0),
    text: redactCanvasAgentText(node.data.text, 4000), prompt: redactCanvasAgentText(node.data.prompt, 4000),
    ...(generation ? { generation: {
      modelKey: redactCanvasAgentText(generation.modelKey, 120), modelLabel: redactCanvasAgentText(generation.modelLabel, 30),
      inputMode: redactCanvasAgentText(generation.inputMode, 40), aspectRatio: redactCanvasAgentText(generation.aspectRatio, 20),
      resolution: redactCanvasAgentText(generation.resolution, 20), quality: redactCanvasAgentText(generation.quality, 20),
      duration: generation.duration, generateAudio: generation.generateAudio, count: generation.count,
    } } : {}),
    incoming: edges.filter((edge) => edge.target === node.id).slice(0, 30).flatMap((edge) => relation(edge.source, edge.data?.role)),
    outgoing: edges.filter((edge) => edge.source === node.id).slice(0, 30).flatMap((edge) => relation(edge.target, edge.data?.role)),
    historyCount: node.data.history?.length ?? node.data.historyCount ?? 0,
    errorMessage: redactCanvasAgentText(node.data.errorMessage, 160),
  }
}
