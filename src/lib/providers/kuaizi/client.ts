import { sanitizePublicError } from '@/lib/errors/sanitize-public-error'

export const KUAIZI_DEFAULT_BASE_URL = 'https://aiopenapi.kuaizi.cn'

export type JsonRecord = Record<string, unknown>

export function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : null
}

export function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function buildKuaiziUrl(baseUrl: string | undefined, path: string): string {
  const base = (readString(baseUrl) || KUAIZI_DEFAULT_BASE_URL).replace(/\/+$/, '')
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  const apiPrefix = '/ai-open-platform-api'
  if (base.endsWith(apiPrefix) && normalizedPath.startsWith(apiPrefix)) {
    return `${base}${normalizedPath.slice(apiPrefix.length)}`
  }
  return `${base}${normalizedPath}`
}

function responseMessage(payload: unknown, fallback: string): string {
  const record = asRecord(payload)
  if (!record) return fallback
  const nestedError = asRecord(record.error)
  return sanitizePublicError(readString(record.message)
    || readString(record.reason)
    || readString(record.error)
    || readString(nestedError?.message)
    || fallback)
}

async function readJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text().catch(() => '')
  if (!text) return {}
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new Error(`KUAIZI_RESPONSE_INVALID_JSON: HTTP ${response.status}`)
  }
}

function unwrapApiKeyPayload(payload: unknown): unknown {
  const record = asRecord(payload)
  if (!record || record.code === undefined) return payload
  const code = typeof record.code === 'number'
    ? record.code
    : Number.parseInt(readString(record.code), 10)
  if (!Number.isFinite(code) || code !== 0) {
    throw new Error(`KUAIZI_API_ERROR(${String(record.code)}): ${responseMessage(record, 'unknown error')}`)
  }
  return record.data === undefined ? record : record.data
}

export async function postKuaiziApiKey(input: {
  apiKey: string
  baseUrl?: string
  path: string
  body: Record<string, unknown>
  timeoutMs?: number
}): Promise<unknown> {
  const response = await fetch(buildKuaiziUrl(input.baseUrl, input.path), {
    method: 'POST',
    headers: {
      ApiKey: input.apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input.body),
    signal: AbortSignal.timeout(input.timeoutMs || 60_000),
  })
  const payload = await readJsonResponse(response)
  if (!response.ok) {
    throw new Error(`KUAIZI_HTTP_ERROR(${response.status}): ${responseMessage(payload, response.statusText || 'request failed')}`)
  }
  return unwrapApiKeyPayload(payload)
}

export async function requestKuaiziBearer(input: {
  apiKey: string
  baseUrl?: string
  path: string
  method: 'GET' | 'POST'
  body?: Record<string, unknown>
  timeoutMs?: number
}): Promise<unknown> {
  const response = await fetch(buildKuaiziUrl(input.baseUrl, input.path), {
    method: input.method,
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      ...(input.body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(input.body ? { body: JSON.stringify(input.body) } : {}),
    signal: AbortSignal.timeout(input.timeoutMs || 60_000),
  })
  const payload = await readJsonResponse(response)
  if (!response.ok) {
    throw new Error(`KUAIZI_HTTP_ERROR(${response.status}): ${responseMessage(payload, response.statusText || 'request failed')}`)
  }
  return payload
}
