import type { CANVAS_DOCUMENT_SCHEMA_VERSION } from '@/lib/canvas/document-version'
import type { CanvasGenerationReferenceRole } from '@/lib/canvas/generation-reference-contract'
import { isCanvasPanoramaProcessType } from '@/lib/canvas/panorama-contract'

export type Viewport = { x: number; y: number; zoom: number }

export type CanvasProjectOption = {
  id: string
  name: string
  workId?: string | null
  workName?: string | null
}

export type CanvasWorkOption = {
  id: string
  name: string
  projectCount: number
}

export type Canvas = {
  id: string
  projectId: string
  title: string
  themeColor: string | null
  viewport: Viewport | null
  revision: number
  visibility: string
  forkedFromId: string | null
  nodeCount?: number
  createdAt: string
  updatedAt: string
}

export type CanvasNode = {
  id: string
  canvasId: string
  type: string
  position: { x: number; y: number }
  size: { width: number; height: number } | null
  data: CanvasNodeData | null
  status: 'IDLE' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | string
  taskId: string | null
  runId: string | null
  mediaObjectId: string | null
  parentNodeId: string | null
}

export type CanvasNodeData = {
  /** Note 节点的纯文本内容（M0） */
  text?: string
  title?: string
  mediaType?: CanvasMediaType
  origin?: 'empty' | 'upload' | 'generate' | 'project' | 'derivative'
  processType?: CanvasProcessType
  materialId?: string | null
  contentUrl?: string | null
  posterUrl?: string | null
  audioUrl?: string | null
  modelUrl?: string | null
  isFavorited?: boolean
  prompt?: string | null
  generation?: CanvasGenerationConfig | null
  generationTask?: CanvasPersistentGenerationTask | null
  history?: CanvasGenerationHistoryItem[]
  progress?: number
  errorMessage?: string | null
  pollErrorMessage?: string | null
  sourceMetadata?: Record<string, unknown> | null
  memberIds?: string[]
  groupColor?: string | null
  /** 生产画布节点引用的业务对象 */
  sourceType?: 'episode' | 'storyboard' | 'panel' | 'video'
  sourceId?: string
  subtitle?: string
  description?: string | null
  imageUrl?: string | null
  videoUrl?: string | null
  statusLabel?: string | null
  episodeNumber?: number
  panelIndex?: number
  hasImage?: boolean
  hasVideo?: boolean
  stats?: Record<string, number>
  /** 播放列表节点的非破坏性顺序剪辑清单。 */
  playlistItems?: CanvasPlaylistItem[]
  /** 视频编辑节点的来源与首尾帧区间。 */
  videoEdit?: {
    sourceKind: 'none' | 'upload' | 'material' | 'node'
    sourceNodeId?: string | null
    materialId?: string | null
    startMs?: number | null
    endMs?: number | null
    generateAudio?: boolean
    references?: CanvasGenerationReferenceSummary[]
  }
  /** 后续节点类型保留字段，避免破坏向后兼容 */
  [key: string]: unknown
}

export type CanvasPlaylistItem = {
  id: string
  sourceNodeId?: string | null
  materialId?: string | null
  title: string
  videoUrl?: string | null
  posterUrl?: string | null
  sourceInMs: number
  sourceOutMs?: number | null
  durationMs?: number | null
}

export type CanvasPlaylistReviewSummary = {
  assignmentId: string | null
  status: 'draft' | 'pending_review' | 'completed' | 'rejected'
  submittedAt: string | null
  completedAt: string | null
  lastReviewNote: string | null
  annotationCount: number
}

export type CanvasPlaylistRenderSummary = {
  taskId: string | null
  fingerprint: string | null
  status: 'draft' | 'queued' | 'processing' | 'completed' | 'failed' | 'canceled'
  progress: number
  outputUrl: string | null
  materialId: string | null
  durationMs: number | null
  completedAt: string | null
  errorMessage: string | null
}

export type CanvasEdge = {
  id: string
  canvasId: string
  sourceNodeId: string
  targetNodeId: string
  sourceHandle: string | null
  targetHandle: string | null
  role: string
}

export type CanvasGraphResponse = {
  canvas: Canvas
  nodes: CanvasNode[]
  edges: CanvasEdge[]
}

export type CanvasRevision = {
  id: string
  revision: number
  clientId: string | null
  changeSummary: string | null
  createdAt: string
}

export type CanvasMediaType = 'text' | 'image' | 'video' | 'audio' | 'model3d'

