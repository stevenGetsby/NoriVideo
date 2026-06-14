'use client'

import {
  getImageGenerationCountConfig,
  getImageGenerationCountStorageKey,
  getImageGenerationCountScopes,
  normalizeImageGenerationCount,
  normalizeImageGenerationCountPreferences,
  type ImageGenerationCountPreferences,
  type ImageGenerationCountScope,
} from './count'

function getStorage(): Storage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

export function getImageGenerationCount(scope: ImageGenerationCountScope): number {
  const storage = getStorage()
  const fallback = getImageGenerationCountConfig(scope).defaultValue
  if (!storage) return fallback
  const rawValue = storage.getItem(getImageGenerationCountStorageKey(scope))
  return normalizeImageGenerationCount(scope, rawValue, fallback)
}

export function setImageGenerationCount(scope: ImageGenerationCountScope, value: unknown): number {
  const normalized = normalizeImageGenerationCount(scope, value)
  const storage = getStorage()
  if (storage) {
    storage.setItem(getImageGenerationCountStorageKey(scope), String(normalized))
  }
  return normalized
}

export function getStoredImageGenerationCounts(): ImageGenerationCountPreferences {
  return getImageGenerationCountScopes().reduce<ImageGenerationCountPreferences>((preferences, scope) => {
    preferences[scope] = getImageGenerationCount(scope)
    return preferences
  }, {})
}

export function applyImageGenerationCountPreferences(value: unknown): ImageGenerationCountPreferences {
  const preferences = normalizeImageGenerationCountPreferences(value)
  for (const [scope, count] of Object.entries(preferences) as [ImageGenerationCountScope, number][]) {
    setImageGenerationCount(scope, count)
  }
  return preferences
}
