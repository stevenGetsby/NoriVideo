'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from '@/i18n/navigation'
import { AppIcon } from '@/components/ui/icons'
import type { WriterScript } from './screenwriterModels'
import { FosVideoRepaintProgress } from './FosVideoRepaintProgress'
import { FosVideoRepaintRail } from './FosVideoRepaintRail'
import { FosVideoRepaintSetup } from './FosVideoRepaintSetup'
import {
  MAX_REPAINT_VIDEO_BYTES,
  validateRepaintSetup,
  type LocalVideoItem,
  type RepaintResultMode,
  type RepaintRunState,
  type RepaintSetupErrors,
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

async function understandOneVideo(
  video: LocalVideoItem,
  signal: AbortSignal,
  adaptationBrief: string,
  onPhase: (phase: 'upload' | 'script' | 'storyboard') => void,
  onSourceReady: (source: VideoUnderstandingEpisode) => void,
): Promise<VideoUnderstandingEpisode> {
  const durationPromise = readVideoDuration(video.url, signal)
  onPhase('upload')
  const localDuration = await durationPromise
  if (signal.aborted) throw abortError()

  const formData = new FormData()
  formData.append('file', video.file, video.file.name)
  formData.append('mode', 'script')
  formData.append('episodeNumber', '1')
  formData.append('adaptationBrief', adaptationBrief)
  if (localDuration > 0) formData.append('durationSeconds', String(localDuration))

  const response = await fetch('/api/video-repaint/understand', {
    method: 'POST',
    body: formData,
    signal,
  })
  const payload: unknown = await response.json().catch(() => ({}))
  if (!response.ok || !isRecord(payload) || !isRecord(payload.result)) {
    throw new Error(readApiError(payload) || `视频反译失败（HTTP ${response.status}）`)
  }

  onPhase('script')
  const result = payload.result
  const usage = isRecord(result.usage) ? result.usage : {}
  const validation = isRecord(result.validation) ? result.validation : {}
  const analysis = isRecord(result.analysis) ? result.analysis : null
  const fileHandle = typeof result.fileHandle === 'string' ? result.fileHandle : ''
  const analyzedDuration = typeof result.durationSeconds === 'number' ? result.durationSeconds : 0
  const durationSeconds = localDuration || analyzedDuration
  if (!fileHandle || !analysis || !durationSeconds) {
    throw new Error('视频反译未返回可用于分镜阶段的源数据')
  }

  const sourceEpisode: VideoUnderstandingEpisode = {
    fileName: video.file.name,
    model: '',
    script: typeof result.script === 'string' ? result.script : '',
    storyboard: '',
    text: '',
    analysis,
    durationSeconds,
    usage: {
      inputTokens: typeof usage.inputTokens === 'number' ? usage.inputTokens : 0,
      outputTokens: typeof usage.outputTokens === 'number' ? usage.outputTokens : 0,
    },
    validation: {
      valid: validation.valid === true,
      errors: Array.isArray(validation.errors) ? validation.errors.filter((item): item is string => typeof item === 'string') : [],
      warnings: Array.isArray(validation.warnings) ? validation.warnings.filter((item): item is string => typeof item === 'string') : [],
    },
  }
  onSourceReady(sourceEpisode)

  onPhase('storyboard')
  const storyboardController = new AbortController()
  const abortStoryboard = () => storyboardController.abort()
  signal.addEventListener('abort', abortStoryboard, { once: true })
  const timeout = window.setTimeout(() => storyboardController.abort(), STORYBOARD_STAGE_TIMEOUT_MS)
  let storyboardPayload: unknown = {}
  let storyboardResponse: Response | null = null
  try {
    storyboardResponse = await fetch('/api/video-repaint/understand', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        stage: 'storyboard',
        fileHandle,
        sourceAnalysis: analysis,
        episodeNumber: 1,
      }),
      signal: storyboardController.signal,
    })
    storyboardPayload = await storyboardResponse.json().catch(() => ({}))
  } catch (error) {
    if (signal.aborted) throw abortError()
    if (storyboardController.signal.aborted) {
      throw new Error('源分镜提取超时，已保留反译得到的原剧本，可继续编辑。')
    }
    throw error
  } finally {
    window.clearTimeout(timeout)
    signal.removeEventListener('abort', abortStoryboard)
  }

  if (!storyboardResponse) throw new Error('源分镜提取失败，请重试')
  if (signal.aborted) throw abortError()
  if (!storyboardResponse.ok || !isRecord(storyboardPayload) || !isRecord(storyboardPayload.result)) {
    throw new Error(readApiError(storyboardPayload) || `源分镜提取失败（HTTP ${storyboardResponse.status}）`)
  }

  const storyboardResult = storyboardPayload.result
  const storyboardUsage = isRecord(storyboardResult.usage) ? storyboardResult.usage : {}
  const storyboardValidation = isRecord(storyboardResult.validation) ? storyboardResult.validation : {}
  const scriptWarnings = sourceEpisode.validation.warnings
  const storyboardWarnings = Array.isArray(storyboardValidation.warnings)
    ? storyboardValidation.warnings.filter((item): item is string => typeof item === 'string')
    : []
  const storyboardErrors = Array.isArray(storyboardValidation.errors)
    ? storyboardValidation.errors.filter((item): item is string => typeof item === 'string')
    : []

  return {
    ...sourceEpisode,
    storyboard: typeof storyboardResult.storyboard === 'string' ? storyboardResult.storyboard : '',
    analysis: isRecord(storyboardResult.analysis) ? storyboardResult.analysis : analysis,
    usage: {
      inputTokens: sourceEpisode.usage.inputTokens + (typeof storyboardUsage.inputTokens === 'number' ? storyboardUsage.inputTokens : 0),
      outputTokens: sourceEpisode.usage.outputTokens + (typeof storyboardUsage.outputTokens === 'number' ? storyboardUsage.outputTokens : 0),
    },
    validation: {
      valid: sourceEpisode.validation.valid && storyboardValidation.valid === true,
      errors: [...sourceEpisode.validation.errors, ...storyboardErrors],
      warnings: [...scriptWarnings, ...storyboardWarnings],
    },
  }
}

