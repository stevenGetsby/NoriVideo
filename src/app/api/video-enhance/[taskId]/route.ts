import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireUserAuth } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'
import { generateUniqueKey, getSignedObjectUrl, uploadObject } from '@/lib/storage'
import { getTerminalFinishedAt, serializeVideoEnhanceTask, toNullableJson } from '@/lib/video-enhance/history'
import {
  MediaKitError,
  type MediaKitTaskResponse,
  resolveMediaKitApiKey,
  queryMediaKitTask,
} from '@/lib/volcengine/mediakit'

type RouteParams = Record<string, string | string[] | undefined> & {
  taskId: string
}

const RESULT_SIGNED_URL_EXPIRES_SECONDS = 7 * 24 * 60 * 60
const RESULT_VIDEO_EXTENSIONS = new Set(['mp4', 'mov', 'mkv', 'webm'])
const RESULT_MIME_BY_EXTENSION: Record<string, string> = {
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  mkv: 'video/x-matroska',
  webm: 'video/webm',
}

function normalizeTask(payload: MediaKitTaskResponse, fallbackTaskId: string) {
  const result = payload.result || payload.output || null

  return {
    success: payload.success !== false,
    taskId: payload.task_id || fallbackTaskId,
    taskType: payload.task_type || null,
    status: payload.status || 'unknown',
    result: result ? {
      videoUrl: result.video_url || null,
      duration: typeof result.duration === 'number' ? result.duration : null,
      fps: typeof result.fps === 'number' ? result.fps : null,
      resolution: typeof result.resolution === 'string' ? result.resolution : null,
      toolVersion: typeof result.tool_version === 'string' ? result.tool_version : null,
    } : null,
    expiresAt: payload.expires_at || payload.expire_timestamp || null,
    createdAt: payload.created_at || null,
    finishedAt: payload.finished_at || null,
    requestId: payload.request_id || null,
  }
}

function toExternalError(error: unknown): ApiError {
  if (error instanceof MediaKitError) {
    return new ApiError('EXTERNAL_ERROR', {
      message: error.message,
      upstreamStatus: error.status,
    })
  }
  if (error instanceof Error && error.message === 'MEDIAKIT_API_KEY_MISSING') {
    return new ApiError('MISSING_CONFIG', {
      message: '缺少 MediaKit API Key，请配置 VOLCENGINE_MEDIAKIT_API_KEY / MEDIAKIT_API_KEY，或在 API 配置中添加 provider id 为 mediakit 的自定义提供商。',
    })
  }
  return new ApiError('EXTERNAL_ERROR', {
    message: error instanceof Error ? error.message : 'MediaKit request failed',
  })
}

function getResultExtension(videoUrl: string, fallbackName: string): string {
  const candidates = [videoUrl, fallbackName]
  for (const candidate of candidates) {
    try {
      const parsed = candidate.startsWith('http') ? new URL(candidate).pathname : candidate
      const extension = parsed.split('.').pop()?.toLowerCase() || ''
      if (RESULT_VIDEO_EXTENSIONS.has(extension)) return extension
    } catch {
      const extension = candidate.split('.').pop()?.toLowerCase() || ''
      if (RESULT_VIDEO_EXTENSIONS.has(extension)) return extension
    }
  }
  return 'mp4'
}

async function archiveResultVideo(record: {
  id: string
  userId: string
  name: string
  resultStorageKey: string | null
  resultVideoUrl: string | null
}, result: ReturnType<typeof normalizeTask>['result']): Promise<{
  result: ReturnType<typeof normalizeTask>['result']
  resultStorageKey: string | null
  resultVideoUrl: string | null
}> {
  if (!result?.videoUrl) {
    return { result, resultStorageKey: record.resultStorageKey, resultVideoUrl: record.resultVideoUrl }
  }

  if (record.resultStorageKey) {
    try {
      const signedUrl = await getSignedObjectUrl(record.resultStorageKey, RESULT_SIGNED_URL_EXPIRES_SECONDS)
      return { result: { ...result, videoUrl: signedUrl }, resultStorageKey: record.resultStorageKey, resultVideoUrl: signedUrl }
    } catch {
      return { result, resultStorageKey: record.resultStorageKey, resultVideoUrl: record.resultVideoUrl }
    }
  }

  try {
    const response = await fetch(result.videoUrl)
    if (!response.ok) throw new Error(`Archive download failed: ${response.status}`)
    const extension = getResultExtension(result.videoUrl, record.name)
    const contentType = response.headers.get('content-type') || RESULT_MIME_BY_EXTENSION[extension] || 'video/mp4'
    const key = generateUniqueKey(`video-enhance-results/${record.userId}`, extension)
    const buffer = Buffer.from(await response.arrayBuffer())
    await uploadObject(buffer, key, 1, contentType)
    const signedUrl = await getSignedObjectUrl(key, RESULT_SIGNED_URL_EXPIRES_SECONDS)
    return { result: { ...result, videoUrl: signedUrl }, resultStorageKey: key, resultVideoUrl: signedUrl }
  } catch {
    return { result, resultStorageKey: record.resultStorageKey, resultVideoUrl: record.resultVideoUrl }
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

  try {
    const apiKey = await resolveMediaKitApiKey(session.user.id)
    const task = await queryMediaKitTask(apiKey, normalizedTaskId)
    const normalizedTask = normalizeTask(task, normalizedTaskId)
    const existingRecord = await prisma.videoEnhanceTask.findFirst({
      where: {
        userId: session.user.id,
        mediaKitTaskId: normalizedTaskId,
      },
    })
    const finishedAt = existingRecord?.finishedAt || getTerminalFinishedAt(normalizedTask.status, normalizedTask.finishedAt)
    const archive = existingRecord && normalizedTask.status.toLowerCase() === 'completed'
      ? await archiveResultVideo(existingRecord, normalizedTask.result)
      : { result: normalizedTask.result, resultStorageKey: existingRecord?.resultStorageKey || null, resultVideoUrl: existingRecord?.resultVideoUrl || null }
    const record = existingRecord ? await prisma.videoEnhanceTask.update({
      where: { id: existingRecord.id },
      data: {
        status: normalizedTask.status,
        requestId: normalizedTask.requestId || existingRecord.requestId,
        result: toNullableJson(normalizedTask.result),
        resultStorageKey: archive.resultStorageKey,
        resultVideoUrl: archive.resultVideoUrl,
        lastCheckedAt: new Date(),
        ...(finishedAt ? { finishedAt } : {}),
      },
    }) : null

    return NextResponse.json({
      ...normalizedTask,
      result: archive.result,
      record: record ? serializeVideoEnhanceTask(record, archive.resultVideoUrl) : null,
      uploadedAt: record?.uploadedAt.toISOString() || null,
      finishedAt: record?.finishedAt?.toISOString() || null,
    })
  } catch (error) {
    throw toExternalError(error)
  }
})
