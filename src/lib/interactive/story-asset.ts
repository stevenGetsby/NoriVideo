import sharp, { type Metadata } from 'sharp'
import { ApiError } from '@/lib/api-errors'
import { generateUniqueKey, uploadObject } from '@/lib/storage'
import { STORY_ASSET_FIT_PX, STORY_ASSET_MAX_DIMENSION, isStoryAssetFileCandidate } from './story-asset-contract'

const ACCEPTED_SHARP_FORMATS = new Set(['png', 'jpeg', 'webp', 'gif'])

export interface PreparedStoryAssetImage {
  body: Buffer
  extension: 'webp' | 'gif'
  mimeType: 'image/webp' | 'image/gif'
}

function invalidAsset(message: string): ApiError {
  return new ApiError('INVALID_PARAMS', { code: 'STORY_ASSET_IMAGE_INVALID', field: 'file', message })
}

/** Checks an uploaded button / option / prop picture by its real bytes and shrinks it to something a phone can show. */
export async function prepareStoryAssetImage(file: File): Promise<PreparedStoryAssetImage> {
  if (!isStoryAssetFileCandidate(file)) throw invalidAsset('图片仅支持 PNG、JPG、WebP 或 GIF，且不超过 8MB。')

  const source = Buffer.from(await file.arrayBuffer())
  if (!source.length) throw invalidAsset('图片为空，请重新选择。')

  let metadata: Metadata
  try {
    metadata = await sharp(source).metadata()
  } catch {
    throw invalidAsset('无法读取这张图片，请更换文件后重试。')
  }
  if (!metadata.format || !ACCEPTED_SHARP_FORMATS.has(metadata.format) || !metadata.width || !metadata.height) {
    throw invalidAsset('图片仅支持 PNG、JPG、WebP 或 GIF。')
  }
  if (metadata.width > STORY_ASSET_MAX_DIMENSION || metadata.height > STORY_ASSET_MAX_DIMENSION) {
    throw invalidAsset('图片尺寸过大，请上传长边不超过 12000px 的图片。')
  }

  // Re-encoding would flatten an animation, so a GIF or an animated WebP keeps its bytes.
  if (metadata.format === 'gif') return { body: source, extension: 'gif', mimeType: 'image/gif' }
  if (metadata.format === 'webp' && (metadata.pages ?? 1) > 1) return { body: source, extension: 'webp', mimeType: 'image/webp' }

  try {
    const body = await sharp(source, { failOn: 'error' })
      .rotate()
      .resize({ width: STORY_ASSET_FIT_PX, height: STORY_ASSET_FIT_PX, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 86 })
      .toBuffer()
    return { body, extension: 'webp', mimeType: 'image/webp' }
  } catch {
    throw invalidAsset('图片处理失败，请更换文件后重试。')
  }
}

export async function uploadStoryAssetObject(workId: string, prepared: PreparedStoryAssetImage): Promise<string> {
  const key = generateUniqueKey(`interactive-${workId}`, prepared.extension)
  await uploadObject(prepared.body, key, undefined, prepared.mimeType)
  return key
}
