import { NextRequest, NextResponse } from 'next/server'
import * as fs from 'fs/promises'
import * as path from 'path'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { getObjectBuffer, getSignedObjectUrl } from '@/lib/storage'

const DEFAULT_EXPIRES_SECONDS = 3600
const MAX_INLINE_IMAGE_BYTES = 40 * 1024 * 1024
const MAX_INLINE_AUDIO_BYTES = 60 * 1024 * 1024
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
  '.m4a': 'audio/mp4',
}

function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()
  return MIME_TYPES[ext] || 'application/octet-stream'
}

function isSupportedInlineImage(storageKey: string): boolean {
  return ['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(path.extname(storageKey).toLowerCase())
}

function isSupportedInlineAudio(storageKey: string): boolean {
  return ['.mp3', '.wav', '.ogg', '.m4a'].includes(path.extname(storageKey).toLowerCase())
}

function inlineImageResponse(buffer: Buffer, storageKey: string): NextResponse {
  if (buffer.length > MAX_INLINE_IMAGE_BYTES) {
    throw new ApiError('INVALID_PARAMS', { message: '图片超过全景预览支持的 40MB 上限。' })
  }
  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': getMimeType(storageKey),
      'Content-Length': buffer.length.toString(),
      'Content-Disposition': 'inline',
      'Cache-Control': 'private, max-age=300',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

function inlineAudioResponse(buffer: Buffer, storageKey: string, rangeHeader: string | null): NextResponse {
  if (buffer.length > MAX_INLINE_AUDIO_BYTES) {
    throw new ApiError('INVALID_PARAMS', { message: '音频超过在线预览支持的 60MB 上限。' })
  }
  const commonHeaders = {
    'Accept-Ranges': 'bytes',
    'Content-Type': getMimeType(storageKey),
    'Content-Disposition': 'inline',
    'Cache-Control': 'private, max-age=300',
    'X-Content-Type-Options': 'nosniff',
  }
  const match = rangeHeader?.match(/^bytes=(\d*)-(\d*)$/i)
  if (!match) {
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: { ...commonHeaders, 'Content-Length': String(buffer.length) },
    })
  }
  const requestedStart = match[1] ? Number.parseInt(match[1], 10) : 0
  const requestedEnd = match[2] ? Number.parseInt(match[2], 10) : buffer.length - 1
  const start = Math.max(0, Math.min(requestedStart, buffer.length - 1))
  const end = Math.max(start, Math.min(requestedEnd, buffer.length - 1))
  const chunk = buffer.subarray(start, end + 1)
  return new NextResponse(new Uint8Array(chunk), {
    status: 206,
    headers: {
      ...commonHeaders,
      'Content-Length': String(chunk.length),
      'Content-Range': `bytes ${start}-${end}/${buffer.length}`,
    },
  })
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
  const inline = searchParams.get('inline') === '1'

  if (!key) {
    throw new ApiError('INVALID_PARAMS')
  }

  const expires = expiresRaw ? Number.parseInt(expiresRaw, 10) : DEFAULT_EXPIRES_SECONDS
  const ttl = Number.isFinite(expires) && expires > 0 ? expires : DEFAULT_EXPIRES_SECONDS

  if (inline) {
    if (!isSupportedInlineImage(key) && !isSupportedInlineAudio(key)) {
      throw new ApiError('INVALID_PARAMS', { message: '同源预览仅支持图片和音频文件。' })
    }
    try {
      const buffer = await getObjectBuffer(key)
      return isSupportedInlineAudio(key)
        ? inlineAudioResponse(buffer, key, request.headers.get('range'))
        : inlineImageResponse(buffer, key)
    } catch (error) {
      if (error instanceof ApiError) throw error
      const localFile = await readLocalFile(key)
      if (localFile) {
        return isSupportedInlineAudio(key)
          ? inlineAudioResponse(localFile.buffer, key, request.headers.get('range'))
          : inlineImageResponse(localFile.buffer, key)
      }
      throw error
    }
  }

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
