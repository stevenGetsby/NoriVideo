import { NextRequest, NextResponse } from 'next/server'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError, getRequestId } from '@/lib/api-errors'
import { withTextBilling } from '@/lib/billing'
import { recordTextUsage } from '@/lib/billing/runtime-usage'
import { recordServiceUsage } from '@/lib/platform-services/usage'
import { sanitizePublicError } from '@/lib/errors/sanitize-public-error'
import {
  createVideoRepaintFileHandle,
  isVideoRepaintFileHandleConfigured,
  verifyVideoRepaintFileHandle,
} from '@/lib/video-repaint/file-handle'
import { VIDEO_REPAINT_PROJECT_ID } from '@/lib/video-repaint/contract'
import { startVideoTimingProbe, tidyCutTimes } from '@/lib/video-repaint/cut-detection'
import {
  assertSupportedVideoFile,
  getArkVideoUnderstandingConfig,
  getVideoUnderstandingApiKey,
  understandSourceStoryboardWithArk,
  understandVideoWithArk,
  type ArkProgressReporter,
  type VideoUnderstandingMode,
} from '@/lib/volcengine/video-understanding'

export const runtime = 'nodejs'
export const maxDuration = 600

const MAX_UNDERSTANDING_INPUT_TOKENS = 256_000
const MAX_UNDERSTANDING_OUTPUT_TOKENS = 32_000
const MAX_VIDEO_BYTES = 512 * 1024 * 1024
const MAX_MULTIPART_BYTES = MAX_VIDEO_BYTES + 8 * 1024 * 1024
const MAX_ANALYSIS_BYTES = 2 * 1024 * 1024
const MAX_EPISODE_SECONDS = 6 * 60 * 60
// The storyboard of a six-hour video would not fit either; the client is told to save what it has instead.
const MAX_STORYBOARD_CHARS = 400_000
const MAX_CUT_HINTS_IN = 5_000

type StreamSend = (event: 'progress' | 'result' | 'error', data: unknown) => void

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isVideoUnderstandingMode(value: unknown): value is VideoUnderstandingMode {
  return value === 'script' || value === 'board'
}

function clampEpisodeNumber(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number.NaN
  return Number.isInteger(parsed) ? Math.max(1, Math.min(999, parsed)) : 1
}

function actorId(session: { user: { id: string; actorId?: string } }): string {
  return session.user.actorId || session.user.id
}

function isAbortError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const normalized = error.message.toUpperCase()
  return error.name === 'AbortError' || normalized.includes('ABORTED') || normalized.includes('ABORT')
}

