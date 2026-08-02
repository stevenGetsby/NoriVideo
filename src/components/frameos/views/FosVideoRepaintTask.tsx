'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from '@/i18n/navigation'
import { AppIcon } from '@/components/ui/icons'
import { FosVideoRepaintProgress } from './FosVideoRepaintProgress'
import { FosVideoRepaintRail } from './FosVideoRepaintRail'
import { FosVideoRepaintSetup } from './FosVideoRepaintSetup'
import {
  validateRepaintSetup,
  type LocalVideoItem,
  type RepaintResultMode,
  type RepaintRunState,
  type RepaintSetupErrors,
  type VideoUnderstandingEpisode,
} from './videoRepaintState'

const VIDEO_EXTENSION = /\.(mp4|mov|avi)$/i
const MAX_VIDEO_BYTES = 512 * 1024 * 1024

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
): Promise<VideoUnderstandingEpisode> {
  const localDurationPromise = readVideoDuration(video.url, signal)
  const formData = new FormData()
  formData.append('file', video.file, video.file.name)
  formData.append('mode', 'script')
  formData.append('episodeNumber', '1')
  formData.append('adaptationBrief', adaptationBrief)
  onPhase('upload')
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
  const sourceEpisode = analysis && isRecord(analysis.source_episode) ? analysis.source_episode : null
  const fallbackScript = sourceEpisode && typeof sourceEpisode.formatted_text === 'string'
    ? sourceEpisode.formatted_text
    : ''
  const fileId = typeof result.fileId === 'string' ? result.fileId : ''
  const localDuration = await localDurationPromise
  const analyzedDuration = sourceEpisode && typeof sourceEpisode.duration_seconds === 'number'
    ? sourceEpisode.duration_seconds
    : 0
  const durationSeconds = localDuration || analyzedDuration
  if (!fileId || !analysis || !durationSeconds) {
    throw new Error('视频反译未返回可用于分镜阶段的源数据')
  }

  onPhase('storyboard')
  const storyboardResponse = await fetch('/api/video-repaint/understand', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      stage: 'storyboard',
      fileId,
      sourceAnalysis: analysis,
      durationSeconds,
      episodeNumber: 1,
    }),
    signal,
  })
  const storyboardPayload: unknown = await storyboardResponse.json().catch(() => ({}))
  if (!storyboardResponse.ok || !isRecord(storyboardPayload) || !isRecord(storyboardPayload.result)) {
    throw new Error(readApiError(storyboardPayload) || `源分镜提取失败（HTTP ${storyboardResponse.status}）`)
  }
  const storyboardResult = storyboardPayload.result
  const storyboardUsage = isRecord(storyboardResult.usage) ? storyboardResult.usage : {}
  const storyboardValidation = isRecord(storyboardResult.validation) ? storyboardResult.validation : {}
  const scriptErrors = Array.isArray(validation.errors) ? validation.errors.filter((item): item is string => typeof item === 'string') : []
  const storyboardErrors = Array.isArray(storyboardValidation.errors) ? storyboardValidation.errors.filter((item): item is string => typeof item === 'string') : []
  const scriptWarnings = Array.isArray(validation.warnings) ? validation.warnings.filter((item): item is string => typeof item === 'string') : []
  const storyboardWarnings = Array.isArray(storyboardValidation.warnings) ? storyboardValidation.warnings.filter((item): item is string => typeof item === 'string') : []

  return {
    fileName: video.file.name,
    model: typeof storyboardResult.model === 'string' ? storyboardResult.model : typeof result.model === 'string' ? result.model : '',
    script: typeof result.script === 'string' ? result.script : fallbackScript,
    storyboard: typeof storyboardResult.storyboard === 'string' ? storyboardResult.storyboard : '',
    text: typeof result.text === 'string' ? result.text : '',
    analysis,
    usage: {
      inputTokens: (typeof usage.inputTokens === 'number' ? usage.inputTokens : 0) + (typeof storyboardUsage.inputTokens === 'number' ? storyboardUsage.inputTokens : 0),
      outputTokens: (typeof usage.outputTokens === 'number' ? usage.outputTokens : 0) + (typeof storyboardUsage.outputTokens === 'number' ? storyboardUsage.outputTokens : 0),
    },
    validation: {
      valid: validation.valid === true && storyboardValidation.valid === true,
      errors: [...scriptErrors, ...storyboardErrors],
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

export function FosVideoRepaintTask({ scriptId = 'new' }: { scriptId?: string }) {
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
  const [targetModel, setTargetModel] = useState('')
  const [targetUsage, setTargetUsage] = useState({ inputTokens: 0, outputTokens: 0 })
  const [savedScriptId, setSavedScriptId] = useState('')
  const videosRef = useRef<LocalVideoItem[]>([])
  const requestAbortRef = useRef<AbortController | null>(null)

  useEffect(() => { videosRef.current = videos }, [videos])
  useEffect(() => () => {
    requestAbortRef.current?.abort()
    videosRef.current.forEach((video) => URL.revokeObjectURL(video.url))
  }, [])

  const addFiles = (incoming: File[]) => {
    const file = incoming.find((item) => VIDEO_EXTENSION.test(item.name))
    if (!file) {
      setErrors((current) => ({ ...current, videos: '仅支持 mp4 / mov / avi 视频文件' }))
      return
    }
    if (file.size <= 0 || file.size > MAX_VIDEO_BYTES) {
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
    setTargetModel(adapted.model)
    setTargetUsage(adapted.usage)
  }

  const submit = async () => {
    const nextErrors = validateRepaintSetup({ title, brief, videoCount: videos.length })
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length) {
      setNotice('请先完成任务名称并上传一个视频')
      return
    }
    const video = videos[0]
    if (!video) return
    setNotice('')
    requestAbortRef.current?.abort()
    const controller = new AbortController()
    requestAbortRef.current = controller
    setRunState('submitting')
    setSubmitPhase('upload')
    let completedSource: VideoUnderstandingEpisode | null = null
    try {
      const source = await understandOneVideo(video, controller.signal, brief, setSubmitPhase)
      completedSource = source
      if (controller.signal.aborted) return
      setUnderstandingResult(source)
      if (brief.trim()) {
        setRunState('adapting')
        applyAdaptation(await requestAdaptation({ title, brief, result: source, signal: controller.signal }))
      } else {
        applyAdaptation({
          script: source.script,
          mode: 'source_copy',
          model: '',
          usage: { inputTokens: 0, outputTokens: 0 },
        })
      }
      if (!controller.signal.aborted) setRunState('review')
    } catch (error) {
      if (controller.signal.aborted) return
      const message = error instanceof Error ? error.message : '视频转绘失败，请稍后重试'
      if (completedSource) {
        setUnderstandingResult(completedSource)
        setTargetScript('')
        setResultMode('llm')
        setRunState('review')
      } else {
        setRunState('setup')
        setErrors((current) => ({ ...current, videos: message }))
      }
      setNotice(message)
    } finally {
      if (requestAbortRef.current === controller) requestAbortRef.current = null
    }
  }

  const regenerate = async () => {
    if (!understandingResult) return
    if (!brief.trim()) {
      applyAdaptation({ script: understandingResult.script, mode: 'source_copy', model: '', usage: { inputTokens: 0, outputTokens: 0 } })
      setNotice('未填写转绘要求，已恢复为原剧本；没有调用文本 LLM。')
      return
    }
    setNotice('')
    setRunState('adapting')
    try {
      applyAdaptation(await requestAdaptation({ title, brief, result: understandingResult }))
      setRunState('review')
    } catch (error) {
      setRunState('review')
      setNotice(error instanceof Error ? error.message : '转绘剧本重新生成失败')
    }
  }

  const restoreSource = () => {
    if (!understandingResult) return
    applyAdaptation({ script: understandingResult.script, mode: 'source_copy', model: '', usage: { inputTokens: 0, outputTokens: 0 } })
    setNotice('已将右侧转绘稿恢复为原剧本。')
  }

  const saveScript = async () => {
    if (!understandingResult || !targetScript.trim()) return
    setRunState('saving')
    setNotice('')
    try {
      const response = await fetch('/api/video-repaint/scripts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          targetScript,
          sourceScript: understandingResult.script,
          sourceStoryboard: understandingResult.storyboard,
          sourceAnalysis: understandingResult.analysis,
          adaptationBrief: brief,
          resultMode,
          model: targetModel,
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
    } catch (error) {
      setRunState('review')
      setNotice(error instanceof Error ? error.message : '剧本保存失败')
    }
  }

  const goWorkbench = () => router.push({ pathname: '/writer-workbench' })
  const submitCopy = submitPhase === 'upload'
    ? '正在上传视频并等待火山方舟完成理解…'
    : submitPhase === 'script'
      ? '原剧本已返回，正在校验源数据…'
      : '正在根据真实剪辑点提取原分镜…'

  return (
    <div className="rv2-wizard">
      <FosVideoRepaintRail state={runState} onBack={goWorkbench} />
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
              sourceModel={understandingResult.model}
              targetModel={targetModel}
              resultMode={resultMode}
              usage={targetUsage}
              savedScriptId={savedScriptId}
              onBriefChange={setBrief}
              onTargetScriptChange={setTargetScript}
              onRegenerate={() => { void regenerate() }}
              onRestoreSource={restoreSource}
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
            <p className="rv2-main-submit-overlay-hint">API Key 只在服务端使用；视频反译通常比文本生成耗时更长。</p>
          </div>
        ) : null}

        {notice ? <div className="rv2-toast" role="status"><AppIcon name="info" className="h-4 w-4" /><span>{notice}</span><button type="button" aria-label="关闭提示" onClick={() => setNotice('')}><AppIcon name="close" className="h-3.5 w-3.5" /></button></div> : null}
      </main>
    </div>
  )
}
