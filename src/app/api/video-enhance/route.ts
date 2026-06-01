import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireUserAuth } from '@/lib/api-auth'
import { getPublicBaseUrl } from '@/lib/env'
import { prisma } from '@/lib/prisma'
import { generateUniqueKey, getSignedObjectUrl, uploadObject } from '@/lib/storage'
import { serializeVideoEnhanceTask, toNullableJson } from '@/lib/video-enhance/history'
import {
  MediaKitError,
  type MediaKitEnhanceVideoPayload,
  type MediaKitResolution,
  type MediaKitScene,
  type MediaKitToolVersion,
  resolveMediaKitApiKey,
  submitMediaKitEnhanceVideoTask,
} from '@/lib/volcengine/mediakit'

const INPUT_SIGNED_URL_EXPIRES_SECONDS = 7 * 24 * 60 * 60
const RESULT_SIGNED_URL_EXPIRES_SECONDS = 7 * 24 * 60 * 60
const MAX_VIDEO_BYTES = 10 * 1024 * 1024 * 1024
const TOOL_VERSIONS = new Set<MediaKitToolVersion>(['standard', 'professional'])
const SCENES = new Set<MediaKitScene>(['common', 'ugc', 'short_series', 'aigc', 'old_film'])
const RESOLUTIONS = new Set<MediaKitResolution>(['240p', '360p', '480p', '540p', '720p', '1080p', '2k', '4k'])
const VIDEO_EXTENSIONS = new Set(['mp4', 'flv', 'ts', 'avi', 'mov', 'wmv', 'mkv', 'webm'])
const MIME_TO_EXTENSION: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/x-flv': 'flv',
  'video/mp2t': 'ts',
  'video/x-msvideo': 'avi',
  'video/quicktime': 'mov',
  'video/x-ms-wmv': 'wmv',
  'video/x-matroska': 'mkv',
  'video/webm': 'webm',
}
const MIME_BY_EXTENSION: Record<string, string> = {
  mp4: 'video/mp4',
  flv: 'video/x-flv',
  ts: 'video/mp2t',
  avi: 'video/x-msvideo',
  mov: 'video/quicktime',
  wmv: 'video/x-ms-wmv',
  mkv: 'video/x-matroska',
  webm: 'video/webm',
}

function readString(value: FormDataEntryValue | null): string {
  return typeof value === 'string' ? value.trim() : ''
}

function isHttpUrl(value: string): boolean {
  return value.startsWith('http://') || value.startsWith('https://')
}

function isPrivateIpv4Hostname(hostname: string): boolean {
  const parts = hostname.split('.')
  if (parts.length !== 4) return false
  const octets = parts.map((part) => Number.parseInt(part, 10))
  if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return false
  const [first, second] = octets
  if (first === 10) return true
  if (first === 127) return true
  if (first === 169 && second === 254) return true
  if (first === 172 && second >= 16 && second <= 31) return true
  if (first === 192 && second === 168) return true
  return false
}

function isLocalOrPrivateHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/\.+$/, '')
  return normalized === 'localhost'
    || normalized === '0.0.0.0'
    || normalized === '::1'
    || normalized === '[::1]'
    || normalized.endsWith('.local')
    || isPrivateIpv4Hostname(normalized)
}

function isLocalOrPrivateHttpUrl(value: string): boolean {
  try {
    return isLocalOrPrivateHostname(new URL(value).hostname)
  } catch {
    return false
  }
}

function assertMediaKitFetchableUrl(value: string, source: 'upload' | 'url') {
  if (!isLocalOrPrivateHttpUrl(value)) return
  const message = source === 'upload'
    ? '上传文件已暂存到本机或内网存储地址，MediaKit 云端无法访问。请配置 MINIO_PUBLIC_ENDPOINT 为公网可访问的对象存储地址，或改用公网视频 URL。'
    : '视频 URL 指向本机或内网地址，MediaKit 云端无法访问。请使用公网可访问的 HTTP/HTTPS 视频 URL。'
  throw new ApiError('INVALID_PARAMS', { message })
}

