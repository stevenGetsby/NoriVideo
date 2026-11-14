import { describe, expect, it } from 'vitest'
import { compileChapter, type CanvasEdgeLike, type CanvasNodeLike } from '@/lib/interactive/compile'
import { advanceRun, choiceTimeoutOption, resolveBeat, startRun } from '@/lib/interactive/engine'
import { validateChapter } from '@/lib/interactive/validate'
import type { StoryProgram, StoryVariable } from '@/lib/interactive/types'

const variables: StoryVariable[] = [{ id: 'courage', name: '勇气', type: 'number', initial: 0 }]

const flow = (id: string, source: string, target: string, sourceHandle = 'output'): CanvasEdgeLike =>
  ({ id, source, target, sourceHandle, role: 'STORY_FLOW' })
const mount = (id: string, scene: string, beat: string): CanvasEdgeLike =>
  ({ id, source: scene, target: beat, sourceHandle: 'interact', role: 'STORY_MOUNT' })
const scene = (id: string, data: Record<string, unknown> = {}): CanvasNodeLike => ({ id, type: 'story_scene', data: { title: id, videoUrl: `/${id}.mp4`, ...data } })
const ending = (id: string, endingType = 'good'): CanvasNodeLike => ({ id, type: 'story_ending', data: { title: id, endingType } })
const beat = (id: string, data: Record<string, unknown>): CanvasNodeLike => ({ id, type: 'story_interaction', data: { title: id, ...data } })

function programOf(nodes: CanvasNodeLike[], edges: CanvasEdgeLike[]): StoryProgram {
  return {
    variables,
    chapters: [compileChapter({ projectId: 'p', title: '章' }, nodes, edges)],
    links: [],
    start: { projectId: 'p', entryNodeId: 'in' },
  }
}

const entry: CanvasNodeLike = { id: 'in', type: 'story_entry', data: {} }

/** The "电梯逃生" example: a 60s scene, tap 10x during 57s-60s, success cuts after the segment, fail cuts at once. */
function elevator() {
  const nodes = [
    entry,
    scene('lift', { videoDurationSec: 60 }),
    beat('tap', {
      interaction: 'tap',
      startSec: 57,
      durationSec: 3,
      count: 10,
      results: { success: { when: 'after' }, fail: { when: 'now' } },
    }),
    scene('saved'),
    ending('rescued'),
    ending('trapped', 'bad'),
  ]
  const edges = [
    flow('f1', 'in', 'lift'),
    mount('m1', 'lift', 'tap'),
    flow('f2', 'tap', 'saved', 'success'),
    flow('f3', 'tap', 'trapped', 'fail'),
    flow('f4', 'saved', 'rescued'),
  ]
  return programOf(nodes, edges)
}

