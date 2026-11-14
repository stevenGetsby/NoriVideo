import { describe, expect, it } from 'vitest'
import { compileChapter, type CanvasEdgeLike, type CanvasNodeLike } from '@/lib/interactive/compile'
import type { StoryAchievement, StoryIssue, StoryProgram, StoryShop } from '@/lib/interactive/types'
import { countIssues, validateStory } from '@/lib/interactive/validate'
import { beat, ending, entry, flow, mount, scene } from './economy-fixture'
import { achievements, choiceNode, endingWithTest, option, personalityOn, savePoint, storyProgram } from './p3-fixture'

const P3_CODES = [
  'ending_personality_off',
  'personality_no_tags',
  'personality_axis_missing',
  'personality_no_display',
  'achievement_name',
  'achievement_unknown_ending',
  'achievement_unknown_segment',
  'achievement_all_endings_empty',
  'achievement_all_achievements_empty',
  'map_no_save_points',
  'save_points_map_off',
]

const codes = (issues: StoryIssue[]) => issues.map((item) => item.code)
const p3Codes = (program: StoryProgram) => codes(validateStory(program)).filter((code) => P3_CODES.includes(code))
const find = (issues: StoryIssue[], code: string) => issues.find((item) => item.code === code)

function programOf(nodes: CanvasNodeLike[], edges: CanvasEdgeLike[], extra: Parameters<typeof storyProgram>[0] = {}): StoryProgram {
  return { ...storyProgram(extra), chapters: [compileChapter({ projectId: 'p', title: '第一章' }, nodes, edges)] }
}

const achievement = (id: string, condition: StoryAchievement['condition'], name = id): StoryAchievement =>
  ({ id, name, description: '', icon: null, condition, reward: { title: '', frameUrl: null } })

/** in → s1 (save point) → pick (E/S vs I/N) → think (T/J vs F/P) → goodend, which shows the personality. */
const allAxesNodes: CanvasNodeLike[] = [
  entry,
  scene('s1', { savePoint: savePoint('雨夜') }),
  choiceNode('pick', [option('a', '热情', ['E', 'S']), option('b', '沉默', ['I', 'N'])]),
  choiceNode('think', [option('c', '理性', ['T', 'J']), option('d', '感性', ['F', 'P'])]),
  endingWithTest('goodend'),
]
const allAxesEdges = [
  flow('f1', 'in', 's1'),
  flow('f2', 's1', 'pick'),
  flow('f3', 'pick', 'think', 'a'),
  flow('f4', 'pick', 'think', 'b'),
  flow('f5', 'think', 'goodend', 'c'),
  flow('f6', 'think', 'goodend', 'd'),
]

describe('a story that uses every P3 feature correctly', () => {
  it('reports none of the P3 checks', () => {
    const program = programOf(allAxesNodes, allAxesEdges, {
      personality: personalityOn,
      map: { enabled: true },
      achievements: [
        achievement('end', { type: 'ending', projectId: 'p', nodeId: 'goodend' }),
        achievement('seg', { type: 'segment', projectId: 'p', nodeId: 's1' }),
        achievement('all', { type: 'all_achievements' }),
      ],
    })
    const issues = validateStory(program)
    expect(p3Codes(program)).toEqual([])
    expect(countIssues(issues).errors).toBe(0)
  })

  it('reports none of them on an old story with no P3 settings at all', () => {
    const old = programOf([entry, scene('s1'), ending('end')], [flow('f1', 'in', 's1'), flow('f2', 's1', 'end')])
    expect(p3Codes(old)).toEqual([])
    expect(countIssues(validateStory(old)).errors).toBe(0)
  })
})

