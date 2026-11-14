import { describe, expect, it } from 'vitest'
import { compileChapter, type CanvasEdgeLike, type CanvasNodeLike } from '@/lib/interactive/compile'
import { advanceRun, startRun, type StoryRun } from '@/lib/interactive/engine'
import {
  STORY_CHECKPOINT_LIMIT,
  STORY_SAVE_SLOTS,
  emptySaves,
  observeCheckpoint,
  readSaves,
  readSnapshot,
  restoreRun,
  savesEnabled,
  snapshotLabel,
  snapshotRun,
  storyMap,
  withAutoSave,
  withCheckpoint,
  withManualSave,
  withoutManualSave,
  type StoryRunSnapshot,
} from '@/lib/interactive/saves'
import type { StoryProgram, StoryVariable } from '@/lib/interactive/types'
import { beat, ending, entry, flow, mount, scene } from './economy-fixture'
import { choiceNode, option, savePoint, storyProgram } from './p3-fixture'

const program = storyProgram({ map: { enabled: true } })

/** The run stops of "s1 → pick → s2 → goodend". */
function playA(): StoryRun[] {
  const first = startRun(program, { mode: 'story' })
  const atPick = advanceRun(program, first)
  const atCorner = advanceRun(program, atPick, 'a')
  const atEnd = advanceRun(program, atCorner)
  return [first, atPick, atCorner, atEnd]
}

const snapshotAt = (run: StoryRun): StoryRunSnapshot => {
  const snapshot = snapshotRun(run)
  if (!snapshot) throw new Error('expected a resumable stop')
  return snapshot
}

describe('taking a snapshot', () => {
  it('records where the run is, with a copy of its values and trail', () => {
    const [, atPick, atCorner] = playA()
    const snapshot = snapshotAt(atCorner)
    expect(snapshot).toMatchObject({ v: 1, mode: 'story', projectId: 'p', nodeId: 's2', vars: { coin: 1 } })
    expect(snapshot.trail.map((step) => step.nodeId)).toEqual(['in', 's1', 'pick', 's2'])
    expect(snapshot.vars).not.toBe(atCorner.vars)
    expect(snapshot.trail[0]).not.toBe(atCorner.trail[0])
    expect(snapshot.personality).toEqual({ E: 1, S: 1 })
    expect('purchases' in snapshot).toBe(false)
    const early = snapshotAt(atPick)
    expect('purchases' in early || 'personality' in early).toBe(false)
  })

  it('carries purchases and personality only when there are some', () => {
    const [, , atCorner] = playA()
    const snapshot = snapshotAt({ ...atCorner, purchases: { sword: 1 }, personality: { E: 2, S: 1 } })
    expect(snapshot.purchases).toEqual({ sword: 1 })
    expect(snapshot.personality).toEqual({ E: 2, S: 1 })
    expect('purchases' in snapshotAt({ ...atCorner, purchases: {}, personality: {} })).toBe(false)
  })

  it('can be taken at a scene, a choice or an interaction, and nowhere else', () => {
    const [first, atPick, , atEnd] = playA()
    expect(snapshotRun(first)).not.toBeNull()
    expect(snapshotRun(atPick)).not.toBeNull()
    expect(snapshotRun(atEnd)).toBeNull()
    const halted = startRun({ ...program, start: null }, { mode: 'story' })
    expect(halted.stop.kind).toBe('halt')
    expect(snapshotRun(halted)).toBeNull()
  })

  it('keeps only the most recent steps of a very long trail', () => {
    const [, , atCorner] = playA()
    const step = atCorner.trail[0]
    const trail = Array.from({ length: 120 }, (_, index) => ({ ...step, nodeId: `n${index}` }))
    const snapshot = snapshotAt({ ...atCorner, trail })
    expect(snapshot.trail).toHaveLength(40)
    expect(snapshot.trail[39].nodeId).toBe('n119')
    expect(snapshot.trail[0].nodeId).toBe('n80')
  })

  it('survives a trip through JSON unchanged', () => {
    const [, , atCorner] = playA()
    const snapshot = snapshotAt({ ...atCorner, personality: { I: 1 }, purchases: { sword: 2 } })
    expect(readSnapshot(JSON.parse(JSON.stringify(snapshot)))).toEqual(snapshot)
  })
})

