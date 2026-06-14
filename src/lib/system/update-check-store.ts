import fs from 'node:fs/promises'
import path from 'node:path'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import type { SystemStatusSnapshot } from '@/lib/system/status'

export type UpdateCheckRecord = {
  id: string
  checkedAt: string
  version: string
  bootId: string
  status: 'current'
  modules: {
    workflow: 'synced'
    modelRuntime: 'tracked'
    templates: 'tracked'
    storage: 'tracked'
    diagnostics: 'synced'
  }
}

interface StoreShape {
  updatedAt: string
  records: UpdateCheckRecord[]
}

const STORE_DIR = path.join(process.cwd(), '.runtime', 'update-checks')
const MAX_RECORDS = 20

const DEFAULT_MODULES: UpdateCheckRecord['modules'] = {
  workflow: 'synced',
  modelRuntime: 'tracked',
  templates: 'tracked',
  storage: 'tracked',
  diagnostics: 'synced',
}

function safeSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_')
}

function storePath(userId: string) {
  return path.join(STORE_DIR, `${safeSegment(userId)}.json`)
}

function toDate(value: string | null | undefined) {
  if (!value) return new Date()
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? new Date() : date
}

function normalizeModules(value: unknown): UpdateCheckRecord['modules'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return DEFAULT_MODULES
  const raw = value as Partial<UpdateCheckRecord['modules']>
  return {
    workflow: raw.workflow === 'synced' ? 'synced' : 'synced',
    modelRuntime: raw.modelRuntime === 'tracked' ? 'tracked' : 'tracked',
    templates: raw.templates === 'tracked' ? 'tracked' : 'tracked',
    storage: raw.storage === 'tracked' ? 'tracked' : 'tracked',
    diagnostics: raw.diagnostics === 'synced' ? 'synced' : 'synced',
  }
}

function normalizeRecord(value: unknown): UpdateCheckRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Partial<UpdateCheckRecord>
  if (
    typeof record.id !== 'string'
    || typeof record.checkedAt !== 'string'
    || typeof record.version !== 'string'
    || typeof record.bootId !== 'string'
  ) {
    return null
  }
  return {
    id: record.id.slice(0, 191),
    checkedAt: toDate(record.checkedAt).toISOString(),
    version: record.version.slice(0, 64),
    bootId: record.bootId.slice(0, 128),
    status: 'current',
    modules: normalizeModules(record.modules),
  }
}

function normalizeRecords(value: unknown): UpdateCheckRecord[] {
  if (!Array.isArray(value)) return []
  return value
    .map(normalizeRecord)
    .filter((record): record is UpdateCheckRecord => Boolean(record))
}

async function readUpdateCheckRecordsFile(userId: string) {
  try {
    const raw = await fs.readFile(storePath(userId), 'utf8')
    const parsed = JSON.parse(raw) as Partial<StoreShape>
    return normalizeRecords(parsed.records)
  } catch {
    return []
  }
}

async function removeUpdateCheckFile(userId: string) {
  await fs.rm(storePath(userId), { force: true }).catch(() => undefined)
}

function toApiRecord(row: {
  id: string
  checkedAt: Date
  version: string
  bootId: string
  status: string
  modules: Prisma.JsonValue | null
}): UpdateCheckRecord {
  return {
    id: row.id,
    checkedAt: row.checkedAt.toISOString(),
    version: row.version,
    bootId: row.bootId,
    status: 'current',
    modules: normalizeModules(row.modules),
  }
}

async function migrateUpdateCheckFileIfNeeded(userId: string) {
  const fileRecords = await readUpdateCheckRecordsFile(userId)
  if (fileRecords.length === 0) return

  await prisma.systemUpdateCheckRecord.createMany({
    data: fileRecords.map((record) => ({
      id: record.id,
      userId,
      checkedAt: toDate(record.checkedAt),
      version: record.version,
      bootId: record.bootId,
      status: 'current',
      modules: record.modules as Prisma.InputJsonValue,
    })),
    skipDuplicates: true,
  })
  await removeUpdateCheckFile(userId)
}

export async function readUpdateCheckRecords(userId: string) {
  let rows = await prisma.systemUpdateCheckRecord.findMany({
    where: { userId },
    orderBy: { checkedAt: 'desc' },
    take: MAX_RECORDS,
  })
  if (rows.length === 0) {
    await migrateUpdateCheckFileIfNeeded(userId)
    rows = await prisma.systemUpdateCheckRecord.findMany({
      where: { userId },
      orderBy: { checkedAt: 'desc' },
      take: MAX_RECORDS,
    })
  }
  return rows.map(toApiRecord)
}

export async function appendUpdateCheckRecord(userId: string, status: SystemStatusSnapshot) {
  const record: UpdateCheckRecord = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    checkedAt: toDate(status.checkedAt).toISOString(),
    version: status.version,
    bootId: status.bootId,
    status: 'current',
    modules: DEFAULT_MODULES,
  }

  await migrateUpdateCheckFileIfNeeded(userId)
  await prisma.systemUpdateCheckRecord.create({
    data: {
      id: record.id,
      userId,
      checkedAt: toDate(record.checkedAt),
      version: record.version,
      bootId: record.bootId,
      status: 'current',
      modules: record.modules as Prisma.InputJsonValue,
    },
  })
  return readUpdateCheckRecords(userId)
}
