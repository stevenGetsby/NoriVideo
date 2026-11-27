import { sanitizePublicError } from '@/lib/errors/sanitize-public-error'

export const TOPENROUTER_DEFAULT_BASE_URL = 'https://tp-api.chinadatapay.com:8000'

export type JsonRecord = Record<string, unknown>

const TOPENROUTER_DEFAULT_TIMEOUT_MS = 60_000

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

export function buildTopenrouterUrl(baseUrl: string | undefined, path: string): string {
  const base = (readString(baseUrl) || TOPENROUTER_DEFAULT_BASE_URL).replace(/\/+$/, '')
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return `${base}${normalizedPath}`
}

function errorMessage(payload: unknown, fallback: string): string {
  const error = asRecord(asRecord(payload)?.error)
  return sanitizePublicError(readString(error?.message) || fallback)
}

async function readJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text().catch(() => '')
  if (!text) return {}
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new Error(`TOPENROUTER_RESPONSE_INVALID_JSON: HTTP ${response.status}`)
  }
}

export async function requestTopenrouter(input: {
  apiKey: string
  baseUrl?: string
  path: string
  method: 'GET' | 'POST'
  body?: Record<string, unknown>
  timeoutMs?: number
  signal?: AbortSignal
}): Promise<unknown> {
  const response = await fetch(buildTopenrouterUrl(input.baseUrl, input.path), {
    method: input.method,
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      ...(input.body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(input.body ? { body: JSON.stringify(input.body) } : {}),
    signal: input.signal || AbortSignal.timeout(input.timeoutMs || TOPENROUTER_DEFAULT_TIMEOUT_MS),
  })
  const payload = await readJsonResponse(response)
  if (!response.ok) {
    throw new Error(`TOPENROUTER_HTTP_ERROR(${response.status}): ${errorMessage(payload, response.statusText || 'request failed')}`)
  }
  return payload
}
