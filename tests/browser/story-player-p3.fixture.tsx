import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { InteractivePlayer } from '../../src/features/interactive/InteractivePlayer'
import { compileChapter, type CanvasEdgeLike, type CanvasNodeLike } from '../../src/lib/interactive/compile'
import type {
  StoryAchievement,
  StoryAspectRatio,
  StoryPersonality,
  StoryProgram,
  StoryShop,
  StoryVariable,
} from '../../src/lib/interactive/types'
import '../../src/features/interactive/interactive.css'

const svg = (fill: string, text = '') => 'data:image/svg+xml,' + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="${fill}"/>${text ? `<text x="18" y="42" fill="#ffffff" font-size="22" font-family="sans-serif">${text}</text>` : ''}</svg>`,
)
const IMAGE = svg('#2b3a55', 'scene')
const RAIN_COVER = svg('#3b5b7a', '雨夜')
const GOLD_FRAME = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><circle cx="32" cy="32" r="29" fill="none" stroke="#fcd34d" stroke-width="5"/></svg>')
const CROWN_FRAME = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><circle cx="32" cy="32" r="29" fill="none" stroke="#d8b4fe" stroke-width="5"/></svg>')
const PERSONALITY_IMAGE = svg('#4c1d95', 'ENFP')

export const coin: StoryVariable = { id: 'coin', name: '金币', type: 'number', initial: 0, icon: '🪙', showInHud: true }

const flow = (id: string, source: string, target: string, sourceHandle = 'output'): CanvasEdgeLike => ({ id, source, target, sourceHandle, role: 'STORY_FLOW' })
const entry: CanvasNodeLike = { id: 'in', type: 'story_entry', data: {} }
const sceneNode = (id: string, extra: Record<string, unknown> = {}): CanvasNodeLike =>
  ({ id, type: 'story_scene', data: { title: id, imageUrl: IMAGE, ...extra } })
const option = (id: string, label: string, tags?: string[]) =>
  ({ id, label, effects: [], imageUrl: null, when: 'now', retry: false, ...(tags ? { tags } : {}) })
const savePoint = (name: string, coverUrl: string | null = null) => ({ enabled: true, name, coverUrl })

const nodes: CanvasNodeLike[] = [
  entry,
  sceneNode('s1', { title: '雨夜', savePoint: savePoint('雨夜', RAIN_COVER) }),
  {
    id: 'pick',
    type: 'story_choice',
    data: {
      title: '岔路',
      prompt: '往哪边走？',
      timeoutSec: 120,
      options: [option('a', '热情', ['E', 'N', 'F', 'P']), option('b', '沉默', ['I', 'S', 'T', 'J']), option('c', '离开')],
    },
  },
  sceneNode('s2', { title: '街角', savePoint: savePoint('街角'), effects: [{ variableId: 'coin', op: 'add', value: 1 }] }),
  { id: 'goodend', type: 'story_ending', data: { title: '好结局', endingType: 'good', description: '雨停了。', showPersonality: true } },
  { id: 'badend', type: 'story_ending', data: { title: '坏结局', endingType: 'bad', description: '只剩雨声。' } },
]

const edges: CanvasEdgeLike[] = [
  flow('f1', 'in', 's1'),
  flow('f2', 's1', 'pick'),
  flow('f3', 'pick', 's2', 'a'),
  flow('f4', 'pick', 's2', 'b'),
  flow('f5', 'pick', 'badend', 'c'),
  flow('f6', 's2', 'goodend'),
]

const achievements: StoryAchievement[] = [
  { id: 'a_first', name: '初见雨夜', description: '走到雨夜的街口。', icon: '🌧️', condition: { type: 'segment', projectId: 'p', nodeId: 's1' }, reward: { title: '', frameUrl: null } },
  { id: 'a_good', name: '好结局', description: '', icon: '🏆', condition: { type: 'ending', projectId: 'p', nodeId: 'goodend' }, reward: { title: '最强王者', frameUrl: GOLD_FRAME } },
  { id: 'a_bad', name: '坏结局', description: '', icon: null, condition: { type: 'ending', projectId: 'p', nodeId: 'badend' }, reward: { title: '', frameUrl: null } },
  { id: 'a_seg', name: '到过街角', description: '', icon: null, condition: { type: 'segment', projectId: 'p', nodeId: 's2' }, reward: { title: '', frameUrl: null } },
  { id: 'a_rich', name: '小富翁', description: '', icon: null, condition: { type: 'value', variableId: 'coin', op: '>=', value: 1 }, reward: { title: '', frameUrl: null } },
  { id: 'a_ends', name: '集齐结局', description: '', icon: null, condition: { type: 'all_endings' }, reward: { title: '收集者', frameUrl: null } },
  { id: 'a_all', name: '全成就', description: '拿到其他所有成就。', icon: null, condition: { type: 'all_achievements' }, reward: { title: '通关达人', frameUrl: CROWN_FRAME } },
]

const personality: StoryPersonality = {
  enabled: true,
  results: { ENFP: { name: '热情家', description: '一路热情，把选择交给直觉。', imageUrl: PERSONALITY_IMAGE } },
}

const shop: StoryShop = {
  enabled: true,
  currencyVariableId: 'coin',
  items: [
    { id: 's_frame', name: '鎏金头像框', icon: null, description: '永久头像框', price: 0, limit: 1, effects: [], reward: { title: '', frameUrl: GOLD_FRAME } },
    { id: 's_title', name: '至尊称号', icon: null, description: '永久称号', price: 0, limit: 1, effects: [], reward: { title: '至尊', frameUrl: null } },
    { id: 's_plain', name: '一张贴纸', icon: '🎟️', description: '没有永久奖励', price: 0, limit: 0, effects: [] },
  ],
}

type Extras = Partial<Pick<StoryProgram, 'achievements' | 'personality' | 'map' | 'shop'>>

function buildProgram(extras: Extras = {}): StoryProgram {
  return {
    variables: [coin],
    chapters: [compileChapter({ projectId: 'p', title: '第一章' }, nodes, edges)],
    links: [],
    start: { projectId: 'p', entryNodeId: 'in' },
    ...extras,
  }
}

const oldShop: StoryShop = {
  enabled: true,
  currencyVariableId: 'coin',
  items: [{ id: 's_plain', name: '一张贴纸', icon: '🎟️', description: '', price: 0, limit: 0, effects: [] }],
}

const unflaggedProgram = (): StoryProgram => {
  const program = buildProgram({ achievements, personality })
  return {
    ...program,
    chapters: program.chapters.map((chapter) => ({
      ...chapter,
      nodes: chapter.nodes.map((node) => (node.kind === 'ending' && node.id === 'goodend' ? { ...node, showPersonality: false } : node)),
    })),
  }
}

type Scenario = {
  program: StoryProgram
  mode: 'story' | 'chapter'
  aspectRatio: StoryAspectRatio
  storageKey?: string
  projectId?: string
}

function scenarioOf(name: string): Scenario | null {
  switch (name) {
    case 'empty': return null
    case 'full':
      return { program: buildProgram({ achievements, personality, shop }), mode: 'story', aspectRatio: '9:16', storageKey: 'p3-full' }
    case 'full-wide':
      return { program: buildProgram({ achievements, personality, shop }), mode: 'story', aspectRatio: '16:9', storageKey: 'p3-full-wide' }
    case 'old':
      return { program: buildProgram({ shop: oldShop }), mode: 'story', aspectRatio: '9:16', storageKey: 'p3-old' }
    case 'map':
      return { program: buildProgram({ map: { enabled: true } }), mode: 'story', aspectRatio: '9:16', storageKey: 'p3-map' }
    case 'map-wide':
      return { program: buildProgram({ map: { enabled: true } }), mode: 'story', aspectRatio: '16:9', storageKey: 'p3-map-wide' }
    case 'chapter':
      return { program: buildProgram({ achievements, map: { enabled: true } }), mode: 'chapter', aspectRatio: '9:16', storageKey: 'w', projectId: 'p' }
    case 'no-personality':
      return { program: buildProgram({ achievements }), mode: 'story', aspectRatio: '9:16' }
    case 'personality-off':
      return { program: buildProgram({ achievements, personality: { enabled: false, results: {} } }), mode: 'story', aspectRatio: '9:16' }
    case 'unflagged':
      return { program: unflaggedProgram(), mode: 'story', aspectRatio: '9:16' }
    default:
      throw new Error(`unknown scenario ${name}`)
  }
}

const name = new URLSearchParams(window.location.search).get('scenario') || 'empty'

function App() {
  const scenario = scenarioOf(name)
  const [open, setOpen] = useState(true)
  if (!scenario) return <div id="empty" />
  return (
    <>
      {open ? (
        <InteractivePlayer
          program={scenario.program}
          mode={scenario.mode}
          aspectRatio={scenario.aspectRatio}
          title={`试玩 ${name}`}
          storageKey={scenario.storageKey}
          projectId={scenario.projectId}
          onClose={() => setOpen(false)}
        />
      ) : null}
      <button id="reopen" type="button" onClick={() => setOpen(true)}>重新打开试玩</button>
    </>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
