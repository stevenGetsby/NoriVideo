import type { CanvasDocumentInput } from '../types'

function stable(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    const serialized = JSON.stringify(value)
    return serialized === undefined ? 'undefined' : serialized
  }
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  const source = value as Record<string, unknown>
  return `{${Object.keys(source).sort().map((key) => `${JSON.stringify(key)}:${stable(source[key])}`).join(',')}}`
}

function equal(left: unknown, right: unknown) {
  return left === right || stable(left) === stable(right)
}

function plainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/** Local wins only when both tabs changed the same primitive/array field. */
function mergeValue(base: unknown, local: unknown, remote: unknown): unknown {
  if (equal(local, base)) return remote
  if (equal(remote, base) || equal(local, remote)) return local
  if (!plainRecord(local) || !plainRecord(remote)) return local

  const baseline = plainRecord(base) ? base : {}
  const output: Record<string, unknown> = {}
  const keys = new Set([...Object.keys(baseline), ...Object.keys(remote), ...Object.keys(local)])
  for (const key of keys) {
    const value = mergeValue(baseline[key], local[key], remote[key])
    if (value !== undefined) output[key] = value
  }
  return output
}

function mergeEntities<T extends { id: string }>(base: T[], local: T[], remote: T[]) {
  const baseById = new Map(base.map((item) => [item.id, item]))
  const localById = new Map(local.map((item) => [item.id, item]))
  const remoteById = new Map(remote.map((item) => [item.id, item]))
  const orderedIds = [...remote.map((item) => item.id), ...local.map((item) => item.id).filter((id) => !remoteById.has(id))]

  return orderedIds.flatMap((id) => {
    const baseline = baseById.get(id)
    const localValue = localById.get(id)
    const remoteValue = remoteById.get(id)
    if (!baseline) {
      if (!localValue) return remoteValue ? [remoteValue] : []
      if (!remoteValue) return [localValue]
      return [mergeValue(undefined, localValue, remoteValue) as T]
    }
    if (!localValue) {
      if (!remoteValue || equal(remoteValue, baseline)) return []
      // The other tab edited while this tab deleted. Preserve the edited copy
      // rather than silently destroying work; the user can delete it again.
      return [remoteValue]
    }
    if (!remoteValue) {
      if (equal(localValue, baseline)) return []
      return [localValue]
    }
    return [mergeValue(baseline, localValue, remoteValue) as T]
  })
}

/**
 * Three-way merge for sibling browser tabs. Changes to different nodes, edges,
 * node fields, and the viewport all survive. Only a true same-field conflict
 * prefers the active tab, which keeps the interaction deterministic.
 */
export function mergeCanvasDocuments(
  base: CanvasDocumentInput,
  local: CanvasDocumentInput,
  remote: CanvasDocumentInput,
  changeSummary = '自动合并多标签页更改',
): CanvasDocumentInput {
  const nodes = mergeEntities(base.nodes, local.nodes, remote.nodes)
  const nodeIds = new Set(nodes.map((node) => node.id))
  const edges = mergeEntities(base.edges, local.edges, remote.edges)
    .filter((edge) => nodeIds.has(edge.sourceNodeId) && nodeIds.has(edge.targetNodeId))

  return {
    schema_version: remote.schema_version || local.schema_version || base.schema_version,
    expectedRevision: remote.expectedRevision,
    clientId: local.clientId,
    changeSummary,
    viewport: mergeValue(base.viewport, local.viewport, remote.viewport) as CanvasDocumentInput['viewport'],
    nodes,
    edges,
  }
}
