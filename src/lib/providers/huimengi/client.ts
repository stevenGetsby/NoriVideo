import { sanitizePublicError } from '@/lib/errors/sanitize-public-error'

export const HUIMENGI_DEFAULT_BASE_URL = 'https://api.huimengi.com'

export type JsonRecord = Record<string, unknown>

const HUIMENGI_DEFAULT_TIMEOUT_MS = 60_000

export function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : null
}

export function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function readFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

export function buildHuimengiUrl(baseUrl: string | undefined, path: string): string {
  const base = (readString(baseUrl) || HUIMENGI_DEFAULT_BASE_URL).replace(/\/+$/, '')
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return `${base}${normalizedPath}`
}

function responseMessage(payload: unknown, fallback: string): string {
  const record = asRecord(payload)
  const detail = asRecord(record?.detail)
  return sanitizePublicError(
    readString(detail?.message)
    || readString(detail?.error_code)
    || readString(record?.message)
    || readString(record?.error_message)
    || fallback,
  )
}

async function readJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text().catch(() => '')
  if (!text) return {}
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new Error(`HUIMENGI_RESPONSE_INVALID_JSON: HTTP ${response.status}`)
  }
}

export async function requestHuimengi(input: {
  apiKey: string
  baseUrl?: string
  path: string
  method: 'GET' | 'POST'
  body?: Record<string, unknown>
  timeoutMs?: number
}): Promise<unknown> {
  const response = await fetch(buildHuimengiUrl(input.baseUrl, input.path), {
    method: input.method,
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      ...(input.body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(input.body ? { body: JSON.stringify(input.body) } : {}),
    signal: AbortSignal.timeout(input.timeoutMs || HUIMENGI_DEFAULT_TIMEOUT_MS),
  })
  const payload = await readJsonResponse(response)
  if (!response.ok) {
    throw new Error(`HUIMENGI_HTTP_ERROR(${response.status}): ${responseMessage(payload, response.statusText || 'request failed')}`)
  }
  return payload
}
