import { describe, expect, it } from 'vitest'
import {
  ATTR_TTL_MS,
  attrValid,
  buildAttribution,
  parseScene,
  resolveAttribution,
  sourceOf,
  type Attribution,
} from '../../../miniprogram/miniprogram/lib/attribution'

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
