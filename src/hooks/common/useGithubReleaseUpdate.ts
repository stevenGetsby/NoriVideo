'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  checkGithubReleaseUpdate,
  normalizeSemverTag,
  shouldPulseUpdate,
} from '@/lib/update-check'
import { APP_VERSION, GITHUB_REPOSITORY } from '@/lib/app-meta'
import { apiFetch } from '@/lib/api-fetch'

const ONE_HOUR_IN_MS = 60 * 60 * 1000
const LEGACY_MUTED_UPDATE_VERSION_KEY = 'nori:update:muted-version'

export interface ReleaseUpdateInfo {
  latestVersion: string
  releaseUrl: string
  releaseName: string | null
  publishedAt: string | null
}

export interface UseGithubReleaseUpdateResult {
  currentVersion: string
  update: ReleaseUpdateInfo | null
  shouldPulse: boolean
  showModal: boolean
  isChecking: boolean
  checkError: string | null
  openModal: () => void
  dismissCurrentUpdate: () => void
  checkNow: () => Promise<void>
}

interface UserPreferenceResponse {
  preference?: {
    mutedUpdateVersion?: unknown
  } | null
}

function normalizeMutedUpdateVersion(value: unknown): string | null {
  if (typeof value !== 'string') return null
  try {
    return normalizeSemverTag(value)
  } catch {
    return null
  }
}

function readLegacyMutedUpdateVersion(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return normalizeMutedUpdateVersion(window.localStorage.getItem(LEGACY_MUTED_UPDATE_VERSION_KEY))
  } catch {
    return null
  }
}

function writeLegacyMutedUpdateVersion(version: string): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(LEGACY_MUTED_UPDATE_VERSION_KEY, version)
  } catch {
    // Legacy storage is only a fallback; API persistence remains the source of truth.
  }
}

function removeLegacyMutedUpdateVersion(): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(LEGACY_MUTED_UPDATE_VERSION_KEY)
  } catch {
    // Ignore browsers that block localStorage.
  }
}

async function writePreferenceMutedUpdateVersion(version: string): Promise<void> {
  const response = await apiFetch('/api/user-preference', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mutedUpdateVersion: version }),
  })
  if (!response.ok) {
    throw new Error(`Failed to persist muted update version: ${response.status}`)
  }
  removeLegacyMutedUpdateVersion()
}

async function readPreferenceMutedUpdateVersion(): Promise<string | null> {
  try {
    const response = await apiFetch('/api/user-preference', { cache: 'no-store' })
    if (!response.ok) return readLegacyMutedUpdateVersion()

    const payload = await response.json() as UserPreferenceResponse
    const mutedVersion = normalizeMutedUpdateVersion(payload.preference?.mutedUpdateVersion)
    if (mutedVersion) return mutedVersion

    const legacyMutedVersion = readLegacyMutedUpdateVersion()
    if (legacyMutedVersion) {
      void writePreferenceMutedUpdateVersion(legacyMutedVersion).catch(() => undefined)
      return legacyMutedVersion
    }

    return null
  } catch {
    return readLegacyMutedUpdateVersion()
  }
}

export function useGithubReleaseUpdate(): UseGithubReleaseUpdateResult {
  const currentVersion = useMemo(() => normalizeSemverTag(APP_VERSION), [])

  const [update, setUpdate] = useState<ReleaseUpdateInfo | null>(null)
  const [shouldPulse, setShouldPulse] = useState(false)
  const [checkError, setCheckError] = useState<string | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [isChecking, setIsChecking] = useState(false)
  const latestRequestRef = useRef(0)

  const checkNow = useCallback(async () => {
    const requestId = latestRequestRef.current + 1
    latestRequestRef.current = requestId
    setIsChecking(true)

    const result = await checkGithubReleaseUpdate({
      repository: GITHUB_REPOSITORY,
      currentVersion,
    })
    if (requestId !== latestRequestRef.current) return

    if (result.kind === 'error') {
      setCheckError(result.message)
      setUpdate(null)
      setShouldPulse(false)
      setShowModal(false)
      setIsChecking(false)
      return
    }

    setCheckError(null)

    if (result.kind === 'no-release') {
      setUpdate(null)
      setShouldPulse(false)
      setShowModal(false)
      setIsChecking(false)
      return
    }

    if (result.kind === 'no-update') {
      setUpdate(null)
      setShouldPulse(false)
      setShowModal(false)
      setIsChecking(false)
      return
    }

    const nextUpdate: ReleaseUpdateInfo = {
      latestVersion: result.latestVersion,
      releaseUrl: result.release.htmlUrl,
      releaseName: result.release.name,
      publishedAt: result.release.publishedAt,
    }

    const mutedVersion = await readPreferenceMutedUpdateVersion()
    if (requestId !== latestRequestRef.current) return
    setShouldPulse(shouldPulseUpdate(nextUpdate.latestVersion, mutedVersion))
    setUpdate(nextUpdate)
    setIsChecking(false)
  }, [currentVersion])

  useEffect(() => {
    let cancelled = false

    const run = async () => {
      if (cancelled) return
      await checkNow()
    }

    void run()
    const timer = window.setInterval(() => {
      void run()
    }, ONE_HOUR_IN_MS)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [checkNow])

  const dismissCurrentUpdate = useCallback(() => {
    if (update) {
      void writePreferenceMutedUpdateVersion(update.latestVersion).catch(() => {
        writeLegacyMutedUpdateVersion(update.latestVersion)
      })
    }
    setShouldPulse(false)
    setShowModal(false)
  }, [update])

  const openModal = useCallback(() => {
    if (!update) return
    setShowModal(true)
  }, [update])

  return {
    currentVersion,
    update,
    shouldPulse,
    showModal,
    isChecking,
    checkError,
    openModal,
    dismissCurrentUpdate,
    checkNow,
  }
}
