import { NextRequest, NextResponse } from 'next/server'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import {
  findExportArtifactRecord,
  normalizeExportArtifactQuery,
  resolveExportArtifactDownloadUrl,
} from '@/lib/novel-promotion/export-artifact'

export const GET = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const query = normalizeExportArtifactQuery(request.nextUrl.searchParams)
  if (!query.id && !query.cardId && !query.taskId) {
    throw new ApiError('INVALID_PARAMS', {
      message: 'id, cardId or taskId is required',
    })
  }

  const record = await findExportArtifactRecord({
    userId: authResult.session.user.id,
    projectId,
    query,
  })
  const downloadUrl = record ? resolveExportArtifactDownloadUrl(record) : null
  if (!record || !downloadUrl) {
    throw new ApiError('NOT_FOUND')
  }

  if (request.nextUrl.searchParams.get('redirect') === '1') {
    return NextResponse.redirect(new URL(downloadUrl, request.url))
  }

  return NextResponse.json({
    projectId,
    episodeId: query.episodeId,
    source: record.source,
    id: record.id,
    cardId: record.cardId,
    taskId: record.taskId,
    status: record.status,
    fileName: record.fileName,
    contentType: record.contentType,
    outputStorageKey: record.outputStorageKey,
    downloadUrl,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  })
})
