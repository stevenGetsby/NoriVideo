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

import { REPAINT_OUTLINE_SECTION_TITLES } from '@/lib/video-repaint/contract'
import {
  MAX_OUTLINE_INPUT_TOKENS,
  MAX_OUTLINE_OUTPUT_TOKENS,
  VIDEO_REPAINT_OUTLINE_MODEL,
  buildTargetOutlineInput,
  compactSourceUnderstanding,
  generateTargetOutline,
  missingOutlineSections,
  stripModelWrapper,
  tidyOutline,
} from '@/lib/video-repaint/outline'

const ALL_CHAPTERS = Array.from({ length: 10 }, (_, index) => index + 1)

function completion(content: string, promptTokens = 120, completionTokens = 60) {
  return {
    choices: [{ message: { role: 'assistant', content } }],
    usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens },
  }
}

function outlineOf(numbers: number[], body: (number: number) => string = (number) => `第${number}章的内容。`): string {
  return numbers
    .map((number) => `${number}. ${REPAINT_OUTLINE_SECTION_TITLES[number - 1]}\n${body(number)}`)
    .join('\n\n')
}

function sentMessages(): Array<{ role: string; content: string }> {
  return gatewayMock.runModelGatewayTextCompletion.mock.calls[0]?.[0]?.messages ?? []
}

