import { NextRequest } from 'next/server'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MockLanguageModelV3, simulateReadableStream } from 'ai/test'
import { InsufficientBalanceError, DailyLimitExceededError } from '@/lib/billing/errors'
import { CanvasAgentModelSelectionError } from '@/lib/canvas-agent/model-catalog'

const auth = vi.hoisted(() => ({ requireProjectAuthLight: vi.fn(), isErrorResponse: (value: unknown) => value instanceof Response }))
const canvas = vi.hoisted(() => ({ requireCanvasInProject: vi.fn() }))
const rate = vi.hoisted(() => ({ checkRateLimit: vi.fn() }))
const threads = vi.hoisted(() => ({ saveCanvasAgentThread: vi.fn(async () => true) }))
const models = vi.hoisted(() => ({ resolveCanvasAgentLanguageModel: vi.fn() }))
const billing = vi.hoisted(() => ({
  prepareStreamingTextBilling: vi.fn(async () => ({ id: 'freeze-1' })),
  settleStreamingTextBilling: vi.fn(async () => undefined),
  rollbackStreamingTextBilling: vi.fn(async () => undefined),
}))
const usage = vi.hoisted(() => ({ recordServiceUsage: vi.fn(async () => undefined) }))
vi.mock('@/lib/api-auth', () => auth)
vi.mock('@/lib/canvas/access', () => canvas)
vi.mock('@/lib/rate-limit', () => rate)
vi.mock('@/lib/canvas-agent/threads', () => threads)
vi.mock('@/lib/canvas-agent/model-runtime', () => models)
vi.mock('@/lib/billing/service', () => billing)
vi.mock('@/lib/platform-services/usage', () => usage)
vi.mock('@/lib/prisma', () => ({ prisma: { project: { findFirst: vi.fn(async () => ({ work: { productLine: 'canvas' } })) } } }))

const projectId = 'project-a'
const canvasId = 'canvas-a'
const routeParams = { params: Promise.resolve({ projectId, canvasId }) }
const body = {
  threadId: '9e3e3d5b-211b-47d9-bd2d-cff23cc89deb',
  messages: [{ id: 'msg-1', role: 'user', parts: [{ type: 'text', text: '请搭一个水墨短片' }] }],
  context: {
    mode: 'canvas', locale: 'zh', autonomy: 'confirm_costly', turnIndex: 0,
    digest: { v: 1, canvas: { title: '合成测试', nodeCount: 0, edgeCount: 0, groupCount: 0 }, selection: [], rows: [], edges: [], omitted: { nodes: 0, edges: 0, byType: {} } },
  },
}

