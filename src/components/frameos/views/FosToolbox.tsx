'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSession } from 'next-auth/react'
import { AppIcon, type AppIconName } from '@/components/ui/icons'
import { MediaImage } from '@/components/media/MediaImage'
import { apiFetch } from '@/lib/api-fetch'
import { buildCanvasGenerationMaterialReferences } from '@/lib/canvas/generation-reference-contract'
import { readApiErrorMessage } from '@/lib/api/read-error-message'
import { toDisplayImageUrl, toPlayableVideoUrl } from '@/lib/media/image-url'
import { FosMaterialLibrary } from './FosMaterialLibrary'
import { MaterialPickerDialog } from '../materials/MaterialPickerDialog'
import { MentionPromptEditor } from '../materials/MentionPromptEditor'
import { characterVoiceBindingState, characterVoiceBindingStats } from '../materials/character-voice'
import type { FrameosMaterialItem } from '../materials/contracts'
import {
  FRAMEOS_ASSET_CATEGORY_LABELS,
  frameosAssetCategoryFromMetadata,
  type FrameosAssetCategory,
} from '@/lib/frameos/material-category'
import {
  createToolboxDraftKey,
  defaultToolboxInputMode,
  readToolboxDraft,
  resolveToolboxGenerateAudio,
  writeToolboxDraft,
  type ToolboxInputMode,
} from './toolbox-draft'
import {
  buildToolboxWorkTrace,
  formatToolboxWorkTrace,
} from './toolbox-work-trace'
import { WorkTraceCard } from './ToolboxWorkTraceCard'
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
import { fetchAllProjectOptions } from '../works/fetch-all-projects'
import { ProjectDownloadDirectory } from '../ProjectDownloadDirectory'
import { downloadFrameosMaterial } from '../materials/download-material'

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
  modelId?: string | null
  resultUrl: string | null
  url: string | null
  errorMessage: string | null
  params?: Record<string, unknown> | null
  createdAt: string
  task?: { id: string; status: string; progress: number; errorCode: string | null; errorMessage: string | null; costPoints?: number | null } | null
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

async function copyTraceText(value: string): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value)
      return
    }
  } catch {
    // Fall through to the legacy selection-based copy path.
  }
  if (typeof document === 'undefined') throw new Error('clipboard unavailable')
  const area = document.createElement('textarea')
  area.value = value
  area.setAttribute('readonly', '')
  area.style.position = 'fixed'
  area.style.left = '-9999px'
  document.body.appendChild(area)
  area.select()
  const copied = document.execCommand('copy')
  area.remove()
  if (!copied) throw new Error('copy failed')
}

function ReferenceStrip({ materials, onAdd, onRemove, label, limit, hint, hintTone = 'default', disabled = false }: { materials: FrameosMaterialItem[]; onAdd: () => void; onRemove: (id: string) => void; label: string; limit: number; hint?: string; hintTone?: 'default' | 'warning'; disabled?: boolean }) {
  return (
    <div className="mt-4">
      <div className="mb-2 flex items-center justify-between"><span className="text-[13px] font-medium text-white">{label}</span><span className="text-[11px] text-[var(--fos-text-4)]">{materials.length}/{limit}</span></div>
      <div className="flex flex-wrap gap-2">
        {materials.map((material, index) => {
          const src = material.type === 'video' ? toPlayableVideoUrl(material.url) : toDisplayImageUrl(material.url)
          const voiceState = characterVoiceBindingState(material)
          const typeLabel = material.type === 'image' ? '图' : material.type === 'video' ? '视频' : material.type === 'audio' ? '音频' : '3D'
          return (
            <div key={material.id} className="relative flex h-[72px] w-[72px] items-center justify-center overflow-hidden rounded-lg border border-[var(--fos-border-mid)] bg-black/30" title={`${index + 1}. ${material.title || '未命名素材'} · ${material.type}`}>
              {src && material.type === 'image' ? <MediaImage src={src} alt={material.title || ''} fill sizes="72px" style={{ objectFit: 'cover' }} /> : src && material.type === 'video' ? <video src={src} muted playsInline preload="metadata" className="pointer-events-none h-full w-full object-cover" /> : material.type === 'video' ? <AppIcon name="video" className="h-7 w-7 text-violet-200/60" /> : material.type === 'audio' ? <AppIcon name="audioWave" className="h-7 w-7 text-emerald-200/60" /> : <AppIcon name="image" className="h-7 w-7 text-sky-200/45" />}
              {voiceState ? (
                <span
                  className={`toolbox-ref-voice-badge absolute left-1 top-1 z-[2] inline-flex max-w-[44px] items-center gap-px overflow-hidden rounded border px-0.5 py-0.5 text-[8px] font-bold leading-none${voiceState === 'bound' ? ' border-violet-300/40 bg-violet-950/90 text-violet-100' : ' border-amber-300/45 bg-amber-950/90 text-amber-200'}`}
                  title={voiceState === 'bound'
                    ? `已绑定角色音色${material.voice?.title ? `：${material.voice.title}` : ''}；全能参考且开启声音时会自动带入`
                    : '该角色未绑定音色；全能参考时不会带入音频'}
                >
                  <AppIcon name={voiceState === 'bound' ? 'audioWave' : 'infoCircle'} className="h-2 w-2 shrink-0" />
                  <span className="truncate">{voiceState === 'bound' ? '音色' : '缺音色'}</span>
                </span>
              ) : (
                <span className="absolute left-1 top-1 rounded bg-black/70 px-1 text-[8px] text-white/70">{typeLabel}</span>
              )}
              <span className="absolute bottom-1 left-1 max-w-[54px] truncate rounded bg-black/70 px-1 text-[9px] text-white">{index + 1}. {material.title}</span>
              <button type="button" className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/75 text-white" onClick={() => onRemove(material.id)}><AppIcon name="close" className="h-3 w-3" /></button>
            </div>
          )
        })}
        <button type="button" disabled={disabled || limit <= 0 || materials.length >= limit} aria-label={`选择${label.replace(/（.*?）/g, '')}`} onClick={onAdd} className="flex h-[72px] w-[72px] flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-[var(--fos-border-strong)] text-[var(--fos-text-4)] hover:border-[var(--fos-primary-border)] hover:text-[var(--fos-primary-text)] disabled:cursor-not-allowed disabled:opacity-40"><AppIcon name="plus" className="h-5 w-5" /><span className="text-[10px]">{disabled ? '模型不支持' : '素材库/本地'}</span></button>
      </div>
      {hint ? <p className={`mt-1.5 text-[10px] leading-4${hintTone === 'warning' ? ' text-amber-300/90' : ' text-[var(--fos-text-4)]'}`}>{hint}</p> : null}
    </div>
  )
}

