import fs from 'node:fs/promises'
import path from 'node:path'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getSignedUrl } from '@/lib/storage'

export type ExportQueueRecord = {
  id: string
  cardId: string
  title: string
  status: 'queued' | 'ready' | 'blocked'
  blocker?: string | null
  createdAt: string
  updatedAt: string
  taskId?: string | null
  outputFileName?: string | null
  outputStorageKey?: string | null
  outputUrl?: string | null
  contentType?: string | null
  outputManifest?: unknown
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
  records: ExportQueueRecord[]
}

const STORE_DIR = path.join(process.cwd(), '.runtime', 'export-queue')
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

function normalizeStatus(value: unknown): ExportQueueRecord['status'] {
  if (value === 'ready' || value === 'blocked' || value === 'queued') return value
  return 'queued'
}

function normalizeStats(value: unknown): ExportQueueRecord['stats'] | undefined {
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

function normalizeRecord(value: unknown): ExportQueueRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Partial<ExportQueueRecord>
  if (
    typeof record.id !== 'string'
    || typeof record.cardId !== 'string'
    || !record.cardId.trim()
    || typeof record.title !== 'string'
    || typeof record.createdAt !== 'string'
  ) {
    return null
  }
  return {
    id: record.id.slice(0, 191),
    cardId: record.cardId.slice(0, 64),
    title: record.title.slice(0, 191),
    status: normalizeStatus(record.status),
    blocker: typeof record.blocker === 'string' ? record.blocker : null,
    createdAt: toDate(record.createdAt).toISOString(),
    updatedAt: toDate(record.updatedAt || record.createdAt).toISOString(),
    taskId: typeof record.taskId === 'string' ? record.taskId : null,
    outputFileName: typeof record.outputFileName === 'string' ? record.outputFileName : null,
    outputStorageKey: typeof record.outputStorageKey === 'string' ? record.outputStorageKey : null,
    outputUrl: typeof record.outputUrl === 'string' ? record.outputUrl : null,
    contentType: typeof record.contentType === 'string' ? record.contentType : null,
    outputManifest: record.outputManifest,
    ...(record.stats ? { stats: normalizeStats(record.stats) } : {}),
  }
}

function normalizeRecords(value: unknown): ExportQueueRecord[] {
  if (!Array.isArray(value)) return []
  return value
    .map(normalizeRecord)
    .filter((record): record is ExportQueueRecord => Boolean(record))
}

