import { describe, expect, it } from 'vitest'
import { advanceRun, resolveBeat, startRun } from '@/lib/interactive/engine'
import type {
  StoryChapterGraph,
  StoryEndingNode,
  StoryInteractionNode,
  StoryProgram,
  StorySceneNode,
} from '@/lib/interactive/types'
import {
  applyBeatOutcome,
  beatEndAction,
  countdownPercent,
  createResolutionGate,
  isCountdownExpired,
  markBeatFired,
  nextAttempt,
  remainingSec,
  unfireBeatsFrom,
} from '@/features/interactive/player/beat-scheduler'

const tapSpec = (count = 1) => ({ type: 'tap' as const, count, buttonText: '', buttonImageUrl: null })

const beat = (id: string, startSec: number, overrides: Partial<StoryInteractionNode> = {}): StoryInteractionNode => ({
  id,
  kind: 'interaction',
  title: id,
  spec: tapSpec(1),
  hint: '',
  durationSec: 3,
  during: 'play',
  mountedOn: 's',
  startSec,
  results: {
    success: { effects: [], when: 'now', retry: false },
    fail: { effects: [], when: 'now', retry: false },
  },
  ...overrides,
})

const scene = (id: string, beats: StoryInteractionNode[] = [], media: StorySceneNode['media'] = { kind: 'video', url: '/clip.webm', posterUrl: null, durationSec: 20 }): StorySceneNode => ({
  id,
  kind: 'scene',
  title: id,
  lines: '',
  effects: [],
  media,
  beats,
})

const ending = (id: string): StoryEndingNode => ({ id, kind: 'ending', title: id, endingType: 'normal', description: '' })

function programOf(nodes: StoryChapterGraph['nodes'], flows: StoryChapterGraph['flows']): StoryProgram {
  return {
    variables: [{ id: 'courage', name: '勇气', type: 'number', initial: 0 }],
    chapters: [{ projectId: 'p', title: '章', nodes, flows }],
    links: [],
    start: { projectId: 'p', entryNodeId: 'in' },
  }
}

/** 电梯式场景: two mounted beats, retry rewinds to beat.startSec - 2. */
function retryProgram() {
  const b0 = beat('early', 0.5, { results: { success: { effects: [], when: 'now', retry: false }, fail: { effects: [], when: 'now', retry: false } } })
  const b1 = beat('door', 3, { results: { success: { effects: [], when: 'now', retry: false }, fail: { effects: [], when: 'now', retry: true } } })
  const b2 = beat('later', 6)
  return programOf(
    [{ id: 'in', kind: 'entry', title: '开场' }, scene('s', [b0, b1, b2]), ending('end'), scene('next')],
    [{ id: 'f1', from: 'in', handle: 'output', to: 's' }, { id: 'f2', from: 's', handle: 'output', to: 'end' }, { id: 'f3', from: 'door', handle: 'success', to: 'next' }],
  )
}

describe('fired-beat bookkeeping', () => {
  it('marks a beat without mutating the previous set', () => {
    const empty = new Set<string>()
    const fired = markBeatFired(empty, 'a')
    expect([...fired]).toEqual(['a'])
    expect([...empty]).toEqual([])
    expect([...markBeatFired(fired, 'a')]).toEqual(['a'])
  })

  it('re-arms the retried beat and every later beat on a rewind, keeping earlier ones fired', () => {
    const program = retryProgram()
    const run = startRun(program, { mode: 'story' })
    const beats = run.stop.kind === 'scene' ? run.stop.node.beats : []
    const fired = new Set(beats.map((item) => item.id))
    const seekSec = 1 // startSec 3 - 2
    const rearmed = unfireBeatsFrom(fired, beats, seekSec)
    expect([...rearmed]).toEqual(['early'])
    // Every beat starting at or after the seek point can fire again even without its own retry.
    expect([...unfireBeatsFrom(fired, beats, 0)]).toEqual([])
    expect([...unfireBeatsFrom(fired, beats, 5)]).toEqual(['early', 'door'])
  })
})

