import fs from 'node:fs/promises'
import path from 'node:path'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getSignedUrl } from '@/lib/storage'

export type FeedbackType = 'bug' | 'quality' | 'workflow' | 'idea'
export type FeedbackStatus = 'open' | 'triaged' | 'resolved'

export type FeedbackAttachmentInput = {
  key: string
  mimeType: string
  name?: string
  size?: number
  width?: number
  height?: number
}

export type FeedbackAttachment = FeedbackAttachmentInput & {
  url: string
}

export type FeedbackContext = {
  viewport?: string
  dpr?: number
  locale?: string
  appVersion?: string
  recentErrors?: string[]
}

export type FeedbackRecord = {
  id: string
  type: FeedbackType
  title: string
  description: string
  route: string
  userAgent: string
  attachments: FeedbackAttachment[]
  context?: FeedbackContext
  resolutionNote?: string
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
const ALLOWED_IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
const FEEDBACK_ATTACHMENT_KEY_RE = /^feedback\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9._-]+\.(png|jpe?g|webp|gif)$/i
const MAX_RECORDS = 80
export const MAX_FEEDBACK_ATTACHMENTS = 5

export function safeFeedbackUserSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_')
}

function storePath(userId: string) {
  return path.join(STORE_DIR, `${safeFeedbackUserSegment(userId)}.json`)
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

function toPositiveInt(value: unknown, max: number): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  const rounded = Math.round(value)
  if (rounded <= 0 || rounded > max) return undefined
  return rounded
}

export function normalizeFeedbackAttachments(
  value: unknown,
  ownerUserId?: string,
): FeedbackAttachmentInput[] {
  if (!Array.isArray(value)) return []
  const expectedPrefix = ownerUserId ? `feedback/${safeFeedbackUserSegment(ownerUserId)}/` : null
  const seen = new Set<string>()
  const result: FeedbackAttachmentInput[] = []
  for (const item of value) {
    if (result.length >= MAX_FEEDBACK_ATTACHMENTS) break
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const raw = item as Record<string, unknown>
    const key = typeof raw.key === 'string' ? raw.key.trim() : ''
    if (!key || key.length > 260 || !FEEDBACK_ATTACHMENT_KEY_RE.test(key)) continue
    if (expectedPrefix && !key.startsWith(expectedPrefix)) continue
    if (seen.has(key)) continue
    seen.add(key)
    const rawMime = typeof raw.mimeType === 'string' ? raw.mimeType.trim().toLowerCase() : 'image/png'
    const mimeType = ALLOWED_IMAGE_MIME_TYPES.has(rawMime) ? rawMime : 'image/png'
    const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, 120) : undefined
    const size = toPositiveInt(raw.size, 25 * 1024 * 1024)
    const width = toPositiveInt(raw.width, 16384)
    const height = toPositiveInt(raw.height, 16384)
    result.push({
      key,
      mimeType,
      ...(name ? { name } : {}),
      ...(size ? { size } : {}),
      ...(width ? { width } : {}),
      ...(height ? { height } : {}),
    })
  }
  return result
}

export function hydrateFeedbackAttachments(value: unknown): FeedbackAttachment[] {
  const normalized = normalizeFeedbackAttachments(value)
  return normalized.map((item) => ({
    ...item,
    url: getSignedUrl(item.key, 3600),
  }))
}

