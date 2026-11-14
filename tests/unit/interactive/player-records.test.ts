import { describe, expect, it } from 'vitest'
import {
  ACHIEVEMENT_TOAST_MS,
  autoSaveFor,
  checkpointFor,
  enqueueToasts,
  hasRewardShopItems,
  hasStoredRecords,
  recordsEnabled,
  recordsStorageKey,
  saveTimeText,
} from '@/features/interactive/player/records'
import { profileStorageKey, savesStorageKey, writeStoredProfile, writeStoredSaves } from '@/features/interactive/player/viewer-store'
import { type PermanentStorage } from '@/features/interactive/player/permanent-store'
import { emptyProfile } from '@/lib/interactive/achievements'
import { advanceRun, startRun } from '@/lib/interactive/engine'
import { emptySaves, snapshotRun, withCheckpoint, withManualSave } from '@/lib/interactive/saves'
import type { StoryShop } from '@/lib/interactive/types'
import { achievements, storyProgram } from './p3-fixture'

class MemoryStorage implements PermanentStorage {
  readonly data = new Map<string, string>()
  getItem(key: string): string | null { return this.data.get(key) ?? null }
  setItem(key: string, value: string): void { this.data.set(key, value) }
  removeItem(key: string): void { this.data.delete(key) }
}

const rewardShop: StoryShop = {
  enabled: true,
  currencyVariableId: 'coin',
  items: [
    { id: 'plain', name: '安慰', icon: null, description: '', price: 0, limit: 0, effects: [] },
    { id: 'frame', name: '金框', icon: null, description: '', price: 0, limit: 1, effects: [], reward: { title: '', frameUrl: '/gold.png' } },
  ],
}

const mapProgram = storyProgram({ map: { enabled: true }, achievements })
const first = startRun(mapProgram, { mode: 'story' })
const atChoice = advanceRun(mapProgram, first)
const atCorner = advanceRun(mapProgram, atChoice, 'a')
const atEnding = advanceRun(mapProgram, atCorner)

describe('records enabled', () => {
  it('leaves an old work (no achievements, no map, no shop reward) on the plain player', () => {
    expect(recordsEnabled(storyProgram())).toBe(false)
    expect(hasRewardShopItems(storyProgram())).toBe(false)
    expect(recordsEnabled(storyProgram({ shop: { enabled: true, currencyVariableId: 'coin', items: [rewardShop.items[0]] } }))).toBe(false)
  })

  it('turns on for achievements, a map with saves, or a shop reward', () => {
    expect(recordsEnabled(storyProgram({ achievements }))).toBe(true)
    expect(recordsEnabled(storyProgram({ map: { enabled: true } }))).toBe(true)
    expect(recordsEnabled(storyProgram({ map: { enabled: false } }))).toBe(false)
    expect(recordsEnabled(storyProgram({ shop: rewardShop }))).toBe(true)
    expect(hasRewardShopItems(storyProgram({ shop: rewardShop }))).toBe(true)
  })
})

describe('records storage scope', () => {
  it('uses the plain key for the full story and a chapter-scoped key for a one-chapter trial', () => {
    expect(recordsStorageKey('w1', 'story', 'p')).toBe('w1')
    expect(recordsStorageKey('w1', 'chapter', 'p')).toBe('w1:chapter:p')
    expect(recordsStorageKey('w1', 'chapter', 'q')).toBe('w1:chapter:q')
    expect(recordsStorageKey(undefined, 'story', 'p')).toBeUndefined()
    expect(recordsStorageKey('', 'chapter', 'p')).toBeUndefined()
  })

  it('knows whether either record of the scope already exists', () => {
    const storage = new MemoryStorage()
    expect(hasStoredRecords(storage, 'w')).toBe(false)
    writeStoredProfile(storage, 'w', emptyProfile())
    expect(hasStoredRecords(storage, 'w')).toBe(false)
    storage.setItem(profileStorageKey('w'), JSON.stringify(emptyProfile()))
    expect(hasStoredRecords(storage, 'w')).toBe(true)
    storage.removeItem(profileStorageKey('w'))
    storage.setItem(savesStorageKey('w'), JSON.stringify(emptySaves()))
    expect(hasStoredRecords(storage, 'w')).toBe(true)
    expect(hasStoredRecords(null, 'w')).toBe(false)
    expect(hasStoredRecords(storage, undefined)).toBe(false)
  })
})

