'use client'

import { useRouter } from '@/i18n/navigation'
import { FosShell } from './FosShell'
import { EpisodeProgressGrid } from './screenwriter/EpisodeProgressGrid'
import { SettingsReviewPage } from './screenwriter/SettingsReviewPage'
import { TargetScriptReview } from './screenwriter/TargetScriptReview'
import { VideoRepaintFlowShell } from './screenwriter/VideoRepaintFlowShell'
import { videoRepaintDemoTask, videoRepaintTargetScriptEpisodes } from './screenwriter/screenwriterDemoData'
import type { VideoRepaintStageKey } from './screenwriter/types'

export function FosVideoRepaintFlowClient({ stage = videoRepaintDemoTask.currentStage }: { stage?: VideoRepaintStageKey | 'target_script' }) {
  const router = useRouter()
  const shellStage: VideoRepaintStageKey = stage === 'target_script' ? 'episode_repaint' : stage

  const content = (() => {
    if (stage === 'source_settings') {
      return (
        <SettingsReviewPage
          review={videoRepaintDemoTask.sourceSettings}
          regenerateLabel="重新提炼"
          confirmLabel="确认设定总纲，继续"
        />
      )
    }
    if (stage === 'episode_alignment') {
      return (
        <EpisodeProgressGrid
          title="逐集对齐"
          description="系统正在按已确认的源设定总纲整理跨集人物、地点和道具称呼；该步骤不需要单独确认。"
          episodes={videoRepaintDemoTask.alignmentEpisodes}
        />
      )
    }
    if (stage === 'target_settings') {
      return (
        <SettingsReviewPage
          review={videoRepaintDemoTask.targetSettings}
          regenerateLabel="重新生成"
          confirmLabel="确认锁定，开始转绘"
        />
      )
    }
    if (stage === 'episode_repaint') {
      return (
        <EpisodeProgressGrid
          title="逐集转绘（生成剧本转绘2.0）"
          description="系统正在根据源剧本、目标设定和对齐关系生成目标剧本。"
          episodes={videoRepaintDemoTask.repaintEpisodes}
        />
      )
    }
    if (stage === 'target_script') {
      return <TargetScriptReview episodes={videoRepaintTargetScriptEpisodes} />
    }
    return (
      <section className="rounded-[12px] border border-[var(--fos-border-soft)] bg-[var(--fos-bg-2)] p-6">
        <div className="text-[15px] font-bold text-white">当前阶段正在准备中</div>
        <p className="mt-3 text-[13px] leading-6 text-[var(--fos-text-3)]">请稍后查看流程产物。</p>
      </section>
    )
  })()

  return (
    <FosShell
      activeKey="screenwriter"
      hideSidebar
      header={<div className="flex items-center gap-3 border-b border-[var(--fos-border-soft)] px-6 py-4"><h1 className="text-[16px] font-bold text-white">视频转绘 2.0</h1></div>}
    >
      <VideoRepaintFlowShell
        task={videoRepaintDemoTask}
        currentStage={shellStage}
        onBack={() => router.push({ pathname: '/screenwriter' })}
        onRequirementClick={() => undefined}
      >
        {content}
      </VideoRepaintFlowShell>
    </FosShell>
  )
}
