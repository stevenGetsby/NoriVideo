'use client'

import { type ChangeEvent, type DragEvent as ReactDragEvent, type MouseEvent as ReactMouseEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSession } from 'next-auth/react'
import Navbar from '@/components/Navbar'
import { AppIcon, IconGradientDefs } from '@/components/ui/icons'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { useRouter } from '@/i18n/navigation'
import { apiFetch } from '@/lib/api-fetch'
import { readApiErrorMessage } from '@/lib/api/read-error-message'
import { normalizeVideoEnhanceSettings } from '@/lib/video-enhance/settings'

type SourceMode = 'file' | 'url'
type ResolutionMode = 'preset' | 'limit' | 'original'
type SubmitPhase = 'idle' | 'submitting' | 'polling'
type QueueSourceType = 'file' | 'url'

interface EnhanceTaskResult {
  videoUrl: string | null
  duration: number | null
  fps: number | null
  resolution: string | null
  toolVersion: string | null
}

interface EnhanceTask {
  taskId: string
  requestId: string | null
  status: string
  taskType?: string | null
  result: EnhanceTaskResult | null
  record?: VideoEnhanceRecord | null
  expiresAt?: number | null
  createdAt?: number | null
  finishedAt?: number | string | null
  uploadedAt?: string | null
}

interface SubmitResponse {
  success: boolean
  taskId: string
  requestId: string | null
  record?: VideoEnhanceRecord
  input?: {
    videoUrl?: string
    storageKey?: string | null
    localInputWarning?: boolean
  }
}

