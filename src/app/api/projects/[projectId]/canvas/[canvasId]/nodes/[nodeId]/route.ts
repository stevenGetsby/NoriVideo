import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { requireCanvasInProject } from '@/lib/canvas/access'

// DELETE - 删除单个节点（同时清理其关联的边）
export const DELETE = apiHandler(async (
  _request: NextRequest,
  context: { params: Promise<{ projectId: string; canvasId: string; nodeId: string }> }
) => {
  const { projectId, canvasId, nodeId } = await context.params
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  await requireCanvasInProject(canvasId, projectId)

  const node = await prisma.canvasNode.findFirst({
    where: {
      id: nodeId,
      canvasId,
    },
    select: { id: true, canvasId: true },
  })
  if (!node) {
    throw new ApiError('NOT_FOUND')
  }

  await prisma.$transaction([
    prisma.canvasEdge.deleteMany({
      where: {
        canvasId,
        OR: [{ sourceNodeId: nodeId }, { targetNodeId: nodeId }],
      },
    }),
    prisma.canvasNode.delete({ where: { id: node.id } }),
  ])

  return NextResponse.json({ success: true })
})
