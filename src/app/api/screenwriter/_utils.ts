import { NextRequest } from 'next/server'
import { ApiError } from '@/lib/api-errors'

export function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function readOptionalString(value: unknown): string | undefined {
  const text = readString(value)
  return text || undefined
}

export async function readJsonObject(request: NextRequest) {
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ApiError('INVALID_PARAMS')
  }
  return body as Record<string, unknown>
}

export function parsePositiveInt(value: string | null, fallback: number) {
  const parsed = Number.parseInt(value || '', 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.floor(parsed)
}

export function ensureFound<T>(value: T | null | undefined): T {
  if (!value) throw new ApiError('NOT_FOUND')
  return value
}

export function normalizeCheckpoints(value: unknown): Record<'A' | 'B', boolean> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { A: true, B: true }
  }
  const raw = value as { A?: unknown; B?: unknown }
  return {
    A: raw.A !== false,
    B: raw.B !== false,
  }
}
