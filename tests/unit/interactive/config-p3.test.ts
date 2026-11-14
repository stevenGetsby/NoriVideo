import { describe, expect, it } from 'vitest'
import {
  STORY_ACHIEVEMENT_DESCRIPTION_MAX,
  STORY_ACHIEVEMENT_LIMIT,
  STORY_ACHIEVEMENT_NAME_MAX,
  STORY_PERSONALITY_DESCRIPTION_MAX,
  STORY_PERSONALITY_NAME_MAX,
  STORY_REWARD_TITLE_MAX,
  normalizeStoryConfig,
  parseStoryConfigInput,
} from '@/lib/interactive/config'
import { STORY_SAVE_POINT_NAME_MAX, compileChapter, readEndingData, readSavePoint } from '@/lib/interactive/compile'
import { ending, entry, flow, scene } from './economy-fixture'

const shopWith = (item: Record<string, unknown>) => ({ shop: { enabled: true, items: [{ id: 'i1', name: '补品', ...item }] } })
const rewardOf = (item: Record<string, unknown>) => normalizeStoryConfig(shopWith(item)).shop?.items[0]?.reward

const achievementInput = (extra: Record<string, unknown> = {}) =>
  ({ id: 'a1', name: '好结局', condition: { type: 'ending', projectId: 'p', nodeId: 'goodend' }, ...extra })
const achievementsOf = (...items: unknown[]) => normalizeStoryConfig({ achievements: items }).achievements

describe('shop item rewards', () => {
  it('keeps a title and a frame picture, trimming the title to its limit', () => {
    expect(rewardOf({ reward: { title: '  最强王者  ', frameUrl: ' /gold.png ' } })).toEqual({ title: '最强王者', frameUrl: '/gold.png' })
    expect(rewardOf({ reward: { title: '一二三四五六七八九十十一十二十三', frameUrl: null } })?.title).toHaveLength(STORY_REWARD_TITLE_MAX)
    expect(rewardOf({ reward: { title: '王者' } })).toEqual({ title: '王者', frameUrl: null })
    expect(rewardOf({ reward: { frameUrl: '/gold.png' } })).toEqual({ title: '', frameUrl: '/gold.png' })
  })

  it('drops a reward that carries neither a title nor a usable picture', () => {
    for (const reward of [{ title: '', frameUrl: null }, { title: '   ' }, {}, { frameUrl: 'x'.repeat(501) }, null, 'gold', 3, []]) {
      const item = normalizeStoryConfig(shopWith({ reward })).shop?.items[0]
      expect(item).toBeDefined()
      expect('reward' in (item ?? {})).toBe(false)
    }
    expect('reward' in (normalizeStoryConfig(shopWith({})).shop?.items[0] ?? {})).toBe(false)
  })

  it('accepts a shop whose items carry rewards through the strict check', () => {
    const result = parseStoryConfigInput(shopWith({ reward: { title: '称号', frameUrl: null } }))
    expect(result).toMatchObject({ ok: true })
    expect(result.ok && result.config.shop?.items[0]?.reward).toEqual({ title: '称号', frameUrl: null })
  })
})

