'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSession } from 'next-auth/react'
import { AppIcon, type AppIconName } from '@/components/ui/icons'
import { MediaImage } from '@/components/media/MediaImage'
import { apiFetch } from '@/lib/api-fetch'
import { buildCanvasGenerationMaterialReferences } from '@/lib/canvas/generation-reference-contract'
import { readApiErrorMessage } from '@/lib/api/read-error-message'
import { toDisplayImageUrl } from '@/lib/media/image-url'
import { FosMaterialLibrary } from './FosMaterialLibrary'
import { MaterialPickerDialog } from '../materials/MaterialPickerDialog'
import { MentionPromptEditor } from '../materials/MentionPromptEditor'
import type { FrameosMaterialItem } from '../materials/contracts'
import {
  FRAMEOS_ASSET_CATEGORY_LABELS,
  type FrameosAssetCategory,
} from '@/lib/frameos/material-category'
import {
  createToolboxDraftKey,
  readToolboxDraft,
  resolveToolboxGenerateAudio,
  writeToolboxDraft,
} from './toolbox-draft'
import {
  CANVAS_IMAGE_ASPECT_RATIOS,
  CANVAS_IMAGE_QUALITIES,
  CANVAS_IMAGE_RESOLUTIONS,
  CANVAS_VIDEO_RESOLUTIONS,
  canvasVideoAspectRatioOptions,
  isSeedance25VideoModelKey,
  resolveSupportedResolution,
  type CanvasImageQuality,
} from '@/lib/canvas/generator-options'
import {
  firstLastFrameInputSchema,
  readMediaDurationSeconds,
  resolveCanvasGenerationInputSchema,
  validateCanvasReferenceMedia,
  validateVideoReferenceMediaCombination,
  type CanvasGenerationInputSchema,
} from '@/lib/canvas/generation-input-schema'
import { appendToolboxTypedReference } from './toolbox-references'
import { useAccountBalance } from '@/hooks/common/useAccountBalance'

export type ToolTab = 'image' | 'video' | 'music' | 'material'
type ActiveGenerationTab = 'image' | 'video'

interface ProjectItem { id: string; name: string }
interface ModelItem {
  modelKey: string
  name: string
  provider: string
  description?: string | null
  tier?: 'mini' | 'fast' | 'standard' | 'pro'
  options: Record<string, Array<string | number | boolean>>
  firstLastFrame: boolean
  supportGenerateAudio: boolean
  inputSchema?: CanvasGenerationInputSchema
  configured?: boolean
  available?: boolean
  unavailableReason?: string | null
}
interface GenerationConfig {
  imageModels: ModelItem[]
  videoModels: ModelItem[]
  defaults: { imageModel: string | null; videoModel: string | null; aspectRatio: string | null; resolution: string | null }
}
interface ToolboxAsset {
  id: string
  projectId: string | null
  materialId: string | null
  type: 'image' | 'video'
  status: string
  resultUrl: string | null
  url: string | null
  errorMessage: string | null
  params?: Record<string, unknown> | null
  createdAt: string
  task?: { id: string; status: string; progress: number; errorCode: string | null; errorMessage: string | null } | null
}

const TABS: Array<{ key: ToolTab; label: string; icon: AppIconName }> = [
  { key: 'image', label: '图片生成', icon: 'imageLandscape' },
  { key: 'video', label: '视频生成', icon: 'videoWide' },
  { key: 'material', label: '我的素材', icon: 'folderOpen' },
]
const TOOLBOX_VIDEO_DURATIONS = Array.from({ length: 27 }, (_, index) => index + 4)

const MODEL_TIER_LABELS: Record<NonNullable<ModelItem['tier']>, string> = {
  mini: 'Mini',
  fast: 'Fast',
  standard: '标准',
  pro: 'Pro',
}

function modelSelectLabel(model: ModelItem) {
  return `${model.name} · ${MODEL_TIER_LABELS[model.tier || 'standard']}`
}

function resolutionLabel(value: string) {
  return value.toLowerCase() === '4k' ? '4K' : value
}

function SelectField({ label, value, options, onChange, loading = false }: { label: string; value: string; options: Array<{ value: string; label: string; disabled?: boolean }>; onChange: (value: string) => void; loading?: boolean }) {
  const hasSelectable = options.some((option) => !option.disabled)
  return <label className="block"><span className="mb-2 block text-[13px] font-medium text-white">{label}</span><select className="fos-input" disabled={loading || !hasSelectable} value={value} onChange={(event) => onChange(event.target.value)}>{!hasSelectable ? <option value="">{loading ? '正在读取模型…' : '暂无已配置模型'}</option> : null}{options.map((option) => <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>)}</select>{!loading && !hasSelectable ? <span className="mt-1.5 block text-[11px] leading-5 text-amber-300/80">请让平台管理员先在“服务配置 → 业务模型路由”中接入对应模型。</span> : null}</label>
}