export function normalizeFeedbackContext(value: unknown): FeedbackContext | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const raw = value as Record<string, unknown>
  const viewport = typeof raw.viewport === 'string' ? raw.viewport.trim().slice(0, 32) : undefined
  const dpr = typeof raw.dpr === 'number' && Number.isFinite(raw.dpr) && raw.dpr > 0 && raw.dpr <= 10
    ? Math.round(raw.dpr * 100) / 100
    : undefined
  const locale = typeof raw.locale === 'string' ? raw.locale.trim().slice(0, 16) : undefined
  const appVersion = typeof raw.appVersion === 'string' ? raw.appVersion.trim().slice(0, 48) : undefined
  const recentErrors = Array.isArray(raw.recentErrors)
    ? raw.recentErrors
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => entry.trim().slice(0, 320))
      .filter(Boolean)
      .slice(0, 8)
    : undefined
  const context: FeedbackContext = {
    ...(viewport ? { viewport } : {}),
    ...(dpr ? { dpr } : {}),
    ...(locale ? { locale } : {}),
    ...(appVersion ? { appVersion } : {}),
    ...(recentErrors && recentErrors.length > 0 ? { recentErrors } : {}),
  }
  return Object.keys(context).length > 0 ? context : undefined
}

function normalizeRecord(value: unknown): (Omit<FeedbackRecord, 'attachments'> & { attachments: FeedbackAttachmentInput[] }) | null {
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
    attachments: normalizeFeedbackAttachments(record.attachments),
    context: normalizeFeedbackContext(record.context),
    resolutionNote: typeof record.resolutionNote === 'string' && record.resolutionNote.trim()
      ? record.resolutionNote.trim().slice(0, 2000)
      : undefined,
    createdAt,
    updatedAt: toDate(textValue(record.updatedAt, createdAt)).toISOString(),
    status: normalizeStatus(record.status),
  }
}

function normalizeRecords(value: unknown) {
  if (!Array.isArray(value)) return []
  return value
    .map(normalizeRecord)
    .filter((record): record is NonNullable<ReturnType<typeof normalizeRecord>> => Boolean(record))
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
  attachments: unknown
  context: unknown
  resolutionNote: string | null
  status: string
  createdAt: Date
  updatedAt: Date
}): FeedbackRecord {
  const context = normalizeFeedbackContext(row.context)
  return {
    id: row.id,
    type: normalizeType(row.type),
    title: row.title,
    description: row.description,
    route: row.route || '',
    userAgent: row.userAgent || '',
    attachments: hydrateFeedbackAttachments(row.attachments),
    ...(context ? { context } : {}),
    ...(row.resolutionNote ? { resolutionNote: row.resolutionNote } : {}),
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
      ...(record.attachments.length > 0 ? { attachments: record.attachments as Prisma.InputJsonValue } : {}),
      ...(record.context ? { context: record.context as Prisma.InputJsonValue } : {}),
      resolutionNote: record.resolutionNote || null,
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

export async function appendFeedbackRecord(
  userId: string,
  record: {
    id: string
    type: FeedbackType
    title: string
    description: string
    route: string
    userAgent: string
    attachments?: FeedbackAttachmentInput[]
    context?: FeedbackContext
    createdAt: string
    status: FeedbackStatus
  },
) {
  const normalized = normalizeRecord({
    ...record,
    attachments: normalizeFeedbackAttachments(record.attachments, userId),
    updatedAt: record.createdAt,
  })
  if (!normalized) return readFeedbackRecords(userId)

  await migrateFeedbackFileIfNeeded(userId)
  const existing = await prisma.workspaceFeedbackRecord.findUnique({
    where: { id: normalized.id },
    select: { userId: true },
  })
  const attachmentsJson = normalized.attachments.length > 0
    ? (normalized.attachments as Prisma.InputJsonValue)
    : undefined
  const contextJson = normalized.context
    ? (normalized.context as Prisma.InputJsonValue)
    : undefined

  if (existing?.userId === userId) {
    await prisma.workspaceFeedbackRecord.update({
      where: { id: normalized.id },
      data: {
        type: normalized.type,
        title: normalized.title,
        description: normalized.description,
        route: normalized.route || null,
        userAgent: normalized.userAgent || null,
        ...(attachmentsJson !== undefined ? { attachments: attachmentsJson } : {}),
        ...(contextJson !== undefined ? { context: contextJson } : {}),
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
        ...(attachmentsJson !== undefined ? { attachments: attachmentsJson } : {}),
        ...(contextJson !== undefined ? { context: contextJson } : {}),
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
