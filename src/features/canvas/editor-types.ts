import { MarkerType, type Edge, type Node, type XYPosition } from '@xyflow/react'
import {
  prependCanvasGenerationHistory,
  type CanvasEdge,
  type CanvasGenerationHistoryItem,
  type CanvasNode,
  type CanvasNodeData,
} from './types'
import {
  CANVAS_NODE_TYPE_AUDIO,
  CANVAS_NODE_TYPE_GROUP,
  CANVAS_NODE_TYPE_IMAGE,
  CANVAS_NODE_TYPE_MODEL_3D,
  CANVAS_NODE_TYPE_NOTE,
  CANVAS_NODE_TYPE_PLAYLIST,
  CANVAS_NODE_TYPE_STUDIO_3D,
  CANVAS_NODE_TYPE_TEXT,
  CANVAS_NODE_TYPE_VIDEO,
} from './types'

export type CanvasFlowNodeData = CanvasNodeData & {
  __server?: {
    status: string
    taskId: string | null
    runId: string | null
    mediaObjectId: string | null
    parentNodeId: string | null
  }
}

export type CanvasFlowNode = Node<CanvasFlowNodeData, string>
export type CanvasFlowEdge = Edge<{ role: string }>

export type CanvasConnectionInput = {
  source: string | null
  target: string | null
  sourceHandle?: string | null
  targetHandle?: string | null
}

export type CanvasNormalizedConnection = {
  source: string
  target: string
  sourceHandle: 'output'
  targetHandle: 'input'
}

export type CanvasShortcutInput = Pick<KeyboardEvent, 'key' | 'altKey' | 'ctrlKey' | 'metaKey'>

/**
 * During a blocking server reconciliation, suppress only shortcuts that would
 * mutate or persist the canvas. Everything else (notably Tab and browser/OS
 * shortcuts such as Alt+Arrow or Cmd+L) must keep its native behavior.
 */
export function shouldBlockCanvasShortcutWhileLocked(input: CanvasShortcutInput): boolean {
  if (input.altKey) return false
  const modifier = input.metaKey || input.ctrlKey
  if (modifier) return ['z', 'y', 'x', 'v', 'd', 's'].includes(input.key.toLowerCase())
  return ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Backspace', 'Delete'].includes(input.key)
}

/**
 * FrameOS exposes both the left and right ports as connection start/end
 * points.  Persisted edges remain directional, so a gesture that starts from
 * a left port is reversed before validation and storage.
 */
export function normalizeCanvasConnection(connection: CanvasConnectionInput): CanvasNormalizedConnection | null {
  if (!connection.source || !connection.target) return null
  const sourceSide = connection.sourceHandle === 'left' || connection.sourceHandle === 'input' ? 'left' : 'right'
  const targetSide = connection.targetHandle === 'right' || connection.targetHandle === 'output' ? 'right' : 'left'
  if (sourceSide === targetSide) return null
  if (sourceSide === 'left') {
    return {
      source: connection.target,
      target: connection.source,
      sourceHandle: 'output',
      targetHandle: 'input',
    }
  }
  return {
    source: connection.source,
    target: connection.target,
    sourceHandle: 'output',
    targetHandle: 'input',
  }
}

export type CanvasNodeMenuType =
  | typeof CANVAS_NODE_TYPE_TEXT
  | typeof CANVAS_NODE_TYPE_IMAGE
  | typeof CANVAS_NODE_TYPE_VIDEO
  | typeof CANVAS_NODE_TYPE_AUDIO
  | typeof CANVAS_NODE_TYPE_MODEL_3D
  | typeof CANVAS_NODE_TYPE_STUDIO_3D
  | typeof CANVAS_NODE_TYPE_PLAYLIST

export type CanvasMenuPoint = {
  x: number
  y: number
  flowPosition?: XYPosition
}

