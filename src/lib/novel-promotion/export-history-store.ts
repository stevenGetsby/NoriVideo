import fs from 'node:fs/promises'
import path from 'node:path'

export type ExportHistoryRecord = {
  id: string
  cardId: string
  title: string
  fileName: string
  createdAt: string
  status: 'completed'
  source?: 'persistent'
  stats?: {
    clips: number
    panels: number
    images: number
    videos: number
  }
}

interface StoreShape {
  updatedAt: string
  records: ExportHistoryRecord[]
}

const STORE_DIR = path.join(process.cwd(), '.runtime', 'export-history')

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

function normalizeRecord(value: unknown): ExportHistoryRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Partial<ExportHistoryRecord>
  if (
    typeof record.id !== 'string'
    || typeof record.cardId !== 'string'
    || typeof record.title !== 'string'
    || typeof record.fileName !== 'string'
    || typeof record.createdAt !== 'string'
  ) {
    return null
  }
  return {
    id: record.id,
    cardId: record.cardId,
    title: record.title,
    fileName: record.fileName,
    createdAt: record.createdAt,
    status: 'completed',
    source: 'persistent',
    ...(record.stats ? { stats: record.stats } : {}),
  }
}

function normalizeRecords(value: unknown): ExportHistoryRecord[] {
  if (!Array.isArray(value)) return []
  return value
    .map(normalizeRecord)
    .filter((record): record is ExportHistoryRecord => Boolean(record))
}

export async function readExportHistory(params: {
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

export async function appendExportHistoryRecord(params: {
  userId: string
  projectId: string
  episodeId?: string | null
  record: ExportHistoryRecord
}) {
  const filePath = storePath(params)
  const current = await readExportHistory(params)
  const next = [
    { ...params.record, source: 'persistent' as const },
    ...current.filter((record) => record.id !== params.record.id),
  ].slice(0, 40)
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, `${JSON.stringify({ updatedAt: new Date().toISOString(), records: next }, null, 2)}\n`, 'utf8')
  return next
}
