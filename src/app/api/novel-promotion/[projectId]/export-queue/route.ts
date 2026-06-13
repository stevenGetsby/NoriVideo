import { NextRequest } from 'next/server'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import {
  readExportQueue,
  upsertExportQueueRecord,
  type ExportQueueRecord,
} from '@/lib/novel-promotion/export-queue-store'

function normalizeStatus(value: unknown): ExportQueueRecord['status'] {
  if (value === 'ready' || value === 'blocked' || value === 'queued') return value
  return 'queued'
}

export const GET = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params
  const episodeId = request.nextUrl.searchParams.get('episodeId')
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const records = await readExportQueue({
    userId: authResult.session.user.id,
    projectId,
    episodeId,
  })

  return Response.json({
    projectId,
    episodeId: episodeId || null,
    records,
  })
})

export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params
  const episodeId = request.nextUrl.searchParams.get('episodeId')
  if (!episodeId) {
    throw new ApiError('INVALID_PARAMS', { message: 'episodeId is required' })
  }
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const body = await request.json().catch(() => ({})) as {
    cardId?: string
    title?: string
    status?: string
    blocker?: string | null
  }
  if (!body.cardId || !body.title) {
    throw new ApiError('INVALID_PARAMS')
  }

  const records = await upsertExportQueueRecord({
    userId: authResult.session.user.id,
    projectId,
    episodeId,
    record: {
      cardId: body.cardId,
      title: body.title,
      status: normalizeStatus(body.status),
      blocker: body.blocker || null,
    },
  })

  return Response.json({
    success: true,
    records,
  })
})