export function clampCanvasMenuPoint(
  point: Pick<CanvasMenuPoint, 'x' | 'y'>,
  viewport: { width: number; height: number },
  menu: { width: number; height: number },
  margin = 8,
): Pick<CanvasMenuPoint, 'x' | 'y'> {
  const maxX = Math.max(margin, viewport.width - menu.width - margin)
  const maxY = Math.max(margin, viewport.height - menu.height - margin)
  return {
    x: Math.max(margin, Math.min(point.x, maxX)),
    y: Math.max(margin, Math.min(point.y, maxY)),
  }
}

export type CanvasContextMenuState = CanvasMenuPoint & (
  | { scope: 'pane' }
  | { scope: 'node'; nodeId: string }
  | { scope: 'group'; groupId: string }
  | { scope: 'edge'; edgeId: string }
)

export type CanvasWireMenuState = CanvasMenuPoint & {
  sourceNodeId: string
  sourceHandle: string | null
}

export type CanvasReplaceableMediaType = 'image' | 'video' | 'audio' | 'model3d'

type CanvasReplacementMaterial = {
  id: string
  type: CanvasReplaceableMediaType
  url: string
}

export function canvasReplacementAccept(type: CanvasReplaceableMediaType): string {
  if (type === 'image') return 'image/*'
  if (type === 'video') return 'video/*'
  if (type === 'audio') return 'audio/*'
  return '.glb,model/gltf-binary'
}

export function isMatchingCanvasReplacementFile(
  type: CanvasReplaceableMediaType,
  file: Pick<File, 'name' | 'type'>,
): boolean {
  if (type === 'model3d') {
    if (/\.gltf$/i.test(file.name)) return false
    return file.type === 'model/gltf-binary' || /\.glb$/i.test(file.name)
  }
  return file.type.startsWith(`${type}/`)
}

function replaceableMediaType(node: CanvasFlowNode): CanvasReplaceableMediaType | null {
  const type = node.data.mediaType || (node.type === CANVAS_NODE_TYPE_MODEL_3D ? 'model3d' : node.type)
  return type === 'image' || type === 'video' || type === 'audio' || type === 'model3d' ? type : null
}

function currentMediaUrl(node: CanvasFlowNode, type: CanvasReplaceableMediaType): string | null {
  if (type === 'image') return node.data.imageUrl || node.data.contentUrl || null
  if (type === 'video') return node.data.videoUrl || node.data.contentUrl || null
  if (type === 'audio') return node.data.audioUrl || node.data.contentUrl || null
  return node.data.modelUrl || node.data.contentUrl || null
}

/**
 * Replace the value of an existing media node while keeping its identity and
 * bounded version history. Upload-backed nodes cannot retain generation input
 * references, so task IDs, transient derivative metadata and reference-only
 * parameters are removed here as one atomic data transition.
 */
