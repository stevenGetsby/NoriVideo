import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { requireCanvasInProject } from '@/lib/canvas/access'
import { prisma } from '@/lib/prisma'
import { sanitizePublicCanvasData } from '@/lib/task/public-presentation'
import { reconcileCanvasGenerationNodes } from '@/lib/canvas/generation-reconciliation'
import { withCanonicalCanvasStudioDocumentSource } from '@/lib/canvas/studio-document-lifecycle'
import { readCanvasNodeDetailRow } from '@/lib/canvas/summary-db-reader'
import {
  CANVAS_DETAIL_VIEW,
  CANVAS_HISTORY_ITEM_VIEW,
  CANVAS_HISTORY_VIEW,
  pageCanvasHistoryV1,
  summarizeCanvasHistoryItemV1,
} from '@/lib/canvas/graph-summary'
import { createCanvasNodeDetailVersion, type CanvasGenerationHistoryItem, type CanvasNode } from '@/features/canvas/types'

// GET - 按需读取完整节点、历史分页或单条历史；旧画布首屏仍走完整 graph。
export const GET = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string; canvasId: string; nodeId: string }> }
) => {
  const { projectId, canvasId, nodeId } = await context.params
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult
  await requireCanvasInProject(canvasId, projectId)

  const row = await readCanvasNodeDetailRow(canvasId, nodeId)
  if (!row) throw new ApiError('NOT_FOUND', { message: '画布节点不存在。' })
  const [reconciled] = await reconcileCanvasGenerationNodes({ projectId, canvasId, nodes: [row] })
  const { updatedAt, detailVersion: storedVersion, ...fields } = reconciled
  void updatedAt
  const node = withCanonicalCanvasStudioDocumentSource({
    ...fields,
    data: sanitizePublicCanvasData(fields.data),
  }, projectId, canvasId) as CanvasNode
  const detailVersion = reconciled === row ? storedVersion : createCanvasNodeDetailVersion(node)
  const view = request.nextUrl.searchParams.get('view')
  if (view === CANVAS_DETAIL_VIEW) {
    return NextResponse.json({ kind: CANVAS_DETAIL_VIEW, detailVersion, node }, { headers: { 'Cache-Control': 'private, no-cache' } })
  }
  if (view === CANVAS_HISTORY_VIEW) {
    const rawLimit = Number(request.nextUrl.searchParams.get('limit') || 20)
    const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(40, Math.floor(rawLimit))) : 20
    const page = pageCanvasHistoryV1(node.data?.history, { limit, cursor: request.nextUrl.searchParams.get('cursor') })
    return NextResponse.json({
      kind: CANVAS_HISTORY_VIEW,
      detailVersion,
      items: page.items.map(summarizeCanvasHistoryItemV1),
      nextCursor: page.nextCursor,
    }, { headers: { 'Cache-Control': 'private, no-cache' } })
  }
  if (view === CANVAS_HISTORY_ITEM_VIEW) {
    const entryId = request.nextUrl.searchParams.get('entryId')
    const item = (node.data?.history || []).find((entry: CanvasGenerationHistoryItem) => entry.id === entryId)
    if (!item) throw new ApiError('NOT_FOUND', { message: '历史条目不存在或不属于该节点。' })
    return NextResponse.json({ kind: CANVAS_HISTORY_ITEM_VIEW, detailVersion, item }, { headers: { 'Cache-Control': 'private, no-cache' } })
  }
  throw new ApiError('INVALID_PARAMS', { message: '节点读取视图无效。' })
})

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