describe('mounted interactions in the engine', () => {
  it('lets the last seconds keep playing when success waits for the segment to end', () => {
    const program = elevator()
    const run = startRun(program, { mode: 'story' })
    expect(run.stop.kind).toBe('scene')
    expect(run.stop.kind === 'scene' && run.stop.node.beats.map((item) => item.id)).toEqual(['tap'])

    const outcome = resolveBeat(program, run, 'tap', 'success')
    expect(outcome.kind).toBe('defer')
    expect(outcome.run.stop).toBe(run.stop)
    expect(outcome.run.pending).toEqual({ nodeId: 'saved', label: 'saved' })

    const done = advanceRun(program, outcome.run)
    expect(done.stop.kind === 'scene' && done.stop.node.id).toBe('saved')
    expect(done.pending ?? null).toBeNull()
    const ending = advanceRun(program, done).stop
    expect(ending.kind === 'ending' && ending.node.title).toBe('rescued')
  })

  it('cuts to the bad ending at once when the tap fails', () => {
    const program = elevator()
    const outcome = resolveBeat(program, startRun(program, { mode: 'story' }), 'tap', 'fail')
    expect(outcome.kind).toBe('cut')
    expect(outcome.run.stop.kind === 'ending' && outcome.run.stop.node.title).toBe('trapped')
    expect(outcome.run.trail.map((step) => [step.nodeId, step.choice])).toContainEqual(['tap', '失败'])
  })

  it('keeps the video playing and still applies the value change when the result is not linked', () => {
    const nodes = [
      entry,
      scene('escape', { videoDurationSec: 40 }),
      beat('run', { interaction: 'tap', startSec: 30, durationSec: 3, results: { success: { effects: [{ variableId: 'courage', op: 'add', value: 1 }] } } }),
      ending('home'),
    ]
    const program = programOf(nodes, [flow('f1', 'in', 'escape'), mount('m1', 'escape', 'run'), flow('f2', 'escape', 'home')])
    const run = startRun(program, { mode: 'story' })
    const outcome = resolveBeat(program, run, 'run', 'success')
    expect(outcome.kind).toBe('continue')
    expect(outcome.run.vars.courage).toBe(1)
    expect(outcome.run.stop).toBe(run.stop)
    expect(advanceRun(program, outcome.run).stop.kind).toBe('ending')
    expect(validateChapter(program.chapters[0], variables).filter((item) => item.level === 'error')).toEqual([])
  })

  it('rewinds two seconds before the interaction on 失败重来 and applies the effects every attempt', () => {
    const nodes = [
      entry,
      scene('door', { videoDurationSec: 20 }),
      beat('hold', { interaction: 'hold', startSec: 9, durationSec: 4, results: { fail: { retry: true, effects: [{ variableId: 'courage', op: 'add', value: -1 }] } } }),
      ending('open'),
    ]
    const program = programOf(nodes, [flow('f1', 'in', 'door'), mount('m1', 'door', 'hold'), flow('f2', 'hold', 'open', 'success'), flow('f3', 'door', 'open')])
    const first = resolveBeat(program, startRun(program, { mode: 'story' }), 'hold', 'fail')
    expect(first).toMatchObject({ kind: 'retry', seekSec: 7 })
    expect(first.run.vars.courage).toBe(-1)
    const second = resolveBeat(program, first.run, 'hold', 'fail')
    expect(second.run.vars.courage).toBe(-2)
    expect(resolveBeat(program, second.run, 'hold', 'success').kind).toBe('cut')

    const early = programOf(
      [entry, scene('s'), beat('b', { interaction: 'tap', startSec: 1, results: { fail: { retry: true } } }), ending('e')],
      [flow('f1', 'in', 's'), mount('m1', 's', 'b'), flow('f2', 's', 'e')],
    )
    expect(resolveBeat(early, startRun(early, { mode: 'story' }), 'b', 'fail')).toMatchObject({ kind: 'retry', seekSec: 0 })
  })

  it('ignores unknown interactions and result handles that the interaction does not have', () => {
    const program = elevator()
    const run = startRun(program, { mode: 'story' })
    expect(resolveBeat(program, run, 'ghost', 'success')).toEqual({ kind: 'continue', run })
    expect(resolveBeat(program, run, 'tap', 'perfect')).toEqual({ kind: 'continue', run })
    const finished = advanceRun(program, resolveBeat(program, run, 'tap', 'fail').run)
    expect(finished.stop.kind).toBe('ending')
    expect(resolveBeat(program, finished, 'tap', 'success')).toEqual({ kind: 'continue', run: finished })
  })

  it('sends a mounted choice with its own exit to the death ending on time-out', () => {
    const nodes = [
      entry,
      scene('zombie', { videoDurationSec: 8 }),
      beat('c', {
        interaction: 'choice',
        startSec: 5,
        durationSec: 3,
        timeoutMode: 'exit',
        options: [{ id: 'fight', label: '开枪' }, { id: 'flee', label: '逃跑' }],
      }),
      ending('win'),
      ending('flee_end', 'normal'),
      ending('dead', 'bad'),
    ]
    const program = programOf(nodes, [
      flow('f1', 'in', 'zombie'),
      mount('m1', 'zombie', 'c'),
      flow('f2', 'c', 'win', 'fight'),
      flow('f3', 'c', 'flee_end', 'flee'),
      flow('f4', 'c', 'dead', 'timeout'),
    ])
    const run = startRun(program, { mode: 'story' })
    const beatNode = run.stop.kind === 'scene' ? run.stop.node.beats[0] : null
    expect(beatNode?.during).toBe('freeze')
    const timedOut = resolveBeat(program, run, 'c', 'timeout')
    expect(timedOut.kind).toBe('cut')
    expect(timedOut.run.stop.kind === 'ending' && timedOut.run.stop.node.title).toBe('dead')
    expect(resolveBeat(program, run, 'c', 'fight').run.stop.kind === 'ending' && true).toBe(true)
    expect(validateChapter(program.chapters[0], variables).filter((item) => item.level === 'error')).toEqual([])
  })
})

