import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { getSignedObjectUrl, uploadObject } from '@/lib/storage'

const MIN_EDGE = 300
const MAX_EDGE = 6000
const MAX_IMAGE_BYTES = 40 * 1024 * 1024
const MAX_INPUT_PIXELS = 64_000_000

function invalidImage(message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code: 'INVALID_PARAMS' })
}

async function readImage(response: Response): Promise<Buffer> {
  const declaredSize = Number(response.headers.get('content-length') || 0)
  if (declaredSize > MAX_IMAGE_BYTES) {
    await response.body?.cancel()
    throw invalidImage('参考图片超过预处理的 40MB 上限，请先压缩后再生成。')
  }
  if (!response.body) throw invalidImage('参考图片为空，请重新上传后再生成。')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_IMAGE_BYTES) {
        await reader.cancel()
        throw invalidImage('参考图片超过预处理的 40MB 上限，请先压缩后再生成。')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks, size)
}

/**
 * Final Kuaizi Seedance submission boundary. Keep original assets untouched:
 * resize only an out-of-range image and upload a separate content-addressed copy.
 * Asset URIs are already managed by the provider and must never be fetched.
 */
export async function prepareKuaiziSeedanceImage(url: string): Promise<string> {
  if (/^asset:\/\/\d+$/.test(url)) return url
  let response: Response
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(20_000) })
  } catch {
    throw Object.assign(new Error('参考图片读取超时或连接失败，请稍后重试。'), { code: 'NETWORK_ERROR' })
  }
  if (!response.ok) {
    await response.body?.cancel()
    throw invalidImage(`参考图片读取失败（HTTP ${response.status}），请重新选择或上传图片。`)
  }
  const bytes = await readImage(response)
  let metadata: sharp.Metadata
  try {
    metadata = await sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS }).metadata()
  } catch {
    throw invalidImage('参考图片无法解码或像素过大，请重新上传常规 JPG、PNG 或 WebP 图片。')
  }
  const rotated = (metadata.orientation || 1) >= 5
  const width = rotated ? metadata.height : metadata.width
  const height = rotated ? metadata.width : metadata.height
  if (!width || !height) throw invalidImage('参考图片没有有效尺寸，请重新上传后再生成。')
  if (width >= MIN_EDGE && height >= MIN_EDGE && width <= MAX_EDGE && height <= MAX_EDGE) return url
  const lowerScale = Math.max(MIN_EDGE / width, MIN_EDGE / height)
  const upperScale = Math.min(MAX_EDGE / width, MAX_EDGE / height)
  if (lowerScale > upperScale) {
    throw invalidImage('参考图片比例过于极端，无法等比调整到 300–6000px，请裁剪后重新上传。')
  }
  if ((metadata.pages || 1) > 1) {
    throw invalidImage('超出尺寸限制的动态图片无法直接调整，请先导出静态图片再生成。')
  }
  const scale = Math.min(Math.max(1, lowerScale), upperScale)
  const targetWidth = Math.max(MIN_EDGE, Math.min(MAX_EDGE, Math.round(width * scale)))
  const targetHeight = Math.max(MIN_EDGE, Math.min(MAX_EDGE, Math.round(height * scale)))
  // Contain preserves all pixels and aspect ratio, including EXIF orientation.
  // Integer rounding can add at most a one-pixel border; never crop or stretch.
  const image = sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS }).rotate().resize({
    width: targetWidth, height: targetHeight, fit: 'contain',
    background: metadata.hasAlpha ? { r: 0, g: 0, b: 0, alpha: 0 } : { r: 255, g: 255, b: 255, alpha: 1 },
  })
  const extension = metadata.hasAlpha ? 'png' : 'jpg'
  const { data, info } = await (metadata.hasAlpha ? image.png() : image.jpeg({ quality: 92 })).toBuffer({ resolveWithObject: true })
  if (info.width < MIN_EDGE || info.height < MIN_EDGE || info.width > MAX_EDGE || info.height > MAX_EDGE || data.length > MAX_IMAGE_BYTES) {
    throw invalidImage('参考图片调整后仍超过限制，请压缩或裁剪后重新上传。')
  }
  const digest = createHash('sha256').update(data).digest('hex')
  const key = `images/seedance-reference/${digest}.${extension}`
  await uploadObject(data, key, undefined, `image/${extension === 'jpg' ? 'jpeg' : 'png'}`)
  return await getSignedObjectUrl(key, 3600)
}