describe('reading a stored snapshot', () => {
  const good = () => snapshotAt(playA()[2])

  it('rejects anything that is not a snapshot of this version', () => {
    for (const raw of [null, undefined, 'x', 3, [], {}, { ...good(), v: 2 }, { ...good(), mode: 'both' }, { ...good(), projectId: '' }, { ...good(), nodeId: 5 }]) {
      expect(readSnapshot(raw)).toBeNull()
    }
  })

  it('drops bad values, bad trail steps and bad counts but keeps the rest', () => {
    const snapshot = readSnapshot({
      ...good(),
      vars: { coin: 2, flag: true, junk: 'x', nan: Number.NaN, nested: { a: 1 } },
      trail: [{ projectId: 'p', nodeId: 'a', kind: 'scene', title: '甲', choice: '选了' }, { projectId: 'p', nodeId: 'b', kind: 'wizard', title: '?' }, 'x', null, { projectId: 'p', kind: 'scene' }],
      purchases: { sword: 2.9, bad: -1, zero: 0, text: 'x' },
      personality: { E: 3.7, I: 0, Q: 5, T: -2, S: 'x' },
    })
    expect(snapshot?.vars).toEqual({ coin: 2, flag: true })
    expect(snapshot?.trail).toEqual([{ projectId: 'p', nodeId: 'a', kind: 'scene', title: '甲', choice: '选了' }])
    expect(snapshot?.purchases).toEqual({ sword: 2 })
    expect(snapshot?.personality).toEqual({ E: 3 })
  })

  it('omits purchases and personality that came out empty', () => {
    const snapshot = readSnapshot({ ...good(), purchases: { a: 0 }, personality: { Q: 1 } })
    expect(snapshot && ('purchases' in snapshot || 'personality' in snapshot)).toBe(false)
  })

  it('keeps long titles within bounds', () => {
    const long = 'x'.repeat(500)
    const snapshot = readSnapshot({ ...good(), trail: [{ projectId: 'p', nodeId: 'a', kind: 'scene', title: long, choice: long }] })
    expect(snapshot?.trail[0].title).toHaveLength(80)
    expect(snapshot?.trail[0].choice).toHaveLength(80)
  })
})

