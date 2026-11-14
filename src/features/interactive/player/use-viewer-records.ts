'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { emptyProfile, observeRun, type StoryProfile } from '@/lib/interactive/achievements'
import type { StoryRun } from '@/lib/interactive/engine'
import { emptySaves, type StorySaves } from '@/lib/interactive/saves'
import type { StoryProgram } from '@/lib/interactive/types'
import { browserPermanentStorage } from './permanent-store'
import {
  ACHIEVEMENT_TOAST_MS,
  enqueueToasts,
  hasStoredRecords,
  recordsEnabled,
  recordsStorageKey,
  type StoryToast,
} from './records'
import {
  clearStoredProfile,
  clearStoredSaves,
  readStoredProfile,
  readStoredSaves,
  writeStoredProfile,
  writeStoredSaves,
} from './viewer-store'

export interface ViewerRecordsOptions {
  program: StoryProgram
  /** Every run change is observed for reached endings/segments and achievements. */
  run: StoryRun
  mode: 'story' | 'chapter'
  /** Scopes the records; without it they live in memory only. */
  storageKey?: string
  projectId?: string
  /** True while a continue prompt is up: nothing is recorded until the viewer decides. */
  suspended?: boolean
}

export interface ViewerRecords {
  /** False for old works: no storage reads or writes, no records UI. */
  enabled: boolean
  /** True once the browser records (or the silent emptiness) have been read. */
  loaded: boolean
  profile: StoryProfile
  saves: StorySaves
  /** At least one record of this scope already exists in the viewer's browser. */
  keyExists: boolean
  /** Achievements waiting to be shown, oldest first. */
  toasts: StoryToast[]
  setProfile: Dispatch<SetStateAction<StoryProfile>>
  setSaves: Dispatch<SetStateAction<StorySaves>>
  /** Writes the in-memory records straight to storage (close, unmount, pagehide). */
  flush: () => void
  /** Forgets the profile and the saves of this scope, leaving permanent values alone. */
  clearRecords: () => void
}

/**
 * Holds one work's viewer profile and saves, loads them from the browser once and writes every
 * change through. Old works (no achievements, no map, no shop reward) never touch storage.
 */
export function useViewerRecords({ program, run, mode, storageKey, projectId, suspended = false }: ViewerRecordsOptions): ViewerRecords {
  const enabled = useMemo(() => recordsEnabled(program), [program])
  const scope = useMemo(() => recordsStorageKey(storageKey, mode, projectId), [storageKey, mode, projectId])
  const storage = useMemo(() => browserPermanentStorage(), [])
  const [loaded, setLoaded] = useState(false)
  const [profile, setProfile] = useState<StoryProfile>(emptyProfile)
  const [saves, setSaves] = useState<StorySaves>(emptySaves)
  const [keyExists, setKeyExists] = useState(false)
  const [toasts, setToasts] = useState<StoryToast[]>([])

  const enabledRef = useRef(enabled)
  enabledRef.current = enabled
  const scopeRef = useRef(scope)
  scopeRef.current = scope
  const profileRef = useRef(profile)
  profileRef.current = profile
  const savesRef = useRef(saves)
  savesRef.current = saves
  const toastSeq = useRef(0)

  // Load once per scope, and only when this work keeps records at all.
  useEffect(() => {
    if (!enabled) {
      setLoaded(false)
      setProfile(emptyProfile())
      setSaves(emptySaves())
      setKeyExists(false)
      setToasts([])
      return
    }
    setProfile(readStoredProfile(storage, scope))
    setSaves(readStoredSaves(storage, scope))
    setKeyExists(hasStoredRecords(storage, scope))
    setLoaded(true)
  }, [enabled, storage, scope])

  // Write-through: every change of either record reaches the browser at once.
  useEffect(() => {
    if (!enabled || !loaded) return
    writeStoredProfile(storage, scope, profile)
    setKeyExists(hasStoredRecords(storage, scope))
  }, [enabled, loaded, storage, scope, profile])

  useEffect(() => {
    if (!enabled || !loaded) return
    writeStoredSaves(storage, scope, saves)
    setKeyExists(hasStoredRecords(storage, scope))
  }, [enabled, loaded, storage, scope, saves])

  const flush = useCallback(() => {
    if (!enabledRef.current) return
    writeStoredProfile(storage, scopeRef.current, profileRef.current)
    writeStoredSaves(storage, scopeRef.current, savesRef.current)
  }, [storage])

  useEffect(() => {
    if (!enabled) return
    const onPageHide = () => flush()
    window.addEventListener('pagehide', onPageHide)
    return () => {
      window.removeEventListener('pagehide', onPageHide)
      flush()
    }
  }, [enabled, flush])

  // Records what the run has reached after every change; achievements earned by the same change
  // queue a toast each. observeRun only reads the run, so a restored save is never advanced (and
  // its segment effects are not applied again) by recording it.
  useEffect(() => {
    if (!enabled || !loaded || suspended) return
    const current = profileRef.current
    const update = observeRun(program, current, run)
    if (update.profile !== current) {
      profileRef.current = update.profile
      setProfile(update.profile)
    }
    if (update.earned.length) {
      const base = toastSeq.current
      toastSeq.current += update.earned.length
      setToasts((queue) => enqueueToasts(queue, update.earned, base))
    }
  }, [enabled, loaded, suspended, program, run])

  // One toast at a time; each leaves after its ~3s so the next can be read.
  useEffect(() => {
    if (!toasts.length) return
    const timer = setTimeout(() => setToasts((queue) => queue.slice(1)), ACHIEVEMENT_TOAST_MS)
    return () => clearTimeout(timer)
  }, [toasts])

  const clearRecords = useCallback(() => {
    if (!enabledRef.current) return
    clearStoredProfile(storage, scopeRef.current)
    clearStoredSaves(storage, scopeRef.current)
    profileRef.current = emptyProfile()
    savesRef.current = emptySaves()
    setProfile(emptyProfile())
    setSaves(emptySaves())
    setToasts([])
    setKeyExists(false)
  }, [storage])

  return { enabled, loaded, profile, saves, keyExists, toasts, setProfile, setSaves, flush, clearRecords }
}
