import { sanitizePublicError } from '@/lib/errors/sanitize-public-error'

export const TGG_DEFAULT_BASE_URL = 'https://tggtoken.org'
export const TGG_CREATE_TIMEOUT_MS = 60_000
export const TGG_QUERY_TIMEOUT_MS = 30_000

export type JsonRecord = Record<string, unknown>

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

export function buildTggUrl(baseUrl: string | undefined, path: string): string {
  if (/^https?:\/\//i.test(path)) return path
  const base = (readString(baseUrl) || TGG_DEFAULT_BASE_URL).replace(/\/+$/, '')
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return `${base}${normalizedPath}`
}

function responseMessage(payload: unknown, fallback: string): string {
  const record = asRecord(payload)
  const error = asRecord(record?.error)
  return sanitizePublicError(
    readString(error?.message)
    || readString(record?.message)
    || fallback,
  )
}

async function readJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text().catch(() => '')
  if (!text) return {}
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new Error(`TGG_RESPONSE_INVALID_JSON: HTTP ${response.status}`)
  }
}

export async function requestTgg(input: {
  apiKey: string
  baseUrl?: string
  path: string
  method: 'GET' | 'POST'
  body?: Record<string, unknown>
  timeoutMs?: number
  signal?: AbortSignal
}): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(buildTggUrl(input.baseUrl, input.path), {
      method: input.method,
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        ...(input.body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(input.body ? { body: JSON.stringify(input.body) } : {}),
      signal: input.signal || AbortSignal.timeout(input.timeoutMs || TGG_CREATE_TIMEOUT_MS),
    })
  } catch (error) {
    // Creation is not idempotent upstream: a timeout may already have produced
    // a billed task. Never retry; let the task fail unrecoverably instead.
    if (input.method === 'POST') throw new Error('TGG_SUBMIT_UNCONFIRMED')
    throw error
  }
  const payload = await readJsonResponse(response)
  if (!response.ok) {
    const message = responseMessage(payload, response.statusText || 'request failed')
    if (response.status === 429) throw new Error(`TGG_RATE_LIMITED: ${message}`)
    if ((response.status === 402 || response.status === 403) && /额度|余额|quota/i.test(message)) {
      throw new Error(`TGG_QUOTA_INSUFFICIENT: ${message}`)
    }
    throw new Error(`TGG_HTTP_ERROR(${response.status}): ${message}`)
  }
  return payload
}
