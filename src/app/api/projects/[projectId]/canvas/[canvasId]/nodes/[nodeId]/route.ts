import { NextRequest } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { requireCanvasInProject } from '@/lib/canvas/access'

// DELETE - 删除单个节点（同时清理其关联的边）
export const DELETE = apiHandler(async (
  _request: NextRequest,
  context: { params: Promise<{ projectId: string; canvasId: string; nodeId: string }> }
) => {
  const { projectId, canvasId, nodeId } = await context.params
  const authResult = await requireProjectAuthLight(projectId, ['canvasWrite'])
  if (isErrorResponse(authResult)) return authResult

  await requireCanvasInProject(canvasId, projectId)
  throw new ApiError('CONFLICT', {
    message: '旧版画布节点增量写入接口已停用，以免绕过版本检查和历史快照。请改用完整文档保存接口。',
    reason: 'CANVAS_INCREMENTAL_WRITE_DISABLED',
    replacement: `/api/projects/${projectId}/canvas/${canvasId}/document`,
    replacementMethod: 'PUT',
    legacyNodeId: nodeId,
  })
})
