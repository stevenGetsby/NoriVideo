import { NextRequest } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { requireCanvasInProject } from '@/lib/canvas/access'

function rejectLegacyIncrementalWrite(projectId: string, canvasId: string): never {
  throw new ApiError('CONFLICT', {
    message: '旧版画布节点增量写入接口已停用，以免绕过版本检查和历史快照。请改用完整文档保存接口。',
    reason: 'CANVAS_INCREMENTAL_WRITE_DISABLED',
    replacement: `/api/projects/${projectId}/canvas/${canvasId}/document`,
    replacementMethod: 'PUT',
  })
}

// POST - 创建单个节点
export const POST = apiHandler(async (
  _request: NextRequest,
  context: { params: Promise<{ projectId: string; canvasId: string }> }
) => {
  const { projectId, canvasId } = await context.params
  const authResult = await requireProjectAuthLight(projectId, ['canvasWrite'])
  if (isErrorResponse(authResult)) return authResult

  await requireCanvasInProject(canvasId, projectId)
  return rejectLegacyIncrementalWrite(projectId, canvasId)
})

// PATCH - 批量更新节点（位置/大小/data；前端拖拽防抖后聚合提交）
export const PATCH = apiHandler(async (
  _request: NextRequest,
  context: { params: Promise<{ projectId: string; canvasId: string }> }
) => {
  const { projectId, canvasId } = await context.params
  const authResult = await requireProjectAuthLight(projectId, ['canvasWrite'])
  if (isErrorResponse(authResult)) return authResult

  await requireCanvasInProject(canvasId, projectId)
  return rejectLegacyIncrementalWrite(projectId, canvasId)
})
