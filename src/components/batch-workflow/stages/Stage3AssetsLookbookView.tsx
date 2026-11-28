'use client'

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AppIcon } from '@/components/ui/icons'
import { MediaImage } from '@/components/media/MediaImage'
import ImagePreviewModal from '@/components/ui/ImagePreviewModal'
import { ViewportDialogLayer } from '@/components/frameos/ViewportDialogLayer'
import { MaterialPickerDialog } from '@/components/frameos/materials/MaterialPickerDialog'
import type { FrameosMaterialItem } from '@/components/frameos/materials/contracts'
import type { FrameosAssetCategory } from '@/lib/frameos/material-category'
import { confirmAction } from '@/lib/ui/feedback'
import { toCanvasDisplayImageUrl, toPlayableAudioUrl } from '@/lib/media/image-url'
import {
  clampImagePrompt,
  type AssetExtractionStageParams,
  type AssetsArtifact,
  type BatchItemDTO,
  type BatchStageState,
  type WorkflowAssetItem,
  type WorkflowAssetKind,
} from '@/lib/batch-workflow/types'
import { aspectRatioClassFromValue, isVersionSelectable, trySave } from './_helpers'

export interface Stage3AssetsLookbookViewProps {
  projectId?: string
  item: BatchItemDTO
  artifact: AssetsArtifact | null
  hasUpstreamScript: boolean
  isTrialView: boolean
  stageState: BatchStageState
  stageParams?: AssetExtractionStageParams
  running: boolean
  elapsedSeconds?: number
  generatingAssets: boolean
  saving: boolean
  draftSyncNonce?: number
  canManageSkills: boolean
  onRunExtract: (paramsOverride: AssetExtractionStageParams, forceRerun?: boolean) => Promise<void>
  onGenerateAssets: (assetItemIds?: string[]) => Promise<void>
  onBindAssetMaterial: (payload: {
    assetItemId: string
    materialId?: string
    voiceMaterialId?: string
    clearVoice?: boolean
    selectVersionIndex?: number
  }) => Promise<void>
  onSaveDraft: (edited: AssetsArtifact) => Promise<void>
  onApproveAndNext: (edited: AssetsArtifact) => Promise<void>
  onRegisterGetDraft?: (getter: (() => AssetsArtifact | null) | null) => void
  onDirtyChange?: (dirty: boolean) => void
  onQuoteSnippet?: (snippet: { label: string; text: string }) => void
  onNotify: (msg: string, tone?: 'success' | 'error' | 'info') => void
  /** Optional flush hook supplied by parent (D). */
  onFlushBeforeRun?: () => Promise<void> | void
}

const KIND_LABELS: Record<WorkflowAssetKind, string> = {
  character: '角色',
  location: '场景',
  prop: '物品',
}

const STATUS_LABELS: Record<WorkflowAssetItem['status'], { label: string; tone: string }> = {
  ready: { label: '已出图', tone: 'is-success' },
  reused: { label: '资产库复用', tone: 'is-accent' },
  queued: { label: '排队出图', tone: 'is-info' },
  processing: { label: '生成中', tone: 'is-info' },
  pending: { label: '待出图', tone: 'is-muted' },
  failed: { label: '出图失败', tone: 'is-danger' },
}

const ASSET_PROMPT_LIMIT = 900