export type CanvasProcessType =
  | 'model_3d'
  | 'studio_3d'
  | 'panorama_720'
  | 'image_edit'
  | 'video_edit'
  | 'grid_split'
  | 'lens_focus'
  | 'storyboard'
  | 'superresolve'
  | 'subtitle_erase'

export type CanvasGenerationConfig = {
  modelKey?: string
  modelLabel?: string
  assetId?: string
  taskId?: string
  inputMode?: 'text' | 'image' | 'firstlastframe'
  referenceNodeIds?: string[]
  referenceSummary?: CanvasGenerationReferenceSummary[]
  aspectRatio?: string
  resolution?: string
  quality?: 'low' | 'medium' | 'high'
  duration?: number
  generateAudio?: boolean
  count?: number
  parameters?: Record<string, string | number | boolean>
}

export type CanvasGenerationReferenceSummary = {
  id: string
  title: string
  type: 'image' | 'video' | 'audio'
  previewUrl?: string | null
  durationSeconds?: number | null
  role?: CanvasGenerationReferenceRole
  url?: string | null
  materialId?: string | null
}

/**
 * New nodes carry an explicit processType. The title/ratio fallback keeps
 * panoramas created by early canvas builds discoverable after reopening them.
 */
export function isCanvasPanoramaNodeData(
  data: Pick<CanvasNodeData, 'processType' | 'title' | 'generation'>,
): boolean {
  if (isCanvasPanoramaProcessType(data.processType)) return true
  if (isCanvasPanoramaProcessType(data.generation?.parameters?.processType)) return true

  const title = typeof data.title === 'string' ? data.title.replace(/\s+/g, '') : ''
  const aspectRatio = data.generation?.aspectRatio
  return (aspectRatio === '21:9' || aspectRatio === '2:1')
    && /720(?:°|度)?全景/.test(title)
}

export type CanvasPersistentGenerationTask = {
  kind: 'text' | 'storyboard_plan'
  taskId: string
  retryOf?: string | null
  submittedAt?: string
  completed?: boolean
}

export type CanvasGenerationHistoryItem = {
  id: string
  assetId?: string
  taskId?: string
  url?: string | null
  text?: string | null
  materialId?: string | null
  prompt?: string | null
  modelKey?: string | null
  parameters?: Record<string, string | number | boolean | null>
  references?: CanvasGenerationReferenceSummary[]
  source?: 'generation' | 'upload' | 'canvas' | 'project'
  status: 'pending' | 'processing' | 'ready' | 'failed'
  errorMessage?: string | null
  createdAt: string
}

const CANVAS_GENERATION_HISTORY_MAX_ITEMS = 40
const CANVAS_GENERATION_HISTORY_MAX_BYTES = 192 * 1024

/**
 * Keep generation history comfortably below the 512 KiB node-data ceiling.
 * Oversized individual entries are omitted from history; the generated value
 * itself still remains on the node as the current version.
 */
export function prependCanvasGenerationHistory(
  item: CanvasGenerationHistoryItem,
  history: CanvasGenerationHistoryItem[] | undefined,
): CanvasGenerationHistoryItem[] {
  const encoder = new TextEncoder()
  const candidates = [item, ...(history || []).filter((entry) => entry.id !== item.id)]
  const kept: CanvasGenerationHistoryItem[] = []
  let bytes = 2

  for (const candidate of candidates) {
    if (kept.length >= CANVAS_GENERATION_HISTORY_MAX_ITEMS) break
    const candidateBytes = encoder.encode(JSON.stringify(candidate)).byteLength + (kept.length > 0 ? 1 : 0)
    if (candidateBytes > CANVAS_GENERATION_HISTORY_MAX_BYTES || bytes + candidateBytes > CANVAS_GENERATION_HISTORY_MAX_BYTES) continue
    kept.push(candidate)
    bytes += candidateBytes
  }
  return kept
}

export function resolveCanvasRegenerationMode(data: Pick<CanvasNodeData, 'processType' | 'generation' | 'generationTask'>) {
  const configuredCount = data.generation?.count
  const count = typeof configuredCount === 'number' && Number.isFinite(configuredCount)
    ? Math.max(1, Math.floor(configuredCount))
    : 1
  if (data.generationTask?.kind === 'storyboard_plan') {
    return { count: Math.max(4, Math.min(8, count)), storyboard: true as const }
  }
  return data.processType === 'storyboard'
    ? { count: 1, storyboard: false as const }
    : { count, storyboard: false as const }
}

