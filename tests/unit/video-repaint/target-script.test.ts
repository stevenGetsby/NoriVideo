import { beforeEach, describe, expect, it, vi } from 'vitest'

const billing = vi.hoisted(() => ({ withTextBilling: vi.fn() }))
const gateway = vi.hoisted(() => ({ runModelGatewayTextCompletion: vi.fn() }))
vi.mock('@/lib/billing', () => billing)
vi.mock('@/lib/model-gateway/llm', () => gateway)
vi.mock('@/lib/billing/runtime-usage', () => ({ recordTextUsage: vi.fn() }))

import { buildTargetScriptInput, generateTargetScript, MAX_TARGET_SCRIPT_OUTPUT_TOKENS } from '@/lib/video-repaint/target-script'

const SCRIPT = '《拒领三百万》\n第 1 集 《两套房加三百万》\n## S1 [老家堂屋 · 日间 · 内] 角色：李建国\n造型：李建国=红棕色冲锋衣\n### SH001 [00:00.0-00:02.8]\n镜头：中景\n画面：李建国撑桌。\n表情动作：愤怒。\n光影：自然侧光。\n李建国 (对口型·愤怒)：{这钱我不敢要！}'

describe('target script generation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    billing.withTextBilling.mockImplementation(async (...args: unknown[]) => (args[5] as () => Promise<unknown>)())
    gateway.runModelGatewayTextCompletion.mockResolvedValue({
      choices: [{ message: { content: `\`\`\`markdown\n${SCRIPT}\n\`\`\`` } }],
      usage: { prompt_tokens: 300, completion_tokens: 150 },
    })
  })

  it('writes the detailed target script from the outline without depending on storyboard', async () => {
    const result = await generateTargetScript({
      userId: 'user-1', title: '拒领三百万', brief: '面向中国视频号', durationSeconds: 158,
      sourceScript: '第1集\n场景：堂屋', outline: '1. 目标市场版故事核与类型承诺\n家庭伦理',
      sourceAnalysis: { source_episode: { duration_seconds: 158 } }, requestId: 'req-script',
    })
    expect(result.targetScript).toBe(SCRIPT)
    expect(billing.withTextBilling).toHaveBeenCalledWith(
      'user-1', 'nori::nori-gpt', expect.any(Number), MAX_TARGET_SCRIPT_OUTPUT_TOKENS,
      expect.objectContaining({ action: 'video_repaint_target_script', requestId: 'req-script' }), expect.any(Function),
    )
    const messages = gateway.runModelGatewayTextCompletion.mock.calls[0][0].messages
    expect(messages[0].content).toContain('### SH001 [00:00.0-00:02.8]')
    expect(messages[0].content).toContain('表情动作')
    expect(messages[1].content).toContain('158.0 秒（最后一镜结束于此）')
    expect(messages[1].content).toContain('<target_outline>')
    expect(messages[1].content).toContain('源剧本共有 0 行对白')
    expect(messages[1].content).not.toContain('<storyboard>')
  })

  it('does not mistake production field labels for dialogue', async () => {
    const result = await generateTargetScript({
      userId: 'u', sourceScript: '第1集\n场景：堂屋\n人物：母亲\n画面：母亲看向门口。\n造型：母亲=灰色外套', outline: '总纲',
    })
    expect(result.targetScript).toBe(SCRIPT)
    expect(gateway.runModelGatewayTextCompletion.mock.calls[0][0].messages[1].content).toContain('源剧本共有 0 行对白')
  })

  it('rejects a dialogue-free rewrite when the source has spoken lines', async () => {
    gateway.runModelGatewayTextCompletion.mockResolvedValueOnce({
      choices: [{ message: { content: '《转绘》\n### SH001 [00:00.0-00:03.0]\n镜头：近景\n画面：人物张嘴说话。\n表情动作：焦急。\n光影：侧光。' } }],
      usage: {},
    })
    await expect(generateTargetScript({
      userId: 'u', sourceScript: '第1集\n1-1\n人物：母亲\n母亲：别走。', outline: '总纲',
    })).rejects.toThrow('DIALOGUE_MISSING')
  })

  it('rejects a rewrite that keeps only part of the source dialogue', async () => {
    gateway.runModelGatewayTextCompletion.mockResolvedValueOnce({
      choices: [{ message: { content: '《转绘》\n### SH001 [00:00.0-00:03.0]\n镜头：近景\n画面：母亲挽留儿子。\n表情动作：焦急。\n光影：侧光。\n母亲 (对口型·焦急)：{别走。}' } }],
      usage: {},
    })
    await expect(generateTargetScript({
      userId: 'u', sourceScript: '第1集\n1-1\n人物：母亲、儿子\n母亲：别走。\n儿子：我必须回去。', outline: '总纲',
    })).rejects.toThrow('DIALOGUE_MISSING')
  })

  it('accepts voiceover and inner monologue towards the required dialogue count', async () => {
    const script = [
      '### SH001 [00:00.0-00:03.0]',
      '镜头：中景',
      '画面：人物走过门口。',
      '表情动作：迟疑。',
      '光影：暗光。',
      '母亲 (画外音·焦急)：{别走。}',
      '儿子 (内心独白·犹豫)：{我不能留下。}',
    ].join('\n')
    gateway.runModelGatewayTextCompletion.mockResolvedValueOnce({ choices: [{ message: { content: script } }], usage: {} })
    const result = await generateTargetScript({
      userId: 'u', sourceScript: '第1集\n1-1\n画外音：别走。\n（内心OS）：我不能留下。', outline: '总纲',
    })
    expect(result.targetScript).toBe(script)
    expect(gateway.runModelGatewayTextCompletion.mock.calls[0][0].messages[1].content).toContain('源剧本共有 2 行对白')
  })

  it('rejects missing source, outline or account before billing', async () => {
    for (const options of [
      { userId: 'u', sourceScript: '', outline: '总纲' },
      { userId: 'u', sourceScript: '源剧本', outline: '' },
      { userId: '', sourceScript: '源剧本', outline: '总纲' },
    ]) await expect(generateTargetScript(options)).rejects.toThrow()
    expect(billing.withTextBilling).not.toHaveBeenCalled()
    expect(gateway.runModelGatewayTextCompletion).not.toHaveBeenCalled()
  })

  it('rejects an empty model response', async () => {
    gateway.runModelGatewayTextCompletion.mockResolvedValueOnce({ choices: [{ message: { content: ' ' } }] })
    await expect(generateTargetScript({ userId: 'u', sourceScript: '源剧本', outline: '总纲' }))
      .rejects.toThrow('EMPTY_RESPONSE')
  })
})

describe('buildTargetScriptInput', () => {
  it('orders outline before the source and handles an omitted brief and duration', () => {
    const input = buildTargetScriptInput({ sourceScript: '源剧本', outline: '总纲' })
    expect(input).toContain('（用户没有填写转绘需求）')
    expect(input).toContain('以源剧本时长信息为准')
    expect(input.indexOf('<target_outline>')).toBeLessThan(input.indexOf('<source_script>'))
  })
})
