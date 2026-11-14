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

import { REPAINT_OUTLINE_SECTION_TITLES } from '@/lib/video-repaint/contract'

const session = { user: { id: 'user-1', actorId: 'actor-1' } }

function outlineOf(numbers: number[]): string {
  return numbers
    .map((number) => `${number}. ${REPAINT_OUTLINE_SECTION_TITLES[number - 1]}\n第${number}章的内容。`)
    .join('\n\n')
}

const FULL_OUTLINE = outlineOf([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])

function completion(content: string) {
  return {
    choices: [{ message: { role: 'assistant', content } }],
    usage: { prompt_tokens: 200, completion_tokens: 100 },
  }
}

function request(payload: unknown) {
  return new NextRequest('http://localhost/api/video-repaint/outline', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

async function post(payload: unknown) {
  const { POST } = await import('@/app/api/video-repaint/outline/route')
  return await POST(request(payload) as never, { params: Promise.resolve({}) })
}

async function readError(response: Response) {
  return (await response.json()).error
}

describe('/api/video-repaint/outline', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMock.requireUserAuth.mockResolvedValue({ session })
    billingMock.withTextBilling.mockImplementation(async (...args: unknown[]) => {
      const generateFn = args[5] as () => Promise<unknown>
      return await generateFn()
    })
    gatewayMock.runModelGatewayTextCompletion.mockResolvedValue(completion(FULL_OUTLINE))
  })

  it('requires an authenticated account before validation or billing', async () => {
    authMock.requireUserAuth.mockResolvedValueOnce(NextResponse.json({ success: false }, { status: 401 }))
    const response = await post({ sourceScript: '第1集', adaptationBrief: '改' })

    expect(response.status).toBe(401)
    expect(billingMock.withTextBilling).not.toHaveBeenCalled()
    expect(serviceUsageMock.recordServiceUsage).not.toHaveBeenCalled()
  })

  it('writes the outline with the protected text model and records the protected usage', async () => {
    const response = await post({
      sourceScript: '第1集\n场景：源场景',
      sourceAnalysis: { adaptation_contract: { story_invariants: ['妹妹失踪'] } },
      adaptationBrief: '改为北美现代都市语境',
      title: '第一集',
    })
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.result).toEqual({
      outline: FULL_OUTLINE,
      usage: { inputTokens: 200, outputTokens: 100 },
      missingSections: [],
    })
    // The business model key is an internal routing detail; the browser never needs it.
    expect(JSON.stringify(payload)).not.toContain('nori::nori-gpt')
    expect(billingMock.withTextBilling).toHaveBeenCalledWith(
      'user-1',
      'nori::nori-gpt',
      expect.any(Number),
      32_000,
      expect.objectContaining({
        projectId: 'video-repaint',
        action: 'video_repaint_target_outline',
      }),
      expect.any(Function),
    )
    expect(gatewayMock.runModelGatewayTextCompletion).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      model: 'nori::nori-gpt',
    }))
    const userPrompt = gatewayMock.runModelGatewayTextCompletion.mock.calls[0]?.[0]?.messages?.[1]?.content as string
    expect(userPrompt).toContain('改为北美现代都市语境')
    expect(userPrompt).toContain('妹妹失踪')
    expect(userPrompt).toContain('<source_script>')
    expect(serviceUsageMock.recordServiceUsage).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'text-llm',
      modelKey: 'nori::nori-gpt',
      serviceType: 'video-repaint',
      operation: 'target-outline',
      userId: 'actor-1',
      inputTokens: 200,
      outputTokens: 100,
    }))
  })

  it('writes an outline even when the brief is empty', async () => {
    const response = await post({ sourceScript: '第1集\n场景：源场景', adaptationBrief: '   ', title: '第一集' })
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.result.outline).toBe(FULL_OUTLINE)
    expect(billingMock.withTextBilling).toHaveBeenCalledTimes(1)
    const userPrompt = gatewayMock.runModelGatewayTextCompletion.mock.calls[0]?.[0]?.messages?.[1]?.content as string
    expect(userPrompt).toContain('（用户没有填写转绘需求）')
  })

  it('trims an overlong brief instead of rejecting the request', async () => {
    const response = await post({ sourceScript: '第1集', adaptationBrief: `开头${'长'.repeat(3_000)}` })

    expect(response.status).toBe(200)
    const userPrompt = gatewayMock.runModelGatewayTextCompletion.mock.calls[0]?.[0]?.messages?.[1]?.content as string
    expect(userPrompt).toContain('开头')
    expect(userPrompt).not.toContain('长'.repeat(2_001))
  })

  it('reports the chapters the model left out', async () => {
    gatewayMock.runModelGatewayTextCompletion.mockResolvedValueOnce(completion(outlineOf([1, 2, 3, 4, 5])))
    const response = await post({ sourceScript: '第1集', adaptationBrief: '改为北美语境' })
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.result.missingSections).toEqual([6, 7, 8, 9, 10])
  })

  it('rejects invalid or oversized payloads before billing', async () => {
    for (const payload of [
      null,
      'not an object',
      { sourceScript: '   ' },
      { adaptationBrief: '改' },
      { sourceScript: 'x'.repeat(400_001), adaptationBrief: '改' },
      { sourceScript: '第1集', sourceAnalysis: { adaptation_contract: { big: 'x'.repeat(2 * 1024 * 1024) } } },
    ]) {
      const response = await post(payload)
      expect(response.status).toBe(400)
      expect((await readError(response)).code).toBe('INVALID_PARAMS')
    }
    expect(billingMock.withTextBilling).not.toHaveBeenCalled()
    expect(gatewayMock.runModelGatewayTextCompletion).not.toHaveBeenCalled()
  })

  it('turns a disabled text model into MODEL_NOT_CONFIGURED', async () => {
    gatewayMock.runModelGatewayTextCompletion.mockRejectedValueOnce(new Error('MODEL_NOT_CONFIGURED: no model'))
    const response = await post({ sourceScript: '第1集', adaptationBrief: '改为北美语境' })

    expect(response.status).toBe(400)
    expect((await readError(response)).code).toBe('MODEL_NOT_CONFIGURED')
    expect(serviceUsageMock.recordServiceUsage).not.toHaveBeenCalled()
  })

  it('passes balance and daily-limit rejections through without calling the gateway', async () => {
    const { ApiError } = await import('@/lib/api-errors')
    billingMock.withTextBilling.mockRejectedValueOnce(new ApiError('DAILY_LIMIT_EXCEEDED'))
    const response = await post({ sourceScript: '第1集', adaptationBrief: '改为北美语境' })

    expect(response.status).toBe(402)
    expect((await readError(response)).code).toBe('DAILY_LIMIT_EXCEEDED')
    expect(gatewayMock.runModelGatewayTextCompletion).not.toHaveBeenCalled()
  })

  it('rejects an empty model response and maps cancellation', async () => {
    gatewayMock.runModelGatewayTextCompletion.mockResolvedValueOnce(completion('   '))
    const empty = await post({ sourceScript: '第1集', adaptationBrief: '改为北美语境' })
    expect(empty.status).toBe(502)
    expect((await readError(empty)).code).toBe('EMPTY_RESPONSE')

    const aborted = Object.assign(new Error('aborted'), { name: 'AbortError' })
    gatewayMock.runModelGatewayTextCompletion.mockRejectedValueOnce(aborted)
    const cancelled = await post({ sourceScript: '第1集', adaptationBrief: '改为北美语境' })
    expect(cancelled.status).toBe(502)
    expect((await readError(cancelled)).code).toBe('NETWORK_ERROR')
  })

  it('sanitizes provider errors before returning them to the browser', async () => {
    gatewayMock.runModelGatewayTextCompletion.mockRejectedValueOnce(
      new Error('upstream failed sk-live-secret-12345678 at https://internal.example.com/v1'),
    )
    const response = await post({ sourceScript: '第1集', adaptationBrief: '改为北美语境' })
    const error = await readError(response)

    expect(response.status).toBe(502)
    expect(error.code).toBe('EXTERNAL_ERROR')
    expect(error.message).not.toContain('sk-live-secret-12345678')
    expect(error.message).not.toContain('internal.example.com')
  })
})