function SegRow({ label, options, value, onChange, formatOption }: { label: string; options: string[]; value: string; onChange: (value: string) => void; formatOption?: (value: string) => string }) {
  return <div className="mt-4"><div className="mb-2 text-[13px] font-medium text-white">{label}</div><div className="fos-seg w-full">{options.map((option) => <button type="button" key={option} className={`fos-seg-opt flex-1${value === option ? ' active' : ''}`} onClick={() => onChange(option)}>{formatOption ? formatOption(option) : option}</button>)}</div></div>
}

function DurationSelect({ value, options, onChange }: { value: number; options: number[]; onChange: (value: number) => void }) {
  const minimum = options[0] ?? 4
  const maximum = options.at(-1) ?? minimum
  return (
    <label className="mt-4 block">
      <span className="mb-2 flex items-center justify-between text-[13px] font-medium text-white">
        <span>视频时长</span>
        <span className="text-[11px] font-normal text-[var(--fos-text-4)]">{minimum}–{maximum} 秒</span>
      </span>
      <div className="relative">
        <select
          aria-label="视频时长"
          className="fos-input h-10 appearance-none pr-12 text-[13px] font-semibold"
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
        >
          {options.map((duration) => <option key={duration} value={duration}>{duration}</option>)}
        </select>
        <span className="pointer-events-none absolute right-8 top-1/2 -translate-y-1/2 text-[12px] text-[var(--fos-text-3)]">秒</span>
        <AppIcon name="chevronDown" className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--fos-text-4)]" />
      </div>
    </label>
  )
}

function ReferenceStrip({ materials, onAdd, onRemove, label, limit, hint }: { materials: FrameosMaterialItem[]; onAdd: () => void; onRemove: (id: string) => void; label: string; limit: number; hint?: string }) {
  return (
    <div className="mt-4">
      <div className="mb-2 flex items-center justify-between"><span className="text-[13px] font-medium text-white">{label}</span><span className="text-[11px] text-[var(--fos-text-4)]">{materials.length}/{limit}</span></div>
      <div className="flex flex-wrap gap-2">
        {materials.map((material, index) => {
          const src = toDisplayImageUrl(material.url)
          return <div key={material.id} className="relative flex h-[72px] w-[72px] items-center justify-center overflow-hidden rounded-lg border border-[var(--fos-border-mid)] bg-black/30" title={`${index + 1}. ${material.title || '未命名素材'} · ${material.type}`}>{src && material.type === 'image' ? <MediaImage src={src} alt={material.title || ''} fill sizes="72px" style={{ objectFit: 'cover' }} /> : src && material.type === 'video' ? <video src={src} muted playsInline preload="metadata" className="pointer-events-none h-full w-full object-cover" /> : material.type === 'video' ? <AppIcon name="video" className="h-7 w-7 text-blue-200/55" /> : material.type === 'audio' ? <AppIcon name="audioWave" className="h-7 w-7 text-violet-200/55" /> : <AppIcon name="image" className="h-7 w-7 text-white/25" />}<span className="absolute left-1 top-1 rounded bg-black/70 px-1 text-[8px] text-white/70">{material.type === 'image' ? '图' : material.type === 'video' ? '视频' : material.type === 'audio' ? '音频' : '3D'}</span><span className="absolute bottom-1 left-1 max-w-[54px] truncate rounded bg-black/70 px-1 text-[9px] text-white">{index + 1}. {material.title}</span><button type="button" className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/75 text-white" onClick={() => onRemove(material.id)}><AppIcon name="close" className="h-3 w-3" /></button></div>
        })}
        <button type="button" onClick={onAdd} className="flex h-[72px] w-[72px] flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-[var(--fos-border-strong)] text-[var(--fos-text-4)] hover:border-[var(--fos-primary)] hover:text-white"><AppIcon name="plus" className="h-5 w-5" /><span className="text-[10px]">素材库/本地</span></button>
      </div>
      {hint ? <p className="mt-1.5 text-[10px] leading-4 text-[var(--fos-text-4)]">{hint}</p> : null}
    </div>
  )
}