describe('applying a BeatOutcome', () => {
  it('continue keeps the same stop, applies value effects and marks the beat used', () => {
    const b = beat('run', 3, {
      results: { success: { effects: [{ variableId: 'courage', op: 'add', value: 1 }], when: 'now', retry: false }, fail: { effects: [], when: 'now', retry: false } },
    })
    const program = programOf(
      [{ id: 'in', kind: 'entry', title: '开场' }, scene('s', [b]), ending('end')],
      [{ id: 'f1', from: 'in', handle: 'output', to: 's' }, { id: 'f2', from: 's', handle: 'output', to: 'end' }],
    )
    const run = startRun(program, { mode: 'story' })
    const outcome = resolveBeat(program, run, 'run', 'success')
    expect(outcome.kind).toBe('continue')
    const plan = applyBeatOutcome(outcome, b, run.stop.kind === 'scene' ? run.stop.node.beats : [], new Set())
    expect(plan).toMatchObject({ kind: 'continue', seekSec: null, pendingLabel: null })
    expect(plan.run).toBe(outcome.run)
    expect(plan.run.vars.courage).toBe(1)
    expect(plan.run.stop).toBe(run.stop)
    expect([...plan.fired]).toEqual(['run'])
    expect(beatEndAction(plan)).toBe('advance')
    expect(advanceRun(program, plan.run).stop.kind).toBe('ending')
  })

  it('retry rewinds two seconds and un-fires every beat from the seek point', () => {
    const program = retryProgram()
    const run = startRun(program, { mode: 'story' })
    const beats = run.stop.kind === 'scene' ? run.stop.node.beats : []
    const outcome = resolveBeat(program, run, 'door', 'fail')
    expect(outcome.kind).toBe('retry')
    const fired = new Set(['early', 'door', 'later'])
    const plan = applyBeatOutcome(outcome, beats[1], beats, fired)
    expect(plan.kind).toBe('retry')
    expect(plan.seekSec).toBe(1)
    expect([...plan.fired]).toEqual(['early'])
    expect(beatEndAction(plan)).toBe('retry')
    // The same stop survives a retry: the video element must not remount.
    expect(plan.run.stop).toBe(run.stop)
  })

  it('defer sets the 待切换 label and the next advance follows the pending cut, not the scene exit', () => {
    const b = beat('door', 3, { results: { success: { effects: [], when: 'after', retry: false }, fail: { effects: [], when: 'now', retry: false } } })
    const program = programOf(
      [{ id: 'in', kind: 'entry', title: '开场' }, scene('s', [b]), scene('saved'), ending('end'), ending('trapped')],
      [
        { id: 'f1', from: 'in', handle: 'output', to: 's' },
        { id: 'f2', from: 's', handle: 'output', to: 'end' },
        { id: 'f3', from: 'door', handle: 'success', to: 'saved' },
        { id: 'f4', from: 'door', handle: 'fail', to: 'trapped' },
        { id: 'f5', from: 'saved', handle: 'output', to: 'end' },
      ],
    )
    const run = startRun(program, { mode: 'story' })
    const beats = run.stop.kind === 'scene' ? run.stop.node.beats : []
    const outcome = resolveBeat(program, run, 'door', 'success')
    expect(outcome.kind).toBe('defer')
    const plan = applyBeatOutcome(outcome, b, beats, new Set())
    expect(plan).toMatchObject({ kind: 'defer', pendingLabel: 'saved' })
    expect(plan.run.stop).toBe(run.stop)
    expect(plan.run.pending).toEqual({ nodeId: 'saved', label: 'saved' })
    expect(beatEndAction(plan)).toBe('advance')
    // The picture ran to the end: the pending cut wins over the scene's own output.
    const advanced = advanceRun(program, plan.run)
    expect(advanced.stop.kind === 'scene' ? advanced.stop.node.id : null).toBe('saved')
  })

  it('a cut settles onto the next stop at once', () => {
    const program = retryProgram()
    const run = startRun(program, { mode: 'story' })
    const beats = run.stop.kind === 'scene' ? run.stop.node.beats : []
    const outcome = resolveBeat(program, run, 'door', 'success')
    expect(outcome.kind).toBe('cut')
    const plan = applyBeatOutcome(outcome, beats[1], beats, new Set())
    expect(plan.kind).toBe('cut')
    expect(plan.run.stop.kind).toBe('scene')
    expect(beatEndAction(plan)).toBe('settle')
  })

  it('an active beat resolved as its time-out on video end still cuts when the timeout result is linked', () => {
    const b = beat('c', 5, {
      durationSec: 3,
      spec: {
        type: 'choice',
        prompt: '',
        options: [
          { id: 'fight', label: '开枪', effects: [], imageUrl: null, when: 'now', retry: false },
          { id: 'flee', label: '逃跑', effects: [], imageUrl: null, when: 'now', retry: false },
        ],
        panelStyle: 'text',
        layout: 'auto',
        timeoutMode: 'exit',
        defaultOptionId: null,
      },
    })
    const program = programOf(
      [{ id: 'in', kind: 'entry', title: '开场' }, scene('s', [b]), ending('win'), ending('dead')],
      [
        { id: 'f1', from: 'in', handle: 'output', to: 's' },
        { id: 'f2', from: 'c', handle: 'fight', to: 'win' },
        { id: 'f3', from: 'c', handle: 'flee', to: 'win' },
        { id: 'f4', from: 'c', handle: 'timeout', to: 'dead' },
      ],
    )
    const run = startRun(program, { mode: 'story' })
    const beats = run.stop.kind === 'scene' ? run.stop.node.beats : []
    const outcome = resolveBeat(program, run, 'c', 'timeout')
    expect(outcome.kind).toBe('cut')
    const plan = applyBeatOutcome(outcome, b, beats, new Set())
    expect(plan.run.stop.kind === 'ending' && plan.run.stop.node.title).toBe('dead')
    expect(beatEndAction(plan)).toBe('settle')
  })

  it('an unlinked time-out keeps playing and advances the segment afterwards', () => {
    const b = beat('tap', 3)
    const program = programOf(
      [{ id: 'in', kind: 'entry', title: '开场' }, scene('s', [b]), ending('end')],
      [{ id: 'f1', from: 'in', handle: 'output', to: 's' }, { id: 'f2', from: 's', handle: 'output', to: 'end' }],
    )
    const run = startRun(program, { mode: 'story' })
    const beats = run.stop.kind === 'scene' ? run.stop.node.beats : []
    const plan = applyBeatOutcome(resolveBeat(program, run, 'tap', 'fail'), b, beats, new Set())
    expect(plan.kind).toBe('continue')
    expect(plan.run.stop).toBe(run.stop)
    expect(beatEndAction(plan)).toBe('advance')
    const advanced = advanceRun(program, plan.run)
    expect(advanced.stop.kind === 'ending' ? advanced.stop.node.title : null).toBe('end')
  })
})

