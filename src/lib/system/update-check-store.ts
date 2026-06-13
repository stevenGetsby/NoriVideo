import fs from 'node:fs/promises'
import path from 'node:path'
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

function safeSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_')
}

function storePath(userId: string) {
  return path.join(STORE_DIR, `${safeSegment(userId)}.json`)
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
    id: record.id,
    checkedAt: record.checkedAt,
    version: record.version,
    bootId: record.bootId,
    status: 'current',
    modules: {
      workflow: 'synced',
      modelRuntime: 'tracked',
      templates: 'tracked',
      storage: 'tracked',
      diagnostics: 'synced',
    },
  }
}

function normalizeRecords(value: unknown): UpdateCheckRecord[] {
  if (!Array.isArray(value)) return []
  return value
    .map(normalizeRecord)
    .filter((record): record is UpdateCheckRecord => Boolean(record))
}

export async function readUpdateCheckRecords(userId: string) {
  try {
    const raw = await fs.readFile(storePath(userId), 'utf8')
    const parsed = JSON.parse(raw) as Partial<StoreShape>
    return normalizeRecords(parsed.records)
  } catch {
    return []
  }
}

export async function appendUpdateCheckRecord(userId: string, status: SystemStatusSnapshot) {
  const filePath = storePath(userId)
  const current = await readUpdateCheckRecords(userId)
  const record: UpdateCheckRecord = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    checkedAt: status.checkedAt,
    version: status.version,
    bootId: status.bootId,
    status: 'current',
    modules: {
      workflow: 'synced',
      modelRuntime: 'tracked',
      templates: 'tracked',
      storage: 'tracked',
      diagnostics: 'synced',
    },
  }
  const records = [record, ...current].slice(0, 20)
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, `${JSON.stringify({ updatedAt: new Date().toISOString(), records }, null, 2)}\n`, 'utf8')
  return records
}
