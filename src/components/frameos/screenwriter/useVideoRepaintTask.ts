'use client'

import { useMemo } from 'react'
import { getVideoRepaintTask } from './screenwriterMockStore'

export function useVideoRepaintTask(taskId: string) {
  const task = useMemo(() => getVideoRepaintTask(taskId), [taskId])
  return {
    task,
    isLoading: false,
    error: task ? null : '未找到视频转绘任务',
  }
}