function providerFailureDetail(error: unknown, secret = ''): string {
  const raw = error instanceof Error ? error.message : String(error)
  const redacted = secret ? raw.split(secret).join('[已隐藏密钥]') : raw
  return sanitizePublicError(redacted)
    .replace(/\bark-[A-Za-z0-9-]{8,}/gi, '[已隐藏密钥]')
    .replace(/https?:\/\/[^\s"'<>]+/gi, '[已隐藏服务地址]')
    .slice(0, 240)
}

function rethrowVideoUnderstandingError(error: unknown, secret = ''): never {
  if (error instanceof ApiError) throw error
  const normalized = (error instanceof Error ? error.message : String(error)).toUpperCase()
  if (isAbortError(error)) {
    throw new ApiError('NETWORK_ERROR', { message: '视频反译请求已取消' })
  }
  if (normalized.includes('ARK_VIDEO_UNDERSTANDING_FILE_TOO_LARGE')) {
    throw new ApiError('INVALID_PARAMS', { message: '视频不能超过 512 MB' })
  }
  if (normalized.includes('ARK_VIDEO_UNDERSTANDING_FILE_INVALID')) {
    throw new ApiError('INVALID_PARAMS', { message: '仅支持 mp4 / mov / avi 视频文件' })
  }
  if (normalized.includes('VIDEO_REPAINT_FILE_HANDLE_SECRET_MISSING')) {
    throw new ApiError('MISSING_CONFIG', { message: '视频转绘会话签名密钥未配置，请联系管理员' })
  }
  if (normalized.includes('PROVIDER_API_KEY_MISSING')) {
    throw new ApiError('MISSING_CONFIG', { message: '视频理解服务未配置服务端密钥，请联系管理员' })
  }
  if (normalized.includes('STATUS 401') || normalized.includes('STATUS 403') || normalized.includes('INVALID API KEY')) {
    throw new ApiError('MISSING_CONFIG', { message: '视频理解服务鉴权失败，请联系管理员检查服务端配置' })
  }
  if (
    normalized.includes('STATUS 429')
    || normalized.includes('REQUEST BURST')
    || normalized.includes('RATE LIMIT')
    || normalized.includes('RATE_LIMIT')
  ) {
    throw new ApiError('RATE_LIMIT', { message: '视频理解服务请求过于集中，已自动重试仍未恢复，请等待约 1 分钟后重试' })
  }
  if (normalized.includes('PROCESS_TIMEOUT') || normalized.includes('TIMEOUT')) {
    throw new ApiError('GENERATION_TIMEOUT', { message: '视频理解超时，请稍后重试' })
  }
  if (normalized.includes('EMPTY_RESPONSE')) {
    throw new ApiError('EMPTY_RESPONSE', { message: '视频理解服务未返回有效结果，请重试' })
  }

  const detail = providerFailureDetail(error, secret)
  throw new ApiError('EXTERNAL_ERROR', {
    message: detail ? `视频理解服务暂时不可用：${detail}` : '视频理解服务暂时不可用，请稍后重试',
    provider: 'video-understanding',
  })
}

function toVideoUnderstandingError(error: unknown, secret = ''): ApiError {
  if (error instanceof ApiError) return error
  let mapped: unknown = error
  try {
    rethrowVideoUnderstandingError(error, secret)
  } catch (thrown) {
    mapped = thrown
  }
  return mapped instanceof ApiError
    ? mapped
    : new ApiError('EXTERNAL_ERROR', { message: '视频反译失败，请稍后重试' })
}

function wantsEventStream(request: NextRequest): boolean {
  return (request.headers.get('accept') || '').includes('text/event-stream')
}

/** Long-running Ark calls report progress over the same response so the client
 * does not need a second polling endpoint and nginx/proxies keep streaming. */
function eventStreamResponse(
  request: NextRequest,
  secret: string,
  run: (send: StreamSend, signal: AbortSignal) => Promise<void>,
): Response {
  const abort = new AbortController()
  const onRequestAbort = () => abort.abort()
  if (request.signal.aborted) abort.abort()
  else request.signal.addEventListener('abort', onRequestAbort, { once: true })

  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false
      const send: StreamSend = (event, data) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
        } catch {
          closed = true
        }
      }
      try {
        await run(send, abort.signal)
      } catch (error) {
        const apiError = toVideoUnderstandingError(error, secret)
        send('error', {
          success: false,
          error: { code: apiError.code, message: apiError.message, retryable: apiError.retryable },
        })
      } finally {
        closed = true
        request.signal.removeEventListener('abort', onRequestAbort)
        try {
          controller.close()
        } catch {
          // The client already disconnected; nothing left to flush.
        }
      }
    },
    cancel() {
      abort.abort()
      request.signal.removeEventListener('abort', onRequestAbort)
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}

function readUploadDuration(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(typeof value === 'string' ? value : '')
  return Number.isFinite(parsed) && parsed > 0 && parsed <= MAX_EPISODE_SECONDS ? parsed : null
}

function readAnalyzedDuration(analysis: Record<string, unknown>): number | null {
  const episode = isRecord(analysis.source_episode) ? analysis.source_episode : {}
  return readUploadDuration(episode.duration_seconds)
}

function assertAnalysisSize(analysis: Record<string, unknown>) {
  let serialized = ''
  try {
    serialized = JSON.stringify(analysis)
  } catch {
    throw new ApiError('INVALID_PARAMS', { message: '源剧本数据无法序列化' })
  }
  if (!serialized || serialized.length > MAX_ANALYSIS_BYTES) {
    throw new ApiError('INVALID_PARAMS', { message: '源剧本数据无效或过大' })
  }
}

