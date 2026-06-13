import fs from 'node:fs/promises'
import path from 'node:path'

export type ExportQueueRecord = {
  id: string
  cardId: string
  title: string
  status: 'queued' | 'ready' | 'blocked'
  blocker?: string | null
  createdAt: string
  updatedAt: string
}

interface StoreShape {
  updatedAt: string
  records: ExportQueueRecord[]
}

const STORE_DIR = path.join(process.cwd(), '.runtime', 'export-queue')

function safeSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_')
}

function storePath(params: { userId: string; projectId: string; episodeId?: string | null }) {
  return path.join(
    STORE_DIR,
    safeSegment(params.userId),
    safeSegment(params.projectId),
    `${safeSegment(params.episodeId || 'project')}.json`,
  )
}

function normalizeRecord(value: unknown): ExportQueueRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Partial<ExportQueueRecord>
  if (
    typeof record.id !== 'string'
    || typeof record.cardId !== 'string'
    || typeof record.title !== 'string'
    || typeof record.createdAt !== 'string'
  ) {
    return null
  }
  const status = record.status === 'ready' || record.status === 'blocked' ? record.status : 'queued'
  return {
    id: record.id,
    cardId: record.cardId,
    title: record.title,
    status,
    blocker: typeof record.blocker === 'string' ? record.blocker : null,
    createdAt: record.createdAt,
    updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : record.createdAt,
  }
}

function normalizeRecords(value: unknown): ExportQueueRecord[] {
  if (!Array.isArray(value)) return []
  return value
    .map(normalizeRecord)
    .filter((record): record is ExportQueueRecord => Boolean(record))
}

export async function readExportQueue(params: {
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

export async function upsertExportQueueRecord(params: {
  userId: string
  projectId: string
  episodeId?: string | null
  record: Omit<ExportQueueRecord, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }
}) {
  const filePath = storePath(params)
  const current = await readExportQueue(params)
  const now = new Date().toISOString()
  const existing = current.find((record) => record.cardId === params.record.cardId)
  const nextRecord: ExportQueueRecord = {
    id: params.record.id || existing?.id || `${Date.now()}-${params.record.cardId}`,
    cardId: params.record.cardId,
    title: params.record.title,
    status: params.record.status,
    blocker: params.record.blocker || null,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  }
  const next = [
    nextRecord,
    ...current.filter((record) => record.cardId !== params.record.cardId),
  ].slice(0, 40)
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, `${JSON.stringify({ updatedAt: now, records: next }, null, 2)}\n`, 'utf8')
  return next
}
