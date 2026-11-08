import { beforeEach, describe, expect, it, vi } from 'vitest'

const billingMock = vi.hoisted(() => ({
  withTextBilling: vi.fn(),
}))
const gatewayMock = vi.hoisted(() => ({
  runModelGatewayTextCompletion: vi.fn(),
}))
const usageMock = vi.hoisted(() => ({
  recordTextUsage: vi.fn(),
}))
const trace = vi.hoisted(() => ({ order: [] as string[] }))

vi.mock('@/lib/billing', () => billingMock)
vi.mock('@/lib/billing/runtime-usage', () => usageMock)
vi.mock('@/lib/model-gateway/llm', () => gatewayMock)

import {
  MAX_ADAPTATION_INPUT_TOKENS,
  MAX_ADAPTATION_OUTPUT_TOKENS,
  VIDEO_REPAINT_ADAPTATION_MODEL,
  buildVideoScriptAdaptationInput,
  stripModelWrapper,
  adaptVideoScript,
} from '@/lib/video-repaint/adaptation'

function completion(content: string, promptTokens = 120, completionTokens = 60) {
  return {
    choices: [{ message: { role: 'assistant', content } }],
    usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens },
  }
}

describe('video repaint script adaptation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    trace.order = []
    billingMock.withTextBilling.mockImplementation(async (...args: unknown[]) => {
      trace.order.push('billing')
      const generateFn = args[5] as () => Promise<unknown>
      return await generateFn()
    })
    gatewayMock.runModelGatewayTextCompletion.mockImplementation(async () => {
      trace.order.push('gateway')
      return completion('```text\n第1集\n场景：北美公寓 - 夜\n△人物抬头。\n```')
    })
  })

  it('returns the source script for free when there is no adaptation brief', async () => {
    const result = await adaptVideoScript({
      userId: 'user-1',
      sourceScript: '  第1集\n场景：原场景  ',
    })

    expect(result).toEqual({
      script: '第1集\n场景：原场景',
      mode: 'source_copy',
      model: '',
      usage: { inputTokens: 0, outputTokens: 0 },
    })
    expect(billingMock.withTextBilling).not.toHaveBeenCalled()
    expect(gatewayMock.runModelGatewayTextCompletion).not.toHaveBeenCalled()
    expect(usageMock.recordTextUsage).not.toHaveBeenCalled()
  })

  it('bills the protected business model before submitting to the gateway', async () => {
    const result = await adaptVideoScript({
      userId: 'user-1',
      sourceScript: '第1集\n场景：出租屋 - 夜',
      adaptationBrief: '改为北美现代都市语境',
      adaptationContract: { story_invariants: ['主角要找回妹妹'] },
      title: '第一集',
      requestId: 'req-1',
    })

    expect(trace.order).toEqual(['billing', 'gateway'])
    expect(billingMock.withTextBilling).toHaveBeenCalledWith(
      'user-1',
      VIDEO_REPAINT_ADAPTATION_MODEL,
      expect.any(Number),
      MAX_ADAPTATION_OUTPUT_TOKENS,
      expect.objectContaining({
        projectId: 'video-repaint',
        action: 'video_repaint_script_adaptation',
        requestId: 'req-1',
      }),
      expect.any(Function),
    )
    const billedInputTokens = billingMock.withTextBilling.mock.calls[0]?.[2] as number
    expect(billedInputTokens).toBeGreaterThanOrEqual(4_000)
    expect(billedInputTokens).toBeLessThanOrEqual(MAX_ADAPTATION_INPUT_TOKENS)

    expect(gatewayMock.runModelGatewayTextCompletion).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      model: VIDEO_REPAINT_ADAPTATION_MODEL,
      options: expect.objectContaining({ maxTokens: MAX_ADAPTATION_OUTPUT_TOKENS }),
    }))
    const messages = gatewayMock.runModelGatewayTextCompletion.mock.calls[0]?.[0]?.messages as Array<{ content: string }>
    expect(messages[0]?.content).toContain('JSON')
    expect(messages[1]?.content).toContain('<source_script>')
    expect(messages[1]?.content).toContain('主角要找回妹妹')

    expect(usageMock.recordTextUsage).toHaveBeenCalledWith({
      model: VIDEO_REPAINT_ADAPTATION_MODEL,
      inputTokens: 120,
      outputTokens: 60,
    })
    expect(result).toEqual({
      script: '第1集\n场景：北美公寓 - 夜\n△人物抬头。',
      mode: 'llm',
      model: VIDEO_REPAINT_ADAPTATION_MODEL,
      usage: { inputTokens: 120, outputTokens: 60 },
    })
  })

  it('rejects an empty source script without billing', async () => {
    await expect(adaptVideoScript({ userId: 'user-1', sourceScript: '   ' }))
      .rejects.toThrow('SOURCE_SCRIPT_MISSING')
    expect(billingMock.withTextBilling).not.toHaveBeenCalled()
  })

  it('rejects an empty model response instead of saving a blank script', async () => {
    gatewayMock.runModelGatewayTextCompletion.mockResolvedValueOnce(completion('   '))

    await expect(adaptVideoScript({
      userId: 'user-1',
      sourceScript: '第1集\n场景：出租屋 - 夜',
      adaptationBrief: '改成英文短剧',
    })).rejects.toThrow('EMPTY_RESPONSE')
  })

  it('does not call the gateway when billing fails', async () => {
    billingMock.withTextBilling.mockRejectedValueOnce(new Error('INSUFFICIENT_BALANCE'))

    await expect(adaptVideoScript({
      userId: 'user-1',
      sourceScript: '第1集\n场景：出租屋 - 夜',
      adaptationBrief: '改成英文短剧',
    })).rejects.toThrow('INSUFFICIENT_BALANCE')
    expect(gatewayMock.runModelGatewayTextCompletion).not.toHaveBeenCalled()
  })

  it('normalizes fenced model output and builds a bounded adaptation input', () => {
    expect(stripModelWrapper('```json\n{"script":"x"}\n```')).toBe('{"script":"x"}')
    expect(stripModelWrapper('  第1集  ')).toBe('第1集')
    const input = buildVideoScriptAdaptationInput({
      title: '第一集',
      sourceScript: '第1集\n场景：出租屋 - 夜',
      adaptationBrief: '改为北美语境',
      adaptationContract: { do_not_localize: ['角色名'] },
    })
    expect(input).toContain('任务名称：第一集')
    expect(input).toContain('用户转绘需求：')
    expect(input).toContain('do_not_localize')
    expect(input).toContain('</source_script>')
  })
})
