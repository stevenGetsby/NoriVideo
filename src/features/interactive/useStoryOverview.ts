'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { apiFetch } from '@/lib/api-fetch'
import { storyErrorMessage } from './story-api-error'
import type { InteractiveStoryConfig, StoryAspectRatio, StoryResolution } from '@/lib/interactive/types'
import type { StoryOverviewData } from './story-overview-model'

export type StoryPatch = {
  name?: string
  aspectRatio?: StoryAspectRatio
  resolution?: StoryResolution
  config?: Partial<InteractiveStoryConfig>
}

const errorText = (error: unknown, fallback: string) => (error instanceof Error && error.message ? error.message : fallback)

export function useStoryOverview(workId: string) {
  const url = `/api/interactive/${encodeURIComponent(workId)}`
  const [data, setData] = useState<StoryOverviewData | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(0)
  const [creatingChapter, setCreatingChapter] = useState(false)
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  const latest = useRef(0)

  const fetchOverview = useCallback(async (signal?: AbortSignal) => {
    const response = await apiFetch(url, { signal, cache: 'no-store' })
    if (!response.ok) throw new Error(await storyErrorMessage(response, '加载影游失败'))
    return await response.json() as StoryOverviewData
  }, [url])

  const reload = useCallback(async () => {
    try {
      setData(await fetchOverview())
      setLoadError(null)
    } catch (error) {
      setLoadError(errorText(error, '加载影游失败'))
    }
  }, [fetchOverview])

  useEffect(() => {
    const controller = new AbortController()
    setData(null)
    setLoadError(null)
    fetchOverview(controller.signal)
      .then(setData)
      .catch((error) => { if (!controller.signal.aborted) setLoadError(errorText(error, '加载影游失败')) })
    // Chapters are edited in their own canvas tabs, so refresh when the user comes back.
    const onFocus = () => { if (document.visibilityState === 'visible' && latest.current === 0) void fetchOverview().then(setData).catch(() => undefined) }
    document.addEventListener('visibilitychange', onFocus)
    return () => {
      controller.abort()
      document.removeEventListener('visibilitychange', onFocus)
    }
  }, [fetchOverview])

  /** Saves run one at a time; only the newest response replaces local state so quick edits never flicker back. */
  const patch = useCallback((body: StoryPatch, optimistic?: (current: StoryOverviewData) => StoryOverviewData) => {
    if (optimistic) setData((current) => (current ? optimistic(current) : current))
    setSaveError(null)
    setSaving((count) => count + 1)
    const ticket = ++latest.current
    const run = queue.current.then(async () => {
      const response = await apiFetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!response.ok) throw new Error(await storyErrorMessage(response, '保存失败'))
      return await response.json() as StoryOverviewData
    })
    queue.current = run.catch(() => undefined)
    return run
      .then((next) => { if (ticket === latest.current) setData(next) })
      .catch(async (error) => {
        setSaveError(errorText(error, '保存失败'))
        await reload()
        throw error
      })
      .finally(() => {
        setSaving((count) => count - 1)
        if (ticket === latest.current) latest.current = 0
      })
  }, [reload, url])

  const createChapter = useCallback(async () => {
    setCreatingChapter(true)
    setSaveError(null)
    try {
      const response = await apiFetch(`${url}/chapters`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (!response.ok) throw new Error(await storyErrorMessage(response, '新建章节失败'))
      const payload = await response.json() as { chapter: { projectId: string } }
      await reload()
      return payload.chapter.projectId
    } catch (error) {
      setSaveError(errorText(error, '新建章节失败'))
      return null
    } finally {
      setCreatingChapter(false)
    }
  }, [reload, url])

  return { data, loadError, saveError, saving: saving > 0, creatingChapter, reload, patch, createChapter, dismissError: () => setSaveError(null) }
}