function makePublicUrl(value: string): string {
  if (isHttpUrl(value)) return withPublicMinioEndpoint(value)
  const baseUrl = getPublicBaseUrl().replace(/\/+$/, '')
  return `${baseUrl}${value.startsWith('/') ? value : `/${value}`}`
}

function withPublicMinioEndpoint(value: string): string {
  const publicEndpoint = process.env.MINIO_PUBLIC_ENDPOINT?.trim()
  const internalEndpoint = process.env.MINIO_ENDPOINT?.trim()
  if (!publicEndpoint || !internalEndpoint) return value

  try {
    const parsed = new URL(value)
    const internal = new URL(internalEndpoint)
    if (parsed.origin !== internal.origin) return value
    const external = new URL(publicEndpoint)
    parsed.protocol = external.protocol
    parsed.host = external.host
    return parsed.toString()
  } catch {
    return value
  }
}

function getVideoExtension(file: File): string | null {
  const ext = file.name.split('.').pop()?.toLowerCase() || ''
  if (VIDEO_EXTENSIONS.has(ext)) return ext
  const mimeExt = MIME_TO_EXTENSION[file.type]
  return mimeExt || null
}

function getUrlFileName(url: string): string {
  try {
    const parsed = new URL(url)
    return parsed.pathname.split('/').pop() || 'URL 视频'
  } catch {
    return 'URL 视频'
  }
}

function readOptionalEnum<T extends string>(value: string, allowed: Set<T>): T | undefined {
  if (!value) return undefined
  return allowed.has(value as T) ? value as T : undefined
}

function readResolutionLimit(value: string): number | undefined {
  if (!value) return undefined
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed < 64 || parsed > 2160) {
    throw new ApiError('INVALID_PARAMS', { message: 'resolution_limit 必须在 64 到 2160 之间' })
  }
  return parsed
}

function readFps(value: string): number | undefined {
  if (!value) return undefined
  const parsed = Number.parseFloat(value)
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 120) {
    throw new ApiError('INVALID_PARAMS', { message: 'fps 必须大于 0 且不超过 120' })
  }
  return parsed
}

function assertClientToken(value: string): string | undefined {
  if (!value) return undefined
  if (value.length > 64 || !/^[\x20-\x7E]+$/.test(value)) {
    throw new ApiError('INVALID_PARAMS', { message: 'client_token 不超过 64 个 ASCII 可打印字符' })
  }
  return value
}

function assertCallbackArgs(value: string): string | undefined {
  if (!value) return undefined
  if (Buffer.byteLength(value, 'utf8') > 512) {
    throw new ApiError('INVALID_PARAMS', { message: 'callback_args 最多 512 字节' })
  }
  return value
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

export const GET = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult
  const rawLimit = Number.parseInt(request.nextUrl.searchParams.get('limit') || '100', 10)
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 200) : 100

  const tasks = await prisma.videoEnhanceTask.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: 'desc' },
    take: limit,
  })

  const serializedTasks = await Promise.all(tasks.map(async (task) => {
    let resultVideoUrl = task.resultVideoUrl
    if (task.resultStorageKey) {
      try {
        resultVideoUrl = await getSignedObjectUrl(task.resultStorageKey, RESULT_SIGNED_URL_EXPIRES_SECONDS)
      } catch {
        resultVideoUrl = task.resultVideoUrl
      }
    }
    return serializeVideoEnhanceTask(task, resultVideoUrl)
  }))

  return NextResponse.json({
    success: true,
    tasks: serializedTasks,
  })
})