describe('video repaint target outline generation', () => {
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
      return completion(`\`\`\`markdown\n好的，以下是总纲：\n${outlineOf(ALL_CHAPTERS)}\n\`\`\``)
    })
  })

  it('bills the protected business model before submitting to the gateway', async () => {
    const result = await generateTargetOutline({
      userId: 'user-1',
      title: '第一集',
      brief: '改为北美现代都市语境，面向 TikTok 观众',
      sourceScript: '第1集\n场景：出租屋 - 夜',
      sourceAnalysis: { adaptation_contract: { story_invariants: ['主角要找回妹妹'] } },
      requestId: 'req-1',
    })

    expect(trace.order).toEqual(['billing', 'gateway'])
    expect(billingMock.withTextBilling).toHaveBeenCalledWith(
      'user-1',
      VIDEO_REPAINT_OUTLINE_MODEL,
      expect.any(Number),
      MAX_OUTLINE_OUTPUT_TOKENS,
      expect.objectContaining({
        projectId: 'video-repaint',
        action: 'video_repaint_target_outline',
        requestId: 'req-1',
        metadata: expect.objectContaining({ operation: 'target-outline', hasBrief: true }),
      }),
      expect.any(Function),
    )
    const billedInputTokens = billingMock.withTextBilling.mock.calls[0]?.[2] as number
    expect(billedInputTokens).toBeGreaterThanOrEqual(4_000)
    expect(billedInputTokens).toBeLessThanOrEqual(MAX_OUTLINE_INPUT_TOKENS)

    expect(gatewayMock.runModelGatewayTextCompletion).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      model: VIDEO_REPAINT_OUTLINE_MODEL,
      options: expect.objectContaining({
        maxTokens: MAX_OUTLINE_OUTPUT_TOKENS,
        reasoning: false,
        projectId: 'video-repaint',
        action: 'video_repaint_target_outline',
      }),
    }))
    const [system, user] = sentMessages()
    expect(system).toMatchObject({ role: 'system' })
    expect(user).toMatchObject({ role: 'user' })
    expect(user.content).toContain('任务名称：第一集')
    expect(user.content).toContain('改为北美现代都市语境，面向 TikTok 观众')
    expect(user.content).toContain('<source_script>')
    expect(user.content).toContain('主角要找回妹妹')

    expect(usageMock.recordTextUsage).toHaveBeenCalledWith({
      model: VIDEO_REPAINT_OUTLINE_MODEL,
      inputTokens: 120,
      outputTokens: 60,
    })
    expect(result).toEqual({
      outline: outlineOf(ALL_CHAPTERS),
      model: VIDEO_REPAINT_OUTLINE_MODEL,
      usage: { inputTokens: 120, outputTokens: 60 },
      missingSections: [],
    })
  })

  it('still writes the outline when the user gave no brief, and says so in the prompt', async () => {
    const result = await generateTargetOutline({
      userId: 'user-1',
      sourceScript: '第1集\n场景：出租屋 - 夜',
    })

    expect(billingMock.withTextBilling).toHaveBeenCalledTimes(1)
    expect(gatewayMock.runModelGatewayTextCompletion).toHaveBeenCalledTimes(1)
    expect(billingMock.withTextBilling.mock.calls[0]?.[4]).toMatchObject({
      metadata: { operation: 'target-outline', hasBrief: false },
    })
    expect(sentMessages()[1]?.content).toContain('（用户没有填写转绘需求）')
    expect(sentMessages()[1]?.content).toContain('任务名称：未命名单集')
    expect(result.outline).toBe(outlineOf(ALL_CHAPTERS))
  })

  it('sends a system prompt that names every chapter the heading matcher looks for', async () => {
    await generateTargetOutline({ userId: 'user-1', sourceScript: '第1集\n场景：出租屋 - 夜' })

    const system = sentMessages()[0]?.content ?? ''
    for (const title of REPAINT_OUTLINE_SECTION_TITLES) {
      expect(system).toContain(title)
    }
  })

  it('reports the chapters the model left out so the client can offer a retry', async () => {
    gatewayMock.runModelGatewayTextCompletion.mockResolvedValueOnce(completion(outlineOf([1, 2, 3])))

    const result = await generateTargetOutline({ userId: 'user-1', sourceScript: '第1集\n场景：出租屋 - 夜' })

    expect(result.missingSections).toEqual([4, 5, 6, 7, 8, 9, 10])
    expect(result.outline).toBe(outlineOf([1, 2, 3]))
  })

  it('sizes the billed input window to the prompt and caps it at the model window', async () => {
    await generateTargetOutline({ userId: 'user-1', sourceScript: 'x'.repeat(300_000) })

    expect(billingMock.withTextBilling.mock.calls[0]?.[2]).toBe(MAX_OUTLINE_INPUT_TOKENS)
  })

  it('rejects an empty source script or an unknown account without billing', async () => {
    await expect(generateTargetOutline({ userId: 'user-1', sourceScript: '   ' }))
      .rejects.toThrow('SOURCE_SCRIPT_MISSING')
    await expect(generateTargetOutline({ userId: '  ', sourceScript: '第1集' }))
      .rejects.toThrow('USER_ID_MISSING')
    expect(billingMock.withTextBilling).not.toHaveBeenCalled()
    expect(gatewayMock.runModelGatewayTextCompletion).not.toHaveBeenCalled()
  })

  it('rejects an empty model response instead of saving a blank outline', async () => {
    gatewayMock.runModelGatewayTextCompletion.mockResolvedValueOnce(completion('   '))

    await expect(generateTargetOutline({ userId: 'user-1', sourceScript: '第1集' }))
      .rejects.toThrow('EMPTY_RESPONSE')
  })

  it('does not call the gateway when billing fails', async () => {
    billingMock.withTextBilling.mockRejectedValueOnce(new Error('INSUFFICIENT_BALANCE'))

    await expect(generateTargetOutline({ userId: 'user-1', sourceScript: '第1集' }))
      .rejects.toThrow('INSUFFICIENT_BALANCE')
    expect(gatewayMock.runModelGatewayTextCompletion).not.toHaveBeenCalled()
  })

  it('lets a gateway failure through unchanged', async () => {
    gatewayMock.runModelGatewayTextCompletion.mockRejectedValueOnce(new Error('upstream exploded'))

    await expect(generateTargetOutline({ userId: 'user-1', sourceScript: '第1集' }))
      .rejects.toThrow('upstream exploded')
    expect(usageMock.recordTextUsage).not.toHaveBeenCalled()
  })
})

describe('buildTargetOutlineInput', () => {
  it('lists the brief, the source script and the source understanding in the order the prompt promises', () => {
    const input = buildTargetOutlineInput({
      title: '  第一集  ',
      brief: '  改为北美语境  ',
      sourceScript: '  第1集\n场景：出租屋 - 夜  ',
      sourceAnalysis: { adaptation_contract: { do_not_localize: ['角色名'] } },
    })

    expect(input).toContain('任务名称：第一集')
    const brief = input.indexOf('转绘需求：\n改为北美语境\n')
    const script = input.indexOf('<source_script>\n第1集\n场景：出租屋 - 夜\n</source_script>')
    const understanding = input.indexOf('<source_understanding>')
    expect(brief).toBeGreaterThan(-1)
    expect(script).toBeGreaterThan(brief)
    expect(understanding).toBeGreaterThan(script)
    expect(input).toContain('do_not_localize')
    expect(input.trimEnd().endsWith('</source_understanding>')).toBe(true)
  })

  it('falls back to a default title and an explicit empty-brief note', () => {
    const input = buildTargetOutlineInput({ sourceScript: '第1集', sourceAnalysis: undefined })

    expect(input).toContain('任务名称：未命名单集')
    expect(input).toContain('（用户没有填写转绘需求）')
    expect(input).toContain('<source_understanding>\n{}\n</source_understanding>')
  })
})

