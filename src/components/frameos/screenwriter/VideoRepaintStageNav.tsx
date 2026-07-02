'use client'

import { AppIcon } from '@/components/ui/icons'
import type { VideoRepaintStageKey, VideoRepaintStageStatus, VideoRepaintTaskView } from './types'

const STATUS_LABELS: Record<VideoRepaintStageStatus, string> = {
  not_started: '',
  queued: '排队',
  running: '运行',
  waiting_check: '检',
  approved: '',
  succeeded: '',
  failed: '错',
  stale: '旧',
}

function StageMarker({ index, status }: { index: number; status: VideoRepaintStageStatus }) {
  const done = status === 'approved' || status === 'succeeded'
  if (done) {
    return (
      <span className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-[rgba(59,110,242,.35)] text-white">
        <AppIcon name="check" className="h-4 w-4" />
      </span>
    )
  }

  return (
    <span
      className="flex h-7 w-7 flex-none items-center justify-center rounded-full text-[13px] font-bold"
      style={{
        background: status === 'waiting_check' || status === 'running' ? 'var(--fos-primary)' : 'var(--fos-bg-4)',
        color: status === 'not_started' ? 'var(--fos-text-disabled)' : '#fff',
      }}
    >
      {index}
    </span>
  )
}

export function VideoRepaintStageNav({
  task,
  currentStage,
  onBack,
}: {
  task: VideoRepaintTaskView
  currentStage: VideoRepaintStageKey
  onBack: () => void
}) {
  return (
    <aside className="flex w-[220px] flex-none flex-col border-r border-[var(--fos-border-soft)] bg-[rgba(255,255,255,.02)] p-4">
      <button
        type="button"
        onClick={onBack}
        className="mb-5 flex h-10 w-full items-center justify-center gap-2 rounded-[8px] border border-[var(--fos-border-mid)] bg-[var(--fos-bg-2)] text-[13px] font-bold text-[var(--fos-text-2)] hover:bg-[var(--fos-bg-3)]"
      >
        <AppIcon name="chevronLeft" className="h-4 w-4" />
        返回编剧工作台
      </button>
      <div className="mb-4 border-b border-[var(--fos-border-soft)] pb-3 text-[12px] font-bold text-[var(--fos-text-4)]">任务进度</div>
      <div className="space-y-2">
        {task.stages.map((stage, index) => {
          const active = stage.key === currentStage
          const statusLabel = STATUS_LABELS[stage.status]
          return (
            <div
              key={stage.key}
              className="flex items-start gap-3 rounded-[8px] px-2 py-2"
              style={{ background: active ? 'rgba(59,110,242,.13)' : 'transparent' }}
            >
              <StageMarker index={index + 1} status={stage.status} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="block text-[13px] font-bold" style={{ color: active ? '#fff' : 'var(--fos-text-2)' }}>
                    {stage.title}
                  </span>
                  {statusLabel ? (
                    <span className="rounded-full bg-[rgba(99,102,241,.2)] px-1.5 py-0.5 text-[10px] font-bold text-[#a5b4fc]">
                      {statusLabel}
                    </span>
                  ) : null}
                </span>
                <span className="mt-0.5 block text-[12px] text-[var(--fos-text-4)]">{stage.subtitle}</span>
              </span>
            </div>
          )
        })}
      </div>
    </aside>
  )
}
