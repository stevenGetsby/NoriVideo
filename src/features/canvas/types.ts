export type Viewport = { x: number; y: number; zoom: number }

export type Canvas = {
  id: string
  projectId: string
  title: string
  themeColor: string | null
  viewport: Viewport | null
  visibility: string
  forkedFromId: string | null
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
  /** 生产画布节点引用的业务对象 */
  sourceType?: 'episode' | 'storyboard' | 'panel' | 'video'
  sourceId?: string
  title?: string
  subtitle?: string
  description?: string | null
  imageUrl?: string | null
  videoUrl?: string | null
  prompt?: string | null
  statusLabel?: string | null
  episodeNumber?: number
  panelIndex?: number
  hasImage?: boolean
  hasVideo?: boolean
  stats?: Record<string, number>
  /** 后续节点类型保留字段，避免破坏向后兼容 */
  [key: string]: unknown
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

export type CanvasListResponse = {
  canvases: Canvas[]
}

export const CANVAS_NODE_TYPE_NOTE = 'note'
export const CANVAS_NODE_TYPE_PRODUCTION_EPISODE = 'production_episode'
export const CANVAS_NODE_TYPE_PRODUCTION_STORYBOARD = 'production_storyboard'
export const CANVAS_NODE_TYPE_PRODUCTION_PANEL = 'production_panel'
export const CANVAS_NODE_TYPE_PRODUCTION_VIDEO = 'production_video'
