'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from '@/i18n/navigation'
import { FosShell } from './FosShell'
import { EpisodeProgressGrid } from './screenwriter/EpisodeProgressGrid'
import { SettingsReviewPage } from './screenwriter/SettingsReviewPage'
import { TargetScriptReview } from './screenwriter/TargetScriptReview'
import { VideoRepaintFlowShell } from './screenwriter/VideoRepaintFlowShell'
import {
  approveVideoRepaintStage,
  fetchTargetScriptEpisodes,
  regenerateVideoRepaintSettings,
  updateTargetScriptEpisode,
} from './screenwriter/screenwriterApi'
import { getVideoRepaintStageRoute } from './screenwriter/screenwriterRoutes'
import { useVideoRepaintTask } from './screenwriter/useVideoRepaintTask'
import type { TargetScriptEpisode, VideoRepaintRouteStage, VideoRepaintStageKey, VideoRepaintTaskDetail } from './screenwriter/types'

const POLLABLE_STAGES = new Set<VideoRepaintRouteStage>([
  'auto_split',
  'fact_extract',
  'episode_alignment',
  'episode_repaint',
])

function createEmptyTask(taskId: string, currentStage: VideoRepaintStageKey): VideoRepaintTaskDetail {
  return {
    id: taskId || 'pending',
    title: '视频转绘任务',
    taskTypeLabel: '视频转绘 2.0',
    requirement: '',
    currentStage,
    canConfirmCurrentStage: false,
    canRetryCurrentStage: false,
    routeByStage: {
      auto_split: getVideoRepaintStageRoute(taskId || 'pending', 'auto_split'),
      fact_extract: getVideoRepaintStageRoute(taskId || 'pending', 'fact_extract'),
      source_settings: getVideoRepaintStageRoute(taskId || 'pending', 'source_settings'),
      episode_alignment: getVideoRepaintStageRoute(taskId || 'pending', 'episode_alignment'),
      target_settings: getVideoRepaintStageRoute(taskId || 'pending', 'target_settings'),
      episode_repaint: getVideoRepaintStageRoute(taskId || 'pending', 'episode_repaint'),
      target_script: getVideoRepaintStageRoute(taskId || 'pending', 'target_script'),
    },
    stages: [
      { key: 'auto_split', title: '自动拆集', subtitle: '源视频切分为集', status: currentStage === 'auto_split' ? 'running' : 'not_started' },
      { key: 'fact_extract', title: '事实提取', subtitle: '提取人物、地点与剧情事实', status: 'not_started' },
      { key: 'source_settings', title: '源设定总纲', subtitle: '检查点 A', status: 'not_started', checkpoint: 'A' },
      { key: 'episode_alignment', title: '逐集对齐', subtitle: '跨集映射关系', status: 'not_started' },
      { key: 'target_settings', title: '目标设定总纲', subtitle: '检查点 B', status: 'not_started', checkpoint: 'B' },
      { key: 'episode_repaint', title: '逐集转绘', subtitle: '生成目标剧本', status: 'not_started' },
    ],
    sourceSettings: {
      title: '源设定总纲',
      checkpoint: 'A',
      outlineTitle: '等待生成',
      bodySections: [],
      collapsedPanelTitle: '人物/地点/道具索引',
      collapsedPanelCount: 0,
      nameIndexGroups: [],
      issuePanelTitle: '问题清单',
      issueCount: 0,
      issues: [],
      feedbackPlaceholder: '补充修改意见',
    },
    targetSettings: {
      title: '目标设定总纲',
      checkpoint: 'B',
      outlineTitle: '等待生成',
      bodySections: [],
      collapsedPanelTitle: '人物/地点/道具索引',
      collapsedPanelCount: 0,
      nameIndexGroups: [],
      issuePanelTitle: '问题清单',
      issueCount: 0,
      issues: [],
      feedbackPlaceholder: '补充修改意见',
    },
    alignmentEpisodes: [],
    repaintEpisodes: [],
  }
}

