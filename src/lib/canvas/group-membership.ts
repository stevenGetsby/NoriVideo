function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

/** Remove deleted node ids from a persisted group's JSON payload. */
export function removeDeletedCanvasGroupMembers(
  data: unknown,
  deletedNodeIds: ReadonlySet<string>,
): Record<string, unknown> | null {
  const source = record(data)
  if (!source || !Array.isArray(source.memberIds) || deletedNodeIds.size === 0) return null
  const memberIds = source.memberIds.filter((value) => (
    typeof value !== 'string' || !deletedNodeIds.has(value)
  ))
  if (memberIds.length === source.memberIds.length) return null
  return { ...source, memberIds }
}
