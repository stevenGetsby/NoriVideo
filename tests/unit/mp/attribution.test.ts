import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  mpChannel: { findUnique: vi.fn() },
  mpShare: { findUnique: vi.fn(), update: vi.fn() },
  mpWork: { findUnique: vi.fn() },
}))
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

import {
  ATTR_TTL_MS,
  attrValid,
  buildAttribution,
  parseScene,
  resolveAttribution,
  sourceOf,
  type Attribution,
} from '../../../miniprogram/miniprogram/lib/attribution'
import {
  parseScene as serverParseScene,
  resolveFirstTouch,
  resolveLaunch,
  sourceOf as serverSourceOf,
} from '@/lib/mp/attribution'

describe('sourceOf scene table (H.5)', () => {
  const table: Array<[string, number[]]> = [
    ['share', [1007, 1008, 1036, 1044]],
    ['qrcode', [1011, 1012, 1013, 1047, 1048, 1049]],
    ['timeline', [1154, 1155]],
    ['subscribe', [1014]],
    ['official_account', [1035, 1043, 1058, 1074]],
    ['channels', [1175, 1176, 1177, 1184, 1191]],
    ['url_link', [1065, 1194]],
    ['search', [1005, 1006, 1027, 1042, 1053]],
    ['recent', [1001, 1089, 1104]],
  ]
  for (const [source, scenes] of table) {
    it(`maps ${source} scenes`, () => {
      for (const scene of scenes) expect(sourceOf(scene, {})).toBe(source)
    })
  }

  it('falls back to other for unknown, null and undefined scene', () => {
    expect(sourceOf(9999, {})).toBe('other')
    expect(sourceOf(null, {})).toBe('other')
    expect(sourceOf(undefined, {})).toBe('other')
  })

  it('prefers query.c channel over query.s and scene', () => {
    expect(sourceOf(1007, { c: 'ch1', s: 'sh1' })).toBe('channel')
    expect(sourceOf(undefined, { c: 'ch1' })).toBe('channel')
  })

  it('prefers query.s share over scene', () => {
    expect(sourceOf(1001, { s: 'sh1' })).toBe('share')
    expect(sourceOf(undefined, { s: 'sh1' })).toBe('share')
  })
})

describe('parseScene', () => {
  it('decodes and keeps only c/s/w/t with non-empty values', () => {
    expect(parseScene('c=ch1&s=sh1&w=wk1&t=tp1&x=ignore')).toEqual({ c: 'ch1', s: 'sh1', w: 'wk1', t: 'tp1' })
  })

  it('url-decodes values', () => {
    expect(parseScene(encodeURIComponent('w=蓝喵&c=a b'))).toEqual({ w: '蓝喵', c: 'a b' })
  })

  it('drops empty values, malformed pairs and unknown keys', () => {
    expect(parseScene('c=&s=sh1&=novalue&bad&x=1&w=wk1')).toEqual({ s: 'sh1', w: 'wk1' })
  })

  it('returns empty object for null/undefined/empty and survives bad encoding', () => {
    expect(parseScene(undefined)).toEqual({})
    expect(parseScene(null)).toEqual({})
    expect(parseScene('')).toEqual({})
    expect(parseScene('%E0%A4%A')).toEqual({})
  })
})

describe('buildAttribution', () => {
  it('stamps source and at, carrying c/s/w when present', () => {
    const now = 1_700_000_000_000
    expect(buildAttribution(1007, { s: 'sh1', w: 'wk1' }, now)).toEqual({ source: 'share', s: 'sh1', w: 'wk1', at: now })
    expect(buildAttribution(undefined, { c: 'ch1' }, now)).toEqual({ source: 'channel', c: 'ch1', at: now })
    expect(buildAttribution(9999, {}, now)).toEqual({ source: 'other', at: now })
  })
})

describe('attrValid', () => {
  const base: Attribution = { source: 'share', at: 1000 }
  it('accepts within window and rejects missing/expired/future', () => {
    expect(attrValid(base, 1000)).toBe(true)
    expect(attrValid(base, 1000 + ATTR_TTL_MS - 1)).toBe(true)
    expect(attrValid(base, 1000 + ATTR_TTL_MS)).toBe(false)
    expect(attrValid(base, 999)).toBe(false)
    expect(attrValid(null, 1000)).toBe(false)
    expect(attrValid(undefined, 1000)).toBe(false)
  })
})

describe('resolveAttribution write-once within 30min', () => {
  const now = 1_700_000_000_000
  const prev: Attribution = { source: 'channel', c: 'first', at: now - 60_000 }
  const incoming: Attribution = { source: 'share', s: 'second', at: now }

  it('keeps first touch while still valid', () => {
    expect(resolveAttribution(prev, incoming, now)).toBe(prev)
  })

  it('replaces when prev expired', () => {
    expect(resolveAttribution(prev, incoming, prev.at + ATTR_TTL_MS)).toBe(incoming)
  })

  it('replaces when prev missing', () => {
    expect(resolveAttribution(null, incoming, now)).toBe(incoming)
    expect(resolveAttribution(undefined, incoming, now)).toBe(incoming)
  })
})

