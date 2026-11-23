import type { CanvasAgentDigest } from '@/lib/canvas-agent/context-schema'
import { DEFAULT_NODE_SIZES, type CanvasFlowEdge, type CanvasFlowNode } from '../editor-types'
import { nodeAlias } from './alias'
import { isNodeBusy, nodeMedia } from './commands/node-state'

export type AgentGraph = { nodes: readonly CanvasFlowNode[]; edges: readonly CanvasFlowEdge[] }
type Rect = { x: number; y: number; width: number; height: number }
type Row = CanvasAgentDigest['rows'][number]
type Options = { title: string; viewportBounds: Rect; touchedIds?: readonly string[] }

const labels: Record<string, string> = {
  note: '便签', text: '文本', image: '图片', video: '视频', audio: '音频',
  model_3d: '3D 模型', studio_3d: '三维工作室', playlist: '播放列表', group: '分组', video_edit: '视频剪辑',
}
const MAX_DIGEST_BYTES = 48 * 1024
const textEncoder = new TextEncoder()

export function redactCanvasAgentText(value: string | null | undefined, cap: number): string {
  return (value ?? '').slice(0, Math.max(2048, cap + 512))
    .replace(/(?:https?:\/\/|(?:data|blob):|\/api\/(?:media|storage|uploads)\/)[^\s<>"']*/giu, '〔链接省略〕')
    .replace(/\b[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\b/giu, '〔标识省略〕')
    .replace(/[\r\n]+/gu, ' ').trim().slice(0, cap)
}

export function isAgentNodeVisible(node: CanvasFlowNode, rect: Rect): boolean {
  if (node.hidden) return false
  const { x, y } = node.position
  const defaults = DEFAULT_NODE_SIZES[node.type ?? 'image'] ?? { width: 300, height: 200 }
  const width = node.measured?.width ?? node.width ?? defaults.width
  const height = node.measured?.height ?? node.height ?? defaults.height
  return x + width > rect.x && x < rect.x + rect.width && y + height > rect.y && y < rect.y + rect.height
}

export function canvasAgentDigestRow(node: CanvasFlowNode, index: number, options: {
  visible?: boolean; touched?: boolean; group?: string
} = {}): Row {
  const type = redactCanvasAgentText(node.type, 40) || 'image'
  const text = type === 'text' || type === 'note' ? node.data.text
    : type === 'image' || type === 'video' ? node.data.prompt : undefined
  const snippet = redactCanvasAgentText(text, 80)
  const flags: NonNullable<Row['flags']> = []
  if (node.selected) flags.push('selected')
  if (options.visible) flags.push('visible')
  if (options.touched) flags.push('touched')
  if (node.data.globalStylePrompt) flags.push('global_style')
  if (node.data.videoPrefixPrompt) flags.push('video_prefix')
  const model = redactCanvasAgentText(node.data.generation?.modelLabel, 30)
  const media = nodeMedia(node)
  const status = isNodeBusy(node) ? 'running' : node.data.__server?.status === 'FAILED' || node.data.errorMessage ? 'failed' : undefined
  return {
    ref: nodeAlias(node.id), type,
    title: redactCanvasAgentText(node.data.title, 40) || `${labels[type] || '节点'} ${index + 1}`,
    ...(status ? { status } : {}),
    ...(media ? { media } : {}),
    ...(snippet ? { snippet } : {}),
    ...(options.group ? { group: options.group } : {}),
    ...(flags.length ? { flags } : {}),
    ...(model ? { model } : {}),
  }
}

export function buildCanvasDigest(graph: AgentGraph, options: Options): CanvasAgentDigest {
  const { nodes, edges } = graph
  const touched = new Set(options.touchedIds)
  const visible = new Set(nodes.filter((node) => isAgentNodeVisible(node, options.viewportBounds)).map((node) => node.id))
  const focus = new Set(nodes.filter((node) => node.selected || visible.has(node.id)).map((node) => node.id))
  const nearby = new Set<string>()
  for (const edge of edges) {
    if (focus.has(edge.source)) nearby.add(edge.target)
    if (focus.has(edge.target)) nearby.add(edge.source)
  }
  const groups = nodes.filter((node) => node.type === 'group')
  const groupByMember = new Map<string, string>()
  for (const group of groups) {
    const alias = nodeAlias(group.id)
    for (const member of group.data.memberIds ?? []) if (!groupByMember.has(member)) groupByMember.set(member, alias)
  }
  const ranked = nodes.map((node, index) => ({
    node, index, rank: node.selected ? 0 : visible.has(node.id) ? 1 : touched.has(node.id) ? 2
      : node.data.globalStylePrompt || node.data.videoPrefixPrompt ? 3 : nearby.has(node.id) ? 4
        : isNodeBusy(node) || node.data.__server?.status === 'FAILED' || node.data.errorMessage ? 5 : 6,
  })).sort((a, b) => a.rank - b.rank || a.node.position.x - b.node.position.x || a.node.position.y - b.node.position.y || a.index - b.index)
  const selection = ranked.filter(({ node }) => node.selected).slice(0, 50).map(({ node }) => nodeAlias(node.id))
  const top = ranked.slice(0, 160).map(({ node, index }) => ({
    id: node.id, row: canvasAgentDigestRow(node, index, {
      visible: visible.has(node.id), touched: touched.has(node.id), group: groupByMember.get(node.id),
    }),
  }))
  const canvas = { title: redactCanvasAgentText(options.title, 80), nodeCount: nodes.length, edgeCount: edges.length, groupCount: groups.length }
  const globalStyle = redactCanvasAgentText(nodes.find((node) => node.data.globalStylePrompt)?.data.text, 200)
  const videoPrefix = redactCanvasAgentText(nodes.find((node) => node.data.videoPrefixPrompt)?.data.text, 200)

  const create = (size: number): CanvasAgentDigest => {
    const entries = top.slice(0, size)
    const aliases = new Map(entries.map(({ id, row }) => [id, row.ref]))
    const visibleEdges: CanvasAgentDigest['edges'] = []
    for (const edge of edges) {
      const source = aliases.get(edge.source)
      const target = aliases.get(edge.target)
      if (!source || !target) continue
      const role = redactCanvasAgentText(edge.data?.role, 40)
      visibleEdges.push(role && role !== 'INPUT_DEFAULT' ? [source, target, role] : [source, target])
      if (visibleEdges.length >= 400) break
    }
    const byType: Record<string, number> = Object.create(null)
    for (const { node } of ranked.slice(size)) {
      const type = redactCanvasAgentText(node.type, 40) || 'image'
      byType[type] = (byType[type] ?? 0) + 1
    }
    return {
      v: 1, canvas, selection, rows: entries.map(({ row }) => row), edges: visibleEdges,
      omitted: { nodes: nodes.length - size, byType, edges: edges.length - visibleEdges.length },
      ...(globalStyle ? { globalStyle } : {}),
      ...(videoPrefix ? { videoPrefix } : {}),
    }
  }
  const complete = create(top.length)
  if (textEncoder.encode(JSON.stringify(complete)).byteLength <= MAX_DIGEST_BYTES) return complete
  let low = 0
  let high = top.length - 1
  let result = create(0)
  while (low <= high) {
    const size = Math.floor((low + high) / 2)
    const next = create(size)
    if (textEncoder.encode(JSON.stringify(next)).byteLength <= MAX_DIGEST_BYTES) { result = next; low = size + 1 }
    else high = size - 1
  }
  return result
}