export function replaceCanvasNodeContent(
  node: CanvasFlowNode,
  material: CanvasReplacementMaterial,
  options: { createId?: () => string; createdAt?: string } = {},
): CanvasFlowNode {
  const type = replaceableMediaType(node)
  if (!type || type !== material.type) throw new Error('替换文件类型与节点不一致')

  const createId = options.createId || (() => crypto.randomUUID())
  const createdAt = options.createdAt || new Date().toISOString()
  const oldUrl = currentMediaUrl(node, type)
  let history = node.data.history
  if (oldUrl) {
    const existing = history?.find((item) => item.url === oldUrl)
    const previous: CanvasGenerationHistoryItem = existing || {
      id: createId(),
      url: oldUrl,
      materialId: node.data.materialId,
      prompt: node.data.prompt || '替换前版本',
      modelKey: node.data.generation?.modelKey,
      source: 'canvas',
      status: 'ready',
      createdAt,
    }
    history = prependCanvasGenerationHistory(previous, history)
  }
  history = prependCanvasGenerationHistory({
    id: createId(),
    url: material.url,
    materialId: material.id,
    prompt: '本地替换内容',
    source: 'upload',
    status: 'ready',
    createdAt,
  }, history)

  const generation = node.data.generation
  const parameters = { ...(generation?.parameters || {}) }
  delete parameters.maskMaterialId
  delete parameters.referenceMaterialId

  return {
    ...node,
    data: {
      ...node.data,
      origin: 'upload',
      processType: type === 'model3d' ? 'model_3d' : undefined,
      materialId: material.id,
      contentUrl: material.url,
      imageUrl: type === 'image' ? material.url : null,
      videoUrl: type === 'video' ? material.url : null,
      audioUrl: type === 'audio' ? material.url : null,
      modelUrl: type === 'model3d' ? material.url : null,
      posterUrl: null,
      isFavorited: false,
      history,
      progress: 100,
      errorMessage: null,
      storyboardIndex: undefined,
      storyboardTitle: undefined,
      generation: generation ? {
        ...generation,
        assetId: undefined,
        taskId: undefined,
        referenceNodeIds: [],
        parameters: Object.keys(parameters).length > 0 ? parameters : undefined,
      } : generation,
      __server: {
        ...node.data.__server,
        status: 'SUCCEEDED',
        taskId: null,
        runId: null,
        mediaObjectId: null,
        parentNodeId: node.data.__server?.parentNodeId ?? null,
      },
    },
  }
}

export const CANVAS_ADD_NODE_ITEMS: Array<{
  type: CanvasNodeMenuType
  label: string
  description: string
  icon: 'text' | 'image' | 'video' | 'box3d' | 'studio3d' | 'playlist'
}> = [
  { type: CANVAS_NODE_TYPE_TEXT, label: '文本', description: '脚本、提示词与文案', icon: 'text' },
  { type: CANVAS_NODE_TYPE_IMAGE, label: '图片', description: '生成或引用图片', icon: 'image' },
  { type: CANVAS_NODE_TYPE_VIDEO, label: '视频', description: '生成或引用视频', icon: 'video' },
  { type: CANVAS_NODE_TYPE_PLAYLIST, label: '播放列表', description: '顺序剪辑并提交最终审核', icon: 'playlist' },
  { type: CANVAS_NODE_TYPE_MODEL_3D, label: '3D模型', description: '生成或上传 GLB', icon: 'box3d' },
  { type: CANVAS_NODE_TYPE_STUDIO_3D, label: '3D导演台', description: '布景、机位与截图', icon: 'studio3d' },
]

