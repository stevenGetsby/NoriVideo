import { existsSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { compileChapter, type CanvasNodeLike } from '@/lib/interactive/compile'
import type { StoryProgram } from '@/lib/interactive/types'
import { advanceRun, startRun } from '../../../miniprogram/miniprogram/runtime/story-runtime'
import { pickPreloadTarget, preloadCandidates, WaitingTracker, type BranchStats, type PreloadCandidate } from '../../../miniprogram/miniprogram/pkg-play/lib/preload'
import { ending, entry, flow, keyUnlock, scene } from '../interactive/economy-fixture'

if (!existsSync(path.resolve(process.cwd(), 'miniprogram/miniprogram/runtime/story-runtime.js'))) {
  throw new Error('先运行 npm --prefix miniprogram run build:runtime')
}

/** start → mid → fork(choice) → a/b video scenes or an ending; go_lock stays locked without a key. */
function forkProgram(opts: { dedup?: boolean; locked?: boolean } = {}): StoryProgram {
  const fork: CanvasNodeLike = {
    id: 'fork',
    type: 'story_choice',
    data: {
      title: '岔路',
      options: [
        { id: 'go_a', label: '甲' },
        { id: 'go_b', label: '乙' },
        { id: 'go_end', label: '离开' },
        ...(opts.locked ? [{ id: 'go_lock', label: '锁', unlock: keyUnlock('locked') }] : []),
      ],
    },
  }
  const nodes = [entry, scene('start'), scene('mid'), fork, scene('a'), scene('b'), ending('e')]
  const edges = [
    flow('f1', 'in', 'start'),
    flow('f2', 'start', 'mid'),
    flow('f3', 'mid', 'fork'),
    flow('f4', 'fork', 'a', 'go_a'),
    flow('f5', 'fork', opts.dedup ? 'a' : 'b', 'go_b'),
    flow('f6', 'fork', 'e', 'go_end'),
    ...(opts.locked ? [flow('f7', 'fork', 'a', 'go_lock')] : []),
    flow('f8', 'a', 'e'),
    flow('f9', 'b', 'e'),
  ]
  return {
    variables: [{ id: 'key', name: '钥匙', type: 'number', initial: 0 }],
    chapters: [compileChapter({ projectId: 'p', title: '章' }, nodes, edges)],
    links: [],
    start: { projectId: 'p', entryNodeId: 'in' },
  }
}

function atFork(program: StoryProgram) {
  let run = startRun(program, { mode: 'story' })
  run = advanceRun(program, run) // start → mid
  run = advanceRun(program, run) // mid → fork
  return run
}

describe('preloadCandidates', () => {
  it('offers the next video scene when a segment plays out naturally', () => {
    const program = forkProgram()
    const run = startRun(program, { mode: 'story' })
    expect(run.stop.kind).toBe('scene')
    expect(preloadCandidates(program, run)).toEqual([
      { handle: null, url: '/mid.mp4', projectId: 'p', nodeId: 'mid' },
    ])
  })

  it('offers nothing when the next stop is a choice, not a scene', () => {
    const program = forkProgram()
    const run = advanceRun(program, startRun(program, { mode: 'story' })) // at mid, next is fork
    expect(preloadCandidates(program, run)).toEqual([])
  })

  it('simulates every open option and keeps only video-scene successors', () => {
    const program = forkProgram({ locked: true })
    const run = atFork(program)
    expect(run.stop.kind).toBe('choice')
    const candidates = preloadCandidates(program, run)
    expect(candidates.map((c) => c.handle)).toEqual(['go_a', 'go_b'])
    expect(candidates.map((c) => c.url)).toEqual(['/a.mp4', '/b.mp4'])
    expect(candidates.every((c) => c.projectId === 'p')).toBe(true)
  })

  it('excludes locked options and dedupes by media url', () => {
    const program = forkProgram({ locked: true, dedup: true })
    const candidates = preloadCandidates(program, atFork(program))
    expect(candidates).toHaveLength(1)
    expect(candidates[0].handle).toBe('go_a')
    expect(candidates[0].url).toBe('/a.mp4')
  })

  it('offers nothing at an ending', () => {
    const program = forkProgram()
    let run = atFork(program)
    run = advanceRun(program, run, 'go_end')
    expect(run.stop.kind).toBe('ending')
    expect(preloadCandidates(program, run)).toEqual([])
  })
})

describe('pickPreloadTarget', () => {
  const candidates: PreloadCandidate[] = [
    { handle: 'go_a', url: '/a.mp4', projectId: 'p', nodeId: 'a' },
    { handle: 'go_b', url: '/b.mp4', projectId: 'p', nodeId: 'b' },
  ]

  it('takes the first candidate without branch stats', () => {
    expect(pickPreloadTarget(candidates, 'fork', null)?.handle).toBe('go_a')
  })

  it('takes the most-chosen option when stats exist', () => {
    const stats: BranchStats = { fork: { go_a: 1, go_b: 9 } }
    expect(pickPreloadTarget(candidates, 'fork', stats)?.handle).toBe('go_b')
  })

  it('ignores stats for other nodes and falls back to the first', () => {
    expect(pickPreloadTarget(candidates, 'fork', { other: { go_b: 9 } })?.handle).toBe('go_a')
  })

  it('never lets a natural-playout candidate win through stats', () => {
    const withNull: PreloadCandidate[] = [{ handle: null, url: '/x.mp4', projectId: 'p', nodeId: 'x' }, ...candidates]
    expect(pickPreloadTarget(withNull, 'fork', { fork: { go_a: 5 } })?.handle).toBe('go_a')
  })

  it('returns null for an empty candidate list', () => {
    expect(pickPreloadTarget([], 'fork', { fork: { go_a: 5 } })).toBeNull()
  })
})

describe('WaitingTracker', () => {
  it('degrades after 3 waiting events inside 30s and stays degraded', () => {
    const tracker = new WaitingTracker()
    expect(tracker.note(0)).toBe(false)
    expect(tracker.note(1000)).toBe(false)
    expect(tracker.note(2000)).toBe(true)
    expect(tracker.isDegraded).toBe(true)
    expect(tracker.note(60000)).toBe(true)
  })

  it('forgets events older than the window', () => {
    const tracker = new WaitingTracker()
    expect(tracker.note(0)).toBe(false)
    expect(tracker.note(31000)).toBe(false)
    expect(tracker.note(32000)).toBe(false)
    expect(tracker.note(33000)).toBe(true)
  })

  it('reset clears the degraded state', () => {
    const tracker = new WaitingTracker()
    tracker.note(0)
    tracker.note(1)
    tracker.note(2)
    expect(tracker.isDegraded).toBe(true)
    tracker.reset()
    expect(tracker.isDegraded).toBe(false)
    expect(tracker.note(3)).toBe(false)
  })
})
