import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { requireCanvasInProject, isAllowedNodeType } from '@/lib/canvas/access'
import { parseBulkPatchNodesInput, parseCreateNodeInput } from '@/lib/canvas/validators'

function resolveNullableJson(value: unknown | null | undefined): Prisma.InputJsonValue | typeof Prisma.JsonNull | undefined {
  if (value === undefined) return undefined
  if (value === null) return Prisma.JsonNull
  return value as Prisma.InputJsonValue
}

// POST - 创建单个节点
export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string; canvasId: string }> }
) => {
  const { projectId, canvasId } = await context.params
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  await requireCanvasInProject(canvasId, projectId)

  const body = await request.json().catch(() => null)
  const parsed = parseCreateNodeInput(body)
  if (!parsed) {
    throw new ApiError('INVALID_PARAMS')
  }
  if (!isAllowedNodeType(parsed.type)) {
    throw new ApiError('INVALID_PARAMS', { reason: 'unsupported_node_type', type: parsed.type })
  }

  const node = await prisma.canvasNode.create({
    data: {
      canvasId,
      type: parsed.type,
      position: parsed.position as unknown as Prisma.InputJsonValue,
      size: resolveNullableJson(parsed.size),
      data: resolveNullableJson(parsed.data),
      parentNodeId: parsed.parentNodeId ?? null,
    },
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
    },
  })

  return NextResponse.json({ node }, { status: 201 })
})

// PATCH - 批量更新节点（位置/大小/data；前端拖拽防抖后聚合提交）
export const PATCH = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string; canvasId: string }> }
) => {
  const { projectId, canvasId } = await context.params
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  await requireCanvasInProject(canvasId, projectId)

  const body = await request.json().catch(() => null)
  const updates = parseBulkPatchNodesInput(body)
  if (!updates) {
    throw new ApiError('INVALID_PARAMS')
  }
  if (updates.length === 0) {
    return NextResponse.json({ updated: 0 })
  }

  const ids = updates.map((u) => u.id)
  const existing = await prisma.canvasNode.findMany({
    where: { canvasId, id: { in: ids } },
    select: { id: true },
  })
  const existingIds = new Set(existing.map((e) => e.id))
  if (existingIds.size !== ids.length) {
    throw new ApiError('NOT_FOUND', { reason: 'unknown_node_ids' })
  }

  await prisma.$transaction(
    updates.map((u) =>
      prisma.canvasNode.update({
        where: { id: u.id },
        data: {
          position: u.position === undefined ? undefined : (u.position as unknown as Prisma.InputJsonValue),
          size: u.size === undefined ? undefined : (u.size as unknown as Prisma.InputJsonValue),
          data: resolveNullableJson(u.data),
        },
      })
    )
  )

  return NextResponse.json({ updated: updates.length })
})
