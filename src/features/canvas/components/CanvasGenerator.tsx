'use client'

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { flushSync } from 'react-dom'
import { requireExistingReferenceNodeIds } from '../reference-resolution'
import {
  ArrowLeft,
  Box,
  ChevronDown,
  Film,
  Focus,
  ImageIcon,
  LayoutGrid,
  Maximize2,
  Minimize2,
  Music2,
  Plus,
  Send,
  SlidersHorizontal,
  Type,
  Upload,
  X,
} from '@/components/ui/icons'
import { apiFetch } from '@/lib/api-fetch'
import { readApiErrorMessage } from '@/lib/api/read-error-message'
import { toDisplayImageUrl, toPlayableVideoUrl } from '@/lib/media/image-url'
import { characterVoiceMaterialId } from '@/lib/frameos/character-voice-reference'
import { frameosAssetCategoryFromMetadata } from '@/lib/frameos/material-category'
import { useAccountBalance } from '@/hooks/common/useAccountBalance'
import { MediaImage } from '@/components/media/MediaImage'
import { ViewportPopover } from '@/components/ui/viewport-popover'
import { MentionPromptEditor, type MentionPromptAsset } from '@/components/frameos/materials/MentionPromptEditor'
import {
  CANVAS_IMAGE_ASPECT_RATIOS,
  CANVAS_IMAGE_QUALITIES,
  CANVAS_IMAGE_RESOLUTIONS,
  CANVAS_PANORAMA_ASPECT_RATIO,
  CANVAS_VIDEO_DURATION_MAX,
  CANVAS_VIDEO_DURATION_MIN,
  CANVAS_VIDEO_RESOLUTIONS,
  canvasVideoAspectRatioOptions,
  isSeedance25VideoModelKey,
  resolveSupportedResolution,
  canvasPanoramaEditorAspectRatio,
  canvasVideoEditorMode,
  type CanvasImageQuality,
  type CanvasVideoEditorMode,
} from '@/lib/canvas/generator-options'
import {
  firstLastFrameInputSchema,
  imageToVideoInputSchema,
  readMediaDurationSeconds,
  resolveCanvasGenerationInputSchema,
  validateCanvasReferenceMedia,
  validateCanvasRequiredFields,
  validateVideoReferenceMediaCombination,
  type CanvasGenerationInputSchema,
  type CanvasReferenceMediaSummary,
} from '@/lib/canvas/generation-input-schema'
import type { CanvasGenerationReferenceRole } from '@/lib/canvas/generation-reference-contract'
import type { CanvasGeneratorAnchor } from '../generator-anchor'
import {
  CANVAS_GENERATOR_PANEL_WIDTH_MAX,
  CANVAS_GENERATOR_PANEL_WIDTH_MIN,
  clampCanvasGeneratorPanelWidth,
  resizeCanvasGeneratorPanelWidth,
} from '../generator-panel-width'
import type { CanvasFlowNode } from '../editor-types'
import {
  buildCanvasMentionAssets,
  mergeCanvasReferenceNodeIds,
  shouldBindCanvasMentionReference,
  type CanvasMentionMediaType,
} from './canvas-mention-references'

type ModelOption = {
  modelKey: string
  name: string
  provider: string
  tier?: 'mini' | 'fast' | 'standard' | 'pro'
  options: Record<string, Array<string | number | boolean>>
  firstLastFrame?: boolean
  supportGenerateAudio?: boolean
  supportsInpaint?: boolean
  inputSchema?: CanvasGenerationInputSchema
  audioModes?: AudioMode[]
  configured?: boolean
  available?: boolean
  unavailableReason?: string | null
  healthStatus?: 'healthy' | 'unhealthy' | 'unknown'
  healthMessage?: string | null
  healthCheckedAt?: string | null
  runtimeModelKey?: string | null
  minDurationSeconds?: number | null
  maxDurationSeconds?: number | null
  durationStepSeconds?: number | null
}

type VoiceOption = { value: string; label: string }
type AudioMode = 'tts'
type GenerationQuote = { points: number; costCny: number }

const AUDIO_MODES: Array<{ value: AudioMode; label: string }> = [
  { value: 'tts', label: '配音' },
]
const AUDIO_MODE_PREFERRED_MODEL_KEYS: Record<AudioMode, string> = {
  tts: 'nori::nori-audio',
}
const MODEL_TIER_LABELS: Record<NonNullable<ModelOption['tier']>, string> = {
  mini: 'Mini',
  fast: 'Fast',
  standard: '标准',
  pro: 'Pro',
}
const STORYBOARD_COUNTS = [4, 5, 6, 7, 8] as const
const VIDEO_MENTION_TYPES = ['image', 'video', 'audio'] as const satisfies readonly CanvasMentionMediaType[]
const IMAGE_MENTION_TYPES = ['image'] as const satisfies readonly CanvasMentionMediaType[]
const AUDIO_MENTION_TYPES = ['audio'] as const satisfies readonly CanvasMentionMediaType[]
const NO_MENTION_TYPES: readonly CanvasMentionMediaType[] = []

function normalizeStoryboardCount(value: number) {
  return Math.max(STORYBOARD_COUNTS[0], Math.min(STORYBOARD_COUNTS[STORYBOARD_COUNTS.length - 1], Math.floor(value) || STORYBOARD_COUNTS[0]))
}

type GenerationConfig = {
  textModels: ModelOption[]
  imageModels: ModelOption[]
  videoModels: ModelOption[]
  audioModels: ModelOption[]
  model3dModels: ModelOption[]
  defaults: {
    textModel: string | null
    imageModel: string | null
    editModel: string | null
    storyboardModel: string | null
    videoModel: string | null
    audioModel: string | null
    model3dModel: string | null
    aspectRatio: string | null
    resolution: string | null
  }
}

export type CanvasGenerateRequest = {
  nodeId: string
  type: 'text' | 'image' | 'video' | 'audio' | 'model3d'
  prompt: string
  quotedCostPoints?: number | null
  modelKey: string
  modelLabel: string
  referenceNodeIds: string[]
  referenceSummary?: CanvasReferenceMediaSummary[]
  inputMode: 'text' | 'image' | 'firstlastframe'
  aspectRatio: string
  resolution: string
  quality: CanvasImageQuality
  duration: number
  fps?: number
  generateAudio: boolean
  count: number
  storyboard: boolean
  audioMode: AudioMode
  audioVoice: string
  audioGenre: string
  audioSfxKind: string
  model3dTopology?: 'standard' | 'low_poly'
  model3dGenerateTexture?: boolean
  model3dPose?: 'none' | 'a_pose' | 't_pose'
}

function nodeKind(node: CanvasFlowNode): CanvasGenerateRequest['type'] {
  if (node.type === 'note' || node.type === 'text') return 'text'
  if (node.type === 'video') return 'video'
  if (node.type === 'audio') return 'audio'
  if (node.type === 'model_3d') return 'model3d'
  return 'image'
}

function modelOptions(model: ModelOption | undefined, key: string) {
  return (model?.options?.[key] || []).map(String)
}

/** 引用素材上限按当前输入模式取对应媒体类型的上限。 */
export function resolveReferencePickerMax(
  picker: 'all' | 'image' | 'video' | 'audio' | null,
  maxes: { image: number; video: number; audio: number },
): number {
  let limit = maxes.image
  if (picker === 'video') limit = maxes.video
  else if (picker === 'audio') limit = maxes.audio
  else if (picker === 'all') limit = maxes.image + maxes.video + maxes.audio
  return Math.max(1, limit || 9)
}

function resolutionLabel(value: string) {
  return value.toLowerCase() === '4k' ? '4K' : value
}

function optionalPositiveInteger(value: unknown) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

function videoGenerationParameters(
  current: Record<string, string | number | boolean> | undefined,
  fps: number | null,
) {
  const next = { ...(current || {}) }
  if (fps !== null) next.fps = fps
  else delete next.fps
  return next
}

function mediaTypeForReference(node: CanvasFlowNode): CanvasReferenceMediaSummary['type'] | null {
  const type = node.data.mediaType || node.type
  return type === 'image' || type === 'video' || type === 'audio' ? type : null
}

function nodeMediaDurationSeconds(node: CanvasFlowNode): number | null {
  const metadata = node.data.sourceMetadata
  const generationDuration = node.data.generation?.duration
  const generationSeconds = typeof generationDuration === 'number' && Number.isFinite(generationDuration) && generationDuration > 0
    ? generationDuration
    : null
  return readMediaDurationSeconds(metadata) ?? generationSeconds
}

