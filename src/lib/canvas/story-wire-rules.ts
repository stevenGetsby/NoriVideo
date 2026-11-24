import { STORY_FLOW_ROLE, STORY_MOUNT_ROLE, STORY_OUTPUT_HANDLE } from '@/lib/interactive/types'

type WireEdge = { id: string; sourceNodeId: string; targetNodeId: string; sourceHandle: string | null; targetHandle: string | null; role: string }
type WireNode = { id: string; type: string }

const STORY_MEDIA_PORT = 'media'
const STORY_MEDIA_HOSTS = new Set(['story_scene', 'story_interaction', 'story_choice'])

/** The editor keeps one flow per exit and one picture per card; a merge can still hand us two. Returns the key the edge competes on, or null. */
function wireSlot(edge: WireEdge, nodes: ReadonlyMap<string, WireNode>): string | null {
  if (edge.role === STORY_FLOW_ROLE) return `flow|${edge.sourceNodeId}|${edge.sourceHandle || STORY_OUTPUT_HANDLE}`
  if (edge.role === STORY_MOUNT_ROLE) return null
  if (edge.targetHandle === STORY_MEDIA_PORT && STORY_MEDIA_HOSTS.has(nodes.get(edge.targetNodeId)?.type ?? '')) return `media|${edge.targetNodeId}`
  return null
}

/** Keeps one edge per story slot. Edges that also exist in `preferred` win; otherwise the first one stays. */
export function dedupeStoryWires<E extends WireEdge>(edges: readonly E[], nodes: readonly WireNode[], preferred: ReadonlySet<string>): E[] {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const chosen = new Map<string, E>()
  for (const edge of edges) {
    const slot = wireSlot(edge, byId)
    if (!slot) continue
    const current = chosen.get(slot)
    if (!current || (!preferred.has(current.id) && preferred.has(edge.id))) chosen.set(slot, edge)
  }
  return edges.filter((edge) => {
    const slot = wireSlot(edge, byId)
    return !slot || chosen.get(slot)?.id === edge.id
  })
}
