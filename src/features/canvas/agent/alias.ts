import type { CanvasFlowNode } from '../editor-types'
import { CanvasAgentToolError } from './tool-error'

export const NODE_ALIAS_RE = /^n[0-9a-z]{6}$/

export function nodeAlias(id: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < id.length; index++) {
    hash ^= id.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return `n${(hash >>> 0).toString(36).padStart(6, '0').slice(-6)}`
}

export function createNodeResolver(nodes: readonly CanvasFlowNode[]) {
  const aliases = new Map<string, CanvasFlowNode[]>()
  const titles = new Map<string, CanvasFlowNode[]>()
  const index = (map: Map<string, CanvasFlowNode[]>, key: string, node: CanvasFlowNode) => {
    const group = map.get(key)
    if (group) group.push(node)
    else map.set(key, [node])
  }
  for (const node of nodes) {
    index(aliases, nodeAlias(node.id), node)
    const title = node.data.title?.trim()
    if (title) index(titles, title, node)
  }
  return (value: string, { allowGroup = true } = {}) => {
    const ref = value.trim()
    const matches = ((NODE_ALIAS_RE.test(ref) ? aliases : titles).get(ref) ?? [])
      .filter((node) => allowGroup || node.type !== 'group')
    if (matches.length > 1) throw new CanvasAgentToolError('AMBIGUOUS_NODE')
    if (!matches[0]) throw new CanvasAgentToolError('NODE_NOT_FOUND')
    return matches[0]
  }
}

export function resolveNodeRef(ref: string, nodes: readonly CanvasFlowNode[], options?: { allowGroup?: boolean }) {
  return createNodeResolver(nodes)(ref, options)
}