export function resolveCanvasModel3DRegenerationOptions(
  data: Pick<CanvasNodeData, 'generation'>,
): {
  model3dTopology: 'standard' | 'low_poly'
  model3dGenerateTexture: boolean
  model3dPose: 'none' | 'a_pose' | 't_pose'
} {
  const parameters = data.generation?.parameters
  const topology = parameters?.topology === 'low_poly' ? 'low_poly' as const : 'standard' as const
  const pose: 'none' | 'a_pose' | 't_pose' = parameters?.pose === 'a_pose' || parameters?.pose === 't_pose'
    ? parameters.pose
    : 'none'
  return {
    model3dTopology: topology,
    model3dGenerateTexture: parameters?.generateTexture !== false,
    model3dPose: pose,
  }
}

type CanvasEdgeEndpoint = { source: string; target: string }

export function removeDisconnectedCanvasReferences(
  referenceNodeIds: string[] | undefined,
  targetNodeId: string,
  removedEdges: CanvasEdgeEndpoint[],
  remainingEdges: CanvasEdgeEndpoint[],
) {
  if (!referenceNodeIds?.length) return referenceNodeIds
  const removedSources = new Set(removedEdges.filter((edge) => edge.target === targetNodeId).map((edge) => edge.source))
  if (removedSources.size === 0) return referenceNodeIds
  const stillConnected = new Set(remainingEdges.filter((edge) => edge.target === targetNodeId).map((edge) => edge.source))
  const next = referenceNodeIds.filter((sourceId) => !removedSources.has(sourceId) || stillConnected.has(sourceId))
  return next.length === referenceNodeIds.length ? referenceNodeIds : next
}

export function canvasHistoryHasRestorableValue(item: CanvasGenerationHistoryItem, mediaType: string) {
  return mediaType === 'text' ? typeof item.text === 'string' : Boolean(item.url)
}

export function isCanvasHistoryItemCurrent(item: CanvasGenerationHistoryItem, data: CanvasNodeData, mediaType: string) {
  if (mediaType === 'text') return typeof item.text === 'string' && item.text === (data.text ?? '')
  return Boolean(item.url && [data.contentUrl, data.imageUrl, data.videoUrl, data.audioUrl, data.modelUrl].includes(item.url))
}

export type CanvasDocumentInput = {
  /** Missing only on legacy documents; every current writer emits v1. */
  schema_version?: typeof CANVAS_DOCUMENT_SCHEMA_VERSION
  expectedRevision: number
  clientId: string
  changeSummary?: string | null
  viewport: Viewport
  nodes: CanvasNode[]
  edges: CanvasEdge[]
}

export type CanvasOperation =
  | { type: 'node.upsert'; node: Omit<CanvasNode, 'canvasId'> }
  | { type: 'node.delete'; id: string }
  | { type: 'edge.add'; edge: Omit<CanvasEdge, 'canvasId'> }
  | { type: 'edge.delete'; id: string }
  | {
      type: 'canvas.update_meta'
      title?: string
      themeColor?: string | null
      viewport?: Viewport
    }

export type CanvasOperationsInput = {
  expectedRevision: number
  clientId: string
  changeSummary?: string | null
  ops: CanvasOperation[]
}

export type CanvasListResponse = {
  canvases: Canvas[]
}

export const CANVAS_NODE_TYPE_NOTE = 'note'
export const CANVAS_NODE_TYPE_TEXT = 'text'
export const CANVAS_NODE_TYPE_IMAGE = 'image'
export const CANVAS_NODE_TYPE_VIDEO = 'video'
export const CANVAS_NODE_TYPE_VIDEO_EDIT = 'video_edit'
export const CANVAS_NODE_TYPE_AUDIO = 'audio'
export const CANVAS_NODE_TYPE_MODEL_3D = 'model_3d'
export const CANVAS_NODE_TYPE_STUDIO_3D = 'studio_3d'
export const CANVAS_NODE_TYPE_GROUP = 'group'
export const CANVAS_NODE_TYPE_PRODUCTION_EPISODE = 'production_episode'
export const CANVAS_NODE_TYPE_PRODUCTION_STORYBOARD = 'production_storyboard'
export const CANVAS_NODE_TYPE_PRODUCTION_PANEL = 'production_panel'
export const CANVAS_NODE_TYPE_PRODUCTION_VIDEO = 'production_video'
export const CANVAS_NODE_TYPE_PLAYLIST = 'playlist'
