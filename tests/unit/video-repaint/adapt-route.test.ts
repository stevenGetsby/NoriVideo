import { beforeEach, describe, expect, it, vi } from 'vitest'
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
const gatewayMock = vi.hoisted(() => ({
  runModelGatewayTextCompletion: vi.fn(),
}))

vi.mock('@/lib/api-auth', () => authMock)
vi.mock('@/lib/billing', () => billingMock)
vi.mock('@/lib/billing/runtime-usage', () => usageMock)
vi.mock('@/lib/model-gateway/llm', () => gatewayMock)
vi.mock('@/lib/platform-services/usage', () => serviceUsageMock)

const session = { user: { id: 'user-1', actorId: 'actor-1' } }

function completion(content: string) {
  return {
    choices: [{ message: { role: 'assistant', content } }],
    usage: { prompt_tokens: 200, completion_tokens: 100 },
  }
}

function request(payload: unknown) {
  return new NextRequest('http://localhost/api/video-repaint/adapt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

async function readError(response: Response) {
  return (await response.json()).error
}

describe('/api/video-repaint/adapt', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMock.requireUserAuth.mockResolvedValue({ session })
    billingMock.withTextBilling.mockImplementation(async (...args: unknown[]) => {
      const generateFn = args[5] as () => Promise<unknown>
      return await generateFn()
    })
    gatewayMock.runModelGatewayTextCompletion.mockResolvedValue(completion('第1集\n场景：目标场景\n△人物抬头。'))
  })

  it('requires an authenticated account before validation or billing', async () => {
    authMock.requireUserAuth.mockResolvedValueOnce(NextResponse.json({ success: false }, { status: 401 }))
    const { POST } = await import('@/app/api/video-repaint/adapt/route')
    const response = await POST(request({ sourceScript: '第1集', adaptationBrief: '改' }) as never, { params: Promise.resolve({}) })

    expect(response.status).toBe(401)
    expect(billingMock.withTextBilling).not.toHaveBeenCalled()
    expect(serviceUsageMock.recordServiceUsage).not.toHaveBeenCalled()
  })

  it('keeps the confirmed source script free when no adaptation brief is provided', async () => {
    const { POST } = await import('@/app/api/video-repaint/adapt/route')
    const response = await POST(request({
      sourceScript: '第1集\n场景：源场景',
      adaptationBrief: '',
      title: '第一集',
    }) as never, { params: Promise.resolve({}) })
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.result).toEqual({
      script: '第1集\n场景：源场景',
      mode: 'source_copy',
      usage: { inputTokens: 0, outputTokens: 0 },
    })
    expect(billingMock.withTextBilling).not.toHaveBeenCalled()
    expect(gatewayMock.runModelGatewayTextCompletion).not.toHaveBeenCalled()
    expect(serviceUsageMock.recordServiceUsage).not.toHaveBeenCalled()
  })

  it('adapts with the protected text model and records the protected usage', async () => {
    const { POST } = await import('@/app/api/video-repaint/adapt/route')
    const response = await POST(request({
      sourceScript: '第1集\n场景：源场景',
      sourceAnalysis: { adaptation_contract: { story_invariants: ['妹妹失踪'] } },
      adaptationBrief: '改为北美现代都市语境',
      title: '第一集',
    }) as never, { params: Promise.resolve({}) })
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.result).toEqual({
      script: '第1集\n场景：目标场景\n△人物抬头。',
      mode: 'llm',
      usage: { inputTokens: 200, outputTokens: 100 },
    })
    expect(JSON.stringify(payload)).not.toContain('nori::nori-gpt')
    expect(billingMock.withTextBilling).toHaveBeenCalledWith(
      'user-1',
      'nori::nori-gpt',
      expect.any(Number),
      32_000,
      expect.objectContaining({
        projectId: 'video-repaint',
        action: 'video_repaint_script_adaptation',
      }),
      expect.any(Function),
    )
    expect(gatewayMock.runModelGatewayTextCompletion).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      model: 'nori::nori-gpt',
    }))
    const userPrompt = gatewayMock.runModelGatewayTextCompletion.mock.calls[0]?.[0]?.messages?.[1]?.content as string
    expect(userPrompt).toContain('妹妹失踪')
    expect(userPrompt).toContain('<source_script>')
    expect(serviceUsageMock.recordServiceUsage).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'text-llm',
      modelKey: 'nori::nori-gpt',
      operation: 'script-adaptation',
      userId: 'actor-1',
      inputTokens: 200,
      outputTokens: 100,
    }))
  })

  it('rejects invalid or oversized payloads before billing', async () => {
    const { POST } = await import('@/app/api/video-repaint/adapt/route')
    for (const payload of [
      { sourceScript: '   ' },
      { sourceScript: 'x'.repeat(400_001), adaptationBrief: '改' },
      { sourceScript: '第1集', adaptationBrief: '改', sourceAnalysis: { adaptation_contract: { big: 'x'.repeat(2 * 1024 * 1024) } } },
    ]) {
      const response = await POST(request(payload) as never, { params: Promise.resolve({}) })
      expect(response.status).toBe(400)
      expect((await readError(response)).code).toBe('INVALID_PARAMS')
    }
    expect(billingMock.withTextBilling).not.toHaveBeenCalled()
    expect(gatewayMock.runModelGatewayTextCompletion).not.toHaveBeenCalled()
  })

  it('turns a disabled text model into MODEL_NOT_CONFIGURED', async () => {
    gatewayMock.runModelGatewayTextCompletion.mockRejectedValueOnce(new Error('MODEL_NOT_CONFIGURED: no model'))
    const { POST } = await import('@/app/api/video-repaint/adapt/route')
    const response = await POST(request({
      sourceScript: '第1集',
      adaptationBrief: '改为北美语境',
    }) as never, { params: Promise.resolve({}) })

    expect(response.status).toBe(400)
    expect((await readError(response)).code).toBe('MODEL_NOT_CONFIGURED')
  })

  it('passes balance and daily-limit rejections through without calling the gateway', async () => {
    const { ApiError } = await import('@/lib/api-errors')
    const { POST } = await import('@/app/api/video-repaint/adapt/route')
    billingMock.withTextBilling.mockRejectedValueOnce(new ApiError('DAILY_LIMIT_EXCEEDED'))
    const response = await POST(request({
      sourceScript: '第1集',
      adaptationBrief: '改为北美语境',
    }) as never, { params: Promise.resolve({}) })

    expect(response.status).toBe(402)
    expect((await readError(response)).code).toBe('DAILY_LIMIT_EXCEEDED')
    expect(gatewayMock.runModelGatewayTextCompletion).not.toHaveBeenCalled()
  })

  it('rejects an empty model response and maps cancellation', async () => {
    const { POST } = await import('@/app/api/video-repaint/adapt/route')
    gatewayMock.runModelGatewayTextCompletion.mockResolvedValueOnce(completion('   '))
    const empty = await POST(request({
      sourceScript: '第1集',
      adaptationBrief: '改为北美语境',
    }) as never, { params: Promise.resolve({}) })
    expect(empty.status).toBe(502)
    expect((await readError(empty)).code).toBe('EMPTY_RESPONSE')

    const aborted = Object.assign(new Error('aborted'), { name: 'AbortError' })
    gatewayMock.runModelGatewayTextCompletion.mockRejectedValueOnce(aborted)
    const cancelled = await POST(request({
      sourceScript: '第1集',
      adaptationBrief: '改为北美语境',
    }) as never, { params: Promise.resolve({}) })
    expect(cancelled.status).toBe(502)
    expect((await readError(cancelled)).code).toBe('NETWORK_ERROR')
  })

  it('sanitizes provider errors before returning them to the browser', async () => {
    gatewayMock.runModelGatewayTextCompletion.mockRejectedValueOnce(
      new Error('upstream failed sk-live-secret-12345678 at https://internal.example.com/v1'),
    )
    const { POST } = await import('@/app/api/video-repaint/adapt/route')
    const response = await POST(request({
      sourceScript: '第1集',
      adaptationBrief: '改为北美语境',
    }) as never, { params: Promise.resolve({}) })
    const error = await readError(response)

    expect(response.status).toBe(502)
    expect(error.code).toBe('EXTERNAL_ERROR')
    expect(error.message).not.toContain('sk-live-secret-12345678')
    expect(error.message).not.toContain('internal.example.com')
  })
})
