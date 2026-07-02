'use client'

import { useCallback, useState } from 'react'
import { listScreenwriterTasks } from './screenwriterMockStore'

export function useScreenwriterTasks() {
  const [tasks, setTasks] = useState(() => listScreenwriterTasks())
  const [error] = useState<string | null>(null)
  const [isLoading] = useState(false)

  const reload = useCallback(() => {
    setTasks(listScreenwriterTasks())
  }, [])

  return { tasks, isLoading, error, reload }
}