interface UploadUnderstandingInput {
  userId: string
  ownerId: string
  requestId?: string
  apiKey: string
  billingModel: string
  model: string
  file: File
  mode: VideoUnderstandingMode
  episodeNumber: number
  uploadDuration: number | null
  signal: AbortSignal
  onProgress?: ArkProgressReporter
}

async function runUploadUnderstanding(input: UploadUnderstandingInput) {
  const startedAt = Date.now()
  // ffmpeg reads the real length and the cuts from a copy of the upload while Ark is still working on its own copy.
  const probe = startVideoTimingProbe(input.file, { signal: input.signal })
  try {
    // The length sets how densely Ark samples the video, so it is wanted before the upload starts. A few seconds at most.
    const knownDuration = readUploadDuration(await probe.duration) ?? input.uploadDuration
    let result
    try {
      result = await withTextBilling(
        input.userId,
        input.billingModel,
        MAX_UNDERSTANDING_INPUT_TOKENS,
        MAX_UNDERSTANDING_OUTPUT_TOKENS,
        {
          projectId: VIDEO_REPAINT_PROJECT_ID,
          action: input.mode === 'board'
            ? 'video_repaint_understanding_board'
            : 'video_repaint_understanding_script',
          requestId: input.requestId,
          metadata: {
            operation: input.mode === 'board' ? 'video-understanding-board' : 'video-understanding-script',
            episodeNumber: input.episodeNumber,
          },
        },
        async () => {
          const generated = await understandVideoWithArk({
            apiKey: input.apiKey,
            file: input.file,
            mode: input.mode,
            episodeNumber: input.episodeNumber,
            durationSeconds: knownDuration ?? undefined,
            model: input.model,
            signal: input.signal,
            onProgress: input.onProgress,
          })
          recordTextUsage({
            model: input.billingModel,
            inputTokens: generated.usage.inputTokens,
            outputTokens: generated.usage.outputTokens,
          })
          return generated
        },
      )
    } catch (error) {
      rethrowVideoUnderstandingError(error, input.apiKey)
    }

    if (!result.analysis) {
      throw new ApiError('EMPTY_RESPONSE', {
        message: '视频理解未返回可用的结构化剧本，请重试或更换视频',
      })
    }
    const durationSeconds = knownDuration ?? readAnalyzedDuration(result.analysis)
    if (!durationSeconds) {
      throw new ApiError('INVALID_PARAMS', {
        message: '无法读取视频时长，请更换视频后重试',
      })
    }

    await recordServiceUsage({
      provider: 'video-understanding',
      modelKey: input.billingModel,
      serviceType: 'video-repaint',
      operation: input.mode === 'board' ? 'video-understanding-board' : 'video-understanding-script',
      userId: input.ownerId,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      latencyMs: Date.now() - startedAt,
    })

    let fileHandle: string
    try {
      fileHandle = createVideoRepaintFileHandle({
        userId: input.ownerId,
        fileId: result.fileId,
        durationSeconds,
        episodeNumber: input.episodeNumber,
      })
    } catch (error) {
      rethrowVideoUnderstandingError(error, input.apiKey)
    }

    const scan = await probe.cuts
    const warnings = [...result.validation.warnings]
    if (scan.status !== 'done') {
      warnings.push('没能自动检测画面切点，分镜的镜头边界只依据视频理解，保存前请抽查时间码')
    }

    return {
      success: true as const,
      result: {
        fileHandle,
        script: result.episodeScript,
        analysis: result.analysis,
        durationSeconds,
        cutHints: tidyCutTimes(scan.cutTimes, durationSeconds),
        usage: result.usage,
        validation: { ...result.validation, warnings },
      },
    }
  } finally {
    await probe.dispose()
  }
}

interface StoryboardUnderstandingInput {
  userId: string
  ownerId: string
  requestId?: string
  apiKey: string
  billingModel: string
  model: string
  fileHandle: string
  handle: ReturnType<typeof verifyVideoRepaintFileHandle>
  sourceAnalysis: Record<string, unknown>
  cutHints: number[]
  /** The storyboard the earlier rounds wrote; the model carries on after its last shot. */
  continuation?: { storyboard: string }
  signal: AbortSignal
  onProgress?: ArkProgressReporter
}

