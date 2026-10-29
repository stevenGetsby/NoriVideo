export interface EnhanceTaskResult {
  videoUrl: string | null
  duration: number | null
  fps: number | null
  resolution: string | null
  toolVersion: string | null
}

export interface VideoEnhanceRecord {
  id: string
  sourceType: string
  name: string
  fileSize: string | null
  size: number | null
  sourceUrl: string | null
  taskId: string | null
  requestId: string | null
  status: string
  result: EnhanceTaskResult | null
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

export interface VideoEnhanceHistoryResponse {
  success: boolean
  tasks: VideoEnhanceRecord[]
}

export const STATUS_LABELS: Record<string, string> = {
  ready: '待提交',
  submitting: '提交中',
  submitted: '已提交',
  queued: '排队中',
  pending: '排队中',
  running: '处理中',
  processing: '处理中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
  canceled: '已取消',
  unknown: '未知',
}

export function isTerminalStatus(status: string): boolean {
  const normalized = status.toLowerCase()
  return normalized === 'completed' || normalized === 'failed' || normalized === 'cancelled' || normalized === 'canceled'
}

export function statusTone(status: string): string {
  const normalized = status.toLowerCase()
  if (normalized === 'completed') return 'text-[var(--glass-tone-success-fg)] bg-[var(--glass-tone-success-bg)] border-[var(--glass-tone-success-fg)]/25'
  if (normalized === 'failed' || normalized === 'cancelled' || normalized === 'canceled') return 'text-[var(--glass-tone-danger-fg)] bg-[var(--glass-tone-danger-bg)] border-[var(--glass-tone-danger-fg)]/25'
  return 'text-[var(--glass-text-secondary)] bg-[var(--glass-bg-surface)] border-[var(--glass-stroke-base)]'
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

export function formatSeconds(seconds: number | null): string {
  if (typeof seconds !== 'number') return '-'
  const minutes = Math.floor(seconds / 60)
  const rest = Math.round(seconds % 60)
  return minutes > 0 ? `${minutes}m ${rest}s` : `${rest}s`
}

export function formatDateTime(value: string | null): string {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function sanitizeFileName(value: string): string {
  const cleaned = value.trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ')
  return cleaned || 'enhanced-video'
}

export function resultFileName(record: VideoEnhanceRecord): string {
  const rawName = record.name.split('?')[0] || 'enhanced-video'
  const withoutExt = rawName.replace(/\.[a-z0-9]{2,5}$/i, '')
  return `${sanitizeFileName(withoutExt)}-enhanced.mp4`
}

export function isDownloadable(record: VideoEnhanceRecord): boolean {
  return record.status.toLowerCase() === 'completed' && Boolean(record.result?.videoUrl)
}

export function resultDownloadUrl(record: VideoEnhanceRecord): string | null {
  if (record.taskId) return `/api/video-enhance/${encodeURIComponent(record.taskId)}/download`
  return record.result?.videoUrl || null
}

export function downloadWithAnchor(url: string, fileName: string) {
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.rel = 'noreferrer'
  anchor.target = '_blank'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
}

export function makeUniqueDownloadName(fileName: string, usedNames: Set<string>): string {
  const normalized = sanitizeFileName(fileName)
  const extensionIndex = normalized.lastIndexOf('.')
  const baseName = extensionIndex > 0 ? normalized.slice(0, extensionIndex) : normalized
  const extension = extensionIndex > 0 ? normalized.slice(extensionIndex) : ''
  let candidate = normalized
  let index = 2
  while (usedNames.has(candidate)) {
    candidate = `${baseName}-${index}${extension}`
    index += 1
  }
  usedNames.add(candidate)
  return candidate
}
