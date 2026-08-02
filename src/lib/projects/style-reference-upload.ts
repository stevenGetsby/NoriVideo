import { createHash } from 'node:crypto'
import sharp from 'sharp'
import type { Prisma } from '@prisma/client'
import { ApiError } from '@/lib/api-errors'
import { stablePublicIdFromStorageKey } from '@/lib/media/hash'
import { deleteObject, generateUniqueKey, uploadObject } from '@/lib/storage'
import {
  PROJECT_STYLE_REFERENCE_FIELD,
  PROJECT_STYLE_REFERENCE_MAX_COUNT,
  PROJECT_STYLE_REFERENCE_MAX_FILE_BYTES,
  PROJECT_STYLE_REFERENCE_MAX_VIDEO_SECONDS,
  projectStyleReferenceExtension,
  projectStyleReferenceKind,
  type ProjectStyleReferenceKind,
  type ProjectStyleReferenceValue,
} from './style-reference-contract'

export interface PreparedStyleReference {
  body: Buffer
  extension: string
  kind: ProjectStyleReferenceKind
  mimeType: string
  name: string
  sizeBytes: number
  width: number | null
  height: number | null
  durationMs: number | null
  sha256: string
  order: number
}

export interface UploadedStyleReference extends PreparedStyleReference {
  storageKey: string
  publicId: string
}

interface IsoAtom {
  type: string
  start: number
  dataStart: number
  end: number
}

function styleReferenceError(
  code: string,
  message: string,
  index?: number,
  fileName?: string,
): ApiError {
  return new ApiError('INVALID_PARAMS', {
    code,
    field: PROJECT_STYLE_REFERENCE_FIELD,
    ...(typeof index === 'number' ? { styleReferenceIndex: index } : {}),
    ...(fileName ? { styleReferenceFileName: fileName } : {}),
    message,
  })
}

function readIsoAtoms(buffer: Buffer, start: number, end: number): IsoAtom[] {
  const atoms: IsoAtom[] = []
  let offset = start
  while (offset + 8 <= end) {
    const size32 = buffer.readUInt32BE(offset)
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    let headerSize = 8
    let size = size32
    if (size32 === 1) {
      if (offset + 16 > end) break
      const extendedSize = buffer.readBigUInt64BE(offset + 8)
      if (extendedSize > BigInt(Number.MAX_SAFE_INTEGER)) break
      size = Number(extendedSize)
      headerSize = 16
    } else if (size32 === 0) {
      size = end - offset
    }
    if (size < headerSize || offset + size > end) break
    atoms.push({ type, start: offset, dataStart: offset + headerSize, end: offset + size })
    offset += size
  }
  return atoms
}

export function readIsoMediaDurationMs(buffer: Buffer): number | null {
  const topLevel = readIsoAtoms(buffer, 0, buffer.length)
  if (!topLevel.some((atom) => atom.type === 'ftyp')) return null
  const moov = topLevel.find((atom) => atom.type === 'moov')
  if (!moov) return null
  const mvhd = readIsoAtoms(buffer, moov.dataStart, moov.end).find((atom) => atom.type === 'mvhd')
  if (!mvhd || mvhd.dataStart + 20 > mvhd.end) return null

  const version = buffer.readUInt8(mvhd.dataStart)
  let timescale = 0
  let duration = 0
  if (version === 0) {
    if (mvhd.dataStart + 20 > mvhd.end) return null
    timescale = buffer.readUInt32BE(mvhd.dataStart + 12)
    duration = buffer.readUInt32BE(mvhd.dataStart + 16)
  } else if (version === 1) {
    if (mvhd.dataStart + 32 > mvhd.end) return null
    timescale = buffer.readUInt32BE(mvhd.dataStart + 20)
    const rawDuration = buffer.readBigUInt64BE(mvhd.dataStart + 24)
    if (rawDuration > BigInt(Number.MAX_SAFE_INTEGER)) return null
    duration = Number(rawDuration)
  } else {
    return null
  }
  if (!timescale || !duration) return null
  const durationMs = Math.round((duration / timescale) * 1000)
  return Number.isFinite(durationMs) && durationMs > 0 ? durationMs : null
}

function readStyleReferenceFiles(form: FormData): File[] {
  return form
    .getAll(PROJECT_STYLE_REFERENCE_FIELD)
    .filter((value): value is File => value instanceof File)
}