export const POST = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  const formData = await request.formData()
  const uploadedFile = formData.get('file')
  const directVideoUrl = readString(formData.get('videoUrl'))
  let videoUrl = directVideoUrl
  let storageKey: string | null = null
  let sourceName = directVideoUrl ? getUrlFileName(directVideoUrl) : '视频文件'
  let fileSize: string | null = null

  if (uploadedFile instanceof File && uploadedFile.size > 0) {
    if (uploadedFile.size > MAX_VIDEO_BYTES) {
      throw new ApiError('INVALID_PARAMS', { message: '视频文件建议不超过 10GB' })
    }
    const extension = getVideoExtension(uploadedFile)
    if (!extension) {
      throw new ApiError('INVALID_PARAMS', { message: '请上传 mp4、flv、ts、avi、mov、wmv、mkv 或 webm 视频' })
    }
    sourceName = uploadedFile.name || sourceName
    fileSize = String(uploadedFile.size)
    const buffer = Buffer.from(await uploadedFile.arrayBuffer())
    const key = generateUniqueKey(`video-enhance/${session.user.id}`, extension)
    await uploadObject(buffer, key, undefined, uploadedFile.type || MIME_BY_EXTENSION[extension])
    storageKey = key
    videoUrl = makePublicUrl(await getSignedObjectUrl(key, INPUT_SIGNED_URL_EXPIRES_SECONDS))
  }

  if (!isHttpUrl(videoUrl)) {
    throw new ApiError('INVALID_PARAMS', { message: '请上传视频文件，或填写公网可访问的 HTTP/HTTPS 视频 URL' })
  }
  assertMediaKitFetchableUrl(videoUrl, storageKey ? 'upload' : 'url')

  const toolVersion = readOptionalEnum(readString(formData.get('toolVersion')), TOOL_VERSIONS)
  const scene = readOptionalEnum(readString(formData.get('scene')), SCENES)
  const resolution = readOptionalEnum(readString(formData.get('resolution')), RESOLUTIONS)
  const resolutionLimit = readResolutionLimit(readString(formData.get('resolutionLimit')))
  const fps = readFps(readString(formData.get('fps')))
  const clientToken = assertClientToken(readString(formData.get('clientToken')))
  const callbackArgs = assertCallbackArgs(readString(formData.get('callbackArgs')))

  if (readString(formData.get('toolVersion')) && !toolVersion) {
    throw new ApiError('INVALID_PARAMS', { message: 'tool_version 参数无效' })
  }
  if (readString(formData.get('scene')) && !scene) {
    throw new ApiError('INVALID_PARAMS', { message: 'scene 参数无效' })
  }
  if (readString(formData.get('resolution')) && !resolution) {
    throw new ApiError('INVALID_PARAMS', { message: 'resolution 参数无效' })
  }
  if (resolution && resolutionLimit) {
    throw new ApiError('INVALID_PARAMS', { message: 'resolution 与 resolution_limit 不能同时配置' })
  }

  const payload: MediaKitEnhanceVideoPayload = {
    video_url: videoUrl,
    ...(toolVersion ? { tool_version: toolVersion } : {}),
    ...(scene ? { scene } : {}),
    ...(resolution ? { resolution } : {}),
    ...(resolutionLimit ? { resolution_limit: resolutionLimit } : {}),
    ...(fps ? { fps } : {}),
    ...(clientToken ? { client_token: clientToken } : {}),
    ...(callbackArgs ? { callback_args: callbackArgs } : {}),
  }

  try {
    const apiKey = await resolveMediaKitApiKey(session.user.id)
    const submitResult = await submitMediaKitEnhanceVideoTask(apiKey, payload)
    const record = await prisma.videoEnhanceTask.create({
      data: {
        userId: session.user.id,
        sourceType: storageKey ? 'file' : 'url',
        name: sourceName,
        fileSize,
        sourceUrl: directVideoUrl || null,
        inputVideoUrl: videoUrl,
        storageKey,
        mediaKitTaskId: submitResult.task_id,
        requestId: submitResult.request_id || null,
        status: 'submitted',
        parameters: toNullableJson(payload),
      },
    })

    return NextResponse.json({
      success: true,
      taskId: submitResult.task_id,
      requestId: submitResult.request_id || null,
      record: serializeVideoEnhanceTask(record),
      input: {
        videoUrl,
        storageKey,
        localInputWarning: false,
      },
      parameters: payload,
    })
  } catch (error) {
    throw toExternalError(error)
  }
})