describe('standalone interactions in the flow', () => {
  function standalone() {
    const nodes = [
      entry,
      scene('water'),
      beat('swipe', {
        interaction: 'swipe',
        direction: 'left',
        results: { success: { effects: [{ variableId: 'courage', op: 'add', value: 2 }] }, fail: { retry: false } },
      }),
      ending('dry'),
      ending('wet', 'bad'),
    ]
    return programOf(nodes, [
      flow('f1', 'in', 'water'),
      flow('f2', 'water', 'swipe'),
      flow('f3', 'swipe', 'dry', 'success'),
      flow('f4', 'swipe', 'wet', 'fail'),
    ])
  }

  it('stops at an interaction placed after the segment and branches on its result', () => {
    const program = standalone()
    let run = startRun(program, { mode: 'story' })
    expect(run.stop.kind).toBe('scene')
    run = advanceRun(program, run)
    expect(run.stop.kind).toBe('interaction')
    expect(run.stop.kind === 'interaction' && run.stop.node.mountedOn).toBeNull()
    expect(advanceRun(program, run)).toBe(run)
    expect(advanceRun(program, run, 'perfect')).toBe(run)

    const success = advanceRun(program, run, 'success')
    expect(success.vars.courage).toBe(2)
    expect(success.stop.kind === 'ending' && success.stop.node.title).toBe('dry')
    expect(success.trail.find((step) => step.nodeId === 'swipe')?.choice).toBe('成功')
    const wet = advanceRun(program, run, 'fail').stop
    expect(wet.kind === 'ending' && wet.node.title).toBe('wet')
  })

  it('replays a standalone interaction on 失败重来 instead of leaving it', () => {
    const nodes = [entry, beat('hold', { interaction: 'hold', results: { fail: { retry: true, effects: [{ variableId: 'courage', op: 'add', value: -1 }] } } }), ending('e')]
    const program = programOf(nodes, [flow('f1', 'in', 'hold'), flow('f2', 'hold', 'e', 'success')])
    const run = startRun(program, { mode: 'story' })
    expect(run.stop.kind).toBe('interaction')
    const again = advanceRun(program, run, 'fail')
    expect(again.stop).toBe(run.stop)
    expect(again.vars.courage).toBe(-1)
    expect(advanceRun(program, again, 'success').stop.kind).toBe('ending')
  })

  it('halts instead of crashing when a result has no link', () => {
    const program = standalone()
    program.chapters[0].flows = program.chapters[0].flows.filter((item) => item.id !== 'f4')
    const run = advanceRun(program, startRun(program, { mode: 'story' }))
    expect(advanceRun(program, run, 'fail').stop).toMatchObject({ kind: 'halt', reason: 'dead_end', nodeId: 'swipe' })
  })
})

