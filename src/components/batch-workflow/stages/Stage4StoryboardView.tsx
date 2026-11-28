'use client'

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AppIcon } from '@/components/ui/icons'
import { MediaImage } from '@/components/media/MediaImage'
import {
  MentionPromptEditor,
  type MentionPromptAsset,
} from '@/components/frameos/materials/MentionPromptEditor'
import { confirmAction } from '@/lib/ui/feedback'
import { toCanvasDisplayImageUrl } from '@/lib/media/image-url'
import {
  reconcileShotAssetMentions,
  type AssetsArtifact,
  type BatchItemDTO,
  type BatchStageState,
  type StoryboardArtifact,
  type StoryboardShotItem,
  type StoryboardStageParams,
  type VideoInputMode,
  type WorkflowAssetItem,
  type WorkflowAssetKind,
  type WorkflowModelConfig,
} from '@/lib/batch-workflow/types'
import {
  clampDurationSec,
  durationOptions,
  isAssetChipBound,
  normalizeDurationBounds,
  trySave,
} from './_helpers'

export interface StoryboardVideoCapabilities {
  supportsFirstLastFrame: boolean
  minDurationSec: number
  maxDurationSec: number
}

export interface Stage4StoryboardViewProps {
  item: BatchItemDTO
  assetsArtifact: AssetsArtifact | null
  hasUpstreamScript: boolean
  artifact: StoryboardArtifact | null
  modelConfig: WorkflowModelConfig
  videoCapabilities: StoryboardVideoCapabilities
  isTrialView: boolean
  stageState: BatchStageState
  stageParams?: StoryboardStageParams
  running: boolean
  elapsedSeconds?: number
  saving: boolean
  draftSyncNonce?: number
  canManageSkills: boolean
  onRunStage: (paramsOverride: StoryboardStageParams, forceRerun?: boolean) => Promise<void>
  onUpdateModelConfig: (patch: Partial<WorkflowModelConfig>) => Promise<void>
  onSaveDraft: (edited: StoryboardArtifact) => Promise<void>
  onApproveAndNext: (edited: StoryboardArtifact) => Promise<void>
  onRegisterGetDraft?: (getter: (() => StoryboardArtifact | null) | null) => void
  onDirtyChange?: (dirty: boolean) => void
  onQuoteSnippet?: (snippet: { label: string; text: string }) => void
  onJumpToAssets?: () => void
  onNotify?: (msg: string, tone?: 'success' | 'error' | 'info') => void
  /** Optional flush hook supplied by parent (D). */
  onFlushBeforeRun?: () => Promise<void> | void
}

const KIND_LABELS: Record<WorkflowAssetKind, string> = {
  character: '角色',
  location: '场景',
  prop: '物品',
}

const SHOT_COUNT_OPTIONS = [
  { value: 0, label: '自动规划' },
  { value: 4, label: '4 镜' },
  { value: 6, label: '6 镜' },
  { value: 8, label: '8 镜' },
  { value: 10, label: '10 镜' },
  { value: 12, label: '12 镜' },
]

const INPUT_MODE_OPTIONS: Array<{ value: VideoInputMode; label: string; hint: string }> = [
  { value: 'text', label: '全能参考', hint: '自动挂载所有 @引用资产参考图与角色音色' },
  { value: 'image', label: '图生视频', hint: '以主参考图作为首帧生成动态镜头' },
  { value: 'firstlastframe', label: '首尾帧', hint: '以首尾参考图平滑过渡（需视频模型支持）' },
]

