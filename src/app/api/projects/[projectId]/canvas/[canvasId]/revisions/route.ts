import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireProjectAuthLight } from '@/lib/api-auth'
import { requireCanvasInProject } from '@/lib/canvas/access'
import { parseCanvasDocumentSaveInput } from '@/lib/canvas/document'
import { replaceCanvasDocumentInTransaction } from '@/lib/canvas/persistence'
import { prisma } from '@/lib/prisma'

export const GET = apiHandler(async (
  _request: NextRequest,
  context: { params: Promise<{ projectId: string; canvasId: string }> },
) => {
  const { projectId, canvasId } = await context.params
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult
  await requireCanvasInProject(canvasId, projectId)

  const revisions = await prisma.canvasSnapshot.findMany({
    where: { canvasId },
    orderBy: { revision: 'desc' },
    take: 40,
    select: {
      id: true,
      revision: true,
      clientId: true,
      changeSummary: true,
      createdAt: true,
    },
  })
  return NextResponse.json({ revisions })
})

export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string; canvasId: string }> },
) => {
  const { projectId, canvasId } = await context.params
  const authResult = await requireProjectAuthLight(projectId, ['canvasWrite'])
  if (isErrorResponse(authResult)) return authResult
  const current = await requireCanvasInProject(canvasId, projectId)
  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  const snapshotId = typeof body?.snapshotId === 'string' ? body.snapshotId.trim() : ''
  if (!snapshotId) throw new ApiError('INVALID_PARAMS', { message: '请选择要恢复的历史版本。' })
  if (body?.expectedRevision !== current.revision) {
    throw new ApiError('CONFLICT', {
      message: '恢复前画布已被更新，请刷新历史版本后重试。',
      expectedRevision: body?.expectedRevision,
      actualRevision: current.revision,
    })
  }

  const snapshot = await prisma.canvasSnapshot.findFirst({
    where: { id: snapshotId, canvasId },
    select: {
      revision: true,
      document: true,
      studioDocuments: {
        select: { nodeId: true, revision: true, document: true },
      },
    },
  })
  if (!snapshot) throw new ApiError('NOT_FOUND')
  const document = snapshot.document && typeof snapshot.document === 'object' && !Array.isArray(snapshot.document)
    ? snapshot.document as Record<string, unknown>
    : null
  const input = parseCanvasDocumentSaveInput({
    ...(document || {}),
    expectedRevision: body?.expectedRevision,
    clientId: body?.clientId,
    changeSummary: `恢复到历史版本 ${snapshot.revision}`,
  })
  if (!input) throw new ApiError('INVALID_PARAMS', { message: '该历史版本数据已损坏，无法恢复。' })

  const savedGraph = await prisma.$transaction((tx) => replaceCanvasDocumentInTransaction(tx, {
    projectId,
    canvasId,
    userId: authResult.session.user.actorId || authResult.session.user.id,
    templateOwnerId: authResult.session.user.id,
    input,
    studioDocumentRestore: snapshot.studioDocuments,
  }))
  return NextResponse.json(savedGraph)
})