describe('loading a snapshot', () => {
  it('puts the viewer back at the stop without applying that segment\'s value effects again', () => {
    const [, , atCorner] = playA()
    expect(atCorner.vars.coin).toBe(1)
    const restored = restoreRun(program, snapshotAt(atCorner))
    expect(restored?.stop.kind).toBe('scene')
    expect(restored?.stop.kind === 'scene' && restored.stop.node.id).toBe('s2')
    expect(restored?.vars.coin).toBe(1)
    expect(restored?.trail.map((step) => step.nodeId)).toEqual(['in', 's1', 'pick', 's2'])
    const onward = restored ? advanceRun(program, restored) : null
    expect(onward?.stop.kind).toBe('ending')
    expect(onward?.vars.coin).toBe(1)
  })

  it('resumes a choice with the letters scored so far', () => {
    const [, atPick] = playA()
    const snapshot = snapshotAt({ ...atPick, personality: { E: 2 } })
    const restored = restoreRun(program, snapshot)
    expect(restored?.stop.kind).toBe('choice')
    expect(restored?.personality).toEqual({ E: 2 })
    const picked = restored ? advanceRun(program, restored, 'a') : null
    expect(picked?.personality).toEqual({ E: 3, S: 1 })
  })

  it('resumes with purchases already made', () => {
    const [first] = playA()
    const restored = restoreRun(program, snapshotAt({ ...first, purchases: { sword: 1 } }))
    expect(restored?.purchases).toEqual({ sword: 1 })
  })

  it('takes permanent values from the viewer\'s current ones, never from the old save', () => {
    const variables: StoryVariable[] = [
      { id: 'coin', name: '金币', type: 'number', initial: 0 },
      { id: 'brave', name: '勇气', type: 'number', initial: 0, scope: 'permanent' },
    ]
    const withBrave = storyProgram({ variables })
    const run = startRun(withBrave, { mode: 'story', permanent: { brave: 1 } })
    const snapshot = snapshotAt(run)
    expect(snapshot.vars).toMatchObject({ brave: 1, coin: 0 })
    const restored = restoreRun(withBrave, { ...snapshot, vars: { ...snapshot.vars, coin: 7 } }, { permanent: { brave: 5, coin: 99 } })
    expect(restored?.vars).toEqual({ coin: 7, brave: 5 })
    expect(restoreRun(withBrave, snapshot)?.vars).toEqual({ coin: 0, brave: 1 })
  })

  it('drops values the story no longer has and fills in new ones', () => {
    const variables: StoryVariable[] = [{ id: 'coin', name: '金币', type: 'number', initial: 0 }, { id: 'fresh', name: '新值', type: 'number', initial: 3 }]
    const edited = storyProgram({ variables })
    const restored = restoreRun(edited, { ...snapshotAt(playA()[2]), vars: { coin: 1, retired: 9 } })
    expect(restored?.vars).toEqual({ coin: 1, fresh: 3 })
  })

  it('gives up when the stop is gone or cannot be resumed', () => {
    const snapshot = snapshotAt(playA()[2])
    expect(restoreRun(program, { ...snapshot, nodeId: 'deleted' })).toBeNull()
    expect(restoreRun(program, { ...snapshot, projectId: 'other' })).toBeNull()
    expect(restoreRun(program, { ...snapshot, nodeId: 'goodend' })).toBeNull()
    expect(restoreRun(program, { ...snapshot, nodeId: 'in' })).toBeNull()
  })

  it('does not share the snapshot\'s objects with the run it builds', () => {
    const snapshot = snapshotAt({ ...playA()[2], purchases: { a: 1 }, personality: { E: 1 } })
    const restored = restoreRun(program, snapshot)
    expect(restored?.trail[0]).not.toBe(snapshot.trail[0])
    expect(restored?.purchases).not.toBe(snapshot.purchases)
    expect(restored?.personality).not.toBe(snapshot.personality)
  })
})

describe('naming a save', () => {
  it('uses the save point\'s name for a segment and the title for anything else', () => {
    const [, atPick, atCorner] = playA()
    expect(snapshotLabel(program, snapshotAt(atCorner))).toEqual({ chapter: '第一章', node: '街角' })
    expect(snapshotLabel(program, snapshotAt(atPick))).toEqual({ chapter: '第一章', node: 'pick' })
    expect(snapshotLabel(program, { ...snapshotAt(atPick), nodeId: 'deleted' })).toBeNull()
    expect(snapshotLabel(program, { ...snapshotAt(atPick), projectId: 'gone' })).toBeNull()
  })
})