function ResultPane({ type, history, loading, refreshRevision, modelNames, onRefresh, onOpenMaterial, onDownload }: { type: ActiveGenerationTab; history: ToolboxAsset[]; loading: boolean; refreshRevision: number; modelNames: Record<string, string>; onRefresh: () => void; onOpenMaterial: (materialId: string) => void; onDownload: (materialId: string) => Promise<void> }) {
  const [downloading, setDownloading] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [traceCopyState, setTraceCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const selected = history.find((asset) => asset.id === selectedId) || history[0] || null
  useEffect(() => {
    if (history.length === 0) {
      setSelectedId(null)
      return
    }
    if (!selectedId || !history.some((asset) => asset.id === selectedId)) setSelectedId(history[0].id)
  }, [history, selectedId])
  useEffect(() => { setTraceCopyState('idle') }, [selected?.id])
  const latestActive = history.find((asset) => asset.status === 'pending' || asset.status === 'processing' || asset.task?.status === 'queued' || asset.task?.status === 'processing')
  const selectedStatus = selected?.task?.status || selected?.status || ''
  const selectedFailureMessage = selected?.task?.errorMessage || selected?.errorMessage
  const selectedFailureCode = selected?.task?.errorCode
  const preparedHistory = useMemo(() => history.slice(0, 12).map((asset) => ({
    asset,
    trace: buildToolboxWorkTrace(asset, { modelName: asset.modelId ? modelNames[asset.modelId] : '' }),
  })), [history, modelNames])
  const selectedTrace = selected
    ? buildToolboxWorkTrace(selected, { modelName: selected.modelId ? modelNames[selected.modelId] : '' })
    : null
  const src = selectedStatus === 'ready' || selectedStatus === 'completed'
    ? type === 'video' ? toPlayableVideoUrl(selected?.url) : toDisplayImageUrl(selected?.url) : null
  const copySelectedTrace = async () => {
    if (!selectedTrace) return
    try {
      await copyTraceText(formatToolboxWorkTrace(selectedTrace))
      setTraceCopyState('copied')
      window.setTimeout(() => setTraceCopyState('idle'), 2200)
    } catch {
      setTraceCopyState('failed')
    }
  }
  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-y-auto p-6">
      <div className="relative flex min-h-[390px] flex-1 items-center justify-center overflow-hidden rounded-[12px] border border-[var(--fos-border-mid)] bg-[var(--fos-bg-2)]">
        {src && type === 'image' ? <MediaImage key={`${selected?.id}:${refreshRevision}`} src={src} alt="最近生成结果" fill sizes="900px" style={{ objectFit: 'contain' }} /> : null}
        {src && type === 'video' ? <video key={`${selected?.id}:${refreshRevision}`} src={src} controls playsInline className="h-full max-h-[560px] w-full object-contain" /> : null}
        {!src ? <div className="max-w-[620px] px-8 text-center text-[var(--fos-text-4)]"><AppIcon name={type === 'image' ? 'imageLandscape' : 'videoWide'} className="mx-auto mb-3 h-16 w-16" /><div className="text-[14px]">{selectedStatus === 'failed' ? '本次生成失败' : latestActive ? `正在生成 ${latestActive.task?.progress || 0}%` : '设置参数后点击生成'}</div>{selectedStatus === 'failed' ? <div className="mt-3 break-words rounded-lg border border-red-400/20 bg-red-500/[.08] px-4 py-3 text-left text-[12px] leading-5 text-red-100"><div className="mb-1 font-bold text-red-200">失败原因{selectedFailureCode ? ` · ${selectedFailureCode}` : ''}</div><p>{selectedFailureMessage || '生成服务没有返回错误详情。请检查所选模型的服务状态、参考素材格式与账户余额后重试。'}</p>{selected?.task?.id ? <p className="mt-2 text-[10px] text-red-200/55">任务 ID：{selected.task.id}</p> : null}</div> : null}</div> : null}
      </div>
      {src && selected?.materialId ? <button type="button" className="fos-btn fos-btn-soft mt-3 self-start" disabled={downloading} onClick={() => {
        setDownloading(true)
        void onDownload(selected.materialId!).finally(() => setDownloading(false))
      }}>{downloading ? '下载中…' : type === 'video' ? '按项目规则下载视频' : '下载生成图片'}</button> : null}
      {selectedTrace ? <WorkTraceCard trace={selectedTrace} copyState={traceCopyState} onCopy={() => void copySelectedTrace()} /> : null}
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3"><div><span className="text-[14px] font-bold text-white">生成历史</span><span className="ml-2 text-[11px] text-[var(--fos-text-4)]">仅展示当前作品的工具箱任务</span></div><div className="flex flex-wrap items-center gap-2">{selected?.materialId && (selectedStatus === 'ready' || selectedStatus === 'completed') ? <button type="button" className="fos-btn fos-btn-soft fos-btn-sm" onClick={() => onOpenMaterial(selected.materialId!)}><AppIcon name="folderOpen" className="h-3.5 w-3.5" />在作品素材库查看</button> : null}<button type="button" className="fos-btn fos-btn-ghost fos-btn-sm" disabled={loading} onClick={onRefresh}><AppIcon name="refresh" className={`h-3.5 w-3.5${loading ? ' animate-spin' : ''}`} />{loading ? '刷新中…' : '刷新'}</button></div></div>
      <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {preparedHistory.map(({ asset, trace }) => {
          const resultSrc = asset.type === 'video' ? toPlayableVideoUrl(asset.url) : toDisplayImageUrl(asset.url)
          const status = asset.task?.status || asset.status
          const summary = [trace.mode, trace.references.length > 0 ? `${trace.references.length} 个参考` : '', trace.costPoints !== null ? trace.costLabel : ''].filter(Boolean).join(' · ')
          return <button type="button" key={asset.id} aria-pressed={selected?.id === asset.id} onClick={() => setSelectedId(asset.id)} className={`overflow-hidden rounded-lg border bg-[var(--fos-bg-2)] text-left transition${selected?.id === asset.id ? ' border-[var(--fos-primary)] ring-1 ring-[var(--fos-primary-border)]' : ' border-[var(--fos-border-soft)] hover:border-[var(--fos-border-strong)]'}`}><div className="relative flex aspect-video items-center justify-center overflow-hidden bg-black/35">{resultSrc && asset.type === 'image' ? <MediaImage src={resultSrc} alt={trace.title} fill sizes="240px" style={{ objectFit: 'cover' }} /> : resultSrc && asset.type === 'video' ? <video src={resultSrc} muted playsInline preload="metadata" className="pointer-events-none h-full w-full object-cover" /> : <AppIcon name={asset.type === 'image' ? 'image' : 'video'} className="h-7 w-7 text-white/15" />}<span className="absolute right-1.5 top-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[9px] text-white">{status === 'completed' || status === 'ready' ? '完成' : status === 'failed' ? '失败' : `${asset.task?.progress || 0}%`}</span></div><div className="truncate px-2 pt-2 text-[11px] font-bold text-white" title={trace.title}>{trace.title}</div><div className="truncate px-2 pt-0.5 text-[9px] text-[var(--fos-text-4)]" title={summary}>{summary}</div>{status === 'failed' ? <p className="line-clamp-3 px-2 pb-2 pt-1 text-[10px] leading-4 text-red-200/80" title={trace.errorMessage || '生成服务未返回错误详情。'}>{trace.errorMessage || '生成服务未返回错误详情。'}</p> : <div className="h-2" />}</button>
        })}
      </div>
    </main>
  )
}

