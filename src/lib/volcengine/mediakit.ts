import { getProviderConfig } from '@/lib/api-config'

const MEDIAKIT_BASE_URL = 'https://mediakit.cn-beijing.volces.com'
const ENV_API_KEY_NAMES = [
  'VOLCENGINE_MEDIAKIT_API_KEY',
  'MEDIAKIT_API_KEY',
  'VOLC_MEDIAKIT_API_KEY',
]

export const MEDIAKIT_PROVIDER_ID = 'mediakit'

export type MediaKitToolVersion = 'standard' | 'professional'
export type MediaKitScene = 'common' | 'ugc' | 'short_series' | 'aigc' | 'old_film'
export type MediaKitResolution = '240p' | '360p' | '480p' | '540p' | '720p' | '1080p' | '2k' | '4k'

export interface MediaKitEnhanceVideoPayload {
  video_url: string
  tool_version?: MediaKitToolVersion
  scene?: MediaKitScene
  resolution?: MediaKitResolution
  resolution_limit?: number
  fps?: number
  client_token?: string
  callback_args?: string
}

export interface MediaKitSubmitResponse {
  success: boolean
  task_id: string
  request_id?: string
}

export interface MediaKitTaskResult {
  video_url?: string
  duration?: number
  fps?: number
  resolution?: string
  tool_version?: string
  [key: string]: unknown
}

export interface MediaKitTaskResponse {
  success?: boolean
  task_id?: string
  task_type?: string
  status?: string
  result?: MediaKitTaskResult
  output?: MediaKitTaskResult
  expires_at?: number
  expire_timestamp?: number
  created_at?: number
  finished_at?: number
  request_id?: string
  [key: string]: unknown
}

export class MediaKitError extends Error {
  status: number
  payload: unknown

  constructor(message: string, status: number, payload: unknown) {
    super(message)
    this.name = 'MediaKitError'
    this.status = status
    this.payload = payload
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function readTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readEnvMediaKitApiKey(): string | null {
  for (const name of ENV_API_KEY_NAMES) {
    const value = readTrimmedString(process.env[name])
    if (value) return value
  }
  return null
}

function extractErrorMessage(payload: unknown): string | null {
  if (!isRecord(payload)) return null
  const error = payload.error
  if (typeof error === 'string' && error.trim()) return error.trim()
  if (isRecord(error)) {
    const message = readTrimmedString(error.message)
    if (message) return message
    const code = readTrimmedString(error.code)
    if (code) return code
  }
  const message = readTrimmedString(payload.message)
  if (message) return message
  return null
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text.trim()) return {}
  try {
    return JSON.parse(text) as unknown
  } catch {
    return { message: text }
  }
}

async function requestMediaKit<T>(apiKey: string, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${MEDIAKIT_BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers || {}),
    },
  })
  const payload = await readJson(response)
  const failedByBody = isRecord(payload) && payload.success === false

  if (!response.ok || failedByBody) {
    throw new MediaKitError(
      extractErrorMessage(payload) || `MediaKit request failed with ${response.status}`,
      response.status,
      payload,
    )
  }

  return payload as T
}

export async function resolveMediaKitApiKey(userId: string): Promise<string> {
  try {
    const providerConfig = await getProviderConfig(userId, MEDIAKIT_PROVIDER_ID)
    if (providerConfig.apiKey) return providerConfig.apiKey
  } catch {
    // Environment variables remain a deployment fallback when config center has not been set.
  }

  const envApiKey = readEnvMediaKitApiKey()
  if (envApiKey) return envApiKey

  throw new Error('MEDIAKIT_API_KEY_MISSING')
}

export async function submitMediaKitEnhanceVideoTask(
  apiKey: string,
  payload: MediaKitEnhanceVideoPayload,
): Promise<MediaKitSubmitResponse> {
  const response = await requestMediaKit<MediaKitSubmitResponse>(apiKey, '/api/v1/tools/enhance-video', {
    method: 'POST',
    body: JSON.stringify(payload),
  })

  if (!response.task_id) {
    throw new MediaKitError('MediaKit response missing task_id', 502, response)
  }

  return response
}

export async function queryMediaKitTask(apiKey: string, taskId: string): Promise<MediaKitTaskResponse> {
  return await requestMediaKit<MediaKitTaskResponse>(apiKey, `/api/v1/tasks/${encodeURIComponent(taskId)}`)
}