interface AdaptationResponse {
  script: string
  mode: RepaintResultMode
  model: string
  usage: { inputTokens: number; outputTokens: number }
}

async function requestAdaptation(input: {
  title: string
  brief: string
  result: VideoUnderstandingEpisode
  signal?: AbortSignal
}): Promise<AdaptationResponse> {
  const response = await fetch('/api/video-repaint/adapt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: input.title,
      sourceScript: input.result.script,
      sourceAnalysis: input.result.analysis,
      adaptationBrief: input.brief,
    }),
    signal: input.signal,
  })
  const payload: unknown = await response.json().catch(() => ({}))
  if (!response.ok || !isRecord(payload) || !isRecord(payload.result)) {
    throw new Error(readApiError(payload) || `转绘剧本生成失败（HTTP ${response.status}）`)
  }
  const result = payload.result
  const usage = isRecord(result.usage) ? result.usage : {}
  const script = typeof result.script === 'string' ? result.script.trim() : ''
  if (!script) throw new Error('文本模型未返回转绘剧本')
  return {
    script,
    mode: result.mode === 'source_copy' ? 'source_copy' : 'llm',
    model: typeof result.model === 'string' ? result.model : '',
    usage: {
      inputTokens: typeof usage.inputTokens === 'number' ? usage.inputTokens : 0,
      outputTokens: typeof usage.outputTokens === 'number' ? usage.outputTokens : 0,
    },
  }
}

