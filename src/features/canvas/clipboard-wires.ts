import type { Edge } from '@xyflow/react'
import { STORY_FLOW_ROLE, STORY_MOUNT_ROLE } from '@/lib/interactive/types'

type WireLike = Pick<Edge, 'source' | 'target'> & { data?: { role?: string } | null }

const isStoryLine = (role: string | undefined) => role === STORY_FLOW_ROLE || role === STORY_MOUNT_ROLE

/**
 * Wires carried by a copy: everything between copied nodes, plus the input
 * wires of a plain selection so a pasted node keeps its reference assets.
 * A copied group stays self-contained, and a copy never takes over an outside
 * card's story line or its interaction mount.
 */
export function selectCopiedWires<T extends WireLike>(edges: T[], copiedIds: ReadonlySet<string>, includesGroup: boolean): T[] {
  return edges.filter((edge) => {
    if (!copiedIds.has(edge.target)) return false
    if (copiedIds.has(edge.source)) return true
    return !includesGroup && !isStoryLine(edge.data?.role)
  })
}

/**
 * Re-targets copied wires at the pasted nodes. An input whose source is not part
 * of the paste keeps pointing at that node only while it is still on this canvas.
 */
export function resolvePastedWires<T extends WireLike>(
  edges: T[],
  idMap: ReadonlyMap<string, string>,
  existingNodeIds: ReadonlySet<string>,
): Array<T & { source: string; target: string }> {
  const resolved: Array<T & { source: string; target: string }> = []
  for (const edge of edges) {
    const target = idMap.get(edge.target)
    if (!target) continue
    const source = idMap.get(edge.source) ?? (existingNodeIds.has(edge.source) ? edge.source : null)
    if (source) resolved.push({ ...edge, source, target })
  }
  return resolved
}
