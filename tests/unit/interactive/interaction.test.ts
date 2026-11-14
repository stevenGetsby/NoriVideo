import { describe, expect, it } from 'vitest'
import { compileChapter, readChoiceData, type CanvasEdgeLike, type CanvasNodeLike } from '@/lib/interactive/compile'
import {
  beatWindowsOverlap,
  choiceOptionParts,
  clampBeatStart,
  defaultBeatDuration,
  defaultInteractionData,
  dueBeat,
  firstFreeBeatStart,
  holdProgress,
  interactionHandleLabel,
  interactionHandles,
  interactionTimeoutHandle,
  judgeHold,
  judgeSwipe,
  judgeTap,
  judgeTiming,
  readInteractionData,
  resolveChoiceLayout,
  swipeDirectionOf,
  timingPointer,
} from '@/lib/interactive/interaction'
import { STORY_INTERACTION_KINDS, type StoryInteractionNode } from '@/lib/interactive/types'

const flow = (id: string, source: string, target: string, sourceHandle = 'output'): CanvasEdgeLike =>
  ({ id, source, target, sourceHandle, role: 'STORY_FLOW' })
const mount = (id: string, scene: string, beat: string): CanvasEdgeLike =>
  ({ id, source: scene, target: beat, sourceHandle: 'interact', role: 'STORY_MOUNT' })

describe('interaction data reader', () => {
  it('turns empty or hostile data into a playable tap with the spec defaults', () => {
    for (const raw of [undefined, null, 'x', 7, [], {}, { interaction: 'warp', durationSec: 'abc', count: NaN }]) {
      const data = readInteractionData(raw)
      expect(data.spec).toEqual({ type: 'tap', count: 10, buttonText: '', buttonImageUrl: null })
      expect(data.durationSec).toBe(3)
      expect(data.during).toBe('play')
      expect(data.startSec).toBe(0)
      expect(data.title).toBe('快速点击')
      expect(Object.keys(data.results)).toEqual(['success', 'fail'])
    }
  })

  it('keeps the per-kind defaults from the design (swipe 1s, choice freezes and counts down 3s)', () => {
    expect(readInteractionData({ interaction: 'swipe' })).toMatchObject({ durationSec: 1, spec: { type: 'swipe', direction: 'up' } })
    expect(readInteractionData({ interaction: 'choice' })).toMatchObject({ durationSec: 3, during: 'freeze', spec: { type: 'choice', panelStyle: 'text', layout: 'auto', timeoutMode: 'default' } })
    expect(readInteractionData({ interaction: 'timing' }).spec).toEqual({ type: 'timing', propImageUrl: null, speed: 1, perfectWidth: 10, normalWidth: 30 })
    expect(readInteractionData({ interaction: 'hold' }).spec).toMatchObject({ type: 'hold', fillSec: 2, rangeMin: 80, rangeMax: 100, overchargeFails: false })
  })

  it('clamps every number and keeps the zones and ranges consistent', () => {
    const tap = readInteractionData({ interaction: 'tap', count: 500, startSec: -5, durationSec: 9999 })
    expect(tap.spec).toMatchObject({ count: 99 })
    expect(tap.startSec).toBe(0)
    expect(tap.durationSec).toBe(120)
    expect(readInteractionData({ interaction: 'tap', count: '0' }).spec).toMatchObject({ count: 1 })
    expect(readInteractionData({ interaction: 'tap', startSec: 12.349, durationSec: 2.26 })).toMatchObject({ startSec: 12.3, durationSec: 2.3 })
    expect(readInteractionData({ interaction: 'timing', perfectWidth: 40, normalWidth: 10 }).spec).toMatchObject({ perfectWidth: 40, normalWidth: 40 })
    expect(readInteractionData({ interaction: 'hold', rangeMin: 90, rangeMax: 20 }).spec).toMatchObject({ rangeMin: 90, rangeMax: 90 })
  })

  it('reads choice options with images, cut timing and retry, and drops a default that no longer exists', () => {
    const data = readInteractionData({
      interaction: 'choice',
      prompt: '丧尸扑来',
      panelStyle: 'both',
      layout: 'vertical',
      timeoutMode: 'exit',
      defaultOptionId: 'gone',
      options: [
        { id: 'o1', label: '开枪', imageUrl: '/gun.png', when: 'after', effects: [{ variableId: 'hp', op: 'add', value: -1 }] },
        { id: 'o2', label: '', retry: true },
        { label: 'no id' },
      ],
    })
    expect(data.spec).toMatchObject({
      type: 'choice',
      panelStyle: 'both',
      layout: 'vertical',
      timeoutMode: 'exit',
      defaultOptionId: null,
      options: [
        { id: 'o1', label: '开枪', imageUrl: '/gun.png', when: 'after', retry: false },
        { id: 'o2', label: '', imageUrl: null, when: 'now', retry: true },
      ],
    })
    expect(data.results.o1).toEqual({ effects: [{ variableId: 'hp', op: 'add', value: -1 }], when: 'after', retry: false })
    expect(data.results.o2.retry).toBe(true)
    expect(Object.keys(data.results)).toEqual(['o1', 'o2', 'timeout'])
  })

  it('exposes the result ports per kind, with a timeout port only when the choice has its own exit', () => {
    expect(interactionHandles(readInteractionData({ interaction: 'tap' }).spec)).toEqual(['success', 'fail'])
    expect(interactionHandles(readInteractionData({ interaction: 'swipe' }).spec)).toEqual(['success', 'fail'])
    expect(interactionHandles(readInteractionData({ interaction: 'hold' }).spec)).toEqual(['success', 'fail'])
    expect(interactionHandles(readInteractionData({ interaction: 'timing' }).spec)).toEqual(['perfect', 'normal', 'miss'])
    const choice = { interaction: 'choice', options: [{ id: 'a', label: '甲' }, { id: 'b', label: '乙' }] }
    expect(interactionHandles(readInteractionData(choice).spec)).toEqual(['a', 'b'])
    expect(interactionHandles(readInteractionData({ ...choice, timeoutMode: 'exit' }).spec)).toEqual(['a', 'b', 'timeout'])
  })

  it('labels result ports and picks the handle a time-out lands on', () => {
    const timing = readInteractionData({ interaction: 'timing' }).spec
    expect(['perfect', 'normal', 'miss'].map((handle) => interactionHandleLabel(timing, handle))).toEqual(['完美', '普通', '失误'])
    expect(interactionTimeoutHandle(timing)).toBe('miss')
    expect(interactionTimeoutHandle(readInteractionData({ interaction: 'hold' }).spec)).toBe('fail')
    const options = [{ id: 'a', label: '甲' }, { id: 'b', label: '乙' }]
    const byDefault = readInteractionData({ interaction: 'choice', options, defaultOptionId: 'b' }).spec
    expect(interactionTimeoutHandle(byDefault)).toBe('b')
    expect(interactionHandleLabel(byDefault, 'b')).toBe('乙')
    expect(interactionTimeoutHandle(readInteractionData({ interaction: 'choice', options }).spec)).toBe('a')
    const exit = readInteractionData({ interaction: 'choice', options, timeoutMode: 'exit' }).spec
    expect(interactionTimeoutHandle(exit)).toBe('timeout')
    expect(interactionHandleLabel(exit, 'timeout')).toBe('超时')
    expect(interactionTimeoutHandle(readInteractionData({ interaction: 'choice', options: [] }).spec)).toBeNull()
  })

  it('creates fresh node data for every kind that reads back to the same kind', () => {
    let counter = 0
    for (const kind of STORY_INTERACTION_KINDS) {
      const data = readInteractionData(defaultInteractionData(kind, () => `id${counter += 1}`))
      expect(data.spec.type).toBe(kind)
      expect(data.title).toBe(data.title.trim())
    }
    const choice = readInteractionData(defaultInteractionData('choice', () => `id${counter += 1}`)).spec
    expect(choice.type === 'choice' && choice.options.length).toBe(2)
  })
})

