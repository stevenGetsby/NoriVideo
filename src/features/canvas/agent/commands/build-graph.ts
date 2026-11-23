import type { XYPosition } from '@xyflow/react'
import type { z } from 'zod'
import type { canvasAgentToolSchemas } from '@/lib/canvas-agent/tool-schemas'
import { planCanvasBatchConnections } from '../../batch-node-connection'
import { createFlowNode, type CanvasFlowEdge, type CanvasFlowNode } from '../../editor-types'
import { createNodeResolver, nodeAlias } from '../alias'
import type { AgentGraphChange, AgentGraphLimits } from '../bridge-types'
import type { AgentGraph } from '../digest'
import { CanvasAgentToolError } from '../tool-error'
import { normalizeAgentGenerationParams } from './generation-params'
import { canvasAgentBounds, groupAgentMembers } from './group'

type BuildInput = z.output<typeof canvasAgentToolSchemas.build_graph>
type Endpoint = BuildInput['links'][number]['from']
type Failure = { from: Endpoint; to: Endpoint; reason: 'NODE_NOT_FOUND' | 'INCOMPATIBLE' | 'EDGE_LIMIT' }
const sizeOf = (node: CanvasFlowNode) => ({ width: node.width ?? 300, height: node.height ?? 200 })

function flowColumns(input: BuildInput) {
  const adjacent = new Map(input.nodes.map(({ key }) => [key, [] as string[]]))
  const indegree = new Map(input.nodes.map(({ key }) => [key, 0]))
  const connected = new Set<string>()
  for (const { from, to } of input.links) {
    if (typeof from === 'string' || typeof to === 'string' || !adjacent.has(from.key) || !adjacent.has(to.key)) continue
    adjacent.get(from.key)!.push(to.key)
    indegree.set(to.key, indegree.get(to.key)! + 1)
    connected.add(from.key); connected.add(to.key)
  }
  const queue = input.nodes.filter(({ key }) => connected.has(key) && indegree.get(key) === 0).map(({ key }) => key)
  const layers = new Map(queue.map((key) => [key, 0]))
  const placed = new Set<string>()
  for (let i = 0; i < queue.length; i++) {
    const key = queue[i]
    placed.add(key)
    for (const target of adjacent.get(key)!) {
      layers.set(target, Math.max(layers.get(target) ?? 0, layers.get(key)! + 1))
      const amount = indegree.get(target)! - 1
      indegree.set(target, amount)
      if (!amount) queue.push(target)
    }
  }
  const last = placed.size ? Math.max(...[...placed].map((id) => layers.get(id)!)) + 1 : 0
  return input.nodes.map(({ key }) => placed.has(key) ? layers.get(key)! : last)
}

function placeNodes(nodes: CanvasFlowNode[], input: BuildInput) {
  if (input.layout === 'grid') {
    const count = Math.ceil(Math.sqrt(nodes.length))
    const width = Math.max(...nodes.map((node) => sizeOf(node).width)) + 120
    const height = Math.max(...nodes.map((node) => sizeOf(node).height)) + 60
    return nodes.map((node, index) => ({ ...node, position: { x: (index % count) * width, y: Math.floor(index / count) * height } }))
  }
  const columns = flowColumns(input)
  const widths = Array.from({ length: Math.max(...columns) + 1 }, () => 0)
  const rows = widths.map(() => 0)
  columns.forEach((column, i) => { widths[column] = Math.max(widths[column], sizeOf(nodes[i]).width) })
  let offset = 0
  const offsets = widths.map((width) => { const left = offset; offset += width + 120; return left })
  return nodes.map((node, i) => {
    const column = columns[i]
    const y = rows[column]
    rows[column] += sizeOf(node).height + 60
    return { ...node, position: { x: offsets[column], y } }
  })
}

