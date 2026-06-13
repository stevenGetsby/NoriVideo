import fs from 'node:fs/promises'
import path from 'node:path'

export type FeedbackType = 'bug' | 'quality' | 'workflow' | 'idea'
export type FeedbackStatus = 'open' | 'triaged' | 'resolved'

export type FeedbackRecord = {
  id: string
  type: FeedbackType
  title: string
  description: string
  route: string
  userAgent: string
  createdAt: string
  updatedAt: string
  status: FeedbackStatus
}

interface StoreShape {
  updatedAt: string
  records: FeedbackRecord[]
}

const STORE_DIR = path.join(process.cwd(), '.runtime', 'feedback')
const FEEDBACK_TYPES = new Set<FeedbackType>(['bug', 'quality', 'workflow', 'idea'])
const FEEDBACK_STATUSES = new Set<FeedbackStatus>(['open', 'triaged', 'resolved'])

function safeSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_')
}

function storePath(userId: string) {
  return path.join(STORE_DIR, `${safeSegment(userId)}.json`)
}

function normalizeType(value: unknown): FeedbackType {
  return FEEDBACK_TYPES.has(value as FeedbackType) ? value as FeedbackType : 'bug'
}

function normalizeStatus(value: unknown): FeedbackStatus {
  return FEEDBACK_STATUSES.has(value as FeedbackStatus) ? value as FeedbackStatus : 'open'
}

function textValue(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback
}

function normalizeRecord(value: unknown): FeedbackRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Partial<FeedbackRecord>
  if (
    typeof record.id !== 'string'
    || typeof record.title !== 'string'
    || typeof record.description !== 'string'
  ) {
    return null
  }
  const createdAt = textValue(record.createdAt, new Date().toISOString())
  return {
    id: record.id,
    type: normalizeType(record.type),
    title: record.title,
    description: record.description,
    route: textValue(record.route),
    userAgent: textValue(record.userAgent),
    createdAt,
    updatedAt: textValue(record.updatedAt, createdAt),
    status: normalizeStatus(record.status),
  }
}

function normalizeRecords(value: unknown): FeedbackRecord[] {
  if (!Array.isArray(value)) return []
  return value
    .map(normalizeRecord)
    .filter((record): record is FeedbackRecord => Boolean(record))
}

export async function readFeedbackRecords(userId: string) {
  try {
    const raw = await fs.readFile(storePath(userId), 'utf8')
    const parsed = JSON.parse(raw) as Partial<StoreShape>
    return normalizeRecords(parsed.records)
  } catch {
    return []
  }
}

async function writeFeedbackRecords(userId: string, records: FeedbackRecord[]) {
  const filePath = storePath(userId)
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  const payload: StoreShape = {
    updatedAt: new Date().toISOString(),
    records: normalizeRecords(records).slice(0, 80),
  }
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  return payload.records
}

export async function appendFeedbackRecord(userId: string, record: Omit<FeedbackRecord, 'updatedAt'>) {
  const current = await readFeedbackRecords(userId)
  const nextRecord: FeedbackRecord = {
    ...record,
    updatedAt: record.createdAt,
  }
  return await writeFeedbackRecords(userId, [
    nextRecord,
    ...current.filter((item) => item.id !== nextRecord.id),
  ])
}

export async function updateFeedbackRecordStatus(userId: string, id: string, status: FeedbackStatus) {
  const current = await readFeedbackRecords(userId)
  const next = current.map((record) => (
    record.id === id
      ? { ...record, status, updatedAt: new Date().toISOString() }
      : record
  ))
  return await writeFeedbackRecords(userId, next)
}

export function isFeedbackStatus(value: unknown): value is FeedbackStatus {
  return FEEDBACK_STATUSES.has(value as FeedbackStatus)
}

export function isFeedbackType(value: unknown): value is FeedbackType {
  return FEEDBACK_TYPES.has(value as FeedbackType)
}