function request(input: unknown = body, headers?: HeadersInit) {
  return new NextRequest('http://127.0.0.1/api/projects/project-a/canvas/canvas-a/agent/chat', {
    method: 'POST', body: JSON.stringify(input), headers,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  auth.requireProjectAuthLight.mockResolvedValue({ session: { user: { id: 'owner-a', actorId: 'actor-a' } } })
  canvas.requireCanvasInProject.mockResolvedValue({ id: canvasId })
  rate.checkRateLimit.mockResolvedValue({ limited: false })
  models.resolveCanvasAgentLanguageModel.mockRejectedValue(new CanvasAgentModelSelectionError('CANVAS_AGENT_MODEL_NOT_CONFIGURED'))
  vi.stubEnv('CANVAS_AGENT_FAKE_MODEL', '1')
})
afterEach(() => vi.unstubAllEnvs())

it('streams a local blueprint without executing any tool and saves the thread for its actor', async () => {
  const { POST } = await import('@/app/api/projects/[projectId]/canvas/[canvasId]/agent/chat/route')
  const response = await POST(request(), routeParams)
  expect(response.status).toBe(200)
  expect(response.headers.get('content-type')).toContain('text/event-stream')
  expect(response.headers.get('cache-control')).toBe('no-store')
  const chunks = await response.text()
  expect(chunks).toContain('"toolName":"build_graph"')
  expect(chunks).not.toContain('"type":"tool-output-available"')
  expect(threads.saveCanvasAgentThread).toHaveBeenCalledWith(expect.objectContaining({
    threadId: body.threadId, projectId, canvasId, userId: 'actor-a',
  }))
  expect(models.resolveCanvasAgentLanguageModel).not.toHaveBeenCalled()
  expect(billing.prepareStreamingTextBilling).not.toHaveBeenCalled()
})

const modelKey = 'deepseek::fixture-model'
function paidFixture(fail = false) {
  vi.stubEnv('CANVAS_AGENT_FAKE_MODEL', '0')
  const languageModel = new MockLanguageModelV3({
    doStream: async () => {
      if (fail) throw new Error('fixture provider failure with private information')
      return {
        stream: simulateReadableStream({ chunks: [{
          type: 'finish', finishReason: { unified: 'stop', raw: undefined },
          usage: {
            inputTokens: { total: 17, noCache: 17, cacheRead: 0, cacheWrite: 0 },
            outputTokens: { total: 6, text: 2, reasoning: 4 },
          },
        }] }),
      }
    },
  })
  models.resolveCanvasAgentLanguageModel.mockResolvedValueOnce({
    languageModel, modelKey, providerId: 'deepseek', supportsTemperature: false,
  })
  return languageModel
}

it('resolves the selected model once and settles its full token usage against the authorized work', async () => {
  const model = paidFixture()
  const { POST } = await import('@/app/api/projects/[projectId]/canvas/[canvasId]/agent/chat/route')
  const response = await POST(request({ ...body, context: { ...body.context, modelKey } }), routeParams)
  expect(response.status).toBe(200)
  await response.text()
  expect(models.resolveCanvasAgentLanguageModel).toHaveBeenCalledOnce()
  expect(models.resolveCanvasAgentLanguageModel).toHaveBeenCalledWith({ userId: 'actor-a', requestedModelKey: modelKey })
  expect(model.doStreamCalls).toHaveLength(1)
  expect(model.doStreamCalls[0]?.temperature).toBeUndefined()
  expect(billing.prepareStreamingTextBilling).toHaveBeenCalledWith(expect.objectContaining({
    userId: 'actor-a', projectId, model: modelKey, action: 'canvas_agent', maxOutputTokens: 16_384,
    metadata: { canvasId, threadId: body.threadId, turnIndex: 0 },
  }))
  expect(billing.settleStreamingTextBilling).toHaveBeenCalledOnce()
  expect(billing.settleStreamingTextBilling).toHaveBeenCalledWith({ id: 'freeze-1' }, {
    model: modelKey, inputTokens: 17, outputTokens: 6,
  })
  expect(billing.rollbackStreamingTextBilling).not.toHaveBeenCalled()
  expect(usage.recordServiceUsage).toHaveBeenCalledWith(expect.objectContaining({
    provider: 'deepseek', modelKey, projectId, operation: 'canvas_agent', inputTokens: 17, outputTokens: 6,
  }))
})

it('rolls back a failed stream, without retrying or returning the provider error', async () => {
  const model = paidFixture(true)
  const { POST } = await import('@/app/api/projects/[projectId]/canvas/[canvasId]/agent/chat/route')
  const response = await POST(request(), routeParams)
  const output = await response.text()
  expect(output).toContain('CANVAS_AGENT_STREAM_FAILED')
  expect(output).not.toContain('private information')
  expect(model.doStreamCalls).toHaveLength(1)
  expect(billing.rollbackStreamingTextBilling).toHaveBeenCalledOnce()
  expect(billing.rollbackStreamingTextBilling).toHaveBeenCalledWith({ id: 'freeze-1' })
  expect(billing.settleStreamingTextBilling).not.toHaveBeenCalled()
})

it('does not call the provider when the balance freeze is refused', async () => {
  const model = paidFixture()
  billing.prepareStreamingTextBilling.mockRejectedValueOnce(new InsufficientBalanceError(1, 0))
  const { POST } = await import('@/app/api/projects/[projectId]/canvas/[canvasId]/agent/chat/route')
  expect((await POST(request(), routeParams)).status).toBe(402)
  expect(model.doStreamCalls).toHaveLength(0)
  const second = paidFixture()
  billing.prepareStreamingTextBilling.mockRejectedValueOnce(new DailyLimitExceededError({ limitPoints: 100, usedPoints: 100 }))
  const response = await POST(request(), routeParams)
  expect(response.status).toBe(429)
  await expect(response.json()).resolves.toMatchObject({ error: { details: { code: 'DAILY_LIMIT' } } })
  expect(second.doStreamCalls).toHaveLength(0)
})

it('does not submit a model context larger than the reserved input window', async () => {
  const model = paidFixture()
  const { POST } = await import('@/app/api/projects/[projectId]/canvas/[canvasId]/agent/chat/route')
  const messages = [{ id: 'm', role: 'user', parts: [{ type: 'text', text: '字'.repeat(100_000) }] }]
  expect((await POST(request({ ...body, messages }), routeParams)).status).toBe(400)
  expect(model.doStreamCalls).not.toHaveLength(1)
  expect(billing.prepareStreamingTextBilling).not.toHaveBeenCalled()
})

it('rejects exhausted round trips and oversized payloads before calling the model', async () => {
  const { POST } = await import('@/app/api/projects/[projectId]/canvas/[canvasId]/agent/chat/route')
  expect((await POST(request({ ...body, context: { ...body.context, turnIndex: 8 } }), routeParams)).status).toBe(400)
  expect((await POST(request(body, { 'content-length': `${4 * 1024 * 1024}` }), routeParams)).status).toBe(400)
  expect(threads.saveCanvasAgentThread).not.toHaveBeenCalled()
})

it('rejects client system messages and remote file inputs without reading them or starting billing', async () => {
  const { POST } = await import('@/app/api/projects/[projectId]/canvas/[canvasId]/agent/chat/route')
  for (const messages of [
    [{ id: 'm', role: 'system', parts: [{ type: 'text', text: 'client-supplied system message' }] }],
    [{ id: 'm', role: 'user', parts: [{ type: 'file', mediaType: 'image/png', url: 'https://untrusted.invalid/photo' }] }],
  ]) {
    const response = await POST(request({ ...body, messages }), routeParams)
    expect(response.status).toBe(400)
  }
  expect(threads.saveCanvasAgentThread).not.toHaveBeenCalled()
  expect(billing.prepareStreamingTextBilling).not.toHaveBeenCalled()
})

it('preserves the daily limit and does not enable the fake model in production', async () => {
  const { POST } = await import('@/app/api/projects/[projectId]/canvas/[canvasId]/agent/chat/route')
  rate.checkRateLimit.mockResolvedValueOnce({ limited: false }).mockResolvedValueOnce({ limited: true, retryAfterSeconds: 3600 })
  expect((await POST(request(), routeParams)).status).toBe(429)
  vi.stubEnv('NODE_ENV', 'production')
  const response = await POST(request(), routeParams)
  expect(response.status).toBe(400)
  await expect(response.json()).resolves.toMatchObject({ error: { details: { code: 'CANVAS_AGENT_MODEL_NOT_CONFIGURED' } } })
  expect(threads.saveCanvasAgentThread).not.toHaveBeenCalled()
})
