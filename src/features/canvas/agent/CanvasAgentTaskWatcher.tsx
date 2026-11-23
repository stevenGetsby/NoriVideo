'use client'

import { useEffect, useState } from 'react'
import type { CanvasAgentBridge } from './bridge-types'
import { createAgentTaskTracker, type SubmittedAgentTask } from './task-watcher'

export function CanvasAgentTaskWatcher({ bridge, submitted }: { bridge: CanvasAgentBridge; submitted: readonly SubmittedAgentTask[] }) {
  const [tracker] = useState(createAgentTaskTracker)
  const [reports, setReports] = useState<string[]>([])
  useEffect(() => {
    tracker.track(submitted)
    if (!tracker.active()) return
    const timer = window.setInterval(() => {
      const { completed, failed } = tracker.poll(bridge.getGraph().nodes)
      if (completed || failed) setReports((previous) => [...previous.slice(-14), [
        completed ? `${completed} 个生成任务已完成` : '',
        failed ? `${failed} 个任务未完成，请查看节点` : '',
      ].filter(Boolean).join('；')])
      if (!tracker.active()) window.clearInterval(timer)
    }, 2000)
    return () => window.clearInterval(timer)
  }, [bridge, submitted, tracker])
  return reports.map((line, index) => <p className="nori-canvas-agent-notice" key={`${index}-${line}`}>{line}</p>)
}
