import { Prisma } from '@prisma/client'
import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireProjectAuthLight } from '@/lib/api-auth'
import { requireCanvasInProject, requireStudioNodeInCanvas } from '@/lib/canvas/access'
import {
  normalizeStudioDocumentSeed,
  validateStudioDocumentSaveInput,
} from '@/lib/canvas/studio-document'
import { prisma } from '@/lib/prisma'

type RouteContext = {
  params: Promise<{ projectId: string; canvasId: string; nodeId: string }>
}

class StudioDocumentWriteRaceError extends Error {}

function legacyStudioScene(data: unknown): unknown {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  return (data as Record<string, unknown>).studioScene
}

function conflict(expectedRevision: number, actualRevision: number): never {
  throw new ApiError('CONFLICT', {
    message: '3D 导演台已在另一个窗口更新，请采用服务端版本或合并本地场景后重试。',
    reason: 'STUDIO_DOCUMENT_REVISION_CONFLICT',
    expectedRevision,
    actualRevision,
  })
}

async function requireScopedStudioNode(projectId: string, canvasId: string, nodeId: string) {
  await requireCanvasInProject(canvasId, projectId)
  return await requireStudioNodeInCanvas(nodeId, canvasId)
}

export const GET = apiHandler(async (
  _request: NextRequest,
  context: RouteContext,
) => {
  const { projectId, canvasId, nodeId } = await context.params
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const node = await requireScopedStudioNode(projectId, canvasId, nodeId)
  const stored = await prisma.canvasStudio3DDocument.findFirst({
    where: { projectId, canvasId, nodeId },
    select: {
      revision: true,
      document: true,
      updatedAt: true,
    },
  })

  const source = stored ? 'document' : legacyStudioScene(node.data) ? 'legacy-node' : 'default'
  const document = normalizeStudioDocumentSeed(stored?.document ?? legacyStudioScene(node.data))
  return NextResponse.json({
    studioDocument: {
      projectId,
      canvasId,
      nodeId,
      revision: stored?.revision ?? 0,
      document,
      updatedAt: stored?.updatedAt?.toISOString() ?? null,
      persisted: Boolean(stored),
      source,
    },
  })
})

export const PUT = apiHandler(async (
  request: NextRequest,
  context: RouteContext,
) => {
  const { projectId, canvasId, nodeId } = await context.params
  const authResult = await requireProjectAuthLight(projectId, ['canvasWrite'])
  if (isErrorResponse(authResult)) return authResult

  await requireScopedStudioNode(projectId, canvasId, nodeId)
  const body = await request.json().catch(() => null)
  const validation = validateStudioDocumentSaveInput(body)
  if (!validation.success) {
    throw new ApiError('INVALID_PARAMS', {
      message: validation.error.message,
      reason: validation.error.code,
      ...(validation.error.actualBytes === undefined ? {} : { actualBytes: validation.error.actualBytes }),
      ...(validation.error.maxBytes === undefined ? {} : { maxBytes: validation.error.maxBytes }),
    })
  }

  const { expectedRevision, document } = validation.data
  const updatedBy = authResult.session.user.actorId || authResult.session.user.id
  let saved
  try {
    saved = await prisma.$transaction(async (tx) => {
      const current = await tx.canvasStudio3DDocument.findFirst({
        where: { projectId, canvasId, nodeId },
        select: { id: true, revision: true },
      })

      if (!current) {
        if (expectedRevision !== 0) conflict(expectedRevision, 0)
        return await tx.canvasStudio3DDocument.create({
          data: {
            projectId,
            canvasId,
            nodeId,
            revision: 1,
            document: document as unknown as Prisma.InputJsonValue,
            updatedBy,
          },
          select: { revision: true, document: true, updatedAt: true },
        })
      }

      if (current.revision !== expectedRevision) conflict(expectedRevision, current.revision)
      const updateResult = await tx.canvasStudio3DDocument.updateMany({
        where: {
          id: current.id,
          projectId,
          canvasId,
          nodeId,
          revision: expectedRevision,
        },
        data: {
          document: document as unknown as Prisma.InputJsonValue,
          revision: { increment: 1 },
          updatedBy,
        },
      })
      if (updateResult.count !== 1) {
        // Re-read outside this transaction: MySQL's repeatable-read snapshot
        // may not see the concurrent winner that made updateMany return zero.
        throw new StudioDocumentWriteRaceError()
      }
      return await tx.canvasStudio3DDocument.findFirstOrThrow({
        where: { projectId, canvasId, nodeId },
        select: { revision: true, document: true, updatedAt: true },
      })
    })
  } catch (error) {
    if (
      error instanceof StudioDocumentWriteRaceError
      || (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
    ) {
      const actual = await prisma.canvasStudio3DDocument.findFirst({
        where: { projectId, canvasId, nodeId },
        select: { revision: true },
      })
      conflict(expectedRevision, actual?.revision ?? 0)
    }
    throw error
  }

  return NextResponse.json({
    studioDocument: {
      projectId,
      canvasId,
      nodeId,
      revision: saved.revision,
      document: normalizeStudioDocumentSeed(saved.document),
      updatedAt: saved.updatedAt.toISOString(),
      persisted: true,
      source: 'document',
    },
  })
})
