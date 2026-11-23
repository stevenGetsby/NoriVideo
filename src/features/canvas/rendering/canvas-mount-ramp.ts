export const MOUNT_RAMP_FREE = 12
export const MOUNT_RAMP_CHUNK = 8

export type MountRampInput = {
  mounted: ReadonlySet<string>
  target: ReadonlySet<string>
  immediate: ReadonlySet<string>
  distanceOf: (id: string) => number
  free?: number
  chunk?: number
}

export type MountRampResult = {
  admitted: ReadonlySet<string>
  complete: boolean
}

/**
 * Mounting dozens of cards in one commit blocks a frame for as long as the whole batch takes.
 * Cards already on screen and anything the user is interacting with stay put; the rest enter
 * nearest-first a few at a time. Ordinary pans bring in only a handful of cards, so they pass whole.
 */
export function planMountRamp({
  mounted,
  target,
  immediate,
  distanceOf,
  free = MOUNT_RAMP_FREE,
  chunk = MOUNT_RAMP_CHUNK,
}: MountRampInput): MountRampResult {
  const fresh: string[] = []
  for (const id of target) {
    if (!mounted.has(id) && !immediate.has(id)) fresh.push(id)
  }
  if (fresh.length <= free) return { admitted: target, complete: true }

  fresh.sort((a, b) => distanceOf(a) - distanceOf(b) || (a < b ? -1 : 1))
  const admitted = new Set<string>()
  for (const id of target) {
    if (mounted.has(id) || immediate.has(id)) admitted.add(id)
  }
  for (const id of fresh.slice(0, chunk)) admitted.add(id)
  return { admitted, complete: false }
}
