'use client'

import { useCallback, useEffect, useState } from 'react'
import { fetchScriptRepaintTask } from './screenwriterApi'
import type { VideoRepaintTaskDetail } from './types'

export function useScriptRepaintTask(taskId: string, refreshKey = 0) {
  const [task, setTask] = useState<VideoRepaintTaskDetail | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!taskId) return null
    setIsLoading(true)
    try {
      const next = await fetchScriptRepaintTask(taskId)
      setTask(next)
      setError(null)
      return next
    } catch (err) {
      setError(err instanceof Error ? err.message : '未找到剧本转绘任务')
      setTask(null)
      return null
    } finally {
      setIsLoading(false)
    }
  }, [taskId])

  useEffect(() => {
    void reload()
  }, [reload, refreshKey])

  return { task, isLoading, error, reload }
}