export function FosVideoRepaintFlowClient({
  taskId = '',
  stage,
}: {
  taskId?: string
  stage?: VideoRepaintRouteStage
}) {
  const router = useRouter()
  const [refreshKey, setRefreshKey] = useState(0)
  const [actionError, setActionError] = useState<string | null>(null)
  const [targetEpisodes, setTargetEpisodes] = useState<TargetScriptEpisode[]>([])
  const { task, error, isLoading, reload } = useVideoRepaintTask(taskId, refreshKey)
  const activeStage = stage ?? task?.currentStage ?? 'auto_split'
  const shellStage: VideoRepaintStageKey = activeStage === 'target_script' ? 'episode_repaint' : activeStage
  const activeTask = task ?? createEmptyTask(taskId, shellStage)

  const refreshAndRoute = useCallback(async () => {
    const next = await reload()
    if (!next) return
    const nextStage = next.currentStage
    const routeStage: VideoRepaintRouteStage =
      nextStage === 'episode_repaint' && next.stages.find((item) => item.key === 'episode_repaint')?.status === 'succeeded'
        ? 'target_script'
        : nextStage
    if (routeStage !== activeStage) {
      router.push(getVideoRepaintStageRoute(taskId, routeStage))
    }
  }, [activeStage, reload, router, taskId])

  const approve = useCallback(async (fromStage: VideoRepaintRouteStage) => {
    if (fromStage !== 'source_settings' && fromStage !== 'target_settings') return
    try {
      setActionError(null)
      const updated = await approveVideoRepaintStage(taskId, fromStage)
      const nextStage = updated.currentStage
      router.push(getVideoRepaintStageRoute(taskId, nextStage))
      setRefreshKey((value) => value + 1)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : '确认阶段失败')
    }
  }, [router, taskId])

  const regenerate = useCallback(async (fromStage: 'source_settings' | 'target_settings', feedback: string) => {
    try {
      setActionError(null)
      await regenerateVideoRepaintSettings(taskId, fromStage, feedback)
      setRefreshKey((value) => value + 1)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : '重新生成失败')
    }
  }, [taskId])

  useEffect(() => {
    if (!POLLABLE_STAGES.has(activeStage)) return undefined
    const timeout = window.setTimeout(() => {
      void refreshAndRoute()
    }, 10000)
    return () => window.clearTimeout(timeout)
  }, [activeStage, refreshAndRoute])

  useEffect(() => {
    if (activeStage !== 'target_script') return
    let cancelled = false
    fetchTargetScriptEpisodes(taskId)
      .then((episodes) => {
        if (!cancelled) setTargetEpisodes(episodes)
      })
      .catch((err) => {
        if (!cancelled) setActionError(err instanceof Error ? err.message : '获取目标剧本失败')
      })
    return () => {
      cancelled = true
    }
  }, [activeStage, taskId, refreshKey])

  const saveTargetEpisode = useCallback(async (episode: TargetScriptEpisode, content: string) => {
    await updateTargetScriptEpisode(taskId, episode.id, {
      title: episode.title,
      content,
    })
    setRefreshKey((value) => value + 1)
  }, [taskId])

  const content = (() => {
    if (isLoading && !task) {
      return (
        <section className="rounded-[12px] border border-[var(--fos-border-soft)] bg-[var(--fos-bg-2)] p-6">
          <div className="text-[15px] font-bold text-white">正在加载任务</div>
        </section>
      )
    }
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
          onConfirm={() => approve('source_settings')}
          onRegenerate={(feedback) => regenerate('source_settings', feedback)}
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
          onConfirm={() => approve('target_settings')}
          onRegenerate={(feedback) => regenerate('target_settings', feedback)}
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
      return <TargetScriptReview episodes={targetEpisodes} onSaveEpisode={saveTargetEpisode} />
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
      >
        {activeTask.requirement ? (
          <div id="video-repaint-requirement" className="mb-4 rounded-[8px] border border-[var(--fos-border-soft)] bg-[var(--fos-bg-2)] px-4 py-3 text-[13px] leading-6 text-[var(--fos-text-2)]">
            {activeTask.requirement}
          </div>
        ) : null}
        {actionError ? <div className="mb-4 rounded-[8px] border border-[#ef4444]/30 bg-[#ef4444]/10 px-4 py-3 text-[13px] text-[#fecaca]">{actionError}</div> : null}
        {content}
      </VideoRepaintFlowShell>
    </FosShell>
  )
}
