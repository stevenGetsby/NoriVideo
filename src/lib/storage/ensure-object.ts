import fs from 'node:fs/promises'
import path from 'node:path'
import { extractStorageKey, getObjectBuffer, uploadObject } from '@/lib/storage'

const UPLOAD_DIR = process.env.UPLOAD_DIR || './data/uploads'

function normalizeKey(key: string): string {
  return key.replace(/^\/+/, '').replace(/\.\.(\/|\\)/g, '')
}

function inferContentType(key: string): string | undefined {
  const lower = key.toLowerCase()
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.gif')) return 'image/gif'
  if (lower.endsWith('.mp4')) return 'video/mp4'
  if (lower.endsWith('.mp3')) return 'audio/mpeg'
  if (lower.endsWith('.wav')) return 'audio/wav'
  return undefined
}

async function readLocalUploadFallback(key: string): Promise<Buffer | null> {
  const normalizedKey = normalizeKey(key)
  const filePath = path.join(process.cwd(), UPLOAD_DIR, normalizedKey)
  try {
    return await fs.readFile(filePath)
  } catch {
    return null
  }
}

export async function ensureStorageObjectAvailable(input: string | null | undefined): Promise<string | null> {
  const key = extractStorageKey(input)
  if (!key) return null

  try {
    await getObjectBuffer(key)
    return key
  } catch {
    // Continue to local fallback below. This covers projects created before
    // STORAGE_TYPE was switched to TOS.
  }

  const localBuffer = await readLocalUploadFallback(key)
  if (!localBuffer) return null

  await uploadObject(localBuffer, key, 1, inferContentType(key))
  return key
}
