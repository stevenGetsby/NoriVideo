'use client'

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react'
import { flushSync } from 'react-dom'
import { requireExistingReferenceNodeIds } from '../reference-resolution'
import {
  ArrowLeft,
  Box,
  ChevronDown,
  Film,
  Focus,
  FolderOpen,
  ImageIcon,
  LayoutGrid,
  LoaderCircle,
  Maximize2,
  Minimize2,
  Music2,
  Plus,
  SlidersHorizontal,
  Sparkles,
  Type,
  Upload,
  X,
} from '@/components/ui/icons'
import { createIcon } from '@/components/ui/icons/ph/createIcon'
import Zap from '@/components/ui/icons/ph/lightning'
import { apiFetch } from '@/lib/api-fetch'
import { readApiErrorMessage } from '@/lib/api/read-error-message'
import { toDisplayImageUrl, toPlayableVideoUrl } from '@/lib/media/image-url'
import { characterVoiceMaterialId } from '@/lib/frameos/character-voice-reference'
import { frameosAssetCategoryFromMetadata } from '@/lib/frameos/material-category'
import { useAccountBalance } from '@/hooks/common/useAccountBalance'
import { MediaImage } from '@/components/media/MediaImage'
import { ViewportPopover } from '@/components/ui/viewport-popover'
import { MentionPromptEditor, type MentionPromptAsset } from '@/components/frameos/materials/MentionPromptEditor'
import { fetchAllFrameosMaterials } from '@/components/frameos/materials/fetch-all-materials'
import type { FrameosMaterialItem } from '@/components/frameos/materials/contracts'
import {
  CANVAS_IMAGE_ASPECT_RATIOS,
  CANVAS_IMAGE_QUALITIES,
  CANVAS_IMAGE_RESOLUTIONS,
  CANVAS_PANORAMA_ASPECT_RATIO,
  CANVAS_VIDEO_DURATION_MAX,
  CANVAS_VIDEO_DURATION_MIN,
  CANVAS_VIDEO_RESOLUTIONS,
  CANVAS_VIDEO_SUPERRESOLVE_TARGETS,
  canvasVideoAspectRatioOptions,
  isSeedance25VideoModelKey,
  resolveCanvasSuperresolveGenerationResolution,
  resolveSupportedResolution,
  canvasPanoramaEditorAspectRatio,
  canvasVideoEditorMode,
  type CanvasImageQuality,
  type CanvasVideoEditorMode,
  type CanvasVideoSuperresolveTarget,
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
  buildCanvasReferencePickerItems,
  canvasReferenceOrderLabel,
  canvasReferencePickerTypes,
  canvasReferenceRemaining,
  mergePickedReferenceIds,
} from '../canvas-reference-picker'
import { CanvasReferencePickerDialog } from './CanvasReferencePickerDialog'
import {
  buildCanvasLibraryMentionAssets,
  buildCanvasMentionAssets,
  canvasMentionCategoryLabel,
  mergeCanvasReferenceNodeIds,
  planCanvasPromptMentions,
  shouldBindCanvasMentionReference,
  type CanvasMentionAsset,
  type CanvasMentionMediaType,
} from './canvas-mention-references'
import { describeUnknownPromptMentions, unknownPromptMentionMessage } from '@/lib/prompt-mentions'

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

const ArrowUp = createIcon('ArrowUp', 'M205.66,117.66a8,8,0,0,1-11.32,0L136,59.31V216a8,8,0,0,1-16,0V59.31L61.66,117.66a8,8,0,0,1-11.32-11.32l72-72a8,8,0,0,1,11.32,0l72,72A8,8,0,0,1,205.66,117.66Z')

type VoiceOption = { value: string; label: string }
type AudioMode = 'tts'
type GenerationQuote = { points: number; costCny: number }

