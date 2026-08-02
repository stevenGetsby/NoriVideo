import path from 'node:path'
import { NextRequest, NextResponse } from 'next/server'
import sharp from 'sharp'
import { ApiError } from '@/lib/api-errors'
import { prisma } from '@/lib/prisma'
import { generateUniqueKey, uploadObject } from '@/lib/storage'
import { registerFrameosMaterial, type FrameosMaterialType } from './material-service'
import { probeMediaDurationSeconds } from '@/lib/media/duration-probe'
import { assertSelfContainedGlbV2 } from '@/lib/model3d/glb-validation'
import type { AuthSession } from '@/lib/api-auth'
import { projectReadWhere } from '@/lib/collaboration/access'
import { normalizeFrameosAssetCategory } from './material-category'

const MAX_FILE_BYTES = 200 * 1024 * 1024
// Multipart boundaries and field names add a small amount around the actual
// file. The authoritative file cap is still checked again using File.size.
const MAX_REQUEST_BYTES = MAX_FILE_BYTES + 256 * 1024
const MAX_CONCURRENT_UPLOADS = 2
const MAX_IMAGE_PIXELS = 40_000_000

let activeMaterialUploads = 0

type MaterialUploadSession = AuthSession

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
}

function typeFromFile(file: File): FrameosMaterialType | null {
  if (file.type.startsWith('image/')) return 'image'
  if (file.type.startsWith('video/')) return 'video'
  if (file.type.startsWith('audio/')) return 'audio'
  if (file.type === 'model/gltf-binary' || /\.glb$/i.test(file.name)) return 'model3d'
  return null
}

function extensionForFile(file: File, type: FrameosMaterialType): string {
  if (type === 'model3d') return 'glb'
  const ext = path.extname(file.name).replace(/^\./, '').toLowerCase()
  if (/^[a-z0-9]{2,8}$/.test(ext)) return ext
  if (type === 'image') return 'jpg'
  if (type === 'video') return 'mp4'
  return 'mp3'
}

async function assertProjectAccess(session: MaterialUploadSession, projectId: string) {
  if (projectId === 'global' || projectId === 'global-asset-hub') return
  const project = await prisma.project.findFirst({
    where: projectReadWhere(session, projectId),
    select: { id: true },
  })
  if (!project) throw new ApiError('NOT_FOUND')
}

function assertUploadContentLength(request: NextRequest) {
  const rawContentLength = request.headers.get('content-length')?.trim()
  if (!rawContentLength || !/^\d+$/.test(rawContentLength)) return
  const contentLength = Number(rawContentLength)
  if (!Number.isSafeInteger(contentLength) || contentLength > MAX_REQUEST_BYTES) {
    throw new ApiError('INVALID_PARAMS', { message: '素材文件大小必须在 200MB 以内。' })
  }
}

async function withMaterialUploadPermit<T>(task: () => Promise<T>): Promise<T> {
  if (activeMaterialUploads >= MAX_CONCURRENT_UPLOADS) {
    throw new ApiError('RATE_LIMIT', {
      message: '当前素材上传任务较多，为避免内存过载，请稍后重试。',
    })
  }
  activeMaterialUploads += 1
  try {
    return await task()
  } finally {
    activeMaterialUploads = Math.max(0, activeMaterialUploads - 1)
  }
}