describe('compactSourceUnderstanding', () => {
  function analysis() {
    return {
      schema_version: 'nori-video-repaint-analysis-v1',
      series_metadata: { title: '重生复仇记', genre: '都市复仇', language: '中文', notes: '' },
      source_episode: {
        episode_title: '第一集',
        episode_synopsis: '女主在雨夜醒来。',
        duration_seconds: 92.5,
        opening_hook: '雨夜车祸',
        turning_points: ['发现真相', '反击'],
        ending_hook: '电话响起',
        formatted_text: '第1集\n场景：不应出现',
        scenes: [{ scene_id: 'S1', beats: [{ beat_id: 'B1', text: '不应出现' }] }],
      },
      asset_candidates: {
        characters: [{
          asset_ref: 'C1',
          name_if_heard: '林夏',
          description: '女主',
          evidence_ranges: [{ start_time: '00:00:01.000', end_time: '00:00:02.000' }],
        }],
        locations: [{ asset_ref: 'L1', name: '老宅' }],
        props: [{ asset_ref: 'P1', name: '玉佩' }],
      },
      adaptation_contract: { story_invariants: ['复仇主线'], do_not_localize: ['玉佩'] },
      quality_report: {
        uncertainties: ['第 40 秒对白不清'],
        unresolved_speakers: [],
        continuity_conflicts: ['不应出现'],
      },
    }
  }

  it('keeps the characters, places, props and the adaptation contract, and leaves the scene-by-scene beats out', () => {
    const excerpt = JSON.parse(compactSourceUnderstanding(analysis()))

    expect(excerpt).toEqual({
      series_metadata: { title: '重生复仇记', genre: '都市复仇', language: '中文' },
      source_episode: {
        episode_title: '第一集',
        episode_synopsis: '女主在雨夜醒来。',
        duration_seconds: 92.5,
        opening_hook: '雨夜车祸',
        turning_points: ['发现真相', '反击'],
        ending_hook: '电话响起',
      },
      asset_candidates: {
        characters: [{ asset_ref: 'C1', name_if_heard: '林夏', description: '女主' }],
        locations: [{ asset_ref: 'L1', name: '老宅' }],
        props: [{ asset_ref: 'P1', name: '玉佩' }],
      },
      adaptation_contract: { story_invariants: ['复仇主线'], do_not_localize: ['玉佩'] },
      quality_report: { uncertainties: ['第 40 秒对白不清'] },
    })
    expect(compactSourceUnderstanding(analysis())).not.toContain('不应出现')
    expect(compactSourceUnderstanding(analysis())).not.toContain('evidence_ranges')
  })

  it('cuts long lists and long strings so a long video cannot overflow the prompt', () => {
    const characters = Array.from({ length: 60 }, (_, index) => ({
      asset_ref: `C${index}`,
      description: '甲'.repeat(900),
    }))

    const excerpt = JSON.parse(compactSourceUnderstanding({ asset_candidates: { characters } }))

    expect(excerpt.asset_candidates.characters).toHaveLength(40)
    expect(excerpt.asset_candidates.characters[0].description).toHaveLength(600)
  })

  it('tightens the cuts when the first pass is still too long', () => {
    const characters = Array.from({ length: 60 }, (_, index) => ({
      asset_ref: `C${index}`,
      a: '甲'.repeat(900),
      b: '乙'.repeat(900),
      c: '丙'.repeat(900),
    }))

    const text = compactSourceUnderstanding({ asset_candidates: { characters } })
    const excerpt = JSON.parse(text)

    expect(text.length).toBeLessThanOrEqual(60_000)
    expect(excerpt.asset_candidates.characters).toHaveLength(12)
    expect(excerpt.asset_candidates.characters[0].a).toHaveLength(200)
  })

  it('never exceeds the overall cap, even for an adversarially wide contract', () => {
    const contract = Object.fromEntries(Array.from({ length: 400 }, (_, index) => [`key_${index}`, '甲'.repeat(300)]))

    expect(compactSourceUnderstanding({ adaptation_contract: contract }).length).toBeLessThanOrEqual(60_000)
  })

  it('returns an empty object for anything that is not an analysis', () => {
    for (const value of [null, undefined, 'text', 42, [], {}]) {
      expect(compactSourceUnderstanding(value)).toBe('{}')
    }
  })
})

