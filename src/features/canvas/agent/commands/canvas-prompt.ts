import type { XYPosition } from '@xyflow/react'
import {
  findCanvasGlobalStylePromptNode, findCanvasVideoPrefixPromptNode,
  normalizeCanvasGlobalStylePrompt, normalizeCanvasVideoPrefixPrompt,
} from '@/lib/canvas/global-style-prompt'
import { createFlowNode } from '../../editor-types'
import type { AgentGraphChange, AgentGraphLimits } from '../bridge-types'
import type { AgentGraph } from '../digest'
import { CanvasAgentToolError } from '../tool-error'
import { canvasAgentBounds } from './group'
import { isNodeBusy } from './node-state'

export function planCanvasPrompt(input: { kind: 'global_style' | 'video_prefix'; text: string }, graph: AgentGraph, limits: AgentGraphLimits, center: XYPosition): AgentGraphChange | null {
  const style = input.kind === 'global_style'
  const flag = style ? 'globalStylePrompt' : 'videoPrefixPrompt'
  const title = style ? '全局风格' : '视频前置提示词'
  const text = (style ? normalizeCanvasGlobalStylePrompt : normalizeCanvasVideoPrefixPrompt)(input.text)
  const found = (style ? findCanvasGlobalStylePromptNode : findCanvasVideoPrefixPromptNode)(graph.nodes)
  const marked = graph.nodes.filter((node) => (node.type === 'note' || node.type === 'text') && node.data[flag] === true)
  const current = found ? graph.nodes.find((node) => node.id === found.id) : marked.length === 1 ? marked[0] : undefined
  if (!current && marked.length > 1) throw new CanvasAgentToolError('AMBIGUOUS_NODE')
  const rest = { edges: [...graph.edges], deletedNodeIds: [], deletedEdgeIds: [] }
  if (current) {
    if (isNodeBusy(current)) throw new CanvasAgentToolError('RUNNING_NODE')
    const nodes = graph.nodes.map((node) => node.id === current.id
      ? { ...node, data: { ...node.data, [flag]: Boolean(text), ...(text ? { text, textMarks: [] } : {}) } } : node)
    return { label: `${text ? '设定' : '清除'}${title}`, nodes, ...rest, touchedNodeIds: [current.id] }
  }
  if (!text) return null
  if (graph.nodes.length >= limits.maxNodes) throw new CanvasAgentToolError('NODE_LIMIT')
  const content = graph.nodes.filter((node) => node.type !== 'group')
  const bounds = canvasAgentBounds(content)
  const global = !style && findCanvasGlobalStylePromptNode(graph.nodes)
  const globalNode = global ? graph.nodes.find((node) => node.id === global.id) : undefined
  const position = globalNode ? { x: globalNode.position.x, y: globalNode.position.y + 240 }
    : content.length ? { x: bounds.x - 360, y: bounds.y } : center
  const node = createFlowNode('text', position)
  const nodes = [...graph.nodes, { ...node, selected: false, data: { ...node.data, title, text, [flag]: true } }]
  return { label: `设定${title}`, nodes, ...rest, touchedNodeIds: [node.id] }
}