export const DEFAULT_NODE_SIZES: Record<string, { width: number; height: number }> = {
  [CANVAS_NODE_TYPE_NOTE]: { width: 300, height: 200 },
  [CANVAS_NODE_TYPE_TEXT]: { width: 300, height: 200 },
  [CANVAS_NODE_TYPE_IMAGE]: { width: 300, height: 200 },
  [CANVAS_NODE_TYPE_VIDEO]: { width: 320, height: 220 },
  [CANVAS_NODE_TYPE_AUDIO]: { width: 320, height: 150 },
  [CANVAS_NODE_TYPE_MODEL_3D]: { width: 320, height: 240 },
  [CANVAS_NODE_TYPE_STUDIO_3D]: { width: 360, height: 260 },
  [CANVAS_NODE_TYPE_PLAYLIST]: { width: 1040, height: 640 },
  [CANVAS_NODE_TYPE_GROUP]: { width: 680, height: 420 },
  production_episode: { width: 300, height: 180 },
  production_storyboard: { width: 300, height: 180 },
  production_panel: { width: 260, height: 270 },
  production_video: { width: 260, height: 240 },
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function defaultCanvasNodeData(type: CanvasNodeMenuType): CanvasNodeData {
  if (type === CANVAS_NODE_TYPE_TEXT) {
    return { title: '文本节点', mediaType: 'text', origin: 'empty', text: '', prompt: '' }
  }
  if (type === CANVAS_NODE_TYPE_IMAGE) {
    return { title: '图片节点', mediaType: 'image', origin: 'empty', prompt: '', generation: { aspectRatio: '16:9', resolution: '2K', quality: 'high', count: 1 } }
  }
  if (type === CANVAS_NODE_TYPE_VIDEO) {
    return { title: '视频节点', mediaType: 'video', origin: 'empty', prompt: '', generation: { aspectRatio: '16:9', resolution: '720p', duration: 5, inputMode: 'text', generateAudio: true } }
  }
  if (type === CANVAS_NODE_TYPE_PLAYLIST) {
    return { title: '播放列表', origin: 'empty', playlistItems: [] }
  }
  if (type === CANVAS_NODE_TYPE_AUDIO) {
    return { title: '音频节点', mediaType: 'audio', origin: 'empty', prompt: '' }
  }
  if (type === CANVAS_NODE_TYPE_MODEL_3D) {
    return {
      title: '3D模型',
      mediaType: 'model3d',
      origin: 'empty',
      processType: 'model_3d',
      prompt: '',
      generation: { parameters: { topology: 'standard', generateTexture: true, pose: 'none' } },
    }
  }
  return { title: '3D导演台', mediaType: 'image', origin: 'empty', processType: 'studio_3d' }
}

export function canvasNodeToFlow(node: CanvasNode): CanvasFlowNode {
  const fallback = DEFAULT_NODE_SIZES[node.type] || DEFAULT_NODE_SIZES[CANVAS_NODE_TYPE_IMAGE]
  const requestedWidth = finite(node.size?.width) ? node.size.width : fallback.width
  const requestedHeight = finite(node.size?.height) ? node.size.height : fallback.height
  const width = node.type === CANVAS_NODE_TYPE_PLAYLIST ? Math.max(760, requestedWidth) : requestedWidth
  const height = node.type === CANVAS_NODE_TYPE_PLAYLIST ? Math.max(500, requestedHeight) : requestedHeight
  return {
    id: node.id,
    type: node.type,
    position: node.position,
    width,
    height,
    zIndex: node.type === CANVAS_NODE_TYPE_GROUP ? -10 : 1,
    data: {
      ...(node.data || {}),
      __server: {
        status: node.status,
        taskId: node.taskId,
        runId: node.runId,
        mediaObjectId: node.mediaObjectId,
        parentNodeId: node.parentNodeId,
      },
    },
  }
}

function terminalExecutionIds(node: CanvasFlowNode): Set<string> {
  const values = [
    node.data.__server?.taskId,
    node.data.__server?.runId,
    node.data.generation?.assetId,
    node.data.generation?.taskId,
    node.data.generationTask?.taskId,
  ]
  return new Set(values.filter((value): value is string => typeof value === 'string' && Boolean(value.trim())))
}

function sameOrUnknownTerminalExecution(local: CanvasFlowNode, server: CanvasFlowNode): boolean {
  const localIds = terminalExecutionIds(local)
  const serverIds = terminalExecutionIds(server)
  if (localIds.size === 0 || serverIds.size === 0) return true
  return Array.from(localIds).some((id) => serverIds.has(id))
}

function mergeTerminalHistory(
  local: CanvasGenerationHistoryItem[] | undefined,
  server: CanvasGenerationHistoryItem[] | undefined,
) {
  if (!server) return local
  if (!local) return server
  const known = new Set(server.map((item) => item.id))
  return [...server, ...local.filter((item) => !known.has(item.id))]
}

/**
 * Project only task terminal truth into an actively edited flow node. Position,
 * size, selection and non-task data stay local, so a response from an earlier
 * autosave cannot erase edits made while that request was in flight.
 */
export function mergeServerTerminalFlowNode(
  local: CanvasFlowNode,
  server: CanvasFlowNode,
): CanvasFlowNode {
  const serverData = server.data as CanvasFlowNodeData & Record<string, unknown>
  const localData = local.data as CanvasFlowNodeData & Record<string, unknown>
  const serverStudioSource = serverData.__studioDocumentSource
  const localWithCanonicalStudioSource = local.type === 'studio_3d'
    && serverStudioSource
    && typeof serverStudioSource === 'object'
    && JSON.stringify(localData.__studioDocumentSource) !== JSON.stringify(serverStudioSource)
    ? {
        ...local,
        data: { ...local.data, __studioDocumentSource: serverStudioSource },
      }
    : local
  const localStatus = local.data.__server?.status
  const serverStatus = server.data.__server?.status
  if (
    localStatus !== 'RUNNING'
    || (serverStatus !== 'SUCCEEDED' && serverStatus !== 'FAILED')
    || !sameOrUnknownTerminalExecution(local, server)
  ) return localWithCanonicalStudioSource

  const data = { ...localWithCanonicalStudioSource.data } as CanvasFlowNodeData & Record<string, unknown>
  for (const key of [
    'contentUrl',
    'posterUrl',
    'imageUrl',
    'videoUrl',
    'audioUrl',
    'modelUrl',
    'materialId',
    'sourceMetadata',
    'progress',
    'errorMessage',
    'pollErrorMessage',
    'generationTask',
  ]) {
    if (Object.prototype.hasOwnProperty.call(serverData, key)) data[key] = serverData[key]
  }
  data.history = mergeTerminalHistory(local.data.history, server.data.history)
  data.__server = server.data.__server
  return { ...localWithCanonicalStudioSource, data }
}

export function flowNodeToCanvas(node: CanvasFlowNode, canvasId: string): CanvasNode {
  const fallback = DEFAULT_NODE_SIZES[node.type || CANVAS_NODE_TYPE_IMAGE] || DEFAULT_NODE_SIZES[CANVAS_NODE_TYPE_IMAGE]
  const width = finite(node.width) ? node.width : finite(node.measured?.width) ? node.measured.width : fallback.width
  const height = finite(node.height) ? node.height : finite(node.measured?.height) ? node.measured.height : fallback.height
  const { __server, ...data } = node.data
  return {
    id: node.id,
    canvasId,
    type: node.type || CANVAS_NODE_TYPE_IMAGE,
    position: node.position,
    size: { width, height },
    data,
    status: __server?.status || 'IDLE',
    taskId: __server?.taskId || null,
    runId: __server?.runId || null,
    mediaObjectId: __server?.mediaObjectId || null,
    parentNodeId: __server?.parentNodeId || null,
  }
}

export function canvasEdgeToFlow(edge: CanvasEdge): CanvasFlowEdge {
  return {
    id: edge.id,
    source: edge.sourceNodeId,
    target: edge.targetNodeId,
    sourceHandle: edge.sourceHandle || undefined,
    targetHandle: edge.targetHandle || undefined,
    type: 'bezier',
    markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
    data: { role: edge.role },
  }
}

export function flowEdgeToCanvas(edge: CanvasFlowEdge, canvasId: string): CanvasEdge {
  return {
    id: edge.id,
    canvasId,
    sourceNodeId: edge.source,
    targetNodeId: edge.target,
    sourceHandle: edge.sourceHandle || null,
    targetHandle: edge.targetHandle || null,
    role: edge.data?.role || 'INPUT_DEFAULT',
  }
}

export function createFlowNode(type: CanvasNodeMenuType, position: XYPosition): CanvasFlowNode {
  const size = DEFAULT_NODE_SIZES[type]
  return {
    id: crypto.randomUUID(),
    type,
    position,
    width: size.width,
    height: size.height,
    zIndex: 1,
    selected: true,
    data: {
      ...defaultCanvasNodeData(type),
      __server: {
        status: 'IDLE',
        taskId: null,
        runId: null,
        mediaObjectId: null,
        parentNodeId: null,
      },
    },
  }
}
