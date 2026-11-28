'use client'

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AppIcon } from '@/components/ui/icons'
import { confirmAction } from '@/lib/ui/feedback'
import type {
  BatchItemDTO,
  BatchStageState,
  OriginalScriptArtifact,
  RewrittenScriptArtifact,
  RewrittenScriptScene,
  ScriptRewriteStageParams,
} from '@/lib/batch-workflow/types'
import { alignSceneToBeat, diffS2Scenes, trySave } from './_helpers'

export interface Stage2ScriptRewriteViewProps {
  item: BatchItemDTO
  originalArtifact: OriginalScriptArtifact | null
  artifact: RewrittenScriptArtifact | null
  isTrialView: boolean
  stageState: BatchStageState
  stageParams?: ScriptRewriteStageParams
  running: boolean
  elapsedSeconds?: number
  saving: boolean
  draftSyncNonce?: number
  canManageSkills: boolean
  onRunStage: (paramsOverride: ScriptRewriteStageParams, forceRerun?: boolean) => Promise<void>
  onSaveDraft: (edited: RewrittenScriptArtifact) => Promise<void>
  onApproveAndNext: (edited: RewrittenScriptArtifact) => Promise<void>
  onRegisterGetDraft?: (getter: (() => RewrittenScriptArtifact | null) | null) => void
  onDirtyChange?: (dirty: boolean) => void
  onQuoteSnippet?: (snippet: { label: string; text: string }) => void
  onSeedSkillFeedback?: (feedbackText: string) => void
  onJumpToStage1: () => void
  onNotify?: (msg: string, tone?: 'success' | 'error' | 'info') => void
  /** Optional flush hook supplied by parent (D). */
  onFlushBeforeRun?: () => Promise<void> | void
}

const REWRITE_INTENSITIES = [
  { value: 'light' as const, label: '轻度润色' },
  { value: 'medium' as const, label: '中度二创' },
  { value: 'heavy' as const, label: '深度重构' },
]

const TARGET_DURATIONS: Array<{ value: number | undefined; label: string }> = [
  { value: undefined, label: '跟随原片' },
  { value: 15, label: '15s' },
  { value: 30, label: '30s' },
  { value: 60, label: '60s' },
]

const TONE_OPTIONS = [
  { value: '', label: '保留原片' },
  { value: '强冲突剧情', label: '强冲突剧情' },
  { value: '第一人称口播', label: '第一人称口播' },
  { value: '悬疑旁白', label: '悬疑旁白' },
  { value: '爽感反转带货', label: '爽感反转带货' },
]

const STEER_CHIPS = [
  '前 3 秒钩子更炸裂，直接抛冲突',
  '台词更短更口语，去书面腔',
  '中段增加一次意外反转',
  '节奏提速，压缩过渡铺垫',
  '结尾动作与情绪落点更有记忆点',
]

function rebuildRewrittenFullText(artifact: RewrittenScriptArtifact): string {
  return artifact.scenes
    .map((sc) => {
      const lines = [`场景 ${sc.sceneIndex} · ${sc.location || '未命名场景'}（${sc.durationSec}s · ${sc.beat || '推进'}）`]
      if (sc.visualAction?.trim()) lines.push(`画面：${sc.visualAction.trim()}`)
      if (sc.dialogue?.trim()) lines.push(`对白：${sc.dialogue.trim()}`)
      if (sc.voiceover?.trim()) lines.push(`旁白：${sc.voiceover.trim()}`)
      if (sc.onscreenText?.trim()) lines.push(`花字：${sc.onscreenText.trim()}`)
      return lines.join('\n')
    })
    .join('\n\n')
    .trim()
}