describe('stripModelWrapper', () => {
  it('removes a code fence with or without a language tag and trims plain text', () => {
    expect(stripModelWrapper('```markdown\n1. 标题\n正文\n```')).toBe('1. 标题\n正文')
    expect(stripModelWrapper('```\n正文\n```')).toBe('正文')
    expect(stripModelWrapper('  1. 标题  ')).toBe('1. 标题')
  })
})

describe('tidyOutline', () => {
  it('drops a preface before the first chapter and a code fence around the whole answer', () => {
    const tidy = tidyOutline(`\`\`\`text\n下面是目标设定总纲：\n\n${outlineOf([1, 2])}\n\`\`\``)

    expect(tidy).toBe(outlineOf([1, 2]))
    expect(tidy.startsWith('1. 目标市场版故事核与类型承诺')).toBe(true)
  })

  it('writes decorated headings exactly as "N. 标题", whatever numbering style the model used', () => {
    const raw = [
      '## 1、目标市场版故事核与类型承诺',
      '核心承诺：女主复仇',
      '**2. 目标语言与文字系统合同**',
      '字幕：英文',
      '本地化总策略',
      '策略：整体迁移到美国',
      '4) 权力结构映射：',
      '无',
      '### 5. 主要人物小传（共 3 人）',
      '角色甲（原称谓：乙）：女主',
    ].join('\n')

    expect(tidyOutline(raw)).toBe([
      '1. 目标市场版故事核与类型承诺',
      '核心承诺：女主复仇',
      '',
      '2. 目标语言与文字系统合同',
      '字幕：英文',
      '',
      '3. 本地化总策略',
      '策略：整体迁移到美国',
      '',
      '4. 权力结构映射',
      '无',
      '',
      '5. 主要人物小传',
      '角色甲（原称谓：乙）：女主',
    ].join('\n'))
  })

  it('does not take a body line for a heading', () => {
    const raw = [
      '1. 目标市场版故事核与类型承诺',
      '主要人物：张三',
      '2. 目标语言与文字系统合同',
      '目标语言与文字系统合同',
      '3. 本地化总策略',
      '权力结构映射的细节见第 4 章',
    ].join('\n')

    // "主要人物：张三" is not chapter 5; the repeated earlier title is not a new chapter; the longer sentence is body.
    expect(missingOutlineSections(tidyOutline(raw))).toEqual([4, 5, 6, 7, 8, 9, 10])
    expect(tidyOutline(raw)).toContain('主要人物：张三')
    expect(tidyOutline(raw).split('\n').filter((line) => line === '目标语言与文字系统合同')).toHaveLength(1)
    expect(tidyOutline(raw)).toContain('权力结构映射的细节见第 4 章')
  })

  it('keeps the body as written apart from trailing spaces and runs of blank lines', () => {
    const raw = '1. 目标市场版故事核与类型承诺\n  缩进保留  \n\n\n\n正文第二段\n2. 目标语言与文字系统合同\n内容'

    expect(tidyOutline(raw)).toBe(
      '1. 目标市场版故事核与类型承诺\n  缩进保留\n\n正文第二段\n\n2. 目标语言与文字系统合同\n内容',
    )
  })

  it('hands back the unfenced text when the model wrote no chapter at all', () => {
    expect(tidyOutline('```\n抱歉，无法根据现有内容生成。\n```')).toBe('抱歉，无法根据现有内容生成。')
    expect(tidyOutline('   ')).toBe('')
  })
})

describe('missingOutlineSections', () => {
  it('reports nothing for a complete outline', () => {
    expect(missingOutlineSections(outlineOf(ALL_CHAPTERS))).toEqual([])
  })

  it('reports chapters that are absent', () => {
    expect(missingOutlineSections(outlineOf([1, 2, 3, 5]))).toEqual([4, 6, 7, 8, 9, 10])
  })

  it('reports chapters whose heading has nothing under it', () => {
    const raw = `1. ${REPAINT_OUTLINE_SECTION_TITLES[0]}\n\n2. ${REPAINT_OUTLINE_SECTION_TITLES[1]}\n内容`

    expect(missingOutlineSections(raw)).toEqual([1, 3, 4, 5, 6, 7, 8, 9, 10])
  })

  it('counts "无" with its grounds as written', () => {
    const raw = outlineOf(ALL_CHAPTERS, (number) => (number === 9 ? '无（源剧本只有一集）' : '内容'))

    expect(missingOutlineSections(raw)).toEqual([])
  })

  it('treats an unstructured answer as missing every chapter', () => {
    expect(missingOutlineSections('只有一段话，没有章节')).toEqual(ALL_CHAPTERS)
    expect(missingOutlineSections('')).toEqual(ALL_CHAPTERS)
  })
})
