'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from '@/i18n/navigation'
import { AppIcon } from '@/components/ui/icons'
import {
  REPAINT_EPISODE_NUMBER,
  REPAINT_MAX_STORYBOARD_ROUNDS,
  type RepaintOutlineRequest,
  type RepaintOutlineResult,
  type RepaintProgress,
  type RepaintSaveRequest,
  type RepaintStoryboardRequest,
  type RepaintStoryboardResult,
  type RepaintTargetScriptRequest,
  type RepaintTargetScriptResult,
  type RepaintUsage,
  type RepaintValidation,
} from '@/lib/video-repaint/contract'
import type { WriterScript } from './screenwriterModels'
import { FosVideoRepaintProgress } from './FosVideoRepaintProgress'
import { FosVideoRepaintRail } from './FosVideoRepaintRail'
import { FosVideoRepaintSetup } from './FosVideoRepaintSetup'
import {
  MAX_REPAINT_VIDEO_BYTES,
  createEmptyOutlineTrack,
  createEmptyStoryboardTrack,
  createEmptyTargetScriptTrack,
  isSessionExpiredMessage,
  validateRepaintSetup,
  type LocalVideoItem,
  type RepaintOutlineTrack,
  type RepaintRunState,
  type RepaintSetupErrors,
  type RepaintStoryboardTrack,
  type RepaintTargetScriptTrack,
  type VideoUnderstandingEpisode,
} from './videoRepaintState'

const VIDEO_EXTENSION = /\.(mp4|mov|avi)$/i
const STORYBOARD_STAGE_TIMEOUT_MS = 10 * 60 * 1_000

interface FosVideoRepaintTaskProps {
  scriptId?: string
  embedded?: boolean
  onExit?: () => void
  onSaved?: (script: WriterScript) => void
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function readApiError(payload: unknown): string {
  if (!isRecord(payload)) return ''
  const error = isRecord(payload.error) ? payload.error : null
  return typeof error?.message === 'string'
    ? error.message
    : typeof payload.message === 'string' ? payload.message : ''
}

function abortError(): Error {
  return new DOMException('Aborted', 'AbortError')
}

function numberOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

function readUsage(value: unknown): RepaintUsage {
  const usage = isRecord(value) ? value : {}
  return {
    inputTokens: typeof usage.inputTokens === 'number' ? usage.inputTokens : 0,
    outputTokens: typeof usage.outputTokens === 'number' ? usage.outputTokens : 0,
  }
}

function readValidation(value: unknown): RepaintValidation {
  const validation = isRecord(value) ? value : {}
  const readList = (item: unknown) => Array.isArray(item)
    ? item.filter((entry): entry is string => typeof entry === 'string')
    : []
  return {
    valid: validation.valid === true,
    errors: readList(validation.errors),
    warnings: readList(validation.warnings),
  }
}

function addUsage(left: RepaintUsage, right: RepaintUsage): RepaintUsage {
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
  }
}

type SourceStage = 'upload' | 'preprocess' | 'analyze'

function isSourceStage(value: unknown): value is SourceStage {
  return value === 'upload' || value === 'preprocess' || value === 'analyze'
}

interface StreamOutcome {
  result: Record<string, unknown> | null
  error: string
}

/** The understand routes stream long model stages over SSE so the pipeline can
 * show liveness during multi-minute preprocessing and generation. */