function referenceSummary(
  node: CanvasFlowNode,
  role?: CanvasGenerationReferenceRole,
): CanvasReferenceMediaSummary | null {
  const type = mediaTypeForReference(node)
  if (!type) return null
  const durationSeconds = type === 'audio' || type === 'video'
    ? nodeMediaDurationSeconds(node)
    : null
  return {
    id: node.id,
    title: node.data.title?.trim() || '未命名素材',
    type,
    previewUrl: node.data.contentUrl
      || node.data.imageUrl
      || node.data.posterUrl
      || node.data.videoUrl
      || node.data.audioUrl
      || null,
    ...(role ? { role } : {}),
    ...(durationSeconds !== null ? { durationSeconds } : {}),
  }
}

export function quoteInputVideoSeconds(referenceNodeIds: string[], referenceNodes: CanvasFlowNode[]): number {
  const seconds = referenceNodeIds.flatMap((id) => {
    const node = referenceNodes.find((item) => item.id === id)
    if (!node || mediaTypeForReference(node) !== 'video') return []
    const value = nodeMediaDurationSeconds(node)
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? [value] : []
  })
  return seconds.reduce((sum, value) => sum + value, 0)
}

export function estimateTtsSeconds(prompt: string): number {
  const text = prompt.trim()
  if (!text) return 1
  const cjkCharacters = text.match(/[\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g)?.length || 0
  const words = text.match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g)?.length || 0
  // Conservative speech estimate: CJK about 4 characters/second, English about
  // 2.6 words/second, plus a short leading/trailing allowance.
  return Math.max(1, Math.ceil((cjkCharacters / 4 + words / 2.6) * 1.15))
}

function ReferenceThumb({ node, selected, onToggle, onHover }: { node: CanvasFlowNode; selected: boolean; onToggle: () => void; onHover: (nodeId: string | null) => void }) {
  const mediaType = mediaTypeForReference(node)
  const image = toDisplayImageUrl(mediaType === 'video'
    ? node.data.posterUrl || node.data.imageUrl || null
    : mediaType === 'image' ? node.data.contentUrl || node.data.imageUrl || node.data.posterUrl || null : null)
  const video = mediaType === 'video' ? toPlayableVideoUrl(node.data.videoUrl || node.data.contentUrl) : null
  const Icon = node.type === 'text' ? Type : node.type === 'video' ? Film : node.type === 'audio' ? Music2 : ImageIcon
  const isCharacter = mediaType === 'image' && frameosAssetCategoryFromMetadata(node.data.sourceMetadata) === 'character'
  const characterVoiceBound = isCharacter && Boolean(characterVoiceMaterialId(node.data.sourceMetadata))
  const title = node.data.title || '上游节点'
  const voiceHint = isCharacter
    ? characterVoiceBound
      ? ' · 角色已绑定音色，全能参考且开启声音时会自动带入'
      : ' · 角色未绑定音色，全能参考时不会带入音频'
    : ''
  return (
    <button
      type="button"
      className={`nori-canvas-generator-ref${selected ? ' is-selected' : ''}`}
      title={`${title}${voiceHint}`}
      onClick={onToggle}
      onPointerEnter={() => onHover(node.id)}
      onPointerLeave={() => onHover(null)}
    >
      {image ? <MediaImage src={image} alt="" width={52} height={52} /> : video ? <video src={video} muted playsInline preload="metadata" /> : <Icon />}
      {isCharacter ? <em className={`nori-canvas-generator-ref-voice${characterVoiceBound ? ' is-bound' : ' is-missing'}`}>{characterVoiceBound ? '音色' : '缺音色'}</em> : null}
      <span>{title}</span>
    </button>
  )
}