describe('achievements in the stored config', () => {
  it('reads each kind of condition', () => {
    const read = achievementsOf(
      achievementInput({ id: 'a1', condition: { type: 'ending', projectId: 'p', nodeId: 'goodend' } }),
      achievementInput({ id: 'a2', condition: { type: 'segment', projectId: 'p', nodeId: 's2' } }),
      achievementInput({ id: 'a3', condition: { type: 'value', variableId: 'coin', op: '>', value: 3 } }),
      achievementInput({ id: 'a4', condition: { type: 'all_endings' } }),
      achievementInput({ id: 'a5', condition: { type: 'all_achievements' } }),
    )
    expect(read?.map((item) => item.condition)).toEqual([
      { type: 'ending', projectId: 'p', nodeId: 'goodend' },
      { type: 'segment', projectId: 'p', nodeId: 's2' },
      { type: 'value', variableId: 'coin', op: '>', value: 3 },
      { type: 'all_endings' },
      { type: 'all_achievements' },
    ])
  })

  it('defaults a value condition to "at least" and its number to zero when they are unreadable', () => {
    const [read] = achievementsOf(achievementInput({ condition: { type: 'value', variableId: 'coin', op: '~=', value: 'many' } })) ?? []
    expect(read?.condition).toEqual({ type: 'value', variableId: 'coin', op: '>=', value: 0 })
    const [flag] = achievementsOf(achievementInput({ condition: { type: 'value', variableId: 'seen', op: '==', value: true } })) ?? []
    expect(flag?.condition).toEqual({ type: 'value', variableId: 'seen', op: '==', value: true })
  })

  it('trims names and descriptions to their limits and fills a missing reward and icon', () => {
    const [read] = achievementsOf(achievementInput({
      name: `  ${'名'.repeat(40)}  `,
      description: ` ${'述'.repeat(300)} `,
      icon: '  🏆 ',
    })) ?? []
    expect(read?.name).toHaveLength(STORY_ACHIEVEMENT_NAME_MAX)
    expect(read?.description).toHaveLength(STORY_ACHIEVEMENT_DESCRIPTION_MAX)
    expect(read?.icon).toBe('🏆')
    expect(read?.reward).toEqual({ title: '', frameUrl: null })
    const [bare] = achievementsOf(achievementInput({ reward: { title: '最强王者最强王者最强王者', frameUrl: '/crown.png' } })) ?? []
    expect(bare?.reward.title).toHaveLength(STORY_REWARD_TITLE_MAX)
    expect(bare?.reward.frameUrl).toBe('/crown.png')
    expect(achievementsOf(achievementInput())?.[0]).toMatchObject({ description: '', icon: null })
  })

  it('drops entries it cannot read and repeated ids, keeping the first', () => {
    const read = achievementsOf(
      achievementInput({ id: 'ok', name: '甲' }),
      achievementInput({ id: 'ok', name: '乙' }),
      achievementInput({ id: 'bad id', name: '丙' }),
      achievementInput({ id: 'noname', name: '   ' }),
      achievementInput({ id: 'notype', condition: { type: 'mystery' } }),
      achievementInput({ id: 'noending', condition: { type: 'ending', projectId: 'p', nodeId: '' } }),
      achievementInput({ id: 'novar', condition: { type: 'value', variableId: 'bad var', op: '>=', value: 1 } }),
      achievementInput({ id: 'nocondition', condition: null }),
      'nope',
      null,
    )
    expect(read?.map((item) => [item.id, item.name])).toEqual([['ok', '甲']])
  })

  it('stops at the limit', () => {
    const many = Array.from({ length: STORY_ACHIEVEMENT_LIMIT + 10 }, (_, index) => achievementInput({ id: `a${index}`, name: `成就${index}` }))
    expect(achievementsOf(...many)).toHaveLength(STORY_ACHIEVEMENT_LIMIT)
  })

  it('keeps an empty list as an empty list and leaves the key out for anything that is not a list', () => {
    expect(normalizeStoryConfig({ achievements: [] }).achievements).toEqual([])
    for (const raw of ['x', 3, {}, null, undefined]) expect('achievements' in normalizeStoryConfig({ achievements: raw })).toBe(false)
  })
})

describe('personality test in the stored config', () => {
  const personalityOf = (raw: unknown) => normalizeStoryConfig({ personality: raw }).personality

  it('keeps only the sixteen types, with their name, copy and picture', () => {
    const read = personalityOf({
      enabled: true,
      results: {
        ENFP: { name: ' 热情家 ', description: ' 一路热情。 ', imageUrl: ' /enfp.png ' },
        ISTJ: { name: '检查官' },
        XXXX: { name: '不存在' },
        enfp: { name: '小写' },
        EEEE: { name: '重复字母' },
      },
    })
    expect(read).toEqual({
      enabled: true,
      results: {
        ENFP: { name: '热情家', description: '一路热情。', imageUrl: '/enfp.png' },
        ISTJ: { name: '检查官', description: '', imageUrl: null },
      },
    })
  })

  it('trims over-long names and copy, and drops a result with nothing in it', () => {
    const read = personalityOf({
      enabled: true,
      results: {
        INFJ: { name: '名'.repeat(60), description: '述'.repeat(900), imageUrl: '' },
        ESTP: { name: '  ', description: '', imageUrl: null },
        ISFP: 'text',
        ENTJ: null,
      },
    })
    expect(read?.results.INFJ?.name).toHaveLength(STORY_PERSONALITY_NAME_MAX)
    expect(read?.results.INFJ?.description).toHaveLength(STORY_PERSONALITY_DESCRIPTION_MAX)
    expect(read?.results.INFJ?.imageUrl).toBeNull()
    expect(Object.keys(read?.results ?? {})).toEqual(['INFJ'])
  })

  it('is enabled only by a literal true and tolerates a missing or broken results object', () => {
    expect(personalityOf({ enabled: 'yes', results: {} })).toEqual({ enabled: false, results: {} })
    expect(personalityOf({ enabled: true })).toEqual({ enabled: true, results: {} })
    expect(personalityOf({ enabled: true, results: ['ENFP'] })).toEqual({ enabled: true, results: {} })
  })

  it('leaves the key out when the value is not an object', () => {
    for (const raw of ['x', 3, [], null, undefined]) expect('personality' in normalizeStoryConfig({ personality: raw })).toBe(false)
  })
})