describe('the resolution gate', () => {
  it('lets exactly one result through even when a timer and a pointer race', () => {
    const seen: string[] = []
    const gate = createResolutionGate<string>((value) => seen.push(value))
    expect(gate('success')).toBe(true)
    expect(gate('fail')).toBe(false)
    expect(gate('success')).toBe(false)
    expect(seen).toEqual(['success'])
  })
})

describe('real-time countdown maths', () => {
  it('counts in wall-clock seconds from the moment the beat appeared', () => {
    expect(remainingSec(1000, 2500, 3)).toBeCloseTo(1.5, 6)
    expect(countdownPercent(1000, 2500, 3)).toBeCloseTo(50, 6)
    expect(isCountdownExpired(1000, 2500, 3)).toBe(false)
    expect(remainingSec(1000, 4000, 3)).toBe(0)
    expect(countdownPercent(1000, 4000, 3)).toBe(0)
    expect(isCountdownExpired(1000, 4000, 3)).toBe(true)
    expect(remainingSec(1000, 900, 3)).toBe(3)
    expect(countdownPercent(1000, 900, 0)).toBe(0)
  })
})

describe('standalone retry re-arm', () => {
  it('bumps the attempt only when advanceRun settled back onto the same stop object', () => {
    const interactive: StoryInteractionNode = {
      id: 'hold',
      kind: 'interaction',
      title: 'hold',
      spec: { type: 'hold', fillSec: 2, rangeMin: 80, rangeMax: 100, overchargeFails: false, buttonText: '', buttonImageUrl: null },
      hint: '',
      durationSec: 4,
      during: 'freeze',
      mountedOn: null,
      startSec: 0,
      results: { success: { effects: [], when: 'now', retry: false }, fail: { effects: [], when: 'now', retry: true } },
    }
    const program = programOf(
      [{ id: 'in', kind: 'entry', title: '开场' }, interactive, ending('end')],
      [{ id: 'f1', from: 'in', handle: 'output', to: 'hold' }, { id: 'f2', from: 'hold', handle: 'success', to: 'end' }],
    )
    const run = startRun(program, { mode: 'story' })
    expect(run.stop.kind).toBe('interaction')
    const retried = advanceRun(program, run, 'fail')
    expect(retried.stop).toBe(run.stop)
    expect(nextAttempt(0, run.stop, retried)).toBe(1)
    expect(nextAttempt(4, run.stop, retried)).toBe(5)
    const movedOn = advanceRun(program, retried, 'success')
    expect(nextAttempt(1, retried.stop, movedOn)).toBe(0)
  })
})