async function readExportQueueFile(params: {
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

async function removeExportQueueFile(params: {
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
  status: string
  blocker: string | null
  taskId: string | null
  outputFileName: string | null
  outputStorageKey: string | null
  outputUrl: string | null
  contentType: string | null
  outputManifest: Prisma.JsonValue | null
  stats: Prisma.JsonValue | null
  createdAt: Date
  updatedAt: Date
}): ExportQueueRecord {
  return {
    id: row.id,
    cardId: row.cardId,
    title: row.title,
    status: normalizeStatus(row.status),
    blocker: row.blocker,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    taskId: row.taskId,
    outputFileName: row.outputFileName,
    outputStorageKey: row.outputStorageKey,
    outputUrl: row.outputStorageKey ? getSignedUrl(row.outputStorageKey, ARTIFACT_URL_TTL_SECONDS) : row.outputUrl,
    contentType: row.contentType,
    outputManifest: row.outputManifest,
    ...(row.stats ? { stats: normalizeStats(row.stats) } : {}),
  }
}

async function migrateFileQueueIfNeeded(params: {
  userId: string
  projectId: string
  episodeId?: string | null
  scopeId: string
}) {
  const fileRecords = await readExportQueueFile(params)
  if (fileRecords.length === 0) return

  for (const record of fileRecords) {
    await prisma.exportQueueRecord.upsert({
      where: {
        userId_projectId_scopeId_cardId: {
          userId: params.userId,
          projectId: params.projectId,
          scopeId: params.scopeId,
          cardId: record.cardId,
        },
      },
      create: {
        id: record.id,
        userId: params.userId,
        projectId: params.projectId,
        scopeId: params.scopeId,
        episodeId: params.episodeId || null,
        cardId: record.cardId,
        title: record.title,
        status: record.status,
        blocker: record.blocker || null,
        taskId: record.taskId || null,
        outputFileName: record.outputFileName || null,
        outputStorageKey: record.outputStorageKey || null,
        outputUrl: record.outputUrl || null,
        contentType: record.contentType || null,
        outputManifest: record.outputManifest ? (record.outputManifest as Prisma.InputJsonValue) : undefined,
        stats: record.stats ? (record.stats as Prisma.InputJsonValue) : undefined,
        createdAt: toDate(record.createdAt),
        updatedAt: toDate(record.updatedAt),
      },
      update: {
        title: record.title,
        status: record.status,
        blocker: record.blocker || null,
        taskId: record.taskId || null,
        outputFileName: record.outputFileName || null,
        outputStorageKey: record.outputStorageKey || null,
        outputUrl: record.outputUrl || null,
        contentType: record.contentType || null,
        outputManifest: record.outputManifest ? (record.outputManifest as Prisma.InputJsonValue) : Prisma.JsonNull,
        stats: record.stats ? (record.stats as Prisma.InputJsonValue) : Prisma.JsonNull,
      },
    })
  }
  await removeExportQueueFile(params)
}

export async function readExportQueue(params: {
  userId: string
  projectId: string
  episodeId?: string | null
}) {
  const scopeId = resolveScopeId(params)

  let rows = await prisma.exportQueueRecord.findMany({
    where: {
      userId: params.userId,
      projectId: params.projectId,
      scopeId,
    },
    orderBy: { updatedAt: 'desc' },
    take: MAX_RECORDS,
  })

  if (rows.length === 0) {
    await migrateFileQueueIfNeeded({ ...params, scopeId })
    rows = await prisma.exportQueueRecord.findMany({
      where: {
        userId: params.userId,
        projectId: params.projectId,
        scopeId,
      },
      orderBy: { updatedAt: 'desc' },
      take: MAX_RECORDS,
    })
  }

  return rows.map(toApiRecord)
}

export async function upsertExportQueueRecord(params: {
  userId: string
  projectId: string
  episodeId?: string | null
  record: Omit<ExportQueueRecord, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }
}) {
  const scopeId = resolveScopeId(params)
  const now = new Date()

  await migrateFileQueueIfNeeded({ ...params, scopeId })
  await prisma.exportQueueRecord.upsert({
    where: {
      userId_projectId_scopeId_cardId: {
        userId: params.userId,
        projectId: params.projectId,
        scopeId,
        cardId: params.record.cardId,
      },
    },
    create: {
      id: params.record.id,
      userId: params.userId,
      projectId: params.projectId,
      scopeId,
      episodeId: params.episodeId || null,
      cardId: params.record.cardId,
      title: params.record.title,
      status: normalizeStatus(params.record.status),
      blocker: params.record.blocker || null,
      taskId: params.record.taskId || null,
      outputFileName: params.record.outputFileName || null,
      outputStorageKey: params.record.outputStorageKey || null,
      outputUrl: params.record.outputUrl || null,
      contentType: params.record.contentType || null,
      outputManifest: params.record.outputManifest ? (params.record.outputManifest as Prisma.InputJsonValue) : undefined,
      stats: params.record.stats ? (params.record.stats as Prisma.InputJsonValue) : undefined,
      createdAt: now,
    },
    update: {
      title: params.record.title,
      status: normalizeStatus(params.record.status),
      blocker: params.record.blocker || null,
      taskId: params.record.taskId || null,
      outputFileName: params.record.outputFileName || null,
      outputStorageKey: params.record.outputStorageKey || null,
      outputUrl: params.record.outputUrl || null,
      contentType: params.record.contentType || null,
      outputManifest: params.record.outputManifest ? (params.record.outputManifest as Prisma.InputJsonValue) : Prisma.JsonNull,
      stats: params.record.stats ? (params.record.stats as Prisma.InputJsonValue) : Prisma.JsonNull,
      finishedAt: null,
    },
  })
  return readExportQueue(params)
}

export async function updateExportQueueTask(params: {
  userId: string
  projectId: string
  episodeId?: string | null
  cardId: string
  taskId: string
}) {
  const scopeId = resolveScopeId(params)
  await prisma.exportQueueRecord.update({
    where: {
      userId_projectId_scopeId_cardId: {
        userId: params.userId,
        projectId: params.projectId,
        scopeId,
        cardId: params.cardId,
      },
    },
    data: {
      taskId: params.taskId,
      status: 'queued',
    },
  })
}

export async function completeExportQueueRecord(params: {
  userId: string
  projectId: string
  episodeId?: string | null
  cardId: string
  taskId: string
  outputFileName: string
  outputStorageKey: string
  outputUrl: string
  contentType: string
  outputManifest: Record<string, unknown>
  stats?: ExportQueueRecord['stats']
}) {
  const scopeId = resolveScopeId(params)
  await prisma.exportQueueRecord.update({
    where: {
      userId_projectId_scopeId_cardId: {
        userId: params.userId,
        projectId: params.projectId,
        scopeId,
        cardId: params.cardId,
      },
    },
    data: {
      status: 'ready',
      blocker: null,
      taskId: params.taskId,
      outputFileName: params.outputFileName,
      outputStorageKey: params.outputStorageKey,
      outputUrl: params.outputUrl,
      contentType: params.contentType,
      outputManifest: params.outputManifest as Prisma.InputJsonValue,
      stats: params.stats ? (params.stats as Prisma.InputJsonValue) : Prisma.JsonNull,
      finishedAt: new Date(),
    },
  })
}

export async function failExportQueueRecord(params: {
  userId: string
  projectId: string
  episodeId?: string | null
  cardId: string
  taskId?: string | null
  blocker: string
}) {
  const scopeId = resolveScopeId(params)
  await prisma.exportQueueRecord.update({
    where: {
      userId_projectId_scopeId_cardId: {
        userId: params.userId,
        projectId: params.projectId,
        scopeId,
        cardId: params.cardId,
      },
    },
    data: {
      status: 'blocked',
      blocker: params.blocker,
      taskId: params.taskId || undefined,
    },
  })
}
