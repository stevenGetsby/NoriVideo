'use client'

import { useEffect, useMemo, useState, type RefObject } from 'react'
import { AppIcon } from '@/components/ui/icons'
import { ViewportPopover } from '@/components/ui/viewport-popover'
import type {
  ImageQualityLevel,
  VideoAspectRatio,
  VideoInputMode,
  WorkflowModelConfig,
} from '@/lib/batch-workflow/types'
import { normalizeVideoDraftForModel } from './model-config-normalize'

export type ModelSlotKind = 'text' | 'image' | 'video'

export interface GenerationConfigCapabilityOptions {
  resolution?: ReadonlyArray<string | number | boolean>
  resolutionOptions?: ReadonlyArray<string | number | boolean>
  quality?: ReadonlyArray<string | number | boolean>
  qualityOptions?: ReadonlyArray<string | number | boolean>
  aspectRatio?: ReadonlyArray<string | number | boolean>
  aspectRatioOptions?: ReadonlyArray<string | number | boolean>
  duration?: ReadonlyArray<string | number | boolean>
  durationOptions?: ReadonlyArray<string | number | boolean>
  [key: string]: ReadonlyArray<string | number | boolean> | undefined
}

export interface GenerationConfigOption {
  modelKey: string
  name: string
  label?: string
  description?: string | null
  available?: boolean
  configured?: boolean
  unavailableReason?: string | null
  runtimeModelKey?: string | null
  healthStatus?: string | null
  healthMessage?: string | null
  healthCheckedAt?: string | null
  options?: GenerationConfigCapabilityOptions | null
  firstLastFrame?: boolean
  supportGenerateAudio?: boolean
  supportsInpaint?: boolean
  inputSchema?: Record<string, unknown> | null
  raw?: {
    modelKey?: string
    name?: string
    available?: boolean
    configured?: boolean
    unavailableReason?: string | null
    runtimeModelKey?: string | null
    healthStatus?: string | null
    healthMessage?: string | null
    options?: GenerationConfigCapabilityOptions | null
    firstLastFrame?: boolean
    supportGenerateAudio?: boolean
    supportsInpaint?: boolean
    inputSchema?: Record<string, unknown> | null
    [key: string]: unknown
  } | null
}

export interface ModelConfigPopoverProps {
  kind: ModelSlotKind
  anchorRef: RefObject<HTMLElement | null>
  open: boolean
  onClose: () => void
  modelConfig: WorkflowModelConfig
  models: GenerationConfigOption[]
  saving?: boolean
  onApply: (patch: Partial<WorkflowModelConfig>) => Promise<void> | void
}

const SLOT_TITLES: Record<ModelSlotKind, { title: string; icon: 'brain' | 'image' | 'video'; sub: string }> = {
  text: {
    title: '文本推理模型',
    icon: 'brain',
    sub: '驱动剧本洗稿、资产拆解、分镜与 Skill 调优',
  },
  image: {
    title: '资产出图模型',
    icon: 'image',
    sub: '驱动 S3 角色、场景、道具定妆图生成',
  },
  video: {
    title: '分镜视频模型',
    icon: 'video',
    sub: '驱动 S4 能力约束与 S5 批量分镜视频出片',
  },
}

const TEXT_CREATIVITY_PRESETS: ReadonlyArray<{ value: number; label: string; hint: string }> = [
  { value: 0.3, label: '严谨 0.3', hint: '更贴合原剧本结构与约束' },
  { value: 0.7, label: '均衡 0.7', hint: '创意改编与稳定输出平衡' },
  { value: 1.0, label: '发散 1.0', hint: '高张力反转与强脑洞表达' },
]

const IMAGE_QUALITY_LABELS: Record<ImageQualityLevel, string> = {
  low: '低',
  medium: '中',
  high: '高',
}

const IMAGE_RESOLUTION_LABELS: Record<string, string> = {
  auto: '自动',
  '1K': '1K',
  '2K': '2K',
  '4K': '4K',
}

