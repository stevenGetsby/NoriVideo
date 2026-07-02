'use client'

import { useMemo } from 'react'
import { getVideoRepaintTask } from './screenwriterMockStore'

export function useVideoRepaintTask(taskId: string, refreshKey = 0) {
  const task = useMemo(() => getVideoRepaintTask(taskId), [taskId, refreshKey])
  return {
    task,
    isLoading: false,
    error: task ? null : '未找到视频转绘任务',
  }
}
