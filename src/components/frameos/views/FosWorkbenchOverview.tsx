'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useSession } from 'next-auth/react'
import { Link } from '@/i18n/navigation'
import { AppIcon } from '@/components/ui/icons'
import { apiFetch } from '@/lib/api-fetch'
import { readApiErrorMessage } from '@/lib/api/read-error-message'
import { hasAccountPermissions } from '@/lib/account/permissions'
import { logError } from '@/lib/logging/core'
import {
  useTaskTargetStateMap,
  type TaskTargetState,
} from '@/lib/query/hooks/useTaskTargetStateMap'
import type { FosProjectData } from '../useFosProject'

type Tone = 'done' | 'failed' | 'pending' | 'idle'
type ProgressTone = 'running' | 'done' | 'failed' | 'idle'

const ASSET_EXTRACTION_TASK = 'asset_extraction_run'
const STORYBOARD_TASK = 'script_to_storyboard_run'

function isActivePhase(phase: TaskTargetState['phase'] | undefined) {
  return phase === 'queued' || phase === 'processing'
}

function readNumber(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.max(0, Math.floor(value))
}

function formatEta(seconds: number | null) {
  if (seconds === null) return '正在估算'
  if (seconds <= 10) return '即将完成'
  if (seconds < 60) return '少于 1 分钟'
  if (seconds < 3600) return `约 ${Math.max(1, Math.ceil(seconds / 60))} 分钟`
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.ceil((seconds % 3600) / 60)
  return minutes > 0 ? `约 ${hours} 小时 ${minutes} 分钟` : `约 ${hours} 小时`
}

function estimateRemainingSeconds(state: TaskTargetState | null, progress: number, now: number) {
  if (!state || !isActivePhase(state.phase)) return null
  const provided = readNumber(state.progressDetails?.estimatedRemainingSeconds)
  if (provided !== null) {
    const updatedAt = state.updatedAt ? Date.parse(state.updatedAt) : Number.NaN
    const elapsed = Number.isFinite(updatedAt) ? Math.max(0, Math.floor((now - updatedAt) / 1000)) : 0
    return Math.max(5, provided - elapsed)
  }
  const startedAt = state.startedAt ? Date.parse(state.startedAt) : Number.NaN
  if (!Number.isFinite(startedAt) || progress < 8 || progress >= 100) return null
  const elapsed = Math.max(1, (now - startedAt) / 1000)
  return Math.max(5, Math.min(7_200, Math.ceil((elapsed / progress) * (100 - progress))))
}

function stageText(state: TaskTargetState | null, fallback: string) {
  if (!state) return fallback
  const detail = state.progressDetails
  const labels: Record<string, string> = {
    'progress.runtime.llm.processing': '模型正在处理',
    'progress.runtime.llm.output': '模型正在生成内容',
    'progress.runtime.llm.reasoning': '模型正在规划内容',
    'progress.runtime.llm.completed': '模型输出完成',
    'progress.runtime.llm.failed': '模型输出失败',
    'progress.runtime.stage.llmSubmit': '正在提交模型请求',
    'progress.runtime.stage.llmStreaming': '模型正在生成内容',
    'progress.runtime.stage.llmFallbackNonStream': '模型正在继续处理',
    'progress.runtime.stage.llmCompleted': '模型输出完成',
    'progress.runtime.stage.llmFailed': '模型输出失败',
    'progress.stage.scriptToStoryboardPrepare': '准备本集分镜',
    'progress.stage.scriptToStoryboardStep': '生成镜头与画面调度',
    'progress.stage.scriptToStoryboardPersist': '保存本集分镜',
    'progress.stage.scriptToStoryboardPersistDone': '本集分镜保存完成',
    received: '任务已接收',
    asset_extraction_prepare: '读取并校验剧本',
    asset_extraction_analyze: '从剧本识别资产',
    asset_extraction_merge: '合并与校验资产',
    asset_extraction_refine: '完善角色视觉设定',
    asset_extraction_persist: '保存作品资产',
    asset_extraction_done: '资产解析完成',
    script_to_storyboard_prepare_clip: '从单集剧本准备分镜片段',
    script_to_storyboard_prepare: '准备分镜生成',
    script_to_storyboard_step: '生成镜头与画面调度',
    script_to_storyboard_persist: '保存分镜结果',
    script_to_storyboard_persist_done: '分镜与台词已保存',
    worker_llm_submit: '正在请求文本模型',
    worker_llm_streaming: '模型正在生成',
    worker_llm_complete: '模型输出完成',
  }
  const message = typeof detail?.message === 'string' ? detail.message.trim() : ''
  if (message && labels[message]) return labels[message]
  if (message && !/^(?:progress\.|[a-z][\w.-]*_[\w.-]+)/i.test(message)) return message
  if (state.stageLabel && labels[state.stageLabel]) return labels[state.stageLabel]
  if (state.stage && labels[state.stage]) return labels[state.stage]
  if (state.phase === 'queued') return '等待任务执行'
  if (state.phase === 'failed') return '任务执行失败'
  if (state.phase === 'completed') return '处理完成'
  return fallback
}

