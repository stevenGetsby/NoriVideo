import fs from 'node:fs/promises'
import path from 'node:path'
import { prisma } from '@/lib/prisma'

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
const MAX_RECORDS = 80

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

function toDate(value: string | null | undefined) {
  if (!value) return new Date()
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? new Date() : date
}

function makeCollisionSafeId(id: string) {
  return `${id}-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`.slice(0, 191)
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
  const createdAt = toDate(textValue(record.createdAt, new Date().toISOString())).toISOString()
  return {
    id: record.id.slice(0, 191),
    type: normalizeType(record.type),
    title: record.title.slice(0, 191),
    description: record.description,
    route: textValue(record.route),
    userAgent: textValue(record.userAgent),
    createdAt,
    updatedAt: toDate(textValue(record.updatedAt, createdAt)).toISOString(),
    status: normalizeStatus(record.status),
  }
}

function normalizeRecords(value: unknown): FeedbackRecord[] {
  if (!Array.isArray(value)) return []
  return value
    .map(normalizeRecord)
    .filter((record): record is FeedbackRecord => Boolean(record))
}

async function readFeedbackRecordsFile(userId: string) {
  try {
    const raw = await fs.readFile(storePath(userId), 'utf8')
    const parsed = JSON.parse(raw) as Partial<StoreShape>
    return normalizeRecords(parsed.records)
  } catch {
    return []
  }
}

async function removeFeedbackFile(userId: string) {
  await fs.rm(storePath(userId), { force: true }).catch(() => undefined)
}

function toApiRecord(row: {
  id: string
  type: string
  title: string
  description: string
  route: string | null
  userAgent: string | null
  status: string
  createdAt: Date
  updatedAt: Date
}): FeedbackRecord {
  return {
    id: row.id,
    type: normalizeType(row.type),
    title: row.title,
    description: row.description,
    route: row.route || '',
    userAgent: row.userAgent || '',
    status: normalizeStatus(row.status),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

async function migrateFeedbackFileIfNeeded(userId: string) {
  const fileRecords = await readFeedbackRecordsFile(userId)
  if (fileRecords.length === 0) return

  await prisma.workspaceFeedbackRecord.createMany({
    data: fileRecords.map((record) => ({
      id: record.id,
      userId,
      type: record.type,
      title: record.title,
      description: record.description,
      route: record.route || null,
      userAgent: record.userAgent || null,
      status: record.status,
      createdAt: toDate(record.createdAt),
      updatedAt: toDate(record.updatedAt),
    })),
    skipDuplicates: true,
  })
  await removeFeedbackFile(userId)
}

export async function readFeedbackRecords(userId: string) {
  let rows = await prisma.workspaceFeedbackRecord.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: MAX_RECORDS,
  })
  if (rows.length === 0) {
    await migrateFeedbackFileIfNeeded(userId)
    rows = await prisma.workspaceFeedbackRecord.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: MAX_RECORDS,
    })
  }
  return rows.map(toApiRecord)
}

export async function appendFeedbackRecord(userId: string, record: Omit<FeedbackRecord, 'updatedAt'>) {
  const normalized = normalizeRecord({
    ...record,
    updatedAt: record.createdAt,
  })
  if (!normalized) return readFeedbackRecords(userId)

  await migrateFeedbackFileIfNeeded(userId)
  const existing = await prisma.workspaceFeedbackRecord.findUnique({
    where: { id: normalized.id },
    select: { userId: true },
  })
  if (existing?.userId === userId) {
    await prisma.workspaceFeedbackRecord.update({
      where: { id: normalized.id },
      data: {
        type: normalized.type,
        title: normalized.title,
        description: normalized.description,
        route: normalized.route || null,
        userAgent: normalized.userAgent || null,
        status: normalized.status,
        updatedAt: toDate(normalized.updatedAt),
      },
    })
  } else {
    await prisma.workspaceFeedbackRecord.create({
      data: {
        id: existing ? makeCollisionSafeId(normalized.id) : normalized.id,
        userId,
        type: normalized.type,
        title: normalized.title,
        description: normalized.description,
        route: normalized.route || null,
        userAgent: normalized.userAgent || null,
        status: normalized.status,
        createdAt: toDate(normalized.createdAt),
        updatedAt: toDate(normalized.updatedAt),
      },
    })
  }
  return readFeedbackRecords(userId)
}

export async function updateFeedbackRecordStatus(userId: string, id: string, status: FeedbackStatus) {
  await migrateFeedbackFileIfNeeded(userId)
  await prisma.workspaceFeedbackRecord.updateMany({
    where: { userId, id },
    data: {
      status: normalizeStatus(status),
      updatedAt: new Date(),
    },
  })
  return readFeedbackRecords(userId)
}

export function isFeedbackStatus(value: unknown): value is FeedbackStatus {
  return FEEDBACK_STATUSES.has(value as FeedbackStatus)
}

export function isFeedbackType(value: unknown): value is FeedbackType {
  return FEEDBACK_TYPES.has(value as FeedbackType)
}
