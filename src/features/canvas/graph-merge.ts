export function selectServerOnlyEntities({ serverIds, localIds, tombstones, now }: {
  serverIds: ReadonlySet<string>
  localIds: ReadonlySet<string>
  tombstones: Map<string, number>
  now: number
}): string[] {
  for (const [id, deletedAt] of tombstones) {
    if (localIds.has(id) || now - deletedAt > 600_000 || !serverIds.has(id)) tombstones.delete(id)
  }
  return [...serverIds].filter((id) => !localIds.has(id) && !tombstones.has(id))
}
