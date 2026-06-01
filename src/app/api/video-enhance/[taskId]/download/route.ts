import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireUserAuth } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'
import { getObjectBuffer, toFetchableUrl } from '@/lib/storage'

type RouteParams = Record<string, string | string[] | undefined> & {
  taskId: string
}

const CONTENT_TYPE_BY_EXTENSION: Record<string, string> = {
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  mkv: 'video/x-matroska',
  webm: 'video/webm',
}

function sanitizeFileName(value: string): string {
  return value.trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ') || 'enhanced-video.mp4'
}

function resultFileName(name: string): string {
  const rawName = name.split('?')[0] || 'enhanced-video'
  const withoutExt = rawName.replace(/\.[a-z0-9]{2,5}$/i, '')
  return `${sanitizeFileName(withoutExt)}-enhanced.mp4`
}

function readResultVideoUrl(result: unknown): string | null {
  if (!result || Array.isArray(result) || typeof result !== 'object') return null
  const value = (result as { videoUrl?: unknown }).videoUrl
  return typeof value === 'string' && value ? value : null
}

function contentTypeForFileName(fileName: string): string {
  const extension = fileName.split('.').pop()?.toLowerCase() || 'mp4'
  return CONTENT_TYPE_BY_EXTENSION[extension] || 'video/mp4'
}

async function readResultBuffer(record: {
  resultStorageKey: string | null
  resultVideoUrl: string | null
  result: unknown
}): Promise<{ buffer: Buffer; contentType: string }> {
  if (record.resultStorageKey) {
    return {
      buffer: await getObjectBuffer(record.resultStorageKey),
      contentType: contentTypeForFileName(record.resultStorageKey),
    }
  }

  const resultVideoUrl = record.resultVideoUrl || readResultVideoUrl(record.result)
  if (!resultVideoUrl) {
    throw new ApiError('NOT_FOUND', { message: '增强结果文件不存在或尚未完成归档' })
  }

  const response = await fetch(toFetchableUrl(resultVideoUrl))
  if (!response.ok) {
    throw new ApiError('EXTERNAL_ERROR', { message: `读取增强结果失败：HTTP ${response.status}` })
  }

  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get('content-type') || 'video/mp4',
  }
}

export const GET = apiHandler(async (_request: NextRequest, context: { params: Promise<RouteParams> }) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult
  const { taskId } = await context.params
  const normalizedTaskId = typeof taskId === 'string' ? taskId.trim() : ''

  if (!normalizedTaskId || !/^[A-Za-z0-9._:-]+$/.test(normalizedTaskId)) {
    throw new ApiError('INVALID_PARAMS', { message: 'task_id 参数无效' })
  }

  const record = await prisma.videoEnhanceTask.findFirst({
    where: {
      userId: session.user.id,
      mediaKitTaskId: normalizedTaskId,
      status: 'completed',
    },
    select: {
      name: true,
      result: true,
      resultStorageKey: true,
      resultVideoUrl: true,
    },
  })

  if (!record) {
    throw new ApiError('NOT_FOUND', { message: '未找到已完成的增强任务' })
  }

  const fileName = resultFileName(record.name)
  const { buffer, contentType } = await readResultBuffer(record)

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(buffer.length),
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      'Cache-Control': 'private, no-store',
    },
  })
})