describe('map in the stored config', () => {
  it('is on only for a literal true', () => {
    expect(normalizeStoryConfig({ map: { enabled: true } }).map).toEqual({ enabled: true })
    expect(normalizeStoryConfig({ map: { enabled: 1 } }).map).toEqual({ enabled: false })
    expect(normalizeStoryConfig({ map: {} }).map).toEqual({ enabled: false })
  })

  it('leaves the key out when the value is not an object', () => {
    for (const raw of ['x', true, [], null, undefined]) expect('map' in normalizeStoryConfig({ map: raw })).toBe(false)
  })
})

describe('configs saved before these settings existed', () => {
  it('gain none of the new keys', () => {
    const old = normalizeStoryConfig({
      variables: [{ id: 'hp', name: '体力', type: 'number', initial: 3 }],
      chapters: [{ projectId: 'p1', order: 0, status: 'final' }],
      links: [],
      start: { projectId: 'p1', entryNodeId: 'in' },
    })
    expect(Object.keys(old).sort()).toEqual(['chapters', 'links', 'start', 'variables', 'version'])
    expect(Object.keys(normalizeStoryConfig(null)).sort()).toEqual(['chapters', 'links', 'start', 'variables', 'version'])
  })

  it('round-trip through the normalizer unchanged once they carry the new settings', () => {
    const full = normalizeStoryConfig({
      variables: [{ id: 'coin', name: '金币', type: 'number', initial: 0 }],
      achievements: [achievementInput({ reward: { title: '最强王者', frameUrl: '/gold.png' } })],
      personality: { enabled: true, results: { ENFP: { name: '热情家', description: '一路热情。', imageUrl: '/enfp.png' } } },
      map: { enabled: true },
      shop: { enabled: true, currencyVariableId: 'coin', items: [{ id: 'i1', name: '头像框', price: 5, limit: 1, effects: [], reward: { title: '', frameUrl: '/gold.png' } }] },
    })
    expect(normalizeStoryConfig(JSON.parse(JSON.stringify(full)))).toEqual(full)
  })
})

describe('strict check of a submitted config', () => {
  const message = (raw: Record<string, unknown>) => {
    const result = parseStoryConfigInput(raw)
    return result.ok ? null : result.message
  }

  it('rejects achievements that are not a list, too many, unreadable or repeated', () => {
    expect(message({ achievements: 'x' })).toBe('成就配置格式错误。')
    expect(message({ achievements: {} })).toBe('成就配置格式错误。')
    expect(message({ achievements: Array.from({ length: STORY_ACHIEVEMENT_LIMIT + 1 }, (_, index) => achievementInput({ id: `a${index}` })) })).toBe(`成就最多 ${STORY_ACHIEVEMENT_LIMIT} 个。`)
    expect(message({ achievements: [achievementInput(), achievementInput({ name: '' })] })).toBe('成就需要合法的 ID、名称和达成条件。')
    expect(message({ achievements: [achievementInput({ condition: { type: 'mystery' } })] })).toBe('成就需要合法的 ID、名称和达成条件。')
    expect(message({ achievements: [achievementInput(), achievementInput({ name: '另一个' })] })).toBe('成就 ID 重复。')
  })

  it('accepts a clean list, an empty list, and null or missing achievements', () => {
    expect(message({ achievements: [achievementInput(), achievementInput({ id: 'a2', condition: { type: 'all_endings' } })] })).toBeNull()
    expect(message({ achievements: [] })).toBeNull()
    expect(message({ achievements: null })).toBeNull()
    expect(message({})).toBeNull()
  })

  it('rejects a personality block that is not an object or whose results are not an object', () => {
    expect(message({ personality: 'x' })).toBe('人格测试配置格式错误。')
    expect(message({ personality: [] })).toBe('人格测试配置格式错误。')
    expect(message({ personality: { enabled: true, results: 'ENFP' } })).toBe('人格测试配置格式错误。')
    expect(message({ personality: { enabled: true, results: [] } })).toBe('人格测试配置格式错误。')
  })

  it('accepts a personality block with unknown types in it, because the normalizer simply drops them', () => {
    const result = parseStoryConfigInput({ personality: { enabled: true, results: { ENFP: { name: '热情家' }, ZZZZ: { name: '无' } } } })
    expect(result.ok && Object.keys(result.config.personality?.results ?? {})).toEqual(['ENFP'])
    expect(message({ personality: null })).toBeNull()
    expect(message({ personality: { enabled: false } })).toBeNull()
  })

  it('rejects a map block that is not an object', () => {
    expect(message({ map: 'on' })).toBe('地图配置格式错误。')
    expect(message({ map: [] })).toBe('地图配置格式错误。')
    expect(message({ map: true })).toBe('地图配置格式错误。')
    expect(message({ map: { enabled: true } })).toBeNull()
    expect(message({ map: null })).toBeNull()
  })
})

