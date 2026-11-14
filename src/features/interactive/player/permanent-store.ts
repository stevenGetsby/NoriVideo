import { isPermanentVariable, permanentValues } from '@/lib/interactive/engine'
import type { StoryVariable, StoryVariables, StoryValue } from '@/lib/interactive/types'

/** Browser-local record of the values that survive between plays of one work. */
export const PERMANENT_STORAGE_PREFIX = 'nori.story.permanent.v1'

export interface PermanentStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export const permanentStorageKey = (storageKey: string) => `${PERMANENT_STORAGE_PREFIX}:${storageKey}`

/** The viewer's browser storage, or null where it is unavailable (SSR, private mode, blocked storage). */
export function browserPermanentStorage(): PermanentStorage | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null
    return window.localStorage
  } catch {
    return null
  }
}

function isStoredValue(variable: StoryVariable, value: unknown): value is StoryValue {
  if (variable.type === 'boolean') return typeof value === 'boolean'
  return typeof value === 'number' && Number.isFinite(value)
}

/**
 * Reads the permanent values kept from earlier plays. Malformed JSON and unknown or wrongly typed
 * values are ignored, so a half-written record can only ever fall back to start values.
 */
export function readPermanentValues(
  storage: PermanentStorage | null | undefined,
  storageKey: string | undefined,
  variables: StoryVariable[],
): StoryVariables {
  if (!storage || !storageKey) return {}
  let raw: unknown
  try {
    const text = storage.getItem(permanentStorageKey(storageKey))
    if (!text) return {}
    raw = JSON.parse(text)
  } catch {
    return {}
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const data = raw as Record<string, unknown>
  const saved: StoryVariables = {}
  for (const variable of variables) {
    if (!isPermanentVariable(variable)) continue
    const value = data[variable.id]
    if (isStoredValue(variable, value)) saved[variable.id] = value
  }
  return saved
}

/** Writes back only the permanent values (never anything else a run carries); returns whether the record changed. */
export function writePermanentValues(
  storage: PermanentStorage | null | undefined,
  storageKey: string | undefined,
  variables: StoryVariable[],
  vars: StoryVariables,
): boolean {
  if (!storage || !storageKey) return false
  if (!variables.some(isPermanentVariable)) return false
  const key = permanentStorageKey(storageKey)
  const serialized = JSON.stringify(permanentValues(variables, vars))
  try {
    if (storage.getItem(key) === serialized) return false
    storage.setItem(key, serialized)
    return true
  } catch {
    return false
  }
}

export function clearPermanentValues(storage: PermanentStorage | null | undefined, storageKey: string | undefined): boolean {
  if (!storage || !storageKey) return false
  try {
    storage.removeItem(permanentStorageKey(storageKey))
    return true
  } catch {
    return false
  }
}
