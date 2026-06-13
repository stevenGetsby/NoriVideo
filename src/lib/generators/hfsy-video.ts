import type { GenerateResult } from './base'
import type { PollResult } from '@/lib/async-poll'

type HfsyVideoCreateResponse = {
  success?: boolean
  message?: string
  id?: string
  data?: {
    id?: string
  }
}

type HfsyVideoQueryResponse = Record<string, unknown>

export type HfsyVideoCreateInput = {
  apiKey: string
  baseUrl?: string | null
  modelId: string
  prompt: string
  referenceImages?: string[]
  referenceVideos?: string[]
  audios?: string[]
  duration?: number
  aspectRatio?: string
  orientation?: string
  ratio?: string
  size?: string
  watermark?: boolean
}

function normalizeBaseUrl(baseUrl: string | null | undefined): string {
  const trimmed = (baseUrl || 'https://www.hfsyapi.cn/v1').trim().replace(/\/+$/, '')
  if (!trimmed) return 'https://www.hfsyapi.cn/v1'
  return trimmed.endsWith('/v1') ? trimmed : `${trimmed}/v1`
}

function normalizeDuration(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return 6
  return Math.max(4, Math.min(15, Math.round(parsed)))
}

function normalizeOrientation(value: unknown, ratio: string | undefined): 'landscape' | 'portrait' {
  if (value === 'landscape' || value === 'portrait') return value
  if (ratio === '16:9' || ratio === '21:9' || ratio === '4:3') return 'landscape'
  return 'portrait'
}

function normalizeRatio(value: unknown, aspectRatio: string | undefined): string {
  const candidate = typeof value === 'string' && value.trim() ? value.trim() : aspectRatio
  return candidate || '9:16'
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => (typeof item === 'string' ? item.trim() : '')).filter(Boolean)
}

function readErrorMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== 'object') return fallback
  const record = payload as Record<string, unknown>
  const message = record.message
  if (typeof message === 'string' && message.trim()) return message.trim()
  const error = record.error
  if (typeof error === 'string' && error.trim()) return error.trim()
  if (error && typeof error === 'object') {
    const nested = (error as Record<string, unknown>).message
    if (typeof nested === 'string' && nested.trim()) return nested.trim()
  }
  return fallback
}

function findFirstMp4Url(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (/^https?:\/\//i.test(trimmed) && /\.mp4(?:[?#]|$)/i.test(trimmed)) return trimmed
    return null
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findFirstMp4Url(item)
      if (found) return found
    }
    return null
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value as Record<string, unknown>)) {
      const found = findFirstMp4Url(item)
      if (found) return found
    }
  }
  return null
}

function readStatus(payload: HfsyVideoQueryResponse): string {
  const rootStatus = payload.status
  if (typeof rootStatus === 'string') return rootStatus.trim().toLowerCase()
  const data = payload.data
  if (data && typeof data === 'object') {
    const dataStatus = (data as Record<string, unknown>).status
    if (typeof dataStatus === 'string') return dataStatus.trim().toLowerCase()
    const detail = (data as Record<string, unknown>).detail
    if (detail && typeof detail === 'object') {
      const detailStatus = (detail as Record<string, unknown>).status
      if (typeof detailStatus === 'string') return detailStatus.trim().toLowerCase()
    }
  }
  return ''
}

export async function generateHfsySd2Video(input: HfsyVideoCreateInput): Promise<GenerateResult> {
  const baseUrl = normalizeBaseUrl(input.baseUrl)
  const ratio = normalizeRatio(input.ratio, input.aspectRatio)
  const body: Record<string, unknown> = {
    model: input.modelId,
    orientation: normalizeOrientation(input.orientation, ratio),
    ratio,
    prompt: input.prompt,
    duration: normalizeDuration(input.duration),
    size: input.size || 'large',
    watermark: input.watermark === true,
  }

  const images = stringArray(input.referenceImages)
  const videos = stringArray(input.referenceVideos)
  const audios = stringArray(input.audios)
  if (images.length > 0) body.images = images.slice(0, 9)
  if (videos.length > 0) body.videos = videos
  if (audios.length > 0) body.audios = audios.slice(0, 3)

  const response = await fetch(`${baseUrl}/video/create`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const rawText = await response.text().catch(() => '')
  let payload: HfsyVideoCreateResponse = {}
  try {
    payload = rawText ? JSON.parse(rawText) as HfsyVideoCreateResponse : {}
  } catch {
    payload = {}
  }

  if (!response.ok || payload.success === false) {
    return {
      success: false,
      error: readErrorMessage(payload, `HFSY_VIDEO_CREATE_FAILED: ${response.status} ${rawText.slice(0, 200)}`),
    }
  }

  const taskId = typeof payload.id === 'string' && payload.id.trim()
    ? payload.id.trim()
    : typeof payload.data?.id === 'string' && payload.data.id.trim()
      ? payload.data.id.trim()
      : ''
  if (!taskId) {
    return {
      success: false,
      error: 'HFSY_VIDEO_CREATE_FAILED: missing task id',
    }
  }

  return {
    success: true,
    async: true,
    requestId: taskId,
    externalId: `HFSY:VIDEO:${taskId}`,
  }
}

export async function queryHfsySd2VideoTask(input: {
  apiKey: string
  baseUrl?: string | null
  taskId: string
}): Promise<PollResult> {
  const baseUrl = normalizeBaseUrl(input.baseUrl)
  const response = await fetch(`${baseUrl}/video/query?id=${encodeURIComponent(input.taskId)}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
    },
  })
  const rawText = await response.text().catch(() => '')
  let payload: HfsyVideoQueryResponse = {}
  try {
    payload = rawText ? JSON.parse(rawText) as HfsyVideoQueryResponse : {}
  } catch {
    return {
      status: 'failed',
      error: `HFSY_VIDEO_QUERY_INVALID_JSON: ${rawText.slice(0, 200)}`,
    }
  }

  if (!response.ok || payload.success === false) {
    return {
      status: 'failed',
      error: readErrorMessage(payload, `HFSY_VIDEO_QUERY_FAILED: ${response.status}`),
    }
  }

  const status = readStatus(payload)
  if (status === 'completed' || status === 'success' || status === 'succeeded') {
    const videoUrl = findFirstMp4Url(payload)
    if (!videoUrl) {
      return {
        status: 'failed',
        error: 'HFSY_VIDEO_COMPLETED_BUT_URL_MISSING',
      }
    }
    return {
      status: 'completed',
      resultUrl: videoUrl,
      videoUrl,
    }
  }
  if (status === 'failure' || status === 'failed' || status === 'fail') {
    return {
      status: 'failed',
      error: readErrorMessage(payload, `HFSY_VIDEO_TASK_FAILED: ${input.taskId}`),
    }
  }
  return { status: 'pending' }
}
