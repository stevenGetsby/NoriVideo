import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const authMock = vi.hoisted(() => ({
  requireUserAuth: vi.fn(),
  isErrorResponse: (value: unknown) => value instanceof Response,
}))
const billingMock = vi.hoisted(() => ({
  withTextBilling: vi.fn(),
}))
const usageMock = vi.hoisted(() => ({
  recordTextUsage: vi.fn(),
}))
const serviceUsageMock = vi.hoisted(() => ({
  recordServiceUsage: vi.fn(async () => undefined),
}))
const providerMock = vi.hoisted(() => ({
  understandVideoWithArk: vi.fn(),
  understandSourceStoryboardWithArk: vi.fn(),
}))
const probeMock = vi.hoisted(() => ({
  startVideoTimingProbe: vi.fn(),
}))

vi.mock('@/lib/api-auth', () => authMock)
vi.mock('@/lib/billing', () => billingMock)
vi.mock('@/lib/billing/runtime-usage', () => usageMock)
vi.mock('@/lib/platform-services/usage', () => serviceUsageMock)
vi.mock('@/lib/volcengine/video-understanding', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/volcengine/video-understanding')>()
  return {
    ...actual,
    understandVideoWithArk: providerMock.understandVideoWithArk,
    understandSourceStoryboardWithArk: providerMock.understandSourceStoryboardWithArk,
  }
})
// ffmpeg itself is exercised in cut-detection.test.ts; here only what the route does with its answers matters.
vi.mock('@/lib/video-repaint/cut-detection', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/video-repaint/cut-detection')>()
  return { ...actual, startVideoTimingProbe: probeMock.startVideoTimingProbe }
})

import { createVideoRepaintFileHandle, verifyVideoRepaintFileHandle } from '@/lib/video-repaint/file-handle'
import { VIDEO_REPAINT_ANALYSIS_SCHEMA_VERSION } from '@/lib/volcengine/video-understanding-contract'

const session = { user: { id: 'user-1', actorId: 'actor-1' } }

function analysis(durationSeconds = 12.5) {
  return {
    schema_version: VIDEO_REPAINT_ANALYSIS_SCHEMA_VERSION,
    analysis_mode: 'board',
    series_metadata: {},
    source_episode: {
      episode_number: 1,
      duration_seconds: durationSeconds,
      formatted_text: '第1集\n1-1\n场景：测试房间 - 夜 - 暗\n人物：测试人物\n△测试人物抬头。',
      scenes: [{
        scene_id: 'E01-S01',
        scene_number: '1-1',
        beats: [{ beat_id: 'E01-S01-B01', type: 'stage_direction', text: '测试人物抬头。' }],
      }],
    },
    asset_candidates: {
      characters: [{ asset_ref: 'character_1', name_if_heard: '测试人物' }],
      locations: [{ asset_ref: 'location_1', name_if_known: '测试房间' }],
      props: [],
    },
    adaptation_contract: {
      story_invariants: [],
      character_function_invariants: [],
      relationship_invariants: [],
      causal_chain: [],
      hook_map: [],
      localization_candidates: [],
      do_not_localize: [],
      cultural_risks: [],
    },
    quality_report: {},
  }
}

function providerResult(overrides?: Record<string, unknown>) {
  return {
    fileId: 'file-secret-provider-id',
    model: 'test-ark-model',
    fps: 0.5,
    text: 'raw model text',
    episodeScript: '第1集\n1-1\n场景：测试房间 - 夜 - 暗\n人物：测试人物\n△测试人物抬头。',
    analysis: analysis(),
    usage: { inputTokens: 120, outputTokens: 30 },
    validation: { valid: true, errors: [], warnings: [] },
    ...overrides,
  }
}

const STORYBOARD = [
  '## S1 [测试房间 · 夜间 · 内] 角色：测试人物',
  '造型：测试人物=青年、黑色短发、灰色卫衣',
  '',
  '### SH001 [00:00.0-00:06.0]',
  '镜头：中景，平视，固定镜头，标准 50mm，浅景深焦在人物，常速，三脚架固定。镜头从人物上半身起，中段无变化，落点在人物眼神。',
  '画面：测试人物坐在画面中央，身后是亮着台灯的书桌。',
  '表情动作：测试人物缓缓抬头，眼神由茫然转为警觉——满腔戒备。',
  '光影：台灯暖色顶光，面部左侧略暗。',
  '',
  '### SH002 [00:06.0-00:12.5]',
  '镜头：近景，平视，缓慢推近，标准 50mm，浅景深焦在人物，常速，稳定器固定。镜头从肩部起，中段推向面部，落点在嘴唇。',
  '画面：人物面部占满画面，背景虚化成暖黄色光斑。',
  '表情动作：人物低声说话，嘴唇微颤——强压的恐惧。',
  '光影：暖色台灯侧光，鼻梁一侧有柔和阴影。',
  '测试人物 (对口型·低声)：{我不会再回去了。}',
].join('\n')

