import sharp, { type Metadata } from 'sharp'
import { ApiError } from '@/lib/api-errors'
import { createScopedLogger } from '@/lib/logging/core'
import { deleteObject, generateUniqueKey, uploadObject } from '@/lib/storage'
import {
  PROJECT_COVER_MAX_DIMENSION,
  isProjectCoverFileCandidate,
  isProjectCoverStorageKey,
} from './project-cover-contract'

const logger = createScopedLogger({ module: 'projects.cover' })
const ACCEPTED_SHARP_FORMATS = new Set(['jpeg', 'png', 'webp'])

export interface PreparedProjectCoverImage {
  body: Buffer
  extension: 'jpg'
  mimeType: 'image/jpeg'
}

function invalidCover(message: string): ApiError {
  return new ApiError('INVALID_PARAMS', {
    code: 'PROJECT_COVER_IMAGE_INVALID',
    field: 'file',
    message,
  })
}

export async function prepareProjectCoverImage(file: File): Promise<PreparedProjectCoverImage> {
  if (!isProjectCoverFileCandidate(file)) {
    throw invalidCover('封面仅支持 JPG、PNG 或 WebP 图片，且不超过 8MB。')
  }

  const source = Buffer.from(await file.arrayBuffer())
  if (!source.length) throw invalidCover('封面图片为空，请重新选择。')

  let metadata: Metadata
  try {
    metadata = await sharp(source).metadata()
  } catch {
    throw invalidCover('无法读取这张封面图片，请更换文件后重试。')
  }
  if (
    !metadata.format
    || !ACCEPTED_SHARP_FORMATS.has(metadata.format)
    || !metadata.width
    || !metadata.height
  ) {
    throw invalidCover('封面仅支持 JPG、PNG 或 WebP 图片。')
  }
  if (metadata.width > PROJECT_COVER_MAX_DIMENSION || metadata.height > PROJECT_COVER_MAX_DIMENSION) {
    throw invalidCover('封面图片尺寸过大，请上传长边不超过 12000px 的图片。')
  }

  try {
    const body = await sharp(source, { failOn: 'error' })
      .rotate()
      .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 86, mozjpeg: true })
      .toBuffer()
    return { body, extension: 'jpg', mimeType: 'image/jpeg' }
  } catch {
    throw invalidCover('封面图片处理失败，请更换文件后重试。')
  }
}

export async function uploadProjectCoverImage(
  projectId: string,
  prepared: PreparedProjectCoverImage,
): Promise<string> {
  const key = generateUniqueKey(`project-cover-${projectId}`, prepared.extension)
  await uploadObject(prepared.body, key, undefined, prepared.mimeType)
  return key
}

/** Composite after a successful DB switch; never fail the request for cleanup. */
export async function deleteProjectCoverObject(key: string | null | undefined): Promise<void> {
  if (!isProjectCoverStorageKey(key)) return
  try {
    await deleteObject(key)
  } catch (error) {
    logger.warn({
      message: '项目封面旧文件清理失败，已保留数据库状态',
      details: { key, error: String(error) },
    })
  }
}
