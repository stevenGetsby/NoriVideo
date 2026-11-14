import { describe, expect, it } from 'vitest'
import {
  clearStoredProfile,
  clearStoredSaves,
  profileStorageKey,
  readStoredProfile,
  readStoredSaves,
  savesStorageKey,
  writeStoredProfile,
  writeStoredSaves,
} from '@/features/interactive/player/viewer-store'
import { permanentStorageKey, type PermanentStorage } from '@/features/interactive/player/permanent-store'
import { emptyProfile, type StoryProfile } from '@/lib/interactive/achievements'
import { advanceRun, startRun } from '@/lib/interactive/engine'
import { emptySaves, snapshotRun, withAutoSave, withCheckpoint, withManualSave, type StoryRunSnapshot } from '@/lib/interactive/saves'
import { storyProgram } from './p3-fixture'

class MemoryStorage implements PermanentStorage {
  readonly data = new Map<string, string>()
  throwOnWrite = false
  throwOnRead = false
  getItem(key: string): string | null {
    if (this.throwOnRead) throw new Error('blocked')
    return this.data.get(key) ?? null
  }
  setItem(key: string, value: string): void {
    if (this.throwOnWrite) throw new Error('quota')
    this.data.set(key, value)
  }
  removeItem(key: string): void {
    if (this.throwOnWrite) throw new Error('blocked')
    this.data.delete(key)
  }
}

const earned: StoryProfile = {
  endings: ['p:goodend'],
  segments: ['p:s1', 'p:s2'],
  achievements: ['a_good'],
  bought: ['frame'],
  equipped: { title: 'a:a_good', frame: 's:frame' },
}

const program = storyProgram({ map: { enabled: true } })
const first = startRun(program, { mode: 'story' })
const atCorner = advanceRun(program, advanceRun(program, first), 'a')
const snapshot = (run = atCorner): StoryRunSnapshot => {
  const taken = snapshotRun(run)
  if (!taken) throw new Error('expected a resumable stop')
  return taken
}

describe('storage keys', () => {
  it('are separate per record and per work', () => {
    expect(profileStorageKey('w1')).toBe('nori.story.profile.v1:w1')
    expect(savesStorageKey('w1')).toBe('nori.story.saves.v1:w1')
    expect(new Set([profileStorageKey('w1'), savesStorageKey('w1'), permanentStorageKey('w1'), profileStorageKey('w2')]).size).toBe(4)
  })
})

describe('viewer profile storage', () => {
  it('reads back what it wrote', () => {
    const storage = new MemoryStorage()
    expect(writeStoredProfile(storage, 'w', earned)).toBe(true)
    expect(readStoredProfile(storage, 'w')).toEqual(earned)
    expect(storage.data.has('nori.story.profile.v1:w')).toBe(true)
  })

  it('keeps works apart', () => {
    const storage = new MemoryStorage()
    writeStoredProfile(storage, 'a', earned)
    expect(readStoredProfile(storage, 'b')).toEqual(emptyProfile())
    writeStoredProfile(storage, 'b', { ...emptyProfile(), endings: ['q:end'] })
    expect(readStoredProfile(storage, 'a')).toEqual(earned)
    expect(readStoredProfile(storage, 'b').endings).toEqual(['q:end'])
  })

  it('does not rewrite what is already stored and does not store an empty profile for a first-time viewer', () => {
    const storage = new MemoryStorage()
    expect(writeStoredProfile(storage, 'w', emptyProfile())).toBe(false)
    expect(storage.data.size).toBe(0)
    expect(writeStoredProfile(storage, 'w', earned)).toBe(true)
    expect(writeStoredProfile(storage, 'w', { ...earned })).toBe(false)
    expect(writeStoredProfile(storage, 'w', emptyProfile())).toBe(true)
    expect(readStoredProfile(storage, 'w')).toEqual(emptyProfile())
  })

  it('reads damaged records as an empty profile', () => {
    const storage = new MemoryStorage()
    const key = profileStorageKey('w')
    for (const text of ['', '{not json', 'null', '"x"', '12', '[]', 'true']) {
      storage.data.set(key, text)
      expect(readStoredProfile(storage, 'w')).toEqual(emptyProfile())
    }
  })

  it('keeps what is usable inside a partly damaged record', () => {
    const storage = new MemoryStorage()
    storage.data.set(profileStorageKey('w'), JSON.stringify({ endings: 'x', segments: ['p:s1', 3, '', 'p:s1'], achievements: ['a_good'], bought: null, equipped: { title: 'a:a_good', frame: 5 } }))
    expect(readStoredProfile(storage, 'w')).toEqual({
      endings: [],
      segments: ['p:s1'],
      achievements: ['a_good'],
      bought: [],
      equipped: { title: 'a:a_good', frame: null },
    })
  })

  it('clears its own record only', () => {
    const storage = new MemoryStorage()
    writeStoredProfile(storage, 'w', earned)
    writeStoredSaves(storage, 'w', withAutoSave(emptySaves(), snapshot(), 1))
    expect(clearStoredProfile(storage, 'w')).toBe(true)
    expect(readStoredProfile(storage, 'w')).toEqual(emptyProfile())
    expect(readStoredSaves(storage, 'w').auto).not.toBeNull()
  })

  it('does nothing without storage or without a key', () => {
    expect(readStoredProfile(null, 'w')).toEqual(emptyProfile())
    expect(readStoredProfile(undefined, 'w')).toEqual(emptyProfile())
    expect(readStoredProfile(new MemoryStorage(), undefined)).toEqual(emptyProfile())
    expect(writeStoredProfile(null, 'w', earned)).toBe(false)
    expect(writeStoredProfile(new MemoryStorage(), undefined, earned)).toBe(false)
    expect(writeStoredProfile(new MemoryStorage(), '', earned)).toBe(false)
    expect(clearStoredProfile(null, 'w')).toBe(false)
    expect(clearStoredProfile(new MemoryStorage(), undefined)).toBe(false)
  })

  it('survives storage that refuses to read or write', () => {
    const storage = new MemoryStorage()
    writeStoredProfile(storage, 'w', earned)
    storage.throwOnRead = true
    expect(readStoredProfile(storage, 'w')).toEqual(emptyProfile())
    expect(writeStoredProfile(storage, 'w', { ...earned, endings: [] })).toBe(false)
    storage.throwOnRead = false
    storage.throwOnWrite = true
    expect(writeStoredProfile(storage, 'w', { ...earned, endings: [] })).toBe(false)
    expect(clearStoredProfile(storage, 'w')).toBe(false)
    expect(readStoredProfile(storage, 'w')).toEqual(earned)
  })
})