function ResultPane({ type, history, loading, onRefresh, onOpenMaterial }: { type: ActiveGenerationTab; history: ToolboxAsset[]; loading: boolean; onRefresh: () => void; onOpenMaterial: (materialId: string) => void }) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = history.find((asset) => asset.id === selectedId) || history[0] || null
  useEffect(() => {
    if (history.length === 0) {
      setSelectedId(null)
      return
    }
    if (!selectedId || !history.some((asset) => asset.id === selectedId)) setSelectedId(history[0].id)
  }, [history, selectedId])
  const latestActive = history.find((asset) => asset.status === 'pending' || asset.status === 'processing' || asset.task?.status === 'queued' || asset.task?.status === 'processing')
  const selectedStatus = selected?.task?.status || selected?.status || ''
  const selectedFailureMessage = selected?.task?.errorMessage || selected?.errorMessage
  const selectedFailureCode = selected?.task?.errorCode
  const src = selectedStatus === 'ready' || selectedStatus === 'completed' ? toDisplayImageUrl(selected?.url) : null
  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-y-auto p-6">
      <div className="relative flex min-h-[390px] flex-1 items-center justify-center overflow-hidden rounded-[12px] border border-[var(--fos-border-mid)] bg-[var(--fos-bg-2)]">
        {src && type === 'image' ? <MediaImage src={src} alt="最近生成结果" fill sizes="900px" style={{ objectFit: 'contain' }} /> : null}
        {src && type === 'video' ? <video src={src} controls playsInline className="h-full max-h-[560px] w-full object-contain" /> : null}
        {!src ? <div className="max-w-[620px] px-8 text-center text-[var(--fos-text-4)]"><AppIcon name={type === 'image' ? 'imageLandscape' : 'videoWide'} className="mx-auto mb-3 h-16 w-16" /><div className="text-[14px]">{selectedStatus === 'failed' ? '本次生成失败' : latestActive ? `正在生成 ${latestActive.task?.progress || 0}%` : '设置参数后点击生成'}</div>{selectedStatus === 'failed' ? <div className="mt-3 break-words rounded-lg border border-red-400/20 bg-red-500/[.08] px-4 py-3 text-left text-[12px] leading-5 text-red-100"><div className="mb-1 font-bold text-red-200">失败原因{selectedFailureCode ? ` · ${selectedFailureCode}` : ''}</div><p>{selectedFailureMessage || '生成服务没有返回错误详情。请检查所选模型的服务状态、参考素材格式与账户余额后重试。'}</p>{selected?.task?.id ? <p className="mt-2 text-[10px] text-red-200/55">任务 ID：{selected.task.id}</p> : null}</div> : null}</div> : null}
      </div>
      <div className="mt-5 flex items-center justify-between gap-3"><div><span className="text-[14px] font-bold text-white">生成历史</span><span className="ml-2 text-[11px] text-[var(--fos-text-4)]">仅展示当前项目的工具箱任务</span></div><div className="flex items-center gap-2">{selected?.materialId && (selectedStatus === 'ready' || selectedStatus === 'completed') ? <button type="button" className="fos-btn fos-btn-soft fos-btn-sm" onClick={() => onOpenMaterial(selected.materialId!)}><AppIcon name="folderOpen" className="h-3.5 w-3.5" />在项目素材库查看</button> : null}<button type="button" className="fos-btn fos-btn-ghost fos-btn-sm" disabled={loading} onClick={onRefresh}><AppIcon name="refresh" className="h-3.5 w-3.5" />刷新</button></div></div>
      <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {history.slice(0, 12).map((asset) => {
          const resultSrc = toDisplayImageUrl(asset.url)
          const title = typeof asset.params?.title === 'string' ? asset.params.title : '未命名生成'
          const status = asset.task?.status || asset.status
          const failureMessage = asset.task?.errorMessage || asset.errorMessage
          return <button type="button" key={asset.id} aria-pressed={selected?.id === asset.id} onClick={() => setSelectedId(asset.id)} className={`overflow-hidden rounded-lg border bg-[var(--fos-bg-2)] text-left transition${selected?.id === asset.id ? ' border-blue-400/70 ring-1 ring-blue-400/25' : ' border-[var(--fos-border-soft)] hover:border-[var(--fos-border-strong)]'}`}><div className="relative flex aspect-video items-center justify-center overflow-hidden bg-black/35">{resultSrc && asset.type === 'image' ? <MediaImage src={resultSrc} alt={title} fill sizes="240px" style={{ objectFit: 'cover' }} /> : resultSrc && asset.type === 'video' ? <video src={resultSrc} muted playsInline preload="metadata" className="pointer-events-none h-full w-full object-cover" /> : <AppIcon name={asset.type === 'image' ? 'image' : 'video'} className="h-7 w-7 text-white/15" />}<span className="absolute right-1.5 top-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[9px] text-white">{status === 'completed' || status === 'ready' ? '完成' : status === 'failed' ? '失败' : `${asset.task?.progress || 0}%`}</span></div><div className="truncate px-2 pt-2 text-[11px] font-bold text-white" title={title}>{title}</div>{status === 'failed' ? <p className="line-clamp-3 px-2 pb-2 pt-1 text-[10px] leading-4 text-red-200/80" title={failureMessage || '生成服务未返回错误详情。'}>{failureMessage || '生成服务未返回错误详情。'}</p> : <div className="h-2" />}</button>
        })}
      </div>
    </main>
  )
}

