import { describe, expect, it } from 'vitest'
import { filterByFuzzyQuery, fuzzyScore, normalizeSearchText } from '@/lib/frameos/fuzzy-match'

const options = [
  { value: 'a', label: '机甲三国 第一季' },
  { value: 'b', label: '都市奇缘' },
  { value: 'c', label: 'Neon 长安夜' },
  { value: 'd', label: '山海异闻录' },
  { value: 'e', label: '三国演义·重制版' },
]

describe('fuzzy option matching', () => {
  it('returns every option for an empty or whitespace-only query', () => {
    expect(filterByFuzzyQuery(options, '')).toEqual(options)
    expect(filterByFuzzyQuery(options, '   ')).toEqual(options)
    expect(filterByFuzzyQuery(options, '')).not.toBe(options)
  })

  it('matches substrings anywhere in the label, ignoring case, width and spaces', () => {
    expect(filterByFuzzyQuery(options, 'neon').map((item) => item.value)).toEqual(['c'])
    expect(filterByFuzzyQuery(options, 'ＮＥＯＮ').map((item) => item.value)).toEqual(['c'])
    expect(filterByFuzzyQuery(options, '第一季').map((item) => item.value)).toEqual(['a'])
    expect(filterByFuzzyQuery(options, '国 第').map((item) => item.value)).toEqual(['a'])
  })

  it('ranks prefix matches before inner matches and keeps source order on ties', () => {
    expect(filterByFuzzyQuery(options, '三国').map((item) => item.value)).toEqual(['e', 'a'])
    expect(filterByFuzzyQuery([{ label: 'xa' }, { label: 'xb' }, { label: 'ax' }], 'x').map((item) => item.label)).toEqual(['xa', 'xb', 'ax'])
  })

  it('falls back to characters that appear in order', () => {
    expect(filterByFuzzyQuery(options, '机三').map((item) => item.value)).toEqual(['a'])
    expect(filterByFuzzyQuery(options, '山录').map((item) => item.value)).toEqual(['d'])
    expect(filterByFuzzyQuery(options, '录山')).toEqual([])
  })

  it('returns nothing when no character path exists', () => {
    expect(filterByFuzzyQuery(options, 'zzz')).toEqual([])
    expect(fuzzyScore('都市奇缘', '长安')).toBeNull()
  })

  it('normalizes consistently', () => {
    expect(normalizeSearchText(' Ａ b\tＣ ')).toBe('abc')
  })
})