function storyboardResult(overrides?: Record<string, unknown>) {
  return {
    fileId: 'file-secret-provider-id',
    model: 'test-ark-model',
    text: 'raw storyboard text',
    storyboard: STORYBOARD,
    complete: true,
    coveredSeconds: 12.5,
    shotCount: 2,
    addedShots: 2,
    usage: { inputTokens: 80, outputTokens: 40 },
    validation: { valid: true, errors: [], warnings: [] },
    ...overrides,
  }
}

interface ProbeAnswers {
  duration?: number | null
  cuts?: { status: 'done' | 'skipped' | 'failed'; cutTimes: number[] }
}

/** Stands in for the ffmpeg probe; the returned spy shows whether the temporary copy was cleaned up. */
function installProbe(answers: ProbeAnswers = {}) {
  const dispose = vi.fn(async () => undefined)
  probeMock.startVideoTimingProbe.mockImplementation(() => ({
    duration: Promise.resolve(answers.duration ?? null),
    cuts: Promise.resolve(answers.cuts ?? { status: 'done', cutTimes: [] }),
    dispose,
  }))
  return dispose
}

function multipartRequest(overrides?: { file?: File; durationSeconds?: string; accept?: string }) {
  const form = new FormData()
  form.set('file', overrides?.file ?? new File([new Uint8Array([0, 1, 2])], 'demo.mp4', { type: 'video/mp4' }))
  form.set('mode', 'board')
  form.set('episodeNumber', '1')
  if (overrides?.durationSeconds !== undefined) form.set('durationSeconds', overrides.durationSeconds)
  return new NextRequest('http://localhost/api/video-repaint/understand', {
    method: 'POST',
    headers: overrides?.accept ? { Accept: overrides.accept } : undefined,
    body: form,
  })
}

function parseSse(body: string): Array<{ event: string; data: unknown }> {
  return body.split('\n\n').filter(Boolean).map((block) => {
    const lines = block.split('\n')
    const event = lines.find((line) => line.startsWith('event: '))?.slice(7) ?? ''
    const data = lines.find((line) => line.startsWith('data: '))?.slice(6) ?? ''
    return { event, data: data ? JSON.parse(data) : null }
  })
}

function jsonRequest(payload: unknown, accept?: string) {
  return new NextRequest('http://localhost/api/video-repaint/understand', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(accept ? { Accept: accept } : {}) },
    body: JSON.stringify(payload),
  })
}

function storyboardHandle(overrides?: { userId?: string; durationSeconds?: number; episodeNumber?: number }) {
  return createVideoRepaintFileHandle({
    userId: overrides?.userId ?? 'actor-1',
    fileId: 'file-secret-provider-id',
    durationSeconds: overrides?.durationSeconds ?? 12.5,
    episodeNumber: overrides?.episodeNumber ?? 1,
  })
}

async function readError(response: Response) {
  const payload = await response.json()
  return payload.error
}

const ROUTE_CONTEXT = { params: Promise.resolve({}) }

async function loadRoute() {
  return await import('@/app/api/video-repaint/understand/route')
}

