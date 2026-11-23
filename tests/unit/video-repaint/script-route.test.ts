import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const auth = vi.hoisted(() => ({ requireUserAuth: vi.fn(), isErrorResponse: (value: unknown) => value instanceof Response }))
const billing = vi.hoisted(() => ({ withTextBilling: vi.fn() }))
const gateway = vi.hoisted(() => ({ runModelGatewayTextCompletion: vi.fn() }))
const usage = vi.hoisted(() => ({ recordServiceUsage: vi.fn(async () => undefined) }))
vi.mock('@/lib/api-auth', () => auth)
vi.mock('@/lib/billing', () => billing)
vi.mock('@/lib/model-gateway/llm', () => gateway)
vi.mock('@/lib/billing/runtime-usage', () => ({ recordTextUsage: vi.fn() }))
vi.mock('@/lib/platform-services/usage', () => usage)

function post(payload: unknown) {
  return import('@/app/api/video-repaint/script/route').then(({ POST }) => POST(new NextRequest('http://localhost/api/video-repaint/script', {
    method: 'POST', body: JSON.stringify(payload),
  }) as never, { params: Promise.resolve({}) }))
}

const valid = { title: '第一集', sourceScript: '第1集\n场景：堂屋', outline: '1. 目标市场版故事核与类型承诺\n家庭伦理', durationSeconds: 158 }
const response = { choices: [{ message: { content: '《目标剧本》\n### SH001 [00:00.0-00:02.8]' } }], usage: { prompt_tokens: 20, completion_tokens: 10 } }

describe('/api/video-repaint/script', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    auth.requireUserAuth.mockResolvedValue({ session: { user: { id: 'user-1', actorId: 'actor-1' } } })
    billing.withTextBilling.mockImplementation(async (...args: unknown[]) => (args[5] as () => Promise<unknown>)())
    gateway.runModelGatewayTextCompletion.mockResolvedValue(response)
  })

  it('requires auth and validates source and outline before billing', async () => {
    auth.requireUserAuth.mockResolvedValueOnce(NextResponse.json({}, { status: 401 }))
    expect((await post(valid)).status).toBe(401)
    for (const payload of [null, {}, { ...valid, sourceScript: ' ' }, { ...valid, outline: '' }, { ...valid, outline: 'x'.repeat(400_001) }]) {
      expect((await post(payload)).status).toBe(400)
    }
    expect(billing.withTextBilling).not.toHaveBeenCalled()
  })

  it('returns the script and records usage without exposing the protected model key', async () => {
    const result = await post(valid)
    const payload = await result.json()
    expect(result.status).toBe(200)
    expect(payload.result.targetScript).toContain('SH001')
    expect(JSON.stringify(payload)).not.toContain('nori::nori-gpt')
    expect(gateway.runModelGatewayTextCompletion.mock.calls[0][0].messages[1].content).toContain('158.0 秒')
    expect(usage.recordServiceUsage).toHaveBeenCalledWith(expect.objectContaining({ operation: 'target-script', userId: 'actor-1' }))
  })

  it('reports omitted dialogue as a retryable generation failure', async () => {
    const result = await post({ ...valid, sourceScript: '第1集\n人物：母亲\n母亲：别走。' })
    expect(result.status).toBe(502)
    expect(await result.json()).toMatchObject({
      error: { code: 'EMPTY_RESPONSE', message: '目标剧本漏掉了源视频台词，请重新生成', retryable: true },
    })
    expect(usage.recordServiceUsage).not.toHaveBeenCalled()
  })

  it('sanitizes provider failures', async () => {
    gateway.runModelGatewayTextCompletion.mockRejectedValueOnce(new Error('failed sk-secret-123456 at https://private.internal/v1'))
    const result = await post(valid)
    expect(result.status).toBe(502)
    const text = await result.text()
    expect(text).not.toContain('sk-secret-123456')
    expect(text).not.toContain('private.internal')
  })
})
