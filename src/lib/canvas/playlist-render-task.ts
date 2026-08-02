import type { CanvasPlaylistRenderSummary } from '@/features/canvas/types'
import { normalizeTaskError } from '@/lib/errors/normalize'
import { TASK_STATUS } from '@/lib/task/types'

export type CanvasPlaylistRenderSegment = {
  clipId: string
  title: string
  storageKey: string
  trimStartMs: number
  trimEndMs: number
}

export type CanvasPlaylistRenderTaskPayload = {
  kind: 'canvas_playlist_render'
  canvasId: string
  nodeId: string
  title: string
  fingerprint: string
  durationMs: number
  segments: CanvasPlaylistRenderSegment[]
}

type TaskRow = {
  id: string
  status: string
  progress: number
  payload: unknown
  result: unknown
  errorCode: string | null
  errorMessage: string | null
  finishedAt: Date | null
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function text(value: unknown, maximum = 2_000) {
  return typeof value === 'string' ? value.trim().slice(0, maximum) : ''
}

function milliseconds(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : null
}

export function parseCanvasPlaylistRenderTaskPayload(value: unknown): CanvasPlaylistRenderTaskPayload | null {
  const row = record(value)
  if (!row || row.kind !== 'canvas_playlist_render' || !Array.isArray(row.segments)) return null
  const canvasId = text(row.canvasId, 191)
  const nodeId = text(row.nodeId, 191)
  const title = text(row.title, 191) || '播放列表'
  const fingerprint = text(row.fingerprint, 128)
  const durationMs = milliseconds(row.durationMs)
  const segments = row.segments.map((entry, index) => {
    const segment = record(entry)
    const trimStartMs = milliseconds(segment?.trimStartMs)
    const trimEndMs = milliseconds(segment?.trimEndMs)
    const storageKey = text(segment?.storageKey)
    if (!segment || !storageKey || trimStartMs == null || trimEndMs == null || trimEndMs <= trimStartMs) return null
    return {
      clipId: text(segment.clipId, 191) || `clip-${index + 1}`,
      title: text(segment.title, 191) || `视频 ${index + 1}`,
      storageKey,
      trimStartMs,
      trimEndMs,
    }
  })
  if (!canvasId || !nodeId || !fingerprint || durationMs == null || segments.length === 0 || segments.some((item) => !item)) return null
  return { kind: 'canvas_playlist_render', canvasId, nodeId, title, fingerprint, durationMs, segments: segments as CanvasPlaylistRenderSegment[] }
}

export function serializeCanvasPlaylistRenderTask(task: TaskRow | null, expectedFingerprint: string): CanvasPlaylistRenderSummary {
  if (!task) {
    return { taskId: null, fingerprint: expectedFingerprint, status: 'draft', progress: 0, outputUrl: null, materialId: null, durationMs: null, completedAt: null, errorMessage: null }
  }
  const payload = parseCanvasPlaylistRenderTaskPayload(task.payload)
  const result = record(task.result)
  const error = normalizeTaskError(task.errorCode, task.errorMessage)
  const status = task.status === TASK_STATUS.QUEUED
    ? 'queued'
    : task.status === TASK_STATUS.PROCESSING
      ? 'processing'
      : task.status === TASK_STATUS.COMPLETED
        ? 'completed'
        : task.status === TASK_STATUS.CANCELED
          ? 'canceled'
          : 'failed'
  return {
    taskId: task.id,
    fingerprint: payload?.fingerprint || expectedFingerprint,
    status,
    progress: task.progress,
    outputUrl: text(result?.outputUrl) || null,
    materialId: text(result?.materialId, 191) || null,
    durationMs: milliseconds(result?.durationMs),
    completedAt: task.finishedAt?.toISOString() || null,
    errorMessage: error?.message || null,
  }
}
