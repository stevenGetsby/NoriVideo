import { describe, expect, it } from 'vitest'
import { STORY_CHECKPOINT_LIMIT, STORY_SAVE_SLOTS, type StorySaveSlot } from '@/lib/interactive/saves'
import { mergeSaveState, normalizeSaveState } from '@/lib/mp/save-merge'

function slot(savedAt: number, nodeId = 'n1'): StorySaveSlot {
  return { savedAt, snapshot: { v: 1, mode: 'story', projectId: 'p1', nodeId, vars: {}, trail: [] } }
}

function state(overrides: { profile?: unknown; saves?: unknown; permanent?: unknown } = {}) {
  return { profile: {}, saves: {}, permanent: {}, ...overrides }
}

describe('mergeSaveState profile (F.7)', () => {
  it('unions lists keeping server order first and appending client-only items', () => {
    const merged = mergeSaveState(
      state({ profile: { endings: ['p1:a', 'p1:b'], segments: ['p1:s1'], achievements: ['a1'], bought: ['b1'] } }),
      state({ profile: { endings: ['p1:b', 'p1:c'], segments: ['p1:s2', 'p1:s1'], achievements: ['a2', 'a1'], bought: ['b2'] } }),
    )
    expect(merged.profile.endings).toEqual(['p1:a', 'p1:b', 'p1:c'])
    expect(merged.profile.segments).toEqual(['p1:s1', 'p1:s2'])
    expect(merged.profile.achievements).toEqual(['a1', 'a2'])
    expect(merged.profile.bought).toEqual(['b1', 'b2'])
  })

  it('takes equipped from the client', () => {
    const merged = mergeSaveState(
      state({ profile: { equipped: { title: 'server', frame: 'server' } } }),
      state({ profile: { equipped: { title: 'client', frame: null } } }),
    )
    expect(merged.profile.equipped).toEqual({ title: 'client', frame: null })
  })
})

describe('mergeSaveState saves (F.7)', () => {
  it('keeps the newer auto save by savedAt, server wins ties', () => {
    expect(mergeSaveState(state({ saves: { auto: slot(100) } }), state({ saves: { auto: slot(200) } })).saves.auto?.savedAt).toBe(200)
    expect(mergeSaveState(state({ saves: { auto: slot(300) } }), state({ saves: { auto: slot(200) } })).saves.auto?.savedAt).toBe(300)
    expect(mergeSaveState(state({ saves: { auto: slot(200, 'server') } }), state({ saves: { auto: slot(200, 'client') } })).saves.auto?.snapshot.nodeId).toBe('server')
  })

  it('resolves each manual slot to the newer side, or the non-null side', () => {
    const server = { auto: null, slots: [slot(100, 's0'), null, slot(100, 's2')], checkpoints: {} }
    const client = { auto: null, slots: [slot(200, 'c0'), slot(50, 'c1'), null], checkpoints: {} }
    const merged = mergeSaveState(state({ saves: server }), state({ saves: client }))
    expect(merged.saves.slots).toHaveLength(STORY_SAVE_SLOTS)
    expect(merged.saves.slots[0]?.snapshot.nodeId).toBe('c0')
    expect(merged.saves.slots[1]?.snapshot.nodeId).toBe('c1')
    expect(merged.saves.slots[2]?.snapshot.nodeId).toBe('s2')
  })

  it('unions checkpoints by key taking the newer, and caps to the newest by savedAt', () => {
    const merged = mergeSaveState(
      state({ saves: { checkpoints: { k1: slot(100), k2: slot(50) } } }),
      state({ saves: { checkpoints: { k2: slot(80), k3: slot(200) } } }),
    )
    expect(merged.saves.checkpoints.k1.savedAt).toBe(100)
    expect(merged.saves.checkpoints.k2.savedAt).toBe(80)
    expect(merged.saves.checkpoints.k3.savedAt).toBe(200)

    const serverCheckpoints: Record<string, StorySaveSlot> = {}
    const clientCheckpoints: Record<string, StorySaveSlot> = {}
    for (let i = 0; i < 30; i += 1) serverCheckpoints[`s${i}`] = slot(i + 1)
    for (let i = 0; i < 30; i += 1) clientCheckpoints[`c${i}`] = slot(31 + i)
    const capped = mergeSaveState(state({ saves: { checkpoints: serverCheckpoints } }), state({ saves: { checkpoints: clientCheckpoints } }))
    expect(Object.keys(capped.saves.checkpoints)).toHaveLength(STORY_CHECKPOINT_LIMIT)
    expect(capped.saves.checkpoints.s0).toBeUndefined()
    expect(capped.saves.checkpoints.s20.savedAt).toBe(21)
    expect(capped.saves.checkpoints.c29.savedAt).toBe(60)
  })
})

describe('mergeSaveState permanent (F.7)', () => {
  it('takes max for numbers, OR for booleans, client for strings, and keeps server-only keys', () => {
    const merged = mergeSaveState(
      state({ permanent: { n: 5, b: false, s: 'old', onlyServer: 1, flag: true } }),
      state({ permanent: { n: 3, b: true, s: 'new', onlyClient: 2, flag: false } }),
    )
    expect(merged.permanent).toEqual({ n: 5, b: true, s: 'new', onlyServer: 1, onlyClient: 2, flag: true })
  })
})

describe('normalizeSaveState leniency', () => {
  it('reads malformed inputs as empty engine state', () => {
    const normalized = normalizeSaveState({ profile: 'broken', saves: 42, permanent: [] })
    expect(normalized.profile.endings).toEqual([])
    expect(normalized.saves.slots).toHaveLength(STORY_SAVE_SLOTS)
    expect(normalized.saves.auto).toBeNull()
    expect(normalized.permanent).toEqual({})
  })

  it('merging two empty states yields empty state', () => {
    const merged = mergeSaveState({}, {})
    expect(merged.profile.equipped).toEqual({ title: null, frame: null })
    expect(merged.saves.checkpoints).toEqual({})
    expect(merged.permanent).toEqual({})
  })
})