async function consumeUnderstandResponse(
  response: Response,
  onProgress: (progress: RepaintProgress) => void,
  fallbackMessage: string,
): Promise<StreamOutcome> {
  const contentType = response.headers.get('content-type') || ''
  if (!contentType.includes('text/event-stream')) {
    const payload: unknown = await response.json().catch(() => ({}))
    if (!response.ok || !isRecord(payload) || !isRecord(payload.result)) {
      return {
        result: null,
        error: readApiError(payload) || `${fallbackMessage}（HTTP ${response.status}）`,
      }
    }
    return { result: payload.result, error: '' }
  }

  const reader = response.body?.getReader()
  if (!reader) return { result: null, error: `${fallbackMessage}（HTTP ${response.status}）` }

  let eventName = ''
  let dataLines: string[] = []
  let result: Record<string, unknown> | null = null
  let error = ''

  const dispatch = () => {
    const name = eventName
    eventName = ''
    if (!dataLines.length) return
    const raw = dataLines.join('\n')
    dataLines = []
    let payload: unknown
    try {
      payload = JSON.parse(raw)
    } catch {
      return
    }
    if (name === 'progress' && isRecord(payload)) {
      const stage = payload.stage
      if (stage === 'upload' || stage === 'preprocess' || stage === 'analyze' || stage === 'storyboard') {
        onProgress({
          stage,
          elapsedSeconds: typeof payload.elapsedSeconds === 'number' ? payload.elapsedSeconds : undefined,
          outputChars: typeof payload.outputChars === 'number' ? payload.outputChars : undefined,
          shots: typeof payload.shots === 'number' ? payload.shots : undefined,
        })
      }
      return
    }
    if (name === 'result' && isRecord(payload) && isRecord(payload.result)) {
      result = payload.result
      return
    }
    if (name === 'error') {
      error = readApiError(payload) || `${fallbackMessage}，请稍后重试`
    }
  }

  const consumeLine = (line: string) => {
    if (line === '') {
      dispatch()
      return
    }
    if (line.startsWith('event:')) {
      eventName = line.slice(6).trim()
      return
    }
    if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart())
  }

  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let boundary = buffer.indexOf('\n')
      while (boundary >= 0) {
        consumeLine(buffer.slice(0, boundary).replace(/\r$/, ''))
        buffer = buffer.slice(boundary + 1)
        boundary = buffer.indexOf('\n')
      }
    }
    buffer += decoder.decode()
    if (buffer.trim()) consumeLine(buffer.replace(/\r$/, ''))
    dispatch()
  } finally {
    reader.releaseLock()
  }

  if (error) return { result: null, error }
  if (!result) return { result: null, error: `${fallbackMessage}（HTTP ${response.status}）` }
  return { result, error: '' }
}

function readVideoDuration(url: string, signal: AbortSignal): Promise<number> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve(0)
      return
    }
    const media = document.createElement('video')
    let settled = false
    const onAbort = () => finish(0)
    const finish = (duration: number) => {
      if (settled) return
      settled = true
      media.onloadedmetadata = null
      media.onerror = null
      signal.removeEventListener('abort', onAbort)
      media.removeAttribute('src')
      media.load()
      resolve(Number.isFinite(duration) && duration > 0 ? duration : 0)
    }
    media.preload = 'metadata'
    media.onloadedmetadata = () => finish(media.duration)
    media.onerror = () => finish(0)
    signal.addEventListener('abort', onAbort, { once: true })
    media.src = url
  })
}

/** Stage A: upload the single video and receive the source script plus the cut hints. */
async function understandOneVideo(
  video: LocalVideoItem,
  signal: AbortSignal,
  onProgress: (progress: RepaintProgress) => void,
): Promise<VideoUnderstandingEpisode> {
  const durationPromise = readVideoDuration(video.url, signal)
  onProgress({ stage: 'upload' })
  const localDuration = await durationPromise
  if (signal.aborted) throw abortError()

  const formData = new FormData()
  formData.append('file', video.file, video.file.name)
  formData.append('mode', 'script')
  formData.append('episodeNumber', String(REPAINT_EPISODE_NUMBER))
  if (localDuration > 0) formData.append('durationSeconds', String(localDuration))

  const response = await fetch('/api/video-repaint/understand', {
    method: 'POST',
    headers: { Accept: 'text/event-stream' },
    body: formData,
    signal,
  })
  const upload = await consumeUnderstandResponse(response, onProgress, '视频反译失败')
  if (!upload.result) throw new Error(upload.error)

  const result = upload.result
  const analysis = isRecord(result.analysis) ? result.analysis : null
  const fileHandle = typeof result.fileHandle === 'string' ? result.fileHandle : ''
  if (!fileHandle || !analysis) {
    throw new Error('视频反译未返回可用于文档生成的源数据')
  }
  const cutHints = Array.isArray(result.cutHints)
    ? result.cutHints.filter((item): item is number => typeof item === 'number' && Number.isFinite(item) && item >= 0)
    : []

  return {
    fileName: video.file.name,
    fileHandle,
    script: typeof result.script === 'string' ? result.script : '',
    analysis,
    durationSeconds: localDuration || numberOrZero(result.durationSeconds),
    cutHints,
    usage: readUsage(result.usage),
    validation: readValidation(result.validation),
  }
}