describe('time windows', () => {
  it('detects overlap but lets windows touch', () => {
    expect(beatWindowsOverlap({ startSec: 10, durationSec: 3 }, { startSec: 12, durationSec: 3 })).toBe(true)
    expect(beatWindowsOverlap({ startSec: 10, durationSec: 3 }, { startSec: 13, durationSec: 3 })).toBe(false)
    expect(beatWindowsOverlap({ startSec: 10, durationSec: 3 }, { startSec: 0, durationSec: 10 })).toBe(false)
  })

  it('keeps a dragged window inside the video', () => {
    expect(clampBeatStart(58, 3, 60)).toBe(57)
    expect(clampBeatStart(-2, 3, 60)).toBe(0)
    expect(clampBeatStart(12.34, 3, 60)).toBe(12.3)
    expect(clampBeatStart(80, 3, null)).toBe(80)
    expect(clampBeatStart(1, 5, 3)).toBe(0)
  })

  it('starts a new window at the first gap that fits, after the ones already there', () => {
    const windows = [{ startSec: 0, durationSec: 3 }, { startSec: 3, durationSec: 4 }, { startSec: 20, durationSec: 3 }]
    expect(firstFreeBeatStart([], 3, 60)).toBe(0)
    expect(firstFreeBeatStart(windows, 3, 60)).toBe(7)
    expect(firstFreeBeatStart(windows, 14, 60)).toBe(23)
    expect(firstFreeBeatStart([...windows].reverse(), 3, 60)).toBe(7)
    expect(firstFreeBeatStart([{ startSec: 3, durationSec: 3 }], 3, 60)).toBe(0)
  })

  it('keeps that start inside the video when its length is known, and never beyond zero when it does not fit', () => {
    expect(firstFreeBeatStart([{ startSec: 0, durationSec: 58 }], 3, 60)).toBe(57)
    expect(firstFreeBeatStart([{ startSec: 0, durationSec: 5 }], 3, null)).toBe(5)
    expect(firstFreeBeatStart([], 10, 4)).toBe(0)
  })

  it('gives each kind its own default length', () => {
    expect(STORY_INTERACTION_KINDS.map(defaultBeatDuration)).toEqual(STORY_INTERACTION_KINDS.map((kind) => readInteractionData({ interaction: kind }).durationSec))
    expect(defaultBeatDuration('swipe')).toBe(1)
    expect(defaultBeatDuration('tap')).toBe(3)
  })

  it('finds the first unused mounted interaction whose start has been reached', () => {
    const beat = (id: string, startSec: number) => ({ id, startSec }) as StoryInteractionNode
    const beats = [beat('a', 5), beat('b', 20)]
    expect(dueBeat(beats, new Set(), 4.9)).toBeNull()
    expect(dueBeat(beats, new Set(), 5)?.id).toBe('a')
    expect(dueBeat(beats, new Set(['a']), 6)).toBeNull()
    expect(dueBeat(beats, new Set(['a']), 21)?.id).toBe('b')
    expect(dueBeat([], new Set(), 99)).toBeNull()
  })
})