const BASE_VIDEO_RATIOS: readonly string[] = ['9:16', '16:9', '3:4', '4:3', '1:1', '21:9']

const VIDEO_RATIO_LABELS: Record<string, string> = {
  '9:16': '9:16',
  '16:9': '16:9',
  '3:4': '3:4',
  '4:3': '4:3',
  '1:1': '1:1',
  '21:9': '21:9',
  adaptive: '自适应',
}

const VIDEO_INPUT_MODE_OPTIONS: ReadonlyArray<{
  value: VideoInputMode
  label: string
  hint: string
}> = [
  { value: 'text', label: '全能参考', hint: '支持 @资产 多图与音频参考' },
  { value: 'image', label: '图生视频', hint: '以单张参考图作为首帧生成' },
  { value: 'firstlastframe', label: '首尾帧', hint: '以首帧与尾帧控制运镜起止' },
]

function getOptionMeta(model?: GenerationConfigOption | null) {
  if (!model) {
    return {
      options: null as GenerationConfigCapabilityOptions | null,
      firstLastFrame: false,
      supportGenerateAudio: false,
      runtimeModelKey: null as string | null,
      available: true,
      configured: true,
      healthStatus: null as string | null,
      healthMessage: null as string | null,
      unavailableReason: null as string | null,
    }
  }
  const raw = model.raw ?? null
  const options = (raw?.options ?? model.options ?? null) as GenerationConfigCapabilityOptions | null
  const generationModes = readStringOptions(options, ['generationModeOptions', 'generationMode'])
  const rawFirstLast = typeof raw?.firstLastFrame === 'boolean'
    ? raw.firstLastFrame
    : typeof model.firstLastFrame === 'boolean'
      ? model.firstLastFrame
      : false
  const firstLastFrame = rawFirstLast && (generationModes.length === 0 || generationModes.includes('firstlastframe'))
  const supportGenerateAudio = typeof raw?.supportGenerateAudio === 'boolean'
    ? raw.supportGenerateAudio
    : typeof model.supportGenerateAudio === 'boolean'
      ? model.supportGenerateAudio
      : false
  const runtimeModelKey = (typeof raw?.runtimeModelKey === 'string' && raw.runtimeModelKey.trim())
    ? raw.runtimeModelKey.trim()
    : (typeof model.runtimeModelKey === 'string' && model.runtimeModelKey.trim())
      ? model.runtimeModelKey.trim()
      : null
  const available = raw?.available !== false && model.available !== false
  const configured = raw?.configured !== false && model.configured !== false
  const healthStatus = (raw?.healthStatus ?? model.healthStatus ?? null) as string | null
  const healthMessage = (raw?.healthMessage ?? model.healthMessage ?? null) as string | null
  const unavailableReason = (raw?.unavailableReason ?? model.unavailableReason ?? null) as string | null
  return {
    options,
    firstLastFrame,
    supportGenerateAudio,
    runtimeModelKey,
    available,
    configured,
    healthStatus,
    healthMessage,
    unavailableReason,
  }
}

function readStringOptions(
  options: GenerationConfigCapabilityOptions | null,
  keys: readonly string[],
): string[] {
  if (!options) return []
  for (const key of keys) {
    const raw = options[key]
    if (Array.isArray(raw) && raw.length > 0) {
      return Array.from(new Set(raw.map((entry) => String(entry).trim()).filter(Boolean)))
    }
  }
  return []
}

function readNumericOptions(
  options: GenerationConfigCapabilityOptions | null,
  keys: readonly string[],
): number[] {
  if (!options) return []
  for (const key of keys) {
    const raw = options[key]
    if (Array.isArray(raw) && raw.length > 0) {
      const nums = Array.from(
        new Set(raw.map((entry) => Number(entry)).filter((n) => Number.isFinite(n) && n > 0)),
      ).sort((a, b) => a - b)
      if (nums.length > 0) return nums
    }
  }
  return []
}

