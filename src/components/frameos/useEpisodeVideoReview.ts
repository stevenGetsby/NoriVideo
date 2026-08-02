'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api-fetch'
import { readApiErrorMessage } from '@/lib/api/read-error-message'
import type { CollaborationAssignment, VideoReviewContext } from './assignments-view-model'

export function useEpisodeVideoReview({
  projectId,
  episodeId,
  refreshKey = '',
}: {
  projectId: string
  episodeId?: string | null
  refreshKey?: string | number | boolean
}) {
  const [assignment, setAssignment] = useState<CollaborationAssignment | null>(null)
  const [context, setContext] = useState<VideoReviewContext | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [reopening, setReopening] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (signal?: AbortSignal) => {
    if (!episodeId) {
      setAssignment(null)
      setContext(null)
      setLoading(false)
      return
    }
    setError(null)
    try {
      const response = await apiFetch(`/api/collaboration/assignments/list?projectId=${encodeURIComponent(projectId)}`, { signal })
      if (!response.ok) throw new Error(await readApiErrorMessage(response, '加载本集审核状态失败'))
      const payload = await response.json() as { assignments?: CollaborationAssignment[] }
      const row = (payload.assignments || []).find((item) => item.stage === 'video' && item.episodeId === episodeId) || null
      setAssignment(row)
      if (!row) {
        setContext(null)
        return
      }
      const contextResponse = await apiFetch(`/api/collaboration/assignments/${encodeURIComponent(row.id)}/video-review`, { signal })
      if (!contextResponse.ok) throw new Error(await readApiErrorMessage(contextResponse, '加载本集评审意见失败'))
      setContext(await contextResponse.json() as VideoReviewContext)
    } catch (loadError) {
      if (signal?.aborted) return
      setError(loadError instanceof Error ? loadError.message : '加载本集审核状态失败')
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [episodeId, projectId])

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    void load(controller.signal)
    return () => controller.abort()
  }, [load, refreshKey])

  const submitEpisode = useCallback(async () => {
    if (!assignment?.canSubmit || context?.readyForReview !== true || submitting) return false
    setSubmitting(true)
    setError(null)
    try {
      const response = await apiFetch('/api/collaboration/assignments/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assignmentId: assignment.id }),
      })
      if (!response.ok) throw new Error(await readApiErrorMessage(response, '提交全集进行评审失败'))
      await load()
      return true
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '提交全集进行评审失败')
      return false
    } finally {
      setSubmitting(false)
    }
  }, [assignment, context?.readyForReview, load, submitting])

  const reopenEpisode = useCallback(async () => {
    if (!assignment?.canReopen || reopening) return false
    setReopening(true)
    setError(null)
    try {
      const response = await apiFetch('/api/collaboration/assignments/reopen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assignmentId: assignment.id }),
      })
      if (!response.ok) throw new Error(await readApiErrorMessage(response, '开启新一轮剪辑失败'))
      await load()
      return true
    } catch (reopenError) {
      setError(reopenError instanceof Error ? reopenError.message : '开启新一轮剪辑失败')
      return false
    } finally {
      setReopening(false)
    }
  }, [assignment, load, reopening])

  return {
    assignment,
    context,
    loading,
    submitting,
    reopening,
    error,
    reload: load,
    submitEpisode,
    reopenEpisode,
  }
}