describe('/api/video-repaint/understand', () => {
  const originalKey = process.env.ARK_API_KEY
  const originalModel = process.env.ARK_VIDEO_UNDERSTANDING_MODEL
  const originalSecret = process.env.VIDEO_REPAINT_FILE_HANDLE_SECRET
  const originalNextAuthSecret = process.env.NEXTAUTH_SECRET
  const originalEncryptionKey = process.env.API_ENCRYPTION_KEY

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.ARK_API_KEY = 'server-only-test-key'
    process.env.ARK_VIDEO_UNDERSTANDING_MODEL = 'test-ark-model'
    process.env.VIDEO_REPAINT_FILE_HANDLE_SECRET = 'test-handle-secret'
    authMock.requireUserAuth.mockResolvedValue({ session })
    billingMock.withTextBilling.mockImplementation(async (...args: unknown[]) => {
      const generateFn = args[5] as () => Promise<unknown>
      return await generateFn()
    })
    providerMock.understandVideoWithArk.mockReset()
    providerMock.understandSourceStoryboardWithArk.mockReset()
    installProbe()
  })

  afterEach(() => {
    if (originalKey === undefined) delete process.env.ARK_API_KEY
    else process.env.ARK_API_KEY = originalKey
    if (originalModel === undefined) delete process.env.ARK_VIDEO_UNDERSTANDING_MODEL
    else process.env.ARK_VIDEO_UNDERSTANDING_MODEL = originalModel
    if (originalSecret === undefined) delete process.env.VIDEO_REPAINT_FILE_HANDLE_SECRET
    else process.env.VIDEO_REPAINT_FILE_HANDLE_SECRET = originalSecret
    if (originalNextAuthSecret === undefined) delete process.env.NEXTAUTH_SECRET
    else process.env.NEXTAUTH_SECRET = originalNextAuthSecret
    if (originalEncryptionKey === undefined) delete process.env.API_ENCRYPTION_KEY
    else process.env.API_ENCRYPTION_KEY = originalEncryptionKey
  })

  it('requires an authenticated account before exposing configuration or calling Ark', async () => {
    authMock.requireUserAuth.mockResolvedValueOnce(NextResponse.json({ success: false }, { status: 401 }))
    const { GET, POST } = await loadRoute()

    const read = await GET(new NextRequest('http://localhost/api/video-repaint/understand') as never, ROUTE_CONTEXT)
    expect(read.status).toBe(401)

    authMock.requireUserAuth.mockResolvedValueOnce(NextResponse.json({ success: false }, { status: 401 }))
    const upload = await POST(multipartRequest() as never, ROUTE_CONTEXT)
    expect(upload.status).toBe(401)

    authMock.requireUserAuth.mockResolvedValueOnce(NextResponse.json({ success: false }, { status: 401 }))
    const storyboard = await POST(jsonRequest({ stage: 'storyboard', fileHandle: storyboardHandle(), sourceAnalysis: analysis() }) as never, ROUTE_CONTEXT)
    expect(storyboard.status).toBe(401)

    expect(billingMock.withTextBilling).not.toHaveBeenCalled()
    expect(probeMock.startVideoTimingProbe).not.toHaveBeenCalled()
    expect(providerMock.understandVideoWithArk).not.toHaveBeenCalled()
    expect(providerMock.understandSourceStoryboardWithArk).not.toHaveBeenCalled()
  })

  it('reports readiness without exposing the provider model or key', async () => {
    const { GET } = await loadRoute()
    const response = await GET(new NextRequest('http://localhost/api/video-repaint/understand') as never, ROUTE_CONTEXT)
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toEqual({
      success: true,
      configured: true,
      fps: 0.5,
      maxFileBytes: 512 * 1024 * 1024,
      supportedExtensions: ['mp4', 'mov', 'avi'],
    })
    expect(JSON.stringify(payload)).not.toContain('test-ark-model')
    expect(JSON.stringify(payload)).not.toContain('server-only-test-key')
  })

  describe('source script stage (video upload)', () => {
    it('bills the upload before calling Ark and returns a signed, account-bound handle', async () => {
      providerMock.understandVideoWithArk.mockResolvedValue(providerResult())
      const { POST } = await loadRoute()
      const response = await POST(multipartRequest({ durationSeconds: '12.5' }) as never, ROUTE_CONTEXT)
      const payload = await response.json()

      expect(response.status).toBe(200)
      expect(billingMock.withTextBilling).toHaveBeenCalledWith(
        'user-1',
        'ark::test-ark-model',
        256_000,
        32_000,
        expect.objectContaining({
          projectId: 'video-repaint',
          action: 'video_repaint_understanding_board',
          metadata: expect.objectContaining({ operation: 'video-understanding-board', episodeNumber: 1 }),
        }),
        expect.any(Function),
      )
      expect(providerMock.understandVideoWithArk).toHaveBeenCalledWith(expect.objectContaining({
        apiKey: 'server-only-test-key',
        mode: 'board',
        episodeNumber: 1,
        durationSeconds: 12.5,
        model: 'test-ark-model',
      }))
      expect(usageMock.recordTextUsage).toHaveBeenCalledWith({
        model: 'ark::test-ark-model',
        inputTokens: 120,
        outputTokens: 30,
      })
      expect(serviceUsageMock.recordServiceUsage).toHaveBeenCalledWith(expect.objectContaining({
        provider: 'video-understanding',
        modelKey: 'ark::test-ark-model',
        operation: 'video-understanding-board',
        userId: 'actor-1',
        inputTokens: 120,
        outputTokens: 30,
      }))

      expect(payload.result.durationSeconds).toBe(12.5)
      expect(payload.result.script).toContain('第1集')
      expect(payload.result.analysis.asset_candidates.characters).toHaveLength(1)
      expect(payload.result.cutHints).toEqual([])
      expect(payload.result.usage).toEqual({ inputTokens: 120, outputTokens: 30 })
      // The 分镜 is a separate stage now; the first stage no longer carries one.
      expect(payload.result).not.toHaveProperty('storyboard')
      expect(payload.result.analysis).not.toHaveProperty('source_storyboard')
      const handle = verifyVideoRepaintFileHandle(payload.result.fileHandle, 'actor-1')
      expect(handle).toEqual(expect.objectContaining({
        fileId: 'file-secret-provider-id',
        durationSeconds: 12.5,
        episodeNumber: 1,
      }))
      expect(JSON.stringify(payload)).not.toContain('file-secret-provider-id')
      expect(JSON.stringify(payload)).not.toContain('server-only-test-key')
      expect(JSON.stringify(payload)).not.toContain('raw model text')
    })

    it('hands the upload and the request signal to the ffmpeg probe', async () => {
      providerMock.understandVideoWithArk.mockResolvedValue(providerResult())
      const { POST } = await loadRoute()
      await POST(multipartRequest() as never, ROUTE_CONTEXT)

      expect(probeMock.startVideoTimingProbe).toHaveBeenCalledTimes(1)
      const [file, options] = probeMock.startVideoTimingProbe.mock.calls[0] as [File, { signal: AbortSignal }]
      expect(file.name).toBe('demo.mp4')
      expect(options.signal).toBeInstanceOf(AbortSignal)
    })

    it('trusts the measured length over the one the browser reported and samples frames by it', async () => {
      installProbe({ duration: 183.4 })
      providerMock.understandVideoWithArk.mockResolvedValue(providerResult())
      const { POST } = await loadRoute()
      const response = await POST(multipartRequest({ durationSeconds: '12.5' }) as never, ROUTE_CONTEXT)
      const payload = await response.json()

      expect(response.status).toBe(200)
      expect(providerMock.understandVideoWithArk).toHaveBeenCalledWith(expect.objectContaining({ durationSeconds: 183.4 }))
      expect(payload.result.durationSeconds).toBe(183.4)
      expect(verifyVideoRepaintFileHandle(payload.result.fileHandle, 'actor-1')?.durationSeconds).toBe(183.4)
    })

    it('falls back to the browser length, then to the analyzed one, when ffmpeg cannot measure it', async () => {
      providerMock.understandVideoWithArk.mockResolvedValue(providerResult())
      const { POST } = await loadRoute()

      const reported = await (await POST(multipartRequest({ durationSeconds: '9.25' }) as never, ROUTE_CONTEXT)).json()
      expect(reported.result.durationSeconds).toBe(9.25)
      expect(providerMock.understandVideoWithArk).toHaveBeenLastCalledWith(expect.objectContaining({ durationSeconds: 9.25 }))

      const analyzed = await (await POST(multipartRequest() as never, ROUTE_CONTEXT)).json()
      expect(analyzed.result.durationSeconds).toBe(12.5)
      expect(providerMock.understandVideoWithArk).toHaveBeenLastCalledWith(expect.objectContaining({ durationSeconds: undefined }))
      expect(verifyVideoRepaintFileHandle(analyzed.result.fileHandle, 'actor-1')?.durationSeconds).toBe(12.5)
    })

    it('stops when no length can be found anywhere', async () => {
      providerMock.understandVideoWithArk.mockResolvedValue(providerResult({ analysis: analysis(0) }))
      const { POST } = await loadRoute()
      const response = await POST(multipartRequest() as never, ROUTE_CONTEXT)

      expect(response.status).toBe(400)
      expect((await readError(response)).code).toBe('INVALID_PARAMS')
    })

    it('returns the detected cuts as hints, tidied against the real length', async () => {
      installProbe({ duration: 12.5, cuts: { status: 'done', cutTimes: [12.45, 8, 0.1, 3.2, 3.0004] } })
      providerMock.understandVideoWithArk.mockResolvedValue(providerResult())
      const { POST } = await loadRoute()
      const response = await POST(multipartRequest() as never, ROUTE_CONTEXT)
      const payload = await response.json()

      // 0.1 s and 12.45 s sit on the first and last instants; 3.2 s belongs to the same dissolve as 3.0 s.
      expect(payload.result.cutHints).toEqual([3, 8])
      expect(payload.result.validation.warnings).toEqual([])
    })

    it.each(['failed', 'skipped'] as const)('warns instead of failing when the cut scan was %s', async (status) => {
      installProbe({ duration: 12.5, cuts: { status, cutTimes: [] } })
      providerMock.understandVideoWithArk.mockResolvedValue(providerResult({
        validation: { valid: true, errors: [], warnings: ['源剧本输出被中途截断'] },
      }))
      const { POST } = await loadRoute()
      const response = await POST(multipartRequest() as never, ROUTE_CONTEXT)
      const payload = await response.json()

      expect(response.status).toBe(200)
      expect(payload.result.cutHints).toEqual([])
      expect(payload.result.validation.valid).toBe(true)
      expect(payload.result.validation.warnings).toEqual([
        '源剧本输出被中途截断',
        expect.stringContaining('没能自动检测画面切点'),
      ])
    })

    it('asks for a retry when the model returned no usable script', async () => {
      providerMock.understandVideoWithArk.mockResolvedValue(providerResult({ analysis: null }))
      const { POST } = await loadRoute()
      const response = await POST(multipartRequest({ durationSeconds: '12.5' }) as never, ROUTE_CONTEXT)

      expect(response.status).toBe(502)
      expect((await readError(response)).code).toBe('EMPTY_RESPONSE')
      expect(serviceUsageMock.recordServiceUsage).not.toHaveBeenCalled()
    })

    it('streams stage progress and the final result when the client accepts SSE', async () => {
      providerMock.understandVideoWithArk.mockImplementation(async (options: {
        onProgress?: (progress: unknown) => void
      }) => {
        options.onProgress?.({ stage: 'preprocess', elapsedSeconds: 3 })
        options.onProgress?.({ stage: 'analyze', outputChars: 12 })
        return providerResult()
      })
      const { POST } = await loadRoute()
      const response = await POST(
        multipartRequest({ durationSeconds: '12.5', accept: 'text/event-stream' }) as never,
        ROUTE_CONTEXT,
      )

      expect(response.headers.get('content-type')).toContain('text/event-stream')
      expect(response.headers.get('x-accel-buffering')).toBe('no')
      const events = parseSse(await response.text())
      expect(events[0]).toEqual({ event: 'progress', data: { stage: 'upload' } })
      expect(events.map((item) => item.event)).toEqual(['progress', 'progress', 'progress', 'progress', 'result'])
      expect(events[1]?.data).toEqual({ stage: 'preprocess' })
      expect(events[2]?.data).toEqual({ stage: 'preprocess', elapsedSeconds: 3 })
      expect(events[3]?.data).toEqual({ stage: 'analyze', outputChars: 12 })

      const result = (events[4]?.data as { result?: Record<string, unknown> } | null)?.result
      expect(result?.script).toContain('第1集')
      expect(result?.durationSeconds).toBe(12.5)
      expect(result?.cutHints).toEqual([])
      expect(JSON.stringify(events)).not.toContain('server-only-test-key')
      expect(JSON.stringify(events)).not.toContain('file-secret-provider-id')
    })

    it('reports streamed provider failures as SSE error events with mapped codes', async () => {
      providerMock.understandVideoWithArk.mockRejectedValue(
        new Error('ARK_VIDEO_UNDERSTANDING_RESPONSE_FAILED: status 429 - request burst'),
      )
      const { POST } = await loadRoute()
      const response = await POST(
        multipartRequest({ accept: 'text/event-stream' }) as never,
        ROUTE_CONTEXT,
      )
      expect(response.status).toBe(200)

      const events = parseSse(await response.text())
      const failure = events.find((item) => item.event === 'error')
      expect(failure?.data).toEqual(expect.objectContaining({
        success: false,
        error: expect.objectContaining({ code: 'RATE_LIMIT' }),
      }))
    })

    it('rejects unsupported or missing files before billing, probing or provider calls', async () => {
      const { POST } = await loadRoute()
      const webm = new File([new Uint8Array([0])], 'demo.webm', { type: 'video/webm' })
      const invalid = await POST(multipartRequest({ file: webm }) as never, ROUTE_CONTEXT)
      expect(invalid.status).toBe(400)
      expect((await readError(invalid)).code).toBe('INVALID_PARAMS')

      const emptyForm = new FormData()
      emptyForm.set('mode', 'script')
      const missing = await POST(new NextRequest('http://localhost/api/video-repaint/understand', {
        method: 'POST',
        body: emptyForm,
      }) as never, ROUTE_CONTEXT)
      expect(missing.status).toBe(400)

      expect(billingMock.withTextBilling).not.toHaveBeenCalled()
      expect(probeMock.startVideoTimingProbe).not.toHaveBeenCalled()
      expect(providerMock.understandVideoWithArk).not.toHaveBeenCalled()
    })

    it('blocks the upload when the server-side key or handle secret is missing', async () => {
      const { POST } = await loadRoute()
      delete process.env.ARK_API_KEY
      const missingKey = await POST(multipartRequest() as never, ROUTE_CONTEXT)
      expect(missingKey.status).toBe(400)
      expect((await readError(missingKey)).code).toBe('MISSING_CONFIG')

      process.env.ARK_API_KEY = 'server-only-test-key'
      delete process.env.VIDEO_REPAINT_FILE_HANDLE_SECRET
      delete process.env.NEXTAUTH_SECRET
      delete process.env.API_ENCRYPTION_KEY
      const missingSecret = await POST(multipartRequest() as never, ROUTE_CONTEXT)
      expect(missingSecret.status).toBe(400)
      expect((await readError(missingSecret)).code).toBe('MISSING_CONFIG')

      expect(billingMock.withTextBilling).not.toHaveBeenCalled()
      expect(providerMock.understandVideoWithArk).not.toHaveBeenCalled()
    })

    it('surfaces provider authentication failures without leaking the key', async () => {
      providerMock.understandVideoWithArk.mockRejectedValue(
        new Error('ARK_VIDEO_UNDERSTANDING_RESPONSE_FAILED: status 401 - invalid API key server-only-test-key'),
      )
      const { POST } = await loadRoute()
      const response = await POST(multipartRequest() as never, ROUTE_CONTEXT)
      const error = await readError(response)

      expect(response.status).toBe(400)
      expect(error.code).toBe('MISSING_CONFIG')
      expect(error.message).not.toContain('server-only-test-key')
      expect(JSON.stringify(error)).not.toContain('https://')
    })

    it('maps Ark burst protection to a friendly retryable rate-limit error', async () => {
      providerMock.understandVideoWithArk.mockRejectedValue(
        new Error(
          'ARK_VIDEO_UNDERSTANDING_RESPONSE_FAILED: status 429 - System protection triggered by request burst. '
          + 'Please slow down traffic growth and increase requests gradually before retrying. Request id: 021794208822699bbc1b38287ece59059a49659ad58bad9',
        ),
      )
      const { POST } = await loadRoute()
      const response = await POST(multipartRequest() as never, ROUTE_CONTEXT)
      const error = await readError(response)

      expect(response.status).toBe(429)
      expect(error.code).toBe('RATE_LIMIT')
      expect(error.message).toContain('视频理解服务请求过于集中')
      expect(error.message).not.toContain('System protection')
      expect(error.message).not.toContain('021794208822699')
    })

    it('maps caller cancellation to a network error and stops provider retries', async () => {
      providerMock.understandVideoWithArk.mockRejectedValue(new Error('ARK_VIDEO_UNDERSTANDING_ABORTED: request aborted'))
      const { POST } = await loadRoute()
      const response = await POST(multipartRequest() as never, ROUTE_CONTEXT)

      expect(response.status).toBe(502)
      expect((await readError(response)).code).toBe('NETWORK_ERROR')
      expect(providerMock.understandVideoWithArk).toHaveBeenCalledTimes(1)
    })

    it('does not contact the provider when billing rejects the request', async () => {
      const { ApiError } = await import('@/lib/api-errors')
      billingMock.withTextBilling.mockRejectedValueOnce(new ApiError('INSUFFICIENT_BALANCE'))
      const { POST } = await loadRoute()
      const response = await POST(multipartRequest() as never, ROUTE_CONTEXT)

      expect(response.status).toBe(402)
      expect((await readError(response)).code).toBe('INSUFFICIENT_BALANCE')
      expect(providerMock.understandVideoWithArk).not.toHaveBeenCalled()
    })

    it('removes the temporary copy of the upload on every path', async () => {
      const { ApiError } = await import('@/lib/api-errors')
      const { POST } = await loadRoute()

      let dispose = installProbe({ duration: 12.5 })
      providerMock.understandVideoWithArk.mockResolvedValueOnce(providerResult())
      expect((await POST(multipartRequest() as never, ROUTE_CONTEXT)).status).toBe(200)
      expect(dispose).toHaveBeenCalledTimes(1)

      dispose = installProbe({ duration: 12.5 })
      providerMock.understandVideoWithArk.mockRejectedValueOnce(new Error('ARK_VIDEO_UNDERSTANDING_RESPONSE_FAILED: status 500 - boom'))
      expect((await POST(multipartRequest() as never, ROUTE_CONTEXT)).ok).toBe(false)
      expect(dispose).toHaveBeenCalledTimes(1)

      dispose = installProbe({ duration: 12.5 })
      billingMock.withTextBilling.mockRejectedValueOnce(new ApiError('INSUFFICIENT_BALANCE'))
      expect((await POST(multipartRequest() as never, ROUTE_CONTEXT)).status).toBe(402)
      expect(dispose).toHaveBeenCalledTimes(1)

      dispose = installProbe({ duration: 12.5 })
      providerMock.understandVideoWithArk.mockResolvedValueOnce(providerResult())
      const streamed = await POST(multipartRequest({ accept: 'text/event-stream' }) as never, ROUTE_CONTEXT)
      await streamed.text()
      expect(dispose).toHaveBeenCalledTimes(1)
    })
  })

  describe('storyboard stage (shot-by-shot text from the uploaded video)', () => {
    it('writes the storyboard with a valid handle without re-uploading the video', async () => {
      providerMock.understandSourceStoryboardWithArk.mockResolvedValue(storyboardResult())
      const fileHandle = storyboardHandle({ episodeNumber: 2 })
      const { POST } = await loadRoute()
      const response = await POST(jsonRequest({
        stage: 'storyboard',
        fileHandle,
        sourceAnalysis: analysis(),
        episodeNumber: 2,
      }) as never, ROUTE_CONTEXT)
      const payload = await response.json()

      expect(response.status).toBe(200)
      expect(probeMock.startVideoTimingProbe).not.toHaveBeenCalled()
      expect(providerMock.understandVideoWithArk).not.toHaveBeenCalled()
      expect(billingMock.withTextBilling).toHaveBeenCalledWith(
        'user-1',
        'ark::test-ark-model',
        256_000,
        32_000,
        expect.objectContaining({
          projectId: 'video-repaint',
          action: 'video_repaint_source_storyboard',
          metadata: expect.objectContaining({
            operation: 'source-storyboard',
            durationSeconds: 12.5,
            episodeNumber: 2,
            continued: false,
          }),
        }),
        expect.any(Function),
      )
      expect(providerMock.understandSourceStoryboardWithArk).toHaveBeenCalledWith(expect.objectContaining({
        apiKey: 'server-only-test-key',
        fileId: 'file-secret-provider-id',
        sourceAnalysis: analysis(),
        durationSeconds: 12.5,
        episodeNumber: 2,
        cutHints: [],
        continuation: undefined,
        model: 'test-ark-model',
      }))
      expect(usageMock.recordTextUsage).toHaveBeenCalledWith({
        model: 'ark::test-ark-model',
        inputTokens: 80,
        outputTokens: 40,
      })
      expect(serviceUsageMock.recordServiceUsage).toHaveBeenCalledWith(expect.objectContaining({
        provider: 'video-understanding',
        operation: 'source-storyboard',
        userId: 'actor-1',
        inputTokens: 80,
        outputTokens: 40,
      }))

      expect(payload.result).toEqual({
        fileHandle,
        storyboard: STORYBOARD,
        complete: true,
        coveredSeconds: 12.5,
        durationSeconds: 12.5,
        shotCount: 2,
        addedShots: 2,
        usage: { inputTokens: 80, outputTokens: 40 },
        validation: { valid: true, errors: [], warnings: [] },
      })
      expect(JSON.stringify(payload)).not.toContain('file-secret-provider-id')
      expect(JSON.stringify(payload)).not.toContain('server-only-test-key')
      expect(JSON.stringify(payload)).not.toContain('raw storyboard text')
    })

    it('passes the machine-detected cuts that fall inside the video, tidied', async () => {
      providerMock.understandSourceStoryboardWithArk.mockResolvedValue(storyboardResult())
      const { POST } = await loadRoute()
      await POST(jsonRequest({
        stage: 'storyboard',
        fileHandle: storyboardHandle(),
        sourceAnalysis: analysis(),
        cutHints: [8.05, 3.2, 'x', null, -1, 0, 99, 12.5, 3.25],
      }) as never, ROUTE_CONTEXT)

      // Text, non-positive and out-of-range entries are dropped; 3.25 s is the same cut as 3.2 s.
      expect(providerMock.understandSourceStoryboardWithArk).toHaveBeenCalledWith(expect.objectContaining({
        cutHints: [3.2, 8.05],
      }))
    })

    it('carries on from the storyboard written so far', async () => {
      providerMock.understandSourceStoryboardWithArk.mockResolvedValue(storyboardResult({ complete: false, coveredSeconds: 6, shotCount: 1, addedShots: 1 }))
      const { POST } = await loadRoute()
      const response = await POST(jsonRequest({
        stage: 'storyboard',
        fileHandle: storyboardHandle(),
        sourceAnalysis: analysis(),
        continuation: { storyboard: `\n  ${STORYBOARD}  \n` },
      }) as never, ROUTE_CONTEXT)
      const payload = await response.json()

      expect(response.status).toBe(200)
      expect(providerMock.understandSourceStoryboardWithArk).toHaveBeenCalledWith(expect.objectContaining({
        continuation: { storyboard: STORYBOARD },
      }))
      expect(billingMock.withTextBilling).toHaveBeenCalledWith(
        'user-1',
        'ark::test-ark-model',
        256_000,
        32_000,
        expect.objectContaining({ metadata: expect.objectContaining({ continued: true }) }),
        expect.any(Function),
      )
      expect(payload.result.complete).toBe(false)
      expect(payload.result.coveredSeconds).toBe(6)
    })

    it('treats a blank continuation as the first round', async () => {
      providerMock.understandSourceStoryboardWithArk.mockResolvedValue(storyboardResult())
      const { POST } = await loadRoute()
      for (const continuation of [undefined, null, { storyboard: '   ' }]) {
        await POST(jsonRequest({
          stage: 'storyboard',
          fileHandle: storyboardHandle(),
          sourceAnalysis: analysis(),
          continuation,
        }) as never, ROUTE_CONTEXT)
        expect(providerMock.understandSourceStoryboardWithArk).toHaveBeenLastCalledWith(expect.objectContaining({
          continuation: undefined,
        }))
      }
    })

    it('does not stop for a source script the model left rough', async () => {
      providerMock.understandSourceStoryboardWithArk.mockResolvedValue(storyboardResult())
      const { POST } = await loadRoute()
      const response = await POST(jsonRequest({
        stage: 'storyboard',
        fileHandle: storyboardHandle(),
        sourceAnalysis: {},
      }) as never, ROUTE_CONTEXT)

      expect(response.status).toBe(200)
      expect(providerMock.understandSourceStoryboardWithArk).toHaveBeenCalledWith(expect.objectContaining({ sourceAnalysis: {} }))
    })

    it('streams the storyboard stage the same way when the client accepts SSE', async () => {
      providerMock.understandSourceStoryboardWithArk.mockImplementation(async (options: {
        onProgress?: (progress: unknown) => void
      }) => {
        options.onProgress?.({ stage: 'storyboard', shots: 0 })
        options.onProgress?.({ stage: 'storyboard', outputChars: 300, shots: 2 })
        return storyboardResult()
      })
      const { POST } = await loadRoute()
      const response = await POST(jsonRequest({
        stage: 'storyboard',
        fileHandle: storyboardHandle(),
        sourceAnalysis: analysis(),
      }, 'text/event-stream') as never, ROUTE_CONTEXT)

      expect(response.headers.get('content-type')).toContain('text/event-stream')
      const events = parseSse(await response.text())
      expect(events.map((item) => item.event)).toEqual(['progress', 'progress', 'progress', 'result'])
      expect(events[0]?.data).toEqual({ stage: 'storyboard' })
      expect(events[1]?.data).toEqual({ stage: 'storyboard', shots: 0 })
      expect(events[2]?.data).toEqual({ stage: 'storyboard', outputChars: 300, shots: 2 })
      const result = (events[3]?.data as { result?: Record<string, unknown> } | null)?.result
      expect(result?.storyboard).toBe(STORYBOARD)
      expect(result?.complete).toBe(true)
      expect(JSON.stringify(events)).not.toContain('file-secret-provider-id')
      expect(JSON.stringify(events)).not.toContain('server-only-test-key')
    })

    it('reports a storyboard without any shots as a retryable error', async () => {
      providerMock.understandSourceStoryboardWithArk.mockRejectedValue(
        new Error('EMPTY_RESPONSE: Ark source storyboard contained no shots'),
      )
      const { POST } = await loadRoute()
      const response = await POST(jsonRequest({
        stage: 'storyboard',
        fileHandle: storyboardHandle(),
        sourceAnalysis: analysis(),
      }) as never, ROUTE_CONTEXT)

      expect(response.status).toBe(502)
      expect((await readError(response)).code).toBe('EMPTY_RESPONSE')
      expect(serviceUsageMock.recordServiceUsage).not.toHaveBeenCalled()
    })

    it('maps a burst rejection of a later round to the same friendly rate-limit error', async () => {
      providerMock.understandSourceStoryboardWithArk.mockRejectedValue(
        new Error('ARK_VIDEO_UNDERSTANDING_STORYBOARD_RESPONSE_FAILED: status 429 - System protection triggered by request burst.'),
      )
      const { POST } = await loadRoute()
      const response = await POST(jsonRequest({
        stage: 'storyboard',
        fileHandle: storyboardHandle(),
        sourceAnalysis: analysis(),
        continuation: { storyboard: STORYBOARD },
      }) as never, ROUTE_CONTEXT)
      const error = await readError(response)

      expect(response.status).toBe(429)
      expect(error.code).toBe('RATE_LIMIT')
      expect(error.message).not.toContain('System protection')
    })

    it('does not contact the provider when billing rejects a round', async () => {
      const { ApiError } = await import('@/lib/api-errors')
      billingMock.withTextBilling.mockRejectedValueOnce(new ApiError('DAILY_LIMIT_EXCEEDED'))
      const { POST } = await loadRoute()
      const response = await POST(jsonRequest({
        stage: 'storyboard',
        fileHandle: storyboardHandle(),
        sourceAnalysis: analysis(),
      }) as never, ROUTE_CONTEXT)

      expect(response.status).toBe(402)
      expect((await readError(response)).code).toBe('DAILY_LIMIT_EXCEEDED')
      expect(providerMock.understandSourceStoryboardWithArk).not.toHaveBeenCalled()
    })

    it('rejects a handle owned by another account or already expired', async () => {
      const otherAccount = storyboardHandle({ userId: 'other-actor' })
      const expired = createVideoRepaintFileHandle({
        userId: 'actor-1',
        fileId: 'file-secret-provider-id',
        durationSeconds: 12.5,
        episodeNumber: 1,
      }, { now: Date.now() - 10_000, ttlMs: 1_000 })

      const { POST } = await loadRoute()
      for (const fileHandle of [otherAccount, expired, 'not-a-handle', '']) {
        const response = await POST(jsonRequest({
          stage: 'storyboard',
          fileHandle,
          sourceAnalysis: analysis(),
        }) as never, ROUTE_CONTEXT)
        expect(response.status).toBe(400)
        expect((await readError(response)).code).toBe('INVALID_PARAMS')
      }
      expect(billingMock.withTextBilling).not.toHaveBeenCalled()
      expect(providerMock.understandSourceStoryboardWithArk).not.toHaveBeenCalled()
    })

    it('validates the storyboard stage payload before billing', async () => {
      const fileHandle = storyboardHandle()
      const { POST } = await loadRoute()

      for (const payload of [
        { stage: 'storyboard', fileHandle },
        { stage: 'storyboard', fileHandle, sourceAnalysis: 'not an object' },
        { stage: 'storyboard', fileHandle, sourceAnalysis: [analysis()] },
        { stage: 'storyboard', fileHandle, sourceAnalysis: { big: 'x'.repeat(2 * 1024 * 1024) } },
        { stage: 'storyboard', fileHandle, sourceAnalysis: analysis(), continuation: 'text' },
        { stage: 'storyboard', fileHandle, sourceAnalysis: analysis(), continuation: { storyboard: 42 } },
        { stage: 'storyboard', fileHandle, sourceAnalysis: analysis(), continuation: { storyboard: 'x'.repeat(400_001) } },
        { stage: 'other', fileHandle, sourceAnalysis: analysis() },
        { fileHandle, sourceAnalysis: analysis() },
        null,
        [],
      ]) {
        const response = await POST(jsonRequest(payload) as never, ROUTE_CONTEXT)
        expect(response.status).toBe(400)
        expect((await readError(response)).code).toBe('INVALID_PARAMS')
      }
      expect(billingMock.withTextBilling).not.toHaveBeenCalled()
      expect(providerMock.understandSourceStoryboardWithArk).not.toHaveBeenCalled()
    })
  })
})
