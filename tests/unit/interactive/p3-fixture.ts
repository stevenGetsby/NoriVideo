import { compileChapter, type CanvasEdgeLike, type CanvasNodeLike } from '@/lib/interactive/compile'
import type { StoryAchievement, StoryPersonality, StoryProgram, StoryVariable } from '@/lib/interactive/types'
import { ending, entry, flow, scene } from './economy-fixture'

export const coin: StoryVariable = { id: 'coin', name: '金币', type: 'number', initial: 0 }

export const option = (id: string, label: string, tags?: string[], extra: Record<string, unknown> = {}) =>
  ({ id, label, effects: [], imageUrl: null, when: 'now', retry: false, ...(tags ? { tags } : {}), ...extra })

export const choiceNode = (id: string, options: ReturnType<typeof option>[], extra: Record<string, unknown> = {}): CanvasNodeLike =>
  ({ id, type: 'story_choice', data: { title: id, prompt: '怎么办', options, ...extra } })

export const savePoint = (name: string, coverUrl: string | null = null) => ({ enabled: true, name, coverUrl })

export const endingWithTest = (id: string, endingType = 'good'): CanvasNodeLike =>
  ({ id, type: 'story_ending', data: { title: id, endingType, showPersonality: true } })

/** in → s1 (save point) → pick → s2 (save point, +1 金币) → goodend (shows the personality) ; pick:c → badend. */
export const storyNodes: CanvasNodeLike[] = [
  entry,
  scene('s1', { savePoint: savePoint('雨夜', '/rain.png') }),
  choiceNode('pick', [option('a', '热情', ['E', 'S']), option('b', '沉默', ['I', 'N']), option('c', '离开')]),
  scene('s2', { savePoint: savePoint('街角'), effects: [{ variableId: 'coin', op: 'add', value: 1 }] }),
  endingWithTest('goodend'),
  ending('badend', 'bad'),
]

export const storyEdges: CanvasEdgeLike[] = [
  flow('f1', 'in', 's1'),
  flow('f2', 's1', 'pick'),
  flow('f3', 'pick', 's2', 'a'),
  flow('f4', 'pick', 's2', 'b'),
  flow('f5', 'pick', 'badend', 'c'),
  flow('f6', 's2', 'goodend'),
]

export const achievements: StoryAchievement[] = [
  { id: 'a_good', name: '好结局', description: '', icon: '🏆', condition: { type: 'ending', projectId: 'p', nodeId: 'goodend' }, reward: { title: '最强王者', frameUrl: '/gold.png' } },
  { id: 'a_bad', name: '坏结局', description: '', icon: null, condition: { type: 'ending', projectId: 'p', nodeId: 'badend' }, reward: { title: '', frameUrl: null } },
  { id: 'a_seg', name: '到过街角', description: '', icon: null, condition: { type: 'segment', projectId: 'p', nodeId: 's2' }, reward: { title: '', frameUrl: null } },
  { id: 'a_rich', name: '小富翁', description: '', icon: null, condition: { type: 'value', variableId: 'coin', op: '>=', value: 1 }, reward: { title: '富翁', frameUrl: null } },
  { id: 'a_ends', name: '集齐结局', description: '', icon: null, condition: { type: 'all_endings' }, reward: { title: '收集者', frameUrl: null } },
  { id: 'a_all', name: '全成就', description: '', icon: null, condition: { type: 'all_achievements' }, reward: { title: '通关达人', frameUrl: '/crown.png' } },
]

export const personalityOn: StoryPersonality = { enabled: true, results: { ENFP: { name: '热情家', description: '一路热情。', imageUrl: '/enfp.png' } } }

type Extras = Partial<Pick<StoryProgram, 'achievements' | 'personality' | 'map' | 'shop' | 'variables'>>

export function storyProgram(extra: Extras = {}): StoryProgram {
  return {
    variables: [coin],
    chapters: [compileChapter({ projectId: 'p', title: '第一章' }, storyNodes, storyEdges)],
    links: [],
    start: { projectId: 'p', entryNodeId: 'in' },
    ...extra,
  }
}