async function processFrameosMaterialUpload(
  request: NextRequest,
  session: MaterialUploadSession,
  options: { expectedProjectId?: string; projectAccessVerified?: boolean } = {},
) {
  const form = await request.formData()
  const fileValue = form.get('file')
  const file = fileValue instanceof File ? fileValue : null
  const title = cleanText(form.get('title'))
  const assetCategory = normalizeFrameosAssetCategory(form.get('assetCategory'))
  const requestedProjectId = cleanText(form.get('projectId'))
  if (options.expectedProjectId && requestedProjectId && requestedProjectId !== options.expectedProjectId) {
    throw new ApiError('INVALID_PARAMS', { message: '上传素材的项目与当前画布不一致。' })
  }
  const projectId = options.expectedProjectId || requestedProjectId || 'global'

  if (!file || !title) {
    throw new ApiError('INVALID_PARAMS', { message: '请选择文件并填写素材名称。' })
  }
  if (file.size <= 0 || file.size > MAX_FILE_BYTES) {
    throw new ApiError('INVALID_PARAMS', { message: '素材文件大小必须在 200MB 以内。' })
  }
  if (/\.gltf$/i.test(file.name) || (file.type === 'model/gltf+json' && !/\.glb$/i.test(file.name))) {
    throw new ApiError('INVALID_PARAMS', {
      message: '暂不支持 .gltf 多文件模型；它可能依赖外部 .bin 或贴图。请导出并上传自包含的 GLB 2.0 文件。',
    })
  }
  const type = typeFromFile(file)
  if (!type) {
    throw new ApiError('INVALID_PARAMS', { message: '仅支持图片、视频、音频或自包含的 GLB 2.0 模型。' })
  }
  if (!options.projectAccessVerified) await assertProjectAccess(session, projectId)

  const original = Buffer.from(await file.arrayBuffer())
  let body: Buffer<ArrayBufferLike> = original
  let contentType = file.type || undefined
  let width: number | null = null
  let height: number | null = null
  let extension = extensionForFile(file, type)
  const durationSeconds = type === 'audio' || type === 'video'
    ? await probeMediaDurationSeconds(original)
    : null
  if (type === 'model3d') {
    try {
      assertSelfContainedGlbV2(original)
    } catch (error) {
      const reason = error instanceof Error ? error.message : '文件结构无效'
      throw new ApiError('INVALID_PARAMS', {
        message: `无法上传该 3D 模型：${reason}。请使用自包含的 GLB 2.0 文件。`,
      })
    }
    extension = 'glb'
    contentType = 'model/gltf-binary'
  }
  if (type === 'image') {
    const image = sharp(original, {
      limitInputPixels: MAX_IMAGE_PIXELS,
      sequentialRead: true,
    })
    const metadata = await image.metadata().catch(() => null)
    if (!metadata?.width || !metadata.height) {
      throw new ApiError('INVALID_PARAMS', { message: '无法读取这张图片，请更换文件。' })
    }
    width = metadata.width
    height = metadata.height
    body = await image.rotate().jpeg({ quality: 92, mozjpeg: true }).toBuffer()
    extension = 'jpg'
    contentType = 'image/jpeg'
  }

  const storageKey = generateUniqueKey(`frameos-material-${session.user.id}`, extension)
  await uploadObject(body, storageKey, undefined, contentType)
  const material = await registerFrameosMaterial({
    userId: session.user.id,
    projectId,
    ownerName: session.user.name,
    title,
    type,
    source: 'upload',
    storageKey,
    metadata: {
      assetCategory,
      originalName: file.name,
      mimeType: contentType || file.type,
      sizeBytes: body.length,
      ...(width ? { width } : {}),
      ...(height ? { height } : {}),
      ...(durationSeconds !== null ? { durationSeconds } : {}),
    },
  })

  return NextResponse.json({
    success: true,
    material: {
      ...material,
      url: material.resultUrl || material.storageKey,
      projectName: projectId === 'global' ? '账号素材' : '项目素材',
    },
  })
}

export async function uploadFrameosMaterial(
  request: NextRequest,
  session: MaterialUploadSession,
  options: { expectedProjectId?: string; projectAccessVerified?: boolean } = {},
) {
  // Reject clearly oversized HTTP bodies before request.formData() buffers the
  // multipart payload. A bounded permit then covers parsing, Sharp and upload.
  assertUploadContentLength(request)
  return await withMaterialUploadPermit(async () => {
    return await processFrameosMaterialUpload(request, session, options)
  })
}