describe('judging', () => {
  it('counts taps up to the target', () => {
    expect(judgeTap(9, 10)).toBe('pending')
    expect(judgeTap(10, 10)).toBe('success')
    expect(judgeTap(11, 10)).toBe('success')
  })

  it('reads the dominant swipe axis and ignores short drags', () => {
    expect(swipeDirectionOf(10, -10)).toBeNull()
    expect(swipeDirectionOf(80, 20)).toBe('right')
    expect(swipeDirectionOf(-80, 20)).toBe('left')
    expect(swipeDirectionOf(20, 90)).toBe('down')
    expect(swipeDirectionOf(-20, -90)).toBe('up')
    expect(judgeSwipe(5, 5, 'left')).toBe('pending')
    expect(judgeSwipe(-60, 4, 'left')).toBe('success')
    expect(judgeSwipe(60, 4, 'left')).toBe('fail')
    expect(judgeSwipe(0, -60, 'up', 100)).toBe('pending')
  })

  it('sweeps the pointer back and forth across the bar', () => {
    expect(timingPointer(0, 1)).toBe(0)
    expect(timingPointer(0.5, 1)).toBeCloseTo(0.5)
    expect(timingPointer(1, 1)).toBe(1)
    expect(timingPointer(1.5, 1)).toBeCloseTo(0.5)
    expect(timingPointer(2, 1)).toBeCloseTo(0)
    expect(timingPointer(0.25, 2)).toBeCloseTo(0.5)
    expect(timingPointer(-1, 1)).toBe(0)
  })

  it('splits a press into perfect, normal and miss around the centre of the bar', () => {
    expect(judgeTiming(0.5, 10, 30)).toBe('perfect')
    expect(judgeTiming(0.54, 10, 30)).toBe('perfect')
    expect(judgeTiming(0.56, 10, 30)).toBe('normal')
    expect(judgeTiming(0.36, 10, 30)).toBe('normal')
    expect(judgeTiming(0.3, 10, 30)).toBe('miss')
    expect(judgeTiming(1, 10, 30)).toBe('miss')
  })

  it('fills the hold ring and judges the release range, with optional overcharge failure', () => {
    expect(holdProgress(1, 2, false)).toEqual({ percent: 50, overcharged: false })
    expect(holdProgress(5, 2, false)).toEqual({ percent: 100, overcharged: false })
    expect(holdProgress(5, 2, true)).toEqual({ percent: 100, overcharged: true })
    const spec = (overchargeFails: boolean) => readInteractionData({ interaction: 'hold', fillSec: 2, rangeMin: 80, rangeMax: 100, overchargeFails }).spec as Extract<ReturnType<typeof readInteractionData>['spec'], { type: 'hold' }>
    expect(judgeHold(1.5, spec(false))).toBe('fail')
    expect(judgeHold(1.7, spec(false))).toBe('success')
    expect(judgeHold(2, spec(true))).toBe('success')
    expect(judgeHold(2.5, spec(true))).toBe('fail')
    expect(judgeHold(9, spec(false))).toBe('success')
    const narrow = readInteractionData({ interaction: 'hold', fillSec: 2, rangeMin: 80, rangeMax: 90 }).spec as Extract<ReturnType<typeof readInteractionData>['spec'], { type: 'hold' }>
    expect(judgeHold(1.9, narrow)).toBe('fail')
    expect(judgeHold(1.7, narrow)).toBe('success')
  })
})

