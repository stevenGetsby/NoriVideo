import React from 'react'
import { createRoot } from 'react-dom/client'
import { InteractivePlayer } from '../../src/features/interactive/InteractivePlayer'
import type {
  StoryAspectRatio,
  StoryChoiceNode,
  StoryEndingNode,
  StoryEndingType,
  StoryFlow,
  StoryInteractionNode,
  StoryInteractionSpec,
  StoryMedia,
  StoryNode,
  StoryProgram,
  StorySceneNode,
  StoryVariable,
} from '../../src/lib/interactive/types'
import '../../src/features/interactive/interactive.css'

const CLIP = '/story-clip.webm'
const IMAGE = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#1e3a5f"/><text x="24" y="100" fill="#fff" font-size="26">水面</text></svg>',
)
const OPTION_A = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="120"><rect width="200" height="120" fill="#7c2d12"/><text x="16" y="70" fill="#fff" font-size="24">开门</text></svg>',
)
const OPTION_B = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="120"><rect width="200" height="120" fill="#164e63"/><text x="16" y="70" fill="#fff" font-size="24">等待</text></svg>',
)

const variables: StoryVariable[] = [{ id: 'courage', name: '勇气', type: 'number', initial: 0 }]

let flowSeq = 0
const flow = (from: string, handle: string, to: string): StoryFlow => ({ id: `f${(flowSeq += 1)}`, from, handle, to })
const entry = (id = 'in'): StoryNode => ({ id, kind: 'entry', title: '开场' })
const scene = (id: string, title: string, media: StoryMedia | null, beats: StoryInteractionNode[] = []): StorySceneNode =>
  ({ id, kind: 'scene', title, lines: '', effects: [], media, beats })
const ending = (id: string, title: string, endingType: StoryEndingType = 'normal'): StoryEndingNode =>
  ({ id, kind: 'ending', title, endingType, description: '' })
const videoScene = (id: string, title: string, beats: StoryInteractionNode[] = []) =>
  scene(id, title, { kind: 'video', url: CLIP, posterUrl: null, durationSec: 8 }, beats)
const imageScene = (id: string, title: string) => scene(id, title, { kind: 'image', url: IMAGE, posterUrl: null })

const tapSpec = (count: number): StoryInteractionSpec => ({ type: 'tap', count, buttonText: '', buttonImageUrl: null })

const beat = (id: string, overrides: Partial<StoryInteractionNode> = {}): StoryInteractionNode => ({
  id,
  kind: 'interaction',
  title: id,
  spec: tapSpec(10),
  hint: '',
  durationSec: 3,
  during: 'play',
  mountedOn: null,
  startSec: 0,
  results: {},
  ...overrides,
})

const choiceNode = (overrides: Partial<StoryChoiceNode> = {}): StoryChoiceNode => ({
  id: 'ask',
  kind: 'choice',
  title: '抉择',
  prompt: '',
  options: [],
  timeoutSec: null,
  defaultOptionId: null,
  panelStyle: 'text',
  layout: 'auto',
  timeoutMode: 'default',
  ...overrides,
})

const option = (id: string, label: string, imageUrl: string | null = null) =>
  ({ id, label, effects: [], imageUrl, when: 'now' as const, retry: false })

function program(nodes: StoryNode[], flows: StoryFlow[], startEntryId = 'in'): StoryProgram {
  return {
    variables,
    chapters: [{ projectId: 'p', title: '第一章', nodes, flows }],
    links: [],
    start: { projectId: 'p', entryNodeId: startEntryId },
  }
}

/** 电梯逃生: tap at 4s, success waits for the segment to end, fail cuts at once. */
function elevatorProgram(): StoryProgram {
  const lift = videoScene('lift', '电梯', [
    beat('tap', {
      title: '快速点击',
      hint: '快按住电梯门！',
      mountedOn: 'lift',
      startSec: 4,
      durationSec: 3,
      spec: tapSpec(10),
      during: 'play',
      results: {
        success: { effects: [], when: 'after', retry: false },
        fail: { effects: [], when: 'now', retry: false },
      },
    }),
  ])
  return program(
    [entry(), lift, scene('saved', '获救', null), ending('rescued', '救下朋友', 'good'), ending('trapped', '朋友被困', 'bad')],
    [
      flow('in', 'output', 'lift'),
      flow('tap', 'success', 'saved'),
      flow('tap', 'fail', 'trapped'),
      flow('saved', 'output', 'rescued'),
    ],
  )
}

/** A standalone 限时抉择 with a 3s countdown and a default option. */
function standaloneChoiceProgram(): StoryProgram {
  const ask = choiceNode({
    id: 'ask',
    prompt: '门后传来声响',
    timeoutSec: 3,
    defaultOptionId: 'o_wait',
    options: [option('o_wait', '按兵不动'), option('o_open', '推门而出')],
  })
  return program(
    [entry(), ask, ending('safe', '安全'), ending('risky', '惊险', 'bad')],
    [flow('in', 'output', 'ask'), flow('ask', 'o_wait', 'safe'), flow('ask', 'o_open', 'risky')],
  )
}

function swipeProgram(): StoryProgram {
  const swipe = beat('swipe', {
    title: '方向滑动',
    durationSec: 20,
    spec: { type: 'swipe', direction: 'up', buttonText: '', buttonImageUrl: null },
    results: {},
  })
  return program(
    [entry(), imageScene('water', '水花'), swipe, ending('dry', '雨过天晴', 'good'), ending('wet', '落水', 'bad')],
    [
      flow('in', 'output', 'water'),
      flow('water', 'output', 'swipe'),
      flow('swipe', 'success', 'dry'),
      flow('swipe', 'fail', 'wet'),
    ],
  )
}