describe('timed choice with an exit', () => {
  const nodes = [
    entry,
    {
      id: 'ask',
      type: 'story_choice',
      data: {
        title: '抉择',
        timeoutSec: 3,
        timeoutMode: 'exit',
        options: [{ id: 'a', label: '甲', effects: [{ variableId: 'courage', op: 'add', value: 1 }] }, { id: 'b', label: '乙' }],
      },
    },
    ending('a_end'),
    ending('b_end'),
    ending('late_end', 'bad'),
  ]
  const edges = [flow('f1', 'in', 'ask'), flow('f2', 'ask', 'a_end', 'a'), flow('f3', 'ask', 'b_end', 'b'), flow('f4', 'ask', 'late_end', 'timeout')]

  it('follows the timeout port without applying any option effect', () => {
    const program = programOf(nodes, edges)
    const run = startRun(program, { mode: 'story' })
    expect(run.stop.kind).toBe('choice')
    const choice = run.stop.kind === 'choice' ? run.stop.node : null
    expect(choice && choiceTimeoutOption(choice)).toBe('timeout')
    const late = advanceRun(program, run, 'timeout')
    expect(late.vars.courage).toBe(0)
    expect(late.stop.kind === 'ending' && late.stop.node.title).toBe('late_end')
    expect(late.trail.find((step) => step.nodeId === 'ask')?.choice).toBe('超时')
    expect(advanceRun(program, run, 'a').vars.courage).toBe(1)
  })

  it('still lets a choice without its own exit time out onto its default option', () => {
    const plain = programOf(
      [entry, { ...nodes[1], data: { ...(nodes[1].data as object), timeoutMode: 'default', defaultOptionId: 'b' } }, ending('a_end'), ending('b_end')],
      edges.slice(0, 3),
    )
    const run = startRun(plain, { mode: 'story' })
    const choice = run.stop.kind === 'choice' ? run.stop.node : null
    expect(choice && choiceTimeoutOption(choice)).toBe('b')
    expect(advanceRun(plain, run, 'timeout')).toBe(run)
  })
})

