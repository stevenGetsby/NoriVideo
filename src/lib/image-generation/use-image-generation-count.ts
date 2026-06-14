'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api-fetch'
import {
  applyImageGenerationCountPreferences,
  getImageGenerationCount,
  getStoredImageGenerationCounts,
  setImageGenerationCount,
} from './count-preference'
import type { ImageGenerationCountScope } from './count'

export function useImageGenerationCount(scope: ImageGenerationCountScope) {
  const [count, setCountState] = useState<number>(() => getImageGenerationCount(scope))

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const response = await apiFetch('/api/user-preference')
        if (!response.ok) return
        const data = await response.json() as {
          preference?: {
            imageGenerationCounts?: unknown
          } | null
        }
        const preferences = applyImageGenerationCountPreferences(data.preference?.imageGenerationCounts)
        if (!cancelled && preferences[scope] !== undefined) {
          setCountState(preferences[scope])
        }
      } catch {
        // Keep local preference when the account preference API is unavailable.
      }
    })()
    return () => { cancelled = true }
  }, [scope])

  const updateCount = useCallback((value: number) => {
    const normalized = setImageGenerationCount(scope, value)
    setCountState(normalized)
    void (async () => {
      try {
        await apiFetch('/api/user-preference', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            imageGenerationCounts: {
              ...getStoredImageGenerationCounts(),
              [scope]: normalized,
            },
          }),
        })
      } catch {
        // Local storage remains the fallback preference source.
      }
    })()
    return normalized
  }, [scope])

  return {
    count,
    setCount: updateCount,
  }
}