function timingProgram(): StoryProgram {
  const timing = beat('timing', {
    title: '时机点击',
    durationSec: 30,
    spec: { type: 'timing', propImageUrl: null, speed: 0.5, perfectWidth: 20, normalWidth: 40 },
    results: {},
  })
  return program(
    [entry(), imageScene('evidence', '证据'), timing, ending('perfect', '完美', 'good'), ending('normal', '普通'), ending('miss', '失误', 'bad')],
    [
      flow('in', 'output', 'evidence'),
      flow('evidence', 'output', 'timing'),
      flow('timing', 'perfect', 'perfect'),
      flow('timing', 'normal', 'normal'),
      flow('timing', 'miss', 'miss'),
    ],
  )
}

function holdProgram(): StoryProgram {
  const hold = beat('hold', {
    title: '长按蓄力',
    durationSec: 10,
    spec: { type: 'hold', fillSec: 2, rangeMin: 80, rangeMax: 100, overchargeFails: true, buttonText: '拉弓', buttonImageUrl: null },
    results: {},
  })
  return program(
    [entry(), imageScene('bow', '拉弓'), hold, ending('hit', '一箭中的', 'good'), ending('slip', '手滑了', 'bad')],
    [
      flow('in', 'output', 'bow'),
      flow('bow', 'output', 'hold'),
      flow('hold', 'success', 'hit'),
      flow('hold', 'fail', 'slip'),
    ],
  )
}

/** A mounted tap with effects but nothing connected: the picture keeps playing. */
function unlinkedProgram(): StoryProgram {
  const escape = videoScene('escape', '逃跑', [
    beat('run', {
      title: '快速点击',
      hint: '冲出去！',
      mountedOn: 'escape',
      startSec: 2,
      durationSec: 5,
      spec: tapSpec(1),
      results: { success: { effects: [{ variableId: 'courage', op: 'add', value: 1 }], when: 'now', retry: false } },
    }),
  ])
  return program(
    [entry(), escape, ending('home', '抵达出口')],
    [flow('in', 'output', 'escape'), flow('escape', 'output', 'home')],
  )
}

/** 画面定格 then 画面慢放, both resolved as an unlinked success. */
function freezeSlowProgram(): StoryProgram {
  const freeze = videoScene('show', '演出', [
    beat('freeze', {
      title: '定格点击',
      mountedOn: 'show',
      startSec: 1.5,
      durationSec: 2,
      during: 'freeze',
      spec: tapSpec(10),
      results: {},
    }),
    beat('slow', {
      title: '慢放点击',
      mountedOn: 'show',
      startSec: 4,
      durationSec: 2,
      during: 'slow',
      spec: tapSpec(10),
      results: {},
    }),
  ])
  return program([entry(), freeze, ending('done', '演出结束')], [flow('in', 'output', 'show'), flow('show', 'output', 'done')])
}

/** 失败重来 on a mounted swipe: the video rewinds and the beat fires again. */
function retryProgram(): StoryProgram {
  const door = videoScene('door', '破门', [
    beat('swipe', {
      title: '方向滑动',
      hint: '向上推开！',
      mountedOn: 'door',
      startSec: 3,
      durationSec: 5,
      spec: { type: 'swipe', direction: 'up', buttonText: '', buttonImageUrl: null },
      results: { fail: { effects: [], when: 'now', retry: true }, success: { effects: [], when: 'now', retry: false } },
    }),
  ])
  return program([entry(), door, ending('out', '完成')], [flow('in', 'output', 'door'), flow('door', 'output', 'out')])
}

function choiceImagesProgram(): StoryProgram {
  const ask = choiceNode({
    id: 'ask',
    prompt: '往哪边走？',
    panelStyle: 'both',
    layout: 'auto',
    options: [option('o_a', '开门', OPTION_A), option('o_b', '等待', OPTION_B)],
  })
  return program(
    [entry(), imageScene('street', '街口'), ask, ending('a', '门后'), ending('b', '天亮', 'good')],
    [
      flow('in', 'output', 'street'),
      flow('street', 'output', 'ask'),
      flow('ask', 'o_a', 'a'),
      flow('ask', 'o_b', 'b'),
    ],
  )
}

type Scenario = { program: StoryProgram; aspectRatio: StoryAspectRatio }

function scenarioOf(name: string): Scenario {
  switch (name) {
    case 'elevator': return { program: elevatorProgram(), aspectRatio: '9:16' }
    case 'standalone-choice': return { program: standaloneChoiceProgram(), aspectRatio: '9:16' }
    case 'swipe': return { program: swipeProgram(), aspectRatio: '9:16' }
    case 'timing': return { program: timingProgram(), aspectRatio: '9:16' }
    case 'hold': return { program: holdProgram(), aspectRatio: '9:16' }
    case 'unlinked': return { program: unlinkedProgram(), aspectRatio: '9:16' }
    case 'freeze-slow': return { program: freezeSlowProgram(), aspectRatio: '9:16' }
    case 'retry': return { program: retryProgram(), aspectRatio: '9:16' }
    case 'choice-images-portrait': return { program: choiceImagesProgram(), aspectRatio: '9:16' }
    case 'choice-images-landscape': return { program: choiceImagesProgram(), aspectRatio: '16:9' }
    default: throw new Error(`unknown scenario ${name}`)
  }
}

const name = new URLSearchParams(window.location.search).get('scenario') || 'elevator'
const built = scenarioOf(name)

function App() {
  return (
    <InteractivePlayer
      program={built.program}
      mode="story"
      aspectRatio={built.aspectRatio}
      title={`试玩 ${name}`}
      onClose={() => {}}
    />
  )
}

createRoot(document.getElementById('root')!).render(<App />)
