import { createRoot } from 'react-dom/client'
import { InteractivePlayer } from '../../src/features/interactive/InteractivePlayer'
import { compileChapter, type CanvasEdgeLike, type CanvasNodeLike } from '../../src/lib/interactive/compile'
import { validateChapter } from '../../src/lib/interactive/validate'
import type { StoryProgram, StoryVariable } from '../../src/lib/interactive/types'
import '../../src/features/interactive/interactive.css'

// The spec examples are authored the way the canvas stores them (node data + edges) and
// compiled by the real compileChapter, so the trial player runs what a creator would build.
const CLIP = '/story-clip-60.webm'
const CLIP_SECONDS = 60

const variables: StoryVariable[] = [{ id: 'courage', name: '勇气', type: 'number', initial: 0 }]

const flow = (id: string, source: string, target: string, sourceHandle = 'output'): CanvasEdgeLike =>
  ({ id, source, target, sourceHandle, role: 'STORY_FLOW' })
const mount = (id: string, scene: string, beat: string): CanvasEdgeLike =>
  ({ id, source: scene, target: beat, sourceHandle: 'interact', role: 'STORY_MOUNT' })
const entry: CanvasNodeLike = { id: 'in', type: 'story_entry', data: { title: '开场' } }
const clipScene = (id: string, title: string): CanvasNodeLike =>
  ({ id, type: 'story_scene', data: { title, videoUrl: CLIP, videoDurationSec: CLIP_SECONDS } })
const textScene = (id: string, title: string): CanvasNodeLike => ({ id, type: 'story_scene', data: { title } })
const ending = (id: string, title: string, endingType: string): CanvasNodeLike =>
  ({ id, type: 'story_ending', data: { title, endingType } })
const beat = (id: string, data: Record<string, unknown>): CanvasNodeLike => ({ id, type: 'story_interaction', data })

function programOf(nodes: CanvasNodeLike[], edges: CanvasEdgeLike[]): StoryProgram {
  return {
    variables,
    chapters: [compileChapter({ projectId: 'p', title: '第一章' }, nodes, edges)],
    links: [],
    start: { projectId: 'p', entryNodeId: 'in' },
  }
}

/** 电梯逃生: a 60s segment, tap 10x during 57s-60s; success waits for the segment end, fail cuts at once. */
function elevator() {
  return programOf(
    [
      entry,
      clipScene('lift', '电梯'),
      beat('tap', {
        title: '快速点击',
        interaction: 'tap',
        startSec: 57,
        durationSec: 3,
        count: 10,
        hint: '快按住电梯门！',
        results: { success: { when: 'after' }, fail: { when: 'now' } },
      }),
      textScene('saved', '获救'),
      ending('rescued', '救下朋友', 'good'),
      ending('trapped', '朋友被困', 'bad'),
    ],
    [
      flow('f1', 'in', 'lift'),
      mount('m1', 'lift', 'tap'),
      flow('f2', 'tap', 'saved', 'success'),
      flow('f3', 'tap', 'trapped', 'fail'),
      flow('f4', 'saved', 'rescued'),
    ],
  )
}

/** 逃跑: tap 10x at 30s for 3s, success gives 勇气+1 and nothing is connected, so the picture plays on. */
function escape() {
  return programOf(
    [
      entry,
      clipScene('escape', '逃跑'),
      beat('run', {
        title: '快速点击',
        interaction: 'tap',
        startSec: 30,
        durationSec: 3,
        count: 10,
        hint: '冲出去！',
        results: { success: { effects: [{ variableId: 'courage', op: 'add', value: 1 }] } },
      }),
      ending('home', '抵达出口', 'normal'),
    ],
    [flow('f1', 'in', 'escape'), mount('m1', 'escape', 'run'), flow('f2', 'escape', 'home')],
  )
}

/** 丧尸扑来: a choice mounted at 5s for 3s freezes the picture; running out of time is its own exit (death). */
function zombie() {
  return programOf(
    [
      entry,
      clipScene('zombie', '丧尸扑来'),
      beat('c', {
        title: '限时抉择',
        interaction: 'choice',
        startSec: 5,
        durationSec: 3,
        timeoutMode: 'exit',
        prompt: '丧尸扑过来了！',
        options: [{ id: 'fight', label: '开枪' }, { id: 'flee', label: '逃跑' }],
      }),
      ending('win', '反杀成功', 'good'),
      ending('flee_end', '逃出生天', 'normal'),
      ending('dead', '被咬死', 'bad'),
    ],
    [
      flow('f1', 'in', 'zombie'),
      mount('m1', 'zombie', 'c'),
      flow('f2', 'c', 'win', 'fight'),
      flow('f3', 'c', 'flee_end', 'flee'),
      flow('f4', 'c', 'dead', 'timeout'),
    ],
  )
}

const scenarios: Record<string, () => StoryProgram> = { elevator, escape, zombie }
const name = new URLSearchParams(window.location.search).get('scenario') || 'elevator'
const build = scenarios[name]
if (!build) throw new Error(`unknown scenario ${name}`)
const program = build()
;(window as unknown as { __validation: unknown }).__validation = validateChapter(program.chapters[0], program.variables)

createRoot(document.getElementById('root')!).render(
  <InteractivePlayer program={program} mode="story" aspectRatio="9:16" title={`试玩 ${name}`} onClose={() => {}} />,
)