export function FosToolbox({ initialTab }: { projectName?: string; initialTab?: ToolTab }) {
  const { data: session } = useSession()
  const { generationAllowed } = useAccountBalance()
  const [tab, setTab] = useState<ToolTab>(initialTab === 'music' ? 'image' : initialTab ?? 'image')
  const activeType: ActiveGenerationTab = tab === 'video' ? 'video' : 'image'
  const [projects, setProjects] = useState<ProjectItem[]>([])
  const [projectId, setProjectId] = useState('')
  const [config, setConfig] = useState<GenerationConfig | null>(null)
  const [configLoading, setConfigLoading] = useState(true)
  const [modelKey, setModelKey] = useState('')
  const [title, setTitle] = useState('')
  const [prompt, setPrompt] = useState('')
  const [ratio, setRatio] = useState('16:9')
  const [resolution, setResolution] = useState('')
  const [quality, setQuality] = useState<CanvasImageQuality>('high')
  const [count, setCount] = useState('1')
  const [inputMode, setInputMode] = useState<'text' | 'image' | 'firstlastframe'>('text')
  const [duration, setDuration] = useState(5)
  const [fps, setFps] = useState<number | null>(null)
  const [generateAudio, setGenerateAudio] = useState(true)
  const [assetCategory, setAssetCategory] = useState<FrameosAssetCategory>('other')
  const [references, setReferences] = useState<FrameosMaterialItem[]>([])
  const [pickerType, setPickerType] = useState<'image' | 'video' | 'audio' | null>(null)
  const [history, setHistory] = useState<ToolboxAsset[]>([])
  const [focusedMaterialId, setFocusedMaterialId] = useState<string | null>(null)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const hydratedDraftKeyRef = useRef('')
  const skipDraftWriteRef = useRef(false)
  const draftKey = useMemo(() => createToolboxDraftKey(
    session?.user?.id || session?.user?.name,
    projectId,
    activeType,
  ), [activeType, projectId, session?.user?.id, session?.user?.name])

  useEffect(() => {
    void apiFetch('/api/projects?page=1&pageSize=100').then(async (response) => response.ok ? await response.json() as { projects?: ProjectItem[] } : { projects: [] }).then((payload) => {
      const list = Array.isArray(payload.projects) ? payload.projects : []
      setProjects(list)
      setProjectId((current) => current || list[0]?.id || '')
    })
  }, [])

  useEffect(() => {
    if (!draftKey) return
    const draft = readToolboxDraft(window.localStorage, draftKey)
    hydratedDraftKeyRef.current = draftKey
    skipDraftWriteRef.current = true
    setTitle(draft?.title || '')
    setPrompt(draft?.prompt || '')
    setModelKey(draft?.modelKey || '')
    setRatio(draft?.ratio || '16:9')
    setResolution(draft?.resolution || '')
    setQuality(draft?.quality || 'high')
    setCount(draft?.count || '1')
    setInputMode(draft?.inputMode || 'text')
    setDuration(draft?.duration || 5)
    setFps(draft?.fps || null)
    setGenerateAudio(draft?.generateAudio ?? true)
    setAssetCategory(draft?.assetCategory || (activeType === 'video' ? 'shot' : 'other'))
    setReferences(draft?.references || [])
    setMessage(null)
    setError(null)
  }, [activeType, draftKey])

  useEffect(() => {
    setConfigLoading(true)
    setError(null)
    const endpoint = projectId
      ? `/api/frameos/generation-config?projectId=${encodeURIComponent(projectId)}`
      : '/api/frameos/generation-config'
    void apiFetch(endpoint).then(async (response) => {
      if (!response.ok) throw new Error(await readApiErrorMessage(response, '加载生成配置失败'))
      return await response.json() as GenerationConfig
    }).then((next) => {
      setConfig(next)
      const models = activeType === 'image' ? next.imageModels : next.videoModels
      const defaultKey = activeType === 'image' ? next.defaults.imageModel : next.defaults.videoModel
      const draft = draftKey ? readToolboxDraft(window.localStorage, draftKey) : null
      const key = models.find((model) => model.modelKey === draft?.modelKey && model.available !== false)?.modelKey
        || models.find((model) => model.modelKey === defaultKey && model.available !== false)?.modelKey
        || models.find((model) => model.available !== false)?.modelKey
        || ''
      setModelKey(key || '')
      setRatio(draft?.ratio || next.defaults.aspectRatio || '16:9')
    }).catch((loadError) => {
      setConfig(null)
      setModelKey('')
      setError(loadError instanceof Error ? loadError.message : '加载生成配置失败')
    }).finally(() => setConfigLoading(false))
  }, [activeType, draftKey, projectId])

  const currentModels = activeType === 'image' ? config?.imageModels || [] : config?.videoModels || []
  const currentModel = currentModels.find((model) => model.modelKey === modelKey)
  const videoAspectRatios = useMemo(
    () => canvasVideoAspectRatioOptions(modelKey, inputMode),
    [inputMode, modelKey],
  )
  const resolutionOptions = useMemo(() => {
    const configured = (currentModel?.options.resolution || []).map(String)
    const surface = activeType === 'image' ? CANVAS_IMAGE_RESOLUTIONS : CANVAS_VIDEO_RESOLUTIONS
    return configured.length > 0
      ? surface.filter((value) => configured.some((candidate) => candidate.toLowerCase() === value.toLowerCase()))
      : [...surface]
  }, [activeType, currentModel])
  const durationOptions = useMemo(
    () => (currentModel?.options.duration || []).map(Number).filter(Number.isFinite),
    [currentModel],
  )
  const fpsOptions = useMemo(
    () => (currentModel?.options.fps || []).map(Number).filter((value) => Number.isInteger(value) && value > 0),
    [currentModel],
  )
  const toolboxDurationOptions = useMemo(() => {
    if (durationOptions.length === 0) return TOOLBOX_VIDEO_DURATIONS
    const supported = new Set(durationOptions)
    return TOOLBOX_VIDEO_DURATIONS.filter((duration) => supported.has(duration))
  }, [durationOptions])
  const imageReferences = useMemo(() => references.filter((item) => item.type === 'image'), [references])
  const videoReferences = useMemo(() => references.filter((item) => item.type === 'video'), [references])
  const audioReferences = useMemo(() => references.filter((item) => item.type === 'audio'), [references])
  const referenceSchema = currentModel?.inputSchema || resolveCanvasGenerationInputSchema(activeType)
  const referenceLimits = inputMode === 'firstlastframe'
    ? { image: 2, video: 0, audio: 0 }
    : {
        image: referenceSchema.image.max,
        video: activeType === 'video' ? referenceSchema.video.max : 0,
        audio: activeType === 'video' ? referenceSchema.audio.max : 0,
      }
  const pickerLimit = pickerType ? referenceLimits[pickerType] : 0

  useEffect(() => {
    setResolution((current) => resolveSupportedResolution(current, config?.defaults.resolution, resolutionOptions))
    if (activeType === 'video' && toolboxDurationOptions.length > 0) setDuration((current) => toolboxDurationOptions.includes(current) ? current : toolboxDurationOptions[0])
    if (activeType === 'video') setFps((current) => fpsOptions.length > 0 ? current !== null && fpsOptions.includes(current) ? current : fpsOptions[0] : null)
    if (!currentModel?.firstLastFrame && inputMode === 'firstlastframe') setInputMode('text')
    if (activeType === 'video') {
      setRatio((current) => videoAspectRatios.includes(current as (typeof videoAspectRatios)[number])
        ? current
        : videoAspectRatios[0] || '16:9')
    }
    const draft = draftKey ? readToolboxDraft(window.localStorage, draftKey) : null
    setGenerateAudio(resolveToolboxGenerateAudio({
      type: activeType,
      modelKey,
      supportGenerateAudio: currentModel?.supportGenerateAudio === true,
      draft,
    }))
  }, [activeType, config?.defaults.resolution, currentModel, draftKey, fpsOptions, inputMode, modelKey, resolutionOptions, toolboxDurationOptions, videoAspectRatios])

  useEffect(() => {
    if (activeType !== 'video' || inputMode !== 'firstlastframe') return
    setReferences((current) => {
      const next = current.filter((item) => item.type === 'image').slice(0, 2)
      return next.length === current.length && next.every((item, index) => item.id === current[index]?.id)
        ? current
        : next
    })
  }, [activeType, inputMode])

  useEffect(() => {
    setAssetCategory((current) => activeType === 'video'
      ? current === 'other' || current === 'shot' ? current : 'shot'
      : current === 'shot' ? 'other' : current)
  }, [activeType])

  useEffect(() => {
    if (!draftKey || hydratedDraftKeyRef.current !== draftKey) return
    if (skipDraftWriteRef.current) {
      skipDraftWriteRef.current = false
      return
    }
    const timer = window.setTimeout(() => writeToolboxDraft(window.localStorage, draftKey, {
      version: 1,
      title,
      prompt,
      modelKey,
      ratio,
      resolution,
      quality,
      count,
      inputMode,
      duration,
      fps,
      generateAudio,
      assetCategory,
      references,
    }), 180)
    return () => window.clearTimeout(timer)
  }, [assetCategory, count, draftKey, duration, fps, generateAudio, inputMode, modelKey, prompt, quality, ratio, references, resolution, title])

  const loadHistory = useCallback(async () => {
    if (!projectId || tab === 'material') return
    setHistoryLoading(true)
    try {
      const response = await apiFetch(`/api/frameos/toolbox/assets?projectId=${encodeURIComponent(projectId)}&type=${activeType}&source=toolbox&limit=80`)
      if (!response.ok) throw new Error(await readApiErrorMessage(response, '加载生成历史失败'))
      const payload = await response.json() as { assets?: ToolboxAsset[] }
      setHistory(Array.isArray(payload.assets) ? payload.assets : [])
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '加载生成历史失败')
    } finally {
      setHistoryLoading(false)
    }
  }, [activeType, projectId, tab])

  useEffect(() => { void loadHistory() }, [loadHistory])
  const hasActive = history.some((asset) => ['pending', 'processing', 'queued'].includes(asset.task?.status || asset.status))
  useEffect(() => {
    if (!hasActive) return
    const timer = window.setInterval(() => void loadHistory(), 2500)
    return () => window.clearInterval(timer)
  }, [hasActive, loadHistory])

  const submit = async () => {
    if (!generationAllowed) { setError('积分不足，无法生成'); return }
    if (!projectId || !modelKey || !title.trim() || !prompt.trim()) {
      setError('请选择项目和模型，并填写生成名称与提示词。')
      return
    }
    if (activeType === 'video' && inputMode === 'image' && imageReferences.length < 1) { setError('图生视频至少需要一张参考图片。'); return }
    if (activeType === 'video' && inputMode === 'firstlastframe' && imageReferences.length < 2) { setError('首尾帧模式需要按顺序选择两张图片。'); return }
    const referenceSchema = activeType === 'video' && inputMode === 'firstlastframe'
      ? firstLastFrameInputSchema()
      : currentModel?.inputSchema || resolveCanvasGenerationInputSchema(activeType)
    const referenceErrors = validateCanvasReferenceMedia(
      referenceSchema,
      references.map((material) => ({
        id: material.id,
        title: material.title || '未命名素材',
        type: material.type === 'video' || material.type === 'audio' ? material.type : 'image',
        ...(material.type === 'audio' ? { durationSeconds: readMediaDurationSeconds(material.metadata) } : {}),
      })),
      { enforceMinimums: true, requireKnownAudioDuration: true },
    )
    if (referenceErrors[0]) { setError(referenceErrors[0]); return }
    if (activeType === 'video') {
      const combinationError = validateVideoReferenceMediaCombination(references, {
        allowAudioOnly: isSeedance25VideoModelKey(modelKey),
      })[0]
      if (combinationError) { setError(combinationError); return }
    }
    setSubmitting(true); setError(null); setMessage(null)
    try {
      const options: Record<string, string | number | boolean> = { aspectRatio: ratio }
      if (resolution) options.resolution = resolution
      if (activeType === 'image') options.quality = quality
      if (activeType === 'video') { options.duration = duration; if (fps !== null) options.fps = fps; if (currentModel?.supportGenerateAudio) options.generateAudio = generateAudio }
      const referenceMaterialIds = references.map((material) => material.id)
      const referenceMaterials = buildCanvasGenerationMaterialReferences(referenceMaterialIds, inputMode)
      const response = await apiFetch('/api/frameos/toolbox/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId, type: activeType, title: title.trim(), prompt: prompt.trim(), modelKey, assetCategory, referenceMaterialIds, referenceMaterials, count: activeType === 'image' ? Number(count) : 1, inputMode, idempotencyKey: crypto.randomUUID(), options }) })
      if (!response.ok) throw new Error(await readApiErrorMessage(response, '提交生成失败'))
      setMessage('生成任务已提交，完成后会自动进入素材库。')
      await loadHistory()
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '提交生成失败')
    } finally { setSubmitting(false) }
  }

  const mentionAssets = useMemo(() => references.map((material) => ({ id: material.id, name: material.title || '未命名素材', imageUrl: material.type === 'image' ? material.url : null })), [references])
  const audioReferenceDuration = audioReferences.reduce(
    (total, material) => total + (readMediaDurationSeconds(material.metadata) || 0),
    0,
  )
  if (tab === 'material') return <div className="flex min-h-0 flex-1 flex-col"><div className="flex items-center gap-1 border-b border-[var(--fos-border-soft)] px-6">{TABS.map((item) => <button key={item.key} type="button" onClick={() => { setFocusedMaterialId(null); setTab(item.key) }} className="relative flex items-center gap-1.5 px-4 py-3 text-[13px] font-bold" style={{ color: tab === item.key ? 'var(--fos-primary)' : 'var(--fos-text-2)' }}><AppIcon name={item.icon} className="h-4 w-4" />{item.label}{tab === item.key ? <span className="absolute inset-x-4 -bottom-px h-0.5 bg-[var(--fos-primary)]" /> : null}</button>)}</div><FosMaterialLibrary initialProjectId={projectId} initialMaterialId={focusedMaterialId} /></div>

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-3 border-b border-[var(--fos-border-soft)] px-6 py-3"><h1 className="text-[16px] font-bold text-white">工具箱</h1><span className="text-[12px] text-[var(--fos-text-3)]">归属项目</span><select className="fos-input h-9 max-w-[280px]" value={projectId} onChange={(event) => { setProjectId(event.target.value); setReferences([]) }}>{projects.length === 0 ? <option value="">暂无项目</option> : projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></div>
      <div className="flex items-center gap-1 border-b border-[var(--fos-border-soft)] px-6">{TABS.map((item) => <button key={item.key} type="button" onClick={() => { setTab(item.key); setReferences([]); setMessage(null); setError(null) }} className="relative flex items-center gap-1.5 px-4 py-3 text-[13px] font-bold" style={{ color: tab === item.key ? 'var(--fos-primary)' : 'var(--fos-text-2)' }}><AppIcon name={item.icon} className="h-4 w-4" />{item.label}{tab === item.key ? <span className="absolute inset-x-4 -bottom-px h-0.5 bg-[var(--fos-primary)]" /> : null}</button>)}</div>
      <div className="grid min-h-0 flex-1" style={{ gridTemplateColumns: '390px 1fr' }}>
        <aside className="flex min-h-0 flex-col border-r border-[var(--fos-border-soft)]">
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
            <label className="block"><span className="mb-2 block text-[13px] font-medium text-white">生成名称 <span className="text-red-400">*</span></span><input className="fos-input" value={title} onChange={(event) => setTitle(event.target.value)} placeholder={activeType === 'image' ? '例如：雨夜街巷概念图' : '例如：雨夜奔逃镜头'} /></label>
            <SelectField label="模型档位" value={modelKey} options={currentModels.map((model) => ({ value: model.modelKey, label: `${modelSelectLabel(model)}${model.available === false ? ' · 未接入' : ''}`, disabled: model.available === false }))} onChange={setModelKey} loading={configLoading} />
            {currentModel?.description ? <p className="-mt-2 text-[10px] leading-4 text-[var(--fos-text-4)]">{currentModel.description}</p> : null}
            <label className="block"><span className="mb-2 block text-[13px] font-medium text-white">归入资产库</span><select className="fos-input" value={assetCategory} onChange={(event) => setAssetCategory(event.target.value as FrameosAssetCategory)}>{(activeType === 'video' ? ['shot', 'other'] : ['character', 'location', 'prop', 'other']).map((category) => <option key={category} value={category}>{FRAMEOS_ASSET_CATEGORY_LABELS[category as FrameosAssetCategory]}</option>)}</select><span className="mt-1.5 block text-[10px] leading-4 text-[var(--fos-text-4)]">生成完成后自动进入当前项目的对应分类。</span></label>
            <div><div className="mb-2 text-[13px] font-medium text-white">提示词 <span className="text-red-400">*</span></div><MentionPromptEditor value={prompt} assets={mentionAssets} onChange={setPrompt} minHeight={170} placeholder={activeType === 'image' ? '描述想要生成的图片内容…' : '描述镜头、动作、光影与声音；输入 @ 可引用下方素材…'} /></div>
            {activeType === 'video' ? <SegRow label="模式" options={['文生视频', '图生视频', ...(currentModel?.firstLastFrame ? ['首尾帧'] : [])]} value={inputMode === 'text' ? '文生视频' : inputMode === 'image' ? '图生视频' : '首尾帧'} onChange={(value) => setInputMode(value === '图生视频' ? 'image' : value === '首尾帧' ? 'firstlastframe' : 'text')} /> : null}
            {activeType === 'image' ? (
              <ReferenceStrip materials={imageReferences} label="参考图片（选填）" limit={9} onAdd={() => setPickerType('image')} onRemove={(id) => setReferences((current) => current.filter((item) => item.id !== id))} />
            ) : inputMode === 'firstlastframe' ? (
              <ReferenceStrip materials={imageReferences} label="首帧 / 尾帧" limit={2} hint="按选择顺序分别作为首帧和尾帧。" onAdd={() => setPickerType('image')} onRemove={(id) => setReferences((current) => current.filter((item) => item.id !== id))} />
            ) : (
              <section className="rounded-[12px] border border-[var(--fos-border-soft)] bg-[var(--fos-bg-2)] px-3 pb-3">
                <div className="border-b border-[var(--fos-border-soft)] py-3"><div className="text-[12px] font-bold text-white">多模态参考</div><p className="mt-1 text-[10px] leading-4 text-[var(--fos-text-4)]">{currentModel?.name || '当前视频模型'} 可同时理解图片、参考视频和参考音频。</p></div>
                <ReferenceStrip materials={imageReferences} label="参考图片" limit={referenceLimits.image} onAdd={() => setPickerType('image')} onRemove={(id) => setReferences((current) => current.filter((item) => item.id !== id))} />
                <ReferenceStrip materials={videoReferences} label="参考视频" limit={referenceLimits.video} hint="用于动作、运镜或节奏参考。" onAdd={() => setPickerType('video')} onRemove={(id) => setReferences((current) => current.filter((item) => item.id !== id))} />
                <ReferenceStrip materials={audioReferences} label="参考音频" limit={referenceLimits.audio} hint={`${referenceSchema.audio.maxTotalDurationSeconds ? `总时长不超过 ${referenceSchema.audio.maxTotalDurationSeconds} 秒 · ` : ''}当前约 ${Math.round(audioReferenceDuration * 10) / 10} 秒；${isSeedance25VideoModelKey(modelKey) ? 'Seedance 2.5 支持配合提示词单独提交音频。' : '音频需和图片或视频一起提交。'}`} onAdd={() => setPickerType('audio')} onRemove={(id) => setReferences((current) => current.filter((item) => item.id !== id))} />
              </section>
            )}
            <SegRow label={activeType === 'image' ? '图片比例' : '视频比例'} options={[...(activeType === 'image' ? CANVAS_IMAGE_ASPECT_RATIOS : videoAspectRatios)]} value={ratio} onChange={setRatio} formatOption={(value) => value === 'adaptive' ? '自适应' : value} />
            {resolutionOptions.length > 0 ? <SegRow label={activeType === 'image' ? '图片分辨率' : '视频分辨率'} options={resolutionOptions} value={resolution} onChange={setResolution} formatOption={activeType === 'video' ? resolutionLabel : undefined} /> : null}
            {activeType === 'image' ? <><SegRow label="图片质量" options={[...CANVAS_IMAGE_QUALITIES]} value={quality} onChange={(value) => setQuality(value as CanvasImageQuality)} formatOption={(value) => value === 'low' ? '低' : value === 'medium' ? '中' : '高'} /><SegRow label="生成数量" options={['1', '2', '4']} value={count} onChange={setCount} /></> : <><DurationSelect value={duration} options={toolboxDurationOptions} onChange={setDuration} />{fpsOptions.length > 0 ? <SegRow label="视频帧率" options={fpsOptions.map(String)} value={String(fps || fpsOptions[0])} onChange={(value) => setFps(Number(value))} formatOption={(value) => `${value} FPS`} /> : null}{currentModel?.supportGenerateAudio ? <label className="flex items-center gap-2 text-[12px] text-[var(--fos-text-2)]"><input type="checkbox" checked={generateAudio} onChange={(event) => setGenerateAudio(event.target.checked)} className="accent-[var(--fos-primary)]" />同步生成声音</label> : null}</>}
            {error ? <div className="rounded-lg border border-red-400/25 bg-red-500/10 px-3 py-2 text-[12px] text-red-200">{error}</div> : null}
            {message ? <div className="rounded-lg border border-blue-400/25 bg-blue-500/10 px-3 py-2 text-[12px] text-blue-200">{message}</div> : null}
          </div>
          <div className="border-t border-[var(--fos-border-soft)] p-4"><button type="button" className="fos-btn fos-btn-primary fos-btn-lg w-full" disabled={!generationAllowed || submitting || !projectId || !modelKey || configLoading || currentModel?.available === false} title={!generationAllowed ? '积分不足，无法生成' : undefined} onClick={() => void submit()}>{submitting ? '提交中…' : !generationAllowed ? '积分不足' : activeType === 'image' ? '生成图片' : '生成视频'}</button></div>
        </aside>
        <ResultPane type={activeType} history={history} loading={historyLoading} onRefresh={() => void loadHistory()} onOpenMaterial={(materialId) => { setFocusedMaterialId(materialId); setTab('material') }} />
      </div>
      {pickerType ? <MaterialPickerDialog projectId={projectId} uploadEndpoint={`/api/frameos/toolbox/materials?projectId=${encodeURIComponent(projectId)}`} type={pickerType} title={pickerType === 'image' ? inputMode === 'firstlastframe' ? '选择首帧 / 尾帧图片' : '选择参考图片' : pickerType === 'video' ? '选择参考视频' : '选择参考音频'} selectedIds={references.filter((item) => item.type === pickerType).map((item) => item.id)} maxSelected={pickerLimit} onSelect={(material) => setReferences((current) => appendToolboxTypedReference(current, material, pickerType, pickerLimit))} onClose={() => setPickerType(null)} /> : null}
    </div>
  )
}
