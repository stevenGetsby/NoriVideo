export function appendToolboxReference<T extends { id: string }>(
  current: T[],
  candidate: T,
  limit: number,
): T[] {
  if (current.some((item) => item.id === candidate.id)) return current
  const normalizedLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0
  if (current.length >= normalizedLimit) return current
  return [...current, candidate].slice(0, normalizedLimit)
}

export function appendToolboxTypedReference<T extends { id: string; type: string }>(
  current: T[],
  candidate: T,
  type: T['type'],
  limit: number,
): T[] {
  if (candidate.type !== type || current.some((item) => item.id === candidate.id)) return current
  const normalizedLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0
  if (current.filter((item) => item.type === type).length >= normalizedLimit) return current
  return [...current, candidate]
}