interface VideoEnhanceRecord {
  id: string
  sourceType: QueueSourceType | string
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

interface VideoEnhanceHistoryResponse {
  success: boolean
  tasks: VideoEnhanceRecord[]
}

interface EnhanceQueueItem {
  id: string
  recordId: string | null
  sourceType: QueueSourceType
  name: string
  file?: File
  sourceUrl?: string
  size?: number
  taskId: string | null
  requestId: string | null
  status: string
  result: EnhanceTaskResult | null
  error: string | null
  inputVideoUrl: string | null
  storageKey: string | null
  lastCheckedAt: Date | null
  uploadedAt: string | null
  finishedAt: string | null
}

interface QueueSource {
  id: string
  sourceType: QueueSourceType
  name: string
  file?: File
  sourceUrl?: string
  size?: number
}

interface BrowserFileHandle {
  createWritable: (options?: { keepExistingData?: boolean }) => Promise<{
    write: (data: Blob | Uint8Array) => Promise<void>
    close: () => Promise<void>
  }>
}

type WindowWithSavePicker = Window & {
  showSaveFilePicker?: (options: {
    suggestedName?: string
    types?: Array<{
      description: string
      accept: Record<string, string[]>
    }>
  }) => Promise<BrowserFileHandle>
}

interface BrowserDirectoryHandle {
  name?: string
  queryPermission?: (options?: { mode?: 'read' | 'readwrite' }) => Promise<PermissionState>
  requestPermission?: (options?: { mode?: 'read' | 'readwrite' }) => Promise<PermissionState>
  getFileHandle: (name: string, options?: { create?: boolean }) => Promise<BrowserFileHandle>
}

type WindowWithDirectoryPicker = Window & {
  showDirectoryPicker?: (options?: { id?: string; mode?: 'read' | 'readwrite'; startIn?: 'desktop' | 'documents' | 'downloads' | 'music' | 'pictures' | 'videos' }) => Promise<BrowserDirectoryHandle>
}

const DEFAULT_BATCH_CONCURRENCY = 3
const MAX_BATCH_CONCURRENCY = 8
const SUPPORTED_VIDEO_EXTENSIONS = new Set(['mp4', 'flv', 'ts', 'avi', 'mov', 'wmv', 'mkv', 'webm'])
const VIDEO_ENHANCE_SETTINGS_KEY = 'nori.videoEnhance.settings.v1'
const VIDEO_ENHANCE_DOWNLOAD_PATH_MIGRATION_KEY = 'nori.videoEnhance.downloadPathDefaultCleared.v1'
const LEGACY_DEFAULT_DOWNLOAD_DIRECTORY = '~/Downloads/NoriVideo'
const DOWNLOAD_DIRECTORY_HELP_TEXT = '请选择普通空文件夹或新建文件夹，例如 D:\\NoriVideoDownloads。不要选择盘符根目录、Windows、System32、Program Files 等系统目录。'

const STATUS_LABELS: Record<string, string> = {
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

const SCENE_OPTIONS = [
  { value: 'common', label: '通用' },
  { value: 'aigc', label: 'AIGC' },
  { value: 'ugc', label: 'UGC 短视频' },
  { value: 'short_series', label: '短剧' },
  { value: 'old_film', label: '老片修复' },
]

const RESOLUTION_OPTIONS = ['720p', '1080p', '2k', '4k', '240p', '360p', '480p', '540p']

function isTerminalStatus(status: string): boolean {
  const normalized = status.toLowerCase()
  return normalized === 'completed' || normalized === 'failed' || normalized === 'cancelled' || normalized === 'canceled'
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function formatSeconds(seconds: number | null): string {
  if (typeof seconds !== 'number') return '-'
  const minutes = Math.floor(seconds / 60)
  const rest = Math.round(seconds % 60)
  return minutes > 0 ? `${minutes}m ${rest}s` : `${rest}s`
}

function formatDateTime(value: string | null): string {
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

function normalizeDateString(value: string | number | null | undefined): string | null {
  if (!value) return null
  if (typeof value === 'number') {
    const date = new Date(value > 10_000_000_000 ? value : value * 1000)
    return Number.isNaN(date.getTime()) ? null : date.toISOString()
  }
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function statusTone(status: string): string {
  const normalized = status.toLowerCase()
  if (normalized === 'completed') return 'text-[var(--glass-tone-success-fg)] bg-[var(--glass-tone-success-bg)] border-[var(--glass-tone-success-fg)]/25'
  if (normalized === 'failed' || normalized === 'cancelled' || normalized === 'canceled') return 'text-[var(--glass-tone-danger-fg)] bg-[var(--glass-tone-danger-bg)] border-[var(--glass-tone-danger-fg)]/25'
  if (normalized === 'ready') return 'text-[var(--glass-text-secondary)] bg-[var(--glass-bg-surface)] border-[var(--glass-stroke-base)]'
  return 'text-[var(--glass-tone-info-fg)] bg-[var(--glass-tone-info-bg)] border-[var(--glass-tone-info-fg)]/25'
}

function parseVideoUrls(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}

function createQueueItemId(index: number): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `enhance-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`
}

function buildBatchClientToken(baseToken: string, index: number, total: number): string {
  const trimmed = baseToken.trim()
  if (!trimmed) return ''
  if (total <= 1) return trimmed
  const suffix = `-${index + 1}`
  return `${trimmed.slice(0, Math.max(0, 64 - suffix.length))}${suffix}`
}

function queueItemFromSource(source: QueueSource): EnhanceQueueItem {
  return {
    ...source,
    recordId: null,
    taskId: null,
    requestId: null,
    status: 'ready',
    result: null,
    error: null,
    inputVideoUrl: source.sourceUrl || null,
    storageKey: null,
    lastCheckedAt: null,
    uploadedAt: null,
    finishedAt: null,
  }
}

function queueItemFromRecord(record: VideoEnhanceRecord): EnhanceQueueItem {
  return {
    id: record.id,
    recordId: record.id,
    sourceType: record.sourceType === 'url' ? 'url' : 'file',
    name: record.name,
    sourceUrl: record.sourceUrl || undefined,
    size: record.size || undefined,
    taskId: record.taskId,
    requestId: record.requestId,
    status: record.status,
    result: record.result,
    error: record.error,
    inputVideoUrl: record.inputVideoUrl,
    storageKey: record.storageKey,
    lastCheckedAt: record.lastCheckedAt ? new Date(record.lastCheckedAt) : null,
    uploadedAt: record.uploadedAt,
    finishedAt: record.finishedAt,
  }
}

function clampSubmitConcurrency(value: string, total: number): number {
  const parsed = Number.parseInt(value, 10)
  const normalized = Number.isFinite(parsed) ? parsed : DEFAULT_BATCH_CONCURRENCY
  return Math.min(Math.max(normalized, 1), Math.min(MAX_BATCH_CONCURRENCY, Math.max(total, 1)))
}

function sanitizeFileName(value: string): string {
  const cleaned = value.trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ')
  return cleaned || 'enhanced-video'
}

function resultFileName(item: EnhanceQueueItem): string {
  const rawName = item.name.split('?')[0] || 'enhanced-video'
  const withoutExt = rawName.replace(/\.[a-z0-9]{2,5}$/i, '')
  return `${sanitizeFileName(withoutExt)}-enhanced.mp4`
}

function downloadWithAnchor(url: string, fileName: string) {
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.rel = 'noreferrer'
  anchor.target = '_blank'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
}

function downloadBytesWithAnchor(data: Uint8Array, fileName: string) {
  const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
  const blob = new Blob([buffer], { type: 'video/mp4' })
  const url = URL.createObjectURL(blob)
  downloadWithAnchor(url, fileName)
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function isSupportedVideoFile(file: File): boolean {
  if (file.type.startsWith('video/')) return true
  const extension = file.name.split('.').pop()?.toLowerCase()
  return !!extension && SUPPORTED_VIDEO_EXTENSIONS.has(extension)
}

function fileIdentity(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`
}

function mergeUniqueFiles(current: File[], incoming: File[]): File[] {
  const seen = new Set(current.map(fileIdentity))
  const next = [...current]
  for (const file of incoming) {
    const identity = fileIdentity(file)
    if (seen.has(identity)) continue
    seen.add(identity)
    next.push(file)
  }
  return next
}

function makeUniqueDownloadName(fileName: string, usedNames: Set<string>): string {
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

async function ensureDirectoryPermission(handle: BrowserDirectoryHandle): Promise<boolean> {
  const options = { mode: 'readwrite' as const }
  if (!handle.queryPermission || !handle.requestPermission) return true
  if (await handle.queryPermission(options) === 'granted') return true
  return await handle.requestPermission(options) === 'granted'
}

function isFilePickerAlreadyActiveError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === 'InvalidStateError') return true
  return error instanceof Error && error.message.includes('File picker already active')
}

function isDirectoryWriteBlockedError(error: unknown): boolean {
  if (error instanceof DOMException) {
    return error.name === 'NotAllowedError' || error.name === 'SecurityError'
  }
  if (!(error instanceof Error)) return false
  return error.message.includes('getFileHandle') || error.message.includes('not allowed') || error.message.includes('permission')
}

function formatDownloadFailure(error: unknown): string {
  if (error instanceof DOMException) return `${error.name}: ${error.message}`
  if (error instanceof Error) return error.message
  return '未知错误'
}

async function writeBytesToDirectory(directoryHandle: BrowserDirectoryHandle, fileName: string, data: Uint8Array) {
  try {
    const fileHandle = await directoryHandle.getFileHandle(fileName, { create: true })
    const writable = await fileHandle.createWritable({ keepExistingData: false })
    await writable.write(data)
    await writable.close()
  } catch (error) {
    if (isDirectoryWriteBlockedError(error)) {
      const allowed = await ensureDirectoryPermission(directoryHandle).catch(() => false)
      if (allowed) {
        const fileHandle = await directoryHandle.getFileHandle(fileName, { create: true })
        const writable = await fileHandle.createWritable({ keepExistingData: false })
        await writable.write(data)
        await writable.close()
        return
      }
    }
    throw error
  }
}

async function saveBytesWithPicker(data: Uint8Array, fileName: string) {
  const picker = (window as WindowWithSavePicker).showSaveFilePicker
  if (!picker) {
    downloadBytesWithAnchor(data, fileName)
    return
  }

  const handle = await picker({
    suggestedName: fileName,
    types: [{ description: 'MP4 Video', accept: { 'video/mp4': ['.mp4'] } }],
  })
  const writable = await handle.createWritable({ keepExistingData: false })
  await writable.write(data)
  await writable.close()
}

export default function VideoEnhanceClient() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [sourceMode, setSourceMode] = useState<SourceMode>('file')
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [videoUrls, setVideoUrls] = useState('')
  const [toolVersion, setToolVersion] = useState<'standard' | 'professional'>('standard')
  const [scene, setScene] = useState('aigc')
  const [resolutionMode, setResolutionMode] = useState<ResolutionMode>('preset')
  const [resolution, setResolution] = useState('1080p')
  const [resolutionLimit, setResolutionLimit] = useState('')
  const [fps, setFps] = useState('')
  const [clientToken, setClientToken] = useState('')
  const [callbackArgs, setCallbackArgs] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [queueItems, setQueueItems] = useState<EnhanceQueueItem[]>([])
  const [activeItemId, setActiveItemId] = useState<string | null>(null)
  const [phase, setPhase] = useState<SubmitPhase>('idle')
  const [error, setError] = useState<string | null>(null)
  const [warning, setWarning] = useState<string | null>(null)
  const [submitConcurrency, setSubmitConcurrency] = useState(String(DEFAULT_BATCH_CONCURRENCY))
  const [downloadDirectoryPath, setDownloadDirectoryPath] = useState('')
  const [browserDownloadDirectoryName, setBrowserDownloadDirectoryName] = useState<string | null>(null)
  const [selectingDownloadDirectory, setSelectingDownloadDirectory] = useState(false)
  const [savingResult, setSavingResult] = useState(false)
  const [isFileDragActive, setIsFileDragActive] = useState(false)
  const [downloadingBatchResults, setDownloadingBatchResults] = useState(false)
  const [batchDownloadProgress, setBatchDownloadProgress] = useState<string | null>(null)
  const [selectedDownloadIds, setSelectedDownloadIds] = useState<Set<string>>(() => new Set())
  const [historyLoading, setHistoryLoading] = useState(false)
  const [settingsLoaded, setSettingsLoaded] = useState(false)
  const directoryPickerActiveRef = useRef(false)
  const browserDownloadDirectoryHandleRef = useRef<BrowserDirectoryHandle | null>(null)

  useEffect(() => {
    if (status === 'loading') return
    if (!session) router.push({ pathname: '/auth/signin' })
  }, [session, status, router])

  const applyPersistedSettings = useCallback((value: unknown) => {
    const settings = normalizeVideoEnhanceSettings(value)
    setSourceMode(settings.sourceMode)
    setToolVersion(settings.toolVersion)
    setScene(settings.scene)
    setResolutionMode(settings.resolutionMode)
    setResolution(settings.resolution)
    setResolutionLimit(settings.resolutionLimit)
    setFps(settings.fps)
    setShowAdvanced(settings.showAdvanced)
    setSubmitConcurrency(settings.submitConcurrency)
    if (
      value
      && typeof value === 'object'
      && !Array.isArray(value)
      && Object.prototype.hasOwnProperty.call(value, 'videoUrlsDraft')
    ) {
      setVideoUrls(settings.videoUrlsDraft)
    }
  }, [])

  useEffect(() => {
    if (status === 'loading') return
    let cancelled = false
    setSettingsLoaded(false)

    void (async () => {
      try {
        const raw = window.localStorage.getItem(VIDEO_ENHANCE_SETTINGS_KEY)
        if (raw) {
          const parsed = JSON.parse(raw) as Record<string, unknown>
          applyPersistedSettings(parsed)
          if (typeof parsed.videoUrls === 'string') setVideoUrls(parsed.videoUrls)
          if (typeof parsed.clientToken === 'string') setClientToken(parsed.clientToken)
          if (typeof parsed.callbackArgs === 'string') setCallbackArgs(parsed.callbackArgs)
          if (typeof parsed.downloadDirectoryPath === 'string') {
            const shouldClearLegacyDefault = parsed.downloadDirectoryPath === LEGACY_DEFAULT_DOWNLOAD_DIRECTORY
              && window.localStorage.getItem(VIDEO_ENHANCE_DOWNLOAD_PATH_MIGRATION_KEY) !== '1'
            setDownloadDirectoryPath(shouldClearLegacyDefault ? '' : parsed.downloadDirectoryPath)
            if (shouldClearLegacyDefault) window.localStorage.setItem(VIDEO_ENHANCE_DOWNLOAD_PATH_MIGRATION_KEY, '1')
          }
        }
      } catch {
        window.localStorage.removeItem(VIDEO_ENHANCE_SETTINGS_KEY)
      }

      if (status === 'authenticated') {
        try {
          const response = await apiFetch('/api/user-preference')
          if (response.ok) {
            const data = await response.json() as {
              preference?: { videoEnhanceSettings?: unknown } | null
            }
            if (!cancelled && data.preference?.videoEnhanceSettings) {
              applyPersistedSettings(data.preference.videoEnhanceSettings)
            }
          }
        } catch {
          // Keep browser settings when account preferences are unavailable.
        }
      }

      if (!cancelled) setSettingsLoaded(true)
    })()

    return () => { cancelled = true }
  }, [applyPersistedSettings, status])

  useEffect(() => {
    if (!settingsLoaded) return
    const localSettings = {
      sourceMode,
      videoUrls,
      toolVersion,
      scene,
      resolutionMode,
      resolution,
      resolutionLimit,
      fps,
      videoUrlsDraft: videoUrls,
      clientToken,
      callbackArgs,
      showAdvanced,
      submitConcurrency,
      downloadDirectoryPath,
    }
    window.localStorage.setItem(VIDEO_ENHANCE_SETTINGS_KEY, JSON.stringify(localSettings))
    if (status !== 'authenticated') return

    const timer = window.setTimeout(() => {
      void apiFetch('/api/user-preference', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoEnhanceSettings: normalizeVideoEnhanceSettings(localSettings),
        }),
      }).catch(() => undefined)
    }, 500)

    return () => window.clearTimeout(timer)
  }, [callbackArgs, clientToken, downloadDirectoryPath, fps, resolution, resolutionLimit, resolutionMode, scene, settingsLoaded, showAdvanced, sourceMode, status, submitConcurrency, toolVersion, videoUrls])

  useEffect(() => {
    if (status !== 'authenticated' || !session) return
    let cancelled = false
    setHistoryLoading(true)
    void (async () => {
      try {
        const response = await apiFetch('/api/video-enhance?limit=100')
        if (!response.ok) throw new Error(await readApiErrorMessage(response, '读取历史记录失败'))
        const payload = await response.json() as VideoEnhanceHistoryResponse
        if (cancelled) return
        const items = (payload.tasks || []).map(queueItemFromRecord)
        setQueueItems(items)
        setActiveItemId(items[0]?.id || null)
        setPhase(items.some((item) => item.taskId && !isTerminalStatus(item.status)) ? 'polling' : 'idle')
      } catch (historyError) {
        if (!cancelled) setWarning(historyError instanceof Error ? historyError.message : '读取历史记录失败')
      } finally {
        if (!cancelled) setHistoryLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [session, status])

  const parsedUrls = useMemo(() => parseVideoUrls(videoUrls), [videoUrls])
  const inputCount = sourceMode === 'file' ? selectedFiles.length : parsedUrls.length
  const activeItem = useMemo(
    () => queueItems.find((item) => item.id === activeItemId) || queueItems[0] || null,
    [activeItemId, queueItems],
  )
  const completedResultItems = useMemo(
    () => queueItems.filter((item) => item.status.toLowerCase() === 'completed' && item.result?.videoUrl),
    [queueItems],
  )
  const selectedCompletedResultItems = useMemo(
    () => completedResultItems.filter((item) => selectedDownloadIds.has(item.id)),
    [completedResultItems, selectedDownloadIds],
  )
  const batchDownloadTargetItems = selectedCompletedResultItems.length > 0 ? selectedCompletedResultItems : completedResultItems

  useEffect(() => {
    const downloadableIds = new Set(completedResultItems.map((item) => item.id))
    setSelectedDownloadIds((current) => {
      const next = new Set(Array.from(current).filter((id) => downloadableIds.has(id)))
      return next.size === current.size ? current : next
    })
  }, [completedResultItems])
  const previewFile = activeItem?.file || (sourceMode === 'file' ? selectedFiles[0] : null)
  const previewUrl = useMemo(() => {
    if (!previewFile) return ''
    return URL.createObjectURL(previewFile)
  }, [previewFile])
  const previewSource = previewFile ? previewUrl : activeItem?.sourceUrl || (sourceMode === 'url' ? parsedUrls[0] || '' : '')

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    }
  }, [previewUrl])

  const queueSummary = useMemo(() => {
    const total = queueItems.length
    const completed = queueItems.filter((item) => item.status.toLowerCase() === 'completed').length
    const failed = queueItems.filter((item) => item.status.toLowerCase() === 'failed').length
    const running = queueItems.filter((item) => item.taskId && !isTerminalStatus(item.status)).length
    return { total, completed, failed, running }
  }, [queueItems])

  const canSubmit = phase === 'idle' && inputCount > 0

  const addVideoFiles = useCallback((files: File[], append: boolean) => {
    if (files.length === 0) return
    const videoFiles = files.filter(isSupportedVideoFile)
    const ignoredCount = files.length - videoFiles.length

    if (videoFiles.length === 0) {
      setWarning('未发现支持的视频文件，请选择 mp4、flv、ts、avi、mov、wmv、mkv 或 webm。')
      return
    }

    setSelectedFiles((current) => append ? mergeUniqueFiles(current, videoFiles) : videoFiles)
    setError(null)
    setWarning(ignoredCount > 0 ? `已忽略 ${ignoredCount} 个非视频文件。` : null)
  }, [])

  const handleFileInputChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    addVideoFiles(Array.from(event.target.files || []), false)
    event.target.value = ''
  }, [addVideoFiles])

  const handleFileDragEnter = useCallback((event: ReactDragEvent<HTMLLabelElement>) => {
    event.preventDefault()
    event.stopPropagation()
    if (Array.from(event.dataTransfer.types).includes('Files')) {
      setIsFileDragActive(true)
    }
  }, [])

  const handleFileDragOver = useCallback((event: ReactDragEvent<HTMLLabelElement>) => {
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'copy'
    if (Array.from(event.dataTransfer.types).includes('Files')) {
      setIsFileDragActive(true)
    }
  }, [])

  const handleFileDragLeave = useCallback((event: ReactDragEvent<HTMLLabelElement>) => {
    event.preventDefault()
    event.stopPropagation()
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return
    setIsFileDragActive(false)
  }, [])

  const handleFileDrop = useCallback((event: ReactDragEvent<HTMLLabelElement>) => {
    event.preventDefault()
    event.stopPropagation()
    setIsFileDragActive(false)
    addVideoFiles(Array.from(event.dataTransfer.files || []), true)
  }, [addVideoFiles])

  const buildSources = useCallback((): QueueSource[] => {
    if (sourceMode === 'file') {
      return selectedFiles.map((file, index) => ({
        id: createQueueItemId(index),
        sourceType: 'file',
        name: file.name || `视频 ${index + 1}`,
        file,
        size: file.size,
      }))
    }

    return parsedUrls.map((url, index) => ({
      id: createQueueItemId(index),
      sourceType: 'url',
      name: url.split('/').pop()?.split('?')[0] || `URL ${index + 1}`,
      sourceUrl: url,
    }))
  }, [parsedUrls, selectedFiles, sourceMode])

  const appendCommonFormData = useCallback((formData: FormData, index: number, total: number) => {
    formData.append('toolVersion', toolVersion)
    formData.append('scene', scene)
    if (resolutionMode === 'preset') formData.append('resolution', resolution)
    if (resolutionMode === 'limit') formData.append('resolutionLimit', resolutionLimit.trim())
    if (fps.trim()) formData.append('fps', fps.trim())
    const batchToken = buildBatchClientToken(clientToken, index, total)
    if (batchToken) formData.append('clientToken', batchToken)
    if (callbackArgs.trim()) formData.append('callbackArgs', callbackArgs.trim())
  }, [callbackArgs, clientToken, fps, resolution, resolutionLimit, resolutionMode, scene, toolVersion])

  const pollTask = useCallback(async (itemId: string, taskId: string) => {
    setPhase((current) => current === 'submitting' ? current : 'polling')
    try {
      const response = await apiFetch(`/api/video-enhance/${encodeURIComponent(taskId)}`)
      if (!response.ok) {
        throw new Error(await readApiErrorMessage(response, '查询任务失败'))
      }
      const payload = await response.json() as EnhanceTask
      const record = payload.record || null
      setQueueItems((current) => current.map((item) => item.id === itemId ? {
        ...item,
        recordId: record?.id || item.recordId,
        taskId: payload.taskId || taskId,
        requestId: record?.requestId || payload.requestId || item.requestId,
        status: record?.status || payload.status || 'unknown',
        result: record?.result || payload.result,
        error: record?.error || null,
        inputVideoUrl: record?.inputVideoUrl || item.inputVideoUrl,
        storageKey: record?.storageKey || item.storageKey,
        uploadedAt: record?.uploadedAt || item.uploadedAt || payload.uploadedAt || null,
        finishedAt: record?.finishedAt || normalizeDateString(payload.finishedAt) || item.finishedAt,
        lastCheckedAt: record?.lastCheckedAt ? new Date(record.lastCheckedAt) : new Date(),
      } : item))
    } catch (pollError) {
      setQueueItems((current) => current.map((item) => item.id === itemId ? {
        ...item,
        status: 'failed',
        error: pollError instanceof Error ? pollError.message : '查询任务失败',
        lastCheckedAt: new Date(),
      } : item))
    }
  }, [])

  useEffect(() => {
    const runningItems = queueItems.filter((item) => item.taskId && !isTerminalStatus(item.status))
    if (runningItems.length === 0) return
    const timer = window.setInterval(() => {
      runningItems.forEach((item) => {
        if (item.taskId) void pollTask(item.id, item.taskId)
      })
    }, 5000)
    return () => window.clearInterval(timer)
  }, [pollTask, queueItems])

  useEffect(() => {
    if (phase !== 'polling') return
    const hasRunning = queueItems.some((item) => item.taskId && !isTerminalStatus(item.status))
    if (!hasRunning) setPhase('idle')
  }, [phase, queueItems])

  const handleSubmitBatch = async () => {
    if (!canSubmit) return
    const sources = buildSources()
    if (sources.length === 0) return

    const initialItems = sources.map(queueItemFromSource)
    setQueueItems((current) => [...initialItems, ...current])
    setActiveItemId(initialItems[0]?.id || null)
    setError(null)
    setWarning(null)
    setPhase('submitting')

    let submittedCount = 0
    let localInputWarning = false
    let nextSourceIndex = 0
    const workerCount = clampSubmitConcurrency(submitConcurrency, sources.length)

    const submitSource = async (source: QueueSource, index: number) => {
      setQueueItems((current) => current.map((item) => item.id === source.id ? { ...item, status: 'submitting', error: null } : item))

      const formData = new FormData()
      if (source.sourceType === 'file' && source.file) {
        formData.append('file', source.file)
      } else if (source.sourceUrl) {
        formData.append('videoUrl', source.sourceUrl)
      }
      appendCommonFormData(formData, index, sources.length)

      try {
        const response = await apiFetch('/api/video-enhance', {
          method: 'POST',
          body: formData,
        })
        if (!response.ok) {
          throw new Error(await readApiErrorMessage(response, '提交任务失败'))
        }
        const payload = await response.json() as SubmitResponse
        const record = payload.record || null
        submittedCount += 1
        localInputWarning = localInputWarning || !!payload.input?.localInputWarning
        setQueueItems((current) => current.map((item) => item.id === source.id ? {
          ...item,
          recordId: record?.id || item.recordId,
          taskId: payload.taskId,
          requestId: record?.requestId || payload.requestId,
          status: record?.status || 'submitted',
          inputVideoUrl: record?.inputVideoUrl || payload.input?.videoUrl || item.inputVideoUrl,
          storageKey: record?.storageKey || payload.input?.storageKey || null,
          uploadedAt: record?.uploadedAt || new Date().toISOString(),
          finishedAt: record?.finishedAt || null,
          error: null,
          lastCheckedAt: new Date(),
        } : item))
        void pollTask(source.id, payload.taskId)
      } catch (submitError) {
        setQueueItems((current) => current.map((item) => item.id === source.id ? {
          ...item,
          status: 'failed',
          error: submitError instanceof Error ? submitError.message : '提交任务失败',
          lastCheckedAt: new Date(),
        } : item))
      }
    }

    await Promise.all(Array.from({ length: workerCount }, async () => {
      while (nextSourceIndex < sources.length) {
        const index = nextSourceIndex
        nextSourceIndex += 1
        const source = sources[index]
        if (source) await submitSource(source, index)
      }
    }))

    if (localInputWarning) {
      setWarning('部分视频地址指向本机或内网地址，线上 MediaKit 服务可能无法访问。')
    }
    if (submittedCount === 0) {
      setError('本批次没有任务提交成功')
    }
    setPhase(submittedCount > 0 ? 'polling' : 'idle')
  }

  const saveResultVideo = async () => {
    const resultUrl = activeItem?.result?.videoUrl
    if (!activeItem || !resultUrl || savingResult) return
    const fileName = resultFileName(activeItem)
    const picker = (window as WindowWithSavePicker).showSaveFilePicker

    if (!picker) {
      downloadWithAnchor(resultUrl, fileName)
      return
    }

    setSavingResult(true)
    setError(null)
    try {
      const handle = await picker({
        suggestedName: fileName,
        types: [{ description: 'MP4 Video', accept: { 'video/mp4': ['.mp4'] } }],
      })
      const response = await fetch(resultUrl)
      if (!response.ok) {
        throw new Error(`下载失败：HTTP ${response.status}`)
      }
      const blob = await response.blob()
      const writable = await handle.createWritable()
      await writable.write(blob)
      await writable.close()
    } catch (saveError) {
      if (saveError instanceof DOMException && saveError.name === 'AbortError') return
      setError(saveError instanceof Error ? saveError.message : '保存文件失败')
    } finally {
      setSavingResult(false)
    }
  }

  const selectDownloadDirectory = async () => {
    if (selectingDownloadDirectory) return
    setSelectingDownloadDirectory(true)
    setError(null)
    setWarning(null)
    try {
      const picker = (window as WindowWithDirectoryPicker).showDirectoryPicker
      if (picker) {
        const directoryHandle = await picker({ id: 'nori-video-enhance-downloads', mode: 'readwrite', startIn: 'downloads' })
        const allowed = await ensureDirectoryPermission(directoryHandle).catch(() => false)
        if (!allowed) throw new Error(`浏览器未获得目录写入权限。${DOWNLOAD_DIRECTORY_HELP_TEXT}`)
        browserDownloadDirectoryHandleRef.current = directoryHandle
        setBrowserDownloadDirectoryName(directoryHandle.name || '所选目录')
        setDownloadDirectoryPath('')
        return
      }

      const response = await apiFetch('/api/video-enhance/select-directory', { method: 'POST' })
      if (!response.ok) throw new Error(await readApiErrorMessage(response, '打开系统目录选择器失败'))
      const payload = await response.json() as { selected: boolean; directoryPath: string | null }
      if (payload.selected && payload.directoryPath) {
        browserDownloadDirectoryHandleRef.current = null
        setBrowserDownloadDirectoryName(null)
        setDownloadDirectoryPath(payload.directoryPath)
        if (payload.directoryPath === '/app/downloads') {
          setWarning('已使用 Docker 映射目录 /app/downloads，文件会保存到项目 downloads 文件夹。')
        }
      }
    } catch (selectError) {
      if (selectError instanceof DOMException && selectError.name === 'AbortError') return
      const message = selectError instanceof Error ? selectError.message : '打开系统目录选择器失败'
      if (message.includes('用户已取消') || message.includes('用户取消') || message.includes('目录选择已取消')) return
      setError(message)
    } finally {
      setSelectingDownloadDirectory(false)
    }
  }

  const downloadCompletedResults = async () => {
    const targets = batchDownloadTargetItems
    if (targets.length === 0 || downloadingBatchResults) return
    const serverDirectoryPath = downloadDirectoryPath.trim()
    if (serverDirectoryPath) {
      const taskIds = targets.map((item) => item.taskId).filter((taskId): taskId is string => !!taskId)
      if (taskIds.length === 0) {
        setError('没有可保存的已完成任务')
        return
      }

      setDownloadingBatchResults(true)
      setBatchDownloadProgress(`0/${taskIds.length}`)
      setError(null)
      setWarning(null)

      try {
        const response = await apiFetch('/api/video-enhance/save-to-path', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ taskIds, directoryPath: serverDirectoryPath }),
        })
        if (!response.ok) throw new Error(await readApiErrorMessage(response, '保存到指定目录失败'))
        const payload = await response.json() as {
          success: boolean
          directoryPath: string
          savedCount: number
          failedCount: number
          failed?: Array<{ taskId: string; name?: string; error: string }>
        }
        setBatchDownloadProgress(`${payload.savedCount}/${taskIds.length}`)
        if (payload.savedCount === 0) {
          const detail = payload.failed?.[0]?.error ? `首个失败：${payload.failed[0].error}` : ''
          throw new Error(`没有结果成功保存到目录。${detail}`)
        }
        setWarning(payload.failedCount > 0
          ? `已保存 ${payload.savedCount} 个结果到 ${payload.directoryPath}，${payload.failedCount} 个失败。${payload.failed?.[0]?.error || ''}`
          : `已保存 ${payload.savedCount} 个结果到 ${payload.directoryPath}。`)
      } catch (saveError) {
        setError(saveError instanceof Error ? saveError.message : '保存到指定目录失败')
      } finally {
        setDownloadingBatchResults(false)
        setBatchDownloadProgress(null)
      }
      return
    }

    if (directoryPickerActiveRef.current) {
      setWarning(null)
      return
    }
    const picker = (window as WindowWithDirectoryPicker).showDirectoryPicker
    let directoryHandle = browserDownloadDirectoryHandleRef.current
    if (!directoryHandle && !picker) {
      setError('当前浏览器不支持选择下载目录，请使用 Chrome 或 Edge 后再批量下载。')
      return
    }

    directoryPickerActiveRef.current = true

    try {
      if (!directoryHandle) {
        if (!picker) {
          setError('当前浏览器不支持选择下载目录，请使用 Chrome 或 Edge 后再批量下载。')
          return
        }
        directoryHandle = await picker({ id: 'nori-video-enhance-downloads', mode: 'readwrite', startIn: 'downloads' })
        browserDownloadDirectoryHandleRef.current = directoryHandle
        setBrowserDownloadDirectoryName(directoryHandle.name || '所选目录')
      }
      await ensureDirectoryPermission(directoryHandle).catch(() => false)

      setDownloadingBatchResults(true)
      setBatchDownloadProgress(null)
      setError(null)
      setWarning(null)

      const usedNames = new Set<string>()
      const failedNames: string[] = []
      const failureDetails: string[] = []
      let usedSavePickerFallback = false
      let successCount = 0

      for (let index = 0; index < targets.length; index += 1) {
        const item = targets[index]
        setBatchDownloadProgress(`${index + 1}/${targets.length}`)
        try {
          const downloadUrl = item.taskId
            ? `/api/video-enhance/${encodeURIComponent(item.taskId)}/download`
            : item.result?.videoUrl
          if (!downloadUrl) throw new Error('缺少下载地址')
          const response = await fetch(downloadUrl)
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          const data = new Uint8Array(await response.arrayBuffer())
          const fileName = makeUniqueDownloadName(resultFileName(item), usedNames)
          try {
            if (usedSavePickerFallback) {
              await saveBytesWithPicker(data, fileName)
            } else {
              await writeBytesToDirectory(directoryHandle, fileName, data)
            }
          } catch (writeError) {
            if (!usedSavePickerFallback && isDirectoryWriteBlockedError(writeError)) {
              usedSavePickerFallback = true
              await saveBytesWithPicker(data, fileName)
            } else {
              throw writeError
            }
          }
          successCount += 1
        } catch (itemError) {
          failedNames.push(item.name)
          failureDetails.push(`${item.name}: ${formatDownloadFailure(itemError)}`)
        }
      }

      if (successCount === 0) {
        const detail = failureDetails[0] ? `首个失败：${failureDetails[0]}` : '请重新选择目录并允许写入权限。'
        throw new Error(`没有结果成功保存到目录。${detail}`)
      }
      const targetLabel = usedSavePickerFallback ? '你选择的位置' : (directoryHandle.name || '所选目录')
      const fallbackNote = usedSavePickerFallback ? ' 所选目录被浏览器限制创建文件，已改为逐个保存窗口。' : ''
      setWarning(failedNames.length > 0 ? `已保存 ${successCount} 个结果到 ${targetLabel}，${failedNames.length} 个失败。${failureDetails[0] || ''}${fallbackNote}` : `已保存 ${successCount} 个结果到 ${targetLabel}。${fallbackNote}`)
    } catch (batchError) {
      if (batchError instanceof DOMException && batchError.name === 'AbortError') {
        setWarning(null)
        return
      }
      if (isFilePickerAlreadyActiveError(batchError)) {
        setWarning(null)
        return
      }
      setError(batchError instanceof Error ? batchError.message : '批量下载失败')
    } finally {
      directoryPickerActiveRef.current = false
      setDownloadingBatchResults(false)
      setBatchDownloadProgress(null)
    }
  }

  const handleBatchDownloadClick = (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    void downloadCompletedResults()
  }

  const toggleDownloadSelection = (itemId: string) => {
    setSelectedDownloadIds((current) => {
      const next = new Set(current)
      if (next.has(itemId)) next.delete(itemId)
      else next.add(itemId)
      return next
    })
  }

  const toggleAllCompletedSelections = () => {
    setSelectedDownloadIds((current) => {
      if (completedResultItems.length > 0 && completedResultItems.every((item) => current.has(item.id))) {
        return new Set()
      }
      return new Set(completedResultItems.map((item) => item.id))
    })
  }

  const startNewProcessingTask = () => {
    setSelectedFiles([])
    setVideoUrls('')
    setActiveItemId(null)
    setError(null)
    setWarning(null)
    setSourceMode('file')
    setIsFileDragActive(false)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const pollAll = () => {
    queueItems.forEach((item) => {
      if (item.taskId) void pollTask(item.id, item.taskId)
    })
  }

  const copyTaskId = async (taskId: string | null) => {
    if (!taskId) return
    await navigator.clipboard.writeText(taskId)
  }

  const removeSelectedFile = (index: number) => {
    setSelectedFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))
  }

  if (status === 'loading' || (status === 'unauthenticated' && !session)) {
    return (
      <div className="glass-page min-h-screen flex items-center justify-center">
        <AppIcon name="loader" className="h-6 w-6 animate-spin text-[var(--glass-tone-info-fg)]" />
      </div>
    )
  }

  return (
    <div className="glass-page min-h-screen font-sans selection:bg-[var(--glass-tone-info-bg)]">
      <IconGradientDefs />
      <Navbar />
      <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="mb-5 flex flex-col gap-3 border-b border-[var(--glass-stroke-soft)] pb-5 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface)] px-3 py-1 text-xs font-semibold text-[var(--glass-text-secondary)]">
              <AppIcon name="film" className="h-3.5 w-3.5 text-[var(--glass-tone-info-fg)]" />
              AI MediaKit
            </div>
            <h1 className="text-2xl font-bold tracking-normal text-[var(--glass-text-primary)] sm:text-3xl">画质增强</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm text-[var(--glass-text-secondary)]">
            <button type="button" onClick={startNewProcessingTask} className="glass-btn-base glass-btn-primary inline-flex items-center gap-2 px-3 py-1.5 text-sm font-semibold">
              <AppIcon name="plus" className="h-4 w-4" />
              新建处理任务
            </button>
            <span className="rounded-full border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface)] px-3 py-1">批量任务</span>
            <span className="rounded-full border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface)] px-3 py-1">最高 4K</span>
          </div>
        </div>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_440px]">
          <section className="glass-surface rounded-lg border border-[var(--glass-stroke-base)] p-5">
            <div className="mb-5 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-[var(--glass-text-primary)]">输入与参数</h2>
              </div>
              <SegmentedControl<SourceMode>
                value={sourceMode}
                onChange={setSourceMode}
                layout="compact"
                options={[
                  { value: 'file', label: <span className="inline-flex items-center gap-1.5"><AppIcon name="cloudUpload" className="h-4 w-4" />上传</span> },
                  { value: 'url', label: <span className="inline-flex items-center gap-1.5"><AppIcon name="link" className="h-4 w-4" />URL</span> },
                ]}
              />
            </div>

            {sourceMode === 'file' ? (
              <div className="space-y-3">
                <label
                  onDragEnter={handleFileDragEnter}
                  onDragOver={handleFileDragOver}
                  onDragLeave={handleFileDragLeave}
                  onDrop={handleFileDrop}
                  className={`flex min-h-44 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed px-4 py-8 text-center transition-colors ${isFileDragActive ? 'border-[var(--glass-tone-info-fg)] bg-[var(--glass-tone-info-bg)]/45' : 'border-[var(--glass-stroke-focus)] bg-[var(--glass-bg-surface)] hover:bg-[var(--glass-bg-surface-strong)]'}`}
                >
                  <input
                    type="file"
                    multiple
                    accept="video/mp4,video/x-flv,video/mp2t,video/x-msvideo,video/quicktime,video/x-ms-wmv,video/x-matroska,video/webm,.mp4,.flv,.ts,.avi,.mov,.wmv,.mkv,.webm"
                    className="sr-only"
                    onChange={handleFileInputChange}
                  />
                  <span className="mb-3 inline-flex h-12 w-12 items-center justify-center rounded-lg bg-[var(--glass-tone-info-bg)] text-[var(--glass-tone-info-fg)]">
                    <AppIcon name="cloudUpload" className="h-6 w-6" />
                  </span>
                  <span className="text-sm font-semibold text-[var(--glass-text-primary)]">
                    {isFileDragActive ? '松开即可添加到批量上传' : selectedFiles.length > 0 ? `已选择 ${selectedFiles.length} 个视频` : '点击选择，或拖拽视频文件到这里'}
                  </span>
                </label>
                {selectedFiles.length > 0 ? (
                  <div className="grid gap-2 md:grid-cols-2">
                    {selectedFiles.map((file, index) => (
                      <div key={`${file.name}-${file.size}-${index}`} className="flex min-w-0 items-center gap-2 rounded-lg border border-[var(--glass-stroke-soft)] bg-[var(--glass-bg-surface)] px-3 py-2 text-sm">
                        <AppIcon name="video" className="h-4 w-4 shrink-0 text-[var(--glass-tone-info-fg)]" />
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-semibold text-[var(--glass-text-primary)]">{file.name}</div>
                          <div className="text-xs text-[var(--glass-text-tertiary)]">{formatBytes(file.size)}</div>
                        </div>
                        <button type="button" onClick={() => removeSelectedFile(index)} className="rounded-md p-1 text-[var(--glass-text-tertiary)] hover:bg-[var(--glass-bg-muted)] hover:text-[var(--glass-text-primary)]" title="移除">
                          <AppIcon name="close" className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="space-y-2">
                <label className="text-sm font-semibold text-[var(--glass-text-primary)]" htmlFor="video-urls">视频 URL</label>
                <textarea
                  id="video-urls"
                  value={videoUrls}
                  onChange={(event) => setVideoUrls(event.target.value)}
                  placeholder="https://example.com/source-1.mp4&#10;https://example.com/source-2.mp4"
                  rows={6}
                  className="glass-input-base w-full resize-y px-3 py-2 text-sm"
                />
                <div className="text-xs text-[var(--glass-text-tertiary)]">每行一个公网可访问的 HTTP/HTTPS 视频 URL，当前 {parsedUrls.length} 条。</div>
              </div>
            )}

            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-semibold text-[var(--glass-text-primary)]">工具版本</label>
                <SegmentedControl<'standard' | 'professional'>
                  value={toolVersion}
                  onChange={setToolVersion}
                  options={[
                    { value: 'standard', label: '标准版' },
                    { value: 'professional', label: '专业版' },
                  ]}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-semibold text-[var(--glass-text-primary)]" htmlFor="scene">场景</label>
                <select id="scene" value={scene} onChange={(event) => setScene(event.target.value)} className="glass-input-base w-full px-3 py-2 text-sm">
                  {SCENE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="mt-5 space-y-3">
              <label className="text-sm font-semibold text-[var(--glass-text-primary)]">分辨率</label>
              <SegmentedControl<ResolutionMode>
                value={resolutionMode}
                onChange={setResolutionMode}
                options={[
                  { value: 'preset', label: '预设' },
                  { value: 'limit', label: '短边' },
                  { value: 'original', label: '不指定' },
                ]}
              />
              {resolutionMode === 'preset' ? (
                <select value={resolution} onChange={(event) => setResolution(event.target.value)} className="glass-input-base w-full px-3 py-2 text-sm">
                  {RESOLUTION_OPTIONS.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              ) : null}
              {resolutionMode === 'limit' ? (
                <input
                  type="number"
                  min={64}
                  max={2160}
                  value={resolutionLimit}
                  onChange={(event) => setResolutionLimit(event.target.value)}
                  placeholder="720"
                  className="glass-input-base w-full px-3 py-2 text-sm"
                />
              ) : null}
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <label className="text-sm font-semibold text-[var(--glass-text-primary)]" htmlFor="fps">帧率</label>
                <input
                  id="fps"
                  type="number"
                  min={1}
                  max={120}
                  step={1}
                  value={fps}
                  onChange={(event) => setFps(event.target.value)}
                  placeholder="60"
                  className="glass-input-base w-full px-3 py-2 text-sm"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-semibold text-[var(--glass-text-primary)]" htmlFor="submit-concurrency">提交并发</label>
                <input
                  id="submit-concurrency"
                  type="number"
                  min={1}
                  max={MAX_BATCH_CONCURRENCY}
                  step={1}
                  value={submitConcurrency}
                  onChange={(event) => setSubmitConcurrency(event.target.value)}
                  className="glass-input-base w-full px-3 py-2 text-sm"
                />
              </div>
              <div className="flex items-end">
                <button
                  type="button"
                  onClick={() => setShowAdvanced((value) => !value)}
                  className="glass-btn-base glass-btn-secondary inline-flex w-full items-center justify-center gap-2 px-4 py-2 text-sm font-semibold"
                >
                  <AppIcon name="settingsHex" className="h-4 w-4" />
                  高级参数
                  <AppIcon name={showAdvanced ? 'chevronUp' : 'chevronDown'} className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="mt-5 space-y-2">
              <label className="text-sm font-semibold text-[var(--glass-text-primary)]" htmlFor="download-directory-path">下载目录路径（可选）</label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  id="download-directory-path"
                  value={downloadDirectoryPath}
                  onChange={(event) => {
                    browserDownloadDirectoryHandleRef.current = null
                    setBrowserDownloadDirectoryName(null)
                    setDownloadDirectoryPath(event.target.value)
                  }}
                  placeholder={browserDownloadDirectoryName ? `已选择：${browserDownloadDirectoryName}` : '点击选择目录；留空则使用浏览器下载'}
                  className="glass-input-base min-w-0 flex-1 px-3 py-2 text-sm"
                />
                <button
                  type="button"
                  onClick={selectDownloadDirectory}
                  disabled={selectingDownloadDirectory}
                  className="glass-btn-base glass-btn-secondary inline-flex shrink-0 items-center justify-center gap-2 px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <AppIcon name={selectingDownloadDirectory ? 'loader' : 'folderOpen'} className={`h-4 w-4 ${selectingDownloadDirectory ? 'animate-spin' : ''}`} />
                  {selectingDownloadDirectory ? '选择中' : '选择目录'}
                </button>
              </div>
              {browserDownloadDirectoryName ? (
                <div className="text-xs text-[var(--glass-text-tertiary)]">已选择浏览器目录：{browserDownloadDirectoryName}</div>
              ) : null}
              <div className="text-xs text-[var(--glass-text-tertiary)]">Windows 可选择 D 盘下的普通文件夹，建议先建 D:\NoriVideoDownloads；不要选择盘符根目录或系统目录。</div>
            </div>

            {showAdvanced ? (
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-[var(--glass-text-primary)]" htmlFor="client-token">Client Token</label>
                  <input
                    id="client-token"
                    value={clientToken}
                    onChange={(event) => setClientToken(event.target.value)}
                    className="glass-input-base w-full px-3 py-2 text-sm"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-[var(--glass-text-primary)]" htmlFor="callback-args">Callback Args</label>
                  <input
                    id="callback-args"
                    value={callbackArgs}
                    onChange={(event) => setCallbackArgs(event.target.value)}
                    className="glass-input-base w-full px-3 py-2 text-sm"
                  />
                </div>
              </div>
            ) : null}

            {error ? (
              <div className="mt-5 rounded-lg border border-[var(--glass-tone-danger-fg)]/25 bg-[var(--glass-tone-danger-bg)] px-4 py-3 text-sm text-[var(--glass-tone-danger-fg)]">
                {error}
              </div>
            ) : null}
            {warning ? (
              <div className="mt-5 rounded-lg border border-[var(--glass-tone-warning-fg)]/25 bg-[var(--glass-tone-warning-bg)] px-4 py-3 text-sm text-[var(--glass-tone-warning-fg)]">
                {warning}
              </div>
            ) : null}

            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
              {inputCount > 0 ? (
                <button type="button" onClick={startNewProcessingTask} disabled={phase === 'submitting'} className="glass-btn-base glass-btn-secondary inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold disabled:opacity-50">
                  <AppIcon name="trash" className="h-4 w-4" />
                  清空输入
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => void handleSubmitBatch()}
                disabled={!canSubmit}
                className="glass-btn-base glass-btn-primary inline-flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
              >
                {phase === 'submitting' ? <AppIcon name="loader" className="h-4 w-4 animate-spin" /> : <AppIcon name="sparklesAlt" className="h-4 w-4" />}
                {inputCount > 1 ? `批量提交 ${inputCount} 个任务` : '提交增强任务'}
              </button>
            </div>
          </section>

          <aside className="space-y-5">
            <section className="glass-surface rounded-lg border border-[var(--glass-stroke-base)] p-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-base font-semibold text-[var(--glass-text-primary)]">预览</h2>
                {previewSource ? <span className="text-xs text-[var(--glass-text-tertiary)]">{previewFile ? '本地文件' : '视频 URL'}</span> : null}
              </div>
              <div className="aspect-video overflow-hidden rounded-lg border border-[var(--glass-stroke-soft)] bg-black/40">
                {previewSource ? (
                  <video src={previewSource} controls className="h-full w-full object-contain" />
                ) : (
                  <div className="flex h-full items-center justify-center text-sm text-[var(--glass-text-tertiary)]">
                    <AppIcon name="video" className="mr-2 h-4 w-4" />
                    未选择视频
                  </div>
                )}
              </div>
            </section>

            <section className="glass-surface rounded-lg border border-[var(--glass-stroke-base)] p-4">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold text-[var(--glass-text-primary)]">历史记录与批量进度</h2>
                  {historyLoading ? <div className="mt-0.5 text-xs text-[var(--glass-text-tertiary)]">正在读取历史记录...</div> : null}
                </div>
                {queueItems.length > 0 ? (
                  <div className="flex flex-wrap items-center justify-end gap-3">
                    {completedResultItems.length > 0 ? (
                      <>
                        <label className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--glass-text-secondary)]">
                          <input
                            type="checkbox"
                            checked={completedResultItems.length > 0 && completedResultItems.every((item) => selectedDownloadIds.has(item.id))}
                            onChange={toggleAllCompletedSelections}
                            className="h-4 w-4 rounded border-[var(--glass-stroke-base)]"
                          />
                          全选完成
                        </label>
                        <button type="button" onClick={handleBatchDownloadClick} disabled={downloadingBatchResults || batchDownloadTargetItems.length === 0} className="inline-flex items-center gap-1 text-sm font-semibold text-[var(--glass-tone-info-fg)] disabled:opacity-60">
                          <AppIcon name={downloadingBatchResults ? 'loader' : 'download'} className={`h-4 w-4 ${downloadingBatchResults ? 'animate-spin' : ''}`} />
                          {downloadingBatchResults ? `下载 ${batchDownloadProgress || ''}` : `批量下载 ${batchDownloadTargetItems.length}`}
                        </button>
                      </>
                    ) : null}
                    <button type="button" onClick={pollAll} className="inline-flex items-center gap-1 text-sm font-semibold text-[var(--glass-tone-info-fg)]">
                      <AppIcon name="refresh" className={`h-4 w-4 ${phase === 'polling' && queueSummary.running > 0 ? 'animate-spin' : ''}`} />
                      刷新
                    </button>
                  </div>
                ) : null}
              </div>

              <div className="mb-4 grid grid-cols-4 gap-2 text-center text-xs">
                <div className="rounded-lg bg-[var(--glass-bg-surface)] px-2 py-2">
                  <div className="text-[var(--glass-text-tertiary)]">总数</div>
                  <div className="mt-1 font-semibold text-[var(--glass-text-primary)]">{queueSummary.total}</div>
                </div>
                <div className="rounded-lg bg-[var(--glass-bg-surface)] px-2 py-2">
                  <div className="text-[var(--glass-text-tertiary)]">运行</div>
                  <div className="mt-1 font-semibold text-[var(--glass-tone-info-fg)]">{queueSummary.running}</div>
                </div>
                <div className="rounded-lg bg-[var(--glass-bg-surface)] px-2 py-2">
                  <div className="text-[var(--glass-text-tertiary)]">完成</div>
                  <div className="mt-1 font-semibold text-[var(--glass-tone-success-fg)]">{queueSummary.completed}</div>
                </div>
                <div className="rounded-lg bg-[var(--glass-bg-surface)] px-2 py-2">
                  <div className="text-[var(--glass-text-tertiary)]">失败</div>
                  <div className="mt-1 font-semibold text-[var(--glass-tone-danger-fg)]">{queueSummary.failed}</div>
                </div>
              </div>

              {queueItems.length > 0 ? (
                <div className="max-h-[460px] space-y-2 overflow-y-auto pr-1">
                  {queueItems.map((item) => (
                    <div key={item.id} className={`rounded-lg border p-3 transition-colors ${activeItem?.id === item.id ? 'border-[var(--glass-tone-info-fg)]/45 bg-[var(--glass-tone-info-bg)]/30' : 'border-[var(--glass-stroke-soft)] bg-[var(--glass-bg-surface)]'}`}>
                      <div className="flex items-start gap-3">
                        {item.status.toLowerCase() === 'completed' && item.result?.videoUrl ? (
                          <input
                            type="checkbox"
                            checked={selectedDownloadIds.has(item.id)}
                            onChange={() => toggleDownloadSelection(item.id)}
                            className="mt-2 h-4 w-4 shrink-0 rounded border-[var(--glass-stroke-base)]"
                            aria-label={`选择 ${item.name}`}
                          />
                        ) : null}
                        <button type="button" onClick={() => setActiveItemId(item.id)} className="mt-0.5 rounded-md p-1 text-[var(--glass-text-tertiary)] hover:bg-[var(--glass-bg-muted)] hover:text-[var(--glass-text-primary)]" title="查看">
                          <AppIcon name={item.sourceType === 'file' ? 'video' : 'link'} className="h-4 w-4" />
                        </button>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <button type="button" onClick={() => setActiveItemId(item.id)} className="min-w-0 truncate text-left text-sm font-semibold text-[var(--glass-text-primary)] hover:text-[var(--glass-tone-info-fg)]">
                              {item.name}
                            </button>
                            <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${statusTone(item.status)}`}>
                              {STATUS_LABELS[item.status.toLowerCase()] || item.status}
                            </span>
                          </div>
                          <div className="mt-1 text-xs text-[var(--glass-text-tertiary)]">
                            {item.size ? formatBytes(item.size) : item.sourceUrl || item.inputVideoUrl || '-'}
                          </div>
                          <div className="mt-2 grid gap-1 text-[11px] text-[var(--glass-text-tertiary)] sm:grid-cols-2">
                            <span>上传：{formatDateTime(item.uploadedAt)}</span>
                            <span>完成：{formatDateTime(item.finishedAt)}</span>
                          </div>
                          {item.taskId ? (
                            <button type="button" onClick={() => void copyTaskId(item.taskId)} className="mt-2 inline-flex max-w-full items-center gap-1 font-mono text-[11px] text-[var(--glass-text-secondary)] hover:text-[var(--glass-tone-info-fg)]">
                              <span className="truncate">{item.taskId}</span>
                              <AppIcon name="copy" className="h-3 w-3 shrink-0" />
                            </button>
                          ) : null}
                          {item.error ? <div className="mt-2 text-xs text-[var(--glass-tone-danger-fg)]">{item.error}</div> : null}
                        </div>
                        {item.taskId ? (
                          <button type="button" onClick={() => item.taskId && void pollTask(item.id, item.taskId)} className="rounded-md p-1 text-[var(--glass-text-tertiary)] hover:bg-[var(--glass-bg-muted)] hover:text-[var(--glass-tone-info-fg)]" title="刷新任务">
                            <AppIcon name="refresh" className="h-4 w-4" />
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-lg bg-[var(--glass-bg-surface)] px-3 py-8 text-center text-sm text-[var(--glass-text-tertiary)]">
                  批量提交后显示所有任务
                </div>
              )}
            </section>

            <section className="glass-surface rounded-lg border border-[var(--glass-stroke-base)] p-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-base font-semibold text-[var(--glass-text-primary)]">增强结果</h2>
                {activeItem?.result?.videoUrl ? (
                  <button type="button" onClick={() => void saveResultVideo()} disabled={savingResult} className="inline-flex items-center gap-1 text-sm font-semibold text-[var(--glass-tone-info-fg)] disabled:opacity-60">
                    <AppIcon name="download" className="h-4 w-4" />
                    {savingResult ? '保存中' : '保存到'}
                  </button>
                ) : null}
              </div>
              {activeItem?.result?.videoUrl ? (
                <div className="space-y-3">
                  <div className="aspect-video overflow-hidden rounded-lg border border-[var(--glass-stroke-soft)] bg-black/40">
                    <video src={activeItem.result.videoUrl} controls className="h-full w-full object-contain" />
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center text-xs">
                    <div className="rounded-lg bg-[var(--glass-bg-surface)] px-2 py-2">
                      <div className="text-[var(--glass-text-tertiary)]">时长</div>
                      <div className="mt-1 font-semibold text-[var(--glass-text-primary)]">{formatSeconds(activeItem.result.duration)}</div>
                    </div>
                    <div className="rounded-lg bg-[var(--glass-bg-surface)] px-2 py-2">
                      <div className="text-[var(--glass-text-tertiary)]">分辨率</div>
                      <div className="mt-1 font-semibold text-[var(--glass-text-primary)]">{activeItem.result.resolution || '-'}</div>
                    </div>
                    <div className="rounded-lg bg-[var(--glass-bg-surface)] px-2 py-2">
                      <div className="text-[var(--glass-text-tertiary)]">FPS</div>
                      <div className="mt-1 font-semibold text-[var(--glass-text-primary)]">{activeItem.result.fps || '-'}</div>
                    </div>
                  </div>
                  <div className="grid gap-2 text-xs sm:grid-cols-2">
                    <div className="rounded-lg bg-[var(--glass-bg-surface)] px-2 py-2">
                      <div className="text-[var(--glass-text-tertiary)]">上传时间</div>
                      <div className="mt-1 font-semibold text-[var(--glass-text-primary)]">{formatDateTime(activeItem.uploadedAt)}</div>
                    </div>
                    <div className="rounded-lg bg-[var(--glass-bg-surface)] px-2 py-2">
                      <div className="text-[var(--glass-text-tertiary)]">完成时间</div>
                      <div className="mt-1 font-semibold text-[var(--glass-text-primary)]">{formatDateTime(activeItem.finishedAt)}</div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="rounded-lg bg-[var(--glass-bg-surface)] px-3 py-8 text-center text-sm text-[var(--glass-text-tertiary)]">
                  选择已完成任务后显示视频
                </div>
              )}
            </section>
          </aside>
        </div>
      </main>
    </div>
  )
}