function isAssetImageReady(asset: WorkflowAssetItem): boolean {
  return (asset.status === 'ready' || asset.status === 'reused') && Boolean(asset.materialId)
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function stripAssetMentionTokens(prompt: string, asset: Pick<WorkflowAssetItem, 'name' | 'aliases'>): string {
  const tokens = [asset.name, ...(Array.isArray(asset.aliases) ? asset.aliases : [])]
    .map((t) => (typeof t === 'string' ? t.trim() : ''))
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
  let next = prompt
  for (const token of tokens) {
    const re = new RegExp(`@${escapeRegExp(token)}(?:\\s+)?`, 'gi')
    next = next.replace(re, '')
  }
  return next.replace(/[ \t]{2,}/g, ' ').trimStart()
}

function recomputeStoryboardTotals(artifact: StoryboardArtifact): StoryboardArtifact {
  const normalizedShots = artifact.shots.map((shot, idx) => ({
    ...shot,
    shotIndex: idx + 1,
  }))
  const totalDurationSec = normalizedShots.reduce((acc, s) => acc + (Number(s.durationSec) || 0), 0)
  return {
    ...artifact,
    shots: normalizedShots,
    totalDurationSec,
  }
}

export const Stage4StoryboardView = memo(function Stage4StoryboardView({
  item,
  assetsArtifact,
  hasUpstreamScript,
  artifact,
  modelConfig,
  videoCapabilities,
  isTrialView,
  stageState,
  stageParams,
  running,
  elapsedSeconds = 0,
  saving,
  draftSyncNonce = 0,
  canManageSkills,
  onRunStage,
  onUpdateModelConfig,
  onSaveDraft,
  onApproveAndNext,
  onRegisterGetDraft,
  onDirtyChange,
  onQuoteSnippet,
  onJumpToAssets,
  onNotify,
  onFlushBeforeRun,
}: Stage4StoryboardViewProps) {
  const [draft, setDraft] = useState<StoryboardArtifact | null>(artifact)
  const [dirty, setDirty] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [filmstripMode, setFilmstripMode] = useState(false)
  const [selectedShotId, setSelectedShotId] = useState<string | null>(null)
  const [expandedAdvancedShotId, setExpandedAdvancedShotId] = useState<string | null>(null)

  const [targetShotCount, setTargetShotCount] = useState<number>(stageParams?.targetShotCount || 0)
  const [maxShotDurationSec, setMaxShotDurationSec] = useState<number>(
    stageParams?.maxShotDurationSec || modelConfig.videoDurationSeconds || 5,
  )
  const [customInstruction, setCustomInstruction] = useState<string>(stageParams?.customInstruction || '')

  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty
  const prevScopeRef = useRef<{ itemId: string; isTrialView: boolean }>({
    itemId: item.id,
    isTrialView,
  })
  const prevRunningRef = useRef(running)
  const lastSyncNonceRef = useRef(draftSyncNonce)

  useEffect(() => {
    const scopeChanged =
      prevScopeRef.current.itemId !== item.id
      || prevScopeRef.current.isTrialView !== isTrialView
      || draftSyncNonce !== lastSyncNonceRef.current
    const rerunJustCompleted = prevRunningRef.current && !running
    prevScopeRef.current = { itemId: item.id, isTrialView }
    prevRunningRef.current = running
    lastSyncNonceRef.current = draftSyncNonce

    if (scopeChanged || (rerunJustCompleted && !dirtyRef.current) || !dirtyRef.current) {
      setDraft(artifact)
      setDirty(false)
    }
  }, [artifact, draftSyncNonce, isTrialView, item.id, running])

  useEffect(() => {
    onDirtyChange?.(dirty && !isTrialView)
  }, [dirty, isTrialView, onDirtyChange])

  useEffect(() => () => {
    onDirtyChange?.(false)
  }, [onDirtyChange])

  useEffect(() => {
    if (typeof stageParams?.targetShotCount === 'number') setTargetShotCount(stageParams.targetShotCount)
    if (typeof stageParams?.maxShotDurationSec === 'number') setMaxShotDurationSec(stageParams.maxShotDurationSec)
    if (stageParams?.customInstruction !== undefined) setCustomInstruction(stageParams.customInstruction)
  }, [stageParams?.customInstruction, stageParams?.maxShotDurationSec, stageParams?.targetShotCount])

  const draftRef = useRef<StoryboardArtifact | null>(draft)
  draftRef.current = draft
  const draftVersionRef = useRef(0)
  const commitDirtySuccess = useCallback((version: number) => {
    if (draftVersionRef.current === version) setDirty(false)
  }, [])

  const supportsFirstLastFrame = videoCapabilities.supportsFirstLastFrame
    && (artifact ? artifact.supportsFirstLastFrame !== false : true)

  const durationBounds = useMemo(() => normalizeDurationBounds({
    min: videoCapabilities.minDurationSec,
    max: videoCapabilities.maxDurationSec,
  }, artifact?.allowedDurationRange), [artifact?.allowedDurationRange, videoCapabilities.maxDurationSec, videoCapabilities.minDurationSec])

  const allowedDurations = useMemo(() => durationOptions(durationBounds), [durationBounds])

  const stage3Assets = useMemo(() => assetsArtifact?.items || [], [assetsArtifact?.items])
  const stage3AssetById = useMemo(
    () => new Map(stage3Assets.map((a) => [a.id, a])),
    [stage3Assets],
  )

  const ungeneratedReferencedAssets = useMemo(() => {
    if (!draft || stage3Assets.length === 0) return [] as WorkflowAssetItem[]
    const missing: WorkflowAssetItem[] = []
    const seen = new Set<string>()
    for (const shot of draft.shots) {
      for (const id of shot.referencedAssetIds || []) {
        if (seen.has(id)) continue
        const asset = stage3AssetById.get(id)
        if (asset && !isAssetImageReady(asset)) {
          seen.add(id)
          missing.push(asset)
        }
      }
    }
    return missing
  }, [draft, stage3AssetById, stage3Assets.length])

  const mentionAssets: MentionPromptAsset[] = useMemo(() => (
    stage3Assets.map((asset) => ({
      id: asset.id,
      name: asset.name,
      imageUrl: asset.imageUrl || asset.storageKey || null,
      mediaType: 'image' as const,
      description: `${KIND_LABELS[asset.kind]} · ${isAssetImageReady(asset) ? (asset.roleOrUsage || asset.description) : '未出图 · 建议先返回第 3 步出图'}`,
      category: asset.kind,
      materialId: asset.materialId || null,
    }))
  ), [stage3Assets])

  const currentStageParams: StoryboardStageParams = useMemo(() => ({
    ...(targetShotCount > 0 ? { targetShotCount } : {}),
    maxShotDurationSec,
    ...(customInstruction.trim() ? { customInstruction: customInstruction.trim() } : {}),
  }), [customInstruction, maxShotDurationSec, targetShotCount])

  useEffect(() => {
    setMaxShotDurationSec((current) => clampDurationSec(current, durationBounds))
  }, [durationBounds])

  const normalizeForSave = useCallback((source: StoryboardArtifact): StoryboardArtifact => (
    recomputeStoryboardTotals({
      ...source,
      allowedDurationRange: durationBounds,
      shots: source.shots.map((shot) => ({
        ...shot,
        durationSec: clampDurationSec(shot.durationSec, durationBounds),
        inputMode: shot.inputMode === 'firstlastframe' && !supportsFirstLastFrame ? 'text' : shot.inputMode,
      })),
    })
  ), [durationBounds, supportsFirstLastFrame])

  useEffect(() => {
    if (!onRegisterGetDraft) return
    onRegisterGetDraft(() => (draftRef.current ? normalizeForSave(draftRef.current) : null))
    return () => onRegisterGetDraft(null)
  }, [normalizeForSave, onRegisterGetDraft])

  const totalDurationSec = useMemo(() => (
    draft ? draft.shots.reduce((acc, s) => acc + (Number(s.durationSec) || 0), 0) : 0
  ), [draft])

  const updateShot = (index: number, patch: Partial<StoryboardShotItem>) => {
    if (isTrialView) return
    setDraft((prev) => {
      if (!prev) return prev
      const nextShots = prev.shots.map((sh, idx) => (idx === index ? { ...sh, ...patch } : sh))
      return recomputeStoryboardTotals({ ...prev, shots: nextShots })
    })
    draftVersionRef.current += 1
    setDirty(true)
  }

  const toggleAssetBinding = (shotIndex: number, asset: WorkflowAssetItem) => {
    if (isTrialView || !draft) return
    const shot = draft.shots[shotIndex]
    if (!shot) return
    const alreadyBound = isAssetChipBound(shot, asset)
    let nextIds: string[]
    let nextNames: string[]
    let nextPrompt = shot.videoPrompt
    if (alreadyBound) {
      nextPrompt = stripAssetMentionTokens(nextPrompt, asset)
      nextIds = shot.referencedAssetIds.filter((id) => id !== asset.id)
      nextNames = shot.referencedAssetNames.filter((name) => name !== asset.name)
    } else {
      nextIds = Array.from(new Set([...(shot.referencedAssetIds || []), asset.id]))
      nextNames = Array.from(new Set([...(shot.referencedAssetNames || []), asset.name]))
      const token = `@${asset.name}`
      if (!nextPrompt.includes(token)) {
        nextPrompt = nextPrompt.trim() ? `${token} ${nextPrompt}` : `${token} `
      }
    }
    updateShot(shotIndex, {
      referencedAssetIds: nextIds,
      referencedAssetNames: nextNames,
      videoPrompt: nextPrompt,
    })
  }

  const handlePromptChange = (shotIndex: number, nextVal: string) => {
    if (isTrialView) return
    const reconciled = reconcileShotAssetMentions(nextVal, stage3Assets)
    updateShot(shotIndex, {
      videoPrompt: nextVal,
      referencedAssetIds: reconciled.referencedAssetIds,
      referencedAssetNames: reconciled.referencedAssetNames,
    })
  }

  const handleMentionSelectAsset = (shotIndex: number, asset: MentionPromptAsset, nextValue?: string) => {
    if (isTrialView || !draft || !asset.id) return
    const shot = draft.shots[shotIndex]
    if (!shot) return
    const promptToScan = typeof nextValue === 'string' ? nextValue : shot.videoPrompt
    const reconciled = reconcileShotAssetMentions(promptToScan, stage3Assets)
    const nextIds = reconciled.referencedAssetIds.includes(asset.id)
      ? reconciled.referencedAssetIds
      : [...reconciled.referencedAssetIds, asset.id]
    const nextNames = Array.from(new Set([...reconciled.referencedAssetNames, asset.name]))
    updateShot(shotIndex, {
      ...(typeof nextValue === 'string' ? { videoPrompt: nextValue } : {}),
      referencedAssetIds: nextIds,
      referencedAssetNames: nextNames,
    })
  }

  const moveShot = (index: number, delta: -1 | 1) => {
    if (isTrialView || !draft) return
    const target = index + delta
    if (target < 0 || target >= draft.shots.length) return
    const nextShots = [...draft.shots]
    const [moved] = nextShots.splice(index, 1)
    nextShots.splice(target, 0, moved)
    setDraft(recomputeStoryboardTotals({ ...draft, shots: nextShots }))
    draftVersionRef.current += 1
    setDirty(true)
  }

  const addShot = () => {
    if (isTrialView || !draft) return
    const defaultDur = Math.max(durationBounds.min, Math.min(durationBounds.max, maxShotDurationSec || 5))
    const newShot: StoryboardShotItem = {
      shotId: `shot_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`,
      shotIndex: draft.shots.length + 1,
      sceneIndex: draft.shots.length + 1,
      title: `新增分镜 ${draft.shots.length + 1}`,
      durationSec: defaultDur,
      shotType: '中景',
      cameraMovement: '缓慢推镜',
      visualDescription: '',
      firstFramePrompt: '',
      videoPrompt: '',
      dialogue: '',
      onscreenText: '',
      referencedAssetIds: [],
      referencedAssetNames: [],
      inputMode: modelConfig.videoInputMode === 'firstlastframe' && !supportsFirstLastFrame
        ? 'text'
        : modelConfig.videoInputMode,
      negativeConstraints: '无水印、无文字畸变、无多余肢体',
    }
    setDraft(recomputeStoryboardTotals({ ...draft, shots: [...draft.shots, newShot] }))
    setSelectedShotId(newShot.shotId)
    draftVersionRef.current += 1
    setDirty(true)
  }

  const removeShot = async (index: number) => {
    if (isTrialView || !draft) return
    const shot = draft.shots[index]
    const ok = await confirmAction({
      title: `删除镜头 S${String(index + 1).padStart(2, '0')}？`,
      message: `将移除「${shot?.title || `分镜 ${index + 1}`}」，保存后生效。`,
      confirmLabel: '确认删除',
      danger: true,
    })
    if (!ok) return
    setDraft(recomputeStoryboardTotals({
      ...draft,
      shots: draft.shots.filter((_, idx) => idx !== index),
    }))
    draftVersionRef.current += 1
    setDirty(true)
  }

  const handleSave = async () => {
    if (!draft) return
    const version = draftVersionRef.current
    const res = await trySave(onSaveDraft, normalizeForSave(draft))
    if (res.ok) {
      commitDirtySuccess(version)
      setSaveError(null)
    } else {
      setSaveError(res.error)
      onNotify?.(res.error, 'error')
    }
  }

  const handleApprove = async () => {
    if (!draft) return
    const version = draftVersionRef.current
    const res = await trySave(onApproveAndNext, normalizeForSave(draft))
    if (res.ok) {
      commitDirtySuccess(version)
      setSaveError(null)
    } else {
      setSaveError(res.error)
      onNotify?.(res.error, 'error')
    }
  }

  const handleRerunRequest = useCallback(async () => {
    if (dirty) {
      const ok = await confirmAction({
        title: '先保存修改，再重新生成分镜？',
        message: '当前分镜有未保存修改。保存成功后才提交重新生成。',
        confirmLabel: '保存并重跑',
        cancelLabel: '取消',
      })
      if (!ok) return
    }
    try {
      const version = draftVersionRef.current
      if (onFlushBeforeRun) {
        await onFlushBeforeRun()
      } else if (dirty && draft) {
        const res = await trySave(onSaveDraft, normalizeForSave(draft))
        if (!res.ok) { setSaveError(res.error); onNotify?.(res.error, 'error'); return }
        commitDirtySuccess(version)
      }
      setSaveError(null)
      await onRunStage(currentStageParams, true)
    } catch (err) {
      const msg = err instanceof Error ? err.message : '执行失败，请重试'
      setSaveError(msg)
      onNotify?.(msg, 'error')
    }
  }, [commitDirtySuccess, currentStageParams, dirty, draft, normalizeForSave, onFlushBeforeRun, onNotify, onRunStage, onSaveDraft])

  return (
    <div className="flex flex-col gap-3.5" data-stage="storyboard">
      {/* Compact Stage 4 Params Bar */}
      <div className="wf-stage-params-bar">
        <div className="flex flex-wrap items-center gap-3 flex-1 min-w-0">
          <div className="wf-param-group">
            <span className="wf-param-label">目标镜头数</span>
            <select
              className="wf-select wf-select-sm"
              style={{ width: 102 }}
              aria-label="目标镜头数"
              value={targetShotCount}
              onChange={(e) => setTargetShotCount(Number(e.target.value) || 0)}
            >
              {SHOT_COUNT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          <div className="wf-param-group">
            <span className="wf-param-label">单镜时长偏好</span>
            <div className="wf-param-pills">
              {allowedDurations.slice(0, 5).map((sec) => (
                <button
                  key={sec}
                  type="button"
                  className={`wf-param-pill wf-num${maxShotDurationSec === sec ? ' is-active' : ''}`}
                  onClick={() => setMaxShotDurationSec(sec)}
                >
                  {sec}s
                </button>
              ))}
            </div>
          </div>

          <div className="wf-param-group">
            <span className="wf-param-label">资产绑定模式</span>
            <div className="wf-param-pills">
              {INPUT_MODE_OPTIONS.map((opt) => {
                const disabled = opt.value === 'firstlastframe' && !supportsFirstLastFrame
                return (
                  <button
                    key={opt.value}
                    type="button"
                    disabled={disabled}
                    title={disabled ? '当前所选视频模型不支持首尾帧模式，请切换支持首尾帧的模型' : opt.hint}
                    className={`wf-param-pill${modelConfig.videoInputMode === opt.value ? ' is-active' : ''}`}
                    style={disabled ? { opacity: 0.42, cursor: 'not-allowed' } : undefined}
                    onClick={() => {
                      if (!disabled) void onUpdateModelConfig({ videoInputMode: opt.value })
                    }}
                  >
                    {opt.label}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="flex-1 min-w-[160px]">
            <input
              className="wf-input wf-input-sm"
              value={customInstruction}
              placeholder="补充运镜或分镜要求（如：前两镜快切特写）…"
              onChange={(e) => setCustomInstruction(e.target.value)}
            />
          </div>
        </div>

        <button
          type="button"
          className="wf-btn wf-btn-stage wf-btn-sm shrink-0"
          disabled={running || !hasUpstreamScript}
          onClick={() => void handleRerunRequest()}
        >
          {running ? <span className="wf-spinner" /> : <AppIcon name="sparkles" className="h-3.5 w-3.5" />}
          <span>{running ? `生成分镜提示词中…${elapsedSeconds > 0 ? ` ${elapsedSeconds}s` : ''}` : draft ? '重新生成分镜' : '生成分镜提示词'}</span>
        </button>
      </div>

      {stageState.error ? (
        <div className="wf-stale-banner">
          <div className="wf-stale-banner-main">
            <AppIcon name="alert" className="wf-stale-banner-icon h-4 w-4" />
            <span>分镜生成失败：{stageState.error}</span>
          </div>
        </div>
      ) : null}

      {saveError ? (
        <div className="wf-stale-banner wf-save-error" role="alert">
          <div className="wf-stale-banner-main">
            <AppIcon name="alert" className="wf-stale-banner-icon h-4 w-4" />
            <span>保存失败：{saveError}（修改仍在本地，可重试）</span>
          </div>
          <div className="wf-stale-banner-actions">
            <button
              type="button"
              className="wf-btn wf-btn-warning wf-btn-xs"
              disabled={saving || running}
              onClick={() => void handleSave()}
            >
              <AppIcon name="refresh" className="h-3 w-3" />重试保存
            </button>
            <button type="button" className="wf-btn wf-btn-ghost wf-btn-xs" onClick={() => setSaveError(null)}>
              关闭
            </button>
          </div>
        </div>
      ) : null}

      {artifact?.qc && artifact.qc.status !== 'passed' ? (
        <div className={`wf-qc-banner is-${artifact.qc.status}`} role="status">
          <div className="wf-stale-banner-main">
            <AppIcon name="alert" className="wf-stale-banner-icon h-4 w-4" />
            <span>
              质量检查：{artifact.qc.status === 'failed' ? '未通过' : '警告'}
              {artifact.qc.violations.length > 0 ? `（${artifact.qc.violations.length} 项）` : ''}
            </span>
          </div>
          {artifact.qc.violations.length > 0 ? (
            <ul className="wf-qc-violation-list">
              {artifact.qc.violations.slice(0, 5).map((v, i) => (
                <li key={i} className="wf-qc-violation-item">
                  <span className="wf-qc-rule">{v.rule}</span>
                  <span className="wf-qc-path">{v.path}</span>
                  <span className="wf-qc-msg">{v.message}</span>
                </li>
              ))}
              {artifact.qc.violations.length > 5 ? (
                <li className="wf-qc-violation-item is-more">… 共 {artifact.qc.violations.length} 项违规</li>
              ) : null}
            </ul>
          ) : null}
        </div>
      ) : null}

      {/* Empty State */}
      {!draft ? (
        <div className="wf-card">
          <div className="wf-empty">
            <span className="wf-empty-icon">
              {running ? <span className="wf-spinner" /> : <AppIcon name="film" className="h-5 w-5" />}
            </span>
            <div className="wf-empty-title">
              {running
                ? `正在编写带 @资产引用的电影级分镜提示词…${elapsedSeconds > 0 ? `（已用 ${elapsedSeconds}s）` : ''}`
                : '将洗稿剧本与视觉资产编译为可执行分镜'}
            </div>
            <div className="wf-empty-desc">
              自动遵守当前视频模型时长上限（{durationBounds.min}–{durationBounds.max}s）与参考图模式，生成含 @角色/@场景/@道具 提及语法的视频提示词。
            </div>
            <div className="wf-empty-actions">
              <button
                type="button"
                className="wf-btn wf-btn-primary"
                disabled={running || !hasUpstreamScript}
                onClick={() => void handleRerunRequest()}
              >
                <AppIcon name="sparkles" className="h-3.5 w-3.5" />生成分镜提示词
              </button>
            </div>
          </div>
        </div>
      ) : (
        <>
          {ungeneratedReferencedAssets.length > 0 ? (
            <div className="wf-stale-banner" role="alert">
              <div className="wf-stale-banner-main">
                <AppIcon name="alert" className="wf-stale-banner-icon h-4 w-4" />
                <span>
                  有 <strong>{ungeneratedReferencedAssets.length}</strong> 项被引用资产尚未出图（
                  {ungeneratedReferencedAssets.slice(0, 4).map((a) => `@${a.name}`).join('、')}
                  {ungeneratedReferencedAssets.length > 4 ? ' 等' : ''}
                  ），生视频将无法保持角色/场景一致
                </span>
              </div>
              {onJumpToAssets ? (
                <div className="wf-stale-banner-actions">
                  <button
                    type="button"
                    className="wf-btn wf-btn-warning wf-btn-xs"
                    onClick={onJumpToAssets}
                  >
                    <AppIcon name="sparkles" className="h-3 w-3" />返回第 3 步一键出图
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}

          {/* Storyboard Toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <div className="wf-param-pills">
                <button
                  type="button"
                  className={`wf-param-pill${!filmstripMode ? ' is-active' : ''}`}
                  onClick={() => setFilmstripMode(false)}
                >
                  列表精编
                </button>
                <button
                  type="button"
                  className={`wf-param-pill${filmstripMode ? ' is-active' : ''}`}
                  onClick={() => setFilmstripMode(true)}
                >
                  胶片墙
                </button>
              </div>
              <span className="wf-badge is-stage wf-num">
                {draft.shots.length} 镜 · 总计 {totalDurationSec}s · {draft.aspectRatio}
              </span>
              <span className="wf-badge is-muted">
                可 @引用第 3 步资产：{stage3Assets.length} 项
              </span>
              {dirty && !isTrialView ? <span className="wf-badge is-warning">有未保存修改</span> : null}
            </div>

            {!isTrialView ? (
              <div className="flex items-center gap-2">
                <button type="button" className="wf-btn wf-btn-subtle wf-btn-sm" onClick={addShot}>
                  <AppIcon name="plus" className="h-3.5 w-3.5" />新增镜头
                </button>
                <button
                  type="button"
                  className="wf-btn wf-btn-sm"
                  disabled={saving || running || !dirty}
                  onClick={() => void handleSave()}
                >
                  {saving ? <span className="wf-spinner" /> : <AppIcon name="check" className="h-3.5 w-3.5" />}
                  <span>保存修改</span>
                </button>
                <button
                  type="button"
                  className="wf-btn wf-btn-primary wf-btn-sm"
                  disabled={saving || running}
                  onClick={() => void handleApprove()}
                >
                  <span>进入批量生视频</span>
                  <span className="wf-mono text-[10px] opacity-80">⌘↵</span>
                </button>
              </div>
            ) : null}
          </div>

          {/* Storyboard Cards */}
          <div className={`wf-shot-list${filmstripMode ? ' is-filmstrip' : ''}`}>
            {draft.shots.map((shot, idx) => {
              const isSelected = selectedShotId === shot.shotId
              const isAdvOpen = expandedAdvancedShotId === shot.shotId
              const shotDurationOptions = durationOptions(durationBounds, shot.durationSec)

              return (
                <article
                  key={shot.shotId || `shot-${idx}`}
                  className={`wf-shot-card${isSelected ? ' is-selected' : ''}`}
                  onClick={() => setSelectedShotId(shot.shotId)}
                >
                  {/* Shot Header */}
                  <div className="wf-shot-head">
                    <div className="wf-shot-head-left flex-1">
                      <span className="wf-shot-num">S{String(idx + 1).padStart(2, '0')}</span>
                      <input
                        className="wf-input wf-input-sm flex-1 min-w-[140px]"
                        value={shot.title}
                        readOnly={isTrialView}
                        placeholder="镜头标题"
                        onChange={(e) => updateShot(idx, { title: e.target.value })}
                      />
                    </div>

                    <div className="wf-shot-meta">
                      <select
                        className="wf-select wf-select-sm wf-num"
                        style={{ width: 72 }}
                        aria-label={`镜头 ${idx + 1} 时长`}
                        disabled={isTrialView}
                        value={shot.durationSec}
                        onChange={(e) => updateShot(idx, { durationSec: Number(e.target.value) || durationBounds.min })}
                      >
                        {shotDurationOptions.map((sec) => (
                          <option key={sec} value={sec}>{sec}s</option>
                        ))}
                      </select>

                      <input
                        className="wf-input wf-input-sm"
                        style={{ width: 84 }}
                        value={shot.shotType}
                        readOnly={isTrialView}
                        placeholder="景别"
                        title="景别（如：特写 / 中景 / 全景）"
                        onChange={(e) => updateShot(idx, { shotType: e.target.value })}
                      />

                      <input
                        className="wf-input wf-input-sm"
                        style={{ width: 102 }}
                        value={shot.cameraMovement}
                        readOnly={isTrialView}
                        placeholder="运镜"
                        title="运镜方式（如：缓推 / 手持跟拍 / 环绕）"
                        onChange={(e) => updateShot(idx, { cameraMovement: e.target.value })}
                      />

                      <select
                        className="wf-select wf-select-sm"
                        style={{ width: 92 }}
                        aria-label={`镜头 ${idx + 1} 模式`}
                        disabled={isTrialView}
                        value={shot.inputMode}
                        onChange={(e) => updateShot(idx, { inputMode: e.target.value as VideoInputMode })}
                      >
                        <option value="text">全能参考</option>
                        <option value="image">图生视频</option>
                        <option value="firstlastframe" disabled={!supportsFirstLastFrame}>
                          首尾帧{!supportsFirstLastFrame ? ' (不支持)' : ''}
                        </option>
                      </select>

                      {!isTrialView ? (
                        <div className="inline-flex items-center gap-0.5">
                          <button
                            type="button"
                            className="wf-btn wf-btn-ghost wf-btn-icon wf-btn-sm"
                            disabled={idx === 0}
                            title="上移镜头"
                            aria-label="上移镜头"
                            onClick={(e) => {
                              e.stopPropagation()
                              moveShot(idx, -1)
                            }}
                          >
                            <AppIcon name="chevronUp" className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            className="wf-btn wf-btn-ghost wf-btn-icon wf-btn-sm"
                            disabled={idx === draft.shots.length - 1}
                            title="下移镜头"
                            aria-label="下移镜头"
                            onClick={(e) => {
                              e.stopPropagation()
                              moveShot(idx, 1)
                            }}
                          >
                            <AppIcon name="chevronDown" className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ) : null}

                      {canManageSkills && onQuoteSnippet ? (
                        <button
                          type="button"
                          className="wf-btn wf-btn-ghost wf-btn-xs"
                          title="引用此镜头提示词到右侧 Skill 调优"
                          onClick={(e) => {
                            e.stopPropagation()
                            onQuoteSnippet({
                              label: `S4 镜头 S${String(idx + 1).padStart(2, '0')} · ${shot.title}`,
                              text: `S${String(idx + 1).padStart(2, '0')} (${shot.durationSec}s · ${shot.shotType} · ${shot.cameraMovement})\n视频提示词：${shot.videoPrompt}${shot.dialogue ? `\n台词：${shot.dialogue}` : ''}`,
                            })
                          }}
                        >
                          <AppIcon name="sparkles" className="h-3 w-3" />调优
                        </button>
                      ) : null}

                      {!isTrialView && draft.shots.length > 1 ? (
                        <button
                          type="button"
                          className="wf-btn wf-btn-ghost wf-btn-icon wf-btn-sm"
                          aria-label={`删除镜头 ${idx + 1}`}
                          onClick={(e) => {
                            e.stopPropagation()
                            void removeShot(idx)
                          }}
                        >
                          <AppIcon name="trash" className="h-3.5 w-3.5" />
                        </button>
                      ) : null}
                    </div>
                  </div>

                  {/* Visual Stage 3 Asset Chips (Toggleable Thumbnails) */}
                  {stage3Assets.length > 0 ? (
                    <div className="wf-shot-asset-chips" aria-label="绑定第 3 步视觉资产">
                      <span className="wf-param-label">挂载资产</span>
                      {stage3Assets.map((asset) => {
                        const isBound = isAssetChipBound(shot, asset)
                        const isReady = isAssetImageReady(asset)
                        const thumbUrl = toCanvasDisplayImageUrl(asset.imageUrl || asset.storageKey || null, 480)
                        return (
                          <button
                            key={asset.id}
                            type="button"
                            disabled={isTrialView}
                            className={`wf-shot-asset-chip${isBound ? ' is-bound' : ''}${!isReady ? ' is-unready' : ''}`}
                            title={
                              !isReady
                                ? `${isBound ? '已挂载' : '点击挂载'} @${asset.name}（尚未出图，生视频将缺少该资产参考图）`
                                : isBound
                                  ? `已挂载 @${asset.name}，点击取消并移除提示词中的 @引用`
                                  : `点击挂载 @${asset.name} 并插入提示词`
                            }
                            onClick={(e) => {
                              e.stopPropagation()
                              toggleAssetBinding(idx, asset)
                            }}
                          >
                            {thumbUrl ? (
                              <MediaImage
                                src={thumbUrl}
                                alt={asset.name}
                                className="wf-shot-asset-avatar"
                              />
                            ) : (
                              <span className="wf-shot-asset-avatar inline-flex items-center justify-center">
                                <AppIcon
                                  name={asset.kind === 'character' ? 'user' : asset.kind === 'location' ? 'image' : 'package'}
                                  className="h-3 w-3"
                                />
                              </span>
                            )}
                            <span>@{asset.name}</span>
                            {!isReady ? <span className="wf-shot-asset-unready-tag">未出图</span> : null}
                            {isBound ? <AppIcon name="check" className="h-3 w-3" /> : null}
                          </button>
                        )
                      })}
                    </div>
                  ) : null}

                  {/* MentionPromptEditor for Video Prompt with @ Asset Autocomplete */}
                  <div className="wf-field">
                    <label className="wf-label">视频生成提示词（支持输入 @ 自动补全第 3 步资产：角色 / 场景 / 道具）</label>
                    <div className="wf-shot-prompt-wrap">
                      <MentionPromptEditor
                        value={shot.videoPrompt}
                        assets={mentionAssets}
                        readOnly={isTrialView}
                        minHeight={104}
                        menuLabel="引用第 3 步资产"
                        placeholder="输入 @ 选择角色/场景/物品参考图，描述四层电影画面：主体动作 + 场景光影 + 镜头运镜 + 氛围质感…"
                        hint="输入 @ 可联想第 3 步资产中的全部角色、场景与道具参考图；提交生视频时将自动附带对应参考图与角色绑定音色。"
                        onChange={(nextVal) => handlePromptChange(idx, nextVal)}
                        onSelectAsset={(asset, nextValue) => handleMentionSelectAsset(idx, asset, nextValue)}
                      />
                    </div>
                  </div>

                  {/* Dialogue & Onscreen Text */}
                  <div className="wf-shot-dialogue-row">
                    <div className="wf-field">
                      <label className="wf-label">台词 / 旁白（开启声音时自动带入）</label>
                      <input
                        className="wf-input wf-input-sm"
                        value={shot.dialogue || ''}
                        readOnly={isTrialView}
                        placeholder="本镜头人物口型对白或旁白…"
                        onChange={(e) => updateShot(idx, { dialogue: e.target.value })}
                      />
                    </div>
                    <div className="wf-field">
                      <label className="wf-label">花字 / 画面字幕</label>
                      <input
                        className="wf-input wf-input-sm"
                        value={shot.onscreenText || ''}
                        readOnly={isTrialView}
                        placeholder="吸睛字幕或关键信息…"
                        onChange={(e) => updateShot(idx, { onscreenText: e.target.value })}
                      />
                    </div>
                  </div>

                  {/* Advanced Shot Fields Accordion */}
                  <div className="wf-accordion">
                    <button
                      type="button"
                      className="wf-accordion-trigger"
                      aria-expanded={isAdvOpen}
                      onClick={(e) => {
                        e.stopPropagation()
                        setExpandedAdvancedShotId((cur) => (cur === shot.shotId ? null : shot.shotId))
                      }}
                    >
                      <span>首帧补充描述与负向约束</span>
                      <AppIcon name={isAdvOpen ? 'chevronUp' : 'chevronDown'} className="h-3.5 w-3.5" />
                    </button>
                    {isAdvOpen ? (
                      <div className="wf-accordion-body">
                        <div className="wf-field">
                          <label className="wf-label">首帧静止画面描述（图生视频 / 首尾帧辅助）</label>
                          <textarea
                            className="wf-textarea"
                            rows={2}
                            value={shot.firstFramePrompt || ''}
                            readOnly={isTrialView}
                            onChange={(e) => updateShot(idx, { firstFramePrompt: e.target.value })}
                          />
                        </div>
                        <div className="wf-field">
                          <label className="wf-label">负向约束</label>
                          <input
                            className="wf-input wf-input-sm"
                            value={shot.negativeConstraints || ''}
                            readOnly={isTrialView}
                            onChange={(e) => updateShot(idx, { negativeConstraints: e.target.value })}
                          />
                        </div>
                      </div>
                    ) : null}
                  </div>
                </article>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
})