function extractHexSwatches(text: string): string[] {
  const matches = text.match(/#[0-9a-fA-F]{6}\b/g)
  if (matches && matches.length > 0) return Array.from(new Set(matches)).slice(0, 5)
  return []
}

function recomputeCounts(artifact: AssetsArtifact): AssetsArtifact {
  let readyCount = 0
  let pendingCount = 0
  let failedCount = 0
  for (const asset of artifact.items) {
    if (asset.status === 'ready' || asset.status === 'reused') readyCount += 1
    else if (asset.status === 'failed') failedCount += 1
    else pendingCount += 1
  }
  return {
    ...artifact,
    totalCount: artifact.items.length,
    readyCount,
    pendingCount,
    failedCount,
  }
}

function toMaterialAssetCategory(kind: WorkflowAssetKind): FrameosAssetCategory {
  if (kind === 'character') return 'character'
  if (kind === 'location') return 'location'
  return 'prop'
}

export const Stage3AssetsLookbookView = memo(function Stage3AssetsLookbookView({
  projectId,
  item,
  artifact,
  hasUpstreamScript,
  isTrialView,
  stageState,
  stageParams,
  running,
  elapsedSeconds = 0,
  generatingAssets,
  saving,
  draftSyncNonce = 0,
  canManageSkills,
  onRunExtract,
  onGenerateAssets,
  onBindAssetMaterial,
  onSaveDraft,
  onApproveAndNext,
  onRegisterGetDraft,
  onDirtyChange,
  onQuoteSnippet,
  onNotify,
  onFlushBeforeRun,
}: Stage3AssetsLookbookViewProps) {
  const [draft, setDraft] = useState<AssetsArtifact | null>(artifact)
  const [dirty, setDirty] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'all' | WorkflowAssetKind>('all')
  const [preferWorkspaceReuse, setPreferWorkspaceReuse] = useState<boolean>(
    stageParams?.preferWorkspaceReuse ?? true,
  )
  const [editingStyleBible, setEditingStyleBible] = useState(false)
  const [expandedAssetId, setExpandedAssetId] = useState<string | null>(null)
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null)
  const [pickerState, setPickerState] = useState<{
    assetId: string
    assetName: string
    mode: 'image' | 'audio'
    kind: WorkflowAssetKind
  } | null>(null)
  const [playingVoiceAssetId, setPlayingVoiceAssetId] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  // Add manual asset modal
  const [showAddModal, setShowAddModal] = useState(false)
  const [newAssetKind, setNewAssetKind] = useState<WorkflowAssetKind>('character')
  const [newAssetName, setNewAssetName] = useState('')
  const [newAssetRole, setNewAssetRole] = useState('')
  const [newAssetDesc, setNewAssetDesc] = useState('')
  const [newAssetPrompt, setNewAssetPrompt] = useState('')

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
      return
    }

    // Dirty local edits active: merge ONLY server-owned async generation/binding fields
    if (artifact && Array.isArray(artifact.items)) {
      setDraft((prev) => {
        if (!prev) return artifact
        const serverById = new Map(artifact.items.map((a) => [a.id, a]))
        const mergedItems = prev.items.map((localItem) => {
          const srv = serverById.get(localItem.id)
          if (!srv) return localItem
          return {
            ...localItem,
            status: srv.status,
            imageUrl: srv.imageUrl,
            storageKey: srv.storageKey,
            materialId: srv.materialId,
            toolboxAssetId: srv.toolboxAssetId,
            versions: srv.versions,
            selectedVersionIndex: srv.selectedVersionIndex,
            errorMessage: srv.errorMessage,
            taskId: srv.taskId,
            voiceMaterialId: srv.voiceMaterialId,
            voiceMaterialTitle: srv.voiceMaterialTitle,
            voiceMaterialUrl: srv.voiceMaterialUrl,
          }
        })
        return recomputeCounts({ ...prev, items: mergedItems })
      })
    }
  }, [artifact, draftSyncNonce, isTrialView, item.id, running])

  useEffect(() => {
    onDirtyChange?.(dirty && !isTrialView)
  }, [dirty, isTrialView, onDirtyChange])

  useEffect(() => () => {
    onDirtyChange?.(false)
  }, [onDirtyChange])

  useEffect(() => {
    if (typeof stageParams?.preferWorkspaceReuse === 'boolean') {
      setPreferWorkspaceReuse(stageParams.preferWorkspaceReuse)
    }
  }, [stageParams?.preferWorkspaceReuse])

  useEffect(() => () => {
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current = null
    }
  }, [])

  // Reset modals / inline edit state when the active item changes.
  useEffect(() => {
    setExpandedAssetId(null)
    setPreviewImageUrl(null)
    setPickerState(null)
    setShowAddModal(false)
    setEditingStyleBible(false)
    setSaveError(null)
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current = null
    }
    setPlayingVoiceAssetId(null)
  }, [item.id])

  const draftRef = useRef<AssetsArtifact | null>(draft)
  draftRef.current = draft
  const draftVersionRef = useRef(0)
  const commitDirtySuccess = useCallback((version: number) => {
    if (draftVersionRef.current === version) setDirty(false)
  }, [])

  useEffect(() => {
    if (!onRegisterGetDraft) return
    onRegisterGetDraft(() => (draftRef.current ? recomputeCounts(draftRef.current) : null))
    return () => onRegisterGetDraft(null)
  }, [onRegisterGetDraft])

  const counts = useMemo(() => {
    const items = draft?.items || []
    return {
      all: items.length,
      character: items.filter((a) => a.kind === 'character').length,
      location: items.filter((a) => a.kind === 'location').length,
      prop: items.filter((a) => a.kind === 'prop').length,
      missing: items.filter((a) => a.status === 'pending' || a.status === 'failed').length,
    }
  }, [draft])

  const visibleItems = useMemo(() => {
    const items = draft?.items || []
    if (activeTab === 'all') return items
    return items.filter((a) => a.kind === activeTab)
  }, [activeTab, draft])

  const swatches = useMemo(
    () => extractHexSwatches(`${draft?.colorPalette || ''} ${draft?.styleBible || ''}`),
    [draft?.colorPalette, draft?.styleBible],
  )

  const toggleVoicePreview = (asset: WorkflowAssetItem) => {
    if (playingVoiceAssetId === asset.id) {
      audioRef.current?.pause()
      setPlayingVoiceAssetId(null)
      return
    }
    const url = toPlayableAudioUrl(asset.voiceMaterialUrl)
    if (!url) {
      onNotify('音色播放链接不可用。', 'error')
      return
    }
    if (audioRef.current) audioRef.current.pause()
    const audio = new Audio(url)
    audioRef.current = audio
    setPlayingVoiceAssetId(asset.id)
    audio.onended = () => setPlayingVoiceAssetId(null)
    audio.onerror = () => {
      setPlayingVoiceAssetId(null)
      onNotify('播放角色音色失败。', 'error')
    }
    void audio.play().catch(() => setPlayingVoiceAssetId(null))
  }

  const updateStyleField = (field: 'styleBible' | 'colorPalette' | 'lightingDirection', value: string) => {
    if (isTrialView) return
    setDraft((prev) => (prev ? { ...prev, [field]: value } : prev))
    draftVersionRef.current += 1
    setDirty(true)
  }

  const updateAssetItem = (assetId: string, patch: Partial<WorkflowAssetItem>) => {
    if (isTrialView) return
    setDraft((prev) => {
      if (!prev) return prev
      return recomputeCounts({
        ...prev,
        items: prev.items.map((a) => (a.id === assetId ? { ...a, ...patch } : a)),
      })
    })
    draftVersionRef.current += 1
    setDirty(true)
  }

  const removeAssetItem = async (asset: WorkflowAssetItem) => {
    if (isTrialView || !draft) return
    const ok = await confirmAction({
      title: `移除资产「${asset.name}」？`,
      message: '删除后该资产将不再出现在分镜 @引用候选列表中，确认移除？',
      confirmLabel: '确认移除',
      danger: true,
    })
    if (!ok) return
    const next = recomputeCounts({
      ...draft,
      items: draft.items.filter((a) => a.id !== asset.id),
    })
    setDraft(next)
    draftVersionRef.current += 1
    const version = draftVersionRef.current
    setDirty(true)
    setSaveError(null)
    const res = await trySave(onSaveDraft, next)
    if (res.ok) {
      commitDirtySuccess(version)
      setSaveError(null)
    } else {
      setSaveError(res.error)
      onNotify(res.error, 'error')
    }
  }

  const flushDirtyBeforeServerAction = async (): Promise<boolean> => {
    if (!draft || !dirty || isTrialView) return true
    const version = draftVersionRef.current
    const normalized = recomputeCounts({
      ...draft,
      items: draft.items.map((a) => ({
        ...a,
        imagePrompt: clampImagePrompt(a.imagePrompt || a.description || a.name, ASSET_PROMPT_LIMIT),
      })),
    })
    setDraft(normalized)
    const res = await trySave(onSaveDraft, normalized)
    if (res.ok) {
      commitDirtySuccess(version)
      setSaveError(null)
      return true
    }
    setSaveError(res.error)
    onNotify(res.error, 'error')
    return false
  }

  const handleSaveAndRegenerateSingle = async (assetId: string) => {
    if (!draft) return
    const version = draftVersionRef.current
    const normalized = recomputeCounts({
      ...draft,
      items: draft.items.map((a) => ({
        ...a,
        imagePrompt: clampImagePrompt(a.imagePrompt || a.description || a.name, ASSET_PROMPT_LIMIT),
      })),
    })
    setDraft(normalized)
    if (dirty) {
      const res = await trySave(onSaveDraft, normalized)
      if (!res.ok) {
        setSaveError(res.error)
        onNotify(res.error, 'error')
        return
      }
      commitDirtySuccess(version)
      setSaveError(null)
    }
    try {
      await onGenerateAssets([assetId])
    } catch (err) {
      const msg = err instanceof Error ? err.message : '生成失败'
      setSaveError(msg)
      onNotify(msg, 'error')
    }
  }

  const handleBatchGenerateMissing = async () => {
    const flushed = await flushDirtyBeforeServerAction()
    if (!flushed) return
    try {
      await onGenerateAssets()
    } catch (err) {
      const msg = err instanceof Error ? err.message : '批量生成失败'
      setSaveError(msg)
      onNotify(msg, 'error')
    }
  }

  const handleSafeBindAssetMaterial = async (payload: {
    assetItemId: string
    materialId?: string
    voiceMaterialId?: string
    clearVoice?: boolean
    selectVersionIndex?: number
  }) => {
    const flushed = await flushDirtyBeforeServerAction()
    if (!flushed) return
    try {
      await onBindAssetMaterial(payload)
    } catch (err) {
      const msg = err instanceof Error ? err.message : '绑定失败'
      setSaveError(msg)
      onNotify(msg, 'error')
    }
  }

  const handleCreateManualAsset = async () => {
    if (!draft) return
    const name = newAssetName.trim()
    if (!name) {
      onNotify('请填写资产名称。', 'error')
      return
    }
    const aspectRatio = newAssetKind === 'character' ? '3:4' : newAssetKind === 'location' ? '16:9' : '1:1'
    const newItem: WorkflowAssetItem = {
      id: `manual_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      kind: newAssetKind,
      name,
      aliases: [],
      roleOrUsage: newAssetRole.trim() || KIND_LABELS[newAssetKind],
      description: newAssetDesc.trim() || name,
      imagePrompt: clampImagePrompt(
        newAssetPrompt.trim() || `${draft.styleBible ? `${draft.styleBible}，` : ''}${name}，${newAssetDesc.trim() || '电影级定妆参考图'}`,
        ASSET_PROMPT_LIMIT,
      ),
      aspectRatio,
      status: 'pending',
      materialId: null,
      imageUrl: null,
      storageKey: null,
      toolboxAssetId: null,
      taskId: null,
      errorMessage: null,
      versions: [],
      selectedVersionIndex: -1,
    }
    const next = recomputeCounts({ ...draft, items: [...draft.items, newItem] })
    setDraft(next)
    draftVersionRef.current += 1
    const version = draftVersionRef.current
    setDirty(true)
    setNewAssetName('')
    setNewAssetRole('')
    setNewAssetDesc('')
    setNewAssetPrompt('')
    const res = await trySave(onSaveDraft, next)
    if (res.ok) {
      commitDirtySuccess(version)
      setSaveError(null)
      setShowAddModal(false)
      onNotify(`已新增${KIND_LABELS[newAssetKind]}资产「${name}」`, 'success')
    } else {
      setSaveError(res.error)
      onNotify(res.error, 'error')
    }
  }

  const handleMaterialSelected = async (material: FrameosMaterialItem) => {
    if (!pickerState) return
    const target = pickerState
    setPickerState(null)
    if (target.mode === 'image') {
      await handleSafeBindAssetMaterial({ assetItemId: target.assetId, materialId: material.id })
    } else {
      await handleSafeBindAssetMaterial({ assetItemId: target.assetId, voiceMaterialId: material.id })
    }
  }

  const handleSave = async () => {
    if (!draft) return
    const version = draftVersionRef.current
    const res = await trySave(onSaveDraft, recomputeCounts(draft))
    if (res.ok) {
      commitDirtySuccess(version)
      setSaveError(null)
    } else {
      setSaveError(res.error)
      onNotify(res.error, 'error')
    }
  }

  const handleApprove = async () => {
    if (!draft) return
    const version = draftVersionRef.current
    const res = await trySave(onApproveAndNext, recomputeCounts(draft))
    if (res.ok) {
      commitDirtySuccess(version)
      setSaveError(null)
    } else {
      setSaveError(res.error)
      onNotify(res.error, 'error')
    }
  }

  const handleRerunExtract = useCallback(async () => {
    if (dirty) {
      const ok = await confirmAction({
        title: '先保存修改，再重新抽取资产？',
        message: '当前资产清单有未保存修改。保存成功后才提交重新抽取。',
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
        const res = await trySave(onSaveDraft, recomputeCounts(draft))
        if (!res.ok) { setSaveError(res.error); onNotify(res.error, 'error'); return }
        commitDirtySuccess(version)
      }
      setSaveError(null)
      await onRunExtract({ preferWorkspaceReuse }, true)
    } catch (err) {
      const msg = err instanceof Error ? err.message : '执行失败，请重试'
      setSaveError(msg)
      onNotify(msg, 'error')
    }
  }, [commitDirtySuccess, dirty, draft, onFlushBeforeRun, onNotify, onRunExtract, onSaveDraft, preferWorkspaceReuse])

  // Empty State
  if (!draft) {
    return (
      <div className="wf-card" data-stage="asset_extraction">
        <div className="wf-empty">
          <span className="wf-empty-icon">
            {running ? <span className="wf-spinner" /> : <AppIcon name="image" className="h-5 w-5" />}
          </span>
          <div className="wf-empty-title">
            {running
              ? `正在解析剧本角色、场景与核心道具…${elapsedSeconds > 0 ? `（已用 ${elapsedSeconds}s）` : ''}`
              : '抽取全剧视觉资产与画风圣经'}
          </div>
          <div className="wf-empty-desc">
            自动提炼角色定妆、主场景与核心道具清单，优先复用工作区已有素材，并支持批量生成一致性参考图与绑定角色音色。
          </div>
          <div className="flex items-center gap-2 mt-1">
            <label className="inline-flex items-center gap-2 text-[12px] text-[var(--fos-text-2)] cursor-pointer">
              <input
                type="checkbox"
                role="switch"
                className="wf-switch"
                checked={preferWorkspaceReuse}
                onChange={(e) => setPreferWorkspaceReuse(e.target.checked)}
              />
              <span>工作区资产库优先复用</span>
            </label>
          </div>
          {stageState.error ? (
            <div className="wf-badge is-danger">{stageState.error}</div>
          ) : null}
          <div className="wf-empty-actions">
            <button
              type="button"
              className="wf-btn wf-btn-primary"
              disabled={running || !hasUpstreamScript}
              onClick={() => void handleRerunExtract()}
            >
              {running ? <span className="wf-spinner" /> : <AppIcon name="sparkles" className="h-3.5 w-3.5" />}
              <span>{hasUpstreamScript ? '开始解析资产清单' : '请先完成 S1 或 S2 剧本'}</span>
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3.5" data-stage="asset_extraction">
      {/* Editable Style Bible Strip */}
      <div className="wf-style-bible-strip">
        <div className="wf-style-bible-main">
          <span className="wf-badge is-stage">画风圣经</span>
          {swatches.length > 0 ? (
            <div className="wf-style-swatch-row" aria-label="色彩基调色板">
              {swatches.map((hex) => (
                <span key={hex} className="wf-style-swatch" style={{ background: hex }} title={hex} />
              ))}
            </div>
          ) : null}
          {!editingStyleBible ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-[var(--fos-text-2)] min-w-0 flex-1">
              <span className="font-semibold text-[var(--fos-text-1)]">{draft.styleBible || '未定义画风规范'}</span>
              {draft.lightingDirection ? <span>光影：{draft.lightingDirection}</span> : null}
              {draft.colorPalette ? <span>色板：{draft.colorPalette}</span> : null}
            </div>
          ) : null}
        </div>
        {!isTrialView ? (
          <button
            type="button"
            className="wf-btn wf-btn-subtle wf-btn-xs shrink-0"
            onClick={() => setEditingStyleBible((v) => !v)}
          >
            <AppIcon name={editingStyleBible ? 'check' : 'edit'} className="h-3 w-3" />
            <span>{editingStyleBible ? '收起编辑' : '编辑画风规范'}</span>
          </button>
        ) : null}

        {editingStyleBible && !isTrialView ? (
          <div className="w-full grid grid-cols-1 md:grid-cols-3 gap-2.5 pt-2 border-t border-[var(--fos-border-soft)]">
            <div className="wf-field">
              <label className="wf-label">整体画风与质感</label>
              <input
                className="wf-input wf-input-sm"
                value={draft.styleBible}
                onChange={(e) => updateStyleField('styleBible', e.target.value)}
              />
            </div>
            <div className="wf-field">
              <label className="wf-label">光影方向</label>
              <input
                className="wf-input wf-input-sm"
                value={draft.lightingDirection}
                onChange={(e) => updateStyleField('lightingDirection', e.target.value)}
              />
            </div>
            <div className="wf-field">
              <label className="wf-label">色板与负向约束</label>
              <input
                className="wf-input wf-input-sm"
                value={draft.colorPalette}
                onChange={(e) => updateStyleField('colorPalette', e.target.value)}
              />
            </div>
          </div>
        ) : null}
      </div>

      {/* Asset Toolbar: Category Tabs + Reuse Switch + Batch CTAs */}
      <div className="wf-asset-toolbar">
        <div className="flex flex-wrap items-center gap-3">
          <div className="wf-asset-tabs" role="tablist" aria-label="资产分类">
            {([
              { id: 'all' as const, label: '全部', count: counts.all },
              { id: 'character' as const, label: '角色', count: counts.character },
              { id: 'location' as const, label: '场景', count: counts.location },
              { id: 'prop' as const, label: '物品', count: counts.prop },
            ]).map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={activeTab === tab.id}
                className={`wf-asset-tab${activeTab === tab.id ? ' is-active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
              >
                <span>{tab.label}</span>
                <span className="wf-asset-tab-count">{tab.count}</span>
              </button>
            ))}
          </div>

          <label className="inline-flex items-center gap-2 text-[11.5px] text-[var(--fos-text-2)] cursor-pointer">
            <input
              type="checkbox"
              role="switch"
              className="wf-switch"
              checked={preferWorkspaceReuse}
              onChange={(e) => setPreferWorkspaceReuse(e.target.checked)}
            />
            <span>工作区资产库优先复用</span>
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {!isTrialView ? (
            <>
              <button
                type="button"
                className="wf-btn wf-btn-subtle wf-btn-sm"
                disabled={running || generatingAssets}
                onClick={() => setShowAddModal(true)}
              >
                <AppIcon name="plus" className="h-3.5 w-3.5" />手动新增资产
              </button>
              <button
                type="button"
                className="wf-btn wf-btn-sm"
                disabled={running || generatingAssets}
                onClick={() => void handleRerunExtract()}
              >
                {running ? <span className="wf-spinner" /> : <AppIcon name="refresh" className="h-3.5 w-3.5" />}
                <span>{running ? `解析中 ${elapsedSeconds}s` : '重新抽取资产'}</span>
              </button>
              <button
                type="button"
                className="wf-btn wf-btn-stage wf-btn-sm"
                disabled={running || generatingAssets || counts.missing === 0}
                onClick={() => void handleBatchGenerateMissing()}
              >
                {generatingAssets ? <span className="wf-spinner" /> : <AppIcon name="sparkles" className="h-3.5 w-3.5" />}
                <span>
                  {counts.missing > 0
                    ? `一键生成全部缺失资产图 (${counts.missing})`
                    : '全部资产图已就绪'}
                </span>
              </button>
              {dirty ? (
                <button
                  type="button"
                  className="wf-btn wf-btn-sm"
                  disabled={saving}
                  onClick={() => void handleSave()}
                >
                  <AppIcon name="check" className="h-3.5 w-3.5" />保存修改
                </button>
              ) : null}
              <button
                type="button"
                className="wf-btn wf-btn-primary wf-btn-sm"
                disabled={saving || running}
                onClick={() => void handleApprove()}
              >
                <span>进入处理分镜</span>
                <span className="wf-mono text-[10px] opacity-80">⌘↵</span>
              </button>
            </>
          ) : null}
        </div>
      </div>

      {stageState.error ? (
        <div className="wf-stale-banner">
          <div className="wf-stale-banner-main">
            <AppIcon name="alert" className="wf-stale-banner-icon h-4 w-4" />
            <span>{stageState.error}</span>
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

      {/* Responsive Lookbook Art-Card Grid */}
      {visibleItems.length === 0 ? (
        <div className="wf-card">
          <div className="wf-empty" style={{ padding: '32px 20px' }}>
            <div className="wf-empty-title">当前分类暂无资产</div>
            <div className="wf-empty-desc">可以切换其他分类，或点击「手动新增资产」补充角色/场景/道具。</div>
          </div>
        </div>
      ) : (
        <div className={`wf-asset-grid${activeTab === 'location' ? ' is-locations' : ''}`}>
          {visibleItems.map((asset) => {
            const isGenerating = asset.status === 'queued' || asset.status === 'processing'
            const isFailed = asset.status === 'failed'
            const statusMeta = STATUS_LABELS[asset.status] || STATUS_LABELS.pending
            const displayUrl = toCanvasDisplayImageUrl(asset.imageUrl || asset.storageKey || null, 960)
            const isNeverGenerated = asset.status === 'pending' && !displayUrl && (!asset.versions || asset.versions.length === 0)
            const isExpanded = expandedAssetId === asset.id
            const promptLen = (asset.imagePrompt || '').length
            const promptOverLimit = promptLen > ASSET_PROMPT_LIMIT

            return (
              <article
                key={asset.id}
                className={`wf-asset-card is-${asset.kind}${isGenerating ? ' is-generating' : ''}${isFailed ? ' is-failed' : ''} ${aspectRatioClassFromValue(asset.aspectRatio)}`}
              >
                {/* Artwork Frame */}
                <div className="wf-asset-frame">
                  {displayUrl ? (
                    <MediaImage
                      src={displayUrl}
                      alt={asset.name}
                      className="wf-asset-img"
                    />
                  ) : isGenerating ? (
                    <div className="wf-shimmer w-full h-full flex flex-col items-center justify-center gap-2">
                      <span className="wf-spinner" />
                      <span className="text-[11.5px] font-semibold text-[var(--fos-text-2)]">正在生成定妆图…</span>
                    </div>
                  ) : (
                    <div className="wf-asset-placeholder">
                      <AppIcon
                        name={asset.kind === 'character' ? 'user' : asset.kind === 'location' ? 'image' : 'package'}
                        className="h-7 w-7 opacity-60"
                      />
                      <span>{isFailed ? (asset.errorMessage || '出图失败，可改词重试') : '尚未生成参考图'}</span>
                    </div>
                  )}

                  {/* Scrim Overlay */}
                  <div className={`wf-asset-overlay${!displayUrl && !isGenerating ? ' is-visible' : ''}`}>
                    <div className="wf-asset-overlay-top">
                      <span className="wf-badge is-stage">{KIND_LABELS[asset.kind]}</span>
                      <span className={`wf-badge ${statusMeta.tone}`}>
                        {isGenerating ? <span className="wf-spinner" style={{ width: 10, height: 10 }} /> : null}
                        <span>{statusMeta.label}</span>
                      </span>
                    </div>
                    {!isTrialView ? (
                      <div className="wf-asset-overlay-actions">
                        {displayUrl ? (
                          <button
                            type="button"
                            className="wf-asset-overlay-btn"
                            onClick={() => setPreviewImageUrl(asset.imageUrl || asset.storageKey || displayUrl)}
                          >
                            <AppIcon name="eye" className="h-3 w-3" />查看大图
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="wf-asset-overlay-btn"
                          disabled={isGenerating || generatingAssets}
                          onClick={() => setExpandedAssetId((cur) => (cur === asset.id ? null : asset.id))}
                        >
                          <AppIcon name="sparkles" className="h-3 w-3" />{isNeverGenerated ? '改词生成' : '改词重画'}
                        </button>
                        <button
                          type="button"
                          className="wf-asset-overlay-btn"
                          disabled={isGenerating}
                          onClick={() => setPickerState({
                            assetId: asset.id,
                            assetName: asset.name,
                            mode: 'image',
                            kind: asset.kind,
                          })}
                        >
                          <AppIcon name="folderOpen" className="h-3 w-3" />资产库替换
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>

                {/* Card Body */}
                <div className="wf-asset-body">
                  <div className="wf-asset-head">
                    <div className="wf-asset-name" title={asset.name}>{asset.name}</div>
                    <span className="wf-badge is-muted wf-num" title="资产生图比例">{asset.aspectRatio}</span>
                    {asset.versions && asset.versions.length > 0 ? (
                      <div className="wf-version-pills" aria-label="资产图片版本">
                        {asset.versions.map((ver, vIdx) => {
                          const verStatusMeta = STATUS_LABELS[ver.status] || STATUS_LABELS.pending
                          const verGenerating = ver.status === 'queued' || ver.status === 'processing'
                          const selectable = isVersionSelectable(ver.status)
                          return (
                            <button
                              key={`${asset.id}-v${ver.versionIndex}-${vIdx}`}
                              type="button"
                              className={`wf-version-pill${asset.selectedVersionIndex === vIdx ? ' is-active' : ''}${ver.status === 'failed' ? ' is-failed' : ''}${!selectable ? ' is-disabled' : ''}`}
                              disabled={isTrialView || !selectable}
                              title={`${selectable ? `切换到版本 v${ver.versionIndex}` : `版本 v${ver.versionIndex} 尚不可选`}（${verStatusMeta.label}）`}
                              onClick={() => void handleSafeBindAssetMaterial({ assetItemId: asset.id, selectVersionIndex: vIdx })}
                            >
                              {verGenerating ? (
                                <span className="wf-spinner" style={{ width: 8, height: 8 }} />
                              ) : (
                                <span className={`wf-version-dot is-${ver.status}`} aria-hidden="true" />
                              )}
                              <span>v{ver.versionIndex}</span>
                            </button>
                          )
                        })}
                      </div>
                    ) : null}
                  </div>

                  <div className="wf-asset-desc" title={asset.description}>
                    {asset.roleOrUsage ? `[${asset.roleOrUsage}] ` : ''}{asset.description}
                  </div>

                  {/* Character Voice Binding Row */}
                  {asset.kind === 'character' ? (
                    <div className="wf-asset-voice-row">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <AppIcon name="audioWave" className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">
                          {asset.voiceMaterialTitle || '未绑定角色音色'}
                        </span>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {asset.voiceMaterialUrl ? (
                          <button
                            type="button"
                            className="wf-btn wf-btn-ghost wf-btn-xs"
                            title="试听绑定音色"
                            onClick={() => toggleVoicePreview(asset)}
                          >
                            <AppIcon name={playingVoiceAssetId === asset.id ? 'pause' : 'play'} className="h-3 w-3" />
                          </button>
                        ) : null}
                        {!isTrialView ? (
                          <>
                            <button
                              type="button"
                              className="wf-btn wf-btn-subtle wf-btn-xs"
                              onClick={() => setPickerState({
                                assetId: asset.id,
                                assetName: asset.name,
                                mode: 'audio',
                                kind: asset.kind,
                              })}
                            >
                              {asset.voiceMaterialId ? '换音色' : '绑定音色'}
                            </button>
                            {asset.voiceMaterialId ? (
                              <button
                                type="button"
                                className="wf-btn wf-btn-ghost wf-btn-xs"
                                aria-label="解绑音色"
                                onClick={() => void handleSafeBindAssetMaterial({ assetItemId: asset.id, clearVoice: true })}
                              >
                                <AppIcon name="close" className="h-3 w-3" />
                              </button>
                            ) : null}
                          </>
                        ) : null}
                      </div>
                    </div>
                  ) : null}

                  {/* Micro Toolbar */}
                  <div className="flex flex-wrap items-center justify-between gap-1.5 pt-1 border-t border-[var(--fos-border-soft)]">
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        className="wf-btn wf-btn-ghost wf-btn-xs"
                        onClick={() => setExpandedAssetId((cur) => (cur === asset.id ? null : asset.id))}
                      >
                        <AppIcon name={isExpanded ? 'chevronUp' : 'edit'} className="h-3 w-3" />
                        <span>{isExpanded ? '收起提示词' : '提示词'}</span>
                      </button>
                      {!isTrialView ? (
                        <button
                          type="button"
                          className="wf-btn wf-btn-ghost wf-btn-xs"
                          disabled={isGenerating || generatingAssets}
                          onClick={() => void handleSaveAndRegenerateSingle(asset.id)}
                        >
                          <AppIcon name={isNeverGenerated ? 'sparkles' : 'refresh'} className="h-3 w-3" />
                          <span>{isNeverGenerated ? '生成此图' : '重画'}</span>
                        </button>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-1">
                      {canManageSkills && onQuoteSnippet ? (
                        <button
                          type="button"
                          className="wf-btn wf-btn-ghost wf-btn-xs"
                          title="引用此资产提示词到 Skill 调优"
                          onClick={() => onQuoteSnippet({
                            label: `S3 ${KIND_LABELS[asset.kind]} · ${asset.name}`,
                            text: `${asset.name}（${asset.roleOrUsage}）\n描述：${asset.description}\n生图提示词：${asset.imagePrompt}`,
                          })}
                        >
                          <AppIcon name="sparkles" className="h-3 w-3" />调优
                        </button>
                      ) : null}
                      {!isTrialView ? (
                        <button
                          type="button"
                          className="wf-btn wf-btn-ghost wf-btn-xs"
                          aria-label={`移除资产 ${asset.name}`}
                          onClick={() => void removeAssetItem(asset)}
                        >
                          <AppIcon name="trash" className="h-3 w-3" />
                        </button>
                      ) : null}
                    </div>
                  </div>

                  {/* Expandable Inline Prompt Editor */}
                  {isExpanded ? (
                    <div className="flex flex-col gap-2 pt-2 border-t border-[var(--fos-border-soft)]">
                      <div className="wf-field">
                        <label className="wf-label">资产名称</label>
                        <input
                          className="wf-input wf-input-sm"
                          value={asset.name}
                          readOnly={isTrialView}
                          onChange={(e) => updateAssetItem(asset.id, { name: e.target.value })}
                        />
                      </div>
                      <div className="wf-field">
                        <label className="wf-label">外观与角色设定</label>
                        <textarea
                          className="wf-textarea"
                          rows={2}
                          value={asset.description}
                          readOnly={isTrialView}
                          onChange={(e) => updateAssetItem(asset.id, { description: e.target.value })}
                        />
                      </div>
                      <div className="wf-field">
                        <div className="flex items-center justify-between gap-2">
                          <label className="wf-label" style={{ marginBottom: 0 }}>生图提示词</label>
                          <span className={`wf-num text-[10.5px] font-semibold ${promptOverLimit ? 'text-[var(--fos-danger-text)]' : 'text-[var(--fos-text-4)]'}`}>
                            {promptLen} / {ASSET_PROMPT_LIMIT}
                          </span>
                        </div>
                        <textarea
                          className="wf-textarea"
                          rows={4}
                          value={asset.imagePrompt}
                          readOnly={isTrialView}
                          onChange={(e) => updateAssetItem(asset.id, { imagePrompt: e.target.value })}
                        />
                        {promptOverLimit && !isTrialView ? (
                          <div className="flex items-center justify-between gap-2">
                            <span className="wf-field-hint">超出 900 字安全上限，生成时会自动裁剪</span>
                            <button
                              type="button"
                              className="wf-btn wf-btn-warning wf-btn-xs"
                              onClick={() => updateAssetItem(asset.id, {
                                imagePrompt: clampImagePrompt(asset.imagePrompt, ASSET_PROMPT_LIMIT),
                              })}
                            >
                              一键裁剪
                            </button>
                          </div>
                        ) : null}
                      </div>
                      {!isTrialView ? (
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            className="wf-btn wf-btn-stage wf-btn-xs"
                            disabled={isGenerating || generatingAssets}
                            onClick={() => void handleSaveAndRegenerateSingle(asset.id)}
                          >
                            <AppIcon name="sparkles" className="h-3 w-3" />{isNeverGenerated ? '保存并生成此卡' : '保存并重画此卡'}
                          </button>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </article>
            )
          })}
        </div>
      )}

      {/* Fullscreen Image Preview (Portalled via ViewportDialogLayer to escape .fos-app zoom) */}
      {previewImageUrl ? (
        <ViewportDialogLayer>
          <ImagePreviewModal imageUrl={previewImageUrl} onClose={() => setPreviewImageUrl(null)} />
        </ViewportDialogLayer>
      ) : null}

      {/* Material Picker for Image Replacement or Character Voice Binding */}
      {pickerState ? (
        <MaterialPickerDialog
          projectId={projectId}
          type={pickerState.mode}
          assetCategory={pickerState.mode === 'image' ? toMaterialAssetCategory(pickerState.kind) : undefined}
          title={
            pickerState.mode === 'image'
              ? `替换「${pickerState.assetName}」参考图`
              : `为角色「${pickerState.assetName}」绑定音色`
          }
          onSelect={(mat) => void handleMaterialSelected(mat)}
          onClose={() => setPickerState(null)}
        />
      ) : null}

      {/* Manual Add Asset Modal (Portalled via ViewportDialogLayer) */}
      {showAddModal ? (
        <ViewportDialogLayer>
          <div
            className="wf-modal-backdrop"
            role="dialog"
            aria-modal="true"
            aria-label="手动新增视觉资产"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) setShowAddModal(false)
            }}
          >
            <div className="wf-modal is-sm">
              <div className="wf-modal-head">
                <div className="wf-modal-title">
                  <AppIcon name="plus" className="h-4 w-4" />
                  <span>手动新增视觉资产</span>
                </div>
                <button
                  type="button"
                  className="wf-btn wf-btn-ghost wf-btn-icon wf-btn-sm"
                  aria-label="关闭"
                  onClick={() => setShowAddModal(false)}
                >
                  <AppIcon name="close" className="h-4 w-4" />
                </button>
              </div>
              <div className="wf-modal-body">
                <div className="wf-field">
                  <label className="wf-label">资产类型</label>
                  <div className="wf-param-pills">
                    {(['character', 'location', 'prop'] as const).map((k) => (
                      <button
                        key={k}
                        type="button"
                        className={`wf-param-pill${newAssetKind === k ? ' is-active' : ''}`}
                        onClick={() => setNewAssetKind(k)}
                      >
                        {KIND_LABELS[k]}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="wf-field-row">
                  <div className="wf-field">
                    <label className="wf-label">资产名称（将在分镜中以 @名称 引用）</label>
                    <input
                      className="wf-input"
                      value={newAssetName}
                      placeholder="例：林晚 / 赛博雨夜天台 / 翡翠吊坠"
                      onChange={(e) => setNewAssetName(e.target.value)}
                    />
                  </div>
                  <div className="wf-field">
                    <label className="wf-label">定位 / 用途</label>
                    <input
                      className="wf-input"
                      value={newAssetRole}
                      placeholder="例：女主 / 核心反转道具"
                      onChange={(e) => setNewAssetRole(e.target.value)}
                    />
                  </div>
                </div>
                <div className="wf-field">
                  <label className="wf-label">设定描述</label>
                  <textarea
                    className="wf-textarea"
                    rows={2}
                    value={newAssetDesc}
                    placeholder="外貌服装、材质纹理或环境氛围…"
                    onChange={(e) => setNewAssetDesc(e.target.value)}
                  />
                </div>
                <div className="wf-field">
                  <div className="flex items-center justify-between gap-2">
                    <label className="wf-label" style={{ marginBottom: 0 }}>生图提示词（可选，留空自动拼接画风）</label>
                    <span className="wf-num text-[11px] text-[var(--fos-text-4)]">
                      {newAssetPrompt.length} / {ASSET_PROMPT_LIMIT}
                    </span>
                  </div>
                  <textarea
                    className="wf-textarea"
                    rows={3}
                    value={newAssetPrompt}
                    placeholder="电影写实光影，角色全身定妆照，纯色背景…"
                    onChange={(e) => setNewAssetPrompt(e.target.value)}
                  />
                </div>
              </div>
              <div className="wf-modal-foot">
                <button type="button" className="wf-btn wf-btn-ghost" onClick={() => setShowAddModal(false)}>
                  取消
                </button>
                <button type="button" className="wf-btn wf-btn-primary" onClick={() => void handleCreateManualAsset()}>
                  <AppIcon name="check" className="h-3.5 w-3.5" />添加到资产清单
                </button>
              </div>
            </div>
          </div>
        </ViewportDialogLayer>
      ) : null}
    </div>
  )
})