async function runStoryboardUnderstanding(input: StoryboardUnderstandingInput) {
  const handle = input.handle
  if (!handle) {
    throw new ApiError('INVALID_PARAMS', { message: '视频会话已失效，请重新上传视频反译' })
  }
  const startedAt = Date.now()
  let storyboardResult
  try {
    storyboardResult = await withTextBilling(
      input.userId,
      input.billingModel,
      MAX_UNDERSTANDING_INPUT_TOKENS,
      MAX_UNDERSTANDING_OUTPUT_TOKENS,
      {
        projectId: VIDEO_REPAINT_PROJECT_ID,
        action: 'video_repaint_source_storyboard',
        requestId: input.requestId,
        metadata: {
          operation: 'source-storyboard',
          durationSeconds: handle.durationSeconds,
          episodeNumber: handle.episodeNumber,
          continued: Boolean(input.continuation),
        },
      },
      async () => {
        const generated = await understandSourceStoryboardWithArk({
          apiKey: input.apiKey,
          fileId: handle.fileId,
          sourceAnalysis: input.sourceAnalysis,
          durationSeconds: handle.durationSeconds,
          episodeNumber: handle.episodeNumber,
          cutHints: input.cutHints,
          continuation: input.continuation,
          model: input.model,
          signal: input.signal,
          onProgress: input.onProgress,
        })
        recordTextUsage({
          model: input.billingModel,
          inputTokens: generated.usage.inputTokens,
          outputTokens: generated.usage.outputTokens,
        })
        return generated
      },
    )
  } catch (error) {
    rethrowVideoUnderstandingError(error, input.apiKey)
  }

  await recordServiceUsage({
    provider: 'video-understanding',
    modelKey: input.billingModel,
    serviceType: 'video-repaint',
    operation: 'source-storyboard',
    userId: input.ownerId,
    inputTokens: storyboardResult.usage.inputTokens,
    outputTokens: storyboardResult.usage.outputTokens,
    latencyMs: Date.now() - startedAt,
  })

  return {
    success: true as const,
    result: {
      fileHandle: input.fileHandle,
      storyboard: storyboardResult.storyboard,
      complete: storyboardResult.complete,
      coveredSeconds: storyboardResult.coveredSeconds,
      durationSeconds: handle.durationSeconds,
      shotCount: storyboardResult.shotCount,
      addedShots: storyboardResult.addedShots,
      usage: storyboardResult.usage,
      validation: storyboardResult.validation,
    },
  }
}

function readCutHints(value: unknown, durationSeconds: number): number[] {
  if (!Array.isArray(value)) return []
  const inside = value
    .slice(0, MAX_CUT_HINTS_IN)
    .filter((item): item is number => typeof item === 'number' && Number.isFinite(item) && item > 0 && item < durationSeconds)
  return tidyCutTimes(inside, durationSeconds)
}

function readContinuation(value: unknown): { storyboard: string } | undefined {
  if (value === undefined || value === null) return undefined
  if (!isRecord(value) || typeof value.storyboard !== 'string') {
    throw new ApiError('INVALID_PARAMS', { message: '无法读取已生成的分镜内容' })
  }
  const storyboard = value.storyboard.trim()
  if (!storyboard) return undefined
  if (storyboard.length > MAX_STORYBOARD_CHARS) {
    throw new ApiError('INVALID_PARAMS', { message: '已生成的分镜过长，请先保存已有内容' })
  }
  return { storyboard }
}

function parseUploadForm(formData: FormData, apiKey: string) {
  const fileValue = formData.get('file')
  if (!(fileValue instanceof File)) {
    throw new ApiError('INVALID_PARAMS', { message: '请选择要反译的视频文件' })
  }
  try {
    assertSupportedVideoFile(fileValue)
  } catch (error) {
    rethrowVideoUnderstandingError(error, apiKey)
  }
  const modeValue = formData.get('mode')
  const mode = typeof modeValue === 'string' && isVideoUnderstandingMode(modeValue) ? modeValue : 'script'
  const episodeNumber = clampEpisodeNumber(Number.parseInt(String(formData.get('episodeNumber') ?? '1'), 10))
  const uploadDuration = readUploadDuration(formData.get('durationSeconds'))
  return { file: fileValue, mode, episodeNumber, uploadDuration }
}

