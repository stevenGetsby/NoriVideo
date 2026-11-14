import { reachKey } from '@/lib/interactive/achievements'
import type { StoryRun } from '@/lib/interactive/engine'
import { observeCheckpoint, savesEnabled, snapshotRun, withAutoSave, type StorySaves } from '@/lib/interactive/saves'
import type { StoryAchievement, StoryProgram } from '@/lib/interactive/types'
import { profileStorageKey, savesStorageKey } from './viewer-store'
import type { PermanentStorage } from './permanent-store'

/** A title or avatar frame the shop sells; owning one makes the viewer's records worth keeping. */
export const hasRewardShopItems = (program: StoryProgram): boolean =>
  (program.shop?.items ?? []).some((item) => Boolean(item.reward && (item.reward.title || item.reward.frameUrl)))

/**
 * Achievements, a map with saves, or a shop reward: only then does the player read or write the
 * viewer's records, show the extra HUD buttons and offer to continue. Old works play as before.
 */
export const recordsEnabled = (program: StoryProgram): boolean =>
  (program.achievements?.length ?? 0) > 0 || savesEnabled(program) || hasRewardShopItems(program)

/**
 * Browser-storage scope for one work's records. A 单章试玩 records under its own scope, so its
 * `all_endings` (the trial program only holds one chapter) never pollutes the full-story profile.
 */
export function recordsStorageKey(storageKey: string | undefined, mode: 'story' | 'chapter', projectId?: string): string | undefined {
  if (!storageKey) return undefined
  return mode === 'chapter' ? `${storageKey}:chapter:${projectId ?? ''}` : storageKey
}

/** Whether either record of this scope is already in the viewer's browser. */
export function hasStoredRecords(storage: PermanentStorage | null | undefined, scope: string | undefined): boolean {
  if (!storage || !scope) return false
  try {
    return storage.getItem(profileStorageKey(scope)) !== null || storage.getItem(savesStorageKey(scope)) !== null
  } catch {
    return false
  }
}

const sameSnapshot = (a: unknown, b: unknown): boolean => {
  try {
    return JSON.stringify(a) === JSON.stringify(b)
  } catch {
    return false
  }
}

/**
 * The saves with the current run as the automatic continue point, or the same object when there is
 * nothing new to remember: the map is off, the stop cannot be resumed (an ending, an exit), or the
 * snapshot is the one already stored (so a re-render does not rewrite the record).
 */
export function autoSaveFor(saves: StorySaves, program: StoryProgram, run: StoryRun, now: number): StorySaves {
  if (!savesEnabled(program)) return saves
  const snapshot = snapshotRun(run)
  if (!snapshot) return saves
  if (saves.auto && sameSnapshot(saves.auto.snapshot, snapshot)) return saves
  return withAutoSave(saves, snapshot, now)
}

/** Remembers the state at a save-point segment the run has just entered; unchanged stops keep the old record. */
export function checkpointFor(saves: StorySaves, program: StoryProgram, run: StoryRun, now: number): StorySaves {
  if (!savesEnabled(program)) return saves
  const { stop } = run
  if (stop.kind !== 'scene' || !stop.node.savePoint) return saves
  const key = reachKey(stop.projectId, stop.node.id)
  const snapshot = snapshotRun(run)
  if (!snapshot) return saves
  if (saves.checkpoints[key] && sameSnapshot(saves.checkpoints[key].snapshot, snapshot)) return saves
  return observeCheckpoint(program, saves, run, now)
}

export interface StoryToast {
  id: number
  achievement: StoryAchievement
}

/** How long one achievement toast stays up before the next in the queue takes its place. */
export const ACHIEVEMENT_TOAST_MS = 3000

/** Appends freshly earned achievements to the toast queue, one toast each, with unique ids. */
export function enqueueToasts(queue: readonly StoryToast[], earned: readonly StoryAchievement[], baseId: number): StoryToast[] {
  if (!earned.length) return queue as StoryToast[]
  return [...queue, ...earned.map((achievement, index) => ({ id: baseId + index, achievement }))]
}

/** A save slot's time, e.g. `2026/11/13 03:20`, in the viewer's own time zone. */
export function saveTimeText(savedAt: number): string {
  if (!Number.isFinite(savedAt) || savedAt <= 0) return ''
  const date = new Date(savedAt)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}
