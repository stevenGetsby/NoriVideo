import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { getSignedUrl, uploadObject } from '@/lib/storage'
import { safeFeedbackUserSegment } from '@/lib/workspace/feedback-store'

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024

const MIME_TO_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

function detectImageMimeFromMagic(buffer: Buffer): string | null {
  if (buffer.length < 12) return null
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47
    && buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a
  ) {
    return 'image/png'
  }
  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg'
  }
  // GIF: GIF87a / GIF89a
  if (
    buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38
    && (buffer[4] === 0x37 || buffer[4] === 0x39) && buffer[5] === 0x61
  ) {
    return 'image/gif'
  }
  // WebP: RIFF....WEBP
  if (
    buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46
    && buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50
  ) {
    return 'image/webp'
  }
  return null
}

export const POST = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult

  const formData = await request.formData().catch(() => null)
  if (!formData) {
    throw new ApiError('INVALID_PARAMS', { message: '请上传图片文件' })
  }
  const file = formData.get('file')
  if (!(file instanceof File)) {
    throw new ApiError('INVALID_PARAMS', { message: '缺少图片文件字段 file' })
  }
  if (file.size <= 0) {
    throw new ApiError('INVALID_PARAMS', { message: '图片文件为空' })
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new ApiError('INVALID_PARAMS', { message: '单张截图不能超过 10MB' })
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  const detectedMime = detectImageMimeFromMagic(buffer)
  const declaredMime = (file.type || '').trim().toLowerCase()
  const mimeType = detectedMime || (MIME_TO_EXT[declaredMime] ? declaredMime : null)
  if (!mimeType || !MIME_TO_EXT[mimeType]) {
    throw new ApiError('INVALID_PARAMS', { message: '仅支持 PNG、JPEG、WebP 或 GIF 截图' })
  }

  const ext = MIME_TO_EXT[mimeType]
  const userSeg = safeFeedbackUserSegment(authResult.session.user.id)
  const key = `feedback/${userSeg}/${Date.now()}-${randomUUID().slice(0, 8)}.${ext}`
  await uploadObject(buffer, key, 3, mimeType)

  const name = (file.name || `screenshot.${ext}`).trim().slice(0, 120)
  return NextResponse.json({
    success: true,
    attachment: {
      key,
      url: getSignedUrl(key, 3600),
      mimeType,
      name,
      size: buffer.length,
    },
  })
})