describe('server launch attribution (H.5 first touch)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.mpChannel.findUnique.mockResolvedValue(null)
    prismaMock.mpShare.findUnique.mockResolvedValue(null)
    prismaMock.mpShare.update.mockResolvedValue({})
    prismaMock.mpWork.findUnique.mockResolvedValue(null)
  })

  it('resolveLaunch buckets scene and parses compound query.scene', () => {
    expect(resolveLaunch(null)).toEqual({ source: 'other', c: null, s: null, w: null })
    expect(resolveLaunch({ scene: 1001 })).toEqual({ source: 'recent', c: null, s: null, w: null })
    expect(resolveLaunch({ scene: 1011, query: { scene: 'c%3Dabc234%26w%3Dabcd1234' } })).toEqual({ source: 'channel', c: 'abc234', s: null, w: 'abcd1234' })
    expect(resolveLaunch({ scene: 1007, query: { s: 'Ab3dEf9hIj', w: 'abcd1234' } })).toEqual({ source: 'share', c: null, s: 'Ab3dEf9hIj', w: 'abcd1234' })
  })

  it('direct query keys win over the encoded scene and channel wins over share', () => {
    expect(resolveLaunch({ query: { c: 'abc234', scene: 'c=zzz999' } }).c).toBe('abc234')
    expect(resolveLaunch({ scene: 1007, query: { c: 'abc234', s: 'Ab3dEf9hIj' } }).source).toBe('channel')
  })

  it('ignores non-string query values and accepts numeric-string scenes', () => {
    expect(resolveLaunch({ scene: 'abc', query: { c: 5, s: null } })).toEqual({ source: 'other', c: null, s: null, w: null })
    expect(resolveLaunch({ scene: '1007' }).source).toBe('share')
  })

  it('mirrors the client scene table and parseScene', () => {
    const scenes = [1007, 1008, 1036, 1044, 1011, 1012, 1013, 1047, 1048, 1049, 1154, 1155, 1014, 1035, 1043, 1058, 1074, 1175, 1176, 1177, 1184, 1191, 1065, 1194, 1005, 1006, 1027, 1042, 1053, 1001, 1089, 1104, 9999]
    for (const scene of scenes) expect(serverSourceOf(scene, {})).toBe(sourceOf(scene, {}))
    expect(serverParseScene('c=abc234&w=abcd1234')).toEqual(parseScene('c=abc234&w=abcd1234'))
  })

  it('writes firstChannelId only for a well-formed code that exists', async () => {
    prismaMock.mpChannel.findUnique.mockResolvedValue({ id: 'ch1' })
    const touch = await resolveFirstTouch({ source: 'channel', c: 'abc234', s: null, w: null })
    expect(prismaMock.mpChannel.findUnique).toHaveBeenCalledWith({ where: { code: 'abc234' }, select: { id: true } })
    expect(touch.firstChannelId).toBe('ch1')
    expect(await resolveFirstTouch({ source: 'channel', c: 'ABC234', s: null, w: null })).toEqual({ firstChannelId: null, firstShareId: null, firstMpWorkId: null })
    expect(prismaMock.mpChannel.findUnique).toHaveBeenCalledTimes(1)
  })

  it('counts a new user on the share only when the shareId exists', async () => {
    prismaMock.mpShare.findUnique.mockResolvedValue({ id: 'Ab3dEf9hIj' })
    const touch = await resolveFirstTouch({ source: 'share', c: null, s: 'Ab3dEf9hIj', w: null })
    expect(touch.firstShareId).toBe('Ab3dEf9hIj')
    expect(prismaMock.mpShare.update).toHaveBeenCalledWith({ where: { id: 'Ab3dEf9hIj' }, data: { newUsers: { increment: 1 } } })
    prismaMock.mpShare.findUnique.mockResolvedValue(null)
    expect((await resolveFirstTouch({ source: 'share', c: null, s: 'Ab3dEf9hIj', w: null })).firstShareId).toBeNull()
    expect(prismaMock.mpShare.update).toHaveBeenCalledTimes(1)
  })

  it('writes firstMpWorkId from a valid slug only', async () => {
    prismaMock.mpWork.findUnique.mockResolvedValue({ id: 'mpw1' })
    const touch = await resolveFirstTouch({ source: 'share', c: null, s: null, w: 'abcd1234' })
    expect(touch.firstMpWorkId).toBe('mpw1')
    expect((await resolveFirstTouch({ source: 'other', c: null, s: null, w: 'short' })).firstMpWorkId).toBeNull()
  })

  it('never blocks login when lookups or the increment fail', async () => {
    prismaMock.mpChannel.findUnique.mockRejectedValue(new Error('db down'))
    prismaMock.mpShare.findUnique.mockResolvedValue({ id: 'Ab3dEf9hIj' })
    prismaMock.mpShare.update.mockRejectedValue(new Error('db down'))
    prismaMock.mpWork.findUnique.mockRejectedValue(new Error('db down'))
    const touch = await resolveFirstTouch({ source: 'channel', c: 'abc234', s: 'Ab3dEf9hIj', w: 'abcd1234' })
    expect(touch).toEqual({ firstChannelId: null, firstShareId: 'Ab3dEf9hIj', firstMpWorkId: null })
  })
})
