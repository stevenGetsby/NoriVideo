import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { ApiError } from '@/lib/api-errors'
import { getObjectBuffer, uploadObject } from '@/lib/storage'

export const CANVAS_THUMBNAIL_WIDTHS = [480, 960, 1440] as const
export type CanvasThumbnailWidth = typeof CANVAS_THUMBNAIL_WIDTHS[number]

const MAX_SOURCE_BYTES = 40 * 1024 * 1024
const MAX_INPUT_PIXELS = 80_000_000
const inFlight = new Map<string, Promise<string>>()

export function normalizeCanvasThumbnailWidth(value: string | null): CanvasThumbnailWidth {
  const width = Number(value)
  if (!CANVAS_THUMBNAIL_WIDTHS.includes(width as CanvasThumbnailWidth)) {
    throw new ApiError('INVALID_PARAMS', { message: '缩略图宽度仅支持 480、960 或 1440。' })
  }
  return width as CanvasThumbnailWidth
}

export function canvasThumbnailKey(key: string, width: CanvasThumbnailWidth): string {
  const digest = createHash('sha256').update(key).digest('hex')
  return `images/thumbnails/${digest.slice(0, 2)}/${digest.slice(2)}/w${width}.webp`
}

async function createThumbnail(key: string, width: CanvasThumbnailWidth): Promise<string> {
  try {
    await getObjectBuffer(canvasThumbnailKey(key, width))
    return canvasThumbnailKey(key, width)
  } catch {
    // A missing derivative is expected; generate it below.
  }

  const source = await getObjectBuffer(key)
  if (source.length > MAX_SOURCE_BYTES) {
    throw new ApiError('INVALID_PARAMS', { message: '原图超过缩略图处理上限，请使用原图预览。' })
  }
  const metadata = await sharp(source, { limitInputPixels: MAX_INPUT_PIXELS }).metadata()
  if (!metadata.width || !metadata.height) throw new ApiError('INVALID_PARAMS', { message: '无法读取图片尺寸。' })
  if (metadata.width <= width) return key

  const body = await sharp(source, { limitInputPixels: MAX_INPUT_PIXELS, animated: false })
    .rotate()
    .resize({ width, withoutEnlargement: true })
    .webp({ quality: 82, effort: 4 })
    .toBuffer()
  if (body.length >= source.length) return key
  return await uploadObject(body, canvasThumbnailKey(key, width), 1, 'image/webp')
}

export function ensureCanvasThumbnail(key: string, width: CanvasThumbnailWidth): Promise<string> {
  const cacheKey = `${key}\0${width}`
  const existing = inFlight.get(cacheKey)
  if (existing) return existing
  const pending = createThumbnail(key, width).finally(() => inFlight.delete(cacheKey))
  inFlight.set(cacheKey, pending)
  return pending
}