function parseStoryboardResult(result: Record<string, unknown>): RepaintStoryboardResult {
  return {
    fileHandle: typeof result.fileHandle === 'string' ? result.fileHandle : '',
    storyboard: typeof result.storyboard === 'string' ? result.storyboard : '',
    complete: result.complete === true,
    coveredSeconds: numberOrZero(result.coveredSeconds),
    durationSeconds: numberOrZero(result.durationSeconds),
    shotCount: numberOrZero(result.shotCount),
    addedShots: numberOrZero(result.addedShots),
    usage: readUsage(result.usage),
    validation: readValidation(result.validation),
  }
}

interface StoryboardRoundInput {
  source: VideoUnderstandingEpisode
  continuation: string
  signal: AbortSignal
  onProgress: (progress: RepaintProgress) => void
}

/** One streamed storyboard round, capped by the existing ten-minute stage timeout. */
async function requestStoryboardRound(input: StoryboardRoundInput): Promise<RepaintStoryboardResult> {
  const controller = new AbortController()
  const forwardAbort = () => controller.abort()
  input.signal.addEventListener('abort', forwardAbort, { once: true })
  const timeout = window.setTimeout(() => controller.abort(), STORYBOARD_STAGE_TIMEOUT_MS)
  try {
    const request: RepaintStoryboardRequest = {
      stage: 'storyboard',
      fileHandle: input.source.fileHandle,
      sourceAnalysis: input.source.analysis ?? {},
      episodeNumber: REPAINT_EPISODE_NUMBER,
      cutHints: input.source.cutHints,
    }
    if (input.continuation.trim()) request.continuation = { storyboard: input.continuation }
    const response = await fetch('/api/video-repaint/understand', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify(request),
      signal: controller.signal,
    })
    const outcome = await consumeUnderstandResponse(response, input.onProgress, '分镜生成失败')
    if (!outcome.result) throw new Error(outcome.error || '分镜生成失败')
    return parseStoryboardResult(outcome.result)
  } catch (error) {
    if (input.signal.aborted) throw abortError()
    if (controller.signal.aborted) {
      throw new Error('分镜生成超时（10 分钟），可点击重试继续生成。')
    }
    throw error
  } finally {
    window.clearTimeout(timeout)
    input.signal.removeEventListener('abort', forwardAbort)
  }
}

async function requestOutline(input: {
  title: string
  brief: string
  source: VideoUnderstandingEpisode
  signal: AbortSignal
}): Promise<RepaintOutlineResult> {
  const request: RepaintOutlineRequest = {
    title: input.title,
    adaptationBrief: input.brief,
    sourceScript: input.source.script,
    sourceAnalysis: input.source.analysis ?? undefined,
  }
  const response = await fetch('/api/video-repaint/outline', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
    signal: input.signal,
  })
  const payload: unknown = await response.json().catch(() => ({}))
  if (!response.ok || !isRecord(payload) || !isRecord(payload.result)) {
    throw new Error(readApiError(payload) || `目标设定总纲生成失败（HTTP ${response.status}）`)
  }
  const result = payload.result
  const outline = typeof result.outline === 'string' ? result.outline.trim() : ''
  if (!outline) throw new Error('文本模型未返回目标设定总纲')
  return {
    outline,
    model: typeof result.model === 'string' ? result.model : '',
    usage: readUsage(result.usage),
    missingSections: Array.isArray(result.missingSections)
      ? result.missingSections.filter((item): item is number => Number.isInteger(item))
      : [],
  }
}