describe('ending nodes', () => {
  it('show the personality only when the creator ticked the box', () => {
    expect(readEndingData({ endingType: 'good', showPersonality: true })).toEqual({ endingType: 'good', description: '', showPersonality: true })
    for (const value of [false, 'true', 1, null, undefined]) expect('showPersonality' in readEndingData({ endingType: 'good', showPersonality: value })).toBe(false)
    expect(readEndingData({})).toEqual({ endingType: 'normal', description: '' })
  })

  it('carry the flag into the compiled chapter', () => {
    const chapter = compileChapter(
      { projectId: 'p', title: '章' },
      [entry, scene('s1'), { id: 'shown', type: 'story_ending', data: { title: '甲', endingType: 'good', showPersonality: true } }, ending('plain')],
      [flow('f1', 'in', 's1'), flow('f2', 's1', 'shown')],
    )
    const shown = chapter.nodes.find((node) => node.id === 'shown')
    const plain = chapter.nodes.find((node) => node.id === 'plain')
    expect(shown).toMatchObject({ kind: 'ending', showPersonality: true })
    expect(plain).toMatchObject({ kind: 'ending' })
    expect(plain && 'showPersonality' in plain).toBe(false)
  })
})

describe('segment save points', () => {
  it('exist only while the creator keeps the box ticked', () => {
    expect(readSavePoint(undefined)).toBeUndefined()
    expect(readSavePoint({ enabled: false, name: '雨夜' })).toBeUndefined()
    expect(readSavePoint({ name: '雨夜' })).toBeUndefined()
    expect(readSavePoint('on')).toBeUndefined()
    expect(readSavePoint({ enabled: 'true' })).toBeUndefined()
    expect(readSavePoint({ enabled: true, name: ' 雨夜 ', coverUrl: '/rain.png' })).toEqual({ name: '雨夜', coverUrl: '/rain.png' })
  })

  it('fall back to the supplied name when the creator left it blank, and trim a long one', () => {
    expect(readSavePoint({ enabled: true, name: '   ' }, '片段一')).toEqual({ name: '片段一', coverUrl: null })
    expect(readSavePoint({ enabled: true }, '片段一')?.name).toBe('片段一')
    expect(readSavePoint({ enabled: true, name: '名'.repeat(80) })?.name).toHaveLength(STORY_SAVE_POINT_NAME_MAX)
  })

  it('read the cover as a non-empty string or nothing', () => {
    expect(readSavePoint({ enabled: true, coverUrl: '' })?.coverUrl).toBeNull()
    expect(readSavePoint({ enabled: true, coverUrl: 5 })?.coverUrl).toBeNull()
    expect(readSavePoint({ enabled: true, coverUrl: '/a.png' })?.coverUrl).toBe('/a.png')
  })

  it('are named after the segment in a compiled chapter and left off segments that are not save points', () => {
    const chapter = compileChapter(
      { projectId: 'p', title: '章' },
      [
        entry,
        scene('named', { title: '雨中', savePoint: { enabled: true, name: '雨夜', coverUrl: '/rain.png' } }),
        scene('unnamed', { title: '街角', savePoint: { enabled: true } }),
        scene('off', { title: '路过', savePoint: { enabled: false, name: '不存' } }),
        scene('plain', { title: '普通' }),
        ending('end'),
      ],
      [flow('f1', 'in', 'named'), flow('f2', 'named', 'unnamed'), flow('f3', 'unnamed', 'off'), flow('f4', 'off', 'plain'), flow('f5', 'plain', 'end')],
    )
    const point = (id: string) => {
      const node = chapter.nodes.find((item) => item.id === id)
      return node?.kind === 'scene' ? node.savePoint : undefined
    }
    expect(point('named')).toEqual({ name: '雨夜', coverUrl: '/rain.png' })
    expect(point('unnamed')).toEqual({ name: '街角', coverUrl: null })
    expect(point('off')).toBeUndefined()
    expect(point('plain')).toBeUndefined()
    const off = chapter.nodes.find((item) => item.id === 'off')
    expect(off && 'savePoint' in off).toBe(false)
  })
})
