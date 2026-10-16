import type { CanvasNodeData } from './types'

/** Preserve reference order. Never silently generate with missing inputs. */
export function requireExistingReferenceNodeIds(
  ids: string[],
  nodes: Array<{ id: string }>,
): string[] {
  const existing = new Set(nodes.map((node) => node.id))
  const ordered = [...new Set(ids)]
  if (ordered.some((id) => !existing.has(id))) {
    throw new Error('部分引用节点已删除，请在引用素材中清除失效引用或重新选择后再生成。')
  }
  return ordered
}

/** Explicit node deletion also detaches unwired/plus-picker references. */
export function removeDeletedCanvasReferences<T extends { data: CanvasNodeData }>(
  nodes: T[],
  deletedIds: ReadonlySet<string>,
): T[] {
  return nodes.map((node) => {
    const generation = node.data.generation
    if (!generation) return node
    const ids = generation.referenceNodeIds
    const summaries = generation.referenceSummary
    if (!ids?.some((id) => deletedIds.has(id)) && !summaries?.some((item) => deletedIds.has(item.id))) return node
    return {
      ...node,
      data: {
        ...node.data,
        generation: {
          ...generation,
          ...(ids ? { referenceNodeIds: ids.filter((id) => !deletedIds.has(id)) } : {}),
          ...(summaries ? { referenceSummary: summaries.filter((item) => !deletedIds.has(item.id)) } : {}),
        },
      },
    }
  })
}
