import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { requireCanvasInProject, CANVAS_EDGE_ROLE_VALUES } from '@/lib/canvas/access'
import { parseCreateEdgeInput } from '@/lib/canvas/validators'

// POST - 创建边
export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string; canvasId: string }> }
) => {
  const { projectId, canvasId } = await context.params
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  await requireCanvasInProject(canvasId, projectId)

  const body = await request.json().catch(() => null)
  const parsed = parseCreateEdgeInput(body)
  if (!parsed) {
    throw new ApiError('INVALID_PARAMS')
  }
  if (!(CANVAS_EDGE_ROLE_VALUES as readonly string[]).includes(parsed.role)) {
    throw new ApiError('INVALID_PARAMS', { reason: 'unsupported_edge_role', role: parsed.role })
  }

  // 校验两端节点都属于此画布
  const nodes = await prisma.canvasNode.findMany({
    where: {
      canvasId,
      id: { in: [parsed.sourceNodeId, parsed.targetNodeId] },
    },
    select: { id: true },
  })
  if (nodes.length !== 2) {
    throw new ApiError('NOT_FOUND', { reason: 'edge_endpoints_not_in_canvas' })
  }

  const existing = await prisma.canvasEdge.findFirst({
    where: {
      canvasId,
      sourceNodeId: parsed.sourceNodeId,
      targetNodeId: parsed.targetNodeId,
      sourceHandle: parsed.sourceHandle,
      targetHandle: parsed.targetHandle,
    },
  })
  if (existing) {
    return NextResponse.json({ edge: existing }, { status: 200 })
  }

  const edge = await prisma.canvasEdge.create({
    data: {
      canvasId,
      sourceNodeId: parsed.sourceNodeId,
      targetNodeId: parsed.targetNodeId,
      sourceHandle: parsed.sourceHandle,
      targetHandle: parsed.targetHandle,
      role: parsed.role,
    },
    select: {
      id: true,
      canvasId: true,
      sourceNodeId: true,
      targetNodeId: true,
      sourceHandle: true,
      targetHandle: true,
      role: true,
    },
  })

  return NextResponse.json({ edge }, { status: 201 })
})