export function FosToolbox({ initialTab }: { projectName?: string; initialTab?: ToolTab }) {
  const { data: session } = useSession()
  const { generationAllowed, generationDisabledReason, generationDisabledLabel } = useAccountBalance()
  const [tab, setTab] = useState<ToolTab>(initialTab === 'music' ? 'image' : initialTab ?? 'image')
  const activeType: ActiveGenerationTab = tab === 'video' ? 'video' : 'image'
  const [projects, setProjects] = useState<ProjectItem[]>([])
  const [projectsLoading, setProjectsLoading] = useState(true)
  const [projectsError, setProjectsError] = useState<string | null>(null)
  const [projectListRevision, setProjectListRevision] = useState(0)
  const [projectId, setProjectId] = useState('')
  const [config, setConfig] = useState<GenerationConfig | null>(null)
  const [configLoading, setConfigLoading] = useState(true)
  const [modelKey, setModelKey] = useState('')
  const [title, setTitle] = useState('')
  const [prompt, setPrompt] = useState('')
  const [ratio, setRatio] = useState('16:9')
  const [resolution, setResolution] = useState('')
  const [quality, setQuality] = useState<CanvasImageQuality>('high')
  const [inputMode, setInputMode] = useState<ToolboxInputMode>(() => defaultToolboxInputMode(activeType))
  const apiInputMode = inputMode === 'reference' ? 'text' : inputMode
  const [duration, setDuration] = useState(5)
  const [fps, setFps] = useState<number | null>(null)
  const [generateAudio, setGenerateAudio] = useState(true)
  const [assetCategory, setAssetCategory] = useState<FrameosAssetCategory>('other')
  const [references, setReferences] = useState<FrameosMaterialItem[]>([])
  const [pickerType, setPickerType] = useState<'image' | 'video' | 'audio' | null>(null)
  const [pickerCategory, setPickerCategory] = useState<FrameosAssetCategory | undefined>()
  const [historyRefreshMessage, setHistoryRefreshMessage] = useState<string | null>(null)
  const [historyRefreshRevision, setHistoryRefreshRevision] = useState(0)
  const [history, setHistory] = useState<ToolboxAsset[]>([])
  const [focusedMaterialId, setFocusedMaterialId] = useState<string | null>(null)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const hydratedDraftKeyRef = useRef('')
  const skipDraftWriteRef = useRef(false)
  const draftKey = useMemo(() => createToolboxDraftKey(
    // Browser sessions retain the actual login id. actorId is only injected
    // into server API auth contexts when ownership is remapped to a workspace.
    session?.user?.id || session?.user?.name,
    projectId,
    activeType,
  ), [activeType, projectId, session?.user?.id, session?.user?.name])
  const workspaceId = session?.user?.workspaceOwnerId || session?.user?.id || ''
  const historySequence = useRef(0)
  const historyAbort = useRef<AbortController | null>(null)
  const cancelHistoryReads = useCallback(() => {
    historySequence.current++
    historyAbort.current?.abort()
    historyAbort.current = null
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    setProjects([])
    setProjectId('')
    setProjectsError(null)
    if (!workspaceId) {
      setProjectsLoading(false)
      return () => controller.abort()
    }
    setProjectsLoading(true)
    void fetchAllProjectOptions(controller.signal)
      .then((list) => {
        if (controller.signal.aborted) return
        setProjects(list)
        setProjectId(list[0]?.id || '')
      })
      .catch((loadError) => {
        if (controller.signal.aborted) return
        setProjectsError(loadError instanceof Error ? loadError.message : '加载作品失败')
      })
      .finally(() => {
        if (!controller.signal.aborted) setProjectsLoading(false)
      })
    return () => controller.abort()
  }, [workspaceId, projectListRevision])

  useEffect(() => {
    if (!draftKey) return
    const draft = readToolboxDraft(window.localStorage, draftKey, defaultToolboxInputMode(activeType))
    hydratedDraftKeyRef.current = draftKey
    skipDraftWriteRef.current = true
    setTitle(draft?.title || '')
    setPrompt(draft?.prompt || '')
    setModelKey(draft?.modelKey || '')
    setRatio(draft?.ratio || '16:9')
    setResolution(draft?.resolution || '')
    setQuality(draft?.quality || 'high')
    setInputMode(draft?.inputMode || defaultToolboxInputMode(activeType))
    setDuration(draft?.duration || 5)
    setFps(draft?.fps || null)
    setGenerateAudio(draft?.generateAudio ?? true)
    setAssetCategory(draft?.assetCategory || (activeType === 'video' ? 'shot' : 'other'))
    setReferences(draft?.references || [])
    setMessage(null)
    setError(null)
  }, [activeType, draftKey])

  useEffect(() => {
    const controller = new AbortController()
    setConfigLoading(true)
    setConfig(null)
    setError(null)
    const endpoint = projectId
      ? `/api/frameos/generation-config?projectId=${encodeURIComponent(projectId)}`
      : '/api/frameos/generation-config'
    void apiFetch(endpoint, { signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error(await readApiErrorMessage(response, '加载生成配置失败'))
      return await response.json() as GenerationConfig
    }).then((next) => {
      if (controller.signal.aborted) return
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
      if (controller.signal.aborted) return
      setConfig(null)
      setModelKey('')
      setError(loadError instanceof Error ? loadError.message : '加载生成配置失败')
    }).finally(() => { if (!controller.signal.aborted) setConfigLoading(false) })
    return () => controller.abort()
  }, [activeType, draftKey, projectId])

  const currentModels = activeType === 'image' ? config?.imageModels || [] : config?.videoModels || []
  const currentModel = currentModels.find((model) => model.modelKey === modelKey)
  const videoAspectRatios = useMemo(
    () => canvasVideoAspectRatioOptions(modelKey, apiInputMode),
    [apiInputMode, modelKey],
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
  const characterVoiceStats = useMemo(() => characterVoiceBindingStats(imageReferences), [imageReferences])
  const characterVoiceHint = useMemo(() => {
    if (characterVoiceStats.total === 0) return null
    const progress = `角色音色 ${characterVoiceStats.bound}/${characterVoiceStats.total}`
    if (activeType !== 'video') return { text: `${progress}；声音只用于视频全能参考。`, tone: 'default' as const }
    if (inputMode !== 'reference') {
      const modeLabel = inputMode === 'image' ? '图生视频' : inputMode === 'firstlastframe' ? '首尾帧' : '文生视频'
      return { text: `${progress}；${modeLabel}不提交角色音色。`, tone: 'default' as const }
    }
    if (!generateAudio) return { text: `${progress}；已关闭“同步生成声音”，不会提交。`, tone: 'default' as const }
    if (characterVoiceStats.missing > 0) {
      return {
        text: `${progress}；自动带入 ${characterVoiceStats.bound} 个已绑定音色，${characterVoiceStats.missing} 个缺音色。`,
        tone: 'warning' as const,
      }
    }
    return { text: `${progress}；全能参考会自动带入全部音色。`, tone: 'default' as const }
  }, [activeType, characterVoiceStats, generateAudio, inputMode])
  const modelNames = useMemo<Record<string, string>>(() => Object.fromEntries(
    [...(config?.imageModels || []), ...(config?.videoModels || [])].map((model) => [model.modelKey, model.name]),
  ), [config])
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
    if (!currentModel?.firstLastFrame && inputMode === 'firstlastframe') setInputMode(activeType === 'video' ? 'reference' : 'text')
    if (activeType === 'video') {
      setRatio((current) => videoAspectRatios.includes(current as (typeof videoAspectRatios)[number])
        ? current
        : videoAspectRatios[0] || '16:9')
    }
  }, [activeType, config?.defaults.resolution, currentModel, fpsOptions, inputMode, resolutionOptions, toolboxDurationOptions, videoAspectRatios])

  const supportsGenerateAudio = currentModel?.supportGenerateAudio === true
  useEffect(() => {
    const draft = draftKey ? readToolboxDraft(window.localStorage, draftKey) : null
    setGenerateAudio(resolveToolboxGenerateAudio({
      type: activeType,
      modelKey,
      supportGenerateAudio: supportsGenerateAudio,
      draft,
    }))
    // Changing mode/resolution must not reset an unsaved sound checkbox.
  }, [activeType, draftKey, modelKey, supportsGenerateAudio])

  useEffect(() => {
    if (activeType !== 'video' || (inputMode !== 'firstlastframe' && inputMode !== 'image')) return
    setReferences((current) => {
      const next = current.filter((item) => item.type === 'image').slice(0, inputMode === 'firstlastframe' ? 2 : referenceLimits.image)
      return next.length === current.length && next.every((item, index) => item.id === current[index]?.id)
        ? current
        : next
    })
  }, [activeType, inputMode, referenceLimits.image])

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
      inputMode,
      duration,
      fps,
      generateAudio,
      assetCategory,
      references,
    }), 180)
    return () => window.clearTimeout(timer)
  }, [assetCategory, draftKey, duration, fps, generateAudio, inputMode, modelKey, prompt, quality, ratio, references, resolution, title])

  const loadHistory = useCallback(async (manual = false) => {
    if (!projectId || tab === 'material') return
    const sequence = ++historySequence.current
    historyAbort.current?.abort()
    const controller = new AbortController()
    historyAbort.current = controller
    setHistoryLoading(true)
    try {
      const response = await apiFetch(`/api/frameos/toolbox/assets?projectId=${encodeURIComponent(projectId)}&type=${activeType}&source=toolbox&limit=80`, { signal: controller.signal, cache: 'no-store' })
      if (!response.ok) throw new Error(await readApiErrorMessage(response, '加载生成历史失败'))
      const payload = await response.json() as { assets?: ToolboxAsset[] }
      if (sequence === historySequence.current && !controller.signal.aborted) {
        setHistory(Array.isArray(payload.assets) ? payload.assets : [])
        if (manual) {
          setError(null)
          setHistoryRefreshMessage(`已刷新 · ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`)
          setHistoryRefreshRevision((revision) => revision + 1)
        }
      }
    } catch (loadError) {
      if (sequence !== historySequence.current || controller.signal.aborted) return
      setError(loadError instanceof Error ? loadError.message : '加载生成历史失败')
    } finally {
      if (sequence === historySequence.current) {
        historyAbort.current = null
        setHistoryLoading(false)
      }
    }
  }, [activeType, projectId, tab])

  useEffect(() => {
    setHistory([])
    setHistoryRefreshMessage(null)
    void loadHistory()
    return cancelHistoryReads
  }, [cancelHistoryReads, loadHistory])
  const hasActive = history.some((asset) => ['pending', 'processing', 'queued'].includes(asset.task?.status || asset.status))
  useEffect(() => {
    if (!hasActive) return
    const timer = window.setInterval(() => { if (!historyAbort.current) void loadHistory() }, 2500)
    return () => window.clearInterval(timer)
  }, [hasActive, loadHistory])

  const submit = async () => {
    if (projectsLoading || projectsError) {
      setError(projectsError || '正在加载完整作品列表，请稍候。')
      return
    }
    if (!generationAllowed) { setError(generationDisabledReason || '当前账号不可生成'); return }
    if (!projectId || !modelKey || !title.trim() || !prompt.trim()) {
      setError('请选择作品和模型，并填写生成名称与提示词。')
      return
    }
    if (activeType === 'video' && inputMode === 'image' && imageReferences.length < 1) { setError('图生视频至少需要一张参考图片。'); return }
    if (activeType === 'video' && inputMode === 'firstlastframe' && imageReferences.length < 2) { setError('首尾帧模式需要按顺序选择两张图片。'); return }
    const referenceSchema = activeType === 'video' && inputMode === 'firstlastframe'
      ? firstLastFrameInputSchema()
      : currentModel?.inputSchema || resolveCanvasGenerationInputSchema(activeType)
    const submittedReferences = activeType === 'video' && inputMode === 'text' ? [] : references
    const referenceErrors = validateCanvasReferenceMedia(
      referenceSchema,
      submittedReferences.map((material) => ({
        id: material.id,
        title: material.title || '未命名素材',
        type: material.type === 'video' || material.type === 'audio' ? material.type : 'image',
        ...(material.type === 'audio' ? { durationSeconds: readMediaDurationSeconds(material.metadata) } : {}),
      })),
      { enforceMinimums: true, requireKnownAudioDuration: true },
    )
    if (referenceErrors[0]) { setError(referenceErrors[0]); return }
    if (activeType === 'video') {
      const combinationError = validateVideoReferenceMediaCombination(submittedReferences, {
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
      const referenceMaterialIds = submittedReferences.map((material) => material.id)
      const referenceMaterials = buildCanvasGenerationMaterialReferences(referenceMaterialIds, apiInputMode)
      const response = await apiFetch('/api/frameos/toolbox/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId, type: activeType, title: title.trim(), prompt: prompt.trim(), modelKey, assetCategory, referenceMaterialIds, referenceMaterials, inputMode: apiInputMode, textOnly: activeType === 'video' && inputMode === 'text', idempotencyKey: crypto.randomUUID(), options }) })
      if (!response.ok) throw new Error(await readApiErrorMessage(response, '提交生成失败'))
      setMessage('生成任务已提交，完成后会自动进入素材库。')
      await loadHistory()
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '提交生成失败')
    } finally { setSubmitting(false) }
  }

  const mentionAssets = useMemo(() => (activeType === 'video' && inputMode === 'text' ? [] : references).map((material) => ({ id: material.id, name: material.title || '未命名素材', imageUrl: material.type === 'image' ? material.url : null })), [activeType, inputMode, references])
  const openReferencePicker = (type: 'image' | 'video' | 'audio', category?: FrameosAssetCategory) => {
    setPickerCategory(category)
    setPickerType(type)
  }
  const removeReference = (id: string) => setReferences((current) => current.filter((item) => item.id !== id))
  const audioReferenceDuration = audioReferences.reduce(
    (total, material) => total + (readMediaDurationSeconds(material.metadata) || 0),
    0,
  )
  const categorizedImageReferences = (
    <div className="grid grid-cols-1 gap-x-3 sm:grid-cols-2" aria-label="分类参考素材">
      {([['character', '人物'], ['location', '场景'], ['prop', '道具']] as const).map(([category, label]) => <ReferenceStrip key={category} materials={imageReferences.filter((item) => frameosAssetCategoryFromMetadata(item.metadata) === category)} label={label} limit={referenceLimits.image} disabled={imageReferences.length >= referenceLimits.image} hint={category === 'character' ? characterVoiceHint?.text : undefined} hintTone={category === 'character' ? characterVoiceHint?.tone : undefined} onAdd={() => openReferencePicker('image', category)} onRemove={removeReference} />)}
      <ReferenceStrip materials={audioReferences} label="音色" limit={inputMode === 'reference' ? referenceLimits.audio : 0} disabled={activeType !== 'video' || inputMode !== 'reference' || referenceLimits.audio <= 0} hint={activeType !== 'video' ? '音色用于视频全能参考，图片生成不传音频。' : inputMode !== 'reference' ? '使用音色请切换全能参考。' : `当前约 ${Math.round(audioReferenceDuration * 10) / 10} 秒`} onAdd={() => openReferencePicker('audio')} onRemove={removeReference} />
      <ReferenceStrip materials={imageReferences.filter((item) => !['character', 'location', 'prop'].includes(frameosAssetCategoryFromMetadata(item.metadata)))} label="其他参考图片" limit={referenceLimits.image} disabled={imageReferences.length >= referenceLimits.image} onAdd={() => openReferencePicker('image')} onRemove={removeReference} />
    </div>
  )
  const toolboxHeader = (
      <div className="fos-toolbox-header flex shrink-0 flex-wrap items-center gap-3 border-b border-[var(--fos-border-soft)] px-6 py-3">
        <h1 className="text-[16px] font-bold text-white">工具箱</h1>
        <label className="fos-toolbox-function flex min-w-0 items-center gap-2">
          <span className="text-[12px] text-[var(--fos-text-3)]">功能</span>
          <select aria-label="工具箱功能" className="fos-input h-9 w-[150px]" value={tab} disabled={submitting} onChange={(event) => {
            setTab(event.target.value as ToolTab)
            setFocusedMaterialId(null)
            setReferences([])
            setMessage(null)
            setError(null)
          }}>
            {TABS.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
          </select>
        </label>
        <label className="fos-toolbox-project">
        <span className="text-[12px] text-[var(--fos-text-3)]">归属作品</span>
        <select aria-label="归属作品" className="fos-input h-9 max-w-[280px]" value={projectId} disabled={projectsLoading || submitting} onChange={(event) => { setProjectId(event.target.value); setReferences([]) }}>
          {projects.length === 0 ? <option value="">{projectsLoading ? '正在加载作品…' : projectsError ? '作品加载失败' : '暂无作品'}</option>
            : projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
        </select>
        </label>
        {projectsError ? <div className="flex min-w-0 items-center gap-2 text-[12px] text-red-300" role="alert">
          <span>{projectsError}</span>
          <button type="button" className="fos-btn fos-btn-ghost" onClick={() => setProjectListRevision((revision) => revision + 1)}>重新加载作品</button>
        </div> : null}
        {projectId ? <ProjectDownloadDirectory key={`${session?.user?.id}:${projectId}`} projectId={projectId} /> : null}
      </div>
  )
  if (tab === 'material') return <div className="flex min-h-0 flex-1 flex-col">{toolboxHeader}<FosMaterialLibrary key={`${workspaceId}:${projectId}`} initialProjectId={projectId} initialMaterialId={focusedMaterialId} /></div>

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {toolboxHeader}
      <div className="fos-toolbox-layout grid min-h-0 flex-1">
        <aside className="flex min-h-0 flex-col border-r border-[var(--fos-border-soft)]">
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
            <label className="block"><span className="mb-2 block text-[13px] font-medium text-white">生成名称 <span className="text-red-400">*</span></span><input className="fos-input" value={title} onChange={(event) => setTitle(event.target.value)} placeholder={activeType === 'image' ? '例如：雨夜街巷概念图' : '例如：雨夜奔逃镜头'} /></label>
            <SelectField label="模型档位" value={modelKey} options={currentModels.map((model) => ({ value: model.modelKey, label: `${modelSelectLabel(model)}${model.available === false ? ' · 未接入' : ''}`, disabled: model.available === false }))} onChange={setModelKey} loading={configLoading} />
            {currentModel?.description ? <p className="-mt-2 text-[10px] leading-4 text-[var(--fos-text-4)]">{currentModel.description}</p> : null}
            <label className="block"><span className="mb-2 block text-[13px] font-medium text-white">归入资产库</span><select className="fos-input" value={assetCategory} onChange={(event) => setAssetCategory(event.target.value as FrameosAssetCategory)}>{(activeType === 'video' ? ['shot', 'other'] : ['character', 'location', 'prop', 'other']).map((category) => <option key={category} value={category}>{FRAMEOS_ASSET_CATEGORY_LABELS[category as FrameosAssetCategory]}</option>)}</select><span className="mt-1.5 block text-[10px] leading-4 text-[var(--fos-text-4)]">生成完成后自动进入当前作品的对应分类。</span></label>
            <div><div className="mb-2 text-[13px] font-medium text-white">提示词 <span className="text-red-400">*</span></div><MentionPromptEditor value={prompt} assets={mentionAssets} onChange={setPrompt} minHeight={170} placeholder={activeType === 'image' ? '描述想要生成的图片内容…' : '描述镜头、动作、光影与声音；输入 @ 可引用下方素材…'} /></div>
            {activeType === 'video' ? <SelectField label="视频生成模式" value={inputMode} options={[{ value: 'text', label: '文生视频（仅提示词）' }, { value: 'reference', label: '全能参考（图片 / 视频 / 音色）' }, { value: 'image', label: '图生视频' }, ...(currentModel?.firstLastFrame ? [{ value: 'firstlastframe', label: '首尾帧' }] : [])]} onChange={(value) => setInputMode(value as typeof inputMode)} /> : null}
            {activeType === 'image' ? (
              categorizedImageReferences
            ) : inputMode === 'text' ? (
              <p className="rounded-lg border border-[var(--fos-border-soft)] bg-[var(--fos-bg-2)] px-3 py-2 text-[11px] leading-5 text-[var(--fos-text-3)]">纯文生视频只提交提示词和生成参数，不传图片、视频或音频。需要参考素材时，请切换到全能参考或图生视频。</p>
            ) : inputMode === 'firstlastframe' ? (
              <ReferenceStrip materials={imageReferences} label="首帧 / 尾帧" limit={2} hint="按选择顺序分别作为首帧和尾帧。" onAdd={() => openReferencePicker('image')} onRemove={removeReference} />
            ) : (
              <section className="rounded-[12px] border border-[var(--fos-border-soft)] bg-[var(--fos-bg-2)] px-3 pb-3">
                <div className="border-b border-[var(--fos-border-soft)] py-3"><div className="text-[12px] font-bold text-white">{inputMode === 'image' ? '图片参考' : '多模态参考'}</div><p className="mt-1 text-[10px] leading-4 text-[var(--fos-text-4)]">按人物、场景、道具选择素材；所有图片合计最多 {referenceLimits.image} 张。全能参考且开启声音时，角色卡已绑定的音色会自动加入。</p></div>
                {categorizedImageReferences}
                {inputMode === 'reference' && referenceLimits.video > 0 ? <ReferenceStrip materials={videoReferences} label="参考视频" limit={referenceLimits.video} hint="用于动作、运镜或节奏参考。" onAdd={() => openReferencePicker('video')} onRemove={removeReference} /> : null}
                {inputMode === 'reference' && referenceLimits.audio > 0 ? <p className="mt-2 text-[10px] leading-4 text-[var(--fos-text-4)]">{referenceSchema.audio.maxTotalDurationSeconds ? `音色总时长不超过 ${referenceSchema.audio.maxTotalDurationSeconds} 秒；` : ''}{isSeedance25VideoModelKey(modelKey) ? 'Seedance 2.5 支持音色配合提示词单独提交。' : '音色需和图片或视频一起提交。'}</p> : null}
              </section>
            )}
            <SegRow label={activeType === 'image' ? '图片比例' : '视频比例'} options={[...(activeType === 'image' ? CANVAS_IMAGE_ASPECT_RATIOS : videoAspectRatios)]} value={ratio} onChange={setRatio} formatOption={(value) => value === 'adaptive' ? '自适应' : value} />
            {resolutionOptions.length > 0 ? <SegRow label={activeType === 'image' ? '图片分辨率' : '视频分辨率'} options={resolutionOptions} value={resolution} onChange={setResolution} formatOption={activeType === 'video' ? resolutionLabel : undefined} /> : null}
            {activeType === 'image' ? <SegRow label="图片质量" options={[...CANVAS_IMAGE_QUALITIES]} value={quality} onChange={(value) => setQuality(value as CanvasImageQuality)} formatOption={(value) => value === 'low' ? '低' : value === 'medium' ? '中' : '高'} /> : <><DurationSelect value={duration} options={toolboxDurationOptions} onChange={setDuration} />{fpsOptions.length > 0 ? <SegRow label="视频帧率" options={fpsOptions.map(String)} value={String(fps || fpsOptions[0])} onChange={(value) => setFps(Number(value))} formatOption={(value) => `${value} FPS`} /> : null}{currentModel?.supportGenerateAudio ? <label className="flex items-center gap-2 text-[12px] text-[var(--fos-text-2)]"><input type="checkbox" checked={generateAudio} onChange={(event) => setGenerateAudio(event.target.checked)} className="accent-[var(--fos-primary)]" />同步生成声音</label> : null}</>}
            {error ? <div className="rounded-lg border border-red-400/25 bg-red-500/10 px-3 py-2 text-[12px] text-red-200">{error}</div> : null}
            {message ? <div className="rounded-lg border border-[var(--fos-primary-border)] bg-[var(--fos-primary-soft)] px-3 py-2 text-[12px] text-[var(--fos-text-1)]">{message}</div> : null}
          </div>
          <div className="border-t border-[var(--fos-border-soft)] p-4"><button type="button" className="fos-btn fos-btn-primary fos-btn-lg w-full" disabled={!generationAllowed || submitting || projectsLoading || Boolean(projectsError) || !projectId || !modelKey || configLoading || currentModel?.available === false} title={!generationAllowed ? generationDisabledReason || undefined : undefined} onClick={() => void submit()}>{submitting ? '提交中…' : !generationAllowed ? generationDisabledLabel : activeType === 'image' ? '生成图片' : '生成视频'}</button></div>
        </aside>
        <div className="fos-toolbox-results flex min-h-0 min-w-0 flex-col">
          {historyRefreshMessage ? <p role="status" className="shrink-0 px-6 pt-3 text-[11px] text-[var(--fos-text-3)]">{historyRefreshMessage}</p> : null}
          <ResultPane type={activeType} history={history} loading={historyLoading} refreshRevision={historyRefreshRevision} modelNames={modelNames} onRefresh={() => void loadHistory(true)} onOpenMaterial={(materialId) => { setFocusedMaterialId(materialId); setTab('material') }} onDownload={async (materialId) => {
            setError(null)
            try { const saved = await downloadFrameosMaterial(session?.user?.id || '', projectId, materialId); setMessage(saved.method === 'directory' ? `已保存到本地固定目录：${saved.name}` : `下载已开始：${saved.name}`) }
            catch (cause) { setError(cause instanceof Error ? cause.message : '下载失败') }
          }} />
        </div>
      </div>
      {pickerType ? <MaterialPickerDialog projectId={projectId} uploadEndpoint={`/api/frameos/toolbox/materials?projectId=${encodeURIComponent(projectId)}`} type={pickerType} assetCategory={pickerCategory} multiple confirmLabel="确定并关闭" title={pickerType === 'image' ? inputMode === 'firstlastframe' ? '选择首帧 / 尾帧图片' : `选择${pickerCategory ? FRAMEOS_ASSET_CATEGORY_LABELS[pickerCategory] : '参考图片'}` : pickerType === 'video' ? '选择参考视频' : '选择音色'} selectedIds={references.filter((item) => item.type === pickerType).map((item) => item.id)} maxSelected={pickerLimit} onConfirm={(materials) => {
        setReferences((current) => materials.reduce((next, material) => appendToolboxTypedReference(next, material, pickerType, pickerLimit), current))
        setPickerType(null)
      }} onClose={() => setPickerType(null)} /> : null}
    </div>
  )
}