const AUDIO_MODES: Array<{ value: AudioMode; label: string }> = [
  { value: 'tts', label: '配音' },
]
const AUDIO_MODE_PREFERRED_MODEL_KEYS: Record<AudioMode, string> = {
  tts: 'nori::nori-audio',
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
  /** Reference node id → the @names the prompt uses for it. */
  referenceMentionNames?: Record<string, string[]>
  inputMode: 'text' | 'image' | 'firstlastframe'
  aspectRatio: string
  resolution: string
  quality: CanvasImageQuality
  duration: number
  fps?: number
  superresolveTarget?: '720p' | '1080p' | '4k'
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
  superresolveTarget: CanvasVideoSuperresolveTarget | null,
) {
  const next = { ...(current || {}) }
  if (fps !== null) next.fps = fps
  else delete next.fps
  if (superresolveTarget) next.superresolveTarget = superresolveTarget
  else delete next.superresolveTarget
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
  return readMediaDurationSeconds(metadata) ?? (mediaTypeForReference(node) === 'audio' ? null : generationSeconds)
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

function materialReferenceSummary(id: string, material: FrameosMaterialItem): CanvasReferenceMediaSummary | null {
  const type = material.type
  if (type !== 'image' && type !== 'video' && type !== 'audio') return null
  const durationSeconds = type === 'image' ? null : readMediaDurationSeconds(material.metadata)
  return {
    id,
    title: material.title?.trim() || '未命名素材',
    type,
    previewUrl: material.url,
    ...(durationSeconds !== null ? { durationSeconds } : {}),
  }
}

function orderedReferenceSummaries(
  ids: string[],
  referenceNodes: CanvasFlowNode[],
  firstLastFrame: boolean,
  created: readonly CanvasReferenceMediaSummary[] = [],
): CanvasReferenceMediaSummary[] {
  return ids.flatMap((id, index) => {
    const role: CanvasGenerationReferenceRole = firstLastFrame ? index === 0 ? 'FIRST_FRAME' : 'LAST_FRAME' : 'REF'
    const selected = referenceNodes.find((item) => item.id === id)
    if (selected) {
      const summary = referenceSummary(selected, role)
      return summary ? [summary] : []
    }
    const pending = created.find((item) => item.id === id)
    return pending ? [{ ...pending, role }] : []
  })
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

function ReferenceThumb({ node, selected, wired, order, onToggle, onRemove, onToggleVoice }: { node: CanvasFlowNode; selected: boolean; wired: boolean; order: string | null; onToggle: () => void; onRemove: () => void; onToggleVoice?: () => void }) {
  const mediaType = mediaTypeForReference(node)
  const image = toDisplayImageUrl(mediaType === 'video'
    ? node.data.posterUrl || node.data.imageUrl || null
    : mediaType === 'image' ? node.data.contentUrl || node.data.imageUrl || node.data.posterUrl || null : null)
  const video = mediaType === 'video' ? toPlayableVideoUrl(node.data.videoUrl || node.data.contentUrl) : null
  const Icon = node.type === 'text' ? Type : node.type === 'video' ? Film : node.type === 'audio' ? Music2 : ImageIcon
  const isCharacter = mediaType === 'image' && frameosAssetCategoryFromMetadata(node.data.sourceMetadata) === 'character'
  const characterVoiceBound = isCharacter && Boolean(characterVoiceMaterialId(node.data.sourceMetadata))
  const voiceDetached = characterVoiceBound && node.data.voiceDetached === true
  const title = node.data.title || '上游节点'
  const voiceHint = isCharacter
    ? characterVoiceBound
      ? voiceDetached
        ? ' · 角色音色已拆卸，生成时不会带入音频'
        : ' · 角色已绑定音色，全能参考且开启声音时会自动带入'
      : ' · 角色未绑定音色，全能参考时不会带入音频'
    : ''
  const toggleHint = !selected
    ? ' · 点击加入本次引用'
    : wired ? ' · 点击本次不引用（连线保留）' : ' · 点击移出引用'
  return (
    <span className="nori-canvas-generator-ref-item">
      <button
        type="button"
        className={`nori-canvas-generator-ref${selected ? ' is-selected' : ''}${image || video ? '' : ' is-icon'}`}
        title={`${title}${voiceHint}${toggleHint}`}
        aria-pressed={selected}
        onClick={onToggle}
      >
        {image ? <MediaImage src={image} alt="" /> : video ? <video src={video} muted playsInline preload="metadata" /> : <Icon />}
        {order ? <b className="nori-canvas-generator-ref-order">{order}</b> : null}
        {isCharacter && !(characterVoiceBound && onToggleVoice) ? <em className={`nori-canvas-generator-ref-voice${characterVoiceBound ? ' is-bound' : ' is-missing'}`}>{characterVoiceBound ? '音色' : '缺音色'}</em> : null}
        <span className="nori-canvas-generator-ref-name">{title}</span>
      </button>
      {characterVoiceBound && onToggleVoice ? <button
        type="button"
        className={`nori-canvas-generator-ref-voice nori-canvas-generator-ref-voice-toggle${voiceDetached ? ' is-detached' : ' is-bound'}`}
        aria-pressed={!voiceDetached}
        aria-label={voiceDetached ? `恢复携带角色音色 ${title}` : `拆卸角色音色 ${title}`}
        title={voiceDetached ? '音色已拆卸：生成时不带入这张角色图的音频。点击恢复携带' : '携带音色：生成时会带入这张角色图的音频。点击拆卸（仅本画布生效）'}
        onClick={onToggleVoice}
      >{voiceDetached ? '已拆卸' : '音色'}</button> : null}
      <button
        type="button"
        className="nori-canvas-generator-ref-remove"
        aria-label={`移除引用素材 ${title}`}
        title={wired ? '移除引用并删除这条连线' : '移除引用（素材仍保留在画布上）'}
        onClick={onRemove}
      >
        <X />
      </button>
    </span>
  )
}

export function CanvasGenerator({
  projectId,
  node,
  incomingNodes,
  secondaryNodeIds,
  referenceNodes,
  onDraftChange,
  onGenerate,
  onReplace,
  onClose,
  onFocus,
  onAddReferences,
  onRemoveReference,
  onToggleReferenceVoice,
  onSelectLibraryMaterial,
  injectedReferenceNodeIds,
  anchor,
  panelWidth,
  onPanelWidthChange,
  globalStyleNodeId,
  globalStyleSourceTitle,
  globalStylePrompt,
  onGlobalStylePromptChange,
  videoPrefixNodeId,
  videoPrefixSourceTitle,
  videoPrefixPrompt,
  onVideoPrefixPromptChange,
}: {
  projectId: string
  node: CanvasFlowNode
  incomingNodes: CanvasFlowNode[]
  secondaryNodeIds?: ReadonlySet<string>
  referenceNodes: CanvasFlowNode[]
  onDraftChange: (patch: Record<string, unknown>) => void
  onGenerate: (request: CanvasGenerateRequest) => Promise<void>
  onReplace: () => void
  onClose: () => void
  onFocus: () => void
  onAddReferences?: (request: { type: 'all' | 'image' | 'video' | 'audio'; maxSelected: number }) => void
  onRemoveReference?: (sourceNodeId: string) => void
  onToggleReferenceVoice?: (nodeId: string) => void
  onSelectLibraryMaterial: (material: FrameosMaterialItem) => string | null
  injectedReferenceNodeIds?: string[]
  anchor?: CanvasGeneratorAnchor | null
  panelWidth: number
  onPanelWidthChange: (width: number) => void
  globalStyleNodeId?: string | null
  globalStyleSourceTitle?: string
  globalStylePrompt?: string
  onGlobalStylePromptChange?: (value: string) => void
  videoPrefixNodeId?: string | null
  videoPrefixSourceTitle?: string
  videoPrefixPrompt?: string
  onVideoPrefixPromptChange?: (value: string) => void
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
  const nodeReferenceSignature = (node.data.generation?.referenceNodeIds || compatibleIncomingNodes.map((item) => item.id)).join('|')
  const mentionAllowedTypes: readonly CanvasMentionMediaType[] = type === 'video'
    ? inputMode === 'text' ? VIDEO_MENTION_TYPES : IMAGE_MENTION_TYPES
    : type === 'image'
      ? IMAGE_MENTION_TYPES
      : type === 'audio'
        ? AUDIO_MENTION_TYPES
        : NO_MENTION_TYPES
  const [libraryMaterials, setLibraryMaterials] = useState<CanvasMentionAsset[]>([])
  const [libraryLoading, setLibraryLoading] = useState(false)
  const [libraryReady, setLibraryReady] = useState(false)
  const libraryPromiseRef = useRef<Promise<CanvasMentionAsset[]> | null>(null)
  const libraryRequestRef = useRef<AbortController | null>(null)
  const mentionSignature = mentionAllowedTypes.join('|')
  const mentionGroups = useMemo(() => [
    { id: 'favorites', label: '收藏' },
    ...(['character', 'location', 'prop', 'shot', 'other'] as const).map((category) => ({
      id: category,
      label: canvasMentionCategoryLabel(category),
    })),
  ], [])
  const ensureMentionLibrary = (): Promise<CanvasMentionAsset[]> => {
    if (libraryPromiseRef.current) return libraryPromiseRef.current
    const controller = new AbortController()
    libraryRequestRef.current?.abort()
    libraryRequestRef.current = controller
    setLibraryLoading(true)
    const query = new URLSearchParams({ projectId, available: '1', limit: '500' })
    const request: Promise<CanvasMentionAsset[]> = fetchAllFrameosMaterials(query, controller.signal).then((materials) => {
      const assets = buildCanvasLibraryMentionAssets(materials, mentionAllowedTypes)
      if (!controller.signal.aborted) {
        setLibraryMaterials(assets)
        setLibraryReady(true)
      }
      return assets
    }).catch((loadError: unknown) => {
      if (libraryPromiseRef.current === request) libraryPromiseRef.current = null
      const message = loadError instanceof Error ? loadError.message : '加载个人素材库失败'
      if (!controller.signal.aborted) setError(message)
      throw new Error(message)
    }).finally(() => {
      if (!controller.signal.aborted) setLibraryLoading(false)
    })
    libraryPromiseRef.current = request
    return request
  }
  const loadMentionLibrary = () => { void ensureMentionLibrary().catch(() => undefined) }
  useEffect(() => {
    libraryRequestRef.current?.abort()
    libraryRequestRef.current = null
    libraryPromiseRef.current = null
    setLibraryMaterials([])
    setLibraryReady(false)
    setLibraryLoading(false)
    // Reload a material list only when the active generator's accepted media changes.
  }, [node.id, projectId, mentionSignature])
  useEffect(() => () => libraryRequestRef.current?.abort(), [])
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
  const [superresolveTarget, setSuperresolveTarget] = useState<CanvasVideoSuperresolveTarget | null>(() => {
    const value = node.data.generation?.parameters?.superresolveTarget
    return CANVAS_VIDEO_SUPERRESOLVE_TARGETS.find((target) => target === value) || null
  })
  const [generateAudio, setGenerateAudio] = useState(node.data.generation?.generateAudio ?? true)
  const [count, setCount] = useState(node.data.generation?.count || (node.data.processType === 'storyboard' ? STORYBOARD_COUNTS[0] : 1))
  const [referenceNodeIds, setReferenceNodeIds] = useState<string[]>(node.data.generation?.referenceNodeIds || compatibleIncomingNodes.map((item) => item.id))
  // Unwired references picked from the library count as direct inputs, so a
  // prompt that names them resolves to the node that is actually submitted.
  const directMentionNodeIds = useMemo(
    () => new Set([...incomingNodes.map((item) => item.id), ...referenceNodeIds]),
    [incomingNodes, referenceNodeIds],
  )
  const canvasMentionAssets = useMemo(() => buildCanvasMentionAssets(
    referenceNodes,
    node.id,
    mentionAllowedTypes,
    directMentionNodeIds,
    secondaryNodeIds,
  ), [directMentionNodeIds, mentionAllowedTypes, node.id, referenceNodes, secondaryNodeIds])
  const mentionAssets = useMemo(
    () => [...canvasMentionAssets, ...libraryMaterials],
    [canvasMentionAssets, libraryMaterials],
  )
  const bindsMentionReferences = shouldBindCanvasMentionReference(type)
  const mentionBinding = useMemo(() => ({
    nodeIds: new Set(referenceNodeIds),
    materialIds: new Set(referenceNodeIds.flatMap((id) => {
      const materialId = referenceNodes.find((item) => item.id === id)?.data.materialId
      return typeof materialId === 'string' && materialId.trim() ? [materialId.trim()] : []
    })),
  }), [referenceNodeIds, referenceNodes])
  const promptMentionPlan = useMemo(
    () => planCanvasPromptMentions([prompt], mentionAssets, mentionBinding),
    [mentionAssets, mentionBinding, prompt],
  )
  const mentionHighlight = useMemo(() => {
    if (!bindsMentionReferences) return undefined
    const boundNames = new Set<string>()
    for (const [name, asset] of promptMentionPlan.targets) {
      const bound = asset.section === 'library'
        ? Boolean(asset.materialId && mentionBinding.materialIds.has(asset.materialId))
        : mentionBinding.nodeIds.has(asset.id)
      if (bound) boundNames.add(name)
    }
    // Unknown @tokens are only flagged once the library is loaded, so a
    // library asset is never shown as broken while it is still loading.
    return { boundNames, flagUnknown: libraryReady }
  }, [bindsMentionReferences, libraryReady, mentionBinding, promptMentionPlan])
  const hasUnresolvedPromptMentions = promptMentionPlan.unknown.length > 0
  useEffect(() => {
    if (bindsMentionReferences && hasUnresolvedPromptMentions && !libraryReady) loadMentionLibrary()
    // loadMentionLibrary is cached per node; only a change in resolution state matters.
  }, [bindsMentionReferences, hasUnresolvedPromptMentions, libraryReady])
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
  const [moreOpen, setMoreOpen] = useState(false)
  const parameterTriggerRef = useRef<HTMLButtonElement>(null)
  const [referenceMenuOpen, setReferenceMenuOpen] = useState(false)
  const [canvasPickerOpen, setCanvasPickerOpen] = useState(false)
  const referenceAddRef = useRef<HTMLButtonElement>(null)
  const canvasPickItemRef = useRef<HTMLButtonElement>(null)
  const libraryPickItemRef = useRef<HTMLButtonElement>(null)
  const [quote, setQuote] = useState<GenerationQuote | null>(null)
  const [quoteError, setQuoteError] = useState<string | null>(null)
  const [quoteLoading, setQuoteLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const onDraftChangeRef = useRef(onDraftChange)
  const hydratedInputRef = useRef(node.id)
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
      if (superresolveTarget) params.set('superresolveTarget', superresolveTarget)
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
  }, [audioMode, count, duration, generateAudio, inputMode, modelKey, prompt, quality, quotable, referenceNodeIds, referenceNodes, resolution, storyboard, superresolveTarget, type])

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
      if (event.key !== 'Escape' || event.defaultPrevented) return
      event.preventDefault()
      event.stopPropagation()
      closeEditorRef.current()
    }
    window.addEventListener('keydown', exitNodeEditor)
    return () => window.removeEventListener('keydown', exitNodeEditor)
  }, [])

  useEffect(() => {
    if (isPanorama) setAspectRatio(CANVAS_PANORAMA_ASPECT_RATIO)
  }, [isPanorama])

  useEffect(() => {
    if (hydratedInputRef.current === node.id) return
    hydratedInputRef.current = node.id
    skipDraftPersistenceRef.current = true
    lastDraftSignatureRef.current = ''
    setPrompt(node.data.prompt || '')
    setModelKey(node.data.generation?.modelKey || '')
    setAspectRatio(isPanorama
      ? canvasPanoramaEditorAspectRatio(node.data.generation?.aspectRatio)
      : node.data.generation?.aspectRatio || '16:9')
    setResolution(node.data.generation?.resolution || (type === 'image' ? '2K' : type === 'video' ? '720p' : ''))
    setQuality(node.data.generation?.quality || 'high')
    setDuration(node.data.generation?.duration || (type === 'audio' ? 15 : 5))
    setFps(optionalPositiveInteger(node.data.generation?.parameters?.fps))
    const savedSuperresolveTarget = node.data.generation?.parameters?.superresolveTarget
    setSuperresolveTarget(CANVAS_VIDEO_SUPERRESOLVE_TARGETS.find((target) => target === savedSuperresolveTarget) || null)
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
    setReferenceMenuOpen(false)
    setCanvasPickerOpen(false)
    setError(null)
    // Rehydrate fields only when switching nodes. Reference ids have a separate
    // sync effect so adding or removing wires cannot overwrite an in-progress draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.id])

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
    const mapModel = (model: ModelOption) => ({ key: model.modelKey, label: model.name, raw: model })
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
  const selectedReferenceSummaries = useMemo(
    () => orderedReferenceSummaries(referenceNodeIds, referenceNodes, type === 'video' && inputMode === 'firstlastframe'),
    [inputMode, referenceNodeIds, referenceNodes, type],
  )
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
  const referenceOrderLabels = useMemo(() => {
    const ordered = referenceNodeIds.filter((id) => referenceNodes.some((item) => item.id === id))
    const firstLast = type === 'video' && inputMode === 'firstlastframe'
    return new Map(ordered.map((id, index) => [id, firstLast && index < 2 ? index === 0 ? '首' : '尾' : String(index + 1)]))
  }, [inputMode, referenceNodeIds, referenceNodes, type])
  const characterVoiceSummary = useMemo(() => {
    if (type !== 'video') return null
    const characterRefs = displayedReferenceNodes.filter((item) => (
      (item.data.mediaType || item.type) === 'image'
      && frameosAssetCategoryFromMetadata(item.data.sourceMetadata) === 'character'
    ))
    if (characterRefs.length === 0) return null
    const hasVoice = characterRefs.filter((item) => Boolean(characterVoiceMaterialId(item.data.sourceMetadata)))
    const detached = hasVoice.filter((item) => item.data.voiceDetached === true).length
    const bound = hasVoice.length - detached
    return { total: characterRefs.length, bound, detached, missing: characterRefs.length - hasVoice.length }
  }, [displayedReferenceNodes, type])
  const characterVoiceHint = characterVoiceSummary
    ? inputMode !== 'text'
      ? `${inputMode === 'image' ? '图生视频' : '首尾帧'}不提交角色音色；当前 ${characterVoiceSummary.total} 个角色中 ${characterVoiceSummary.bound} 个已绑定。`
      : !generateAudio
        ? `已关闭「同步生成声音」，本次不会提交角色音色${characterVoiceSummary.bound > 0 ? `（已绑定 ${characterVoiceSummary.bound} 个）` : ''}。`
        : characterVoiceSummary.bound > 0
          ? `全能参考将自动带入 ${characterVoiceSummary.bound} 个角色音色${characterVoiceSummary.detached > 0 ? `；${characterVoiceSummary.detached} 个已拆卸` : ''}${characterVoiceSummary.missing > 0 ? `；另有 ${characterVoiceSummary.missing} 个角色缺音色` : ''}。`
          : characterVoiceSummary.detached > 0
            ? `${characterVoiceSummary.detached} 个角色音色已拆卸，生成时不会带入角色音频。`
            : `当前 ${characterVoiceSummary.total} 个角色均未绑定音色，生成时不会带入角色音频。`
    : null
  const characterVoiceHintTone = characterVoiceSummary && inputMode === 'text' && generateAudio
    ? characterVoiceSummary.missing > 0 ? ' is-warning' : ''
    : ' is-muted'

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

  useEffect(() => {
    if (type !== 'video' || !superresolveTarget) return
    setResolution((current) => CANVAS_VIDEO_SUPERRESOLVE_TARGETS.find((target) => target === current.toLowerCase()) || '720p')
  }, [superresolveTarget, type])

  const draftPatch = useMemo(() => ({
      prompt,
      processType: storyboard ? 'storyboard' : node.data.processType === 'storyboard' ? undefined : node.data.processType,
      generation: {
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
          ? { mode: audioMode, voice: audioVoice, genre: '', sfxKind: '' }
          : type === 'model3d'
            ? { topology: model3dTopology, generateTexture: model3dGenerateTexture, pose: model3dPose }
            : type === 'video'
              ? videoGenerationParameters(node.data.generation?.parameters, fps, superresolveTarget)
              : undefined,
      },
    }), [aspectRatio, audioMode, audioVoice, count, currentModel?.label, currentModel?.raw?.inputSchema, duration, fps, generateAudio, inputMode, model3dGenerateTexture, model3dPose, model3dTopology, modelKey, node.data.generation?.parameters, node.data.processType, prompt, quality, referenceNodeIds, resolution, selectedReferenceSummaries, storyboard, superresolveTarget, type])
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

  /** `created` describes reference nodes inserted during this submit, which are not in props yet. */
  const referenceErrors = (ids: string[], strict: boolean, created: readonly CanvasReferenceMediaSummary[] = []) => {
    if (!effectiveInputSchema) return []
    const createdById = new Map(created.map((summary) => [summary.id, summary]))
    if (strict) {
      try { requireExistingReferenceNodeIds(ids.filter((id) => !createdById.has(id)), referenceNodes) }
      catch (error) { return [error instanceof Error ? error.message : '引用素材失效，请重新选择。'] }
    }
    const summaries = ids.flatMap((id) => {
      const selected = referenceNodes.find((item) => item.id === id)
      const summary = selected ? referenceSummary(selected) : createdById.get(id) || null
      return summary ? [summary] : []
    })
    return [
      ...validateCanvasReferenceMedia(effectiveInputSchema, summaries, {
        enforceMinimums: strict,
        requireKnownAudioDuration: false,
      }),
      ...(type === 'video' && strict ? validateVideoReferenceMediaCombination(summaries, {
        allowAudioOnly: isSeedance25VideoModelKey(modelKey),
      }) : []),
    ]
  }

  const selectMentionAsset = (asset: MentionPromptAsset, nextPrompt: string) => {
    const mentionAsset = asset as CanvasMentionAsset
    let nodeId = asset.id
    if (mentionAsset.section === 'library' && mentionAsset.material) {
      nodeId = onSelectLibraryMaterial(mentionAsset.material) || undefined
      if (!nodeId) {
        setError('素材未能引用到当前生成节点，请检查素材类型和模型引用上限。')
        return false
      }
    }
    if (!shouldBindCanvasMentionReference(type)) {
      setError(null)
      setPrompt(nextPrompt)
      return
    }
    const nextReferenceNodeIds = mergeCanvasReferenceNodeIds(referenceNodeIds, nodeId)
    const errors = referenceErrors(nextReferenceNodeIds, false)
    if (errors.length > 0) { setError(errors[0]); return false }
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

  const wiredReferenceIds = useMemo(() => new Set(incomingNodes.map((item) => item.id)), [incomingNodes])
  const removeReference = (reference: CanvasFlowNode) => {
    setError(null)
    if (onRemoveReference && wiredReferenceIds.has(reference.id)) {
      onRemoveReference(reference.id)
      return
    }
    setReferenceNodeIds((current) => current.filter((id) => id !== reference.id))
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

  /**
   * Every @mention must resolve to a reference that is actually submitted;
   * otherwise the model reads a bare name and substitutes whoever is in the
   * reference images. Mentioned but unbound assets are bound here, and the
   * mention names travel with each node so the server can compile 图片N.
   */
  const bindPromptMentions = async (texts: string[]): Promise<
    | { ok: true; ids: string[]; created: CanvasReferenceMediaSummary[]; names: Record<string, string[]> }
    | { ok: false; error: string }
  > => {
    let plan = planCanvasPromptMentions(texts, mentionAssets, mentionBinding)
    if (plan.unknown.length > 0 && !libraryReady) {
      let library: CanvasMentionAsset[]
      try { library = await ensureMentionLibrary() }
      catch (loadError) {
        const message = loadError instanceof Error ? loadError.message : '素材库加载失败'
        return { ok: false, error: `无法核对提示词中的 @ 素材（${message}），请稍后重试。` }
      }
      plan = planCanvasPromptMentions(texts, [...canvasMentionAssets, ...library], mentionBinding)
    }
    if (plan.unknown.length > 0) {
      return { ok: false, error: unknownPromptMentionMessage(describeUnknownPromptMentions(plan.unknown)) }
    }

    const referencedNodeFor = (materialId: string) => referenceNodeIds.find((id) => (
      referenceNodes.find((item) => item.id === id)?.data.materialId === materialId
    ))
    let ids = referenceNodeIds
    const pending: Array<{ placeholder: string; material: FrameosMaterialItem }> = []
    const created: CanvasReferenceMediaSummary[] = []
    const names = new Map<string, string[]>()
    for (const { asset, names: mentionNames } of plan.mentioned) {
      let nodeId: string | undefined = asset.section === 'library' ? undefined : asset.id
      if (!nodeId && asset.materialId) nodeId = referencedNodeFor(asset.materialId)
      if (!nodeId && asset.material) {
        // Validate limits before touching the canvas, so a rejected submit
        // never leaves stray reference nodes behind.
        nodeId = `pending-mention:${asset.material.id}`
        const summary = materialReferenceSummary(nodeId, asset.material)
        if (!summary) return { ok: false, error: `素材「${asset.name}」的类型不能作为当前节点的引用。` }
        pending.push({ placeholder: nodeId, material: asset.material })
        created.push(summary)
      }
      if (!nodeId) return { ok: false, error: `素材「${asset.name}」未能引用到当前生成节点，请重新选择该素材。` }
      ids = mergeCanvasReferenceNodeIds(ids, nodeId)
      names.set(nodeId, [...new Set([...(names.get(nodeId) || []), ...mentionNames])])
    }
    const limitErrors = referenceErrors(ids, false, created)
    if (limitErrors.length > 0) return { ok: false, error: limitErrors[0] }

    for (const { placeholder, material } of pending) {
      const nodeId = onSelectLibraryMaterial(material)
        || referenceNodes.find((item) => item.id !== node.id && item.data.materialId === material.id)?.id
      if (!nodeId) return { ok: false, error: `素材「${material.title || '未命名素材'}」未能引用到当前生成节点，请检查画布节点与连线上限。` }
      ids = ids.includes(nodeId) ? ids.filter((id) => id !== placeholder) : ids.map((id) => (id === placeholder ? nodeId : id))
      const index = created.findIndex((item) => item.id === placeholder)
      if (referenceNodes.some((item) => item.id === nodeId)) created.splice(index, 1)
      else created[index] = { ...created[index], id: nodeId }
      const placeholderNames = names.get(placeholder) || []
      names.delete(placeholder)
      names.set(nodeId, [...new Set([...(names.get(nodeId) || []), ...placeholderNames])])
    }
    return { ok: true, ids, created, names: Object.fromEntries(names) }
  }

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
    if (superresolveResolutionError) { setError(superresolveResolutionError); return }
    if (imageEditModelUnavailable) { setError('当前图片模型不支持蒙版重绘，请在管理平台接入并选择支持 Inpaint 的模型。'); return }
    if (submitting) return
    let submitReferenceNodeIds = referenceNodeIds
    let createdReferences: CanvasReferenceMediaSummary[] = []
    let referenceMentionNames: Record<string, string[]> | undefined
    if (bindsMentionReferences) {
      setSubmitting(true)
      const binding = await bindPromptMentions([
        cleanPrompt,
        globalStylePrompt || '',
        type === 'video' ? videoPrefixPrompt || '' : '',
      ]).finally(() => setSubmitting(false))
      if (!binding.ok) { setError(binding.error); return }
      submitReferenceNodeIds = binding.ids
      createdReferences = binding.created
      if (Object.keys(binding.names).length > 0) referenceMentionNames = binding.names
      if (submitReferenceNodeIds !== referenceNodeIds) setReferenceNodeIds(submitReferenceNodeIds)
    }
    const submitReferenceSummaries = submitReferenceNodeIds === referenceNodeIds
      ? selectedReferenceSummaries
      : orderedReferenceSummaries(submitReferenceNodeIds, referenceNodes, type === 'video' && inputMode === 'firstlastframe', createdReferences)
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
      const mediaErrors = referenceErrors(submitReferenceNodeIds, true, createdReferences)
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
      generation: { ...draftPatch.generation, referenceNodeIds: submitReferenceNodeIds, referenceSummary: submitReferenceSummaries },
    }))
    try {
      await onGenerate({
        nodeId: node.id,
        type,
        prompt: cleanPrompt,
        modelKey,
        modelLabel: currentModel?.label || modelKey,
        referenceNodeIds: submitReferenceNodeIds,
        referenceSummary: submitReferenceSummaries,
        ...(referenceMentionNames ? { referenceMentionNames } : {}),
        inputMode,
        aspectRatio,
        resolution,
        quality,
        duration,
        ...(fps !== null ? { fps } : {}),
        ...(superresolveTarget ? { superresolveTarget } : {}),
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

  const keepWheelInEditor = (event: ReactWheelEvent<HTMLElement>) => {
    const target = event.target instanceof Element ? event.target : null
    if (!target?.closest('.mention-prompt-options, .nori-canvas-generator-more')) event.stopPropagation()
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
  const firstLastFrameMode = type === 'video' && inputMode === 'firstlastframe'
  const canvasPickerTypes = useMemo(
    () => canvasReferencePickerTypes(referencePickerType, effectiveInputSchema),
    [effectiveInputSchema, referencePickerType],
  )
  // Scanning every canvas node is only worth it while the menu or dialog is showing.
  const canvasPickerActive = referenceMenuOpen || canvasPickerOpen
  const canvasPickerItems = useMemo(() => canvasPickerActive
    ? buildCanvasReferencePickerItems({
        nodes: referenceNodes,
        generatorNodeId: node.id,
        allowedTypes: canvasPickerTypes,
        selectedIds: referenceNodeIds,
        wiredIds: wiredReferenceIds,
        isCharacter: (item) => frameosAssetCategoryFromMetadata(item.data.sourceMetadata) === 'character',
      })
    : [], [canvasPickerActive, canvasPickerTypes, node.id, referenceNodeIds, referenceNodes, wiredReferenceIds])
  const canvasPickerRemaining = useMemo(() => {
    if (!canvasPickerActive) return canvasReferenceRemaining(null, [], [])
    const nodeById = new Map(referenceNodes.map((item) => [item.id, item]))
    const selectedNodes = referenceNodeIds.flatMap((id) => nodeById.get(id) || [])
    return canvasReferenceRemaining(effectiveInputSchema, canvasPickerTypes, selectedNodes)
  }, [canvasPickerActive, canvasPickerTypes, effectiveInputSchema, referenceNodeIds, referenceNodes])
  const closeCanvasPicker = () => {
    setCanvasPickerOpen(false)
    referenceAddRef.current?.focus()
  }
  const confirmCanvasReferencePick = (pickedIds: string[]): string | null => {
    const next = mergePickedReferenceIds(referenceNodeIds, pickedIds)
    const errors = referenceErrors(next, false)
    if (errors.length > 0) return errors[0]
    setError(null)
    setReferenceNodeIds(next)
    closeCanvasPicker()
    return null
  }
  useEffect(() => {
    if (!referenceMenuOpen) return
    const first = canvasPickItemRef.current && !canvasPickItemRef.current.disabled
      ? canvasPickItemRef.current
      : libraryPickItemRef.current
    first?.focus()
  }, [referenceMenuOpen])
  const qualityLabel = quality === 'low' ? '低' : quality === 'medium' ? '中' : '高'
  let superresolveGenerationResolution: string | null = null
  let superresolveResolutionError: string | null = null
  if (superresolveTarget) {
    try {
      superresolveGenerationResolution = resolveCanvasSuperresolveGenerationResolution(superresolveTarget, supportedResolutions)
    } catch (resolutionError) {
      superresolveResolutionError = resolutionError instanceof Error ? resolutionError.message : '当前模型不支持该超分目标。'
    }
  }
  const superresolveParameterSummary = superresolveGenerationResolution
    ? `${resolutionLabel(superresolveGenerationResolution)} 生成 → ${resolutionLabel(superresolveTarget!)}`
    : '当前模型不支持'
  const quotePoints = quote ? quote.points.toLocaleString('zh-CN', { maximumFractionDigits: 2 }) : ''
  const parameterSummary = type === 'image'
    ? `${aspectRatio} · ${resolution || '默认'} · ${qualityLabel} · ${storyboard ? normalizeStoryboardCount(count) : count}${storyboard ? '镜' : '张'}`
    : type === 'video'
      ? `${aspectRatio === 'adaptive' ? '自适应' : aspectRatio} · ${superresolveTarget ? superresolveParameterSummary : resolutionLabel(resolution || '默认')} · ${duration}s${fps !== null ? ` · ${fps}FPS` : ''}`
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
    <aside className={`nori-canvas-generator${fullscreen ? ' is-fullscreen' : ''}${anchor && !fullscreen ? ' is-node-anchored' : ''}`} data-editor-mode={fullscreen ? 'expanded' : 'anchored'} data-anchor-placement={anchor?.placement} style={{ ...anchorStyle, ...(fullscreen ? {} : { width: `${panelWidth}px` }) }} onPointerDown={(event) => event.stopPropagation()} onWheel={keepWheelInEditor}>
      {anchor && !fullscreen ? <span className="nori-canvas-generator-tether" aria-hidden="true" style={{ left: `${anchor.tetherX}px`, height: `${anchor.tetherLength}px` }} /> : null}
      <div className="nori-canvas-generator-scroll" style={!fullscreen && anchor ? { maxHeight: `min(${anchor.maxHeight}px, calc(var(--nori-generator-viewport-height, 72vh) / var(--nori-interface-scale, 1.2)))` } : undefined}>
      {!fullscreen ? <div className="nori-canvas-generator-width-handle" role="separator" aria-orientation="vertical" aria-label="调整提示词面板宽度" aria-valuemin={CANVAS_GENERATOR_PANEL_WIDTH_MIN} aria-valuemax={CANVAS_GENERATOR_PANEL_WIDTH_MAX} aria-valuenow={panelWidth} tabIndex={0} onPointerDown={startPanelResize} onKeyDown={resizePanelByKeyboard}><span /></div> : null}
      <div className="nori-canvas-generator-head">
        {type === 'video' ? (
          <div className="nori-canvas-generator-mode-tabs" role="group" aria-label="视频生成方式">
            {([['text', '全能参考', true], ['image', '图生视频', supportsImageToVideo], ['firstlastframe', '首尾帧', Boolean(currentModel?.raw?.firstLastFrame)]] as const).map(([value, label, enabled]) => (
              <button type="button" key={value} className={inputMode === value ? 'is-active' : ''} aria-pressed={inputMode === value} disabled={!enabled} onClick={() => setInputMode(value)}>{label}</button>
            ))}
          </div>
        ) : <span><TypeIcon />{type === 'text' ? '文本生成' : type === 'audio' ? '音频生成' : type === 'model3d' ? '3D 模型生成' : isPanorama ? '720 全景生成' : '图像生成'}</span>}
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
          {displayedReferenceNodes.map((incoming) => <ReferenceThumb key={incoming.id} node={incoming} selected={referenceNodeIds.includes(incoming.id)} wired={wiredReferenceIds.has(incoming.id)} order={referenceOrderLabels.get(incoming.id) || null} onToggle={() => toggleReferenceNode(incoming)} onRemove={() => removeReference(incoming)} onToggleVoice={onToggleReferenceVoice ? () => onToggleReferenceVoice(incoming.id) : undefined} />)}
          {referencePickerType ? <button ref={referenceAddRef} type="button" className={`nori-canvas-generator-ref-add${referenceMenuOpen ? ' is-active' : ''}`} title="添加引用素材（无需连线）" aria-label="添加引用素材" aria-haspopup="menu" aria-expanded={referenceMenuOpen} onClick={() => setReferenceMenuOpen((open) => !open)}><Plus /><span aria-hidden="true">参考</span></button> : null}
          {referenceMenuOpen && referencePickerType ? (
            <ViewportPopover anchorRef={referenceAddRef} onClose={() => setReferenceMenuOpen(false)} preferredSide="below" width={208} maxHeight={160} role="menu" aria-label="添加引用素材" className="nori-canvas-reference-add-menu">
              <button ref={canvasPickItemRef} type="button" role="menuitem" disabled={canvasPickerItems.length === 0} title={canvasPickerItems.length === 0 ? '画布上暂无当前模型可引用的素材' : undefined} onClick={() => { setReferenceMenuOpen(false); setCanvasPickerOpen(true) }}><LayoutGrid /><span>从画布选择</span><small>{canvasPickerItems.length}</small></button>
              {onAddReferences ? <button ref={libraryPickItemRef} type="button" role="menuitem" onClick={() => { setReferenceMenuOpen(false); onAddReferences({ type: referencePickerType, maxSelected: referencePickerMax }) }}><FolderOpen /><span>从素材库选择</span></button> : null}
            </ViewportPopover>
          ) : null}
          {canvasPickerOpen ? (
            <CanvasReferencePickerDialog
              items={canvasPickerItems}
              remaining={canvasPickerRemaining}
              orderLabel={(position) => canvasReferenceOrderLabel(referenceOrderLabels.size + position, firstLastFrameMode)}
              onConfirm={confirmCanvasReferencePick}
              onClose={closeCanvasPicker}
            />
          ) : null}
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

      {storyboard ? <p className="nori-canvas-storyboard-hint">描述一个 10–15 秒内能演完的小剧情片段，系统会生成 {normalizeStoryboardCount(count)} 个连续分镜。</p> : null}
      {isImageEdit ? <p className="nori-canvas-storyboard-hint">白色涂抹区域会作为独立蒙版提交；仅可选择明确支持 Inpaint 的图片模型。</p> : null}
      {isPanorama ? <p className="nori-canvas-storyboard-hint">生成无缝 21:9 超宽幅全景图；完成后可进入球形预览并生成四视角或十二视角截图。</p> : null}
      {type === 'model3d' ? <p className="nori-canvas-storyboard-hint">输入物体或角色描述，帧界 3D 1.0 将生成可预览、下载并送入 3D 导演台的 GLB 模型。</p> : null}
      {type === 'video' && videoPrefixNodeId ? (
        <div className="nori-canvas-global-style is-video-prefix">
          <div className="nori-canvas-global-style-head">
            <Film />
            <span>
              <strong>视频统一前置提示词</strong>
              <small>{videoPrefixSourceTitle ? `来自文本节点「${videoPrefixSourceTitle}」` : '来自画布视频前置提示词文本节点'} · 置于提示词最前面 · 编辑会同步该节点</small>
            </span>
          </div>
          <textarea
            aria-label="视频统一前置提示词"
            value={videoPrefixPrompt || ''}
            onChange={(event) => onVideoPrefixPromptChange?.(event.target.value)}
            placeholder="例如：所有镜头保持电影感、24fps、镜头缓慢推进、人物不出戏"
          />
        </div>
      ) : null}

      <div className="nori-canvas-generator-prompt">
        {mentionAllowedTypes.length > 0 ? (
          <MentionPromptEditor
            className="nori-canvas-mention-editor"
            value={prompt}
            assets={mentionAssets}
            highlight={mentionHighlight}
            onChange={setPrompt}
            onSelectAsset={selectMentionAsset}
            onMentionOpen={loadMentionLibrary}
            groups={mentionGroups}
            loading={libraryLoading}
            onBlur={() => persistDraft()}
            menuLabel="@ 素材"
            hint={!fullscreen ? null : type === 'video'
              ? inputMode === 'text'
                ? '输入 @ 可引用连线输入或资产库中的图片、视频或音频；蓝色素材名会与实体引用一并保存。'
                : inputMode === 'image'
                  ? '图生视频模式只接收图片引用；至少选择一张图片。'
                  : '首尾帧模式只接收图片引用；选择顺序对应首帧和尾帧。'
              : type === 'audio'
                ? '输入 @ 可插入连线或资产库音频素材名；当前音频模型仅接收文本，不会把它作为声音条件输入。'
                : '输入 @ 可引用连线或资产库图片；蓝色素材名会与实体引用一并保存。'}
            minHeight={fullscreen ? 280 : 96}
            placeholder={type === 'video'
              ? inputMode === 'image'
                ? '描述画面如何运动，至少引用一张图片'
                : inputMode === 'firstlastframe'
                  ? '描述从首帧到尾帧的变化，按顺序引用两张图片'
                  : '描述你想要的视频，输入 @ 引用素材'
              : type === 'audio' ? '输入要合成语音的台词' : isPanorama ? '描述场景的四周、地面、天空与光影，生成无缝全景图' : '描述你想要的图像，输入 @ 引用素材'}
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

      {(type === 'image' || type === 'video') && globalStyleNodeId ? (
        <div className="nori-canvas-global-style">
          <div className="nori-canvas-global-style-head">
            <Sparkles />
            <span>
              <strong>画布全局风格</strong>
              <small>{globalStyleSourceTitle ? `来自文本节点「${globalStyleSourceTitle}」` : '来自画布全局风格文本节点'} · 编辑会同步该节点</small>
            </span>
          </div>
          <textarea
            aria-label="画布全局风格提示词"
            value={globalStylePrompt || ''}
            onChange={(event) => onGlobalStylePromptChange?.(event.target.value)}
            placeholder="例如：统一水彩绘本风、柔和自然光、低饱和配色"
          />
        </div>
      ) : null}

      {type === 'audio' ? <div className="nori-canvas-audio-generator-options">
        <div>{AUDIO_MODES.map((item) => {
          const modeModel = audioModeModels[item.value]
          const supported = Boolean(modeModel)
          return <button type="button" key={item.value} disabled={!supported} title={supported ? `使用 ${modeModel?.label}` : '尚未配置支持该模式的真实音频模型'} className={audioMode === item.value ? 'is-active' : ''} onClick={() => { if (modeModel) { setModelKey(modeModel.key); setAudioMode(item.value) } }}>{item.label}</button>
        })}</div>
        {audioMode === 'tts' ? <label><Music2 /><span>嗓音</span><select value={audioVoice} onChange={(event) => setAudioVoice(event.target.value)} disabled={compatibleVoiceOptions.length === 0}>{compatibleVoiceOptions.length === 0 ? <option value="">{usesReferenceAudio ? '请先在资产库上传参考音频' : '请先在资产库绑定参考音色 ID'}</option> : compatibleVoiceOptions.map((voice) => <option key={voice.value} value={voice.value}>{voice.label}</option>)}</select></label> : null}
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
            className={`nori-canvas-generator-quote${quoteError ? ' is-error' : ''}`}
            title={quoteError || (quote ? `预计消耗 ${quotePoints} 积分` : '生成积分报价')}
          >
            <Zap />
            {quoteLoading ? '…' : quoteError ? '暂无法报价' : quote ? <><span className="sr-only">预计消耗</span>{quotePoints}<span className="sr-only">积分</span></> : '—'}
          </span>
        ) : null}
        <button type="button" className="nori-canvas-generate-button" aria-busy={submitting} disabled={!generationAllowed || submitting || Boolean(superresolveResolutionError) || availableModels.length === 0 || currentModel?.raw?.available === false || imageEditModelUnavailable || (type === 'audio' && audioMode === 'tts' && !audioVoice)} onClick={() => void submit()} title={superresolveResolutionError || (!generationAllowed ? generationDisabledReason || '当前账号不可生成' : imageEditModelUnavailable ? '当前模型不支持蒙版重绘' : currentModel?.raw?.available === false ? currentModel.raw.unavailableReason || '服务未配置' : type === 'audio' && audioMode === 'tts' && !audioVoice ? '请先在资产库创建并选择音色' : '生成')}>{submitting ? <LoaderCircle className="animate-spin" /> : <ArrowUp />}<span>{submitting ? '提交中…' : '生成'}</span></button>
        </div>
      </div>

      {moreOpen && (type === 'image' || type === 'video') ? (
        <ViewportPopover anchorRef={parameterTriggerRef} onClose={() => setMoreOpen(false)} preferredSide="above" width={400} maxHeight={420} role="dialog" aria-label="生成参数设置" className="nori-canvas-generator-more nori-canvas-parameter-popover">
          <header><div><strong>生成参数</strong><small>修改后自动保存到当前节点</small></div><button type="button" aria-label="关闭生成参数" onClick={() => { persistDraft(); setMoreOpen(false); parameterTriggerRef.current?.focus() }}><X /></button></header>
          <div className="nori-canvas-generator-parameter-grid">
            {type === 'video' ? <label><span>生成模式</span><select value={inputMode} onChange={(event) => setInputMode(event.target.value as CanvasVideoEditorMode)}><option value="text">全能参考</option><option value="image" disabled={!supportsImageToVideo}>图生视频</option><option value="firstlastframe" disabled={!currentModel?.raw?.firstLastFrame}>首尾帧</option></select></label> : null}
            <label><span>画面比例</span><select value={aspectRatio} disabled={isPanorama || (type === 'video' && videoAspectRatios.length === 1)} onChange={(event) => setAspectRatio(event.target.value)}>{(isPanorama ? [CANVAS_PANORAMA_ASPECT_RATIO] : type === 'image' ? CANVAS_IMAGE_ASPECT_RATIOS : videoAspectRatios).map((value) => <option key={value}>{value === 'adaptive' ? '自适应' : value}</option>)}</select></label>
            <label><span>{type === 'image' ? '图片分辨率' : superresolveTarget ? '输出分辨率' : '视频分辨率'}</span><select aria-label={type === 'video' ? '视频分辨率' : '图片分辨率'} value={superresolveTarget || resolution} onChange={(event) => {
              if (superresolveTarget) setSuperresolveTarget(event.target.value as CanvasVideoSuperresolveTarget)
              else setResolution(event.target.value)
            }}>{(superresolveTarget ? CANVAS_VIDEO_SUPERRESOLVE_TARGETS : supportedResolutions).map((value) => <option key={value} value={value}>{type === 'video' ? resolutionLabel(value) : value}</option>)}</select></label>
            {superresolveTarget ? <p className="text-[12px] leading-5 text-white/55">{superresolveResolutionError || <>模型按 {resolutionLabel(superresolveGenerationResolution!)} 生成并计费，完成后自动超分到 {resolutionLabel(superresolveTarget)}；本地超分不另收积分。</>}</p> : null}
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