describe('save slots', () => {
  const at = snapshotAt(playA()[2])
  const earlier = snapshotAt(playA()[0])

  it('starts empty with three manual slots', () => {
    const saves = emptySaves()
    expect(saves).toEqual({ auto: null, slots: [null, null, null], checkpoints: {} })
    expect(STORY_SAVE_SLOTS).toBe(3)
  })

  it('keeps the automatic save apart from the manual ones', () => {
    const saves = withAutoSave(emptySaves(), at, 100)
    expect(saves.auto).toEqual({ savedAt: 100, snapshot: at })
    expect(saves.slots).toEqual([null, null, null])
    expect(withAutoSave(saves, earlier, 200).auto?.snapshot).toBe(earlier)
  })

  it('fills one manual slot and leaves the others, without changing the old object', () => {
    const base = emptySaves()
    const saved = withManualSave(base, 1, at, 5)
    expect(saved.slots).toEqual([null, { savedAt: 5, snapshot: at }, null])
    expect(base.slots).toEqual([null, null, null])
    expect(withManualSave(saved, 1, earlier, 6).slots[1]?.snapshot).toBe(earlier)
  })

  it('ignores a slot that does not exist', () => {
    const base = emptySaves()
    for (const index of [-1, 3, 1.5, Number.NaN, 99]) expect(withManualSave(base, index, at, 1)).toBe(base)
  })

  it('clears a slot, and leaves an empty one alone', () => {
    const saved = withManualSave(emptySaves(), 0, at, 5)
    expect(withoutManualSave(saved, 0).slots[0]).toBeNull()
    expect(withoutManualSave(saved, 2)).toBe(saved)
    expect(withoutManualSave(saved, 7)).toBe(saved)
  })

  it('keeps the latest state at each save point and only the most recent few', () => {
    let saves = withCheckpoint(emptySaves(), 'p:s1', earlier, 1)
    saves = withCheckpoint(saves, 'p:s2', at, 2)
    expect(Object.keys(saves.checkpoints).sort()).toEqual(['p:s1', 'p:s2'])
    saves = withCheckpoint(saves, 'p:s1', at, 3)
    expect(saves.checkpoints['p:s1']).toEqual({ savedAt: 3, snapshot: at })
    let crowded = emptySaves()
    for (let index = 0; index < STORY_CHECKPOINT_LIMIT + 5; index += 1) crowded = withCheckpoint(crowded, `p:${index}`, at, index)
    expect(Object.keys(crowded.checkpoints)).toHaveLength(STORY_CHECKPOINT_LIMIT)
    expect(crowded.checkpoints['p:0']).toBeUndefined()
    expect(crowded.checkpoints[`p:${STORY_CHECKPOINT_LIMIT + 4}`]).toBeDefined()
  })

  it('reads stored saves leniently: a broken slot is empty and the rest survives', () => {
    const stored = JSON.parse(JSON.stringify(withManualSave(withAutoSave(withCheckpoint(emptySaves(), 'p:s2', at, 4), at, 9), 2, earlier, 7)))
    expect(readSaves(stored)).toEqual(withManualSave(withAutoSave(withCheckpoint(emptySaves(), 'p:s2', at, 4), at, 9), 2, earlier, 7))
    for (const raw of [null, undefined, 'x', 3, [], {}]) expect(readSaves(raw)).toEqual(emptySaves())
    const damaged = readSaves({
      auto: { savedAt: 'later', snapshot: at },
      slots: [{ savedAt: 1, snapshot: { v: 9 } }, 'x', { savedAt: 3, snapshot: at }, { savedAt: 4, snapshot: at }, { savedAt: 5, snapshot: at }],
      checkpoints: { 'p:s1': { savedAt: 2, snapshot: 'bad' }, 'p:s2': { savedAt: 3, snapshot: at } },
    })
    expect(damaged.auto?.savedAt).toBe(0)
    expect(damaged.slots).toHaveLength(3)
    expect(damaged.slots.map((slot) => slot?.savedAt ?? null)).toEqual([null, null, 3])
    expect(Object.keys(damaged.checkpoints)).toEqual(['p:s2'])
    expect(readSaves({ slots: [] }).slots).toEqual([null, null, null])
  })
})

describe('remembering a save point', () => {
  const [first, atPick, atCorner, atEnd] = playA()

  it('is off until the creator turns the map on', () => {
    expect(savesEnabled(program)).toBe(true)
    expect(savesEnabled(storyProgram())).toBe(false)
    expect(savesEnabled(storyProgram({ map: { enabled: false } }))).toBe(false)
    const saves = emptySaves()
    expect(observeCheckpoint(storyProgram(), saves, first, 1)).toBe(saves)
  })

  it('records the state each time the run enters a save point', () => {
    let saves = observeCheckpoint(program, emptySaves(), first, 1)
    expect(saves.checkpoints['p:s1']?.snapshot.nodeId).toBe('s1')
    saves = observeCheckpoint(program, saves, atCorner, 2)
    expect(saves.checkpoints['p:s2']).toEqual({ savedAt: 2, snapshot: snapshotAt(atCorner) })
    expect(saves.checkpoints['p:s2']?.snapshot.vars.coin).toBe(1)
  })

  it('leaves the saves alone anywhere that is not a save point', () => {
    const saves = emptySaves()
    expect(observeCheckpoint(program, saves, atPick, 1)).toBe(saves)
    expect(observeCheckpoint(program, saves, atEnd, 1)).toBe(saves)
    const plain = storyProgram({ map: { enabled: true } })
    const noPoints: StoryProgram = {
      ...plain,
      chapters: [compileChapter({ projectId: 'p', title: '章' }, [entry, scene('only'), ending('end')], [flow('1', 'in', 'only'), flow('2', 'only', 'end')])],
    }
    expect(observeCheckpoint(noPoints, saves, startRun(noPoints, { mode: 'story' }), 1)).toBe(saves)
  })
})

