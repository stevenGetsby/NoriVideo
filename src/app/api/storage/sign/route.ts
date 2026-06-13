import { NextRequest, NextResponse } from 'next/server'
import * as fs from 'fs/promises'
import * as path from 'path'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { getSignedObjectUrl } from '@/lib/storage'

const DEFAULT_EXPIRES_SECONDS = 3600
const UPLOAD_DIR = process.env.UPLOAD_DIR || './data/uploads'
const MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
}

function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()
  return MIME_TYPES[ext] || 'application/octet-stream'
}

function resolveLocalFilePath(storageKey: string): string | null {
  const normalizedKey = storageKey.replace(/^\/+/, '')
  const uploadDirPath = path.normalize(path.join(process.cwd(), UPLOAD_DIR))
  const filePath = path.normalize(path.join(uploadDirPath, normalizedKey))
  if (!filePath.startsWith(uploadDirPath + path.sep)) return null
  return filePath
}

async function readLocalFile(storageKey: string): Promise<{ buffer: Buffer; mimeType: string } | null> {
  const filePath = resolveLocalFilePath(storageKey)
  if (!filePath) return null
  try {
    const buffer = await fs.readFile(filePath)
    return { buffer, mimeType: getMimeType(filePath) }
  } catch {
    return null
  }
}

export const GET = apiHandler(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url)
  const key = searchParams.get('key')
  const expiresRaw = searchParams.get('expires')

  if (!key) {
    throw new ApiError('INVALID_PARAMS')
  }

  const expires = expiresRaw ? Number.parseInt(expiresRaw, 10) : DEFAULT_EXPIRES_SECONDS
  const ttl = Number.isFinite(expires) && expires > 0 ? expires : DEFAULT_EXPIRES_SECONDS

  try {
    const signedUrl = await getSignedObjectUrl(key, ttl)
    return NextResponse.redirect(signedUrl)
  } catch (error) {
    const localFile = await readLocalFile(key)
    if (localFile) {
      return new NextResponse(new Uint8Array(localFile.buffer), {
        status: 200,
        headers: {
          'Content-Type': localFile.mimeType,
          'Content-Length': localFile.buffer.length.toString(),
          'Cache-Control': 'public, max-age=31536000',
        },
      })
    }
    throw error
  }
})
