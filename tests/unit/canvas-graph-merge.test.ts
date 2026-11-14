import { describe, expect, it } from 'vitest'
import { selectServerOnlyEntities } from '@/features/canvas/graph-merge'

const ids = (...values: string[]) => new Set(values)

describe('selectServerOnlyEntities', () => {
  it('does not restore a locally deleted entity from a stale response', () => {
    const tombstones = new Map([['deleted', 100]])
    expect(selectServerOnlyEntities({ serverIds: ids('deleted'), localIds: ids(), tombstones, now: 1000 })).toEqual([])
    expect(tombstones.has('deleted')).toBe(true)
  })

  it('clears confirmed deletions and expired tombstones', () => {
    const tombstones = new Map([['confirmed', 100], ['expired', 100]])
    expect(selectServerOnlyEntities({ serverIds: ids('expired'), localIds: ids(), tombstones, now: 601_000 })).toEqual(['expired'])
    expect(tombstones.size).toBe(0)
  })

  it('clears a tombstone when an undo restores the local entity', () => {
    const tombstones = new Map([['restored', 100]])
    expect(selectServerOnlyEntities({ serverIds: ids('restored'), localIds: ids('restored'), tombstones, now: 1000 })).toEqual([])
    expect(tombstones.size).toBe(0)
  })

  it('keeps additions from another session', () => {
    expect(selectServerOnlyEntities({ serverIds: ids('new'), localIds: ids(), tombstones: new Map(), now: 1000 })).toEqual(['new'])
  })
})
