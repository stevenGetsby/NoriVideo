import fs from 'node:fs/promises'
import path from 'node:path'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { ApiError } from '@/lib/api-errors'
import { getSignedUrl } from '@/lib/storage'

export type ExportHistoryRecord = {
  id: string
  cardId: string
  title: string
  fileName: string
  createdAt: string
  status: 'completed'
  source?: 'persistent' | 'server'
  taskId?: string | null
  outputStorageKey?: string | null
  outputUrl?: string | null
  contentType?: string | null
  stats?: {
    clips: number
    panels: number
    images: number
    videos: number
    voices?: number
  }
}

interface StoreShape {
  updatedAt: string
  records: ExportHistoryRecord[]
}

const STORE_DIR = path.join(process.cwd(), '.runtime', 'export-history')
const PROJECT_SCOPE_ID = 'project'
const MAX_RECORDS = 40
const ARTIFACT_URL_TTL_SECONDS = 7 * 24 * 60 * 60

function safeSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_')
}

function resolveScopeId(params: { episodeId?: string | null }) {
  return params.episodeId || PROJECT_SCOPE_ID
}

function storePath(params: { userId: string; projectId: string; episodeId?: string | null }) {
  return path.join(
    STORE_DIR,
    safeSegment(params.userId),
    safeSegment(params.projectId),
    `${safeSegment(resolveScopeId(params))}.json`,
  )
}

function toDate(value: string | null | undefined) {
  if (!value) return new Date()
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? new Date() : date
}

function normalizeStats(value: unknown): ExportHistoryRecord['stats'] | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const raw = value as Record<string, unknown>
  const clips = Number(raw.clips)
  const panels = Number(raw.panels)
  const images = Number(raw.images)
  const videos = Number(raw.videos)
  const voices = Number(raw.voices ?? 0)
  if (![clips, panels, images, videos].every(Number.isFinite)) return undefined
  return {
    clips: Math.max(0, Math.floor(clips)),
    panels: Math.max(0, Math.floor(panels)),
    images: Math.max(0, Math.floor(images)),
    videos: Math.max(0, Math.floor(videos)),
    voices: Number.isFinite(voices) ? Math.max(0, Math.floor(voices)) : 0,
  }
}

function normalizeRecord(value: unknown): ExportHistoryRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Partial<ExportHistoryRecord>
  if (
    typeof record.id !== 'string'
    || !record.id.trim()
    || typeof record.cardId !== 'string'
    || !record.cardId.trim()
    || typeof record.title !== 'string'
    || typeof record.fileName !== 'string'
    || typeof record.createdAt !== 'string'
  ) {
    return null
  }
  return {
    id: record.id.slice(0, 191),
    cardId: record.cardId.slice(0, 64),
    title: record.title.slice(0, 191),
    fileName: record.fileName,
    createdAt: toDate(record.createdAt).toISOString(),
    status: 'completed',
    source: record.source === 'server' ? 'server' : 'persistent',
    taskId: typeof record.taskId === 'string' ? record.taskId : null,
    outputStorageKey: typeof record.outputStorageKey === 'string' ? record.outputStorageKey : null,
    outputUrl: typeof record.outputUrl === 'string' ? record.outputUrl : null,
    contentType: typeof record.contentType === 'string' ? record.contentType : null,
    ...(record.stats ? { stats: normalizeStats(record.stats) } : {}),
  }
}

function normalizeRecords(value: unknown): ExportHistoryRecord[] {
  if (!Array.isArray(value)) return []
  return value
    .map(normalizeRecord)
    .filter((record): record is ExportHistoryRecord => Boolean(record))
}

async function readExportHistoryFile(params: {
  userId: string
  projectId: string
  episodeId?: string | null
}) {
  try {
    const raw = await fs.readFile(storePath(params), 'utf8')
    const parsed = JSON.parse(raw) as Partial<StoreShape>
    return normalizeRecords(parsed.records)
  } catch {
    return []
  }
}

async function removeExportHistoryFile(params: {
  userId: string
  projectId: string
  episodeId?: string | null
}) {
  await fs.rm(storePath(params), { force: true }).catch(() => undefined)
}