describe('viewer saves storage', () => {
  const saved = () => withCheckpoint(withManualSave(withAutoSave(emptySaves(), snapshot(), 100), 1, snapshot(first), 200), 'p:s2', snapshot(), 300)

  it('reads back the automatic save, the manual slots and the save point checkpoints', () => {
    const storage = new MemoryStorage()
    expect(writeStoredSaves(storage, 'w', saved())).toBe(true)
    const read = readStoredSaves(storage, 'w')
    expect(read).toEqual(saved())
    expect(read.auto?.snapshot.nodeId).toBe('s2')
    expect(read.slots.map((slot) => slot?.snapshot.nodeId ?? null)).toEqual([null, 's1', null])
    expect(Object.keys(read.checkpoints)).toEqual(['p:s2'])
  })

  it('keeps the personality counts and purchases a snapshot carries', () => {
    const storage = new MemoryStorage()
    const carrying = { ...snapshot(), purchases: { frame: 1 } }
    writeStoredSaves(storage, 'w', withAutoSave(emptySaves(), carrying, 5))
    expect(readStoredSaves(storage, 'w').auto?.snapshot).toMatchObject({ purchases: { frame: 1 }, personality: { E: 1, S: 1 } })
  })

  it('does not rewrite what is already stored and does not store empty saves for a first-time viewer', () => {
    const storage = new MemoryStorage()
    expect(writeStoredSaves(storage, 'w', emptySaves())).toBe(false)
    expect(storage.data.size).toBe(0)
    expect(writeStoredSaves(storage, 'w', saved())).toBe(true)
    expect(writeStoredSaves(storage, 'w', saved())).toBe(false)
  })

  it('reads damaged records as empty saves', () => {
    const storage = new MemoryStorage()
    const key = savesStorageKey('w')
    for (const text of ['', '{oops', 'null', '[]', '"saves"', '7']) {
      storage.data.set(key, text)
      expect(readStoredSaves(storage, 'w')).toEqual(emptySaves())
    }
  })

  it('loses only the broken slot of a partly damaged record', () => {
    const storage = new MemoryStorage()
    const good = saved()
    storage.data.set(savesStorageKey('w'), JSON.stringify({ ...good, slots: [{ savedAt: 1, snapshot: { v: 9 } }, good.slots[1], 'junk'] }))
    const read = readStoredSaves(storage, 'w')
    expect(read.slots[0]).toBeNull()
    expect(read.slots[1]).toEqual(good.slots[1])
    expect(read.slots[2]).toBeNull()
    expect(read.auto).toEqual(good.auto)
    expect(read.checkpoints).toEqual(good.checkpoints)
  })

  it('clears only its own record, then reads as empty', () => {
    const storage = new MemoryStorage()
    writeStoredSaves(storage, 'w', saved())
    writeStoredProfile(storage, 'w', earned)
    expect(clearStoredSaves(storage, 'w')).toBe(true)
    expect(readStoredSaves(storage, 'w')).toEqual(emptySaves())
    expect(readStoredProfile(storage, 'w')).toEqual(earned)
  })

  it('does nothing without storage or a key, and survives storage that refuses', () => {
    expect(readStoredSaves(null, 'w')).toEqual(emptySaves())
    expect(readStoredSaves(new MemoryStorage(), undefined)).toEqual(emptySaves())
    expect(writeStoredSaves(null, 'w', saved())).toBe(false)
    expect(writeStoredSaves(new MemoryStorage(), undefined, saved())).toBe(false)
    expect(clearStoredSaves(null, 'w')).toBe(false)
    const storage = new MemoryStorage()
    writeStoredSaves(storage, 'w', saved())
    storage.throwOnRead = true
    expect(readStoredSaves(storage, 'w')).toEqual(emptySaves())
    storage.throwOnRead = false
    storage.throwOnWrite = true
    expect(writeStoredSaves(storage, 'w', emptySaves())).toBe(false)
    expect(clearStoredSaves(storage, 'w')).toBe(false)
    expect(readStoredSaves(storage, 'w')).toEqual(saved())
  })
})
