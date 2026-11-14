import { describe, expect, it } from 'vitest'
import {
  browserPermanentStorage,
  clearPermanentValues,
  permanentStorageKey,
  readPermanentValues,
  writePermanentValues,
  type PermanentStorage,
} from '@/features/interactive/player/permanent-store'
import type { StoryVariable } from '@/lib/interactive/types'
import { variables } from './economy-fixture'

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

describe('permanent value store', () => {
  it('prefixes the storage key per work', () => {
    expect(permanentStorageKey('work-1')).toBe('nori.story.permanent.v1:work-1')
  })

  it('reads only known permanent values whose type still matches', () => {
    const storage = new MemoryStorage()
    storage.data.set(permanentStorageKey('w'), JSON.stringify({
      brave: 3,
      seen: true,
      stars: '9',
      coin: 7,
      ghost: 1,
      hp: true,
    }))
    expect(readPermanentValues(storage, 'w', variables)).toEqual({ brave: 3, seen: true })
  })

  it('ignores malformed JSON, non-object records and missing records', () => {
    const storage = new MemoryStorage()
    expect(readPermanentValues(storage, 'w', variables)).toEqual({})
    storage.data.set(permanentStorageKey('w'), '{not json')
    expect(readPermanentValues(storage, 'w', variables)).toEqual({})
    storage.data.set(permanentStorageKey('w'), '[1, 2]')
    expect(readPermanentValues(storage, 'w', variables)).toEqual({})
    storage.data.set(permanentStorageKey('w'), 'null')
    expect(readPermanentValues(storage, 'w', variables)).toEqual({})
  })

  it('reads and writes nothing without a storage or a storageKey', () => {
    const storage = new MemoryStorage()
    expect(readPermanentValues(storage, undefined, variables)).toEqual({})
    expect(readPermanentValues(null, 'w', variables)).toEqual({})
    expect(writePermanentValues(storage, undefined, variables, { brave: 2 })).toBe(false)
    expect(writePermanentValues(null, 'w', variables, { brave: 2 })).toBe(false)
    expect(storage.data.size).toBe(0)
  })

  it('writes back only permanent values and only when the record changed', () => {
    const storage = new MemoryStorage()
    expect(writePermanentValues(storage, 'w', variables, { coin: 9, key: 2, brave: 4, seen: true, stars: 2 })).toBe(true)
    expect(JSON.parse(storage.data.get(permanentStorageKey('w')) ?? 'null')).toEqual({ brave: 4, seen: true, stars: 2 })
    expect(writePermanentValues(storage, 'w', variables, { coin: 0, brave: 4, seen: true, stars: 2 })).toBe(false)
    expect(JSON.parse(storage.data.get(permanentStorageKey('w')) ?? 'null')).toEqual({ brave: 4, seen: true, stars: 2 })
  })

  it('falls back to start values for permanent variables missing from the run record', () => {
    const storage = new MemoryStorage()
    writePermanentValues(storage, 'w', variables, {})
    expect(JSON.parse(storage.data.get(permanentStorageKey('w')) ?? 'null')).toEqual({ brave: 0, seen: false, stars: 0 })
  })

  it('never writes a pointless record when no variable is permanent', () => {
    const storage = new MemoryStorage()
    const runScoped: StoryVariable[] = variables.filter((variable) => variable.scope !== 'permanent')
    expect(writePermanentValues(storage, 'w', runScoped, { coin: 3 })).toBe(false)
    expect(storage.data.size).toBe(0)
  })

  it('clears the record', () => {
    const storage = new MemoryStorage()
    writePermanentValues(storage, 'w', variables, { brave: 1 })
    expect(clearPermanentValues(storage, 'w')).toBe(true)
    expect(storage.data.has(permanentStorageKey('w'))).toBe(false)
    expect(clearPermanentValues(storage, undefined)).toBe(false)
  })

  it('survives blocked storage in private mode', () => {
    const storage = new MemoryStorage()
    storage.throwOnRead = true
    expect(readPermanentValues(storage, 'w', variables)).toEqual({})
    storage.throwOnRead = false
    storage.throwOnWrite = true
    expect(writePermanentValues(storage, 'w', variables, { brave: 1 })).toBe(false)
    expect(clearPermanentValues(storage, 'w')).toBe(false)
  })

  it('has no browser storage during SSR', () => {
    expect(browserPermanentStorage()).toBeNull()
  })
})
