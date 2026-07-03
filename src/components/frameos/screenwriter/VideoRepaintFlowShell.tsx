'use client'

import type { ReactNode } from 'react'
import { AppIcon } from '@/components/ui/icons'
import { VideoRepaintStageNav } from './VideoRepaintStageNav'
import type { VideoRepaintStageKey, VideoRepaintTaskView } from './types'

export function VideoRepaintFlowShell({
  task,
  currentStage,
  children,
  onBack,
}: {
  task: VideoRepaintTaskView
  currentStage: VideoRepaintStageKey
  children: ReactNode
  onBack: () => void
}) {
  const activeStage = task.stages.find((stage) => stage.key === currentStage)

  return (
    <div className="flex min-h-0 flex-1">
      <VideoRepaintStageNav task={task} currentStage={currentStage} onBack={onBack} />
      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[1160px] px-8 py-7">
          <div className="mb-7 flex items-start justify-between gap-4">
            <div>
              <div className="text-[12px] text-[var(--fos-text-3)]">
                {task.taskTypeLabel} / {task.title}
              </div>
              <h1 className="mt-2 flex items-center gap-3 text-[20px] font-bold text-white">
                {activeStage?.title ?? '任务流程'}
                {activeStage?.checkpoint ? (
                  <span className="rounded-full bg-[rgba(99,102,241,.25)] px-2 py-1 text-[12px] font-bold text-[#a5b4fc]">
                    检查点 {activeStage.checkpoint}
                  </span>
                ) : null}
              </h1>
            </div>
            <button
              type="button"
              onClick={() => document.getElementById('video-repaint-requirement')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
              className="fos-btn fos-btn-ghost"
            >
              <AppIcon name="eye" className="h-4 w-4" />
              查看转绘需求
            </button>
          </div>
          {children}
        </div>
      </main>
    </div>
  )
}
