import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { requireCanvasInProject } from '@/lib/canvas/access'
import { parseUpdateCanvasInput } from '@/lib/canvas/validators'
import { reconcileCanvasGenerationNodes } from '@/lib/canvas/generation-reconciliation'
import { withCanonicalCanvasStudioDocumentSource } from '@/lib/canvas/studio-document-lifecycle'

// GET - 获取画布元数据 + 节点 + 边（一次性返回，前端单次加载）
export const GET = apiHandler(async (
  _request: NextRequest,
  context: { params: Promise<{ projectId: string; canvasId: string }> }
) => {
  const { projectId, canvasId } = await context.params
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const canvas = await requireCanvasInProject(canvasId, projectId)

  const [nodes, edges] = await Promise.all([
    prisma.canvasNode.findMany({
      where: { canvasId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        canvasId: true,
        type: true,
        position: true,
        size: true,
        data: true,
        status: true,
        taskId: true,
        runId: true,
        mediaObjectId: true,
        parentNodeId: true,
        updatedAt: true,
      },
    }),
    prisma.canvasEdge.findMany({
      where: { canvasId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        canvasId: true,
        sourceNodeId: true,
        targetNodeId: true,
        sourceHandle: true,
        targetHandle: true,
        role: true,
      },
    }),
  ])
  const reconciledRows = await reconcileCanvasGenerationNodes({
    projectId,
    canvasId,
    nodes,
  })
  const reconciledNodes = reconciledRows.map(({ updatedAt, ...node }) => {
    void updatedAt
    return withCanonicalCanvasStudioDocumentSource(node, projectId, canvasId)
  })

  return NextResponse.json({ canvas, nodes: reconciledNodes, edges })
})

// PATCH - 更新画布元数据（标题/主题色/viewport）
export const PATCH = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string; canvasId: string }> }
) => {
  const { projectId, canvasId } = await context.params
  const authResult = await requireProjectAuthLight(projectId, ['canvasWrite'])
  if (isErrorResponse(authResult)) return authResult

  await requireCanvasInProject(canvasId, projectId)

  const body = await request.json().catch(() => null)
  const parsed = parseUpdateCanvasInput(body)
  if (!parsed || Object.keys(parsed).length === 0) {
    throw new ApiError('INVALID_PARAMS')
  }

  const canvas = await prisma.canvas.update({
    where: { id: canvasId },
    data: parsed,
    select: {
      id: true,
      projectId: true,
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

  return NextResponse.json({ canvas })
})

// DELETE - 删除画布（级联删除节点与边）
export const DELETE = apiHandler(async (
  _request: NextRequest,
  context: { params: Promise<{ projectId: string; canvasId: string }> }
) => {
  const { projectId, canvasId } = await context.params
  const authResult = await requireProjectAuthLight(projectId, ['canvasWrite'])
  if (isErrorResponse(authResult)) return authResult

  await requireCanvasInProject(canvasId, projectId)

  await prisma.canvas.delete({ where: { id: canvasId } })

  return NextResponse.json({ success: true })
})