function productTaskError(message: string | null | undefined, fallback: string) {
  if (!message) return undefined
  if (/column is too long|value for the column is too long|Column:\s*(?:content|screenplay)/i.test(message)) {
    return '历史分镜结果保存失败；存储结构现已修复，请重新解析对应分集。'
  }
  if (/Invalid `(?:tx\.)?novelPromotionClip\.create\(\)` invocation/i.test(message)) {
    return '历史分镜结果保存失败，请重新解析对应分集。'
  }
  if (/Invalid `prisma\.|\bat\s+\S+\s*\(|webpack-internal|dist\/worker\.js/i.test(message)) return fallback
  return message
}

function useLiveNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [active])
  return now
}

function StageCard({
  step, title, status, tone, emphasized, children, footer,
}: {
  step: string
  title: string
  status: string
  tone: Tone
  emphasized?: boolean
  children: ReactNode
  footer: ReactNode
}) {
  return (
    <article
      className="flex min-w-0 flex-col rounded-[12px] border p-5"
      style={{
        background: 'var(--fos-bg-2)',
        borderColor: emphasized ? 'var(--fos-primary)' : 'var(--fos-border-mid)',
        boxShadow: emphasized ? '0 0 0 1px var(--fos-primary-border), 0 18px 42px rgba(13, 22, 50, .22)' : 'none',
        minHeight: 600,
      }}
    >
      <div className="mb-5 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="fos-pill shrink-0" style={{ height: 22 }}>{step}</span>
          <h2 className="truncate text-[15px] font-bold text-white">{title}</h2>
        </div>
        <span className={`fos-status shrink-0 ${tone}`}>{status}</span>
      </div>
      <div className="min-h-0 flex-1">{children}</div>
      <div className="mt-5">{footer}</div>
    </article>
  )
}

function WorkflowProgress({
  tone,
  progress,
  completedText,
  currentStage,
  etaText,
  errorText,
}: {
  tone: ProgressTone
  progress: number
  completedText: string
  currentStage: string
  etaText: string
  errorText?: string | null
}) {
  const safeProgress = Math.max(0, Math.min(100, Math.floor(progress)))
  const running = tone === 'running'
  const accent = tone === 'failed'
    ? '#ff7272'
    : tone === 'done'
      ? '#5bd39a'
      : '#6f8cff'
  const statusLabel = running
    ? '实时处理中'
    : tone === 'done'
      ? '本阶段已完成'
      : tone === 'failed'
        ? '需要处理'
        : '等待开始'

  return (
    <div
      className="relative overflow-hidden rounded-[12px] border px-3.5 py-3.5"
      style={{
        borderColor: tone === 'failed' ? 'rgba(255, 103, 103, .34)' : 'rgba(112, 139, 255, .28)',
        background: tone === 'failed'
          ? 'linear-gradient(145deg, rgba(92, 28, 42, .28), rgba(23, 27, 48, .88))'
          : 'radial-gradient(circle at 92% 0%, rgba(92, 112, 255, .18), transparent 42%), linear-gradient(145deg, rgba(31, 39, 72, .92), rgba(19, 24, 45, .94))',
      }}
      data-testid="workflow-progress-card"
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-[12px] font-bold text-white">
          <span
            className={`h-2 w-2 rounded-full ${running ? 'animate-pulse' : ''}`}
            style={{ background: accent, boxShadow: `0 0 12px ${accent}` }}
          />
          {statusLabel}
        </div>
        <span className="font-mono text-[12px] font-bold" style={{ color: accent }}>{safeProgress}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-white/[.08]">
        <div
          className="h-full rounded-full transition-[width] duration-700 ease-out"
          style={{
            width: `${safeProgress}%`,
            background: tone === 'failed'
              ? 'linear-gradient(90deg, #ff6464, #ff8a8a)'
              : 'linear-gradient(90deg, #4f7cff, #8d74ff 58%, #5bd5c4)',
            boxShadow: running ? '0 0 16px rgba(104, 128, 255, .55)' : 'none',
          }}
        />
      </div>
      <div className="mt-3 grid grid-cols-3 divide-x divide-white/[.07]">
        {[
          ['已完成', completedText],
          ['当前阶段', currentStage],
          ['预计剩余', etaText],
        ].map(([label, value]) => (
          <div key={label} className="min-w-0 px-2 first:pl-0 last:pr-0">
            <div className="text-[10px] font-medium tracking-[.04em] text-[var(--fos-text-4)]">{label}</div>
            <div className="mt-1 truncate text-[11px] font-bold text-[var(--fos-text-2)]" title={value}>{value}</div>
          </div>
        ))}
      </div>
      {errorText ? (
        <div className="mt-3 line-clamp-2 rounded-[8px] border border-red-400/20 bg-red-500/[.08] px-2.5 py-2 text-[11px] leading-5 text-red-200">
          {errorText}
        </div>
      ) : null}
    </div>
  )
}

export function FosWorkbenchOverview({ data }: { data: FosProjectData }) {
  const { data: session } = useSession()
  const accountRole = session?.user?.role
  const accountPermissions = session?.user?.permissions
  const canEditAssets = hasAccountPermissions({ role: accountRole, permissions: accountPermissions }, ['assetWrite'])
  const canEditStoryboards = hasAccountPermissions({ role: accountRole, permissions: accountPermissions }, ['storyboardWrite'])
  const [submittingAssets, setSubmittingAssets] = useState(false)
  const [submittingStoryboards, setSubmittingStoryboards] = useState(false)
  const [assetActionError, setAssetActionError] = useState<string | null>(null)
  const [storyboardActionError, setStoryboardActionError] = useState<string | null>(null)
  const [assetNotice, setAssetNotice] = useState<string | null>(null)
  const [storyboardNotice, setStoryboardNotice] = useState<string | null>(null)
  const refreshedAssetTask = useRef('')
  const refreshedStoryboardTasks = useRef('')
  const { projectId } = data
  const base = `/workflow/${projectId}/workbench-premium2`

  const assetTargets = useMemo(() => [{
    targetType: 'NovelPromotionProject',
    targetId: projectId,
    types: [ASSET_EXTRACTION_TASK],
  }], [projectId])
  const storyboardTargets = useMemo(() => data.episodes.map((episode) => ({
    targetType: 'NovelPromotionEpisode',
    targetId: episode.id,
    types: [STORYBOARD_TASK],
  })), [data.episodes])
  const assetTaskQuery = useTaskTargetStateMap(projectId, assetTargets, { staleTime: 1_000 })
  const storyboardTaskQuery = useTaskTargetStateMap(projectId, storyboardTargets, { staleTime: 1_000 })
  const assetTaskState = assetTaskQuery.getState('NovelPromotionProject', projectId)
  const storyboardStates = data.episodes.map((episode) => ({
    episode,
    state: storyboardTaskQuery.getState('NovelPromotionEpisode', episode.id),
  }))

  const episodeCount = data.episodes.length
  const scriptWordCount = data.episodes.reduce((sum, episode) => sum + episode.wordCount, 0)
  const scriptReady = episodeCount > 0
  const importActive = data.scriptImportStatus === 'pending' || data.scriptImportStatus === 'processing'
  const scriptStatus = scriptReady
    ? '已完成'
    : data.scriptImportStatus === 'failed'
      ? '失败'
      : data.scriptImportStatus === 'pending'
        ? '待处理'
        : data.scriptImportStatus === 'processing'
          ? '处理中'
          : '未开始'
  const scriptTone: Tone = scriptReady
    ? 'done'
    : data.scriptImportStatus === 'failed'
      ? 'failed'
      : importActive
        ? 'pending'
        : 'idle'

  const charCount = data.characters.length
  const itemCount = data.items.length
  const envCount = data.environments.length
  const totalAssetCount = charCount + itemCount + envCount
  const assetReady = totalAssetCount > 0
  const assetActive = isActivePhase(assetTaskState?.phase) || submittingAssets
  const assetFailed = !assetActive && assetTaskState?.phase === 'failed'
  const assetStatus = assetActive ? '解析中' : assetFailed ? '解析失败' : assetReady ? '已完成' : importActive ? '等待解析' : '未开始'
  const assetTone: Tone = assetActive ? 'pending' : assetFailed ? 'failed' : assetReady ? 'done' : importActive ? 'pending' : 'idle'

  const storyboardReadyCount = data.episodes.filter((episode) => (episode.storyboardCount || 0) > 0).length
  const storyboardPanelCount = data.episodes.reduce((sum, episode) => sum + (episode.storyboardPanelCount || 0), 0)
  const storyboardActiveStates = storyboardStates
    .map((item) => item.state)
    .filter((state): state is TaskTargetState => Boolean(state && isActivePhase(state.phase)))
  const storyboardActive = submittingStoryboards || storyboardActiveStates.length > 0
  // A successful rerun supersedes an older failed task for the same episode.
  const storyboardFailedState = storyboardStates.find(({ episode, state }) => (
    (episode.storyboardCount || 0) === 0 && state?.phase === 'failed'
  ))?.state || null
  const storyboardDone = episodeCount > 0 && storyboardReadyCount === episodeCount
  const canStartStoryboard = scriptReady && assetReady
  const storyboardStatus = storyboardActive
    ? '生成中'
    : storyboardDone
      ? '已完成'
      : storyboardFailedState
        ? '生成失败'
        : canStartStoryboard
          ? '未开始'
          : '等待资产'
  const storyboardTone: Tone = storyboardActive
    ? 'pending'
    : storyboardDone
      ? 'done'
      : storyboardFailedState
        ? 'failed'
        : 'idle'

  const charVariantCount = data.characters.reduce((sum, item) => sum + (item.variants?.length ?? 0), 0)
  const itemVariantCount = data.items.reduce((sum, item) => sum + (item.variants?.length ?? 0), 0)
  const boundVoiceCount = data.characters.filter((character) => Boolean(
    character.customVoiceUrl?.trim() || character.voiceId?.trim(),
  )).length
  const voiceStatus = boundVoiceCount === 0
    ? '待匹配'
    : boundVoiceCount === charCount
      ? '已全部匹配'
      : `已匹配 ${boundVoiceCount}`
  const assetRows: Array<[string, string, string, string]> = [
    ['角色', charCount > 0 ? `已解析 ${charCount}` : '等待解析', `主形象 ${charCount} · 变体 ${charVariantCount}`, 'characters'],
    ['物品', itemCount > 0 ? `已解析 ${itemCount}` : '等待解析', `物品设定 ${itemCount} · 变体 ${itemVariantCount}`, 'items'],
    ['环境', envCount > 0 ? `已解析 ${envCount}` : '等待解析', `环境设定 ${envCount}`, 'environments'],
    ['音色', voiceStatus, `角色音色 ${boundVoiceCount}/${charCount}`, 'timbre'],
  ]

  const isAnyTaskActive = assetActive || storyboardActive
  const now = useLiveNow(isAnyTaskActive)
  const assetProgress = assetActive
    ? Math.max(1, assetTaskState?.progress || (submittingAssets ? 2 : 0))
    : assetReady
      ? 100
      : 0
  const assetDetail = assetTaskState?.progressDetails
  const discoveredAssets = readNumber(assetDetail?.assetCompleted) ?? totalAssetCount
  const expectedAssets = readNumber(assetDetail?.assetTotal)
  const assetCompletedText = assetActive
    ? expectedAssets !== null
      ? `${discoveredAssets}/${expectedAssets} 个资产`
      : discoveredAssets > 0
        ? `已发现 ${discoveredAssets} 个`
        : `${readNumber(assetDetail?.episodeCompleted) || 0}/${readNumber(assetDetail?.episodeTotal) || episodeCount} 集剧本`
    : `${totalAssetCount} 个资产`
  const assetEta = formatEta(estimateRemainingSeconds(assetTaskState, assetProgress, now))
  const assetProgressTone: ProgressTone = assetActive
    ? 'running'
    : assetFailed
      ? 'failed'
      : assetReady
        ? 'done'
        : 'idle'

  const completedStoryboardEpisodes = storyboardStates.filter(({ episode, state }) => (
    (episode.storyboardCount || 0) > 0 || state?.phase === 'completed'
  )).length
  const generatedPanelCount = storyboardStates.reduce((sum, { episode, state }) => {
    if ((episode.storyboardPanelCount || 0) > 0) return sum + (episode.storyboardPanelCount || 0)
    return sum + (readNumber(state?.result?.panelCount) || 0)
  }, 0)
  const storyboardProgress = episodeCount === 0
    ? 0
    : Math.floor(storyboardStates.reduce((sum, { episode, state }) => {
      if ((episode.storyboardCount || 0) > 0 || state?.phase === 'completed') return sum + 100
      return sum + (isActivePhase(state?.phase) ? Math.max(1, state?.progress || 0) : 0)
    }, 0) / episodeCount)
  const currentStoryboardState = storyboardActiveStates[0] || null
  const storyboardEtas = storyboardActiveStates
    .map((state) => estimateRemainingSeconds(state, state.progress || 0, now))
    .filter((value): value is number => value !== null)
  const storyboardEta = formatEta(storyboardEtas.length > 0 ? Math.max(...storyboardEtas) : null)
  const storyboardProgressTone: ProgressTone = storyboardActive
    ? 'running'
    : storyboardFailedState
      ? 'failed'
      : storyboardDone
        ? 'done'
        : 'idle'

  const assetCompletionSignature = assetTaskState?.phase === 'completed'
    ? `${assetTaskState.updatedAt || ''}:${assetTaskState.result?.assets ? 'assets' : ''}`
    : ''
  useEffect(() => {
    if (!assetCompletionSignature || refreshedAssetTask.current === assetCompletionSignature) return
    refreshedAssetTask.current = assetCompletionSignature
    data.refetch()
  }, [assetCompletionSignature, data])

  const storyboardCompletionSignature = storyboardStates
    .filter(({ state }) => state?.phase === 'completed')
    .map(({ episode, state }) => `${episode.id}:${state?.updatedAt || ''}`)
    .join('|')
  useEffect(() => {
    if (!storyboardCompletionSignature || refreshedStoryboardTasks.current === storyboardCompletionSignature) return
    refreshedStoryboardTasks.current = storyboardCompletionSignature
    data.refetch()
  }, [data, storyboardCompletionSignature])

  const handleAssetExtraction = async () => {
    if (!canEditAssets || !scriptReady || assetActive) return
    if (assetReady) {
      const confirmed = window.confirm('重新解析会替换当前作品的角色、物品和环境资产，已有资产图片可能被移除。确定继续吗？')
      if (!confirmed) return
    }
    setSubmittingAssets(true)
    setAssetActionError(null)
    setAssetNotice(null)
    try {
      const response = await apiFetch(`/api/novel-promotion/${projectId}/asset-extraction`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ async: true, persist: true, clearExisting: true }),
      })
      if (!response.ok) throw new Error(await readApiErrorMessage(response, '提交资产解析失败'))
      const payload = await response.json() as { async?: boolean; deduped?: boolean }
      setAssetNotice(payload.deduped ? '已有资产解析任务正在执行，已恢复实时进度。' : '资产解析任务已提交，可离开页面后再返回查看。')
      await assetTaskQuery.refetch()
    } catch (error) {
      logError('[FosWorkbenchOverview] 提交资产解析失败', error)
      setAssetActionError(error instanceof Error ? error.message : '提交资产解析失败')
    } finally {
      setSubmittingAssets(false)
    }
  }

  const handleStoryboardGeneration = async () => {
    if (!canEditStoryboards || !canStartStoryboard || storyboardActive) return
    let targetEpisodes = data.episodes.filter((episode) => (episode.storyboardCount || 0) === 0)
    if (targetEpisodes.length === 0) {
      const confirmed = window.confirm('所有分集都已有分镜。重新生成会替换现有分镜内容，确定继续吗？')
      if (!confirmed) return
      targetEpisodes = data.episodes
    }
    setSubmittingStoryboards(true)
    setStoryboardActionError(null)
    setStoryboardNotice(null)
    let submitted = 0
    try {
      for (const episode of targetEpisodes) {
        const response = await apiFetch(`/api/novel-promotion/${projectId}/script-to-storyboard-stream`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            episodeId: episode.id,
            async: true,
            displayMode: 'detail',
          }),
        })
        if (!response.ok) {
          const message = await readApiErrorMessage(response, `第 ${episode.episodeNumber} 集分镜任务提交失败`)
          throw new Error(submitted > 0 ? `${message}；此前已成功提交 ${submitted} 集。` : message)
        }
        submitted += 1
      }
      setStoryboardNotice(`已提交 ${submitted} 集分镜生成任务；任务在后台执行，刷新或离开页面不会中断。`)
      await storyboardTaskQuery.refetch()
    } catch (error) {
      logError('[FosWorkbenchOverview] 提交分镜生成失败', error)
      setStoryboardActionError(error instanceof Error ? error.message : '提交分镜生成失败')
    } finally {
      setSubmittingStoryboards(false)
    }
  }

  return (
    <div className="fos-scroll">
      <section className="px-6 py-7">
        <div className="mb-6 flex items-center justify-between gap-4">
          <h2 className="text-[18px] font-bold text-white">作品工作台</h2>
          <div className="ml-auto flex items-center gap-3">
            <p className="hidden text-[13px] text-[var(--fos-text-3)] xl:block">按主流程从左到右推进；任务在后台可靠执行，刷新页面后会恢复实时进度。</p>
            <Link href={{ pathname: `${base}/canvas` }} className="fos-btn fos-btn-soft shrink-0"><AppIcon name="clapperboard" className="h-4 w-4" />无限画布</Link>
          </div>
        </div>
        <div className="fos-workflow-stage-grid">
          <StageCard
            step="Step 1"
            title="剧本解析"
            status={scriptStatus}
            tone={scriptTone}
            footer={<Link href={{ pathname: `${base}/script-review` }} className="fos-btn fos-btn-ghost w-full">查看解析详情</Link>}
          >
            <div className="space-y-4 text-[13px] text-white">
              <p className="font-bold">核心产出：{episodeCount} 集</p>
              <p className="text-[var(--fos-text-3)]">剧本：约 {scriptWordCount.toLocaleString('zh-CN')} 字</p>
              <p className="leading-7 text-[var(--fos-text-3)]">将原始素材整理为结构化的分集分场剧本，作为后续设定与制作的统一基础。</p>
            </div>
          </StageCard>

          <StageCard
            step="Step 2"
            title="资产设定"
            status={assetStatus}
            tone={assetTone}
            emphasized={canEditAssets && scriptReady && !assetReady}
            footer={(
              <div className="space-y-2.5">
                <button
                  type="button"
                  className="fos-btn fos-btn-primary w-full"
                  disabled={!canEditAssets || !scriptReady || assetActive}
                  title={canEditAssets ? undefined : '只有资产师和管理账号可以操作资产设定'}
                  onClick={() => void handleAssetExtraction()}
                  data-testid="asset-extraction-action"
                >
                  <AppIcon name={assetActive ? 'loader' : 'sparkles'} className={`h-4 w-4 ${assetActive ? 'animate-spin' : ''}`} />
                  {!canEditAssets ? '只读 · 资产师可操作' : assetActive ? '正在解析作品资产' : assetReady ? '重新解析作品资产' : '解析作品资产'}
                </button>
                <Link href={{ pathname: `${base}/assets/characters` }} className="fos-btn fos-btn-soft w-full">进入资产设定</Link>
              </div>
            )}
          >
            <p className="mb-3 text-[13px] leading-6 text-[var(--fos-text-2)]">从全部剧本识别角色、物品和环境，并形成后续可复用的一致性设定。</p>
            <WorkflowProgress
              tone={assetProgressTone}
              progress={assetProgress}
              completedText={assetCompletedText}
              currentStage={stageText(assetTaskState, assetReady ? '资产已就绪' : '等待提交')}
              etaText={assetActive ? assetEta : assetReady ? '已完成' : '—'}
              errorText={productTaskError(assetActionError || assetTaskState?.lastError?.message, '资产解析未完成，请重新提交。')}
            />
            {assetNotice ? <p className="mt-2 text-[11px] leading-5 text-[#8fa9ff]">{assetNotice}</p> : null}
            <div className="mt-3 space-y-2">
              {assetRows.map(([label, statusText, detail, href]) => (
                <div
                  key={label}
                  className="grid items-center gap-2 rounded-[9px] border border-[var(--fos-border-mid)] bg-[var(--fos-bg-3)] px-3 py-2"
                  style={{ gridTemplateColumns: '40px 1fr 52px' }}
                >
                  <div className="text-[12px] font-bold text-white">{label}</div>
                  <div className="min-w-0">
                    <div className={statusText.startsWith('已') ? 'text-[11px] font-bold text-[#59c98d]' : 'text-[11px] font-bold text-[var(--fos-text-3)]'}>{statusText}</div>
                    <div className="mt-0.5 truncate text-[10px] text-[var(--fos-text-4)]">{detail}</div>
                  </div>
                  <Link href={{ pathname: `${base}/assets/${href}` }} className="fos-btn fos-btn-soft fos-btn-sm">{label === '音色' ? '设置' : '查看'}</Link>
                </div>
              ))}
            </div>
          </StageCard>

          <StageCard
            step="Step 3"
            title="分镜设计"
            status={storyboardStatus}
            tone={storyboardTone}
            emphasized={canEditStoryboards && canStartStoryboard && !storyboardDone}
            footer={(
              <div className="space-y-2.5">
                <button
                  type="button"
                  className="fos-btn fos-btn-primary w-full"
                  disabled={!canEditStoryboards || !canStartStoryboard || storyboardActive}
                  title={canEditStoryboards ? undefined : '只有分镜师和管理账号可以操作分镜与视频'}
                  onClick={() => void handleStoryboardGeneration()}
                  data-testid="storyboard-generation-action"
                >
                  <AppIcon name={storyboardActive ? 'loader' : 'sparkles'} className={`h-4 w-4 ${storyboardActive ? 'animate-spin' : ''}`} />
                  {!canEditStoryboards ? '只读 · 分镜师可操作' : storyboardActive ? '正在生成作品分镜' : storyboardDone ? '重新生成作品分镜' : '生成作品分镜'}
                </button>
                <Link href={{ pathname: `${base}/storyboard` }} className="fos-btn fos-btn-soft w-full">进入分镜设计</Link>
              </div>
            )}
          >
            <p className="mb-3 text-[13px] leading-6 text-[var(--fos-text-2)]">将每集剧本拆解为可制作镜头，明确景别、画面调度、台词与节奏。</p>
            <WorkflowProgress
              tone={storyboardProgressTone}
              progress={storyboardProgress}
              completedText={`${completedStoryboardEpisodes}/${episodeCount} 集 · ${generatedPanelCount || storyboardPanelCount} 镜`}
              currentStage={stageText(currentStoryboardState || storyboardFailedState, storyboardDone ? '分镜已就绪' : canStartStoryboard ? '等待提交' : '等待资产')}
              etaText={storyboardActive ? storyboardEta : storyboardDone ? '已完成' : '—'}
              errorText={productTaskError(storyboardActionError || storyboardFailedState?.lastError?.message, '分镜生成未完成，请重新提交对应分集。')}
            />
            {storyboardNotice ? <p className="mt-2 text-[11px] leading-5 text-[#8fa9ff]">{storyboardNotice}</p> : null}
            <div className="mt-4 rounded-[10px] border border-[var(--fos-border-soft)] bg-[var(--fos-bg-3)] p-3">
              <div className="flex items-center justify-between text-[12px]">
                <span className="font-bold text-white">分集完成度</span>
                <span className="font-mono font-bold text-[#8fa9ff]">{completedStoryboardEpisodes}/{episodeCount}</span>
              </div>
              <p className="mt-2 text-[11px] leading-5 text-[var(--fos-text-4)]">
                {canStartStoryboard
                  ? storyboardDone
                    ? `共生成 ${generatedPanelCount || storyboardPanelCount} 个可制作镜头，可进入分镜设计继续调整。`
                    : '系统会逐集提交并自动防止重复任务；单集失败不影响其他已提交分集。'
                  : '前置：完成剧本解析和资产设定后，可生成作品分镜。'}
              </p>
            </div>
          </StageCard>

          <StageCard
            step="Step 4"
            title="制作剪辑"
            status="未开始"
            tone="idle"
            footer={(
              <div className="space-y-3">
                <Link href={{ pathname: `${base}/production/episodes` }} className="fos-btn fos-btn-primary w-full">进入制作剪辑</Link>
              </div>
            )}
          >
            <p className="text-[13px] leading-7 text-[var(--fos-text-2)]">生成各分镜的视频，并完成配音、配乐与成片组装。</p>
            <p className="mt-4 text-[12px] text-[var(--fos-text-3)]">前置：分镜设计审阅通过后，可进行制作。</p>
          </StageCard>
        </div>
      </section>
    </div>
  )
}
