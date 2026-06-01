import { Prisma, type VideoEnhanceTask } from '@prisma/client'

export interface SerializedVideoEnhanceTask {
  id: string
  sourceType: string
  name: string
  fileSize: string | null
  size: number | null
  sourceUrl: string | null
  taskId: string | null
  requestId: string | null
  status: string
  result: unknown
  resultStorageKey: string | null
  parameters: unknown
  error: string | null
  inputVideoUrl: string | null
  storageKey: string | null
  uploadedAt: string | null
  finishedAt: string | null
  lastCheckedAt: string | null
  createdAt: string
  updatedAt: string
}

export function toIsoString(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null
}

export function toNumberOrNull(value: string | null): number | null {
  if (!value) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function withResultVideoUrl(result: Prisma.JsonValue | null, videoUrl: string | null): unknown {
  if (!videoUrl || !result || Array.isArray(result) || typeof result !== 'object') return result
  return { ...result, videoUrl }
}

export function serializeVideoEnhanceTask(task: VideoEnhanceTask, resultVideoUrl?: string | null): SerializedVideoEnhanceTask {
  const effectiveResultVideoUrl = resultVideoUrl || task.resultVideoUrl
  return {
    id: task.id,
    sourceType: task.sourceType,
    name: task.name,
    fileSize: task.fileSize,
    size: toNumberOrNull(task.fileSize),
    sourceUrl: task.sourceUrl,
    taskId: task.mediaKitTaskId,
    requestId: task.requestId,
    status: task.status,
    result: withResultVideoUrl(task.result, effectiveResultVideoUrl),
    resultStorageKey: task.resultStorageKey,
    parameters: task.parameters,
    error: task.errorMessage,
    inputVideoUrl: task.inputVideoUrl,
    storageKey: task.storageKey,
    uploadedAt: toIsoString(task.uploadedAt),
    finishedAt: toIsoString(task.finishedAt),
    lastCheckedAt: toIsoString(task.lastCheckedAt),
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
  }
}

export function parseMediaKitTimestamp(value: number | null | undefined): Date | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null
  return new Date(value > 10_000_000_000 ? value : value * 1000)
}

export function getTerminalFinishedAt(status: string, upstreamFinishedAt?: number | null): Date | null {
  const normalized = status.toLowerCase()
  if (normalized !== 'completed' && normalized !== 'failed' && normalized !== 'cancelled' && normalized !== 'canceled') {
    return null
  }
  return parseMediaKitTimestamp(upstreamFinishedAt) || new Date()
}

export function toNullableJson(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (value === null || value === undefined) return Prisma.JsonNull
  return value as Prisma.InputJsonValue
}
