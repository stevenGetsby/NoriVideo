'use client'

import { useRouter } from '@/i18n/navigation'
import { FosShell } from './FosShell'
import { VideoRepaintFlowShell } from './screenwriter/VideoRepaintFlowShell'
import { videoRepaintDemoTask } from './screenwriter/screenwriterDemoData'

export function FosVideoRepaintFlowClient() {
  const router = useRouter()

  return (
    <FosShell
      activeKey="screenwriter"
      hideSidebar
      header={<div className="flex items-center gap-3 border-b border-[var(--fos-border-soft)] px-6 py-4"><h1 className="text-[16px] font-bold text-white">视频转绘 2.0</h1></div>}
    >
      <VideoRepaintFlowShell
        task={videoRepaintDemoTask}
        currentStage={videoRepaintDemoTask.currentStage}
        onBack={() => router.push({ pathname: '/screenwriter' })}
        onRequirementClick={() => undefined}
      >
        <section className="rounded-[12px] border border-[var(--fos-border-soft)] bg-[var(--fos-bg-2)] p-6">
          <div className="flex items-center gap-3 text-[15px] font-bold text-white">
            当前阶段：设定提炼
            <span className="rounded-full bg-[rgba(99,102,241,.25)] px-2 py-1 text-[12px] font-bold text-[#a5b4fc]">等待检查</span>
          </div>
          <p className="mt-3 text-[13px] leading-6 text-[var(--fos-text-3)]">
            阶段二先接入统一流程壳与任务进度。源设定检查点、逐集对齐、目标设定与逐集转绘页面将在下一阶段补齐。
          </p>
        </section>
      </VideoRepaintFlowShell>
    </FosShell>
  )
}
