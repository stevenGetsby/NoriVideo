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
      locations: [{ location_ref: 'location_1', name_if_known: '测试房间' }],
      props: [],
    },
    source_storyboard: {
      shots: [{
        panel_id: 'E01-P001',
        scene_id: 'E01-S01',
        source_anchor: { start_time: '00:00:00.000', end_time: '00:00:01.000' },
        source_beat_ids: ['E01-S01-B01'],
        referenced_assets: { characters: ['character_1'], location: 'location_1', props: [] },
      }],
      excluded_ranges: [],
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

function providerResult() {
  return {
    fileId: 'file-secret-provider-id',
    model: 'test-ark-model',
    text: 'raw model text',
    episodeScript: '第1集\n1-1\n场景：测试房间 - 夜 - 暗\n人物：测试人物\n△测试人物抬头。',
    sourceStoryboard: '第1集 · 源分镜\n\nShot 1 · E01-P001',
    analysis: analysis(),
    usage: { inputTokens: 120, outputTokens: 30 },
    validation: { valid: true, errors: [], warnings: [] },
  }
}

function multipartRequest(overrides?: { file?: File; durationSeconds?: string }) {
  const form = new FormData()
  form.set('file', overrides?.file ?? new File([new Uint8Array([0, 1, 2])], 'demo.mp4', { type: 'video/mp4' }))
  form.set('mode', 'board')
  form.set('episodeNumber', '1')
  if (overrides?.durationSeconds !== undefined) form.set('durationSeconds', overrides.durationSeconds)
  return new NextRequest('http://localhost/api/video-repaint/understand', { method: 'POST', body: form })
}

function jsonRequest(payload: unknown) {
  return new NextRequest('http://localhost/api/video-repaint/understand', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

async function readError(response: Response) {
  const payload = await response.json()
  return payload.error
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
    const { GET, POST } = await import('@/app/api/video-repaint/understand/route')

    const read = await GET(new NextRequest('http://localhost/api/video-repaint/understand') as never, { params: Promise.resolve({}) })
    expect(read.status).toBe(401)

    authMock.requireUserAuth.mockResolvedValueOnce(NextResponse.json({ success: false }, { status: 401 }))
    const upload = await POST(multipartRequest() as never, { params: Promise.resolve({}) })
    expect(upload.status).toBe(401)
    expect(billingMock.withTextBilling).not.toHaveBeenCalled()
    expect(providerMock.understandVideoWithArk).not.toHaveBeenCalled()
  })

  it('reports readiness without exposing the provider model or key', async () => {
    const { GET } = await import('@/app/api/video-repaint/understand/route')
    const response = await GET(new NextRequest('http://localhost/api/video-repaint/understand') as never, { params: Promise.resolve({}) })
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

  it('bills the upload before calling Ark and returns a signed, account-bound handle', async () => {
    providerMock.understandVideoWithArk.mockResolvedValue(providerResult())
    const { POST } = await import('@/app/api/video-repaint/understand/route')
    const response = await POST(multipartRequest({ durationSeconds: '12.5' }) as never, { params: Promise.resolve({}) })
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
      }),
      expect.any(Function),
    )
    expect(providerMock.understandVideoWithArk).toHaveBeenCalledWith(expect.objectContaining({
      apiKey: 'server-only-test-key',
      mode: 'board',
      episodeNumber: 1,
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
    }))

    expect(payload.result.durationSeconds).toBe(12.5)
    expect(payload.result.script).toContain('第1集')
    expect(payload.result.storyboard).toContain('源分镜')
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

  it('falls back to the analyzed duration when the browser did not report one', async () => {
    providerMock.understandVideoWithArk.mockResolvedValue(providerResult())
    const { POST } = await import('@/app/api/video-repaint/understand/route')
    const response = await POST(multipartRequest() as never, { params: Promise.resolve({}) })
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.result.durationSeconds).toBe(12.5)
    expect(verifyVideoRepaintFileHandle(payload.result.fileHandle, 'actor-1')?.durationSeconds).toBe(12.5)
  })

  it('rejects unsupported or missing files before billing or provider calls', async () => {
    const { POST } = await import('@/app/api/video-repaint/understand/route')
    const webm = new File([new Uint8Array([0])], 'demo.webm', { type: 'video/webm' })
    const invalid = await POST(multipartRequest({ file: webm }) as never, { params: Promise.resolve({}) })
    expect(invalid.status).toBe(400)
    expect((await readError(invalid)).code).toBe('INVALID_PARAMS')

    const emptyForm = new FormData()
    emptyForm.set('mode', 'script')
    const missing = await POST(new NextRequest('http://localhost/api/video-repaint/understand', {
      method: 'POST',
      body: emptyForm,
    }) as never, { params: Promise.resolve({}) })
    expect(missing.status).toBe(400)

    expect(billingMock.withTextBilling).not.toHaveBeenCalled()
    expect(providerMock.understandVideoWithArk).not.toHaveBeenCalled()
  })

  it('blocks the upload when the server-side key or handle secret is missing', async () => {
    const { POST } = await import('@/app/api/video-repaint/understand/route')
    delete process.env.ARK_API_KEY
    const missingKey = await POST(multipartRequest() as never, { params: Promise.resolve({}) })
    expect(missingKey.status).toBe(400)
    expect((await readError(missingKey)).code).toBe('MISSING_CONFIG')

    process.env.ARK_API_KEY = 'server-only-test-key'
    delete process.env.VIDEO_REPAINT_FILE_HANDLE_SECRET
    delete process.env.NEXTAUTH_SECRET
    delete process.env.API_ENCRYPTION_KEY
    const missingSecret = await POST(multipartRequest() as never, { params: Promise.resolve({}) })
    expect(missingSecret.status).toBe(400)
    expect((await readError(missingSecret)).code).toBe('MISSING_CONFIG')

    expect(billingMock.withTextBilling).not.toHaveBeenCalled()
    expect(providerMock.understandVideoWithArk).not.toHaveBeenCalled()
  })

  it('surfaces provider authentication failures without leaking the key', async () => {
    providerMock.understandVideoWithArk.mockRejectedValue(
      new Error('ARK_VIDEO_UNDERSTANDING_RESPONSE_FAILED: status 401 - invalid API key server-only-test-key'),
    )
    const { POST } = await import('@/app/api/video-repaint/understand/route')
    const response = await POST(multipartRequest() as never, { params: Promise.resolve({}) })
    const error = await readError(response)

    expect(response.status).toBe(400)
    expect(error.code).toBe('MISSING_CONFIG')
    expect(error.message).not.toContain('server-only-test-key')
    expect(JSON.stringify(error)).not.toContain('https://')
  })

  it('maps caller cancellation to a network error and stops provider retries', async () => {
    providerMock.understandVideoWithArk.mockRejectedValue(new Error('ARK_VIDEO_UNDERSTANDING_ABORTED: request aborted'))
    const { POST } = await import('@/app/api/video-repaint/understand/route')
    const response = await POST(multipartRequest() as never, { params: Promise.resolve({}) })

    expect(response.status).toBe(502)
    expect((await readError(response)).code).toBe('NETWORK_ERROR')
    expect(providerMock.understandVideoWithArk).toHaveBeenCalledTimes(1)
  })

  it('does not contact the provider when billing rejects the request', async () => {
    const { ApiError } = await import('@/lib/api-errors')
    billingMock.withTextBilling.mockRejectedValueOnce(new ApiError('INSUFFICIENT_BALANCE'))
    const { POST } = await import('@/app/api/video-repaint/understand/route')
    const response = await POST(multipartRequest() as never, { params: Promise.resolve({}) })

    expect(response.status).toBe(402)
    expect((await readError(response)).code).toBe('INSUFFICIENT_BALANCE')
    expect(providerMock.understandVideoWithArk).not.toHaveBeenCalled()
  })

  it('issues the storyboard stage with a valid handle without re-uploading the video', async () => {
    providerMock.understandSourceStoryboardWithArk.mockResolvedValue({
      fileId: 'file-secret-provider-id',
      model: 'test-ark-model',
      text: 'raw storyboard text',
      storyboard: { shots: [], excluded_ranges: [] },
      formattedStoryboard: '第1集 · 源分镜',
      usage: { inputTokens: 80, outputTokens: 40 },
      validation: { valid: true, errors: [], warnings: [] },
    })
    const fileHandle = createVideoRepaintFileHandle({
      userId: 'actor-1',
      fileId: 'file-secret-provider-id',
      durationSeconds: 12.5,
      episodeNumber: 2,
    })
    const { POST } = await import('@/app/api/video-repaint/understand/route')
    const response = await POST(jsonRequest({
      stage: 'storyboard',
      fileHandle,
      sourceAnalysis: analysis(),
      episodeNumber: 2,
    }) as never, { params: Promise.resolve({}) })
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(providerMock.understandSourceStoryboardWithArk).toHaveBeenCalledWith(expect.objectContaining({
      apiKey: 'server-only-test-key',
      fileId: 'file-secret-provider-id',
      durationSeconds: 12.5,
      episodeNumber: 2,
      model: 'test-ark-model',
    }))
    expect(payload.result.fileHandle).toBe(fileHandle)
    expect(payload.result.analysis.source_storyboard).toEqual({ shots: [], excluded_ranges: [] })
    expect(JSON.stringify(payload)).not.toContain('file-secret-provider-id')
  })

  it('rejects a storyboard handle owned by another account or already expired', async () => {
    const otherAccount = createVideoRepaintFileHandle({
      userId: 'other-actor',
      fileId: 'file-secret-provider-id',
      durationSeconds: 12.5,
      episodeNumber: 1,
    })
    const expired = createVideoRepaintFileHandle({
      userId: 'actor-1',
      fileId: 'file-secret-provider-id',
      durationSeconds: 12.5,
      episodeNumber: 1,
    }, { now: Date.now() - 10_000, ttlMs: 1_000 })

    const { POST } = await import('@/app/api/video-repaint/understand/route')
    for (const fileHandle of [otherAccount, expired]) {
      const response = await POST(jsonRequest({
        stage: 'storyboard',
        fileHandle,
        sourceAnalysis: analysis(),
      }) as never, { params: Promise.resolve({}) })
      expect(response.status).toBe(400)
      expect((await readError(response)).code).toBe('INVALID_PARAMS')
    }
    expect(billingMock.withTextBilling).not.toHaveBeenCalled()
    expect(providerMock.understandSourceStoryboardWithArk).not.toHaveBeenCalled()
  })

  it('validates the storyboard stage payload before billing', async () => {
    const fileHandle = createVideoRepaintFileHandle({
      userId: 'actor-1',
      fileId: 'file-secret-provider-id',
      durationSeconds: 12.5,
      episodeNumber: 1,
    })
    const { POST } = await import('@/app/api/video-repaint/understand/route')

    for (const payload of [
      { stage: 'storyboard', fileHandle },
      { stage: 'storyboard', fileHandle, sourceAnalysis: {} },
      { stage: 'other', fileHandle, sourceAnalysis: analysis() },
    ]) {
      const response = await POST(jsonRequest(payload) as never, { params: Promise.resolve({}) })
      expect(response.status).toBe(400)
      expect((await readError(response)).code).toBe('INVALID_PARAMS')
    }
    expect(billingMock.withTextBilling).not.toHaveBeenCalled()
    expect(providerMock.understandSourceStoryboardWithArk).not.toHaveBeenCalled()
  })
})