async function requestTargetScript(input: {
  title: string
  brief: string
  source: VideoUnderstandingEpisode
  outline: string
  signal: AbortSignal
}): Promise<RepaintTargetScriptResult> {
  const request: RepaintTargetScriptRequest = {
    title: input.title,
    adaptationBrief: input.brief,
    sourceScript: input.source.script,
    sourceAnalysis: input.source.analysis ?? undefined,
    durationSeconds: input.source.durationSeconds,
    outline: input.outline,
  }
  const response = await fetch('/api/video-repaint/script', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
    signal: input.signal,
  })
  const payload: unknown = await response.json().catch(() => ({}))
  if (!response.ok || !isRecord(payload) || !isRecord(payload.result)) {
    throw new Error(readApiError(payload) || `目标剧本生成失败（HTTP ${response.status}）`)
  }
  const targetScript = typeof payload.result.targetScript === 'string' ? payload.result.targetScript.trim() : ''
  if (!targetScript) throw new Error('文本模型未返回目标剧本')
  return {
    targetScript,
    model: typeof payload.result.model === 'string' ? payload.result.model : '',
    usage: readUsage(payload.result.usage),
  }
}

function newRequestId(): string {
  try {
    return crypto.randomUUID()
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`
  }
}

export function FosVideoRepaintTask({ scriptId = 'new', embedded = false, onExit, onSaved }: FosVideoRepaintTaskProps) {
  const router = useRouter()
  const [title, setTitle] = useState(scriptId !== 'new' ? `转绘任务 ${scriptId}` : '')
  const [brief, setBrief] = useState('')
  const [generateStoryboard, setGenerateStoryboard] = useState(false)
  const [videos, setVideos] = useState<LocalVideoItem[]>([])
  const [errors, setErrors] = useState<RepaintSetupErrors>({})
  const [runState, setRunState] = useState<RepaintRunState>('setup')
  const [sourceStage, setSourceStage] = useState<SourceStage>('upload')
  const [sourceOutputChars, setSourceOutputChars] = useState(0)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [notice, setNotice] = useState('')
  const [understandingResult, setUnderstandingResult] = useState<VideoUnderstandingEpisode | null>(null)
  const [outlineState, setOutlineState] = useState<RepaintOutlineTrack>(createEmptyOutlineTrack)
  const [targetScriptState, setTargetScriptState] = useState<RepaintTargetScriptTrack>(createEmptyTargetScriptTrack)
  const [storyboardState, setStoryboardState] = useState<RepaintStoryboardTrack>(createEmptyStoryboardTrack)
  const [savedScriptId, setSavedScriptId] = useState('')

  const videosRef = useRef<LocalVideoItem[]>([])
  const requestAbortRef = useRef<AbortController | null>(null)
  const outlineAbortRef = useRef<AbortController | null>(null)
  const targetScriptAbortRef = useRef<AbortController | null>(null)
  const storyboardAbortRef = useRef<AbortController | null>(null)
  const submitLockRef = useRef(false)
  const outlineLockRef = useRef(false)
  const targetScriptLockRef = useRef(false)
  const storyboardLockRef = useRef(false)
  const savingRef = useRef(false)
  const mountedRef = useRef(true)
  const saveRequestIdRef = useRef('')
  const outlineTrackRef = useRef<RepaintOutlineTrack>(createEmptyOutlineTrack())
  const targetScriptTrackRef = useRef<RepaintTargetScriptTrack>(createEmptyTargetScriptTrack())
  const storyboardTrackRef = useRef<RepaintStoryboardTrack>(createEmptyStoryboardTrack())

  const commitOutlineTrack = (patch: Partial<RepaintOutlineTrack>) => {
    const next = { ...outlineTrackRef.current, ...patch }
    outlineTrackRef.current = next
    if (mountedRef.current) setOutlineState(next)
  }

  const commitTargetScriptTrack = (patch: Partial<RepaintTargetScriptTrack>) => {
    const next = { ...targetScriptTrackRef.current, ...patch }
    targetScriptTrackRef.current = next
    if (mountedRef.current) setTargetScriptState(next)
  }

  const commitStoryboardTrack = (patch: Partial<RepaintStoryboardTrack>) => {
    const next = { ...storyboardTrackRef.current, ...patch }
    storyboardTrackRef.current = next
    if (mountedRef.current) setStoryboardState(next)
  }

  const revealReviewIfDeliverable = () => {
    if (outlineTrackRef.current.status === 'done' || targetScriptTrackRef.current.status === 'done' || storyboardTrackRef.current.status === 'done') {
      setRunState((current) => current === 'processing' ? 'review' : current)
    }
  }

  const resetTracks = () => {
    outlineTrackRef.current = createEmptyOutlineTrack()
    targetScriptTrackRef.current = createEmptyTargetScriptTrack()
    storyboardTrackRef.current = createEmptyStoryboardTrack()
    setOutlineState(outlineTrackRef.current)
    setTargetScriptState(targetScriptTrackRef.current)
    setStoryboardState(storyboardTrackRef.current)
  }

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      requestAbortRef.current?.abort()
      outlineAbortRef.current?.abort()
      targetScriptAbortRef.current?.abort()
      storyboardAbortRef.current?.abort()
      videosRef.current.forEach((video) => URL.revokeObjectURL(video.url))
    }
  }, [])

  useEffect(() => { videosRef.current = videos }, [videos])

  useEffect(() => {
    if (runState !== 'processing') return
    const startedAt = Date.now() - elapsedSeconds * 1_000
    const timer = window.setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1_000))
    }, 1_000)
    return () => window.clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runState])

  const addFiles = (incoming: File[]) => {
    const file = incoming.find((item) => VIDEO_EXTENSION.test(item.name))
    if (!file) {
      setErrors((current) => ({ ...current, videos: '仅支持 mp4 / mov / avi 视频文件' }))
      return
    }
    if (file.size <= 0 || file.size > MAX_REPAINT_VIDEO_BYTES) {
      setErrors((current) => ({ ...current, videos: '视频不能为空且不能超过 512 MB' }))
      return
    }
    setVideos((current) => {
      current.forEach((item) => URL.revokeObjectURL(item.url))
      return [{ id: `${file.name}-${file.lastModified}`, file, url: URL.createObjectURL(file) }]
    })
    if (!title.trim()) setTitle(`${file.name.replace(VIDEO_EXTENSION, '')} · 视频转绘`.slice(0, 40))
    setErrors((current) => ({ ...current, videos: undefined }))
  }

  const removeVideo = (id: string) => {
    setVideos((current) => {
      const removed = current.find((video) => video.id === id)
      if (removed) URL.revokeObjectURL(removed.url)
      return current.filter((video) => video.id !== id)
    })
  }

  const runOutline = async (source: VideoUnderstandingEpisode, briefText: string): Promise<RepaintOutlineResult | null> => {
    if (outlineLockRef.current) return null
    outlineLockRef.current = true
    outlineAbortRef.current?.abort()
    const controller = new AbortController()
    outlineAbortRef.current = controller
    commitOutlineTrack({ status: 'running', error: '' })
    try {
      const result = await requestOutline({
        title: title.trim() || source.fileName,
        brief: briefText.trim(),
        source,
        signal: controller.signal,
      })
      if (controller.signal.aborted) throw abortError()
      commitOutlineTrack({
        status: 'done',
        error: '',
        text: result.outline,
        model: result.model,
        missingSections: result.missingSections,
        usage: result.usage,
      })
      revealReviewIfDeliverable()
      return result
    } catch (error) {
      if (!mountedRef.current) return null
      const message = controller.signal.aborted
        ? '已取消目标设定总纲生成，可点击重试。'
        : error instanceof Error ? error.message : '目标设定总纲生成失败'
      commitOutlineTrack({ status: 'failed', error: message })
      revealReviewIfDeliverable()
      return null
    } finally {
      outlineLockRef.current = false
      if (outlineAbortRef.current === controller) outlineAbortRef.current = null
    }
  }

  const runTargetScript = async (source: VideoUnderstandingEpisode, outline: string, briefText: string) => {
    if (targetScriptLockRef.current || !outline.trim()) return
    targetScriptLockRef.current = true
    targetScriptAbortRef.current?.abort()
    const controller = new AbortController()
    targetScriptAbortRef.current = controller
    commitTargetScriptTrack({ status: 'running', error: '' })
    try {
      const result = await requestTargetScript({
        title: title.trim() || source.fileName,
        brief: briefText.trim(),
        source,
        outline,
        signal: controller.signal,
      })
      if (controller.signal.aborted) throw abortError()
      commitTargetScriptTrack({
        status: 'done', error: '', text: result.targetScript, model: result.model, usage: result.usage,
      })
      revealReviewIfDeliverable()
    } catch (error) {
      if (!mountedRef.current) return
      const message = controller.signal.aborted
        ? '已取消目标剧本生成，可点击重试。'
        : error instanceof Error ? error.message : '目标剧本生成失败'
      commitTargetScriptTrack({ status: 'failed', error: message })
      revealReviewIfDeliverable()
    } finally {
      targetScriptLockRef.current = false
      if (targetScriptAbortRef.current === controller) targetScriptAbortRef.current = null
    }
  }

  const runStoryboard = async (source: VideoUnderstandingEpisode, options?: { continueFrom?: string }) => {
    if (storyboardLockRef.current) return
    storyboardLockRef.current = true
    storyboardAbortRef.current?.abort()
    const controller = new AbortController()
    storyboardAbortRef.current = controller

    const continuing = options?.continueFrom?.trim() ? options.continueFrom : ''
    const previous = storyboardTrackRef.current
    let text = continuing || ''
    let usage = continuing ? previous.usage : { inputTokens: 0, outputTokens: 0 }
    let coveredSeconds = continuing ? previous.coveredSeconds : 0
    let shotCount = continuing ? previous.shotCount : 0
    let durationSeconds = previous.durationSeconds || source.durationSeconds
    let warnings: string[] = continuing ? previous.warnings : []
    let rounds = 0
    commitStoryboardTrack({
      status: 'running',
      error: '',
      sessionExpired: false,
      text,
      complete: false,
      round: 0,
      shotCount,
      coveredSeconds,
      durationSeconds,
      warnings,
      usage,
    })

    try {
      while (rounds < REPAINT_MAX_STORYBOARD_ROUNDS) {
        if (controller.signal.aborted) throw abortError()
        rounds += 1
        commitStoryboardTrack({ round: rounds })
        const result = await requestStoryboardRound({
          source,
          continuation: text,
          signal: controller.signal,
          onProgress: (progress) => {
            if (progress.stage !== 'storyboard' || controller.signal.aborted) return
            const patch: Partial<RepaintStoryboardTrack> = { round: rounds }
            if (typeof progress.shots === 'number') patch.shotCount = progress.shots
            commitStoryboardTrack(patch)
          },
        })
        if (controller.signal.aborted) throw abortError()
        if (result.storyboard.trim()) text = result.storyboard
        usage = addUsage(usage, result.usage)
        coveredSeconds = result.coveredSeconds || coveredSeconds
        shotCount = result.shotCount || shotCount
        durationSeconds = result.durationSeconds || durationSeconds
        warnings = result.validation.warnings
        commitStoryboardTrack({
          text,
          complete: result.complete,
          coveredSeconds,
          shotCount,
          durationSeconds,
          warnings,
          usage,
        })
        if (result.complete) break
        if (result.addedShots <= 0) break
      }
      if (controller.signal.aborted) throw abortError()
      commitStoryboardTrack({ status: 'done', error: '' })
      revealReviewIfDeliverable()
    } catch (error) {
      if (!mountedRef.current) return
      const aborted = controller.signal.aborted
      const message = aborted
        ? '已取消分镜生成，可点击重试继续。'
        : error instanceof Error ? error.message : '分镜生成失败'
      commitStoryboardTrack({
        status: 'failed',
        error: message,
        sessionExpired: !aborted && isSessionExpiredMessage(message),
      })
      revealReviewIfDeliverable()
    } finally {
      storyboardLockRef.current = false
      if (storyboardAbortRef.current === controller) storyboardAbortRef.current = null
    }
  }

  const resetToSetup = () => {
    requestAbortRef.current?.abort()
    outlineAbortRef.current?.abort()
    targetScriptAbortRef.current?.abort()
    storyboardAbortRef.current?.abort()
    setRunState('setup')
    setUnderstandingResult(null)
    resetTracks()
    setSourceStage('upload')
    setSourceOutputChars(0)
    setSavedScriptId('')
    saveRequestIdRef.current = ''
  }

  const submit = async () => {
    if (submitLockRef.current) return
    const nextErrors = validateRepaintSetup({ title, brief, videoCount: videos.length })
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length) {
      setNotice('请先完成任务名称并上传一个视频')
      return
    }
    const video = videos[0]
    if (!video) return
    submitLockRef.current = true
    setNotice('')
    requestAbortRef.current?.abort()
    outlineAbortRef.current?.abort()
    targetScriptAbortRef.current?.abort()
    storyboardAbortRef.current?.abort()
    const controller = new AbortController()
    requestAbortRef.current = controller
    resetTracks()
    setSavedScriptId('')
    saveRequestIdRef.current = ''
    setUnderstandingResult(null)
    setSourceStage('upload')
    setSourceOutputChars(0)
    setElapsedSeconds(0)
    setRunState('processing')
    try {
      const source = await understandOneVideo(video, controller.signal, (progress) => {
        if (progress.stage === 'storyboard' || !isSourceStage(progress.stage)) return
        setSourceStage(progress.stage)
        setSourceOutputChars(progress.outputChars ?? 0)
      })
      if (controller.signal.aborted) throw abortError()
      setUnderstandingResult(source)
      void runOutline(source, brief).then((outline) => {
        if (outline) return runTargetScript(source, outline.outline, brief)
      })
      if (generateStoryboard) void runStoryboard(source)
    } catch (error) {
      if (controller.signal.aborted) {
        setRunState('setup')
        setNotice('已取消本次视频反译。')
        return
      }
      const message = error instanceof Error ? error.message : '视频转绘失败，请稍后重试'
      setRunState('setup')
      setErrors((current) => ({ ...current, videos: message }))
      setNotice(message)
    } finally {
      submitLockRef.current = false
      if (requestAbortRef.current === controller) requestAbortRef.current = null
    }
  }

  const cancelProcessing = () => {
    if (!requestAbortRef.current && !outlineAbortRef.current && !targetScriptAbortRef.current && !storyboardAbortRef.current) return
    setNotice('正在取消本次处理…')
    requestAbortRef.current?.abort()
    outlineAbortRef.current?.abort()
    targetScriptAbortRef.current?.abort()
    storyboardAbortRef.current?.abort()
  }

  const retryOutline = () => {
    if (!understandingResult || outlineLockRef.current) return
    void runOutline(understandingResult, brief).then((outline) => {
      if (outline) return runTargetScript(understandingResult, outline.outline, brief)
    })
  }

  const retryTargetScript = () => {
    const outline = outlineTrackRef.current.text.trim()
    if (!understandingResult || targetScriptLockRef.current || !outline) return
    void runTargetScript(understandingResult, outline, brief)
  }

  const retryStoryboard = () => {
    if (!understandingResult || storyboardLockRef.current) return
    const continueFrom = storyboardTrackRef.current.text.trim()
    void runStoryboard(understandingResult, continueFrom ? { continueFrom } : undefined)
  }

  const regenerateOutline = () => {
    if (!understandingResult || outlineLockRef.current || targetScriptLockRef.current) return
    void runOutline(understandingResult, brief).then((outline) => {
      if (outline) return runTargetScript(understandingResult, outline.outline, brief)
    })
  }

  const regenerateStoryboard = () => {
    if (!understandingResult || storyboardLockRef.current) return
    commitStoryboardTrack(createEmptyStoryboardTrack())
    void runStoryboard(understandingResult)
  }

  const reupload = () => {
    resetToSetup()
    setNotice('视频会话已失效，请重新上传同一视频后再次生成。')
  }

  const saveScript = async () => {
    const source = understandingResult
    if (!source || savingRef.current) return
    const outlineText = outlineTrackRef.current.text.trim()
    const targetScriptText = targetScriptTrackRef.current.text.trim()
    const storyboardText = storyboardTrackRef.current.text.trim()
    if (!outlineText && !targetScriptText && !storyboardText) return
    savingRef.current = true
    setRunState('saving')
    setNotice('')
    if (!saveRequestIdRef.current) saveRequestIdRef.current = newRequestId()
    try {
      const request: RepaintSaveRequest = {
        clientRequestId: saveRequestIdRef.current,
        title: title.trim() || source.fileName,
        sourceScript: source.script,
        adaptationBrief: brief.trim(),
        sourceFileName: source.fileName,
        ...(outlineText ? { outline: outlineText } : {}),
        ...(targetScriptText ? { targetScript: targetScriptText } : {}),
        ...(storyboardText ? { storyboard: storyboardText } : {}),
        ...(outlineTrackRef.current.model ? { model: outlineTrackRef.current.model } : {}),
        ...(source.analysis ? { sourceAnalysis: source.analysis } : {}),
      }
      const response = await fetch('/api/video-repaint/scripts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })
      const payload: unknown = await response.json().catch(() => ({}))
      if (!response.ok || !isRecord(payload) || !isRecord(payload.script) || typeof payload.script.id !== 'string') {
        throw new Error(readApiError(payload) || '剧本保存失败')
      }
      requestAbortRef.current?.abort()
      outlineAbortRef.current?.abort()
      targetScriptAbortRef.current?.abort()
      storyboardAbortRef.current?.abort()
      setSavedScriptId(payload.script.id)
      setRunState('done')
      if (onSaved && Array.isArray(payload.script.episodes)) {
        onSaved(payload.script as unknown as WriterScript)
      }
    } catch (error) {
      setRunState('review')
      setNotice(error instanceof Error ? error.message : '剧本保存失败')
    } finally {
      savingRef.current = false
    }
  }

  const goWorkbench = () => {
    if (onExit) {
      onExit()
      return
    }
    router.push({ pathname: '/writer-workbench' })
  }

  const handleBack = () => {
    requestAbortRef.current?.abort()
    outlineAbortRef.current?.abort()
    targetScriptAbortRef.current?.abort()
    storyboardAbortRef.current?.abort()
    goWorkbench()
  }

  const sourceFileName = understandingResult?.fileName ?? videos[0]?.file.name ?? ''

  return (
    <div className={`rv2-wizard${embedded ? ' rv2-wizard--embedded' : ''}`}>
      <FosVideoRepaintRail state={runState} sourceReady={Boolean(understandingResult)} onBack={handleBack} />
      <main className="rv2-main">
        <div className={`rv2-main-scroll${runState === 'setup' ? ' rv2-main--setup' : ' rv2-main--has-task'}`}>
          {runState === 'setup' ? (
            <FosVideoRepaintSetup
              title={title}
              brief={brief}
              generateStoryboard={generateStoryboard}
              videos={videos}
              errors={errors}
              onTitleChange={(value) => { setTitle(value); setErrors((current) => ({ ...current, title: undefined })) }}
              onBriefChange={setBrief}
              onGenerateStoryboardChange={setGenerateStoryboard}
              onFiles={addFiles}
              onRemoveVideo={removeVideo}
              onSubmit={submit}
            />
          ) : (
            <FosVideoRepaintProgress
              state={runState as Extract<RepaintRunState, 'processing' | 'review' | 'saving' | 'done'>}
              title={title}
              brief={brief}
              sourceFileName={sourceFileName}
              sourceReady={Boolean(understandingResult)}
              sourceStage={sourceStage}
              sourceOutputChars={sourceOutputChars}
              elapsedSeconds={elapsedSeconds}
              source={understandingResult}
              outline={outlineState}
              targetScript={targetScriptState}
              storyboard={storyboardState}
              savedScriptId={savedScriptId}
              onBriefChange={setBrief}
              onOutlineChange={(value) => commitOutlineTrack({ text: value })}
              onTargetScriptChange={(value) => commitTargetScriptTrack({ text: value })}
              onStoryboardChange={(value) => commitStoryboardTrack({ text: value })}
              onRetryOutline={retryOutline}
              onRetryTargetScript={retryTargetScript}
              onRetryStoryboard={retryStoryboard}
              onRegenerateOutline={regenerateOutline}
              onRegenerateStoryboard={regenerateStoryboard}
              onReupload={reupload}
              onCancelProcessing={runState === 'processing' ? cancelProcessing : undefined}
              onSave={() => { void saveScript() }}
              onGoWorkbench={goWorkbench}
            />
          )}
        </div>

        {notice ? <div className="rv2-toast" role="status"><AppIcon name="info" className="h-4 w-4" /><span>{notice}</span><button type="button" aria-label="关闭提示" onClick={() => setNotice('')}><AppIcon name="close" className="h-3.5 w-3.5" /></button></div> : null}
      </main>
    </div>
  )
}