export function planBuildGraph(input: BuildInput, graph: AgentGraph, limits: AgentGraphLimits, center: XYPosition) {
  if (graph.nodes.length + input.nodes.length + Number(input.group) > limits.maxNodes) throw new CanvasAgentToolError('NODE_LIMIT')
  if (new Set(input.nodes.map((node) => node.key)).size !== input.nodes.length) throw new CanvasAgentToolError('BAD_INPUT', 'duplicate key')
  if (input.group && input.nodes.length < 2) throw new CanvasAgentToolError('BAD_INPUT')
  const nodes = input.nodes.map((definition): CanvasFlowNode => {
    const { type, text, prompt, generation, title } = definition
    if ((text !== undefined && type !== 'text') || ((prompt !== undefined || generation) && type !== 'image' && type !== 'video')) {
      throw new CanvasAgentToolError('UNSUPPORTED_NODE')
    }
    const node = createFlowNode(type, { x: 0, y: 0 })
    return {
      ...node, selected: false,
      data: {
        ...node.data,
        ...(title ? { title } : {}),
        ...(text === undefined ? {} : { text }),
        ...(prompt === undefined ? {} : { prompt }),
        ...(generation && (type === 'image' || type === 'video')
          ? { generation: { ...node.data.generation, ...normalizeAgentGenerationParams(type, generation, node.data.generation) } }
          : {}),
      },
    }
  })
  const local = placeNodes(nodes, input)
  const bounds = canvasAgentBounds(local)
  const existing = graph.nodes.filter((node) => node.type !== 'group')
  const resolve = createNodeResolver(graph.nodes)
  let anchor: CanvasFlowNode | undefined
  if (input.near) {
    try { anchor = resolve(input.near) } catch (error) {
      if (!(error instanceof CanvasAgentToolError) || error.reason !== 'NODE_NOT_FOUND') throw error
    }
  }
  const existingBounds = canvasAgentBounds(existing)
  const origin = anchor ? { x: anchor.position.x + canvasAgentBounds([anchor]).width + 160, y: anchor.position.y }
    : existing.length ? { x: existingBounds.x + existingBounds.width + 240, y: existingBounds.y }
      : { x: center.x - bounds.width / 2, y: center.y - bounds.height / 2 }
  if (anchor) for (const node of [...existing].sort((a, b) => a.position.x - b.position.x)) {
    const rect = canvasAgentBounds([node])
    if (origin.x < rect.x + rect.width && origin.x + bounds.width > rect.x && origin.y < rect.y + rect.height && origin.y + bounds.height > rect.y) {
      origin.x = rect.x + rect.width + 160
    }
  }
  const placed = local.map((node) => ({ ...node, position: { x: node.position.x + origin.x, y: node.position.y + origin.y } }))
  let nextNodes = [...graph.nodes, ...placed]
  let nextEdges = [...graph.edges]
  const byKey = new Map(input.nodes.map(({ key }, i) => [key, placed[i].id]))
  const idFor = (endpoint: Endpoint) => typeof endpoint === 'string' ? resolve(endpoint, { allowGroup: false }).id : byKey.get(endpoint.key)
  const failed: Failure[] = []
  const newEdges: CanvasFlowEdge[] = []
  for (const link of input.links) {
    let source: string | undefined, target: string | undefined
    try { source = idFor(link.from); target = idFor(link.to) } catch { /* reported as an unresolved endpoint below */ }
    if (!source || !target) { failed.push({ ...link, reason: 'NODE_NOT_FOUND' }); continue }
    if (nextEdges.length >= limits.maxEdges) { failed.push({ ...link, reason: 'EDGE_LIMIT' }); continue }
    const outcome = planCanvasBatchConnections({
      nodes: nextNodes, edges: nextEdges, sourceNodeIds: [source], targetNodeId: target, maxEdges: limits.maxEdges, allowStory: false,
    })
    if (!outcome.added) { failed.push({ ...link, reason: 'INCOMPATIBLE' }); continue }
    nextNodes = outcome.nodes
    nextEdges = outcome.edges
    newEdges.push(nextEdges.at(-1)!)
  }
  const label = `搭建「${input.title}」（${placed.length} 个节点）`
  const change: AgentGraphChange = input.group
    ? { ...groupAgentMembers({ nodes: nextNodes, edges: nextEdges }, placed, input.title), label }
    : { label, nodes: nextNodes, edges: nextEdges, deletedNodeIds: [], deletedEdgeIds: [], touchedNodeIds: placed.map((node) => node.id) }
  return {
    change,
    blueprint: { title: input.title, nodes: placed, edges: newEdges, bounds: { ...bounds, x: origin.x, y: origin.y } },
    created: input.nodes.map(({ key }, i) => ({ key, ref: nodeAlias(placed[i].id), title: placed[i].data.title || key })),
    linkResults: { added: newEdges.length, failed },
  }
}
