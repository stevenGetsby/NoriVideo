import { prisma } from '@/lib/prisma'
import { getSignedUrl } from '@/lib/storage'
import { resolveExportScope } from '@/lib/novel-promotion/export-scope'

const ARTIFACT_URL_TTL_SECONDS = 7 * 24 * 60 * 60

export type ExportArtifactSource = 'queue' | 'history'

export type ExportArtifactQuery = {
  source: ExportArtifactSource
  id: string | null
  cardId: string | null
  taskId: string | null
  episodeId: string | null
}

export type ExportArtifactRecord = {
  id: string
  source: ExportArtifactSource
  cardId: string
  taskId: string | null
  fileName: string | null
  contentType: string | null
  outputStorageKey: string | null
  outputUrl: string | null
  status: string
  createdAt: string
  updatedAt: string
}

function readTrimmed(value: string | null | undefined) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function normalizeSource(value: string | null | undefined): ExportArtifactSource {
  return value === 'history' ? 'history' : 'queue'
}

export function normalizeExportArtifactQuery(searchParams: URLSearchParams): ExportArtifactQuery {
  return {
    source: normalizeSource(searchParams.get('source')),
    id: readTrimmed(searchParams.get('id')),
    cardId: readTrimmed(searchParams.get('cardId')),
    taskId: readTrimmed(searchParams.get('taskId')),
    episodeId: readTrimmed(searchParams.get('episodeId')),
  }
}

export function resolveExportArtifactDownloadUrl(record: {
  outputStorageKey?: string | null
  outputUrl?: string | null
}) {
  if (record.outputStorageKey) {
    return getSignedUrl(record.outputStorageKey, ARTIFACT_URL_TTL_SECONDS)
  }
  return record.outputUrl || null
}

export async function findExportArtifactRecord(params: {
  userId: string
  projectId: string
  query: ExportArtifactQuery
}): Promise<ExportArtifactRecord | null> {
  const scope = await resolveExportScope({
    projectId: params.projectId,
    episodeId: params.query.episodeId,
  })
  if (!scope) return null
  const scopeId = scope.scopeId

  if (params.query.source === 'history') {
    const row = await prisma.exportHistoryRecord.findFirst({
      where: {
        userId: params.userId,
        projectId: params.projectId,
        scopeId,
        ...(params.query.id ? { id: params.query.id } : {}),
        ...(params.query.taskId ? { taskId: params.query.taskId } : {}),
        ...(params.query.cardId ? { cardId: params.query.cardId } : {}),
        OR: [
          { outputStorageKey: { not: null } },
          { outputUrl: { not: null } },
        ],
      },
      orderBy: { createdAt: 'desc' },
    })
    if (!row) return null
    return {
      id: row.id,
      source: 'history',
      cardId: row.cardId,
      taskId: row.taskId,
      fileName: row.fileName,
      contentType: row.contentType,
      outputStorageKey: row.outputStorageKey,
      outputUrl: row.outputUrl,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }
  }

  const row = await prisma.exportQueueRecord.findFirst({
    where: {
      userId: params.userId,
      projectId: params.projectId,
      scopeId,
      ...(params.query.id ? { id: params.query.id } : {}),
      ...(params.query.taskId ? { taskId: params.query.taskId } : {}),
      ...(params.query.cardId ? { cardId: params.query.cardId } : {}),
      OR: [
        { outputStorageKey: { not: null } },
        { outputUrl: { not: null } },
      ],
    },
    orderBy: { updatedAt: 'desc' },
  })
  if (!row) return null
  return {
    id: row.id,
    source: 'queue',
    cardId: row.cardId,
    taskId: row.taskId,
    fileName: row.outputFileName,
    contentType: row.contentType,
    outputStorageKey: row.outputStorageKey,
    outputUrl: row.outputUrl,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}