describe('compiling interactions', () => {
  const nodes: CanvasNodeLike[] = [
    { id: 'in', type: 'story_entry', data: {} },
    { id: 'clip', type: 'video', data: { videoUrl: '/lift.mp4', sourceMetadata: { durationMs: 60000 } } },
    { id: 'lift', type: 'story_scene', data: { title: '电梯逃生' } },
    { id: 'late', type: 'story_interaction', data: { interaction: 'tap', startSec: 57, durationSec: 3, count: 10 } },
    { id: 'early', type: 'story_interaction', data: { interaction: 'swipe', startSec: 10, direction: 'left' } },
    { id: 'loose', type: 'story_interaction', data: { interaction: 'hold' } },
    { id: 'wrong', type: 'story_interaction', data: { interaction: 'tap' } },
    { id: 'other', type: 'story_ending', data: {} },
  ]
  const edges: CanvasEdgeLike[] = [
    flow('f1', 'in', 'lift'),
    { id: 'r1', source: 'clip', target: 'lift', sourceHandle: 'output', role: 'REF' },
    mount('m1', 'lift', 'late'),
    mount('m2', 'lift', 'early'),
    mount('m3', 'other', 'wrong'),
    flow('f2', 'late', 'other', 'success'),
  ]

  it('hangs mounted interactions on the scene sorted by start second and keeps the video length', () => {
    const chapter = compileChapter({ projectId: 'p', title: '一' }, nodes, edges)
    const lift = chapter.nodes.find((node) => node.id === 'lift')
    expect(lift?.kind === 'scene' && lift.beats.map((beat) => [beat.id, beat.startSec])).toEqual([['early', 10], ['late', 57]])
    expect(lift?.kind === 'scene' && lift.media).toEqual({ kind: 'video', url: '/lift.mp4', posterUrl: null, durationSec: 60 })
    expect(lift?.kind === 'scene' && lift.beats[1].mountedOn).toBe('lift')
  })

  it('keeps mounts out of the story flow and treats unmounted or wrongly mounted interactions as standalone', () => {
    const chapter = compileChapter({ projectId: 'p', title: '一' }, nodes, edges)
    expect(chapter.flows.map((item) => item.id)).toEqual(['f1', 'f2'])
    expect(chapter.flows.find((item) => item.id === 'f2')).toEqual({ id: 'f2', from: 'late', handle: 'success', to: 'other' })
    const byId = (id: string) => chapter.nodes.find((node) => node.id === id)
    expect(byId('loose')).toMatchObject({ kind: 'interaction', mountedOn: null })
    expect(byId('wrong')).toMatchObject({ kind: 'interaction', mountedOn: null })
    expect(byId('late')).toMatchObject({ kind: 'interaction', mountedOn: 'lift', startSec: 57, durationSec: 3 })
  })

  it('gives old scenes an empty timeline and old choices the plain panel', () => {
    const chapter = compileChapter({ projectId: 'p', title: '一' }, [{ id: 's', type: 'story_scene', data: { title: '旧' } }], [])
    expect(chapter.nodes[0]).toMatchObject({ kind: 'scene', beats: [] })
    expect(readChoiceData({ options: [{ id: 'a', label: '甲' }], timeoutSec: 5 })).toMatchObject({
      panelStyle: 'text',
      layout: 'auto',
      timeoutMode: 'default',
      timeoutSec: 5,
      options: [{ id: 'a', label: '甲', imageUrl: null, when: 'now', retry: false }],
    })
  })
})

describe('choice panel presentation', () => {
  it('lays cards out by orientation on auto and obeys a forced direction', () => {
    expect(resolveChoiceLayout('auto', 'portrait')).toBe('vertical')
    expect(resolveChoiceLayout('auto', 'landscape')).toBe('horizontal')
    expect(resolveChoiceLayout('horizontal', 'portrait')).toBe('horizontal')
    expect(resolveChoiceLayout('vertical', 'landscape')).toBe('vertical')
  })

  it('shows text, picture or both, and never renders an empty card', () => {
    const withImage = { imageUrl: '/a.png' }
    const without = { imageUrl: null }
    expect(choiceOptionParts('text', withImage)).toEqual({ image: false, text: true })
    expect(choiceOptionParts('image', withImage)).toEqual({ image: true, text: false })
    expect(choiceOptionParts('image', without)).toEqual({ image: false, text: true })
    expect(choiceOptionParts('both', withImage)).toEqual({ image: true, text: true })
    expect(choiceOptionParts('both', without)).toEqual({ image: false, text: true })
  })
})
