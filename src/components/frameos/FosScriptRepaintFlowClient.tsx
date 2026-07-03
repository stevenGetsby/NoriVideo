'use client'

import { useCallback, useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import { useRouter } from '@/i18n/navigation'
import { FosShell } from './FosShell'
import { ScreenwriterLoadingSkeleton } from './screenwriter/ScreenwriterLoadingSkeleton'
import { VideoRepaintFlowShell } from './screenwriter/VideoRepaintFlowShell'
import {
  approveScriptRepaintStage,
  fetchScriptRepaintTargetScriptEpisodes,
  regenerateScriptRepaintSettings,
  updateScriptRepaintTargetScriptEpisode,
} from './screenwriter/screenwriterApi'
import { getScriptRepaintStageRoute } from './screenwriter/screenwriterRoutes'
import { useScriptRepaintTask } from './screenwriter/useScriptRepaintTask'
import type { TargetScriptEpisode, VideoRepaintRouteStage, VideoRepaintStageKey, VideoRepaintTaskDetail } from './screenwriter/types'

const POLLABLE_STAGES = new Set<VideoRepaintRouteStage>([
  'auto_split',
  'fact_extract',
  'episode_repaint',
])

function StageContentLoading() {
  return (
    <section className="rounded-[12px] border border-[var(--fos-border-soft)] bg-[var(--fos-bg-2)] p-6">
      <div className="text-[15px] font-bold text-white">正在加载阶段内容</div>
    </section>
  )
}

const SettingsReviewPage = dynamic(() => import('./screenwriter/SettingsReviewPage').then((mod) => mod.SettingsReviewPage), {
  loading: StageContentLoading,
})
const EpisodeProgressGrid = dynamic(() => import('./screenwriter/EpisodeProgressGrid').then((mod) => mod.EpisodeProgressGrid), {
  loading: StageContentLoading,
})
const TargetScriptReview = dynamic(() => import('./screenwriter/TargetScriptReview').then((mod) => mod.TargetScriptReview), {
  loading: StageContentLoading,
})

function createEmptyTask(taskId: string, currentStage: VideoRepaintStageKey): VideoRepaintTaskDetail {
  return {
    id: taskId || 'pending',
    title: '剧本转绘任务',
    taskTypeLabel: '剧本转绘 2.0',
    requirement: '',
    currentStage,
    canConfirmCurrentStage: false,
    canRetryCurrentStage: false,
    routeByStage: {
      auto_split: getScriptRepaintStageRoute(taskId || 'pending', 'auto_split'),
      fact_extract: getScriptRepaintStageRoute(taskId || 'pending', 'fact_extract'),
      source_settings: getScriptRepaintStageRoute(taskId || 'pending', 'source_settings'),
      episode_alignment: getScriptRepaintStageRoute(taskId || 'pending', 'episode_alignment'),
      target_settings: getScriptRepaintStageRoute(taskId || 'pending', 'target_settings'),
      episode_repaint: getScriptRepaintStageRoute(taskId || 'pending', 'episode_repaint'),
      target_script: getScriptRepaintStageRoute(taskId || 'pending', 'target_script'),
    },
    stages: [
      { key: 'auto_split', title: '自动拆集', subtitle: '源剧本文本拆分为集', status: currentStage === 'auto_split' ? 'running' : 'not_started' },
      { key: 'fact_extract', title: '事实卡提取', subtitle: '逐集提取人物、场景与剧情事实', status: 'not_started' },
      { key: 'source_settings', title: '源设定总纲', subtitle: '检查点 A', status: 'not_started', checkpoint: 'A' },
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
      collapsedPanelTitle: '源目标映射',
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

export function FosScriptRepaintFlowClient({
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
  const [targetEpisodesLoading, setTargetEpisodesLoading] = useState(false)
  const [targetEpisodesLoaded, setTargetEpisodesLoaded] = useState(false)
  const { task, error, isLoading, reload } = useScriptRepaintTask(taskId, refreshKey)
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
      router.push(getScriptRepaintStageRoute(taskId, routeStage))
    }
  }, [activeStage, reload, router, taskId])

  const approve = useCallback(async (fromStage: VideoRepaintRouteStage) => {
    if (fromStage !== 'source_settings' && fromStage !== 'target_settings') return
    try {
      setActionError(null)
      const updated = await approveScriptRepaintStage(taskId, fromStage)
      router.push(getScriptRepaintStageRoute(taskId, updated.currentStage))
      setRefreshKey((value) => value + 1)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : '确认阶段失败')
    }
  }, [router, taskId])

  const regenerate = useCallback(async (fromStage: 'source_settings' | 'target_settings', feedback: string) => {
    try {
      setActionError(null)
      await regenerateScriptRepaintSettings(taskId, fromStage, feedback)
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
    if (activeStage !== 'target_script') {
      setTargetEpisodesLoaded(false)
      return
    }
    let cancelled = false
    setTargetEpisodesLoading(true)
    setTargetEpisodesLoaded(false)
    fetchScriptRepaintTargetScriptEpisodes(taskId)
      .then((episodes) => {
        if (!cancelled) setTargetEpisodes(episodes)
      })
      .catch((err) => {
        if (!cancelled) setActionError(err instanceof Error ? err.message : '获取目标剧本失败')
      })
      .finally(() => {
        if (!cancelled) {
          setTargetEpisodesLoading(false)
          setTargetEpisodesLoaded(true)
        }
      })
    return () => {
      cancelled = true
    }
  }, [activeStage, taskId, refreshKey])

  const saveTargetEpisode = useCallback(async (episode: TargetScriptEpisode, content: string) => {
    await updateScriptRepaintTargetScriptEpisode(taskId, episode.id, {
      title: episode.title,
      content,
    })
    setRefreshKey((value) => value + 1)
  }, [taskId])

  if ((isLoading && !task) || (activeStage === 'target_script' && (!targetEpisodesLoaded || targetEpisodesLoading) && targetEpisodes.length === 0)) {
    return (
      <FosShell
        activeKey="screenwriter"
        hideSidebar
        header={<div className="flex items-center gap-3 border-b border-[var(--fos-border-soft)] px-6 py-4"><h1 className="text-[16px] font-bold text-white">剧本转绘 2.0</h1></div>}
      >
        <ScreenwriterLoadingSkeleton title="正在加载剧本转绘页面" />
      </FosShell>
    )
  }

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
          confirmLabel="确认源设定，继续"
          onConfirm={() => approve('source_settings')}
          onRegenerate={(feedback) => regenerate('source_settings', feedback)}
        />
      )
    }
    if (activeStage === 'target_settings') {
      return (
        <SettingsReviewPage
          review={activeTask.targetSettings}
          regenerateLabel="重新生成"
          confirmLabel="确认目标设定，开始转绘"
          onConfirm={() => approve('target_settings')}
          onRegenerate={(feedback) => regenerate('target_settings', feedback)}
        />
      )
    }
    if (activeStage === 'episode_repaint') {
      return (
        <EpisodeProgressGrid
          title="逐集转绘"
          description="系统正在根据源剧本、源设定和目标设定生成目标剧本。"
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
      header={<div className="flex items-center gap-3 border-b border-[var(--fos-border-soft)] px-6 py-4"><h1 className="text-[16px] font-bold text-white">剧本转绘 2.0</h1></div>}
    >
      <VideoRepaintFlowShell
        task={activeTask}
        currentStage={shellStage}
        onBack={() => router.push({ pathname: '/screenwriter' })}
      >
        {activeTask.requirement ? (
          <div id="script-repaint-requirement" className="mb-4 rounded-[8px] border border-[var(--fos-border-soft)] bg-[var(--fos-bg-2)] px-4 py-3 text-[13px] leading-6 text-[var(--fos-text-2)]">
            {activeTask.requirement}
          </div>
        ) : null}
        {actionError ? <div className="mb-4 rounded-[8px] border border-[#ef4444]/30 bg-[#ef4444]/10 px-4 py-3 text-[13px] text-[#fecaca]">{actionError}</div> : null}
        {content}
      </VideoRepaintFlowShell>
    </FosShell>
  )
}