describe('automatic save', () => {
  it('follows the run onto a new resumable stop and keeps the saved values', () => {
    const saved = autoSaveFor(emptySaves(), mapProgram, first, 100)
    expect(saved.auto?.savedAt).toBe(100)
    expect(saved.auto?.snapshot).toMatchObject({ nodeId: 's1', projectId: 'p', mode: 'story', vars: { coin: 0 } })
    expect(saved.auto?.snapshot.trail.at(-1)?.nodeId).toBe('s1')
  })

  it('returns the same object when there is nothing new: same stop, an ending, or the map off', () => {
    const saved = autoSaveFor(emptySaves(), mapProgram, first, 100)
    expect(autoSaveFor(saved, mapProgram, first, 200)).toBe(saved)
    expect(autoSaveFor(saved, mapProgram, atEnding, 200)).toBe(saved)
    expect(autoSaveFor(saved, storyProgram({ achievements }), atCorner, 200)).toBe(saved)
    expect(autoSaveFor(emptySaves(), storyProgram({ achievements }), first, 100)).toEqual(emptySaves())
  })

  it('saves again when the stop itself changed (a purchase or a beat moved a value)', () => {
    const saved = autoSaveFor(emptySaves(), mapProgram, atCorner, 100)
    expect(saved.auto?.snapshot.vars.coin).toBe(1)
    const changed = { ...atCorner, vars: { ...atCorner.vars, coin: 4 } }
    const next = autoSaveFor(saved, mapProgram, changed, 300)
    expect(next).not.toBe(saved)
    expect(next.auto?.snapshot.vars.coin).toBe(4)
    expect(next.auto?.savedAt).toBe(300)
  })
})

describe('save-point checkpoints', () => {
  it('remembers the entry state of a save-point segment', () => {
    const saves = checkpointFor(emptySaves(), mapProgram, first, 500)
    expect(saves.checkpoints['p:s1']?.savedAt).toBe(500)
    expect(saves.checkpoints['p:s1']?.snapshot).toMatchObject({ nodeId: 's1', vars: { coin: 0 } })
  })

  it('does nothing on a normal segment, at a choice, or with the map off', () => {
    const saves = emptySaves()
    expect(checkpointFor(saves, mapProgram, atChoice, 1)).toBe(saves)
    expect(checkpointFor(saves, storyProgram({ achievements }), first, 1)).toBe(saves)
    expect(checkpointFor(saves, mapProgram, atEnding, 1)).toBe(saves)
  })

  it('keeps the same object when the checkpoint is unchanged', () => {
    const saves = checkpointFor(emptySaves(), mapProgram, first, 500)
    expect(checkpointFor(saves, mapProgram, first, 900)).toBe(saves)
  })

  it('never applies a segment effect when recording it', () => {
    const saves = checkpointFor(emptySaves(), mapProgram, atCorner, 500)
    expect(saves.checkpoints['p:s2']?.snapshot.vars.coin).toBe(1)
    expect(saves.checkpoints['p:s2']?.snapshot.nodeId).toBe('s2')
  })
})

describe('toast queue', () => {
  const toastA = { id: 'a', name: '甲' } as never
  const toastB = { id: 'b', name: '乙' } as never

  it('appends each earned achievement once, with unique ids, and leaves an empty batch alone', () => {
    const queue = enqueueToasts([], [toastA], 0)
    expect(queue.map((item) => item.id)).toEqual([0])
    const two = enqueueToasts(queue, [toastA, toastB], 1)
    expect(two.map((item) => item.id)).toEqual([0, 1, 2])
    expect(two.map((item) => item.achievement.name)).toEqual(['甲', '甲', '乙'])
    expect(enqueueToasts(two, [], 5)).toBe(two)
    expect(ACHIEVEMENT_TOAST_MS).toBe(3000)
  })
})

describe('misc helpers', () => {
  it('formats a save time and hides a missing one', () => {
    expect(saveTimeText(0)).toBe('')
    expect(saveTimeText(Number.NaN)).toBe('')
    expect(saveTimeText(new Date(2026, 10, 13, 3, 20).getTime())).toBe('2026/11/13 03:20')
  })

  it('can snapshot and re-snapshot a corner save without value drift', () => {
    const snapshot = snapshotRun(atCorner)
    expect(snapshot?.vars.coin).toBe(1)
    expect(withCheckpoint(withManualSave(emptySaves(), 0, snapshot!, 1), 'p:s2', snapshot!, 1).slots[0]?.snapshot.vars.coin).toBe(1)
  })
})
