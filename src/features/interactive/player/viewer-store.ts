import { emptyProfile, readProfile, type StoryProfile } from '@/lib/interactive/achievements'
import { emptySaves, readSaves, type StorySaves } from '@/lib/interactive/saves'
import type { PermanentStorage } from './permanent-store'

/** Browser-local records of one work: what the viewer has reached and earned, and their saves. */
export const PROFILE_STORAGE_PREFIX = 'nori.story.profile.v1'
export const SAVES_STORAGE_PREFIX = 'nori.story.saves.v1'

export const profileStorageKey = (storageKey: string) => `${PROFILE_STORAGE_PREFIX}:${storageKey}`
export const savesStorageKey = (storageKey: string) => `${SAVES_STORAGE_PREFIX}:${storageKey}`

type Storage = PermanentStorage | null | undefined

function readJson(storage: Storage, key: string | null): unknown {
  if (!storage || !key) return null
  try {
    const text = storage.getItem(key)
    return text ? JSON.parse(text) : null
  } catch {
    return null
  }
}

/** Stores `value` unless it matches what is there, or is the empty value and nothing is stored yet. Returns whether storage changed. */
function writeJson(storage: Storage, key: string | null, value: unknown, empty: unknown): boolean {
  if (!storage || !key) return false
  const serialized = JSON.stringify(value)
  try {
    const stored = storage.getItem(key)
    if (stored === serialized || (stored === null && serialized === JSON.stringify(empty))) return false
    storage.setItem(key, serialized)
    return true
  } catch {
    return false
  }
}

function removeKey(storage: Storage, key: string | null): boolean {
  if (!storage || !key) return false
  try {
    storage.removeItem(key)
    return true
  } catch {
    return false
  }
}

const keyed = (build: (storageKey: string) => string, storageKey: string | undefined) => (storageKey ? build(storageKey) : null)

/** The viewer's profile for this work; anything missing, damaged or unreadable reads as empty. */
export function readStoredProfile(storage: Storage, storageKey: string | undefined): StoryProfile {
  return readProfile(readJson(storage, keyed(profileStorageKey, storageKey)))
}

export function writeStoredProfile(storage: Storage, storageKey: string | undefined, profile: StoryProfile): boolean {
  return writeJson(storage, keyed(profileStorageKey, storageKey), profile, emptyProfile())
}

export function clearStoredProfile(storage: Storage, storageKey: string | undefined): boolean {
  return removeKey(storage, keyed(profileStorageKey, storageKey))
}

/** The viewer's saves for this work; a broken slot reads as empty and the others survive. */
export function readStoredSaves(storage: Storage, storageKey: string | undefined): StorySaves {
  return readSaves(readJson(storage, keyed(savesStorageKey, storageKey)))
}

export function writeStoredSaves(storage: Storage, storageKey: string | undefined, saves: StorySaves): boolean {
  return writeJson(storage, keyed(savesStorageKey, storageKey), saves, emptySaves())
}

export function clearStoredSaves(storage: Storage, storageKey: string | undefined): boolean {
  return removeKey(storage, keyed(savesStorageKey, storageKey))
}