export const Stage2ScriptRewriteView = memo(function Stage2ScriptRewriteView({
  item,
  originalArtifact,
  artifact,
  isTrialView,
  stageState,
  stageParams,
  running,
  elapsedSeconds = 0,
  saving,
  draftSyncNonce = 0,
  canManageSkills,
  onRunStage,
  onSaveDraft,
  onApproveAndNext,
  onRegisterGetDraft,
  onDirtyChange,
  onQuoteSnippet,
  onSeedSkillFeedback,
  onJumpToStage1,
  onNotify,
  onFlushBeforeRun,
}: Stage2ScriptRewriteViewProps) {
  const [draft, setDraft] = useState<RewrittenScriptArtifact | null>(artifact)
  const [dirty, setDirty] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [intensity, setIntensity] = useState<'light' | 'medium' | 'heavy'>(
    stageParams?.rewriteIntensity || 'medium',
  )
  const [targetDurationSec, setTargetDurationSec] = useState<number | undefined>(
    stageParams?.targetDurationSec,
  )
  const [tone, setTone] = useState<string>(stageParams?.tone || '')
  const [customInstruction, setCustomInstruction] = useState<string>(
    stageParams?.customInstruction || '',
  )
  const [refCollapsed, setRefCollapsed] = useState(false)
  const [showDiff, setShowDiff] = useState(true)
  const [arcExpanded, setArcExpanded] = useState(false)

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
    if (stageParams?.rewriteIntensity) setIntensity(stageParams.rewriteIntensity)
    if (stageParams?.targetDurationSec !== undefined) setTargetDurationSec(stageParams.targetDurationSec)
    if (stageParams?.tone !== undefined) setTone(stageParams.tone)
    if (stageParams?.customInstruction !== undefined) setCustomInstruction(stageParams.customInstruction)
  }, [
    stageParams?.rewriteIntensity,
    stageParams?.targetDurationSec,
    stageParams?.tone,
    stageParams?.customInstruction,
  ])

  const draftRef = useRef<RewrittenScriptArtifact | null>(draft)
  draftRef.current = draft
  const draftVersionRef = useRef(0)
  const commitDirtySuccess = useCallback((version: number) => {
    if (draftVersionRef.current === version) setDirty(false)
  }, [])
  useEffect(() => {
    if (!onRegisterGetDraft) return
    onRegisterGetDraft(() => {
      if (!draftRef.current) return null
      const estDur = draftRef.current.scenes.reduce((acc, sc) => acc + (Number(sc.durationSec) || 0), 0)
      return {
        ...draftRef.current,
        estimatedDurationSec: estDur || draftRef.current.estimatedDurationSec,
        fullScriptText: rebuildRewrittenFullText(draftRef.current) || draftRef.current.fullScriptText,
      }
    })
    return () => onRegisterGetDraft(null)
  }, [onRegisterGetDraft])

  const currentParams: ScriptRewriteStageParams = useMemo(() => ({
    rewriteIntensity: intensity,
    ...(targetDurationSec ? { targetDurationSec } : {}),
    ...(tone ? { tone } : {}),
    ...(customInstruction.trim() ? { customInstruction: customInstruction.trim() } : {}),
  }), [customInstruction, intensity, targetDurationSec, tone])

  const stats = useMemo(() => {
    if (!draft) return { durationSec: 0, charCount: 0 }
    const durationSec = draft.scenes.reduce((acc, sc) => acc + (Number(sc.durationSec) || 0), 0) || draft.estimatedDurationSec
    const charCount = draft.scenes.reduce(
      (acc, sc) => acc + (sc.visualAction?.length || 0) + (sc.dialogue?.length || 0) + (sc.voiceover?.length || 0),
      0,
    )
    return { durationSec, charCount }
  }, [draft])

  const toggleSteerChip = (chip: string) => {
    setCustomInstruction((prev) => {
      const trimmed = prev.trim()
      if (trimmed.includes(chip)) {
        return trimmed
          .split(/[；;\n]/)
          .map((s) => s.trim())
          .filter((s) => s && s !== chip)
          .join('；')
      }
      return trimmed ? `${trimmed}；${chip}` : chip
    })
  }

  const updateDraftField = <K extends keyof RewrittenScriptArtifact>(
    key: K,
    value: RewrittenScriptArtifact[K],
  ) => {
    if (isTrialView) return
    setDraft((prev) => (prev ? { ...prev, [key]: value } : prev))
    setDirty(true)
    draftVersionRef.current += 1
  }

  const updateConflictArc = (key: keyof RewrittenScriptArtifact['conflictArc'], value: string) => {
    if (isTrialView) return
    setDraft((prev) => (prev ? { ...prev, conflictArc: { ...prev.conflictArc, [key]: value } } : prev))
    setDirty(true)
    draftVersionRef.current += 1
  }

  const updateScene = (index: number, patch: Partial<RewrittenScriptScene>) => {
    if (isTrialView) return
    setDraft((prev) => {
      if (!prev) return prev
      const nextScenes = prev.scenes.map((sc, idx) => (idx === index ? { ...sc, ...patch } : sc))
      return { ...prev, scenes: nextScenes }
    })
    setDirty(true)
    draftVersionRef.current += 1
  }

  const addScene = () => {
    if (isTrialView) return
    setDraft((prev) => {
      if (!prev) return prev
      const nextScene: RewrittenScriptScene = {
        sceneIndex: prev.scenes.length + 1,
        location: '新场景',
        beat: '推进',
        visualAction: '',
        dialogue: '',
        onscreenText: '',
        highlightNote: '',
        durationSec: 5,
      }
      return { ...prev, scenes: [...prev.scenes, nextScene] }
    })
    setDirty(true)
    draftVersionRef.current += 1
  }

  const removeScene = async (index: number) => {
    if (isTrialView || !draft) return
    const ok = await confirmAction({
      title: '删除此洗稿场次？',
      message: `将移除「场景 ${index + 1} · ${draft.scenes[index]?.location || ''}」，保存后生效。`,
      confirmLabel: '确认删除',
      danger: true,
    })
    if (!ok) return
    setDraft((prev) => {
      if (!prev) return prev
      const nextScenes = prev.scenes
        .filter((_, idx) => idx !== index)
        .map((sc, idx) => ({ ...sc, sceneIndex: idx + 1 }))
      return { ...prev, scenes: nextScenes }
    })
    setDirty(true)
    draftVersionRef.current += 1
  }

  const buildPayload = useCallback((): RewrittenScriptArtifact | null => {
    const current = draftRef.current
    if (!current) return null
    const estDur = current.scenes.reduce((acc, sc) => acc + (Number(sc.durationSec) || 0), 0)
    return {
      ...current,
      estimatedDurationSec: estDur || current.estimatedDurationSec,
      fullScriptText: rebuildRewrittenFullText(current) || current.fullScriptText,
    }
  }, [])

  const handleSave = useCallback(async () => {
    const payload = buildPayload()
    if (!payload) return
    const version = draftVersionRef.current
    const res = await trySave(onSaveDraft, payload)
    if (res.ok) {
      commitDirtySuccess(version)
      setSaveError(null)
    } else {
      setSaveError(res.error)
      onNotify?.(res.error, 'error')
    }
  }, [buildPayload, commitDirtySuccess, onNotify, onSaveDraft])

  const handleApprove = useCallback(async () => {
    const payload = buildPayload()
    if (!payload) return
    const version = draftVersionRef.current
    const res = await trySave(onApproveAndNext, payload)
    if (res.ok) {
      commitDirtySuccess(version)
      setSaveError(null)
    } else {
      setSaveError(res.error)
      onNotify?.(res.error, 'error')
    }
  }, [buildPayload, commitDirtySuccess, onApproveAndNext, onNotify])

  const handleRerunRequest = useCallback(async () => {
    if (dirty) {
      const ok = await confirmAction({
        title: '先保存修改，再重新洗稿？',
        message: '当前洗稿有未保存修改。保存成功后才提交重新洗稿。',
        confirmLabel: '保存并重跑',
        cancelLabel: '取消',
      })
      if (!ok) return
    }
    try {
      const version = draftVersionRef.current
      if (onFlushBeforeRun) {
        await onFlushBeforeRun()
      } else if (dirty) {
        const payload = buildPayload()
        if (payload) {
          const res = await trySave(onSaveDraft, payload)
          if (!res.ok) { setSaveError(res.error); onNotify?.(res.error, 'error'); return }
          commitDirtySuccess(version)
        }
      }
      setSaveError(null)
      await onRunStage(currentParams, true)
    } catch (err) {
      const msg = err instanceof Error ? err.message : '执行失败，请重试'
      setSaveError(msg)
      onNotify?.(msg, 'error')
    }
  }, [buildPayload, commitDirtySuccess, currentParams, dirty, onFlushBeforeRun, onNotify, onRunStage, onSaveDraft])

  return (
    <div className="flex flex-col gap-3.5" data-stage="script_rewrite">
      {/* Compact Stage 2 Params Bar */}
      <div className="wf-stage-params-bar">
        <div className="flex flex-wrap items-center gap-3 flex-1 min-w-0">
          <div className="wf-param-group">
            <span className="wf-param-label">改写力度</span>
            <div className="wf-param-pills">
              {REWRITE_INTENSITIES.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  className={`wf-param-pill${intensity === opt.value ? ' is-active' : ''}`}
                  onClick={() => setIntensity(opt.value)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="wf-param-group">
            <span className="wf-param-label">目标时长</span>
            <div className="wf-param-pills">
              {TARGET_DURATIONS.map((opt) => (
                <button
                  key={String(opt.value ?? 'follow')}
                  type="button"
                  className={`wf-param-pill${targetDurationSec === opt.value ? ' is-active' : ''}`}
                  onClick={() => setTargetDurationSec(opt.value)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="wf-param-group">
            <span className="wf-param-label">口吻</span>
            <select
              className="wf-select wf-select-sm"
              style={{ width: 126 }}
              aria-label="洗稿口吻"
              value={tone}
              onChange={(e) => setTone(e.target.value)}
            >
              {TONE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          <div className="flex-1 min-w-[180px]">
            <input
              className="wf-input wf-input-sm"
              value={customInstruction}
              placeholder="一句补充指令（如：把冲突提到前 2 秒、结尾加悬念）…"
              onChange={(e) => setCustomInstruction(e.target.value)}
            />
          </div>
        </div>

        <button
          type="button"
          className="wf-btn wf-btn-stage wf-btn-sm shrink-0"
          disabled={running || !originalArtifact}
          onClick={() => void handleRerunRequest()}
        >
          {running ? <span className="wf-spinner" /> : <AppIcon name="sparkles" className="h-3.5 w-3.5" />}
          <span>{running ? `洗稿改写中…${elapsedSeconds > 0 ? ` ${elapsedSeconds}s` : ''}` : draft ? '重新洗稿' : '运行洗稿'}</span>
        </button>
      </div>

      {/* Quick-Steer Chips */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="wf-steer-chips">
          <span className="wf-param-label">快捷导演微调</span>
          {STEER_CHIPS.map((chip) => {
            const active = customInstruction.includes(chip)
            return (
              <button
                key={chip}
                type="button"
                className={`wf-steer-chip${active ? ' is-active' : ''}`}
                onClick={() => toggleSteerChip(chip)}
              >
                {active ? <AppIcon name="check" className="h-3 w-3" /> : <AppIcon name="plus" className="h-3 w-3" />}
                <span>{chip}</span>
              </button>
            )
          })}
        </div>
        {canManageSkills && onSeedSkillFeedback && customInstruction.trim() ? (
          <button
            type="button"
            className="wf-btn wf-btn-ghost wf-btn-xs shrink-0"
            onClick={() => onSeedSkillFeedback(customInstruction.trim())}
          >
            <AppIcon name="sparklesAlt" className="h-3.5 w-3.5" />沉淀为 Skill 调优意见
          </button>
        ) : null}
      </div>

      {stageState.error ? (
        <div className="wf-stale-banner">
          <div className="wf-stale-banner-main">
            <AppIcon name="alert" className="wf-stale-banner-icon h-4 w-4" />
            <span>洗稿执行失败：{stageState.error}</span>
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

      {/* Empty State */}
      {!draft ? (
        <div className="wf-card">
          <div className="wf-empty">
            <span className="wf-empty-icon">
              {running ? <span className="wf-spinner" /> : <AppIcon name="editSquare" className="h-5 w-5" />}
            </span>
            <div className="wf-empty-title">
              {running
                ? `正在结合当前洗稿 Skill 重构剧本…${elapsedSeconds > 0 ? `（已用 ${elapsedSeconds}s）` : ''}`
                : originalArtifact
                  ? '原剧本已就绪，点击开始洗稿改编'
                  : '请先完成「1. 剧本解析」或粘贴原剧本'}
            </div>
            <div className="wf-empty-desc">
              洗稿会保留原片可执行的镜头骨架，按选定的改写力度、口吻与赛道 Skill 重塑前 3 秒钩子、冲突张力与台词节奏。
            </div>
            <div className="wf-empty-actions">
              {originalArtifact ? (
                <button
                  type="button"
                  className="wf-btn wf-btn-primary"
                  disabled={running}
                  onClick={() => void handleRerunRequest()}
                >
                  <AppIcon name="sparkles" className="h-3.5 w-3.5" />开始剧本洗稿
                </button>
              ) : (
                <button type="button" className="wf-btn wf-btn-primary" onClick={onJumpToStage1}>
                  <AppIcon name="arrowRight" className="h-3.5 w-3.5" />前往剧本解析
                </button>
              )}
            </div>
          </div>
        </div>
      ) : (
        <>
          {/* Dual-Pane Action Strip */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="wf-btn wf-btn-subtle wf-btn-xs"
                onClick={() => setRefCollapsed((v) => !v)}
              >
                <AppIcon name={refCollapsed ? 'eye' : 'eyeOff'} className="h-3.5 w-3.5" />
                <span>{refCollapsed ? '展开原剧本对照' : '收起原剧本对照'}</span>
              </button>
              <button
                type="button"
                className={`wf-btn wf-btn-xs${showDiff ? ' wf-btn-stage' : ' wf-btn-subtle'}`}
                onClick={() => setShowDiff((v) => !v)}
              >
                <AppIcon name="sparkles" className="h-3.5 w-3.5" />
                <span>{showDiff ? '改写差异高亮：开' : '改写差异高亮：关'}</span>
              </button>
              <span className="wf-badge wf-num">
                {draft.scenes.length} 场 · 预估 {stats.durationSec}s · {stats.charCount} 字
              </span>
              {(() => {
                const d = diffS2Scenes(draft.scenes, originalArtifact?.beats || [])
                return (
                  <>
                    {d.unaligned > 0 ? <span className="wf-badge is-warning" title="缺少或无法匹配 sourceBeatId">未对齐 {d.unaligned}</span> : null}
                    {d.added > 0 ? <span className="wf-badge is-info">新增 {d.added}</span> : null}
                    {d.removed > 0 ? <span className="wf-badge is-muted">原拍未使用 {d.removed}</span> : null}
                  </>
                )
              })()}
              {dirty && !isTrialView ? <span className="wf-badge is-warning">有未保存修改</span> : null}
            </div>

            {!isTrialView ? (
              <div className="flex items-center gap-2">
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
                  <span>确认并进入解析资产</span>
                  <span className="wf-mono text-[10px] opacity-80">⌘↵</span>
                </button>
              </div>
            ) : null}
          </div>

          {/* Aligned Dual-Pane Split */}
          <div className={`wf-s2-split${refCollapsed ? ' is-ref-collapsed' : ''}`}>
            {/* Left Reference: Original Script */}
            {!refCollapsed ? (
              <section className="wf-s2-pane is-original" aria-label="原剧本参考">
                <div className="wf-s2-pane-head">
                  <div className="wf-s2-pane-title">
                    <AppIcon name="fileText" className="h-3.5 w-3.5" />
                    <span>原剧本对照 · {originalArtifact?.title || 'S1 原剧本'}</span>
                  </div>
                  <span className="wf-badge is-muted wf-num">
                    {originalArtifact?.beats.length || 0} 拍 · {originalArtifact?.estimatedDurationSec || 0}s
                  </span>
                </div>
                <div className="wf-s2-pane-body">
                  {originalArtifact?.hookAnalysis ? (
                    <div className="wf-s2-beat-item">
                      <span className="wf-param-label">原片钩子分析</span>
                      <p className="wf-beat-text text-[12px]">{originalArtifact.hookAnalysis}</p>
                    </div>
                  ) : null}
                  {originalArtifact && originalArtifact.beats.length > 0 ? (
                    originalArtifact.beats.map((beat, idx) => (
                      <div key={`orig-${beat.beatIndex}-${idx}`} className="wf-s2-beat-item">
                        <div className="flex items-center justify-between gap-2">
                          <span className="wf-beat-index">原拍 #{String(idx + 1).padStart(2, '0')} · {beat.sceneHeading}</span>
                          {beat.timecode ? <span className="wf-badge is-muted wf-num">{beat.timecode}</span> : null}
                        </div>
                        {beat.visualAction ? (
                          <div className="wf-beat-text text-[12px]">
                            <span className="wf-param-label mr-1.5">画面</span>
                            {beat.visualAction}
                          </div>
                        ) : null}
                        {beat.dialogue ? (
                          <div className="wf-beat-text text-[12px]">
                            <span className="wf-param-label mr-1.5">对白</span>
                            {beat.dialogue}
                          </div>
                        ) : null}
                      </div>
                    ))
                  ) : (
                    <div className="wf-empty" style={{ padding: '28px 16px' }}>
                      <div className="wf-empty-desc">暂无原剧本节拍对照。</div>
                    </div>
                  )}
                </div>
              </section>
            ) : null}

            {/* Right Editor: Rewritten Script */}
            <section
              className={`wf-s2-pane is-rewritten${isTrialView ? ' is-trial' : ''}`}
              aria-label="洗稿剧本编辑"
            >
              <div className="wf-s2-pane-head">
                <div className="wf-s2-pane-title">
                  <AppIcon name="sparkles" className="h-3.5 w-3.5" />
                  <span>{isTrialView ? '试跑洗稿产出（只读预览）' : '洗稿剧本（可逐场微调）'}</span>
                </div>
                {draft.styleTag ? <span className="wf-badge is-stage">{draft.styleTag}</span> : null}
              </div>

              <div className="wf-s2-pane-body">
                {/* Title + Hook Line + Rewrite Highlights */}
                <div className="wf-s2-beat-item">
                  <div className="wf-field-row">
                    <div className="wf-field">
                      <label className="wf-label">新剧标题</label>
                      <input
                        className="wf-input wf-input-sm"
                        value={draft.title}
                        readOnly={isTrialView}
                        onChange={(e) => updateDraftField('title', e.target.value)}
                      />
                    </div>
                    <div className="wf-field">
                      <label className="wf-label">前 3 秒爆款抓手</label>
                      <input
                        className="wf-input wf-input-sm"
                        value={draft.hookLine3s}
                        readOnly={isTrialView}
                        onChange={(e) => updateDraftField('hookLine3s', e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="wf-field">
                    <label className="wf-label">改编策略摘要</label>
                    <textarea
                      className="wf-textarea"
                      rows={2}
                      value={draft.rewriteSummary}
                      readOnly={isTrialView}
                      onChange={(e) => updateDraftField('rewriteSummary', e.target.value)}
                    />
                  </div>
                  {showDiff && Array.isArray(draft.changeHighlights) && draft.changeHighlights.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {draft.changeHighlights.map((hl, idx) => (
                        <span key={`${hl}-${idx}`} className="wf-s2-diff-chip is-changed">
                          ✦ {hl}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>

                {/* Collapsible 5-Part Conflict Arc */}
                <div className="wf-accordion">
                  <button
                    type="button"
                    className="wf-accordion-trigger"
                    aria-expanded={arcExpanded}
                    onClick={() => setArcExpanded((v) => !v)}
                  >
                    <span className="inline-flex items-center gap-1.5">
                      <AppIcon name="bolt" className="h-3.5 w-3.5" />
                      <span>五段式冲突弧线（钩子 → 升级 → 反转 → 高潮 → 收尾）</span>
                    </span>
                    <AppIcon name={arcExpanded ? 'chevronUp' : 'chevronDown'} className="h-3.5 w-3.5" />
                  </button>
                  {arcExpanded ? (
                    <div className="wf-accordion-body">
                      {([
                        { key: 'hook', label: '1. 开场钩子' },
                        { key: 'escalation', label: '2. 冲突升级' },
                        { key: 'twistOrReveal', label: '3. 核心反转 / 揭秘' },
                        { key: 'climaxOrDemo', label: '4. 高潮 / 演示' },
                        { key: 'ctaOrEnding', label: '5. 收尾 / 行动号召' },
                      ] as const).map((arc) => (
                        <div key={arc.key} className="wf-field">
                          <label className="wf-label">{arc.label}</label>
                          <input
                            className="wf-input wf-input-sm"
                            value={draft.conflictArc?.[arc.key] || ''}
                            readOnly={isTrialView}
                            onChange={(e) => updateConflictArc(arc.key, e.target.value)}
                          />
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>

                {/* Editable Rewritten Scenes */}
                {draft.scenes.map((scene, idx) => {
                  const alignment = alignSceneToBeat(scene, originalArtifact?.beats || [])
                  const origBeat = alignment.origBeat
                  const isAdded = Boolean(scene.sourceBeatId?.trim()) && !origBeat
                  const isUnaligned = !alignment.aligned
                  const dialogueChanged = Boolean(
                    origBeat && origBeat.dialogue?.trim() !== scene.dialogue?.trim(),
                  )
                  return (
                    <article key={`sc-${scene.sceneIndex}-${idx}`} className="wf-s2-beat-item">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2 flex-1 min-w-0">
                          <span className="wf-beat-index">场景 #{String(idx + 1).padStart(2, '0')}</span>
                          {isUnaligned ? (
                            <span className="wf-s2-diff-chip is-unaligned" title="该场景缺少 sourceBeatId，无法与原拍对齐">未对齐</span>
                          ) : null}
                          {isAdded ? (
                            <span className="wf-s2-diff-chip is-added">+ 新增场次</span>
                          ) : null}
                          {origBeat ? (
                            <span className="wf-s2-diff-chip is-aligned" title={`对齐原拍 #${origBeat.beatIndex}`}>对齐原拍 #{origBeat.beatIndex}</span>
                          ) : null}
                          <input
                            className="wf-input wf-input-sm"
                            style={{ width: 150 }}
                            value={scene.location}
                            readOnly={isTrialView}
                            placeholder="场景地点"
                            onChange={(e) => updateScene(idx, { location: e.target.value })}
                          />
                          <input
                            className="wf-input wf-input-sm"
                            style={{ width: 96 }}
                            value={scene.beat}
                            readOnly={isTrialView}
                            placeholder="节拍功能"
                            onChange={(e) => updateScene(idx, { beat: e.target.value })}
                          />
                          <div className="inline-flex items-center gap-1">
                            <input
                              type="number"
                              min={2}
                              max={60}
                              className="wf-input wf-input-sm wf-num"
                              style={{ width: 58 }}
                              value={scene.durationSec}
                              readOnly={isTrialView}
                              onChange={(e) => updateScene(idx, { durationSec: Math.max(2, Number(e.target.value) || 5) })}
                            />
                            <span className="text-[11px] text-[var(--fos-text-4)]">秒</span>
                          </div>
                          {showDiff && dialogueChanged && !isUnaligned ? (
                            <span className="wf-s2-diff-chip is-changed">已改写</span>
                          ) : null}
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          {canManageSkills && onQuoteSnippet ? (
                            <button
                              type="button"
                              className="wf-btn wf-btn-ghost wf-btn-xs"
                              title="引用本场到右侧 Skill 调优"
                              onClick={() => onQuoteSnippet({
                                label: `S2 场景 #${String(idx + 1).padStart(2, '0')} · ${scene.location}`,
                                text: `场景 ${idx + 1} (${scene.location} / ${scene.durationSec}s)\n画面：${scene.visualAction}\n对白：${scene.dialogue}${scene.onscreenText ? `\n花字：${scene.onscreenText}` : ''}`,
                              })}
                            >
                              <AppIcon name="sparkles" className="h-3 w-3" />引用调优
                            </button>
                          ) : null}
                          {!isTrialView && draft.scenes.length > 1 ? (
                            <button
                              type="button"
                              className="wf-btn wf-btn-ghost wf-btn-icon wf-btn-sm"
                              aria-label={`删除场景 ${idx + 1}`}
                              onClick={() => void removeScene(idx)}
                            >
                              <AppIcon name="trash" className="h-3.5 w-3.5" />
                            </button>
                          ) : null}
                        </div>
                      </div>

                      {showDiff && origBeat && origBeat.dialogue?.trim() && dialogueChanged ? (
                        <div className="text-[11.5px] leading-relaxed">
                          <span className="wf-s2-diff-mark-del mr-1.5">{origBeat.dialogue.slice(0, 72)}{origBeat.dialogue.length > 72 ? '…' : ''}</span>
                          <span className="wf-s2-diff-mark-add">{scene.dialogue.slice(0, 72)}{scene.dialogue.length > 72 ? '…' : ''}</span>
                        </div>
                      ) : null}

                      <div className="wf-beat-grid">
                        <div className="wf-field">
                          <label className="wf-label">画面演出</label>
                          <textarea
                            className="wf-textarea"
                            rows={3}
                            value={scene.visualAction}
                            readOnly={isTrialView}
                            onChange={(e) => updateScene(idx, { visualAction: e.target.value })}
                          />
                        </div>
                        <div className="wf-field">
                          <label className="wf-label">对白 / 旁白</label>
                          <textarea
                            className="wf-textarea"
                            rows={3}
                            value={scene.dialogue}
                            readOnly={isTrialView}
                            onChange={(e) => updateScene(idx, { dialogue: e.target.value })}
                          />
                        </div>
                      </div>

                      <div className="wf-field-row">
                        <div className="wf-field">
                          <label className="wf-label">屏幕花字 / 字幕</label>
                          <input
                            className="wf-input wf-input-sm"
                            value={scene.onscreenText || ''}
                            readOnly={isTrialView}
                            placeholder="吸睛大字或关键信息提示…"
                            onChange={(e) => updateScene(idx, { onscreenText: e.target.value })}
                          />
                        </div>
                        <div className="wf-field">
                          <label className="wf-label">改编亮点备注</label>
                          <input
                            className="wf-input wf-input-sm"
                            value={scene.highlightNote || ''}
                            readOnly={isTrialView}
                            placeholder="本场对比原片强化的爽点或卖点…"
                            onChange={(e) => updateScene(idx, { highlightNote: e.target.value })}
                          />
                        </div>
                      </div>
                    </article>
                  )
                })}

                {!isTrialView ? (
                  <div className="flex justify-start pt-1">
                    <button type="button" className="wf-btn wf-btn-subtle wf-btn-sm" onClick={addScene}>
                      <AppIcon name="plus" className="h-3.5 w-3.5" />新增场次
                    </button>
                  </div>
                ) : null}
              </div>
            </section>
          </div>
        </>
      )}
    </div>
  )
})