describe('personality test checks', () => {
  it('warns on an ending that shows the result while the test is off, pointing at that ending', () => {
    const issues = validateStory(storyProgram({ map: { enabled: true } }))
    const found = find(issues, 'ending_personality_off')
    expect(found).toMatchObject({ level: 'warning', projectId: 'p', nodeId: 'goodend' })
    expect(found?.message).toContain('goodend')
    expect(issues.filter((item) => item.code === 'ending_personality_off')).toHaveLength(1)
  })

  it('treats a disabled test like no test at all', () => {
    const issues = validateStory(storyProgram({ map: { enabled: true }, personality: { enabled: false, results: {} } }))
    expect(codes(issues)).toContain('ending_personality_off')
    expect(codes(issues)).not.toContain('personality_no_tags')
  })

  it('warns when the test is on but no option scores a letter', () => {
    const nodes = [
      entry,
      scene('s1', { savePoint: savePoint('雨夜') }),
      choiceNode('pick', [option('p', '甲'), option('q', '乙')]),
      endingWithTest('goodend'),
    ]
    const edges = [flow('f1', 'in', 's1'), flow('f2', 's1', 'pick'), flow('f3', 'pick', 'goodend', 'p'), flow('f4', 'pick', 'goodend', 'q')]
    const issues = validateStory(programOf(nodes, edges, { personality: personalityOn, map: { enabled: true } }))
    expect(find(issues, 'personality_no_tags')).toMatchObject({ level: 'warning', projectId: null, nodeId: null })
    expect(codes(issues)).not.toContain('personality_axis_missing')
  })

  it('names each letter pair nobody scores', () => {
    const program = storyProgram({ personality: personalityOn, map: { enabled: true } })
    const missing = validateStory(program).filter((item) => item.code === 'personality_axis_missing')
    expect(missing).toHaveLength(2)
    expect(missing[0]?.message).toContain('T/F')
    expect(missing[1]?.message).toContain('J/P')
    expect(missing.every((item) => item.level === 'warning')).toBe(true)
  })

  it('accepts a pair that is scored by only one of its two letters', () => {
    const nodes = allAxesNodes.map((node) => (node.id === 'think' ? choiceNode('think', [option('c', '理性', ['T', 'J']), option('d', '感性')]) : node))
    expect(p3Codes(programOf(nodes, allAxesEdges, { personality: personalityOn, map: { enabled: true } }))).toEqual([])
  })

  it('warns when no ending shows the result', () => {
    const nodes = allAxesNodes.map((node) => (node.id === 'goodend' ? ending('goodend') : node))
    const program = programOf(nodes, allAxesEdges, { personality: personalityOn, map: { enabled: true } })
    expect(find(validateStory(program), 'personality_no_display')).toMatchObject({ level: 'warning', projectId: null })
    expect(codes(validateStory(program))).not.toContain('ending_personality_off')
  })

  it('counts the letters of a choice mounted on a segment', () => {
    const nodes: CanvasNodeLike[] = [
      entry,
      scene('s1', { savePoint: savePoint('开场'), videoDurationSec: 20 }),
      beat('first', { interaction: 'choice', startSec: 1, durationSec: 4, options: [option('a', '热情', ['E', 'S']), option('b', '沉默', ['I', 'N'])] }),
      beat('second', { interaction: 'choice', startSec: 8, durationSec: 4, options: [option('c', '理性', ['T', 'J']), option('d', '感性', ['F', 'P'])] }),
      endingWithTest('goodend'),
    ]
    const edges = [
      flow('f1', 'in', 's1'),
      mount('m1', 's1', 'first'),
      mount('m2', 's1', 'second'),
      flow('f2', 's1', 'goodend'),
    ]
    expect(p3Codes(programOf(nodes, edges, { personality: personalityOn, map: { enabled: true } }))).toEqual([])
  })

  it('does not count the same choice twice, so an unscored pair stays reported', () => {
    const nodes: CanvasNodeLike[] = [
      entry,
      scene('s1', { savePoint: savePoint('开场'), videoDurationSec: 10 }),
      beat('first', { interaction: 'choice', startSec: 1, durationSec: 4, options: [option('a', '热情', ['E', 'S']), option('b', '沉默', ['I', 'N'])] }),
      endingWithTest('goodend'),
    ]
    const edges = [flow('f1', 'in', 's1'), mount('m1', 's1', 'first'), flow('f2', 's1', 'goodend')]
    const missing = validateStory(programOf(nodes, edges, { personality: personalityOn, map: { enabled: true } })).filter((item) => item.code === 'personality_axis_missing')
    expect(missing.map((item) => item.message.match(/[EISNTFJP]\/[EISNTFJP]/)?.[0])).toEqual(['T/F', 'J/P'])
  })
})