function sourceCopy(result: VideoUnderstandingEpisode): AdaptationResponse {
  return {
    script: result.script,
    mode: 'source_copy',
    model: '',
    usage: { inputTokens: 0, outputTokens: 0 },
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
  const [videos, setVideos] = useState<LocalVideoItem[]>([])
  const [errors, setErrors] = useState<RepaintSetupErrors>({})
  const [runState, setRunState] = useState<RepaintRunState>('setup')
  const [submitPhase, setSubmitPhase] = useState<'upload' | 'script' | 'storyboard'>('upload')
  const [notice, setNotice] = useState('')
  const [understandingResult, setUnderstandingResult] = useState<VideoUnderstandingEpisode | null>(null)
  const [targetScript, setTargetScript] = useState('')
  const [resultMode, setResultMode] = useState<RepaintResultMode>('source_copy')
  const [targetUsage, setTargetUsage] = useState({ inputTokens: 0, outputTokens: 0 })
  const [savedScriptId, setSavedScriptId] = useState('')
  const videosRef = useRef<LocalVideoItem[]>([])
  const requestAbortRef = useRef<AbortController | null>(null)
  const adaptationAbortRef = useRef<AbortController | null>(null)
  const partialSourceRef = useRef<VideoUnderstandingEpisode | null>(null)
  const submitLockRef = useRef(false)
  const adaptationLockRef = useRef(false)
  const savingRef = useRef(false)
  const saveRequestIdRef = useRef('')

  useEffect(() => { videosRef.current = videos }, [videos])
  useEffect(() => () => {
    requestAbortRef.current?.abort()
    adaptationAbortRef.current?.abort()
    videosRef.current.forEach((video) => URL.revokeObjectURL(video.url))
  }, [])

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

  const applyAdaptation = (adapted: AdaptationResponse) => {
    setTargetScript(adapted.script)
    setResultMode(adapted.mode)
    setTargetUsage(adapted.usage)
  }

  const recoverWithSource = (source: VideoUnderstandingEpisode, message: string) => {
    setUnderstandingResult(source)
    applyAdaptation(sourceCopy(source))
    setRunState('review')
    setNotice(message)
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
    adaptationAbortRef.current?.abort()
    const controller = new AbortController()
    requestAbortRef.current = controller
    partialSourceRef.current = null
    setSavedScriptId('')
    saveRequestIdRef.current = ''
    setRunState('submitting')
    setSubmitPhase('upload')
    try {
      const source = await understandOneVideo(
        video,
        controller.signal,
        brief,
        setSubmitPhase,
        (partial) => {
          partialSourceRef.current = partial
          setUnderstandingResult(partial)
        },
      )
      partialSourceRef.current = source
      if (controller.signal.aborted) throw abortError()
      setUnderstandingResult(source)
      if (brief.trim()) {
        setRunState('adapting')
        try {
          applyAdaptation(await requestAdaptation({ title, brief, result: source, signal: controller.signal }))
        } catch (error) {
          if (controller.signal.aborted) throw abortError()
          applyAdaptation(sourceCopy(source))
          setRunState('review')
          setNotice(error instanceof Error ? error.message : '转绘剧本生成失败，已保留原剧本')
          return
        }
      } else {
        applyAdaptation(sourceCopy(source))
      }
      if (!controller.signal.aborted) setRunState('review')
    } catch (error) {
      const partial = partialSourceRef.current
      if (controller.signal.aborted) {
        if (partial) {
          recoverWithSource(partial, '已取消源分镜提取，已保留反译得到的原剧本，可继续编辑或重新生成。')
        } else {
          setRunState('setup')
          setNotice('已取消本次视频反译。')
        }
        return
      }
      const message = error instanceof Error ? error.message : '视频转绘失败，请稍后重试'
      if (partial) {
        recoverWithSource(partial, `${message} 已保留原剧本，可继续编辑。`)
      } else {
        setRunState('setup')
        setErrors((current) => ({ ...current, videos: message }))
        setNotice(message)
      }
    } finally {
      submitLockRef.current = false
      if (requestAbortRef.current === controller) requestAbortRef.current = null
    }
  }

  const cancelSubmit = () => {
    if (!requestAbortRef.current) return
    setNotice('正在取消本次处理…')
    requestAbortRef.current.abort()
  }

  const regenerate = async () => {
    if (!understandingResult || adaptationLockRef.current) return
    if (!brief.trim()) {
      applyAdaptation(sourceCopy(understandingResult))
      setNotice('未填写转绘要求，已恢复为原剧本；没有调用文本 LLM。')
      return
    }
    adaptationLockRef.current = true
    adaptationAbortRef.current?.abort()
    const controller = new AbortController()
    adaptationAbortRef.current = controller
    setNotice('')
    setRunState('adapting')
    try {
      applyAdaptation(await requestAdaptation({ title, brief, result: understandingResult, signal: controller.signal }))
      setRunState('review')
    } catch (error) {
      setRunState('review')
      if (controller.signal.aborted) {
        setNotice('已取消重新生成，保留了之前的转绘稿。')
      } else {
        setNotice(error instanceof Error ? error.message : '转绘剧本重新生成失败')
      }
    } finally {
      adaptationLockRef.current = false
      if (adaptationAbortRef.current === controller) adaptationAbortRef.current = null
    }
  }

  const cancelAdaptation = () => {
    adaptationAbortRef.current?.abort()
  }

  const restoreSource = () => {
    if (!understandingResult) return
    applyAdaptation(sourceCopy(understandingResult))
    setNotice('已将右侧转绘稿恢复为原剧本。')
  }

  const saveScript = async () => {
    if (!understandingResult || !targetScript.trim() || savingRef.current) return
    savingRef.current = true
    setRunState('saving')
    setNotice('')
    if (!saveRequestIdRef.current) saveRequestIdRef.current = newRequestId()
    try {
      const response = await fetch('/api/video-repaint/scripts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientRequestId: saveRequestIdRef.current,
          title,
          targetScript,
          sourceScript: understandingResult.script,
          sourceStoryboard: understandingResult.storyboard,
          sourceAnalysis: understandingResult.analysis,
          adaptationBrief: brief,
          resultMode,
          model: '',
          sourceFileName: understandingResult.fileName,
          episodeTitle: '第 1 集',
        }),
      })
      const payload: unknown = await response.json().catch(() => ({}))
      if (!response.ok || !isRecord(payload) || !isRecord(payload.script) || typeof payload.script.id !== 'string') {
        throw new Error(readApiError(payload) || '剧本保存失败')
      }
      setSavedScriptId(payload.script.id)
      setRunState('done')
      if (onSaved) {
        const saved = payload.script
        if (Array.isArray(saved.episodes)) {
          onSaved(saved as unknown as WriterScript)
        }
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
    adaptationAbortRef.current?.abort()
    goWorkbench()
  }

  const submitCopy = submitPhase === 'upload'
    ? '正在上传视频并等待服务端完成理解…'
    : submitPhase === 'script'
      ? '原剧本已返回，正在校验源数据…'
      : '正在根据真实剪辑点提取原分镜…'

  return (
    <div className={`rv2-wizard${embedded ? ' rv2-wizard--embedded' : ''}`}>
      <FosVideoRepaintRail state={runState} onBack={handleBack} />
      <main className={`rv2-main${runState === 'submitting' ? ' rv2-main--submitting' : ''}`}>
        <div className={`rv2-main-scroll${runState === 'setup' || runState === 'submitting' ? ' rv2-main--setup' : ' rv2-main--has-task'}`}>
          {runState === 'setup' || runState === 'submitting' ? (
            <FosVideoRepaintSetup
              title={title}
              brief={brief}
              videos={videos}
              errors={errors}
              onTitleChange={(value) => { setTitle(value); setErrors((current) => ({ ...current, title: undefined })) }}
              onBriefChange={setBrief}
              onFiles={addFiles}
              onRemoveVideo={removeVideo}
              onSubmit={submit}
            />
          ) : understandingResult ? (
            <FosVideoRepaintProgress
              state={runState}
              title={title}
              brief={brief}
              sourceScript={understandingResult.script}
              sourceStoryboard={understandingResult.storyboard}
              targetScript={targetScript}
              sourceFileName={understandingResult.fileName}
              resultMode={resultMode}
              usage={targetUsage}
              savedScriptId={savedScriptId}
              onBriefChange={setBrief}
              onTargetScriptChange={setTargetScript}
              onRegenerate={() => { void regenerate() }}
              onRestoreSource={restoreSource}
              onCancelAdaptation={runState === 'adapting' ? cancelAdaptation : undefined}
              onSave={() => { void saveScript() }}
              onGoWorkbench={goWorkbench}
            />
          ) : null}
        </div>

        {runState === 'submitting' ? (
          <div className="rv2-main-submit-overlay" role="status" aria-live="polite" aria-busy="true">
            <AppIcon name="loader" className="rv2-main-submit-overlay-icon" />
            <p className="rv2-main-submit-overlay-text">{submitCopy}</p>
            <div className="rv2-main-submit-overlay-progress"><span className="rv2-main-submit-overlay-progress-bar rv2-main-submit-overlay-progress-bar--indeterminate" /></div>
            <p className="rv2-main-submit-overlay-hint">服务端密钥不会返回浏览器；视频反译通常比文本生成耗时更长。</p>
            <button type="button" className="rv2-btn rv2-btn--secondary" onClick={cancelSubmit}>取消本次处理</button>
          </div>
        ) : null}

        {notice ? <div className="rv2-toast" role="status"><AppIcon name="info" className="h-4 w-4" /><span>{notice}</span><button type="button" aria-label="关闭提示" onClick={() => setNotice('')}><AppIcon name="close" className="h-3.5 w-3.5" /></button></div> : null}
      </main>
    </div>
  )
}
