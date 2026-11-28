'use client'

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AppIcon } from '@/components/ui/icons'
import { MaterialPickerDialog } from '@/components/frameos/materials/MaterialPickerDialog'
import type { FrameosMaterialItem } from '@/components/frameos/materials/contracts'
import { apiFetch } from '@/lib/api-fetch'
import { readApiErrorMessage } from '@/lib/api/read-error-message'
import { confirmAction } from '@/lib/ui/feedback'
import { toPlayableVideoUrl } from '@/lib/media/image-url'
import type {
  BatchItemDTO,
  BatchRunMode,
  BatchStageState,
  OriginalScriptArtifact,
  OriginalScriptBeat,
  ScriptAnalysisStageParams,
} from '@/lib/batch-workflow/types'
import { buildStage1Payload, trySave } from './_helpers'

export interface Stage1ScriptAnalysisViewProps {
  projectId?: string
  item: BatchItemDTO
  artifact: OriginalScriptArtifact | null
  isTrialView: boolean
  stageState: BatchStageState
  stageParams?: ScriptAnalysisStageParams
  runMode?: BatchRunMode
  running: boolean
  elapsedSeconds?: number
  saving: boolean
  draftSyncNonce?: number
  canManageSkills: boolean
  onRunStage: (opts?: {
    pastedScript?: string
    sourceVideoMaterialId?: string
    sourceVideoStorageKey?: string | null
    sourceVideoUrl?: string | null
    sourceVideoFileName?: string | null
    stageParamsOverride?: ScriptAnalysisStageParams
    forceRerun?: boolean
    jumpAfterRun?: 'script_rewrite' | 'asset_extraction'
  }) => Promise<void>
  onSaveDraft: (edited: OriginalScriptArtifact) => Promise<void>
  onApproveAndNext: (edited: OriginalScriptArtifact) => Promise<void>
  onRegisterGetDraft?: (getter: (() => OriginalScriptArtifact | null) | null) => void
  onDirtyChange?: (dirty: boolean) => void
  onQuoteSnippet?: (snippet: { label: string; text: string }) => void
  onNotify: (msg: string, tone?: 'success' | 'error' | 'info') => void
  /** Optional flush-before-rerun hook supplied by parent (D). */
  onFlushBeforeRun?: () => Promise<void> | void
}

function formatSec(sec: number | null | undefined): string {
  if (typeof sec !== 'number' || !Number.isFinite(sec) || sec < 0) return '00:00'
  const total = Math.floor(sec)
  const mins = Math.floor(total / 60)
  const secs = total % 60
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
}

function formatBeatTimecode(beat: OriginalScriptBeat): string {
  if (beat.timecode && beat.timecode.trim()) return beat.timecode.trim()
  if (typeof beat.startSec === 'number' && typeof beat.endSec === 'number') {
    return `${formatSec(beat.startSec)}–${formatSec(beat.endSec)}`
  }
  if (typeof beat.startSec === 'number') return formatSec(beat.startSec)
  return `节拍 ${String(beat.beatIndex).padStart(2, '0')}`
}

