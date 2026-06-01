import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { parseCreateCanvasInput } from '@/lib/canvas/validators'

// GET - 列出项目下的画布
export const GET = apiHandler(async (
  _request: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) => {
  const { projectId } = await context.params
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const canvases = await prisma.canvas.findMany({
    where: { projectId },
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      projectId: true,
      title: true,
      themeColor: true,
      viewport: true,
      visibility: true,
      forkedFromId: true,
      createdAt: true,
      updatedAt: true,
    },
  })

  return NextResponse.json({ canvases })
})

// POST - 创建画布
export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) => {
  const { projectId } = await context.params
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  const body = await request.json().catch(() => null)
  const parsed = parseCreateCanvasInput(body)
  if (!parsed) {
    throw new ApiError('INVALID_PARAMS')
  }

  const canvas = await prisma.canvas.create({
    data: {
      projectId,
      userId: session.user.id,
      title: parsed.title,
      themeColor: parsed.themeColor,
      viewport: { x: 0, y: 0, zoom: 1 },
    },
    select: {
      id: true,
      projectId: true,
      title: true,
      themeColor: true,
      viewport: true,
      visibility: true,
      forkedFromId: true,
      createdAt: true,
      updatedAt: true,
    },
  })

  return NextResponse.json({ canvas }, { status: 201 })
})