describe('achievement checks', () => {
  const check = (list: StoryAchievement[], extra: Parameters<typeof storyProgram>[0] = {}) => validateStory(storyProgram({ map: { enabled: true }, ...extra, achievements: list }))

  it('accepts every kind of condition pointing at something that exists', () => {
    expect(codes(check(achievements)).filter((code) => P3_CODES.includes(code) && code !== 'ending_personality_off')).toEqual([])
    expect(codes(check(achievements))).not.toContain('unknown_variable')
  })

  it('errors on an ending condition whose ending was deleted, naming the achievement', () => {
    const issues = check([achievement('a1', { type: 'ending', projectId: 'p', nodeId: 'gone' }, '通关')])
    expect(find(issues, 'achievement_unknown_ending')).toMatchObject({ level: 'error', projectId: null, nodeId: null })
    expect(find(issues, 'achievement_unknown_ending')?.message).toContain('通关')
    expect(issues[0]?.level).toBe('error')
  })

  it('errors on an ending condition that points at a segment, or at a chapter that is gone', () => {
    expect(codes(check([achievement('a1', { type: 'ending', projectId: 'p', nodeId: 's1' })]))).toContain('achievement_unknown_ending')
    expect(codes(check([achievement('a1', { type: 'ending', projectId: 'nope', nodeId: 'goodend' })]))).toContain('achievement_unknown_ending')
  })

  it('errors on a segment condition that points at an ending, or at nothing', () => {
    const atEnding = check([achievement('a1', { type: 'segment', projectId: 'p', nodeId: 'goodend' })])
    expect(find(atEnding, 'achievement_unknown_segment')).toMatchObject({ level: 'error' })
    expect(codes(check([achievement('a1', { type: 'segment', projectId: 'p', nodeId: 'gone' })]))).toContain('achievement_unknown_segment')
  })

  it('errors on a value condition for a number that is not defined, and accepts a defined one', () => {
    const ghost = check([achievement('a1', { type: 'value', variableId: 'ghost', op: '>=', value: 1 }, '大富翁')])
    expect(find(ghost, 'unknown_variable')).toMatchObject({ level: 'error', projectId: null })
    expect(find(ghost, 'unknown_variable')?.message).toContain('大富翁')
    expect(codes(check([achievement('a1', { type: 'value', variableId: 'coin', op: '>=', value: 1 })]))).not.toContain('unknown_variable')
  })

  it('warns when "collect every ending" has no ending to collect', () => {
    const lonely = programOf([entry, scene('s1')], [flow('f1', 'in', 's1')], { achievements: [achievement('a1', { type: 'all_endings' }, '集齐')] })
    const issues = validateStory(lonely)
    expect(find(issues, 'achievement_all_endings_empty')).toMatchObject({ level: 'warning' })
    expect(find(issues, 'achievement_all_endings_empty')?.message).toContain('集齐')
    expect(codes(check([achievement('a1', { type: 'all_endings' })]))).not.toContain('achievement_all_endings_empty')
  })

  it('warns when "finish every achievement" has nothing else to finish', () => {
    const alone = check([achievement('all', { type: 'all_achievements' })])
    expect(find(alone, 'achievement_all_achievements_empty')).toMatchObject({ level: 'warning' })
    const twins = check([achievement('all', { type: 'all_achievements' }), achievement('all2', { type: 'all_achievements' })])
    expect(twins.filter((item) => item.code === 'achievement_all_achievements_empty')).toHaveLength(2)
    const withOther = check([achievement('all', { type: 'all_achievements' }), achievement('end', { type: 'all_endings' })])
    expect(codes(withOther)).not.toContain('achievement_all_achievements_empty')
  })

  it('warns about an achievement with no name and calls it unnamed in other messages', () => {
    const issues = check([achievement('a1', { type: 'ending', projectId: 'p', nodeId: 'gone' }, '  ')])
    expect(find(issues, 'achievement_name')).toMatchObject({ level: 'warning' })
    expect(find(issues, 'achievement_unknown_ending')?.message).toContain('未命名成就')
  })

  it('reports each broken achievement on its own', () => {
    const issues = check([
      achievement('a1', { type: 'ending', projectId: 'p', nodeId: 'gone' }, '甲'),
      achievement('a2', { type: 'segment', projectId: 'p', nodeId: 'gone' }, '乙'),
      achievement('a3', { type: 'value', variableId: 'ghost', op: '<', value: 1 }, '丙'),
    ])
    expect(countIssues(issues).errors).toBeGreaterThanOrEqual(3)
    expect(codes(issues)).toEqual(expect.arrayContaining(['achievement_unknown_ending', 'achievement_unknown_segment', 'unknown_variable']))
  })
})

