'use client'

import { useCallback, useEffect, useState } from 'react'
import { fetchScreenwriterTasks } from './screenwriterApi'
import type { ScreenwriterScriptSummary } from './types'

export function useScreenwriterTasks() {
  const [tasks, setTasks] = useState<ScreenwriterScriptSummary[]>([])
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const reload = useCallback(() => {
    setIsLoading(true)
    fetchScreenwriterTasks()
      .then((payload) => {
        setTasks(payload.tasks)
        setError(null)
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : '获取编剧任务失败')
      })
      .finally(() => setIsLoading(false))
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  return { tasks, isLoading, error, reload }
}
