import { createRoot } from 'react-dom/client'
import { InteractivePlayer } from '../../src/features/interactive/InteractivePlayer'
import { compileChapter, type CanvasEdgeLike, type CanvasNodeLike } from '../../src/lib/interactive/compile'
import { validateChapter } from '../../src/lib/interactive/validate'
import type {
  StoryAchievement,
  StoryAspectRatio,
  StoryPlaybackConfig,
  StoryProgram,
  StoryShop,
  StoryVariable,
} from '../../src/lib/interactive/types'
import '../../src/features/interactive/interactive.css'

// A real 60s clip drives every scenario, so beats mounted near the end race the clip the same
// way the acceptance examples do. Mounted interactions are authored as canvas data and compiled
// by the real compileChapter, exactly like the P1/P3 fixtures.
const CLIP = '/story-clip-60.webm'
const CLIP_SECONDS = 60

const variables: StoryVariable[] = [{ id: 'courage', name: '勇气', type: 'number', initial: 0, showInHud: true }]
const playback: StoryPlaybackConfig = { speeds: [1, 1.25, 1.5] }

const flow = (id: string, source: string, target: string, sourceHandle = 'output'): CanvasEdgeLike =>
  ({ id, source, target, sourceHandle, role: 'STORY_FLOW' })
const mount = (id: string, scene: string, beat: string): CanvasEdgeLike =>
  ({ id, source: scene, target: beat, sourceHandle: 'interact', role: 'STORY_MOUNT' })
const entry: CanvasNodeLike = { id: 'in', type: 'story_entry', data: { title: '开场' } }
const clipScene = (id: string, title: string): CanvasNodeLike =>
  ({ id, type: 'story_scene', data: { title, videoUrl: CLIP, videoDurationSec: CLIP_SECONDS } })
const ending = (id: string, title: string, endingType: string): CanvasNodeLike =>
  ({ id, type: 'story_ending', data: { title, endingType } })
const beat = (id: string, data: Record<string, unknown>): CanvasNodeLike => ({ id, type: 'story_interaction', data })
const now = { success: { when: 'now' }, fail: { when: 'now' } }

function programOf(nodes: CanvasNodeLike[], edges: CanvasEdgeLike[], speeds?: StoryPlaybackConfig): StoryProgram {
  const program: StoryProgram = {
    variables,
    chapters: [compileChapter({ projectId: 'p', title: '第一章' }, nodes, edges)],
    links: [],
    start: { projectId: 'p', entryNodeId: 'in' },
  }
  return speeds ? { ...program, playback: speeds } : program
}

/** One uninterrupted 60s picture: the speed button and plain playback live here. */
function novel(speeds?: StoryPlaybackConfig) {
  return programOf(
    [entry, clipScene('s', '长镜头'), ending('done', '结束', 'normal')],
    [flow('f1', 'in', 's'), flow('f2', 's', 'done')],
    speeds,
  )
}

/** A tap window that opens at 57s; nobody presses, so its 3s limit races the clip's last 3s. */
function tap57() {
  return programOf(
    [
      entry,
      clipScene('s', '电梯'),
      beat('late', {
        title: '快速点击',
        interaction: 'tap',
        startSec: 57,
        durationSec: 3,
        count: 10,
        hint: '快按住门！',
        results: { success: { when: 'now' }, fail: { when: 'now' } },
      }),
      ending('fine', '获救', 'good'),
      ending('caught', '被困', 'bad'),
    ],
    [
      flow('f1', 'in', 's'),
      mount('m1', 's', 'late'),
      flow('f2', 'late', 'fine', 'success'),
      flow('f3', 'late', 'caught', 'fail'),
    ],
    playback,
  )
}

/** A timed choice at 57s that freezes the picture; running out of time is its own exit. */
function choice57() {
  return programOf(
    [
      entry,
      clipScene('s', '岔路'),
      beat('pick', {
        title: '限时抉择',
        interaction: 'choice',
        startSec: 57,
        durationSec: 3,
        during: 'freeze',
        timeoutMode: 'exit',
        prompt: '走哪边？',
        options: [{ id: 'a', label: '左边' }, { id: 'b', label: '右边' }],
      }),
      ending('left', '左边尽头', 'good'),
      ending('right', '右边尽头', 'normal'),
      ending('timeout', '原地不动', 'bad'),
    ],
    [
      flow('f1', 'in', 's'),
      mount('m1', 's', 'pick'),
      flow('f2', 'pick', 'left', 'a'),
      flow('f3', 'pick', 'right', 'b'),
      flow('f4', 'pick', 'timeout', 'timeout'),
    ],
    playback,
  )
}