describe('the map of save points', () => {
  const chain = (nodes: CanvasNodeLike[], edges: CanvasEdgeLike[], extra: Partial<StoryProgram> = {}): StoryProgram => ({
    variables: [],
    chapters: [compileChapter({ projectId: 'p', title: '一' }, nodes, edges)],
    links: [],
    start: { projectId: 'p', entryNodeId: 'in' },
    map: { enabled: true },
    ...extra,
  })

  it('lists the save points in story order with their name, cover and rank', () => {
    const view = storyMap(program, { segments: [] })
    expect(view.points.map((point) => [point.key, point.name, point.coverUrl, point.chapterTitle, point.rank, point.unlocked, point.current]))
      .toEqual([['p:s1', '雨夜', '/rain.png', '第一章', 0, false, false], ['p:s2', '街角', null, '第一章', 1, false, false]])
    expect(view.routes).toEqual([{ from: 'p:s1', to: 'p:s2', lit: false }])
  })

  it('unlocks the points the viewer has reached and lights a route when both ends are unlocked', () => {
    expect(storyMap(program, { segments: ['p:s1'] }).points.map((point) => point.unlocked)).toEqual([true, false])
    expect(storyMap(program, { segments: ['p:s1'] }).routes[0].lit).toBe(false)
    expect(storyMap(program, { segments: ['p:s2'] }).routes[0].lit).toBe(false)
    const both = storyMap(program, { segments: ['p:s1', 'p:s2'] })
    expect(both.routes[0].lit).toBe(true)
    expect(both.points.every((point) => point.unlocked)).toBe(true)
  })

  it('marks the save point the viewer passed most recently in this play', () => {
    const [first, , atCorner] = playA()
    expect(storyMap(program, { segments: [] }, first).points.map((point) => point.current)).toEqual([true, false])
    expect(storyMap(program, { segments: [] }, atCorner).points.map((point) => point.current)).toEqual([false, true])
    expect(storyMap(program, { segments: [] }).points.some((point) => point.current)).toBe(false)
  })

  it('follows an exit into the next chapter', () => {
    const left = compileChapter({ projectId: 'p', title: '上' }, [entry, scene('a', { savePoint: savePoint('甲') }), { id: 'out', type: 'story_exit', data: { title: '出口' } }], [flow('1', 'in', 'a'), flow('2', 'a', 'out')])
    const right = compileChapter({ projectId: 'q', title: '下' }, [{ id: 'qin', type: 'story_entry', data: {} }, scene('b', { savePoint: savePoint('乙') }), ending('end')], [flow('3', 'qin', 'b'), flow('4', 'b', 'end')])
    const joined: StoryProgram = {
      variables: [],
      chapters: [left, right],
      links: [{ id: 'l', fromProjectId: 'p', exitNodeId: 'out', toProjectId: 'q', toEntryNodeId: 'qin' }],
      start: { projectId: 'p', entryNodeId: 'in' },
      map: { enabled: true },
    }
    const view = storyMap(joined, { segments: ['p:a', 'q:b'] })
    expect(view.points.map((point) => [point.key, point.rank, point.chapterTitle])).toEqual([['p:a', 0, '上'], ['q:b', 1, '下']])
    expect(view.routes).toEqual([{ from: 'p:a', to: 'q:b', lit: true }])
  })

  it('follows the results of an interaction mounted on a segment', () => {
    const nodes = [
      entry,
      scene('m', { savePoint: savePoint('开场'), videoDurationSec: 10 }),
      beat('mb', { interaction: 'choice', startSec: 1, durationSec: 3, options: [option('o1', '去', []), option('o2', '留', [])] }),
      scene('n', { savePoint: savePoint('岔路') }),
      ending('end'),
    ]
    const edges = [flow('1', 'in', 'm'), mount('2', 'm', 'mb'), flow('3', 'mb', 'n', 'o1'), flow('4', 'm', 'end'), flow('5', 'n', 'end')]
    const view = storyMap(chain(nodes, edges), { segments: [] })
    expect(view.routes).toEqual([{ from: 'p:m', to: 'p:n', lit: false }])
    expect(view.points.map((point) => point.rank)).toEqual([0, 1])
  })

  it('routes through plain segments and choices to the next save point, never through another one', () => {
    const nodes = [
      entry,
      scene('a', { savePoint: savePoint('甲') }),
      scene('plain'),
      choiceNode('pick', [option('x', '一'), option('y', '二')]),
      scene('b', { savePoint: savePoint('乙') }),
      scene('c', { savePoint: savePoint('丙') }),
      ending('end'),
    ]
    const edges = [flow('1', 'in', 'a'), flow('2', 'a', 'plain'), flow('3', 'plain', 'pick'), flow('4', 'pick', 'b', 'x'), flow('5', 'pick', 'c', 'y'), flow('6', 'b', 'c'), flow('7', 'c', 'end')]
    const view = storyMap(chain(nodes, edges), { segments: [] })
    expect(view.routes.map((route) => `${route.from}>${route.to}`)).toEqual(['p:a>p:b', 'p:a>p:c', 'p:b>p:c'])
    expect(Object.fromEntries(view.points.map((point) => [point.nodeId, point.rank]))).toEqual({ a: 0, b: 1, c: 2 })
  })

  it('survives a loop between save points', () => {
    const nodes = [entry, scene('a', { savePoint: savePoint('甲') }), scene('b', { savePoint: savePoint('乙') }), ending('end')]
    const edges = [flow('1', 'in', 'a'), flow('2', 'a', 'b'), flow('3', 'b', 'a')]
    const view = storyMap(chain(nodes, edges), { segments: [] })
    expect(view.routes.map((route) => `${route.from}>${route.to}`).sort()).toEqual(['p:a>p:b', 'p:b>p:a'])
    expect(view.points.map((point) => point.rank)).toEqual([0, 1])
  })

  it('still lists a save point the story cannot reach from its start', () => {
    const nodes = [entry, scene('a', { savePoint: savePoint('甲') }), scene('lost', { savePoint: savePoint('失落') }), ending('end')]
    const edges = [flow('1', 'in', 'a'), flow('2', 'a', 'end'), flow('3', 'lost', 'end')]
    const view = storyMap(chain(nodes, edges), { segments: [] })
    expect(view.points.map((point) => point.nodeId)).toEqual(['a', 'lost'])
    expect(view.points.map((point) => point.rank)).toEqual([0, 0])
    expect(view.routes).toEqual([])
    expect(storyMap(chain(nodes, edges, { start: null }), { segments: [] }).points.map((point) => point.nodeId)).toEqual(['a', 'lost'])
  })

  it('names a save point after its segment when the creator left the name blank, and is empty without any', () => {
    const nodes = [entry, scene('a', { title: '雨中', savePoint: savePoint('') }), ending('end')]
    expect(storyMap(chain(nodes, [flow('1', 'in', 'a'), flow('2', 'a', 'end')]), { segments: [] }).points[0].name).toBe('雨中')
    const plain = chain([entry, scene('a'), ending('end')], [flow('1', 'in', 'a'), flow('2', 'a', 'end')])
    expect(storyMap(plain, { segments: [] })).toEqual({ points: [], routes: [] })
  })
})
