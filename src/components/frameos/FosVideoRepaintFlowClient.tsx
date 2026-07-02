'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from '@/i18n/navigation'
import { FosShell } from './FosShell'
import { EpisodeProgressGrid } from './screenwriter/EpisodeProgressGrid'
import { SettingsReviewPage } from './screenwriter/SettingsReviewPage'
import { TargetScriptReview } from './screenwriter/TargetScriptReview'
import { VideoRepaintFlowShell } from './screenwriter/VideoRepaintFlowShell'
import { videoRepaintDemoTask, videoRepaintTargetScriptEpisodes } from './screenwriter/screenwriterDemoData'
import {
  advanceVideoRepaintTask,
  getVideoRepaintAutoAdvance,
} from './screenwriter/screenwriterMockStore'
import { useVideoRepaintTask } from './screenwriter/useVideoRepaintTask'
import type { VideoRepaintRouteStage, VideoRepaintStageKey } from './screenwriter/types'

export function FosVideoRepaintFlowClient({
  taskId = videoRepaintDemoTask.id,
  stage,
}: {
  taskId?: string
  stage?: VideoRepaintRouteStage
}) {
  const router = useRouter()
  const [refreshKey, setRefreshKey] = useState(0)
  const { task, error } = useVideoRepaintTask(taskId, refreshKey)
  const activeStage = stage ?? task?.currentStage ?? videoRepaintDemoTask.currentStage
  const shellStage: VideoRepaintStageKey = activeStage === 'target_script' ? 'episode_repaint' : activeStage
  const activeTask = task ?? videoRepaintDemoTask

  const advance = useCallback((fromStage: VideoRepaintRouteStage) => {
    const result = advanceVideoRepaintTask(taskId, fromStage)
    if (!result) return
    setRefreshKey((value) => value + 1)
    router.push(result.nextRoute)
  }, [router, taskId])

  useEffect(() => {
    const autoAdvance = getVideoRepaintAutoAdvance(taskId, activeStage)
    if (!autoAdvance) return undefined
    const timeout = window.setTimeout(() => {
      advance(activeStage)
    }, autoAdvance.delayMs)
    return () => window.clearTimeout(timeout)
  }, [activeStage, advance, taskId])

  const content = (() => {
    if (error) {
      return (
        <section className="rounded-[12px] border border-[var(--fos-border-soft)] bg-[var(--fos-bg-2)] p-6">
          <div className="text-[15px] font-bold text-white">{error}</div>
          <p className="mt-3 text-[13px] leading-6 text-[var(--fos-text-3)]">请返回编剧工作台重新选择任务。</p>
        </section>
      )
    }
    if (activeStage === 'source_settings') {
      return (
        <SettingsReviewPage
          review={activeTask.sourceSettings}
          regenerateLabel="重新提炼"
          confirmLabel="确认设定总纲，继续"
          onConfirm={() => advance('source_settings')}
        />
      )
    }
    if (activeStage === 'episode_alignment') {
      return (
        <EpisodeProgressGrid
          title="逐集对齐"
          description="系统正在按已确认的源设定总纲整理跨集人物、地点和道具称呼；该步骤不需要单独确认。"
          episodes={activeTask.alignmentEpisodes}
        />
      )
    }
    if (activeStage === 'target_settings') {
      return (
        <SettingsReviewPage
          review={activeTask.targetSettings}
          regenerateLabel="重新生成"
          confirmLabel="确认锁定，开始转绘"
          onConfirm={() => advance('target_settings')}
        />
      )
    }
    if (activeStage === 'episode_repaint') {
      return (
        <EpisodeProgressGrid
          title="逐集转绘（生成剧本转绘2.0）"
          description="系统正在根据源剧本、目标设定和对齐关系生成目标剧本。"
          episodes={activeTask.repaintEpisodes}
        />
      )
    }
    if (activeStage === 'target_script') {
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
        task={activeTask}
        currentStage={shellStage}
        onBack={() => router.push({ pathname: '/screenwriter' })}
        onRequirementClick={() => undefined}
      >
        {content}
      </VideoRepaintFlowShell>
    </FosShell>
  )
}