/** A slow-motion tap window in the middle of the picture; the run plays on whatever happens. */
function slowbeat() {
  return programOf(
    [
      entry,
      clipScene('s', '慢镜头'),
      beat('slow', { title: '慢动作点击', interaction: 'tap', startSec: 20, durationSec: 2, during: 'slow', count: 99, hint: '慢慢按', results: now }),
      ending('done', '结束', 'normal'),
    ],
    [flow('f1', 'in', 's'), mount('m1', 's', 'slow'), flow('f2', 's', 'done')],
    playback,
  )
}

/** Two upward swipe windows: the first is failed on purpose, the second succeeds. */
function swipe() {
  return programOf(
    [
      entry,
      clipScene('s', '滑动'),
      beat('early', { title: '向上滑', interaction: 'swipe', startSec: 2, durationSec: 10, direction: 'up', buttonText: '上滑', results: now }),
      beat('late', { title: '向上滑', interaction: 'swipe', startSec: 30, durationSec: 10, direction: 'up', buttonText: '上滑', results: now }),
      ending('done', '结束', 'normal'),
    ],
    [
      flow('f1', 'in', 's'),
      mount('m1', 's', 'early'),
      mount('m2', 's', 'late'),
      flow('f2', 's', 'done'),
    ],
    playback,
  )
}

/** All five interactions one after another, so a phone run can complete each with real pointers. */
function kinds() {
  return programOf(
    [
      entry,
      clipScene('s', '合集'),
      beat('tap', { title: '快速点击', interaction: 'tap', startSec: 2, durationSec: 3, count: 2, hint: '点两下', results: now }),
      beat('swipe', { title: '向上滑', interaction: 'swipe', startSec: 6, durationSec: 3, direction: 'up', buttonText: '上滑', results: now }),
      beat('timing', { title: '时机点击', interaction: 'timing', startSec: 10, durationSec: 3, speed: 1, perfectWidth: 20, normalWidth: 50 }),
      beat('hold', { title: '长按蓄力', interaction: 'hold', startSec: 14, durationSec: 3, fillSec: 2, rangeMin: 80, rangeMax: 100, buttonText: '蓄力', results: now }),
      beat('pick', {
        title: '限时抉择',
        interaction: 'choice',
        startSec: 18,
        durationSec: 3,
        prompt: '选一个',
        options: [{ id: 'a', label: '甲' }, { id: 'b', label: '乙' }],
      }),
      ending('done', '结束', 'normal'),
    ],
    [
      flow('f1', 'in', 's'),
      mount('m1', 's', 'tap'),
      mount('m2', 's', 'swipe'),
      mount('m3', 's', 'timing'),
      mount('m4', 's', 'hold'),
      mount('m5', 's', 'pick'),
      flow('f2', 's', 'done'),
    ],
    playback,
  )
}

/** The HUD's other compact offers: achievements, map and a plain shop. */
function extras(): StoryProgram {
  const achievements: StoryAchievement[] = [
    { id: 'a_first', name: '初见', description: '', icon: '🏆', condition: { type: 'segment', projectId: 'p', nodeId: 's' }, reward: { title: '', frameUrl: null } },
  ]
  const shop: StoryShop = {
    enabled: true,
    currencyVariableId: 'courage',
    items: [{ id: 'sticker', name: '贴纸', icon: '🎟️', description: '', price: 0, limit: 0, effects: [] }],
  }
  return { ...novel(playback), achievements, shop, map: { enabled: true } }
}

const scenarios: Record<string, () => StoryProgram> = {
  novel: () => novel(),
  fast: () => novel(playback),
  extras,
  tap57,
  choice57,
  slowbeat,
  swipe,
  kinds,
}
const params = new URLSearchParams(window.location.search)
const name = params.get('scenario') || 'novel'
const build = scenarios[name]
if (!build) throw new Error(`unknown scenario ${name}`)
const aspectRatio: StoryAspectRatio = params.get('aspect') === '9:16' ? '9:16' : '16:9'
const program = build()
;(window as unknown as { __validation: unknown }).__validation = validateChapter(program.chapters[0], program.variables)

createRoot(document.getElementById('root')!).render(
  <InteractivePlayer
    program={program}
    mode="story"
    aspectRatio={aspectRatio}
    title={`试玩 ${name}`}
    onClose={() => { (window as unknown as { __playerClosed?: boolean }).__playerClosed = true }}
  />,
)