async function prepareStyleReference(file: File, order: number): Promise<PreparedStyleReference> {
  const kind = projectStyleReferenceKind(file)
  if (!kind) {
    throw styleReferenceError(
      'STYLE_REFERENCE_TYPE_UNSUPPORTED',
      '画风参考仅支持 JPG、PNG、MP4 或 MOV 文件。',
      order,
      file.name,
    )
  }
  if (file.size <= 0 || file.size > PROJECT_STYLE_REFERENCE_MAX_FILE_BYTES) {
    throw styleReferenceError(
      'STYLE_REFERENCE_FILE_TOO_LARGE',
      '单个画风参考文件必须小于 200MB。',
      order,
      file.name,
    )
  }

  const body = Buffer.from(await file.arrayBuffer())
  const extension = projectStyleReferenceExtension(file.name)
  let mimeType = ''
  let width: number | null = null
  let height: number | null = null
  let durationMs: number | null = null

  if (kind === 'image') {
    const metadata = await sharp(body).metadata().catch(() => null)
    const expectedFormat = extension === 'png' ? 'png' : 'jpeg'
    if (!metadata || metadata.format !== expectedFormat || !metadata.width || !metadata.height) {
      throw styleReferenceError(
        'STYLE_REFERENCE_IMAGE_UNREADABLE',
        '无法读取这张画风参考图片，或文件内容与扩展名不一致。',
        order,
        file.name,
      )
    }
    mimeType = expectedFormat === 'png' ? 'image/png' : 'image/jpeg'
    width = metadata.width
    height = metadata.height
  } else {
    durationMs = readIsoMediaDurationMs(body)
    if (!durationMs) {
      throw styleReferenceError(
        'STYLE_REFERENCE_VIDEO_UNREADABLE',
        '无法读取这个 MP4/MOV 画风参考视频。',
        order,
        file.name,
      )
    }
    if (durationMs > PROJECT_STYLE_REFERENCE_MAX_VIDEO_SECONDS * 1000) {
      throw styleReferenceError(
        'STYLE_REFERENCE_VIDEO_TOO_LONG',
        '画风参考视频时长不能超过 1 分钟。',
        order,
        file.name,
      )
    }
    mimeType = extension === 'mov' ? 'video/quicktime' : 'video/mp4'
  }

  return {
    body,
    extension,
    kind,
    mimeType,
    name: file.name.slice(0, 255),
    sizeBytes: body.length,
    width,
    height,
    durationMs,
    sha256: createHash('sha256').update(body).digest('hex'),
    order,
  }
}

export async function prepareProjectStyleReferences(form: FormData): Promise<PreparedStyleReference[]> {
  const files = readStyleReferenceFiles(form)
  if (files.length > PROJECT_STYLE_REFERENCE_MAX_COUNT) {
    throw styleReferenceError(
      'STYLE_REFERENCE_COUNT_EXCEEDED',
      `画风参考最多上传 ${PROJECT_STYLE_REFERENCE_MAX_COUNT} 个文件。`,
    )
  }
  return await Promise.all(files.map((file, index) => prepareStyleReference(file, index)))
}

export async function uploadProjectStyleReferences(
  prepared: PreparedStyleReference[],
  userId: string,
): Promise<UploadedStyleReference[]> {
  const uploaded: UploadedStyleReference[] = []
  try {
    for (const item of prepared) {
      const storageKey = generateUniqueKey(`project-style-${userId}`, item.extension)
      await uploadObject(item.body, storageKey, undefined, item.mimeType)
      uploaded.push({
        ...item,
        storageKey,
        publicId: stablePublicIdFromStorageKey(storageKey),
      })
    }
    return uploaded
  } catch {
    await cleanupUploadedProjectStyleReferences(uploaded)
    const failedIndex = uploaded.length
    const failed = prepared[failedIndex]
    throw new ApiError('INTERNAL_ERROR', {
      code: 'STYLE_REFERENCE_UPLOAD_FAILED',
      field: PROJECT_STYLE_REFERENCE_FIELD,
      styleReferenceIndex: failedIndex,
      styleReferenceFileName: failed?.name,
      message: `画风参考“${failed?.name || '文件'}”上传失败，请重试。`,
    })
  }
}

export async function cleanupUploadedProjectStyleReferences(
  uploaded: Array<Pick<UploadedStyleReference, 'storageKey'>>,
): Promise<void> {
  await Promise.allSettled(uploaded.map((item) => deleteObject(item.storageKey)))
}

type TransactionMediaObject = {
  create: (args: Prisma.MediaObjectCreateArgs) => Promise<{ id: string }>
}

export async function persistProjectStyleReferenceMedia(
  mediaObject: TransactionMediaObject,
  uploaded: UploadedStyleReference[],
): Promise<ProjectStyleReferenceValue[]> {
  const references: ProjectStyleReferenceValue[] = []
  for (const item of uploaded) {
    const media = await mediaObject.create({
      data: {
        publicId: item.publicId,
        storageKey: item.storageKey,
        sha256: item.sha256,
        mimeType: item.mimeType,
        sizeBytes: BigInt(item.sizeBytes),
        width: item.width,
        height: item.height,
        durationMs: item.durationMs,
      },
      select: { id: true },
    })
    references.push({
      mediaId: media.id,
      publicId: item.publicId,
      url: `/m/${encodeURIComponent(item.publicId)}`,
      storageKey: item.storageKey,
      kind: item.kind,
      name: item.name,
      mimeType: item.mimeType,
      sizeBytes: item.sizeBytes,
      width: item.width,
      height: item.height,
      durationMs: item.durationMs,
      order: item.order,
    })
  }
  return references
}
