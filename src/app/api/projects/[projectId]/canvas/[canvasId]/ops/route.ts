import { NextRequest, NextResponse } from 'next/server'
import { ApiError, apiHandler } from '@/lib/api-errors'
import { isErrorResponse, requireProjectAuthLight } from '@/lib/api-auth'
import { CANVAS_DELTA_RESPONSE_HEADER } from '@/features/canvas/types'
import { requireCanvasInProject } from '@/lib/canvas/access'
import { validateCanvasOperationsSaveInput } from '@/lib/canvas/operations'
import { applyCanvasOperationsInTransaction } from '@/lib/canvas/persistence'
import { prisma } from '@/lib/prisma'

export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string; canvasId: string }> },
) => {
  const { projectId, canvasId } = await context.params
  const authResult = await requireProjectAuthLight(projectId, ['canvasWrite'])
  if (isErrorResponse(authResult)) return authResult

  const current = await requireCanvasInProject(canvasId, projectId)
  const body = await request.json().catch(() => null)
  const validation = validateCanvasOperationsSaveInput(body)
  if (!validation.success) {
    throw new ApiError('INVALID_PARAMS', {
      message: validation.error.message,
      reason: validation.error.code,
      ...(validation.error.actualBytes === undefined ? {} : { actualBytes: validation.error.actualBytes }),
      ...(validation.error.maxBytes === undefined ? {} : { maxBytes: validation.error.maxBytes }),
    })
  }
  const input = validation.data
  if (current.revision !== input.expectedRevision) {
    throw new ApiError('CONFLICT', {
      message: '画布已在另一个标签页中更新，请加载服务端版本或重新合并。',
      expectedRevision: input.expectedRevision,
      actualRevision: current.revision,
    })
  }

  const result = await prisma.$transaction((tx) => applyCanvasOperationsInTransaction(tx, {
    projectId,
    canvasId,
    userId: authResult.session.user.actorId || authResult.session.user.id,
    templateOwnerId: authResult.session.user.id,
    input,
  }))
  // A full graph is ~2 MB for a large canvas; callers that keep their own confirmed
  // document opt into the delta instead. Without the header (older tabs) keep sending
  // everything, since a client that treated a delta as the whole graph would delete
  // every node it did not see on its next diff.
  if (request.headers.get(CANVAS_DELTA_RESPONSE_HEADER) !== 'delta') {
    return NextResponse.json({ canvas: result.canvas, nodes: result.nodes, edges: result.edges })
  }
  return NextResponse.json({
    canvas: result.canvas,
    nodes: result.delta.nodes,
    edges: result.delta.edges,
    deletedNodeIds: result.delta.deletedNodeIds,
    deletedEdgeIds: result.delta.deletedEdgeIds,
  })
})
