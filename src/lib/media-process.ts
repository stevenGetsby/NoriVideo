import { downloadAndUploadVideo, generateUniqueKey, toFetchableUrl, uploadObject } from '@/lib/storage'

export interface ProcessMediaOptions {
  source: string | Buffer
  type: 'image' | 'video' | 'audio'
  keyPrefix: string
  targetId: string
  downloadHeaders?: Record<string, string>
}

const MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  m4a: 'audio/mp4',
}

function resolveContentType(ext: string): string {
  return MIME_BY_EXT[ext] || 'application/octet-stream'
}

function resolveDefaultExt(type: ProcessMediaOptions['type']): string {
  if (type === 'video') return 'mp4'
  if (type === 'audio') return 'mp3'
  return 'jpg'
}

function extFromMimeType(contentType: string | null | undefined): string | null {
  const normalized = (contentType || '').split(';')[0]?.trim().toLowerCase()
  if (!normalized) return null
  if (normalized === 'image/jpeg' || normalized === 'image/jpg') return 'jpg'
  if (normalized === 'image/png') return 'png'
  if (normalized === 'image/webp') return 'webp'
  if (normalized === 'image/gif') return 'gif'
  if (normalized === 'video/mp4') return 'mp4'
  if (normalized === 'video/webm') return 'webm'
  if (normalized === 'audio/mpeg') return 'mp3'
  if (normalized === 'audio/wav' || normalized === 'audio/x-wav') return 'wav'
  if (normalized === 'audio/ogg') return 'ogg'
  if (normalized === 'audio/mp4' || normalized === 'audio/m4a') return 'm4a'
  return null
}

function inferImageExtFromBuffer(buffer: Buffer): string | null {
  if (buffer.length >= 4 && buffer.subarray(0, 4).toString('hex') === '89504e47') return 'png'
  if (buffer.length >= 3 && buffer.subarray(0, 3).toString('hex') === 'ffd8ff') return 'jpg'
  if (
    buffer.length >= 12
    && buffer.subarray(0, 4).toString('ascii') === 'RIFF'
    && buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'webp'
  }
  if (buffer.length >= 6) {
    const magic = buffer.subarray(0, 6).toString('ascii')
    if (magic === 'GIF87a' || magic === 'GIF89a') return 'gif'
  }
  return null
}

function resolveExtFromBuffer(
  buffer: Buffer,
  type: ProcessMediaOptions['type'],
  declaredContentType?: string | null,
): string {
  if (type === 'image') {
    return inferImageExtFromBuffer(buffer) || extFromMimeType(declaredContentType) || resolveDefaultExt(type)
  }
  return extFromMimeType(declaredContentType) || resolveDefaultExt(type)
}

/**
 * 处理媒体结果：下载 -> 上传 COS，返回 COS key。
 */
export async function processMediaResult(options: ProcessMediaOptions): Promise<string> {
  const { source, type, keyPrefix, targetId, downloadHeaders } = options

  if (typeof source === 'string') {
    if (source.startsWith('data:')) {
      const base64Start = source.indexOf(';base64,')
      if (base64Start === -1) throw new Error('无法解析 data: URL')
      const declaredContentType = source.slice(5, base64Start)
      const base64Data = source.substring(base64Start + 8)
      const buffer = Buffer.from(base64Data, 'base64') as Buffer
      const ext = resolveExtFromBuffer(buffer, type, declaredContentType)
      const key = generateUniqueKey(`${keyPrefix}-${targetId}`, ext)
      const contentType = resolveContentType(ext)
      return await uploadObject(buffer, key, undefined, contentType)
    }

    if (type === 'video') {
      const ext = resolveDefaultExt(type)
      const key = generateUniqueKey(`${keyPrefix}-${targetId}`, ext)
      return await downloadAndUploadVideo(source, key, 3, downloadHeaders)
    }

    const response = await fetch(toFetchableUrl(source))
    if (!response.ok) {
      throw new Error(`Failed to download media: ${response.status} ${response.statusText}`)
    }
    const buffer = Buffer.from(await response.arrayBuffer()) as Buffer
    const ext = resolveExtFromBuffer(buffer, type, response.headers.get('content-type'))
    const key = generateUniqueKey(`${keyPrefix}-${targetId}`, ext)
    const contentType = resolveContentType(ext)
    return await uploadObject(buffer, key, undefined, contentType)
  }

  const ext = resolveExtFromBuffer(source, type)
  const key = generateUniqueKey(`${keyPrefix}-${targetId}`, ext)
  const contentType = resolveContentType(ext)
  return await uploadObject(source, key, undefined, contentType)
}
