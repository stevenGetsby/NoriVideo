import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { requireCanvasInProject } from '@/lib/canvas/access'

// DELETE - 删除单条边
export const DELETE = apiHandler(async (
  _request: NextRequest,
  context: { params: Promise<{ projectId: string; canvasId: string; edgeId: string }> }
) => {
  const { projectId, canvasId, edgeId } = await context.params
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  await requireCanvasInProject(canvasId, projectId)

  const edge = await prisma.canvasEdge.findUnique({
    where: { id: edgeId },
    select: { id: true, canvasId: true },
  })
  if (!edge || edge.canvasId !== canvasId) {
    throw new ApiError('NOT_FOUND')
  }

  await prisma.canvasEdge.delete({ where: { id: edgeId } })

  return NextResponse.json({ success: true })
})
