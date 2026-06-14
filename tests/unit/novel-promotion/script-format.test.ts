import { describe, expect, it, vi } from 'vitest'
import {
  StandardScriptParseError,
  formatScriptPackage,
  normalizeLlmRepairedPackage,
  parseStandardScript,
} from '@/lib/novel-promotion/script-format'

const STANDARD_SCRIPT = `
故事简介
民国雨夜，孤女苏晚卿被迫逃亡，意外卷入军阀陆承煜的权谋与深宅纷争。

人物设定
1. 苏晚卿：孤女，隐忍聪慧，后期成长为复仇者。别名：晚卿
2. 陆承煜：被贬军阀，冷峻克制，实际重情重义。

分集
第1集：雨夜逃亡
苏晚卿被卖给恶霸后趁雨夜逃走，途中遇见陆承煜并被救下。

第2集：入府为妾
为了保护陈阿婆，苏晚卿答应进入陆府，开始面对沈曼柔的刁难。
`

describe('script format parser', () => {
  it('V1 parses the standard story brief, characters and episodes format', () => {
    const pkg = parseStandardScript(STANDARD_SCRIPT, {
      fileName: 'standard.txt',
      mode: 'strict',
    })

    expect(pkg.version).toBe('standard-script-v1')
    expect(pkg.source.fileName).toBe('standard.txt')
    expect(pkg.storyBrief).toContain('民国雨夜')
    expect(pkg.characters).toHaveLength(2)
    expect(pkg.characters[0]).toMatchObject({
      id: 'character-苏晚卿',
      name: '苏晚卿',
      aliases: ['晚卿'],
    })
    expect(pkg.episodes).toHaveLength(2)
    expect(pkg.episodes[0]).toMatchObject({
      id: 'episode-001',
      episodeNumber: 1,
      title: '雨夜逃亡',
    })
    expect(pkg.episodes[1].sourceText).toContain('进入陆府')
  })

  it('V2 accepts relaxed section aliases and episode heading variants', () => {
    const pkg = parseStandardScript(`
剧情简介：
一场误会让女主被迫进入豪门，寻找真相。

角色介绍
- 林知夏：女主，冷静坚韧。
- 顾沉舟：男主，表面冷漠。

分集剧情
EP01 误入顾家
林知夏为了查清父亲旧案，进入顾家。

第二集：旧案线索
顾沉舟发现林知夏的真实目的。
`, { mode: 'relaxed' })

    expect(pkg.storyBrief).toContain('误会')
    expect(pkg.characters.map((item) => item.name)).toEqual(['林知夏', '顾沉舟'])
    expect(pkg.episodes.map((item) => item.episodeNumber)).toEqual([1, 2])
    expect(pkg.episodes[0].title).toBe('误入顾家')
    expect(pkg.episodes[1].title).toBe('旧案线索')
  })

  it('parses episode headings from the whole script when there is no episode section', () => {
    const pkg = parseStandardScript(`
故事简介
女主在旧宅里发现家族秘密。

人物设定
林知夏：女主，冷静坚韧。

第一集：旧宅来信
林知夏收到一封来自旧宅的信。

第二集：夜访祠堂
她在祠堂发现父亲留下的线索。
`, { mode: 'relaxed' })

    expect(pkg.episodes.map((item) => item.episodeNumber)).toEqual([1, 2])
    expect(pkg.episodes[0].title).toBe('旧宅来信')
    expect(pkg.episodes[0].sourceText).toContain('旧宅的信')
    expect(pkg.episodes[1].sourceText).toContain('祠堂')
  })

  it('defaults to one episode when no episode heading exists', () => {
    const pkg = parseStandardScript(`
故事简介
女主在旧宅里发现家族秘密。

人物设定
林知夏：女主，冷静坚韧。

正文
林知夏收到一封来自旧宅的信。她回到故乡，在祠堂发现父亲留下的线索。
`, { mode: 'relaxed' })

    expect(pkg.episodes).toHaveLength(1)
    expect(pkg.episodes[0]).toMatchObject({
      id: 'episode-001',
      episodeNumber: 1,
      title: '第1集',
    })
    expect(pkg.episodes[0].sourceText).toContain('林知夏收到一封来自旧宅的信')
  })

  it('throws structured errors when required sections are missing', () => {
    expect(() => parseStandardScript('只有一段普通故事，没有标准标题。')).toThrow(StandardScriptParseError)
    try {
      parseStandardScript('只有一段普通故事，没有标准标题。')
    } catch (error) {
      expect(error).toBeInstanceOf(StandardScriptParseError)
      expect((error as StandardScriptParseError).code).toBe('STORY_BRIEF_MISSING')
    }
  })

  it('V3 normalizes LLM repaired JSON into the same package shape', () => {
    const pkg = normalizeLlmRepairedPackage({
      storyBrief: '一个少女复仇成长的短剧故事。',
      characters: [
        { name: '苏晚卿', description: '女主，孤女。', aliases: ['晚卿'] },
      ],
      episodes: [
        {
          episodeNumber: 1,
          title: '雨夜逃亡',
          sourceText: '苏晚卿雨夜逃亡，遇见陆承煜。',
          synopsis: '女主逃亡并遇见男主。',
        },
      ],
    }, {
      rawText: '不标准输入',
      fileName: 'repair.txt',
    })

    expect(pkg.source.fileName).toBe('repair.txt')
    expect(pkg.warnings[0].code).toBe('LLM_REPAIR_USED')
    expect(pkg.characters[0].name).toBe('苏晚卿')
    expect(pkg.episodes[0].id).toBe('episode-001')
  })

  it('V3 uses injected LLM repair when rule parsing fails', async () => {
    const executeTextStep = vi.fn(async () => ({
      text: JSON.stringify({
        storyBrief: '非标准剧本被修复成结构化故事。',
        characters: [
          { id: 'character-a', name: '阿宁', description: '女主。', aliases: [] },
        ],
        episodes: [
          {
            id: 'episode-001',
            episodeNumber: 1,
            title: '开场',
            sourceText: '阿宁发现一封旧信。',
            synopsis: '女主发现旧信。',
          },
        ],
      }),
      reasoning: '',
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      completion: {} as never,
    }))

    const { repairStandardScriptWithLlm } = await import('@/lib/novel-promotion/script-format')
    const repaired = await repairStandardScriptWithLlm({
      rawText: '阿宁发现一封旧信，故事由此开始。',
      userId: 'user-1',
      model: 'llm::model',
      executeTextStep,
    })

    expect(executeTextStep).toHaveBeenCalledTimes(1)
    expect(repaired.storyBrief).toContain('结构化故事')
    expect(repaired.characters[0].name).toBe('阿宁')
  })

  it('formatScriptPackage keeps rule parsing first and does not call LLM for valid input', async () => {
    const pkg = await formatScriptPackage({
      rawText: STANDARD_SCRIPT,
      userId: 'user-1',
      model: 'llm::model',
      enableLlmRepair: true,
    })

    expect(pkg.characters).toHaveLength(2)
    expect(pkg.warnings.some((item) => item.code === 'LLM_REPAIR_USED')).toBe(false)
  })
})