function isSeedance25Model(model?: GenerationConfigOption | null): boolean {
  if (!model) return false
  const meta = getOptionMeta(model)
  const hay = `${model.modelKey} ${model.name} ${model.label || ''} ${meta.runtimeModelKey || ''}`.toLowerCase()
  return (
    hay.includes('norivideo2.5')
    || hay.includes('seedance-2-5')
    || hay.includes('seedance-2.5')
    || hay.includes('seedance2.5')
    || hay.includes('seedance 2.5')
    || readStringOptions(meta.options, ['aspectRatioOptions', 'aspectRatio']).includes('adaptive')
  )
}

function modelDisplayName(model: GenerationConfigOption): string {
  return (model.label || model.name || model.modelKey).trim()
}

export function ModelConfigPopover({
  kind,
  anchorRef,
  open,
  onClose,
  modelConfig,
  models,
  saving = false,
  onApply,
}: ModelConfigPopoverProps) {
  const [search, setSearch] = useState('')
  const [draft, setDraft] = useState<WorkflowModelConfig>(modelConfig)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setDraft(modelConfig)
    setSearch('')
    setError(null)
    // Hydrate only when the editor opens; server polling must not reset local edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const selectedModelKey = kind === 'text'
    ? draft.textModelKey
    : kind === 'image'
      ? draft.imageModelKey
      : draft.videoModelKey

  const selectedModel = useMemo(
    () => models.find((m) => m.modelKey === selectedModelKey) || null,
    [models, selectedModelKey],
  )
  const selectedMeta = useMemo(() => getOptionMeta(selectedModel), [selectedModel])

  const filteredModels = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return models
    return models.filter((m) => {
      const meta = getOptionMeta(m)
      return (
        modelDisplayName(m).toLowerCase().includes(q)
        || m.modelKey.toLowerCase().includes(q)
        || (meta.runtimeModelKey || '').toLowerCase().includes(q)
      )
    })
  }, [models, search])

  // Capability options derived from selected model
  const imageResolutionOptions = useMemo(() => {
    const fromModel = readStringOptions(selectedMeta.options, ['resolutionOptions', 'resolution'])
    if (fromModel.length > 0) return fromModel
    return ['auto', '1K', '2K']
  }, [selectedMeta.options])

  const imageQualityOptions = useMemo((): ImageQualityLevel[] => {
    const fromModel = readStringOptions(selectedMeta.options, ['qualityOptions', 'quality'])
      .map((item) => item.toLowerCase())
      .filter((item): item is ImageQualityLevel => item === 'low' || item === 'medium' || item === 'high')
    if (fromModel.length > 0) return fromModel
    // Show quality pills when options metadata is absent or explicitly includes quality
    if (!selectedMeta.options || Object.keys(selectedMeta.options).length === 0) {
      return ['low', 'medium', 'high']
    }
    return []
  }, [selectedMeta.options])

  const videoAspectRatioOptions = useMemo(() => {
    const fromModel = readStringOptions(selectedMeta.options, ['aspectRatioOptions', 'aspectRatio'])
    const base = fromModel.length > 0
      ? Array.from(new Set(fromModel))
      : [...BASE_VIDEO_RATIOS]
    if (isSeedance25Model(selectedModel) && !base.includes('adaptive')) {
      base.push('adaptive')
    }
    return base
  }, [selectedMeta.options, selectedModel])

  const videoResolutionOptions = useMemo(() => {
    const fromModel = readStringOptions(selectedMeta.options, ['resolutionOptions', 'resolution'])
    if (fromModel.length > 0) return fromModel
    return ['480p', '720p', '1080p']
  }, [selectedMeta.options])

  const videoDurationConfig = useMemo(() => {
    const fromModel = readNumericOptions(selectedMeta.options, ['durationOptions', 'duration'])
    if (fromModel.length > 0) {
      const min = fromModel[0]
      const max = fromModel[fromModel.length - 1]
      const quick = fromModel.length <= 7
        ? fromModel
        : Array.from(new Set([min, 5, 8, 10, 15, max].filter((v) => v >= min && v <= max))).sort((a, b) => a - b)
      return { min, max, discrete: fromModel, quick }
    }
    return {
      min: 4,
      max: 15,
      discrete: [4, 5, 6, 8, 10, 12, 15],
      quick: [4, 5, 8, 10, 15],
    }
  }, [selectedMeta.options])

  const handleSelectModel = (option: GenerationConfigOption) => {
    const meta = getOptionMeta(option)
    if (!meta.available) return
    setDraft((prev) => {
      if (kind === 'text') {
        return { ...prev, textModelKey: option.modelKey }
      }
      if (kind === 'image') {
        const nextResList = readStringOptions(meta.options, ['resolutionOptions', 'resolution'])
        const nextResolution = nextResList.length > 0 && !nextResList.includes(prev.imageResolution)
          ? (nextResList.includes('2K') ? '2K' : nextResList[0])
          : prev.imageResolution
        return {
          ...prev,
          imageModelKey: option.modelKey,
          imageResolution: nextResolution,
          imageQuality: (() => {
            const supported = readStringOptions(meta.options, ['qualityOptions', 'quality'])
              .filter((value): value is ImageQualityLevel => value === 'low' || value === 'medium' || value === 'high')
            return supported.length === 0 || supported.includes(prev.imageQuality) ? prev.imageQuality : supported[0]
          })(),
        }
      }
      const nextResList = readStringOptions(meta.options, ['resolutionOptions', 'resolution'])
      const nextRatios = readStringOptions(meta.options, ['aspectRatioOptions', 'aspectRatio'])
      const nextDurations = readNumericOptions(meta.options, ['durationOptions', 'duration'])
      return {
        ...prev,
        videoModelKey: option.modelKey,
        ...normalizeVideoDraftForModel(prev, {
          resolutionOptions: nextResList,
          aspectRatioOptions: nextRatios,
          durationOptions: nextDurations,
          firstLastFrame: meta.firstLastFrame,
          supportGenerateAudio: meta.supportGenerateAudio,
        }),
      }
    })
  }

  const handleApply = async () => {
    if (saving || submitting) return
    const patch: Partial<WorkflowModelConfig> = kind === 'text'
      ? {
          textModelKey: draft.textModelKey,
          textCreativity: draft.textCreativity,
        }
      : kind === 'image'
        ? {
            imageModelKey: draft.imageModelKey,
            imageResolution: draft.imageResolution,
            imageQuality: draft.imageQuality,
          }
        : {
            videoModelKey: draft.videoModelKey,
            videoAspectRatio: draft.videoAspectRatio,
            videoResolution: draft.videoResolution,
            videoDurationSeconds: draft.videoDurationSeconds,
            videoGenerateAudio: draft.videoGenerateAudio,
            videoInputMode: selectedMeta.firstLastFrame || draft.videoInputMode !== 'firstlastframe'
              ? draft.videoInputMode
              : 'image',
          }
    setSubmitting(true)
    setError(null)
    try {
      await onApply(patch)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存模型配置失败，请重试。')
    } finally {
      setSubmitting(false)
    }
  }

  if (!open) return null

  const slotInfo = SLOT_TITLES[kind]
  const busy = saving || submitting

  return (
    <ViewportPopover
      anchorRef={anchorRef}
      onClose={onClose}
      lockAnchorWhileOpen
      preferredSide="below"
      width={kind === 'video' ? 428 : 372}
      maxHeight={560}
      className="wf-popover"
      role="dialog"
      aria-label={slotInfo.title}
    >
      <div className="wf-popover-head">
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
          <AppIcon name={slotInfo.icon} className="h-3.5 w-3.5" />
          <span>{slotInfo.title}</span>
          <span className="wf-badge is-muted wf-num">{models.length}</span>
        </span>
        <button
          type="button"
          className="wf-btn wf-btn-icon wf-btn-xs wf-btn-ghost"
          onClick={onClose}
          aria-label="关闭模型配置"
        >
          <AppIcon name="close" className="h-3.5 w-3.5" />
        </button>
      </div>

      {models.length > 6 ? (
        <div className="wf-popover-search">
          <input
            className="wf-input wf-input-sm"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜索模型名称…"
            aria-label="搜索模型"
          />
        </div>
      ) : null}

      <div className="wf-popover-body" style={{ maxHeight: 224 }}>
        <div className="wf-popover-section">选择默认模型 · {slotInfo.sub}</div>
        {filteredModels.length === 0 ? (
          <div className="wf-dock-readonly" style={{ margin: '4px 6px' }}>
            暂无可选模型，请联系管理员检查平台模型通道配置。
          </div>
        ) : (
          filteredModels.map((option) => {
            const meta = getOptionMeta(option)
            const isSelected = option.modelKey === selectedModelKey
            const disabled = !meta.available
            const isDegraded = meta.available && (meta.healthStatus === 'unhealthy' || meta.healthStatus === 'degraded')
            return (
              <button
                key={option.modelKey}
                type="button"
                disabled={disabled}
                className={`wf-popover-item${isSelected ? ' is-active' : ''}`}
                style={disabled ? { opacity: 0.52, cursor: 'not-allowed' } : undefined}
                title={disabled ? (meta.unavailableReason || meta.healthMessage || '当前模型不可用') : undefined}
                onClick={() => handleSelectModel(option)}
              >
                <div style={{ minWidth: 0, flex: '1 1 auto' }}>
                  <div className="wf-popover-item-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {modelDisplayName(option)}
                    </span>
                    {!meta.available ? (
                      <span className="wf-badge is-danger">
                        {!meta.configured ? '未配置' : '不可用'}
                      </span>
                    ) : isDegraded ? (
                      <span className="wf-badge is-warning">波动</span>
                    ) : null}
                  </div>
                  {meta.runtimeModelKey ? (
                    <div className="wf-popover-item-desc wf-mono" style={{ fontSize: 10.5 }}>
                      {meta.runtimeModelKey}
                    </div>
                  ) : null}
                  {!meta.available && (meta.unavailableReason || meta.healthMessage) ? (
                    <div className="wf-popover-item-desc" style={{ color: 'var(--fos-danger-text)' }}>
                      {meta.unavailableReason || meta.healthMessage}
                    </div>
                  ) : null}
                </div>
                {isSelected ? (
                  <AppIcon name="check" className="h-3.5 w-3.5 shrink-0" style={{ color: 'var(--fos-primary-text)', marginTop: 2 }} />
                ) : null}
              </button>
            )
          })
        )}
      </div>

      {/* Bottom Capability Pills */}
      {kind === 'text' ? (
        <div className="wf-cap-section">
          <div className="wf-dock-section-title">
            <span>创造力 / 采样温度</span>
            <span className="wf-badge is-accent wf-num">{draft.textCreativity.toFixed(1)}</span>
          </div>
          <div className="wf-cap-grid" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
            {TEXT_CREATIVITY_PRESETS.map((preset) => {
              const active = Math.abs(draft.textCreativity - preset.value) < 0.16
              return (
                <button
                  key={preset.value}
                  type="button"
                  className={`wf-cap-chip${active ? ' is-active' : ''}`}
                  title={preset.hint}
                  onClick={() => setDraft((prev) => ({ ...prev, textCreativity: preset.value }))}
                >
                  {preset.label}
                </button>
              )
            })}
          </div>
          <div className="wf-field-hint">
            {TEXT_CREATIVITY_PRESETS.find((p) => Math.abs(draft.textCreativity - p.value) < 0.16)?.hint
              || '影响洗稿、资产拆解与分镜的想象力幅度'}
          </div>
        </div>
      ) : null}

      {kind === 'image' ? (
        <div className="wf-cap-section">
          <div className="wf-dock-section-title">
            <span>出图清晰度</span>
            <span className="wf-badge is-muted wf-num">
              {IMAGE_RESOLUTION_LABELS[draft.imageResolution] || draft.imageResolution}
            </span>
          </div>
          <div className="wf-cap-grid" style={{ gridTemplateColumns: `repeat(${Math.min(4, Math.max(3, imageResolutionOptions.length))}, minmax(0, 1fr))` }}>
            {imageResolutionOptions.map((res) => {
              const active = draft.imageResolution.toLowerCase() === res.toLowerCase()
              return (
                <button
                  key={res}
                  type="button"
                  className={`wf-cap-chip${active ? ' is-active' : ''}`}
                  onClick={() => setDraft((prev) => ({ ...prev, imageResolution: res }))}
                >
                  {IMAGE_RESOLUTION_LABELS[res] || res}
                </button>
              )
            })}
          </div>

          {imageQualityOptions.length > 0 ? (
            <>
              <div className="wf-dock-section-title" style={{ marginTop: 4 }}>
                <span>画面质量档位</span>
                <span className="wf-badge is-muted">{IMAGE_QUALITY_LABELS[draft.imageQuality]}</span>
              </div>
              <div className="wf-cap-grid" style={{ gridTemplateColumns: `repeat(${imageQualityOptions.length}, minmax(0, 1fr))` }}>
                {imageQualityOptions.map((quality) => {
                  const active = draft.imageQuality === quality
                  return (
                    <button
                      key={quality}
                      type="button"
                      className={`wf-cap-chip${active ? ' is-active' : ''}`}
                      onClick={() => setDraft((prev) => ({ ...prev, imageQuality: quality }))}
                    >
                      {IMAGE_QUALITY_LABELS[quality]}
                    </button>
                  )
                })}
              </div>
            </>
          ) : null}
        </div>
      ) : null}

      {kind === 'video' ? (
        <div className="wf-cap-section">
          {/* Aspect Ratio */}
          <div className="wf-dock-section-title">
            <span>画幅比例</span>
            <span className="wf-badge is-accent wf-num">
              {VIDEO_RATIO_LABELS[draft.videoAspectRatio] || draft.videoAspectRatio}
            </span>
          </div>
          <div className="wf-cap-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(52px, 1fr))' }}>
            {videoAspectRatioOptions.map((ratio) => {
              const active = String(draft.videoAspectRatio) === ratio
              return (
                <button
                  key={ratio}
                  type="button"
                  className={`wf-cap-chip${active ? ' is-active' : ''}`}
                  onClick={() => setDraft((prev) => ({ ...prev, videoAspectRatio: ratio as VideoAspectRatio }))}
                >
                  {VIDEO_RATIO_LABELS[ratio] || ratio}
                </button>
              )
            })}
          </div>

          {/* Resolution */}
          <div className="wf-dock-section-title" style={{ marginTop: 4 }}>
            <span>清晰度</span>
            <span className="wf-badge is-muted wf-num">{draft.videoResolution}</span>
          </div>
          <div className="wf-cap-grid" style={{ gridTemplateColumns: `repeat(${Math.min(4, Math.max(3, videoResolutionOptions.length))}, minmax(0, 1fr))` }}>
            {videoResolutionOptions.map((res) => {
              const active = draft.videoResolution.toLowerCase() === res.toLowerCase()
              return (
                <button
                  key={res}
                  type="button"
                  className={`wf-cap-chip${active ? ' is-active' : ''}`}
                  onClick={() => setDraft((prev) => ({ ...prev, videoResolution: res }))}
                >
                  {res}
                </button>
              )
            })}
          </div>

          {/* Default Duration */}
          <div className="wf-dock-section-title" style={{ marginTop: 4 }}>
            <span>默认单镜时长（{videoDurationConfig.min}–{videoDurationConfig.max}s）</span>
            <span className="wf-badge is-accent wf-num">{draft.videoDurationSeconds}s</span>
          </div>
          <div className="wf-cap-grid" style={{ gridTemplateColumns: `repeat(${Math.min(6, videoDurationConfig.quick.length)}, minmax(0, 1fr))` }}>
            {videoDurationConfig.quick.map((sec) => {
              const active = draft.videoDurationSeconds === sec
              return (
                <button
                  key={sec}
                  type="button"
                  className={`wf-cap-chip${active ? ' is-active' : ''}`}
                  onClick={() => setDraft((prev) => ({ ...prev, videoDurationSeconds: sec }))}
                >
                  {sec}s
                </button>
              )
            })}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input
              type="range"
              min={videoDurationConfig.min}
              max={videoDurationConfig.max}
              step={1}
              value={Math.max(videoDurationConfig.min, Math.min(videoDurationConfig.max, draft.videoDurationSeconds))}
              onChange={(event) => {
                const raw = Number(event.target.value)
                const snapped = videoDurationConfig.discrete.length > 0
                  ? videoDurationConfig.discrete.reduce((best, cand) => (
                      Math.abs(cand - raw) < Math.abs(best - raw) ? cand : best
                    ), videoDurationConfig.discrete[0])
                  : raw
                setDraft((prev) => ({ ...prev, videoDurationSeconds: snapped }))
              }}
              aria-label="默认单镜时长"
              style={{ flex: '1 1 auto', accentColor: 'var(--fos-primary)' }}
            />
            <span className="wf-num" style={{ fontSize: 11, color: 'var(--fos-text-3)', minWidth: 32, textAlign: 'right' }}>
              {draft.videoDurationSeconds}s
            </span>
          </div>

          {/* Generate Audio Switch */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 10,
              padding: '6px 0 2px',
            }}
          >
            <div>
              <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--fos-text-1)' }}>生成声音（原声对白 / 音效）</div>
              <div className="wf-field-hint">
                {selectedMeta.supportGenerateAudio
                  ? '开启后随画面同步生成角色人声与环境音效'
                  : '当前所选视频模型暂不支持同步生成声音'}
              </div>
            </div>
            <input
              type="checkbox"
              role="switch"
              className="wf-switch"
              checked={selectedMeta.supportGenerateAudio ? draft.videoGenerateAudio : false}
              disabled={!selectedMeta.supportGenerateAudio}
              onChange={(event) => setDraft((prev) => ({ ...prev, videoGenerateAudio: event.target.checked }))}
              aria-label="生成声音"
            />
          </div>

          {/* Default Input Mode */}
          <div className="wf-dock-section-title" style={{ marginTop: 2 }}>
            <span>默认参考输入模式</span>
            {!selectedMeta.firstLastFrame ? (
              <span className="wf-badge is-warning">不支持首尾帧</span>
            ) : null}
          </div>
          <div className="wf-cap-grid" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
            {VIDEO_INPUT_MODE_OPTIONS.map((mode) => {
              const disabled = mode.value === 'firstlastframe' && !selectedMeta.firstLastFrame
              const active = !disabled && draft.videoInputMode === mode.value
              return (
                <button
                  key={mode.value}
                  type="button"
                  disabled={disabled}
                  title={disabled ? '当前所选视频模型不支持首尾帧模式' : mode.hint}
                  className={`wf-cap-chip${active ? ' is-active' : ''}`}
                  style={disabled ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
                  onClick={() => {
                    if (!disabled) setDraft((prev) => ({ ...prev, videoInputMode: mode.value }))
                  }}
                >
                  {mode.label}
                </button>
              )
            })}
          </div>
        </div>
      ) : null}

      <div className="wf-popover-foot">
        {error ? <div role="alert" style={{ color: 'var(--fos-danger-text)', fontSize: 12, marginBottom: 8 }}>{error}</div> : null}
        <span className="wf-field-hint" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {selectedModel ? modelDisplayName(selectedModel) : selectedModelKey || '未选择'}
        </span>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          <button type="button" className="wf-btn wf-btn-sm wf-btn-ghost" disabled={busy} onClick={onClose}>
            取消
          </button>
          <button type="button" className="wf-btn wf-btn-sm wf-btn-primary" disabled={busy} onClick={() => void handleApply()}>
            {busy ? <span className="wf-spinner" /> : <AppIcon name="check" className="h-3.5 w-3.5" />}
            <span>{busy ? '应用中…' : '应用配置'}</span>
          </button>
        </div>
      </div>
    </ViewportPopover>
  )
}