export function CanvasGenerator({
  projectId,
  node,
  incomingNodes,
  referenceNodes,
  onDraftChange,
  onGenerate,
  onReplace,
  onClose,
  onFocus,
  onAddReferences,
  injectedReferenceNodeIds,
  anchor,
  panelWidth,
  onPanelWidthChange,
}: {
  projectId: string
  node: CanvasFlowNode
  incomingNodes: CanvasFlowNode[]
  referenceNodes: CanvasFlowNode[]
  onDraftChange: (patch: Record<string, unknown>) => void
  onGenerate: (request: CanvasGenerateRequest) => Promise<void>
  onReplace: () => void
  onClose: () => void
  onFocus: () => void
  onAddReferences?: (request: { type: 'all' | 'image' | 'video' | 'audio'; maxSelected: number }) => void
  injectedReferenceNodeIds?: string[]
  anchor?: CanvasGeneratorAnchor | null
  panelWidth: number
  onPanelWidthChange: (width: number) => void
}) {
  const { generationAllowed, generationDisabledReason } = useAccountBalance()
  const type = nodeKind(node)
  const isPanorama = type === 'image' && node.data.processType === 'panorama_720'
  const isImageEdit = type === 'image' && node.data.processType === 'image_edit'
  const [inputMode, setInputMode] = useState<CanvasVideoEditorMode>(() => canvasVideoEditorMode(node.data.generation?.inputMode))
  const compatibleIncomingNodes = type === 'audio'
    ? incomingNodes.filter((item) => mediaTypeForReference(item) === 'audio')
    : type === 'model3d'
      ? incomingNodes.filter((item) => item.type === 'text' || item.type === 'note' || item.data.mediaType === 'text')
      : type === 'image'
        ? incomingNodes.filter((item) => mediaTypeForReference(item) === 'image')
        : incomingNodes.filter((item) => mediaTypeForReference(item) !== null)
  const incomingSignature = compatibleIncomingNodes.map((item) => item.id).join('|')
  const nodeReferenceSignature = (node.data.generation?.referenceNodeIds || compatibleIncomingNodes.map((item) => item.id)).join('|')
  const mentionAllowedTypes: readonly CanvasMentionMediaType[] = type === 'video'
    ? inputMode === 'text' ? VIDEO_MENTION_TYPES : IMAGE_MENTION_TYPES
    : type === 'image'
      ? IMAGE_MENTION_TYPES
      : type === 'audio'
        ? AUDIO_MENTION_TYPES
        : NO_MENTION_TYPES
  const mentionAssets = useMemo(() => buildCanvasMentionAssets(
    referenceNodes,
    node.id,
    mentionAllowedTypes,
    new Set(incomingNodes.map((item) => item.id)),
  ), [incomingNodes, mentionAllowedTypes, node.id, referenceNodes])
  const [config, setConfig] = useState<GenerationConfig | null>(null)
  const [voiceOptions, setVoiceOptions] = useState<VoiceOption[]>([])
  const [loadingConfig, setLoadingConfig] = useState(true)
  const [prompt, setPrompt] = useState(node.data.prompt || '')
  const [modelKey, setModelKey] = useState(node.data.generation?.modelKey || '')
  const [aspectRatio, setAspectRatio] = useState(() => isPanorama
    ? canvasPanoramaEditorAspectRatio(node.data.generation?.aspectRatio)
    : node.data.generation?.aspectRatio || '16:9')
  const [resolution, setResolution] = useState(node.data.generation?.resolution || (type === 'image' ? '2K' : type === 'video' ? '720p' : ''))
  const [quality, setQuality] = useState<CanvasImageQuality>(node.data.generation?.quality || 'high')
  const [duration, setDuration] = useState(node.data.generation?.duration || (type === 'audio' ? 15 : 5))
  const [fps, setFps] = useState<number | null>(() => optionalPositiveInteger(node.data.generation?.parameters?.fps))
  const [generateAudio, setGenerateAudio] = useState(node.data.generation?.generateAudio ?? true)
  const [count, setCount] = useState(node.data.generation?.count || (node.data.processType === 'storyboard' ? STORYBOARD_COUNTS[0] : 1))
  const [referenceNodeIds, setReferenceNodeIds] = useState<string[]>(node.data.generation?.referenceNodeIds || compatibleIncomingNodes.map((item) => item.id))
  const [storyboard, setStoryboard] = useState(node.data.processType === 'storyboard')
  const [audioMode, setAudioMode] = useState<AudioMode>('tts')
  const [audioVoice, setAudioVoice] = useState(() => String(node.data.generation?.parameters?.voice || ''))
  const [model3dTopology, setModel3dTopology] = useState<'standard' | 'low_poly'>(() => node.data.generation?.parameters?.topology === 'low_poly' ? 'low_poly' : 'standard')
  const [model3dGenerateTexture, setModel3dGenerateTexture] = useState(() => node.data.generation?.parameters?.generateTexture !== false)
  const [model3dPose, setModel3dPose] = useState<'none' | 'a_pose' | 't_pose'>(() => {
    const value = node.data.generation?.parameters?.pose
    return value === 'a_pose' || value === 't_pose' ? value : 'none'
  })
  const [fullscreen, setFullscreen] = useState(false)
  const [autoReferencePreview, setAutoReferencePreview] = useState(true)
  const [hoveredReferenceId, setHoveredReferenceId] = useState<string | null>(null)
  const [moreOpen, setMoreOpen] = useState(false)
  const parameterTriggerRef = useRef<HTMLButtonElement>(null)
  const [quote, setQuote] = useState<GenerationQuote | null>(null)
  const [quoteError, setQuoteError] = useState<string | null>(null)
  const [quoteLoading, setQuoteLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const onDraftChangeRef = useRef(onDraftChange)
  const hydratedInputRef = useRef(`${node.id}|${incomingSignature}`)
  const skipDraftPersistenceRef = useRef(false)
  const lastDraftSignatureRef = useRef('')
  const panelResizeCleanupRef = useRef<(() => void) | null>(null)
  const closeEditorRef = useRef<() => void>(() => undefined)

  useEffect(() => { onDraftChangeRef.current = onDraftChange }, [onDraftChange])

  const quotable = (type === 'image' || type === 'video' || type === 'audio') && Boolean(modelKey)
  const quoteKey = useMemo(() => {
    if (!quotable) return ''
    const params = new URLSearchParams({ type, model: modelKey })
    if (type === 'image') {
      params.set('count', String(storyboard ? normalizeStoryboardCount(count) : count))
      params.set('resolution', resolution)
      params.set('quality', quality)
    } else if (type === 'video') {
      params.set('resolution', resolution)
      params.set('duration', String(duration))
      params.set('generationMode', inputMode === 'firstlastframe' ? 'firstlastframe' : 'normal')
      params.set('generateAudio', String(generateAudio))
      const inputVideoSeconds = quoteInputVideoSeconds(referenceNodeIds, referenceNodes)
      if (inputVideoSeconds > 0) {
        params.set('containsVideoInput', 'true')
        params.set('inputVideoSeconds', String(inputVideoSeconds))
      }
    } else {
      params.set('duration', String(audioMode === 'tts' ? estimateTtsSeconds(prompt) : duration))
    }
    return params.toString()
  }, [audioMode, count, duration, generateAudio, inputMode, modelKey, prompt, quality, quotable, referenceNodeIds, referenceNodes, resolution, storyboard, type])

  useEffect(() => {
    if (!quoteKey) {
      setQuote(null)
      setQuoteError(null)
      return
    }
    let active = true
    setQuoteLoading(true)
    apiFetch(`/api/frameos/generation-quote?${quoteKey}`, { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error(await readApiErrorMessage(response, '获取积分报价失败'))
        return await response.json() as GenerationQuote
      })
      .then((payload) => {
        if (!active) return
        setQuote(payload)
        setQuoteError(null)
      })
      .catch((error: unknown) => {
        if (!active) return
        setQuote(null)
        setQuoteError(error instanceof Error ? error.message : '获取积分报价失败')
      })
      .finally(() => {
        if (active) setQuoteLoading(false)
      })
    return () => { active = false }
  }, [quoteKey])

  useEffect(() => () => panelResizeCleanupRef.current?.(), [])

  useEffect(() => {
    const exitNodeEditor = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      closeEditorRef.current()
    }
    window.addEventListener('keydown', exitNodeEditor)
    return () => window.removeEventListener('keydown', exitNodeEditor)
  }, [])

  useEffect(() => {
    const saved = window.localStorage.getItem('nori.canvas.auto-reference-preview')
    if (saved === '0' || saved === '1') setAutoReferencePreview(saved === '1')
  }, [])

  useEffect(() => {
    if (isPanorama) setAspectRatio(CANVAS_PANORAMA_ASPECT_RATIO)
  }, [isPanorama])

  useEffect(() => {
    const hydrationKey = `${node.id}|${incomingSignature}`
    if (hydratedInputRef.current !== hydrationKey) {
      hydratedInputRef.current = hydrationKey
      skipDraftPersistenceRef.current = true
      lastDraftSignatureRef.current = ''
    }
    setPrompt(node.data.prompt || '')
    setModelKey(node.data.generation?.modelKey || '')
    setAspectRatio(isPanorama
      ? canvasPanoramaEditorAspectRatio(node.data.generation?.aspectRatio)
      : node.data.generation?.aspectRatio || '16:9')
    setResolution(node.data.generation?.resolution || (type === 'image' ? '2K' : type === 'video' ? '720p' : ''))
    setQuality(node.data.generation?.quality || 'high')
    setDuration(node.data.generation?.duration || (type === 'audio' ? 15 : 5))
    setFps(optionalPositiveInteger(node.data.generation?.parameters?.fps))
    setInputMode(canvasVideoEditorMode(node.data.generation?.inputMode))
    setGenerateAudio(node.data.generation?.generateAudio ?? true)
    setCount(node.data.generation?.count || (node.data.processType === 'storyboard' ? STORYBOARD_COUNTS[0] : 1))
    setReferenceNodeIds(node.data.generation?.referenceNodeIds || compatibleIncomingNodes.map((item) => item.id))
    setStoryboard(node.data.processType === 'storyboard')
    setAudioMode('tts')
    setAudioVoice(String(node.data.generation?.parameters?.voice || ''))
    setModel3dTopology(node.data.generation?.parameters?.topology === 'low_poly' ? 'low_poly' : 'standard')
    setModel3dGenerateTexture(node.data.generation?.parameters?.generateTexture !== false)
    const nextModel3dPose = node.data.generation?.parameters?.pose
    setModel3dPose(nextModel3dPose === 'a_pose' || nextModel3dPose === 't_pose' ? nextModel3dPose : 'none')
    setError(null)
    // Only rehydrate when switching nodes or changing the connected inputs.
    // Parent draft writes for the active node must not reset in-progress fields.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incomingSignature, node.id])

  useEffect(() => {
    // Bulk drops and undo/redo may change references without changing the
    // active node or wires. Sync only ids, not the user's in-progress prompt.
    const next = nodeReferenceSignature ? nodeReferenceSignature.split('|') : []
    setReferenceNodeIds((current) => current.join('|') === nodeReferenceSignature ? current : next)
  }, [node.id, nodeReferenceSignature])

  useEffect(() => {
    setLoadingConfig(true)
    Promise.all([
      apiFetch(`/api/frameos/generation-config?projectId=${encodeURIComponent(projectId)}`).then(async (response) => {
        if (!response.ok) throw new Error(await readApiErrorMessage(response, '加载生成模型失败'))
        return await response.json() as GenerationConfig
      }),
      apiFetch('/api/asset-hub/voices').then(async (response) => response.ok
        ? await response.json() as { voices?: Array<{ name?: string | null; voiceId?: string | null; voiceType?: string | null; customVoiceUrl?: string | null }> }
        : { voices: [] }),
    ]).then(([next, voicePayload]) => {
      if (!next?.defaults || typeof next.defaults !== 'object') throw new Error('生成模型配置不完整，请刷新后重试')
      setConfig(next)
      const voices = (voicePayload.voices || []).flatMap((voice) => {
        const label = voice.name?.trim() || '未命名音色'
        const voiceId = voice.voiceType === 'kuaizi' ? voice.voiceId?.trim() : ''
        if (voiceId) return [{ value: `kuaizi-voice:${voiceId}`, label: `${label} · MiniMax` }]
        const referenceAudio = voice.customVoiceUrl?.trim()
        return referenceAudio ? [{ value: `kuaizi-audio:${referenceAudio}`, label: `${label} · Seed Audio` }] : []
      })
      setVoiceOptions(Array.from(new Map(voices.map((voice) => [voice.value, voice])).values()))
    }).catch((loadError) => setError(loadError instanceof Error ? loadError.message : '加载生成模型失败'))
      .finally(() => setLoadingConfig(false))
  }, [projectId])

  const availableModels = useMemo(() => {
    const mapModel = (model: ModelOption) => ({ key: model.modelKey, label: `${model.name} · ${MODEL_TIER_LABELS[model.tier || 'standard']}`, raw: model })
    if (type === 'text') return (config?.textModels || []).map(mapModel)
    if (type === 'image') return (config?.imageModels || []).map(mapModel)
    if (type === 'video') return (config?.videoModels || []).map(mapModel)
    if (type === 'audio') return (config?.audioModels || []).map(mapModel)
    if (type === 'model3d') return (config?.model3dModels || []).map((model) => ({ key: model.modelKey, label: model.name, raw: model }))
    return []
  }, [config, type])

  useEffect(() => {
    if (loadingConfig || availableModels.length === 0) return
    const configuredDefault = type === 'text' ? config?.defaults.textModel
      : type === 'image'
      ? node.data.processType === 'image_edit' ? config?.defaults.editModel : storyboard ? config?.defaults.storyboardModel : config?.defaults.imageModel
      : type === 'video' ? config?.defaults.videoModel : type === 'audio' ? config?.defaults.audioModel : null
    const effectiveDefault = type === 'model3d' ? config?.defaults.model3dModel : configuredDefault
    const configuredModels = availableModels.filter((model) => model.raw?.available !== false)
    const selectableModels = isImageEdit
      ? configuredModels.filter((model) => model.raw?.supportsInpaint === true)
      : configuredModels
    setModelKey((current) => selectableModels.some((model) => model.key === current)
      ? current
      : selectableModels.some((model) => model.key === effectiveDefault)
        ? effectiveDefault || ''
        : selectableModels[0]?.key || effectiveDefault || availableModels[0].key)
  }, [availableModels, config, isImageEdit, loadingConfig, node.data.processType, storyboard, type])

  const currentModel = availableModels.find((model) => model.key === modelKey)
  const videoAspectRatios = useMemo(
    () => canvasVideoAspectRatioOptions(modelKey, inputMode),
    [inputMode, modelKey],
  )

  useEffect(() => {
    if (type !== 'video' || !currentModel) return
    if (currentModel.raw?.supportGenerateAudio !== true) {
      setGenerateAudio(false)
      return
    }
    if (node.data.generation?.generateAudio === undefined) setGenerateAudio(true)
  }, [currentModel, node.data.generation?.generateAudio, type])
  const audioModeModels = useMemo(() => Object.fromEntries(AUDIO_MODES.map((item) => {
    const candidates = availableModels.filter((model) => (
      model.raw?.available !== false
      && (model.raw?.audioModes || []).includes(item.value)
    ))
    const preferred = candidates.find((model) => model.key === AUDIO_MODE_PREFERRED_MODEL_KEYS[item.value])
    return [item.value, preferred || candidates[0] || null]
  })) as Record<AudioMode, (typeof availableModels)[number] | null>, [availableModels])


  const imageEditModelUnavailable = isImageEdit && currentModel?.raw?.supportsInpaint !== true
  const modelResolutions = useMemo(() => modelOptions(currentModel?.raw || undefined, 'resolution'), [currentModel?.raw])
  const surfaceResolutions = useMemo<readonly string[]>(
    () => type === 'image' ? CANVAS_IMAGE_RESOLUTIONS : type === 'video' ? CANVAS_VIDEO_RESOLUTIONS : [],
    [type],
  )
  const supportedResolutions = useMemo(
    () => modelResolutions.length > 0
      ? surfaceResolutions.filter((value) => modelResolutions.includes(value))
      : [...surfaceResolutions],
    [modelResolutions, surfaceResolutions],
  )
  const durations = useMemo(() => modelOptions(currentModel?.raw || undefined, 'duration').map(Number).filter(Number.isFinite), [currentModel?.raw])
  const fpsOptions = useMemo(() => modelOptions(currentModel?.raw || undefined, 'fps').map(Number).filter((value) => Number.isInteger(value) && value > 0), [currentModel?.raw])
  const videoDurationOptions = useMemo(() => {
    const supported = durations.filter((value) => Number.isInteger(value) && value >= CANVAS_VIDEO_DURATION_MIN && value <= CANVAS_VIDEO_DURATION_MAX)
    return supported.length > 0
      ? Array.from(new Set(supported)).sort((left, right) => left - right)
      : Array.from({ length: CANVAS_VIDEO_DURATION_MAX - CANVAS_VIDEO_DURATION_MIN + 1 }, (_, index) => CANVAS_VIDEO_DURATION_MIN + index)
  }, [durations])
  const referenceImages = useMemo(
    () => referenceNodes.filter((item) => item.type === 'image' || item.data.mediaType === 'image'),
    [referenceNodes],
  )
  const maximumVideoReferenceImages = currentModel?.raw?.inputSchema?.image.max ?? 9
  const supportsImageToVideo = maximumVideoReferenceImages > 0
  const effectiveInputSchema = useMemo(() => {
    if (type === 'video' && inputMode === 'firstlastframe') return firstLastFrameInputSchema()
    if (type === 'video' && inputMode === 'image') return imageToVideoInputSchema(maximumVideoReferenceImages)
    if (type === 'image' || type === 'video' || type === 'audio') {
      return currentModel?.raw?.inputSchema || resolveCanvasGenerationInputSchema(type)
    }
    return null
  }, [currentModel?.raw?.inputSchema, inputMode, maximumVideoReferenceImages, type])
  const selectedReferenceSummaries = useMemo(() => referenceNodeIds.flatMap((id, index) => {
    const selected = referenceNodes.find((item) => item.id === id)
    const role: CanvasGenerationReferenceRole = type === 'video' && inputMode === 'firstlastframe'
      ? index === 0 ? 'FIRST_FRAME' : 'LAST_FRAME'
      : 'REF'
    const summary = selected ? referenceSummary(selected, role) : null
    return summary ? [summary] : []
  }), [inputMode, referenceNodeIds, referenceNodes, type])
  const missingReferenceCount = referenceNodeIds.filter((id) => !referenceNodes.some((item) => item.id === id)).length
  const visibleIncomingNodes = type === 'video' && inputMode !== 'text'
    ? compatibleIncomingNodes.filter((item) => mediaTypeForReference(item) === 'image')
    : compatibleIncomingNodes
  const displayedReferenceNodes = useMemo(() => {
    const visibleIds = new Set(visibleIncomingNodes.map((item) => item.id))
    const selected = referenceNodeIds.flatMap((id) => {
      if (visibleIds.has(id)) return []
      const reference = referenceNodes.find((item) => item.id === id)
      if (!reference) return []
      if (type === 'video' && inputMode !== 'text' && mediaTypeForReference(reference) !== 'image') return []
      return [reference]
    })
    return [...visibleIncomingNodes, ...selected]
  }, [inputMode, referenceNodeIds, referenceNodes, type, visibleIncomingNodes])
  const characterVoiceSummary = useMemo(() => {
    if (type !== 'video') return null
    const characterRefs = displayedReferenceNodes.filter((item) => (
      (item.data.mediaType || item.type) === 'image'
      && frameosAssetCategoryFromMetadata(item.data.sourceMetadata) === 'character'
    ))
    if (characterRefs.length === 0) return null
    const bound = characterRefs.filter((item) => Boolean(characterVoiceMaterialId(item.data.sourceMetadata))).length
    return { total: characterRefs.length, bound, missing: characterRefs.length - bound }
  }, [displayedReferenceNodes, type])
  const characterVoiceHint = characterVoiceSummary
    ? inputMode !== 'text'
      ? `${inputMode === 'image' ? '图生视频' : '首尾帧'}不提交角色音色；当前 ${characterVoiceSummary.total} 个角色中 ${characterVoiceSummary.bound} 个已绑定。`
      : !generateAudio
        ? `已关闭「同步生成声音」，本次不会提交角色音色${characterVoiceSummary.bound > 0 ? `（已绑定 ${characterVoiceSummary.bound} 个）` : ''}。`
        : characterVoiceSummary.bound > 0
          ? `全能参考将自动带入 ${characterVoiceSummary.bound} 个角色音色${characterVoiceSummary.missing > 0 ? `；另有 ${characterVoiceSummary.missing} 个角色缺音色` : ''}。`
          : `当前 ${characterVoiceSummary.total} 个角色均未绑定音色，生成时不会带入角色音频。`
    : null
  const characterVoiceHintTone = characterVoiceSummary && inputMode === 'text' && generateAudio
    ? characterVoiceSummary.missing > 0 ? ' is-warning' : ''
    : ' is-muted'
  const hoveredReference = autoReferencePreview && hoveredReferenceId
    ? displayedReferenceNodes.find((item) => item.id === hoveredReferenceId) || null
    : null
  const hoveredReferenceUrl = hoveredReference
    ? toDisplayImageUrl(hoveredReference.data.contentUrl || hoveredReference.data.imageUrl || hoveredReference.data.videoUrl || hoveredReference.data.posterUrl || null)
    : null

  useEffect(() => {
    if (supportedResolutions.length > 0) {
      setResolution((current) => resolveSupportedResolution(
        current,
        type === 'video' ? config?.defaults.resolution || '' : type === 'image' ? '2K' : '',
        supportedResolutions,
      ))
    }
    if (type === 'video' && videoDurationOptions.length > 0) setDuration((current) => videoDurationOptions.includes(current) ? current : videoDurationOptions[0])
    if (type === 'video') setFps((current) => fpsOptions.length > 0 ? current !== null && fpsOptions.includes(current) ? current : fpsOptions[0] : null)
    // 配置还没加载完或尚未解析出当前模型时，不能把「图生视频 / 首尾帧」当作不支持，
    // 否则打开已保存的首尾帧节点会被错误降级成全能参考。等模型能力就绪后再降级。
    if (currentModel) {
      if (!supportsImageToVideo && inputMode === 'image') setInputMode('text')
      if (currentModel.raw?.firstLastFrame !== true && inputMode === 'firstlastframe') setInputMode('text')
    }
    if (type === 'video') {
      setAspectRatio((current) => videoAspectRatios.includes(current as (typeof videoAspectRatios)[number])
        ? current
        : videoAspectRatios[0] || '16:9')
    }
  }, [config?.defaults.resolution, currentModel, fpsOptions, inputMode, supportedResolutions, supportsImageToVideo, type, videoAspectRatios, videoDurationOptions])

  useEffect(() => {
    if (type !== 'video' || inputMode === 'text') return
    setReferenceNodeIds((current) => {
      const limit = inputMode === 'firstlastframe' ? 2 : effectiveInputSchema?.image.max || 9
      const next = current.filter((id) => referenceImages.some((item) => item.id === id)).slice(0, limit)
      return next.length === current.length && next.every((id, index) => id === current[index]) ? current : next
    })
  }, [effectiveInputSchema?.image.max, inputMode, referenceImages, type])

  const usesReferenceAudio = currentModel?.raw?.runtimeModelKey?.split('::')[1] === 'seed-audio'
  const voiceProtocol = usesReferenceAudio ? 'kuaizi-audio:' : 'kuaizi-voice:'
  const compatibleVoiceOptions = useMemo(
    () => voiceOptions.filter((voice) => voice.value.startsWith(voiceProtocol)),
    [voiceOptions, voiceProtocol],
  )

  useEffect(() => {
    if (type !== 'audio') return
    setAudioMode('tts')
    setAudioVoice((current) => compatibleVoiceOptions.some((voice) => voice.value === current)
      ? current
      : compatibleVoiceOptions[0]?.value || '')
  }, [compatibleVoiceOptions, type])

  const draftPatch = useMemo(() => ({
      prompt,
      processType: storyboard ? 'storyboard' : node.data.processType === 'storyboard' ? undefined : node.data.processType,
      generation: {
        ...(node.data.generation || {}),
        modelKey,
        modelLabel: currentModel?.label || '',
        inputSchema: currentModel?.raw?.inputSchema || null,
        referenceNodeIds,
        referenceSummary: selectedReferenceSummaries,
        aspectRatio,
        resolution,
        ...(type === 'image' ? { quality } : {}),
        duration,
        inputMode,
        generateAudio,
        count: storyboard ? normalizeStoryboardCount(count) : count,
        parameters: type === 'audio'
          ? { ...(node.data.generation?.parameters || {}), mode: audioMode, voice: audioVoice, genre: '', sfxKind: '' }
          : type === 'model3d'
            ? { ...(node.data.generation?.parameters || {}), topology: model3dTopology, generateTexture: model3dGenerateTexture, pose: model3dPose }
            : type === 'video'
              ? videoGenerationParameters(node.data.generation?.parameters, fps)
              : node.data.generation?.parameters,
      },
    }), [aspectRatio, audioMode, audioVoice, count, currentModel?.label, currentModel?.raw?.inputSchema, duration, fps, generateAudio, inputMode, model3dGenerateTexture, model3dPose, model3dTopology, modelKey, node.data.generation, node.data.processType, prompt, quality, referenceNodeIds, resolution, selectedReferenceSummaries, storyboard, type])
  const draftSignature = useMemo(() => JSON.stringify(draftPatch), [draftPatch])

  const persistDraft = (patch: Record<string, unknown> = draftPatch) => {
    const signature = JSON.stringify(patch)
    if (signature === lastDraftSignatureRef.current) return
    lastDraftSignatureRef.current = signature
    onDraftChangeRef.current(patch)
  }

  useEffect(() => {
    if (skipDraftPersistenceRef.current) {
      skipDraftPersistenceRef.current = false
      return
    }
    if (draftSignature === lastDraftSignatureRef.current) return
    lastDraftSignatureRef.current = draftSignature
    onDraftChangeRef.current(draftPatch)
  }, [draftPatch, draftSignature])

  const referenceErrors = (ids: string[], strict: boolean) => {
    if (!effectiveInputSchema) return []
    if (strict) {
      try { requireExistingReferenceNodeIds(ids, referenceNodes) }
      catch (error) { return [error instanceof Error ? error.message : '引用素材失效，请重新选择。'] }
    }
    const summaries = ids.flatMap((id) => {
      const selected = referenceNodes.find((item) => item.id === id)
      const summary = selected ? referenceSummary(selected) : null
      return summary ? [summary] : []
    })
    return [
      ...validateCanvasReferenceMedia(effectiveInputSchema, summaries, {
        enforceMinimums: strict,
        requireKnownAudioDuration: strict,
      }),
      ...(type === 'video' && strict ? validateVideoReferenceMediaCombination(summaries, {
        allowAudioOnly: isSeedance25VideoModelKey(modelKey),
      }) : []),
    ]
  }

  const selectMentionAsset = (asset: MentionPromptAsset, nextPrompt: string) => {
    if (!shouldBindCanvasMentionReference(type)) {
      setError(null)
      setPrompt(nextPrompt)
      return
    }
    const nextReferenceNodeIds = mergeCanvasReferenceNodeIds(referenceNodeIds, asset.id)
    const errors = referenceErrors(nextReferenceNodeIds, false)
    if (errors.length > 0) { setError(errors[0]); return }
    setError(null)
    setPrompt(nextPrompt)
    setReferenceNodeIds(nextReferenceNodeIds)
  }

  const toggleReferenceNode = (reference: CanvasFlowNode) => {
    setReferenceNodeIds((current) => {
      if (current.includes(reference.id)) {
        setError(null)
        return current.filter((id) => id !== reference.id)
      }
      const next = [...current, reference.id]
      const errors = referenceErrors(next, false)
      if (errors.length > 0) {
        setError(errors[0])
        return current
      }
      setError(null)
      return next
    })
  }

  // 从素材库挑选的引用素材会先落到画布成为节点，再通过这个注入合并进来，
  // 因此引用关系不依赖用户手动画线。
  const injectedSignature = (injectedReferenceNodeIds || []).join('|')
  const injectionRef = useRef({ ids: injectedReferenceNodeIds, validate: referenceErrors })
  injectionRef.current = { ids: injectedReferenceNodeIds, validate: referenceErrors }
  useEffect(() => {
    const ids = injectionRef.current.ids || []
    if (ids.length === 0) return
    setReferenceNodeIds((current) => {
      const next = [...current]
      for (const id of ids) if (!next.includes(id)) next.push(id)
      if (next.length === current.length) return current
      const errors = injectionRef.current.validate(next, false)
      if (errors.length > 0) { setError(errors[0]); return current }
      setError(null)
      return next
    })
    // 只有新的注入批次才需要合并，签名保证同一批不会重复触发。
  }, [injectedSignature])

  const submit = async () => {
    if (!generationAllowed) { setError(generationDisabledReason || '当前账号不可生成'); return }
    const upstreamText = incomingNodes
      .filter((item) => item.type === 'text' || item.type === 'note' || item.data.mediaType === 'text')
      .map((item) => item.data.text?.trim() || '')
      .filter(Boolean)
      .join('\n\n')
    const cleanPrompt = prompt.trim() || upstreamText
    if (!cleanPrompt) { setError('请输入提示词，或连接一个文本节点。'); return }
    if (!modelKey) { setError('暂无可用生成模型，请先在服务配置中接入。'); return }
    if (currentModel?.raw?.available === false) { setError(currentModel.raw.unavailableReason || '3D 模型服务尚未配置。'); return }
    if (imageEditModelUnavailable) { setError('当前图片模型不支持蒙版重绘，请在管理平台接入并选择支持 Inpaint 的模型。'); return }
    if (effectiveInputSchema) {
      const requiredErrors = validateCanvasRequiredFields(effectiveInputSchema, {
        prompt: cleanPrompt,
        quotedCostPoints: quote?.points ?? null,
        voice: audioVoice,
        inputMode,
        aspectRatio,
        resolution,
        quality,
        duration,
        ...(fps !== null ? { fps } : {}),
        generateAudio,
      })
      const mediaErrors = referenceErrors(referenceNodeIds, true)
      const validationError = requiredErrors[0] || mediaErrors[0]
      if (validationError) { setError(validationError); return }
    }
    if (type === 'audio' && !(currentModel?.raw?.audioModes || []).includes(audioMode)) {
      setError('当前音频服务不支持该生成模式。')
      return
    }
    setSubmitting(true)
    setError(null)
    // Commit the current draft before autosave builds the generation snapshot.
    // Otherwise the revision may be acknowledged before newly added references
    // or the current settings have reached nodesRef.
    flushSync(() => persistDraft({
      ...draftPatch,
      prompt: cleanPrompt,
      generation: { ...draftPatch.generation, referenceNodeIds },
    }))
    try {
      await onGenerate({
        nodeId: node.id,
        type,
        prompt: cleanPrompt,
        modelKey,
        modelLabel: currentModel?.label || modelKey,
        referenceNodeIds,
        referenceSummary: selectedReferenceSummaries,
        inputMode,
        aspectRatio,
        resolution,
        quality,
        duration,
        ...(fps !== null ? { fps } : {}),
        generateAudio,
        count: storyboard ? normalizeStoryboardCount(count) : count,
        storyboard,
        audioMode,
        audioVoice,
        audioGenre: '',
        audioSfxKind: '',
        model3dTopology,
        model3dGenerateTexture,
        model3dPose,
      })
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '生成提交失败')
    } finally {
      setSubmitting(false)
    }
  }

  const toggleStoryboard = () => {
    setStoryboard((current) => {
      const next = !current
      if (next) setCount((currentCount) => normalizeStoryboardCount(currentCount))
      return next
    })
  }

  const closeEditor = () => {
    persistDraft()
    onClose()
  }
  closeEditorRef.current = closeEditor

  const startPanelResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (fullscreen) return
    event.preventDefault()
    event.stopPropagation()
    panelResizeCleanupRef.current?.()
    const startWidth = panelWidth
    const startClientX = event.clientX
    const panel = event.currentTarget.closest<HTMLElement>('.nori-canvas-generator')
    const interfaceScale = panel ? panel.getBoundingClientRect().width / panelWidth : 1
    const viewportWidth = panel?.closest<HTMLElement>('.nori-canvas-workspace')?.clientWidth || window.innerWidth
    const move = (moveEvent: PointerEvent) => {
      onPanelWidthChange(resizeCanvasGeneratorPanelWidth({
        startWidth,
        startClientX,
        clientX: moveEvent.clientX,
        viewportWidth,
        interfaceScale,
      }))
    }
    const cleanup = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', cleanup)
      window.removeEventListener('pointercancel', cleanup)
      panelResizeCleanupRef.current = null
    }
    panelResizeCleanupRef.current = cleanup
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', cleanup)
    window.addEventListener('pointercancel', cleanup)
  }

  const resizePanelByKeyboard = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    event.stopPropagation()
    const delta = event.key === 'ArrowRight' ? 40 : -40
    onPanelWidthChange(clampCanvasGeneratorPanelWidth(panelWidth + delta, window.innerWidth))
  }

  const TypeIcon = type === 'text' ? Type : type === 'video' ? Film : type === 'audio' ? Music2 : type === 'model3d' ? Box : ImageIcon
  const referencePickerType: 'all' | 'image' | 'video' | 'audio' | null = type === 'video'
    ? inputMode === 'text' ? 'all' : 'image'
    : type === 'image'
      ? 'image'
      : type === 'audio'
        ? 'audio'
        : null
  const referencePickerMax = resolveReferencePickerMax(referencePickerType, {
    image: effectiveInputSchema?.image.max || 0,
    video: effectiveInputSchema?.video.max || 0,
    audio: effectiveInputSchema?.audio.max || 0,
  })
  const qualityLabel = quality === 'low' ? '低' : quality === 'medium' ? '中' : '高'
  const parameterSummary = type === 'image'
    ? `${aspectRatio} · ${resolution || '默认'} · ${qualityLabel} · ${storyboard ? normalizeStoryboardCount(count) : count}${storyboard ? '镜' : '张'}`
    : type === 'video'
      ? `${inputMode === 'image' ? '图生' : inputMode === 'firstlastframe' ? '首尾帧' : '全能参考'} · ${aspectRatio} · ${resolution || '默认'} · ${duration}s${fps !== null ? ` · ${fps}FPS` : ''}${generateAudio ? ' · 有声' : ''}`
      : ''
  const anchorStyle = !fullscreen && anchor
    ? {
        left: `${anchor.x}px`,
        top: `${anchor.y}px`,
        bottom: 'auto',
        transform: anchor.placement === 'above' ? 'translate(-50%, -100%)' : 'translateX(-50%)',
      }
    : undefined
  return (
    <aside className={`nori-canvas-generator${fullscreen ? ' is-fullscreen' : ''}${anchor && !fullscreen ? ' is-node-anchored' : ''}`} data-editor-mode={fullscreen ? 'expanded' : 'anchored'} data-anchor-placement={anchor?.placement} style={{ ...anchorStyle, ...(fullscreen ? {} : { width: `${panelWidth}px` }) }} onPointerDown={(event) => event.stopPropagation()}>
      {anchor && !fullscreen ? <span className="nori-canvas-generator-tether" aria-hidden="true" style={{ left: `${anchor.tetherX}px`, height: `${anchor.tetherLength}px` }} /> : null}
      <div className="nori-canvas-generator-scroll" style={!fullscreen && anchor ? { maxHeight: `${anchor.maxHeight}px` } : undefined}>
      {!fullscreen ? <div className="nori-canvas-generator-width-handle" role="separator" aria-orientation="vertical" aria-label="调整提示词面板宽度" aria-valuemin={CANVAS_GENERATOR_PANEL_WIDTH_MIN} aria-valuemax={CANVAS_GENERATOR_PANEL_WIDTH_MAX} aria-valuenow={panelWidth} tabIndex={0} onPointerDown={startPanelResize} onKeyDown={resizePanelByKeyboard}><span /></div> : null}
      <div className="nori-canvas-generator-head">
        {type === 'video' ? (
          <div className="nori-canvas-generator-mode-tabs" role="group" aria-label="视频生成方式">
            {([['text', '全能参考', true], ['image', '图生视频', supportsImageToVideo], ['firstlastframe', '首尾帧', Boolean(currentModel?.raw?.firstLastFrame)]] as const).map(([value, label, enabled]) => (
              <button type="button" key={value} className={inputMode === value ? 'is-active' : ''} aria-pressed={inputMode === value} disabled={!enabled} onClick={() => setInputMode(value)}>{label}</button>
            ))}
          </div>
        ) : <span><TypeIcon />{type === 'text' ? '文本生成' : type === 'audio' ? '音频生成' : type === 'model3d' ? '3D 模型生成' : isPanorama ? '720 全景生成' : '图像生成'}</span>}
        {(type === 'image' || type === 'video') && displayedReferenceNodes.length > 0 ? <label className="nori-canvas-generator-auto-preview" title="开启后，鼠标悬停引用素材会自动放大预览"><input type="checkbox" checked={autoReferencePreview} onChange={(event) => { const checked = event.target.checked; window.localStorage.setItem('nori.canvas.auto-reference-preview', checked ? '1' : '0'); setAutoReferencePreview(checked); if (!checked) setHoveredReferenceId(null) }} /><span>自动放大</span></label> : null}
        <div className="nori-canvas-generator-head-actions">
          {fullscreen ? <button type="button" className="nori-canvas-generator-back" title="返回画布" onClick={() => { persistDraft(); setFullscreen(false) }}><ArrowLeft /><span>返回画布</span></button> : null}
          {type !== 'text' ? <button type="button" aria-label="替换当前节点内容" title="替换当前节点内容" onClick={() => { persistDraft(); onReplace() }}><Upload /></button> : null}
          <button type="button" aria-label={fullscreen ? '返回画布' : '展开大编辑器'} title={fullscreen ? '返回画布' : '展开大编辑器'} onClick={() => { persistDraft(); setFullscreen((value) => !value) }}>{fullscreen ? <Minimize2 /> : <Maximize2 />}</button>
          <button type="button" aria-label="关闭节点编辑器" title="关闭节点编辑器" onClick={closeEditor}><X /></button>
        </div>
      </div>

      <div className="nori-canvas-generator-content">
      {type === 'image' || type === 'video' || type === 'audio' ? (
        <div className="nori-canvas-generator-refs">
          <span className="nori-canvas-generator-refs-label">引用素材</span>
          {type === 'image' && !isPanorama ? <button type="button" className="nori-canvas-generator-entry" title={storyboard ? '故事版模式下不可使用聚焦' : displayedReferenceNodes.length > 0 ? '框选画面局部作为聚焦参考' : '请先添加或连接一张图片'} disabled={storyboard || displayedReferenceNodes.length === 0} onClick={onFocus}><Focus /><span>聚焦</span></button> : null}
          {type === 'image' && !isPanorama ? <button type="button" className={`nori-canvas-generator-entry${storyboard ? ' is-active' : ''}`} onClick={toggleStoryboard}><LayoutGrid /><span>故事版</span></button> : null}
          {displayedReferenceNodes.map((incoming) => <ReferenceThumb key={incoming.id} node={incoming} selected={referenceNodeIds.includes(incoming.id)} onToggle={() => toggleReferenceNode(incoming)} onHover={setHoveredReferenceId} />)}
          {onAddReferences && referencePickerType ? <button type="button" className="nori-canvas-generator-ref-add" title="从素材库添加引用素材（无需连线）" aria-label="添加引用素材" onClick={() => onAddReferences({ type: referencePickerType, maxSelected: referencePickerMax })}><Plus /><span aria-hidden="true">参考</span></button> : null}
        </div>
      ) : null}
      {characterVoiceHint ? <p className={`nori-canvas-generator-voice-hint${characterVoiceHintTone}`}>{characterVoiceHint}</p> : null}

      {missingReferenceCount > 0 ? <div role="alert" className="nori-canvas-generator-reference-warning">
        <span>有 {missingReferenceCount} 个引用节点已删除。请清除失效引用或重新添加素材；不会自动提交缺少素材的生成。</span>
        <button type="button" onClick={() => {
          const existing = new Set(referenceNodes.map((item) => item.id))
          const nextIds = referenceNodeIds.filter((id) => existing.has(id))
          setReferenceNodeIds(nextIds)
          persistDraft({
            ...draftPatch,
            generation: {
              ...draftPatch.generation,
              referenceNodeIds: nextIds,
              referenceSummary: selectedReferenceSummaries.map((summary, index) => ({
                ...summary,
                role: type === 'video' && inputMode === 'firstlastframe' ? index === 0 ? 'FIRST_FRAME' : 'LAST_FRAME' : 'REF',
              })),
            },
          })
          setError(null)
        }}>清除失效引用</button>
      </div> : null}

      {hoveredReference && hoveredReferenceUrl ? <div className="nori-canvas-generator-ref-preview" onPointerEnter={() => setHoveredReferenceId(hoveredReference.id)} onPointerLeave={() => setHoveredReferenceId(null)}><strong>{hoveredReference.data.title || '参考素材'}</strong>{mediaTypeForReference(hoveredReference) === 'video' ? <video src={toPlayableVideoUrl(hoveredReferenceUrl) || hoveredReferenceUrl} muted autoPlay loop playsInline /> : <MediaImage src={hoveredReferenceUrl} alt={hoveredReference.data.title || '参考素材'} fill sizes="360px" style={{ objectFit: 'contain' }} />}</div> : null}

      {storyboard ? <p className="nori-canvas-storyboard-hint">描述一个 10–15 秒内能演完的小剧情片段，系统会生成 {normalizeStoryboardCount(count)} 个连续分镜。</p> : null}
      {isImageEdit ? <p className="nori-canvas-storyboard-hint">白色涂抹区域会作为独立蒙版提交；仅可选择明确支持 Inpaint 的图片模型。</p> : null}
      {isPanorama ? <p className="nori-canvas-storyboard-hint">生成无缝 21:9 超宽幅全景图；完成后可进入球形预览并生成四视角或十二视角截图。</p> : null}
      {type === 'model3d' ? <p className="nori-canvas-storyboard-hint">输入物体或角色描述，帧界 3D 1.0 将生成可预览、下载并送入 3D 导演台的 GLB 模型。</p> : null}
      <div className="nori-canvas-generator-prompt">
        {mentionAllowedTypes.length > 0 ? (
          <MentionPromptEditor
            className="nori-canvas-mention-editor"
            value={prompt}
            assets={mentionAssets}
            onChange={setPrompt}
            onSelectAsset={selectMentionAsset}
            onBlur={() => persistDraft()}
            menuLabel="选择画布参考素材"
            hint={type === 'video'
              ? inputMode === 'text'
                ? '输入 @ 可引用画布中的图片、视频或音频；蓝色素材名会与实体引用一并保存。'
                : inputMode === 'image'
                  ? '图生视频模式只接收图片引用；至少选择一张图片。'
                  : '首尾帧模式只接收图片引用；选择顺序对应首帧和尾帧。'
              : type === 'audio'
                ? '输入 @ 可插入画布音频素材名；当前音频模型仅接收文本，不会把它作为声音条件输入。'
                : '输入 @ 可引用画布图片；蓝色素材名会与实体引用一并保存。'}
            minHeight={fullscreen ? 280 : 96}
            placeholder={type === 'video' ? '描述你想要的视频，@引用素材' : type === 'audio' ? '输入要合成语音的台词' : isPanorama ? '描述场景的四周、地面、天空与光影，生成无缝全景图' : '描述你想要的图像，@引用素材'}
          />
        ) : (
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            onBlur={() => persistDraft()}
            placeholder={type === 'text' ? '描述你想要的文本，例：「写一段儿童剧的开场白」' : type === 'audio' ? '输入要合成语音的台词' : type === 'model3d' ? '描述物体、角色造型、材质与关键细节' : '描述你想生成的内容'}
          />
        )}
      </div>

      {type === 'audio' ? <div className="nori-canvas-audio-generator-options">
        <div>{AUDIO_MODES.map((item) => {
          const modeModel = audioModeModels[item.value]
          const supported = Boolean(modeModel)
          return <button type="button" key={item.value} disabled={!supported} title={supported ? `使用 ${modeModel?.label}` : '尚未配置支持该模式的真实音频模型'} className={audioMode === item.value ? 'is-active' : ''} onClick={() => { if (modeModel) { setModelKey(modeModel.key); setAudioMode(item.value) } }}>{item.label}</button>
        })}</div>
        {audioMode === 'tts' ? <label><Music2 /><span>嗓音</span><select value={audioVoice} onChange={(event) => setAudioVoice(event.target.value)} disabled={compatibleVoiceOptions.length === 0}>{compatibleVoiceOptions.length === 0 ? <option value="">{usesReferenceAudio ? '请先在资产库上传参考音频' : '请先在资产库绑定 Kuaizi 音色 ID'}</option> : compatibleVoiceOptions.map((voice) => <option key={voice.value} value={voice.value}>{voice.label}</option>)}</select></label> : null}
      </div> : null}

      {type === 'model3d' ? <div className="nori-canvas-model3d-options">
        <div className="nori-canvas-model3d-option"><span>模型精度</span><div><button type="button" className={model3dTopology === 'standard' ? 'is-active' : ''} onClick={() => setModel3dTopology('standard')}>标准</button><button type="button" className={model3dTopology === 'low_poly' ? 'is-active' : ''} onClick={() => setModel3dTopology('low_poly')}>低模</button></div></div>
        <label className="nori-canvas-model3d-texture"><input type="checkbox" checked={model3dGenerateTexture} onChange={(event) => setModel3dGenerateTexture(event.target.checked)} /><span>生成贴图</span></label>
        <div className="nori-canvas-model3d-option"><span>角色姿势</span><div><button type="button" className={model3dPose === 'none' ? 'is-active' : ''} onClick={() => setModel3dPose('none')}>无</button><button type="button" className={model3dPose === 'a_pose' ? 'is-active' : ''} onClick={() => setModel3dPose('a_pose')}>A 姿势</button><button type="button" className={model3dPose === 't_pose' ? 'is-active' : ''} onClick={() => setModel3dPose('t_pose')}>T 姿势</button></div></div>
      </div> : null}

      {currentModel?.raw?.available === false ? <div className="nori-canvas-generator-error">{currentModel.raw.unavailableReason || '当前模型服务尚未配置。'}</div> : null}
      {error ? <div className="nori-canvas-generator-error">{error}</div> : null}
      </div>
      <div className="nori-canvas-generator-controls">
        <div className="nori-canvas-generator-settings-row">
        <label className="nori-canvas-generator-select">
          <select value={modelKey} onChange={(event) => setModelKey(event.target.value)} disabled={loadingConfig || availableModels.length === 0}>
            {availableModels.length === 0 ? <option value="">{loadingConfig ? '正在加载模型…' : type === 'audio' ? '音频模型未配置' : type === 'model3d' ? '3D 模型未配置' : '暂无模型'}</option> : availableModels.map((model) => {
              const inpaintUnsupported = isImageEdit && model.raw?.supportsInpaint !== true
              const disabled = model.raw?.available === false || inpaintUnsupported
              const availabilityLabel = model.raw?.available === false
                ? model.raw.healthStatus === 'unhealthy' ? ' · 服务异常' : ' · 未配置'
                : ''
              return <option key={model.key} value={model.key} disabled={disabled}>{model.label}{availabilityLabel}{inpaintUnsupported ? ' · 不支持蒙版重绘' : ''}</option>
            })}
          </select>
          <ChevronDown />
        </label>
        {(type === 'image' || type === 'video') ? <button ref={parameterTriggerRef} type="button" className={`nori-canvas-parameter-trigger${moreOpen ? ' is-active' : ''}`} aria-label="生成参数" aria-haspopup="dialog" aria-expanded={moreOpen} onClick={() => setMoreOpen((value) => !value)}><SlidersHorizontal /><span><b>生成参数</b><small>{parameterSummary}</small></span><ChevronDown /></button> : null}
        </div>
        <div className="nori-canvas-generator-submit-row">
        {type === 'video' ? <label className="nori-canvas-generator-sound" title={currentModel?.raw?.supportGenerateAudio ? '默认生成有声视频，可按需关闭' : '当前模型不支持生成声音'}><input type="checkbox" checked={generateAudio} disabled={!currentModel?.raw?.supportGenerateAudio} onChange={(event) => setGenerateAudio(event.target.checked)} /><span>生成声音</span></label> : null}
        {quotable ? (
          <span
            className="nori-canvas-generator-quote"
            title={quoteError || undefined}
          >
            {quoteLoading ? '报价中…' : quoteError ? '暂无法报价' : quote ? `预计 ${quote.points.toLocaleString('zh-CN', { maximumFractionDigits: 2 })} 积分` : '—'}
          </span>
        ) : null}
        <button type="button" className="nori-canvas-generate-button" disabled={!generationAllowed || submitting || availableModels.length === 0 || currentModel?.raw?.available === false || imageEditModelUnavailable || (type === 'audio' && audioMode === 'tts' && !audioVoice)} onClick={() => void submit()} title={!generationAllowed ? generationDisabledReason || '当前账号不可生成' : imageEditModelUnavailable ? '当前模型不支持蒙版重绘' : currentModel?.raw?.available === false ? currentModel.raw.unavailableReason || '服务未配置' : type === 'audio' && audioMode === 'tts' && !audioVoice ? '请先在资产库创建并选择音色' : '生成'}><Send /><span>{submitting ? '提交中…' : '生成'}</span></button>
        </div>
      </div>

      {moreOpen && (type === 'image' || type === 'video') ? (
        <ViewportPopover anchorRef={parameterTriggerRef} onClose={() => setMoreOpen(false)} preferredSide="above" width={400} maxHeight={420} role="dialog" aria-label="生成参数设置" className="nori-canvas-generator-more nori-canvas-parameter-popover">
          <header><div><strong>生成参数</strong><small>修改后自动保存到当前节点</small></div><button type="button" aria-label="关闭生成参数" onClick={() => { persistDraft(); setMoreOpen(false); parameterTriggerRef.current?.focus() }}><X /></button></header>
          <div className="nori-canvas-generator-parameter-grid">
            {type === 'video' ? <label><span>生成模式</span><select value={inputMode} onChange={(event) => setInputMode(event.target.value as CanvasVideoEditorMode)}><option value="text">全能参考</option><option value="image" disabled={!supportsImageToVideo}>图生视频</option><option value="firstlastframe" disabled={!currentModel?.raw?.firstLastFrame}>首尾帧</option></select></label> : null}
            <label><span>画面比例</span><select value={aspectRatio} disabled={isPanorama || (type === 'video' && videoAspectRatios.length === 1)} onChange={(event) => setAspectRatio(event.target.value)}>{(isPanorama ? [CANVAS_PANORAMA_ASPECT_RATIO] : type === 'image' ? CANVAS_IMAGE_ASPECT_RATIOS : videoAspectRatios).map((value) => <option key={value}>{value === 'adaptive' ? '自适应' : value}</option>)}</select></label>
            <label><span>{type === 'image' ? '图片分辨率' : '视频分辨率'}</span><select aria-label={type === 'video' ? '视频分辨率' : '图片分辨率'} value={resolution} onChange={(event) => setResolution(event.target.value)}>{supportedResolutions.map((value) => <option key={value} value={value}>{type === 'video' ? resolutionLabel(value) : value}</option>)}</select></label>
            {type === 'image' ? <label><span>{storyboard ? '分镜数量' : '生成数量'}</span><select value={storyboard ? normalizeStoryboardCount(count) : count} onChange={(event) => setCount(Number(event.target.value))}>{(storyboard ? STORYBOARD_COUNTS : [1, 2, 4]).map((value) => <option key={value} value={value}>{value} {storyboard ? '镜' : '张'}</option>)}</select></label> : null}
            {type === 'image' ? <div className="nori-canvas-image-quality"><span>图片质量</span><div>{CANVAS_IMAGE_QUALITIES.map((value) => <button type="button" key={value} className={quality === value ? 'is-active' : ''} onClick={() => setQuality(value)}>{value === 'low' ? '低' : value === 'medium' ? '中' : '高'}</button>)}</div></div> : null}
            {type === 'video' ? <label><span>视频时长</span><select value={duration} onChange={(event) => setDuration(Number(event.target.value))}>{videoDurationOptions.map((value) => <option key={value} value={value}>{value} 秒</option>)}</select></label> : null}
            {type === 'video' && fpsOptions.length > 0 ? <label><span>视频帧率</span><select value={fps || fpsOptions[0]} onChange={(event) => setFps(Number(event.target.value))}>{fpsOptions.map((value) => <option key={value} value={value}>{value} FPS</option>)}</select></label> : null}
          </div>
          <p>{type === 'video' && inputMode === 'firstlastframe' ? '首尾帧模式固定接收按顺序选择的两张图片。' : type === 'video' && inputMode === 'image' ? '图生视频至少需要一张参考图片，不接收视频或音频参考。' : `当前模型允许图片 ${effectiveInputSchema?.image.min || 0}–${effectiveInputSchema?.image.max || 0}、视频 ${effectiveInputSchema?.video.min || 0}–${effectiveInputSchema?.video.max || 0}、音频 ${effectiveInputSchema?.audio.min || 0}–${effectiveInputSchema?.audio.max || 0}${effectiveInputSchema?.audio.maxTotalDurationSeconds ? `（总计不超过 ${effectiveInputSchema.audio.maxTotalDurationSeconds}s）` : ''}。`}</p>
        </ViewportPopover>
      ) : null}
      </div>
    </aside>
  )
}