describe('map and save point checks', () => {
  const noSavePoints = () => {
    const base = storyProgram()
    return { ...base, chapters: base.chapters.map((chapter) => ({ ...chapter, nodes: chapter.nodes.map((node) => (node.kind === 'scene' ? { ...node, savePoint: undefined } : node)) })) }
  }

  it('warns when the map is on but no segment is a save point', () => {
    const issues = validateStory({ ...noSavePoints(), map: { enabled: true } })
    expect(find(issues, 'map_no_save_points')).toMatchObject({ level: 'warning', projectId: null, nodeId: null })
  })

  it('warns when segments are save points but the map is off, counting them', () => {
    const issues = validateStory(storyProgram())
    const found = find(issues, 'save_points_map_off')
    expect(found).toMatchObject({ level: 'warning' })
    expect(found?.message).toContain('2 个片段')
    expect(codes(validateStory(storyProgram({ map: { enabled: false } })))).toContain('save_points_map_off')
  })

  it('stays quiet when the map and the save points agree', () => {
    expect(p3Codes(storyProgram({ map: { enabled: true }, personality: personalityOn }))).not.toEqual(expect.arrayContaining(['map_no_save_points', 'save_points_map_off']))
    const quietOff = validateStory(noSavePoints())
    expect(codes(quietOff)).not.toContain('map_no_save_points')
    expect(codes(quietOff)).not.toContain('save_points_map_off')
  })
})

describe('shop reward checks', () => {
  const shopWith = (items: StoryShop['items']): StoryShop => ({ enabled: true, currencyVariableId: 'coin', items })
  const item = (id: string, extra: Partial<StoryShop['items'][number]>): StoryShop['items'][number] =>
    ({ id, name: `商品${id}`, icon: null, description: '', price: 1, limit: 0, effects: [], ...extra })
  const noEffect = (items: StoryShop['items']) => validateStory(storyProgram({ shop: shopWith(items) })).filter((entry) => entry.code === 'shop_item_no_effect')

  it('does not flag a product that only gives a title or an avatar frame', () => {
    expect(noEffect([item('t', { reward: { title: '最强王者', frameUrl: null } }), item('f', { reward: { title: '', frameUrl: '/gold.png' } })])).toEqual([])
  })

  it('still flags a product with an empty reward and no value change', () => {
    const flagged = noEffect([item('x', { reward: { title: '', frameUrl: null } }), item('y', {})])
    expect(flagged).toHaveLength(2)
    expect(flagged[0]?.message).toContain('称号或头像框')
  })

  it('does not flag a product that changes a value', () => {
    expect(noEffect([item('e', { effects: [{ variableId: 'coin', op: 'add', value: 1 }] })])).toEqual([])
  })
})