describe('interaction validation', () => {
  const issuesFor = (program: StoryProgram) => validateChapter(program.chapters[0], variables)
  const codes = (program: StoryProgram) => issuesFor(program).map((item) => item.code)

  it('accepts the elevator example and reaches the mounted interaction through its scene', () => {
    const issues = issuesFor(elevator())
    expect(issues.filter((item) => item.level === 'error')).toEqual([])
    expect(issues.some((item) => item.code === 'unreachable')).toBe(false)
  })

  it('rejects an interaction that runs past the end of the video or overlaps another', () => {
    const nodes = [
      entry,
      scene('s', { videoDurationSec: 10 }),
      beat('late', { interaction: 'tap', startSec: 8.5, durationSec: 3 }),
      beat('a', { interaction: 'tap', startSec: 1, durationSec: 3 }),
      beat('b', { interaction: 'swipe', startSec: 3, durationSec: 1 }),
      ending('e'),
    ]
    const program = programOf(nodes, [flow('f1', 'in', 's'), mount('m1', 's', 'late'), mount('m2', 's', 'a'), mount('m3', 's', 'b'), flow('f2', 's', 'e')])
    const issues = issuesFor(program)
    expect(issues.find((item) => item.code === 'beat_out_of_range')).toMatchObject({ level: 'error', nodeId: 'late' })
    expect(issues.find((item) => item.code === 'beat_overlap')).toMatchObject({ level: 'error', nodeId: 'b' })
  })

  it('warns when the scene has no video to mount on and skips the range check without a known length', () => {
    const nodes = [entry, { id: 's', type: 'story_scene', data: { title: 's' } }, beat('b', { interaction: 'tap', startSec: 500 }), ending('e')]
    const program = programOf(nodes, [flow('f1', 'in', 's'), mount('m1', 's', 'b'), flow('f2', 's', 'e')])
    expect(codes(program)).toContain('beat_needs_video')
    expect(codes(program)).not.toContain('beat_out_of_range')
  })

  it('requires every result of a standalone interaction to go somewhere and the timeout exit to be wired', () => {
    const nodes = [
      entry,
      beat('t', { interaction: 'timing' }),
      beat('c', { interaction: 'choice', timeoutMode: 'exit', options: [{ id: 'x', label: '甲' }, { id: 'y', label: '乙' }] }),
      ending('e'),
    ]
    const program = programOf(nodes, [flow('f1', 'in', 't'), flow('f2', 't', 'c', 'perfect'), flow('f3', 't', 'e', 'normal'), flow('f4', 'c', 'e', 'x')])
    const issues = issuesFor(program).filter((item) => item.level === 'error')
    expect(issues.filter((item) => item.code === 'result_unlinked').map((item) => item.message)).toEqual(expect.arrayContaining([
      expect.stringContaining('失误'),
      expect.stringContaining('超时'),
    ]))
    expect(issues.some((item) => item.code === 'option_unlinked' && item.message.includes('乙'))).toBe(true)
  })

  it('reports an interaction that is both mounted and wired into the flow, and stale result links', () => {
    const nodes = [entry, scene('s', { videoDurationSec: 30 }), beat('b', { interaction: 'tap' }), ending('e')]
    const program = programOf(nodes, [flow('f1', 'in', 's'), mount('m1', 's', 'b'), flow('f2', 's', 'b'), flow('f3', 'b', 'e', 'perfect'), flow('f4', 'b', 'e', 'success')])
    expect(codes(program)).toEqual(expect.arrayContaining(['mount_and_flow', 'stale_flow']))
  })

  it('needs images for an image layout, flags unknown value references and warns about retry plus a link', () => {
    const nodes = [
      entry,
      scene('s', { videoDurationSec: 30 }),
      beat('b', {
        interaction: 'choice',
        panelStyle: 'both',
        startSec: 2,
        options: [
          { id: 'o1', label: '甲', imageUrl: '/a.png', effects: [{ variableId: 'ghost', op: 'add', value: 1 }] },
          { id: 'o2', label: '乙', retry: true },
        ],
      }),
      ending('e'),
    ]
    const program = programOf(nodes, [flow('f1', 'in', 's'), mount('m1', 's', 'b'), flow('f2', 's', 'e'), flow('f3', 'b', 'e', 'o2')])
    expect(codes(program)).toEqual(expect.arrayContaining(['choice_image_missing', 'unknown_variable', 'result_retry_linked']))
  })

  it('treats a scene whose exit is replaced by interaction results as complete only when every result is covered', () => {
    expect(codes(elevator())).not.toContain('dead_end')
    const broken = elevator()
    broken.chapters[0].flows = broken.chapters[0].flows.filter((item) => item.id !== 'f3')
    expect(codes(broken)).toContain('dead_end')
    const plain = programOf([entry, scene('s'), ending('e')], [flow('f1', 'in', 's')])
    expect(codes(plain)).toContain('dead_end')
  })

  it('flags a choice with its own exit that is not wired and an image layout without pictures', () => {
    const nodes = [
      entry,
      {
        id: 'ask',
        type: 'story_choice',
        data: { timeoutSec: 5, timeoutMode: 'exit', panelStyle: 'image', options: [{ id: 'a', label: '甲' }, { id: 'b', label: '乙', imageUrl: '/b.png' }] },
      },
      ending('e'),
    ]
    const program = programOf(nodes, [flow('f1', 'in', 'ask'), flow('f2', 'ask', 'e', 'a'), flow('f3', 'ask', 'e', 'b')])
    expect(codes(program)).toEqual(expect.arrayContaining(['timeout_unlinked', 'choice_image_missing']))
    const wired = programOf(
      [entry, { ...nodes[1], data: { ...(nodes[1].data as object), panelStyle: 'text' } }, ending('e')],
      [flow('f1', 'in', 'ask'), flow('f2', 'ask', 'e', 'a'), flow('f3', 'ask', 'e', 'b'), flow('f4', 'ask', 'e', 'timeout')],
    )
    expect(issuesFor(wired).filter((item) => item.level === 'error')).toEqual([])
  })
})