export const GET = apiHandler(async () => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult

  const config = getArkVideoUnderstandingConfig()
  return NextResponse.json({
    success: true,
    configured: config.configured && isVideoRepaintFileHandleConfigured(),
    fps: config.fps,
    maxFileBytes: MAX_VIDEO_BYTES,
    supportedExtensions: ['mp4', 'mov', 'avi'],
  })
})

export const POST = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const userId = authResult.session.user.id
  const ownerId = actorId(authResult.session)
  const requestId = getRequestId(request)
  const config = getArkVideoUnderstandingConfig()
  if (!config.configured) {
    throw new ApiError('MISSING_CONFIG', { message: '视频理解服务未配置，请联系管理员' })
  }
  if (!isVideoRepaintFileHandleConfigured()) {
    throw new ApiError('MISSING_CONFIG', { message: '视频转绘会话签名密钥未配置，请联系管理员' })
  }
  const apiKey = getVideoUnderstandingApiKey()
  const billingModel = `ark::${config.model}`
  const streaming = wantsEventStream(request)

  if (request.headers.get('content-type')?.includes('application/json')) {
    const payload: unknown = await request.json().catch(() => null)
    if (!isRecord(payload) || payload.stage !== 'storyboard') {
      throw new ApiError('INVALID_PARAMS', { message: '无法读取分镜阶段参数' })
    }
    const fileHandle = typeof payload.fileHandle === 'string' ? payload.fileHandle : ''
    const handle = verifyVideoRepaintFileHandle(fileHandle, ownerId)
    if (!handle) {
      throw new ApiError('INVALID_PARAMS', {
        message: '视频会话已失效或不属于当前账号，请重新上传视频反译',
      })
    }
    const sourceAnalysis = isRecord(payload.sourceAnalysis) ? payload.sourceAnalysis : null
    if (!sourceAnalysis) {
      throw new ApiError('INVALID_PARAMS', { message: '缺少已确认的源剧本数据' })
    }
    // The storyboard only borrows labels and wording from the source script, so a script the model left rough is no reason to stop.
    assertAnalysisSize(sourceAnalysis)

    const runInput = {
      userId,
      ownerId,
      requestId,
      apiKey,
      billingModel,
      model: config.model,
      fileHandle,
      handle,
      sourceAnalysis,
      cutHints: readCutHints(payload.cutHints, handle.durationSeconds),
      continuation: readContinuation(payload.continuation),
    }
    if (!streaming) {
      return NextResponse.json(await runStoryboardUnderstanding({ ...runInput, signal: request.signal }))
    }
    return eventStreamResponse(request, apiKey, async (send, signal) => {
      send('progress', { stage: 'storyboard' })
      send('result', await runStoryboardUnderstanding({
        ...runInput,
        signal,
        onProgress: (progress) => send('progress', progress),
      }))
    })
  }

  const contentLength = Number(request.headers.get('content-length') || 0)
  if (Number.isFinite(contentLength) && contentLength > MAX_MULTIPART_BYTES) {
    throw new ApiError('INVALID_PARAMS', { message: '视频不能超过 512 MB' })
  }

  if (!streaming) {
    const formData = await request.formData().catch(() => null)
    if (!formData) throw new ApiError('INVALID_PARAMS', { message: '无法读取视频上传内容' })
    const params = parseUploadForm(formData, apiKey)
    return NextResponse.json(await runUploadUnderstanding({
      userId,
      ownerId,
      requestId,
      apiKey,
      billingModel,
      model: config.model,
      ...params,
      signal: request.signal,
    }))
  }

  return eventStreamResponse(request, apiKey, async (send, signal) => {
    send('progress', { stage: 'upload' })
    const formData = await request.formData().catch(() => null)
    if (!formData) throw new ApiError('INVALID_PARAMS', { message: '无法读取视频上传内容' })
    const params = parseUploadForm(formData, apiKey)
    send('progress', { stage: 'preprocess' })
    send('result', await runUploadUnderstanding({
      userId,
      ownerId,
      requestId,
      apiKey,
      billingModel,
      model: config.model,
      ...params,
      signal,
      onProgress: (progress) => send('progress', progress),
    }))
  })
})