function toApiRecord(row: {
  id: string
  cardId: string
  title: string
  fileName: string
  createdAt: Date
  status: string
  source: string
  stats: Prisma.JsonValue | null
  taskId: string | null
  outputStorageKey: string | null
  outputUrl: string | null
  contentType: string | null
}): ExportHistoryRecord {
  return {
    id: row.id,
    cardId: row.cardId,
    title: row.title,
    fileName: row.fileName,
    createdAt: row.createdAt.toISOString(),
    status: 'completed',
    source: row.source === 'server' ? 'server' : 'persistent',
    taskId: row.taskId,
    outputStorageKey: row.outputStorageKey,
    outputUrl: row.outputStorageKey ? getSignedUrl(row.outputStorageKey, ARTIFACT_URL_TTL_SECONDS) : row.outputUrl,
    contentType: row.contentType,
    ...(row.stats ? { stats: normalizeStats(row.stats) } : {}),
  }
}

async function migrateFileHistoryIfNeeded(params: {
  userId: string
  projectId: string
  episodeId?: string | null
  scopeId: string
}) {
  const fileRecords = await readExportHistoryFile(params)
  if (fileRecords.length === 0) return

  await prisma.exportHistoryRecord.createMany({
    data: fileRecords.map((record) => ({
      id: record.id,
      userId: params.userId,
      projectId: params.projectId,
      scopeId: params.scopeId,
      episodeId: params.episodeId || null,
      cardId: record.cardId,
      title: record.title,
      fileName: record.fileName,
      status: 'completed',
      source: 'persistent',
      stats: record.stats ? (record.stats as Prisma.InputJsonValue) : undefined,
      taskId: record.taskId || null,
      outputStorageKey: record.outputStorageKey || null,
      outputUrl: record.outputUrl || null,
      contentType: record.contentType || null,
      createdAt: toDate(record.createdAt),
      updatedAt: new Date(),
    })),
    skipDuplicates: true,
  })
  await removeExportHistoryFile(params)
}

export async function readExportHistory(params: {
  userId: string
  projectId: string
  episodeId?: string | null
}) {
  const scopeId = resolveScopeId(params)

  let rows = await prisma.exportHistoryRecord.findMany({
    where: {
      userId: params.userId,
      projectId: params.projectId,
      scopeId,
    },
    orderBy: { createdAt: 'desc' },
    take: MAX_RECORDS,
  })

  if (rows.length === 0) {
    await migrateFileHistoryIfNeeded({ ...params, scopeId })
    rows = await prisma.exportHistoryRecord.findMany({
      where: {
        userId: params.userId,
        projectId: params.projectId,
        scopeId,
      },
      orderBy: { createdAt: 'desc' },
      take: MAX_RECORDS,
    })
  }

  return rows.map(toApiRecord)
}

export async function appendExportHistoryRecord(params: {
  userId: string
  projectId: string
  episodeId?: string | null
  record: ExportHistoryRecord
}) {
  const scopeId = resolveScopeId(params)
  const record = normalizeRecord(params.record)
  if (!record) return readExportHistory(params)

  await migrateFileHistoryIfNeeded({ ...params, scopeId })
  const existing = await prisma.exportHistoryRecord.findUnique({
    where: { id: record.id },
    select: {
      userId: true,
      projectId: true,
      scopeId: true,
    },
  })
  if (
    existing
    && (
      existing.userId !== params.userId
      || existing.projectId !== params.projectId
      || existing.scopeId !== scopeId
    )
  ) {
    throw new ApiError('CONFLICT', {
      code: 'EXPORT_HISTORY_ID_CONFLICT',
      field: 'id',
    })
  }

  await prisma.exportHistoryRecord.upsert({
    where: { id: record.id },
    create: {
      id: record.id,
      userId: params.userId,
      projectId: params.projectId,
      scopeId,
      episodeId: params.episodeId || null,
      cardId: record.cardId,
      title: record.title,
      fileName: record.fileName,
      status: 'completed',
      source: 'persistent',
      stats: record.stats ? (record.stats as Prisma.InputJsonValue) : undefined,
      taskId: record.taskId || null,
      outputStorageKey: record.outputStorageKey || null,
      outputUrl: record.outputUrl || null,
      contentType: record.contentType || null,
      createdAt: toDate(record.createdAt),
    },
    update: {
      cardId: record.cardId,
      title: record.title,
      fileName: record.fileName,
      status: 'completed',
      source: 'persistent',
      stats: record.stats ? (record.stats as Prisma.InputJsonValue) : Prisma.JsonNull,
      taskId: record.taskId || null,
      outputStorageKey: record.outputStorageKey || null,
      outputUrl: record.outputUrl || null,
      contentType: record.contentType || null,
      createdAt: toDate(record.createdAt),
    },
  })
  return readExportHistory(params)
}
