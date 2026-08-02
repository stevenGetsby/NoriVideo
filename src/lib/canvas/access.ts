import { prisma } from '@/lib/prisma'
import { ApiError } from '@/lib/api-errors'

/**
 * 验证画布属于指定项目，未找到/不匹配时抛 NOT_FOUND。
 * 调用前必须已经过 requireProjectAuthLight，否则不要直接信任 projectId。
 */
export async function requireCanvasInProject(canvasId: string, projectId: string) {
  const canvas = await prisma.canvas.findFirst({
    where: {
      id: canvasId,
      projectId,
    },
    select: {
      id: true,
      projectId: true,
      userId: true,
      title: true,
      themeColor: true,
      viewport: true,
      revision: true,
      visibility: true,
      forkedFromId: true,
      createdAt: true,
      updatedAt: true,
    },
  })
  if (!canvas) {
    throw new ApiError('NOT_FOUND')
  }
  return canvas
}

/**
 * Resolve a 3D studio node only after its parent canvas has been verified in
 * the authorized project. Keeping this lookup scoped prevents callers from
 * probing or updating a node by a globally-known node id.
 */
export async function requireStudioNodeInCanvas(nodeId: string, canvasId: string) {
  const node = await prisma.canvasNode.findFirst({
    where: {
      id: nodeId,
      canvasId,
      type: 'studio_3d',
    },
    select: {
      id: true,
      canvasId: true,
      type: true,
      data: true,
    },
  })
  if (!node) throw new ApiError('NOT_FOUND')
  return node
}

/**
 * Canvas DTO（返回给前端的统一形状，剥离敏感字段）。
 */
export type CanvasDTO = {
  id: string
  projectId: string
  title: string
  themeColor: string | null
  viewport: unknown | null
  revision: number
  visibility: string
  forkedFromId: string | null
  createdAt: string
  updatedAt: string
}

export type CanvasNodeDTO = {
  id: string
  canvasId: string
  type: string
  position: unknown
  size: unknown | null
  data: unknown | null
  status: string
  taskId: string | null
  runId: string | null
  mediaObjectId: string | null
  parentNodeId: string | null
}

export type CanvasEdgeDTO = {
  id: string
  canvasId: string
  sourceNodeId: string
  targetNodeId: string
  sourceHandle: string | null
  targetHandle: string | null
  role: string
}

export const CANVAS_VISIBILITY_VALUES = ['PRIVATE', 'UNLISTED', 'PUBLIC'] as const
export const CANVAS_NODE_STATUS_VALUES = ['IDLE', 'RUNNING', 'SUCCEEDED', 'FAILED'] as const
export const CANVAS_EDGE_ROLE_VALUES = [
  'INPUT_DEFAULT',
  'INPUT_TEXT',
  'INPUT_IMAGE',
  'FIRST_FRAME',
  'LAST_FRAME',
  'REF',
  'PRODUCTION_FLOW',
  'PANORAMA_VIEW',
  'STUDIO_CAMERA',
] as const

// 画布节点类型。媒体与生成节点使用通用类型，processType 放在 data 中。
export const CANVAS_NODE_TYPES = [
  'note',
  'text',
  'image',
  'video',
  'audio',
  'model_3d',
  'studio_3d',
  'group',
  'production_episode',
  'production_storyboard',
  'production_panel',
  'production_video',
  'playlist',
] as const
export type CanvasNodeType = (typeof CANVAS_NODE_TYPES)[number]

export function isAllowedNodeType(type: string): type is CanvasNodeType {
  return (CANVAS_NODE_TYPES as readonly string[]).includes(type)
}
