import type { CanvasImageQuality } from '@/lib/canvas/generator-options'
import { readMediaDurationSeconds, type CanvasGenerationInputSchema, type CanvasReferenceMediaSummary } from '@/lib/canvas/generation-input-schema'
import type { CanvasGenerationReferenceRole } from '@/lib/canvas/generation-reference-contract'
import type { CanvasFlowNode } from '../editor-types'

export type CanvasGenerationModelOption = {
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

type AudioMode = 'tts'

export const STORYBOARD_COUNTS = [4, 5, 6, 7, 8] as const

export function normalizeStoryboardCount(value: number) {
  return Math.max(STORYBOARD_COUNTS[0], Math.min(STORYBOARD_COUNTS[STORYBOARD_COUNTS.length - 1], Math.floor(value) || STORYBOARD_COUNTS[0]))
}

export type CanvasGenerationServiceConfig = {
  textModels: CanvasGenerationModelOption[]
  imageModels: CanvasGenerationModelOption[]
  videoModels: CanvasGenerationModelOption[]
  audioModels: CanvasGenerationModelOption[]
  model3dModels: CanvasGenerationModelOption[]
  modelAliases?: Record<string, string>
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

export function nodeKind(node: CanvasFlowNode): CanvasGenerateRequest['type'] {
  if (node.type === 'note' || node.type === 'text') return 'text'
  if (node.type === 'video') return 'video'
  if (node.type === 'audio') return 'audio'
  if (node.type === 'model_3d') return 'model3d'
  return 'image'
}

export function modelOptions(model: CanvasGenerationModelOption | undefined, key: string) {
  return (model?.options?.[key] || []).map(String)
}

export function mediaTypeForReference(node: CanvasFlowNode): CanvasReferenceMediaSummary['type'] | null {
  const type = node.data.mediaType || node.type
  return type === 'image' || type === 'video' || type === 'audio' ? type : null
}

export function compatibleIncomingReferences(type: CanvasGenerateRequest['type'], incoming: CanvasFlowNode[]) {
  if (type === 'audio') return incoming.filter((item) => mediaTypeForReference(item) === 'audio')
  if (type === 'model3d') return incoming.filter((item) => item.type === 'text' || item.type === 'note' || item.data.mediaType === 'text')
  if (type === 'image') return incoming.filter((item) => mediaTypeForReference(item) === 'image')
  return incoming.filter((item) => mediaTypeForReference(item) !== null)
}

export function canvasProviderResolution(type: CanvasGenerateRequest['type'], resolution: string, model?: CanvasGenerationModelOption) {
  return usesCanvasProviderDefaultResolution(type, model) ? '' : resolution
}

export function usesCanvasProviderDefaultResolution(type: CanvasGenerateRequest['type'], model?: CanvasGenerationModelOption) {
  return type === 'video' && model?.runtimeModelKey?.split(':')[0] === 'tgg' && modelOptions(model, 'resolution').length === 0
}

function nodeMediaDurationSeconds(node: CanvasFlowNode): number | null {
  const metadata = node.data.sourceMetadata
  const generationDuration = node.data.generation?.duration
  const generationSeconds = typeof generationDuration === 'number' && Number.isFinite(generationDuration) && generationDuration > 0
    ? generationDuration
    : null
  return readMediaDurationSeconds(metadata) ?? (mediaTypeForReference(node) === 'audio' ? null : generationSeconds)
}

export function referenceSummary(
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

export function orderedReferenceSummaries(
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

export function buildCanvasGenerateRequest(input: CanvasGenerateRequest): CanvasGenerateRequest {
  return { ...input, count: input.storyboard ? normalizeStoryboardCount(input.count) : input.count }
}

type QuoteInput = Pick<CanvasGenerateRequest, 'type' | 'modelKey' | 'count' | 'storyboard' | 'resolution' | 'quality' | 'duration' | 'superresolveTarget' | 'inputMode' | 'generateAudio' | 'referenceNodeIds' | 'audioMode' | 'prompt'>

export function buildQuoteParams(input: QuoteInput, referenceNodes: CanvasFlowNode[]) {
  const { type, modelKey, count, storyboard, resolution, quality, duration, superresolveTarget, inputMode, generateAudio, referenceNodeIds, audioMode, prompt } = input
  if (!modelKey || (type !== 'image' && type !== 'video' && type !== 'audio')) return new URLSearchParams()
  const params = new URLSearchParams({ type, model: modelKey })
  if (type === 'image') {
    params.set('count', String(storyboard ? normalizeStoryboardCount(count) : count))
    params.set('resolution', resolution)
    params.set('quality', quality)
  } else if (type === 'video') {
    if (resolution) params.set('resolution', resolution)
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
  return params
}
