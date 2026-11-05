import { sanitizePublicError } from '@/lib/errors/sanitize-public-error'
import { normalizeTaskError } from '@/lib/errors/normalize'

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export function publicGenerationTaskId(externalId: unknown): string | null {
  const value = text(externalId)
  if (!value) return null
  if (value.startsWith('KUAIZI:')) {
    const parts = value.split(':')
    const type = parts[1]
    if (
      (type !== 'VIDEO' && type !== 'IMAGE' && type !== 'AUDIO')
      || !parts[2]?.trim() || !parts[3]?.trim()
    ) return null
    return text(parts.slice(4).join(':'))
  }
  if (/^[A-Z][A-Z0-9_]*:/.test(value)) return null
  return value
}

export function publicTaskError(code: string | null, message: string | null) {
  const error = normalizeTaskError(
    code ? sanitizePublicError(code) : null,
    message ? sanitizePublicError(message) : null,
  )
  if (!error) return null
  return {
    ...error,
    message: sanitizePublicError(error.message),
    provider: null,
    details: error.details
      ? JSON.parse(sanitizePublicError(JSON.stringify(error.details))) as Record<string, unknown>
      : null,
  }
}

function sanitizePayload(value: unknown, key?: string): unknown {
  if (key === 'externalId') return null
  if (typeof value === 'string') {
    return /^(?:image|video|audio)Url$/i.test(key || '')
      ? value
      : sanitizePublicError(value)
  }
  if (Array.isArray(value)) return value.map((item) => sanitizePayload(item))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([childKey, item]) => [
      childKey,
      sanitizePayload(item, childKey),
    ]))
  }
  return value
}

export function serializePublicTask<T extends {
  externalId: string | null
  errorCode: string | null
  errorMessage: string | null
  payload?: unknown
  result?: unknown
}>(task: T): Omit<T, 'externalId' | 'errorCode' | 'errorMessage' | 'payload' | 'result'> & {
  externalId?: undefined
  cgtid: string | null
  payload?: unknown
  result?: unknown
  errorCode: string | null
  errorMessage: string | null
  error: ReturnType<typeof publicTaskError>
} {
  const error = publicTaskError(task.errorCode, task.errorMessage)
  return {
    ...task,
    externalId: undefined,
    cgtid: publicGenerationTaskId(task.externalId),
    ...(task.payload !== undefined ? { payload: sanitizePayload(task.payload) } : {}),
    ...(task.result !== undefined ? { result: sanitizePayload(task.result) } : {}),
    errorCode: error?.code || null,
    errorMessage: error?.message || null,
    error,
  }
}

export function sanitizePublicCanvasData(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizePublicCanvasData)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    if (key === 'externalId' || key === 'externalTaskId') {
      return [key, key === 'externalTaskId' ? publicGenerationTaskId(item) : null]
    }
    if (key === 'errorMessage' || key === 'pollErrorMessage') {
      return [key, typeof item === 'string' ? sanitizePublicError(item) : item]
    }
    return [key, sanitizePublicCanvasData(item)]
  }))
}

export function sanitizePublicLifecycleEvent<T extends { payload?: unknown }>(event: T): T {
  return {
    ...event,
    ...(event.payload !== undefined ? { payload: sanitizePayload(event.payload) } : {}),
  }
}