export const Stage1ScriptAnalysisView = memo(function Stage1ScriptAnalysisView({
  projectId,
  item,
  artifact,
  isTrialView,
  stageState,
  stageParams,
  runMode = 'gated',
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
  onNotify,
  onFlushBeforeRun,
}: Stage1ScriptAnalysisViewProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)

  const [draft, setDraft] = useState<OriginalScriptArtifact | null>(artifact)
  const [dirty, setDirty] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [showVideoPicker, setShowVideoPicker] = useState(false)
  const [pastedScript, setPastedScript] = useState(item.inputPayload.pastedScript || '')
  const [samplingPreset, setSamplingPreset] = useState<'standard' | 'detailed' | 'fast'>(
    stageParams?.samplingPreset || 'standard',
  )
  const [detectSceneCuts, setDetectSceneCuts] = useState<boolean>(
    stageParams?.detectSceneCuts ?? true,
  )
  const [currentTime, setCurrentTime] = useState(0)
  const [isPortraitVideo, setIsPortraitVideo] = useState(item.inputPayload.aspectRatio === '9:16')
  const [showRepasteBox, setShowRepasteBox] = useState(false)

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

  const prevPastedItemIdRef = useRef(item.id)
  useEffect(() => {
    if (prevPastedItemIdRef.current !== item.id) {
      prevPastedItemIdRef.current = item.id
      setPastedScript(item.inputPayload.pastedScript || '')
    }
  }, [item.id, item.inputPayload.pastedScript])

  useEffect(() => {
    if (stageParams?.samplingPreset) setSamplingPreset(stageParams.samplingPreset)
    if (typeof stageParams?.detectSceneCuts === 'boolean') setDetectSceneCuts(stageParams.detectSceneCuts)
  }, [stageParams?.samplingPreset, stageParams?.detectSceneCuts])

  const draftRef = useRef<OriginalScriptArtifact | null>(draft)
  draftRef.current = draft
  const draftVersionRef = useRef(0)
  const commitDirtySuccess = useCallback((version: number) => {
    if (draftVersionRef.current === version) setDirty(false)
  }, [])
  useEffect(() => {
    if (!onRegisterGetDraft) return
    onRegisterGetDraft(() => {
      if (!draftRef.current) return null
      return buildStage1Payload(draftRef.current, artifact)
    })
    return () => onRegisterGetDraft(null)
  }, [onRegisterGetDraft, artifact])

  const playableVideoUrl = useMemo(() => {
    if (item.inputPayload.skipVideoAnalysis || item.inputPayload.sourceType === 'pasted_script') {
      return null
    }
    const raw = item.inputPayload.sourceVideoUrl || item.inputPayload.sourceVideoStorageKey || null
    return toPlayableVideoUrl(raw)
  }, [
    item.inputPayload.skipVideoAnalysis,
    item.inputPayload.sourceType,
    item.inputPayload.sourceVideoUrl,
    item.inputPayload.sourceVideoStorageKey,
  ])

  const activeBeatIndex = useMemo(() => {
    if (!draft || !playableVideoUrl) return -1
    return draft.beats.findIndex((beat) => {
      if (typeof beat.startSec !== 'number') return false
      const end = typeof beat.endSec === 'number' && beat.endSec > beat.startSec ? beat.endSec : beat.startSec + 4
      return currentTime >= beat.startSec && currentTime < end
    })
  }, [currentTime, draft, playableVideoUrl])

  const seekToSecond = useCallback((sec: number | null | undefined) => {
    const video = videoRef.current
    if (!video || typeof sec !== 'number' || !Number.isFinite(sec)) return
    video.currentTime = Math.max(0, sec)
    void video.play().catch(() => {
      // Autoplay can be restricted until user interacts; seek still succeeds.
    })
  }, [])

  const uploadLocalVideo = useCallback(async (file: File) => {
    if (!file.type.startsWith('video/') && !/\.(mp4|mov|webm|avi|mkv)$/i.test(file.name)) {
      onNotify('请选择 MP4 / MOV / WEBM / AVI 视频文件。', 'error')
      return
    }
    setUploading(true)
    try {
      const form = new FormData()
      form.set('file', file)
      const baseTitle = file.name.replace(/\.[^.]+$/, '').trim() || '参考视频'
      form.set('title', baseTitle)
      form.set('projectId', projectId || 'personal')
      const response = await apiFetch('/api/frameos/materials', {
        method: 'POST',
        body: form,
      })
      if (!response.ok) {
        throw new Error(await readApiErrorMessage(response, '上传视频素材失败'))
      }
      const payload = await response.json() as { material?: FrameosMaterialItem }
      const mat = payload.material
      if (!mat) throw new Error('上传成功但未返回视频素材信息。')
      onNotify(`视频「${mat.title || file.name}」已上传，正在调用视频理解解析剧本…`, 'info')
      await onRunStage({
        sourceVideoMaterialId: mat.id,
        sourceVideoStorageKey: mat.storageKey || null,
        sourceVideoUrl: mat.url || mat.resultUrl || null,
        sourceVideoFileName: mat.title || file.name,
        stageParamsOverride: { samplingPreset, detectSceneCuts },
        forceRerun: true,
      })
    } catch (err) {
      onNotify(err instanceof Error ? err.message : '上传视频失败', 'error')
    } finally {
      setUploading(false)
    }
  }, [detectSceneCuts, onNotify, onRunStage, projectId, samplingPreset])

  const handleSelectLibraryVideo = useCallback(async (material: FrameosMaterialItem) => {
    setShowVideoPicker(false)
    onNotify(`已选用视频「${material.title || '未命名视频'}」，开始剧本解析…`, 'info')
    try {
      await onRunStage({
        sourceVideoMaterialId: material.id,
        sourceVideoStorageKey: material.storageKey || null,
        sourceVideoUrl: material.url || material.resultUrl || null,
        sourceVideoFileName: material.title || '资产库视频',
        stageParamsOverride: { samplingPreset, detectSceneCuts },
        forceRerun: true,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : '视频剧本解析失败'
      setSaveError(msg)
      onNotify(msg, 'error')
    }
  }, [detectSceneCuts, onNotify, onRunStage, samplingPreset])

  const handleImportPastedScript = useCallback(async (target: 'script_rewrite' | 'asset_extraction') => {
    const trimmed = pastedScript.trim()
    if (!trimmed) {
      onNotify('请先粘贴或输入剧本内容。', 'error')
      return
    }
    try {
      await onRunStage({
        pastedScript: trimmed,
        stageParamsOverride: { targetStage: target },
        forceRerun: true,
        jumpAfterRun: target,
      })
      setShowRepasteBox(false)
    } catch (err) {
      const msg = err instanceof Error ? err.message : '剧本解析失败'
      setSaveError(msg)
      onNotify(msg, 'error')
    }
  }, [onNotify, onRunStage, pastedScript])

  const updateDraftField = <K extends keyof OriginalScriptArtifact>(
    key: K,
    value: OriginalScriptArtifact[K],
  ) => {
    if (isTrialView) return
    setDraft((prev) => (prev ? { ...prev, [key]: value } : prev))
    draftVersionRef.current += 1
    setDirty(true)
  }

  const updateBeat = (index: number, patch: Partial<OriginalScriptBeat>) => {
    if (isTrialView) return
    setDraft((prev) => {
      if (!prev) return prev
      const nextBeats = prev.beats.map((b, idx) => (idx === index ? { ...b, ...patch } : b))
      return { ...prev, beats: nextBeats }
    })
    draftVersionRef.current += 1
    setDirty(true)
  }

  const addBeat = () => {
    if (isTrialView) return
    setDraft((prev) => {
      if (!prev) return prev
      const last = prev.beats[prev.beats.length - 1]
      const startSec = typeof last?.endSec === 'number' ? last.endSec : 0
      const nextBeat: OriginalScriptBeat = {
        beatIndex: prev.beats.length + 1,
        startSec,
        endSec: startSec + 5,
        timecode: `${formatSec(startSec)}–${formatSec(startSec + 5)}`,
        sceneHeading: `新增段落 ${prev.beats.length + 1}`,
        visualAction: '',
        dialogue: '',
        sfxOrMusic: '',
        hookNote: '',
      }
      return { ...prev, beats: [...prev.beats, nextBeat] }
    })
    draftVersionRef.current += 1
    setDirty(true)
  }

  const removeBeat = async (index: number) => {
    if (isTrialView || !draft) return
    const ok = await confirmAction({
      title: '删除此节拍？',
      message: `将移除「#${String(index + 1).padStart(2, '0')} ${draft.beats[index]?.sceneHeading || ''}」，保存后生效。`,
      confirmLabel: '确认删除',
      danger: true,
    })
    if (!ok) return
    setDraft((prev) => {
      if (!prev) return prev
      const nextBeats = prev.beats
        .filter((_, idx) => idx !== index)
        .map((b, idx) => ({ ...b, beatIndex: idx + 1 }))
      return { ...prev, beats: nextBeats }
    })
    draftVersionRef.current += 1
    setDirty(true)
  }

  const buildPayloadForSave = useCallback((): OriginalScriptArtifact | null => {
    const current = draftRef.current
    return current ? buildStage1Payload(current, artifact) : null
  }, [artifact])

  const handleSave = useCallback(async () => {
    const payload = buildPayloadForSave()
    if (!payload) return
    const version = draftVersionRef.current
    const res = await trySave(onSaveDraft, payload)
    if (res.ok) {
      commitDirtySuccess(version)
      setSaveError(null)
    } else {
      setSaveError(res.error)
      onNotify(res.error, 'error')
    }
  }, [buildPayloadForSave, commitDirtySuccess, onNotify, onSaveDraft])

  const handleApprove = useCallback(async () => {
    const payload = buildPayloadForSave()
    if (!payload) return
    const version = draftVersionRef.current
    const res = await trySave(onApproveAndNext, payload)
    if (res.ok) {
      commitDirtySuccess(version)
      setSaveError(null)
    } else {
      setSaveError(res.error)
      onNotify(res.error, 'error')
    }
  }, [buildPayloadForSave, commitDirtySuccess, onApproveAndNext, onNotify])

  const handleRerunRequest = useCallback(async (opts?: Parameters<typeof onRunStage>[0]) => {
    if (dirty) {
      const ok = await confirmAction({
        title: '先保存修改，再重新解析？',
        message: '当前剧本有未保存修改。确认后将先保存，保存成功才提交重新解析。',
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
        const payload = buildPayloadForSave()
        if (payload) {
          const res = await trySave(onSaveDraft, payload)
          if (!res.ok) { setSaveError(res.error); onNotify(res.error, 'error'); return }
          commitDirtySuccess(version)
        }
      }
      setSaveError(null)
      await onRunStage(opts)
    } catch (err) {
      const msg = err instanceof Error ? err.message : '执行失败，请重试'
      setSaveError(msg)
      onNotify(msg, 'error')
    }
  }, [buildPayloadForSave, commitDirtySuccess, dirty, onFlushBeforeRun, onNotify, onRunStage, onSaveDraft])

  const hiddenFileInput = (
    <input
      ref={fileInputRef}
      type="file"
      accept="video/mp4,video/quicktime,video/webm,video/x-msvideo,.mp4,.mov,.webm,.avi"
      hidden
      onChange={(event) => {
        const file = event.target.files?.[0]
        event.target.value = ''
        if (file) void uploadLocalVideo(file)
      }}
    />
  )

  const renderPhaseProgressStrip = () => {
    if (!uploading && !running) return null
    const isVideoMode = Boolean(uploading || playableVideoUrl)
    const phaseIndex = uploading ? 0 : elapsedSeconds < 12 ? 1 : 2
    const phases = isVideoMode
      ? ['上传视频', '抽帧切镜', '生成结构化剧拍']
      : ['读取剧本文本', '拆解结构化剧拍']
    return (
      <div className="wf-run-progress-strip" role="status" aria-live="polite">
        <div className="wf-run-progress-left">
          <span className="wf-spinner" />
          <div className="wf-run-phase-steps">
            {phases.map((label, idx) => {
              const stepIdx = isVideoMode ? idx : idx + 1
              const isDone = isVideoMode ? idx < phaseIndex : idx === 0 && elapsedSeconds >= 3
              const isActive = isVideoMode ? idx === phaseIndex : !isDone && (idx === 0 || elapsedSeconds >= 3)
              return (
                <span key={label} className="wf-run-phase-item">
                  <span
                    className={`wf-run-phase-pill${isActive ? ' is-active' : ''}${isDone ? ' is-done' : ''}`}
                  >
                    {isDone ? '✓ ' : `${stepIdx > 0 ? idx + 1 : 1}. `}{label}
                  </span>
                  {idx < phases.length - 1 ? <span className="wf-run-phase-arrow">→</span> : null}
                </span>
              )
            })}
          </div>
        </div>
        <span className="wf-badge is-stage wf-num shrink-0">
          {uploading ? '上传中…' : `已用 ${elapsedSeconds}s`}
        </span>
      </div>
    )
  }

  // Empty / Unparsed State
  if (!draft) {
    return (
      <div className="wf-s1-empty-hero" data-stage="script_analysis">
        {hiddenFileInput}
        {renderPhaseProgressStrip()}
        {saveError ? <div className="wf-stale-banner wf-save-error" role="alert">{saveError}（可重试）</div> : null}

        {playableVideoUrl ? (
          <div className="wf-card">
            <div className="wf-card-head">
              <div className="wf-card-title">
                <AppIcon name="video" className="h-4 w-4" />
                <span>已关联参考视频 · {item.inputPayload.sourceVideoFileName || item.title}</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="wf-btn wf-btn-ghost wf-btn-xs"
                  disabled={uploading || running}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <AppIcon name="upload" className="h-3.5 w-3.5" />替换本地视频
                </button>
                <button
                  type="button"
                  className="wf-btn wf-btn-ghost wf-btn-xs"
                  disabled={uploading || running}
                  onClick={() => setShowVideoPicker(true)}
                >
                  <AppIcon name="folderOpen" className="h-3.5 w-3.5" />从资产库重选
                </button>
              </div>
            </div>
            <div className="wf-s1-player-wrap nori-force-dark" style={{ borderRadius: 0, border: 0 }}>
              <video
                src={playableVideoUrl}
                className={`wf-s1-video${isPortraitVideo ? ' is-portrait' : ''}`}
                controls
                playsInline
                preload="metadata"
                onLoadedMetadata={(e) => {
                  const el = e.currentTarget
                  if (el.videoWidth && el.videoHeight) {
                    setIsPortraitVideo(el.videoHeight > el.videoWidth)
                  }
                }}
              />
            </div>
            <div className="wf-card-foot">
              <div className="wf-param-group">
                <span className="wf-param-label">采样粒度</span>
                <div className="wf-param-pills">
                  {([
                    { value: 'fast', label: '快速' },
                    { value: 'standard', label: '标准' },
                    { value: 'detailed', label: '精细切镜' },
                  ] as const).map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      className={`wf-param-pill${samplingPreset === opt.value ? ' is-active' : ''}`}
                      onClick={() => setSamplingPreset(opt.value)}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                <label className="inline-flex items-center gap-1.5 text-[11.5px] text-[var(--fos-text-2)] cursor-pointer">
                  <input
                    type="checkbox"
                    role="switch"
                    className="wf-switch"
                    checked={detectSceneCuts}
                    onChange={(e) => setDetectSceneCuts(e.target.checked)}
                  />
                  <span>自动标记剪辑点</span>
                </label>
              </div>
              <button
                type="button"
                className="wf-btn wf-btn-primary"
                disabled={running || uploading}
                onClick={() => {
                  void handleRerunRequest({ stageParamsOverride: { samplingPreset, detectSceneCuts }, forceRerun: true })
                }}
              >
                {running ? <span className="wf-spinner" /> : <AppIcon name="sparkles" className="h-3.5 w-3.5" />}
                <span>
                  {running
                    ? `正在解析视频剧本…${elapsedSeconds > 0 ? ` (${elapsedSeconds}s)` : ''}`
                    : runMode === 'auto'
                      ? '开始解析视频剧本（全流程）'
                      : '开始解析视频剧本'}
                </span>
              </button>
            </div>
          </div>
        ) : (
          <div
            className={`wf-s1-dropzone${dragOver ? ' is-dragover' : ''}`}
            onDragOver={(event) => {
              event.preventDefault()
              setDragOver(true)
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(event) => {
              event.preventDefault()
              setDragOver(false)
              const file = event.dataTransfer.files?.[0]
              if (file) void uploadLocalVideo(file)
            }}
          >
            <span className="wf-s1-dropzone-icon">
              {uploading || running ? (
                <span className="wf-spinner" />
              ) : (
                <AppIcon name="cloudUpload" className="h-6 w-6" />
              )}
            </span>
            <div className="wf-s1-dropzone-title">
              {uploading
                ? '正在上传视频至资产库…'
                : running
                  ? '正在调用视频理解拆解剧本与分拍…'
                  : '拖入参考视频，或选择资产库视频开始解析'}
            </div>
            <div className="wf-s1-dropzone-sub">
              支持 MP4 / MOV / WEBM / AVI · 自动提取时间码节拍、镜头动作、对白与前 3 秒钩子
            </div>

            <div className="wf-param-group" style={{ marginTop: 4 }}>
              <span className="wf-param-label">解析精度</span>
              <div className="wf-param-pills">
                {([
                  { value: 'fast', label: '快速' },
                  { value: 'standard', label: '标准' },
                  { value: 'detailed', label: '精细切镜' },
                ] as const).map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    className={`wf-param-pill${samplingPreset === opt.value ? ' is-active' : ''}`}
                    onClick={() => setSamplingPreset(opt.value)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="wf-s1-dropzone-actions">
              <button
                type="button"
                className="wf-btn wf-btn-primary"
                disabled={uploading || running}
                onClick={() => fileInputRef.current?.click()}
              >
                <AppIcon name="upload" className="h-3.5 w-3.5" />上传本地视频
              </button>
              <button
                type="button"
                className="wf-btn"
                disabled={uploading || running}
                onClick={() => setShowVideoPicker(true)}
              >
                <AppIcon name="folderOpen" className="h-3.5 w-3.5" />从资产库选取视频
              </button>
            </div>
          </div>
        )}

        {stageState.error ? (
          <div className="wf-stale-banner">
            <div className="wf-stale-banner-main">
              <AppIcon name="alert" className="wf-stale-banner-icon h-4 w-4" />
              <span>上次解析失败：{stageState.error}</span>
            </div>
          </div>
        ) : null}

        <div className="wf-divider">跳过视频解析，直接粘贴剧本</div>

        <div className="wf-s1-paste-box">
          <label className="wf-label" htmlFor="wf-s1-paste-textarea">
            已有文字剧本 / 分场大纲 / 口播稿（将自动拆解为结构化节拍，无需视频）
          </label>
          <textarea
            id="wf-s1-paste-textarea"
            className="wf-textarea"
            rows={6}
            value={pastedScript}
            onChange={(e) => setPastedScript(e.target.value)}
            placeholder={'例：\n场景1 城市夜景高楼天台\n女主站在边缘，冷风吹起风衣，手持发光神秘吊坠。\n女主：三年前你们欠我的，今晚加倍讨回来！\n\n场景2 奢华宴会厅\n大门轰然推开，全场宾客惊愕回头……'}
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="wf-field-hint wf-num">
              当前字数：{pastedScript.trim().length} 字
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="wf-btn"
                disabled={running || uploading || !pastedScript.trim()}
                onClick={() => void handleImportPastedScript('asset_extraction')}
              >
                <AppIcon name="image" className="h-3.5 w-3.5" />直接解析资产 (S3)
              </button>
              <button
                type="button"
                className="wf-btn wf-btn-stage"
                disabled={running || uploading || !pastedScript.trim()}
                onClick={() => void handleImportPastedScript('script_rewrite')}
              >
                <AppIcon name="arrowRight" className="h-3.5 w-3.5" />导入并进入洗稿 (S2)
              </button>
            </div>
          </div>
        </div>

        {showVideoPicker ? (
          <MaterialPickerDialog
            projectId={projectId}
            type="video"
            title="从资产库选取参考视频"
            onSelect={(mat) => void handleSelectLibraryVideo(mat)}
            onClose={() => setShowVideoPicker(false)}
          />
        ) : null}
      </div>
    )
  }

  // Parsed Split Workbench
  return (
    <div className="flex flex-col gap-3" data-stage="script_analysis">
      {renderPhaseProgressStrip()}
      <div className="wf-s1-split">
        {hiddenFileInput}

      {/* Left 42%: Cinema Video Player or Pasted-Script Source Card */}
      <div className="wf-s1-media-col">
        {playableVideoUrl ? (
          <div className="wf-s1-player-wrap nori-force-dark">
            <video
              ref={videoRef}
              src={playableVideoUrl}
              className={`wf-s1-video${isPortraitVideo ? ' is-portrait' : ''}`}
              controls
              playsInline
              preload="metadata"
              onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
              onLoadedMetadata={(e) => {
                const el = e.currentTarget
                if (el.videoWidth && el.videoHeight) {
                  setIsPortraitVideo(el.videoHeight > el.videoWidth)
                }
              }}
            />
            <div className="wf-s1-media-meta">
              <div className="flex items-center gap-2 min-w-0">
                <AppIcon name="video" className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate font-semibold">
                  {item.inputPayload.sourceVideoFileName || draft.title || '参考视频'}
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="wf-num">{formatSec(currentTime)}</span>
                <span>·</span>
                <span className="wf-num">约 {draft.estimatedDurationSec}s</span>
              </div>
            </div>
            {draft.cutHints && draft.cutHints.length > 0 ? (
              <div className="wf-s1-cut-markers" aria-label="自动检测剪辑点">
                <span className="text-[10.5px] opacity-70 self-center mr-1">切镜点</span>
                {draft.cutHints.slice(0, 18).map((cutSec, idx) => (
                  <button
                    key={`${cutSec}-${idx}`}
                    type="button"
                    className="wf-timecode-btn"
                    onClick={() => seekToSecond(cutSec)}
                  >
                    {formatSec(cutSec)}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="wf-card">
            <div className="wf-card-head">
              <div className="wf-card-title">
                <AppIcon name="fileText" className="h-4 w-4" />
                <span>纯文字剧本导入模式</span>
              </div>
              <span className="wf-badge is-stage">已跳过视频解析</span>
            </div>
            <div className="wf-card-body flex flex-col gap-3">
              <p className="wf-field-hint">
                当前条目由粘贴剧本直接生成结构化原剧本。你可以在右侧逐拍编辑，也可以随时切换为上传参考视频或重新粘贴原文。
              </p>
              <div className="flex flex-wrap gap-2">
                <span className="wf-badge wf-num">{draft.beats.length} 个节拍</span>
                <span className="wf-badge wf-num">预估 {draft.estimatedDurationSec}s</span>
                <span className="wf-badge wf-num">{draft.characters.length} 角色</span>
              </div>
              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  type="button"
                  className="wf-btn wf-btn-sm"
                  disabled={uploading || running}
                  onClick={() => setShowRepasteBox((v) => !v)}
                >
                  <AppIcon name="edit" className="h-3.5 w-3.5" />重新粘贴原稿
                </button>
                <button
                  type="button"
                  className="wf-btn wf-btn-ghost wf-btn-sm"
                  disabled={uploading || running}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <AppIcon name="upload" className="h-3.5 w-3.5" />改为上传视频
                </button>
                <button
                  type="button"
                  className="wf-btn wf-btn-ghost wf-btn-sm"
                  disabled={uploading || running}
                  onClick={() => setShowVideoPicker(true)}
                >
                  <AppIcon name="folderOpen" className="h-3.5 w-3.5" />资产库选视频
                </button>
              </div>
              {showRepasteBox ? (
                <div className="flex flex-col gap-2 pt-2 border-t border-[var(--fos-border-soft)]">
                  <textarea
                    className="wf-textarea"
                    rows={5}
                    value={pastedScript}
                    onChange={(e) => setPastedScript(e.target.value)}
                    placeholder="粘贴新的完整剧本文本…"
                  />
                  <div className="flex justify-end gap-2">
                    <button type="button" className="wf-btn wf-btn-ghost wf-btn-xs" onClick={() => setShowRepasteBox(false)}>
                      取消
                    </button>
                    <button
                      type="button"
                      className="wf-btn wf-btn-stage wf-btn-xs"
                      disabled={running || !pastedScript.trim()}
                      onClick={() => void handleImportPastedScript('script_rewrite')}
                    >
                      替换并重拆节拍
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        )}

        {/* Quick Video Controls & Re-analyze Card */}
        {playableVideoUrl ? (
          <div className="wf-card">
            <div className="wf-card-body flex flex-col gap-3">
              <div className="flex items-center justify-between gap-2">
                <span className="wf-param-label">视频重解析设置</span>
                <div className="wf-param-pills">
                  {([
                    { value: 'fast', label: '快速' },
                    { value: 'standard', label: '标准' },
                    { value: 'detailed', label: '精细' },
                  ] as const).map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      className={`wf-param-pill${samplingPreset === opt.value ? ' is-active' : ''}`}
                      onClick={() => setSamplingPreset(opt.value)}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="wf-btn wf-btn-stage wf-btn-sm"
                  disabled={running || uploading}
                  onClick={() => {
                    void handleRerunRequest({ stageParamsOverride: { samplingPreset, detectSceneCuts }, forceRerun: true })
                  }}
                >
                  {running ? <span className="wf-spinner" /> : <AppIcon name="refresh" className="h-3.5 w-3.5" />}
                  <span>{running ? `解析中 ${elapsedSeconds}s` : '重新解析'}</span>
                </button>
                <button
                  type="button"
                  className="wf-btn wf-btn-ghost wf-btn-sm"
                  disabled={running || uploading}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <AppIcon name="upload" className="h-3.5 w-3.5" />更换视频
                </button>
                <button
                  type="button"
                  className="wf-btn wf-btn-ghost wf-btn-sm"
                  disabled={running || uploading}
                  onClick={() => setShowVideoPicker(true)}
                >
                  <AppIcon name="folderOpen" className="h-3.5 w-3.5" />资产库替换
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {/* Extracted Elements Quick Summary */}
        {(draft.characters.length > 0 || draft.locations.length > 0 || draft.props.length > 0) ? (
          <div className="wf-card">
            <div className="wf-card-head">
              <span className="wf-card-title">
                <AppIcon name="sparkles" className="h-3.5 w-3.5" />识别到的核心要素
              </span>
              <span className="wf-badge is-muted wf-num">
                {draft.characters.length}角 · {draft.locations.length}景 · {draft.props.length}物
              </span>
            </div>
            <div className="wf-card-body flex flex-col gap-2.5 text-[12px]">
              {draft.characters.length > 0 ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="wf-param-label">角色</span>
                  {draft.characters.map((ch, idx) => (
                    <span key={`${ch.name}-${idx}`} className="wf-badge is-stage" title={`${ch.role} · ${ch.traits}`}>
                      {ch.name}
                    </span>
                  ))}
                </div>
              ) : null}
              {draft.locations.length > 0 ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="wf-param-label">场景</span>
                  {draft.locations.map((loc, idx) => (
                    <span key={`${loc.name}-${idx}`} className="wf-badge" title={loc.description}>
                      {loc.name}
                    </span>
                  ))}
                </div>
              ) : null}
              {draft.props.length > 0 ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="wf-param-label">道具</span>
                  {draft.props.map((prop, idx) => (
                    <span key={`${prop.name}-${idx}`} className="wf-badge is-muted" title={prop.description}>
                      {prop.name}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      {/* Right 58%: Editable Summary + Beats */}
      <div className="wf-s1-script-col">
        {saveError ? (
          <div className="wf-stale-banner wf-save-error" role="alert">
            <div className="wf-stale-banner-main">
              <AppIcon name="alert" className="wf-stale-banner-icon h-4 w-4" />
              <span>保存失败：{saveError}（修改仍在本地，可点击重试）</span>
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
              <button
                type="button"
                className="wf-btn wf-btn-ghost wf-btn-xs"
                onClick={() => setSaveError(null)}
              >
                关闭
              </button>
            </div>
          </div>
        ) : null}
        <div className="wf-s1-summary">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <span className="wf-badge is-stage">原剧本概览</span>
              {draft.genre ? <span className="wf-badge">{draft.genre}</span> : null}
              <span className="wf-badge wf-num">{draft.beats.length} 拍 · {draft.estimatedDurationSec}s</span>
              {dirty && !isTrialView ? <span className="wf-badge is-warning">有未保存修改</span> : null}
              {draft.editedScriptText ? <span className="wf-badge is-accent" title="已写入 editedScriptText，原文 fullScriptText 保留不变">已编辑</span> : <span className="wf-badge is-muted">原文</span>}
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
                  <span>确认并进入洗稿</span>
                  <AppIcon name="arrowRight" className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : null}
          </div>

          <div className="wf-field-row">
            <div className="wf-field">
              <label className="wf-label">剧目标题</label>
              <input
                className="wf-input wf-input-sm"
                value={draft.title}
                readOnly={isTrialView}
                onChange={(e) => updateDraftField('title', e.target.value)}
              />
            </div>
            <div className="wf-field">
              <label className="wf-label">前 3 秒钩子与节奏分析</label>
              <input
                className="wf-input wf-input-sm"
                value={draft.hookAnalysis || ''}
                readOnly={isTrialView}
                placeholder="开场冲突、悬念或视觉抓手分析…"
                onChange={(e) => updateDraftField('hookAnalysis', e.target.value)}
              />
            </div>
          </div>

          <div className="wf-field">
            <label className="wf-label">故事梗概</label>
            <textarea
              className="wf-textarea"
              rows={2}
              value={draft.summary}
              readOnly={isTrialView}
              onChange={(e) => updateDraftField('summary', e.target.value)}
            />
          </div>
        </div>

        {/* Editable Beats */}
        <div className="wf-beat-list">
          {draft.beats.map((beat, idx) => {
            const isActive = idx === activeBeatIndex
            return (
              <article
                key={`${beat.beatIndex}-${idx}`}
                className={`wf-beat-card${isActive ? ' is-active' : ''}`}
              >
                <div className="wf-beat-head">
                  <div className="wf-beat-head-left flex-1">
                    <span className="wf-beat-index">#{String(idx + 1).padStart(2, '0')}</span>
                    <button
                      type="button"
                      className={`wf-timecode-btn${isActive ? ' is-playing' : ''}`}
                      disabled={!playableVideoUrl || typeof beat.startSec !== 'number'}
                      title={playableVideoUrl ? '点击跳转到视频对应时间点' : '纯文字剧本模式无时间轴'}
                      onClick={() => seekToSecond(beat.startSec)}
                    >
                      <AppIcon name={isActive ? 'pause' : 'play'} className="h-3 w-3" />
                      <span>{formatBeatTimecode(beat)}</span>
                    </button>
                    <input
                      className="wf-input wf-input-sm flex-1 min-w-[140px]"
                      value={beat.sceneHeading}
                      readOnly={isTrialView}
                      placeholder="场景 / 镜头标题"
                      onChange={(e) => updateBeat(idx, { sceneHeading: e.target.value })}
                    />
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {canManageSkills && onQuoteSnippet ? (
                      <button
                        type="button"
                        className="wf-btn wf-btn-ghost wf-btn-xs"
                        title="引用本拍内容到右侧 Skill 调优面板"
                        onClick={() => onQuoteSnippet({
                          label: `S1 节拍 #${String(idx + 1).padStart(2, '0')} (${formatBeatTimecode(beat)})`,
                          text: `[${formatBeatTimecode(beat)}] ${beat.sceneHeading}\n画面：${beat.visualAction}\n对白：${beat.dialogue}${beat.sfxOrMusic ? `\n音效：${beat.sfxOrMusic}` : ''}`,
                        })}
                      >
                        <AppIcon name="sparkles" className="h-3 w-3" />引用调优
                      </button>
                    ) : null}
                    {!isTrialView && draft.beats.length > 1 ? (
                      <button
                        type="button"
                        className="wf-btn wf-btn-ghost wf-btn-icon wf-btn-sm"
                        aria-label={`删除节拍 ${idx + 1}`}
                        onClick={() => void removeBeat(idx)}
                      >
                        <AppIcon name="trash" className="h-3.5 w-3.5" />
                      </button>
                    ) : null}
                  </div>
                </div>

                <div className="wf-beat-grid">
                  <div className="wf-field">
                    <label className="wf-label">画面与景别运镜</label>
                    <textarea
                      className="wf-textarea"
                      rows={3}
                      value={beat.visualAction}
                      readOnly={isTrialView}
                      placeholder="描述人物动作、景别、运镜与核心道具…"
                      onChange={(e) => updateBeat(idx, { visualAction: e.target.value })}
                    />
                  </div>
                  <div className="wf-field">
                    <label className="wf-label">对白 / 旁白</label>
                    <textarea
                      className="wf-textarea"
                      rows={3}
                      value={beat.dialogue}
                      readOnly={isTrialView}
                      placeholder="人物台词或画外音旁白…"
                      onChange={(e) => updateBeat(idx, { dialogue: e.target.value })}
                    />
                  </div>
                </div>

                <div className="wf-field-row">
                  <div className="wf-field">
                    <label className="wf-label">时间码（编辑后写入 editedScriptText）</label>
                    <input
                      className="wf-input wf-input-sm"
                      value={beat.timecode || ''}
                      readOnly={isTrialView}
                      placeholder="例如 00:05–00:12"
                      onChange={(e) => updateBeat(idx, { timecode: e.target.value })}
                    />
                  </div>
                  <div className="wf-field">
                    <label className="wf-label">旁白（独立音轨）</label>
                    <input
                      className="wf-input wf-input-sm"
                      value={beat.voiceover || ''}
                      readOnly={isTrialView}
                      placeholder="画外音 / 旁白内容…"
                      onChange={(e) => updateBeat(idx, { voiceover: e.target.value })}
                    />
                  </div>
                </div>

                <div className="wf-field-row">
                  <div className="wf-field">
                    <label className="wf-label">音效 / 配乐</label>
                    <input
                      className="wf-input wf-input-sm"
                      value={beat.sfxOrMusic || ''}
                      readOnly={isTrialView}
                      placeholder="BGM 情绪转折、环境音或重音音效…"
                      onChange={(e) => updateBeat(idx, { sfxOrMusic: e.target.value })}
                    />
                  </div>
                  <div className="wf-field">
                    <label className="wf-label">钩子 / 情绪备注</label>
                    <input
                      className="wf-input wf-input-sm"
                      value={beat.hookNote || ''}
                      readOnly={isTrialView}
                      placeholder="本拍的留存点、情绪爆发或信息转折…"
                      onChange={(e) => updateBeat(idx, { hookNote: e.target.value })}
                    />
                  </div>
                </div>
              </article>
            )
          })}
        </div>

        {!isTrialView ? (
          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <button type="button" className="wf-btn wf-btn-subtle wf-btn-sm" onClick={addBeat}>
              <AppIcon name="plus" className="h-3.5 w-3.5" />新增节拍
            </button>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="wf-btn wf-btn-sm"
                disabled={saving || running || !dirty}
                onClick={() => void handleSave()}
              >
                <AppIcon name="check" className="h-3.5 w-3.5" />保存修改
              </button>
              <button
                type="button"
                className="wf-btn wf-btn-primary wf-btn-sm"
                disabled={saving || running}
                onClick={() => void handleApprove()}
              >
                <span>确认并进入洗稿</span>
                <span className="wf-mono text-[10px] opacity-80">⌘↵</span>
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {showVideoPicker ? (
        <MaterialPickerDialog
          projectId={projectId}
          type="video"
          title="从资产库选取参考视频"
          onSelect={(mat) => void handleSelectLibraryVideo(mat)}
          onClose={() => setShowVideoPicker(false)}
        />
      ) : null}
      </div>
    </div>
  )
})
