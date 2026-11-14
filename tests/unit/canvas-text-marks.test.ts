import { describe, expect, it } from 'vitest'
import { clearMarks, marksEqual, normalizeMarks, rebaseMarks, setHighlight, splitByMarks, toggleBold } from '@/features/canvas/text-marks'

describe('text marks', () => {
  it('normalizes bounds, merges neighbors and caps segments', () => {
    expect(normalizeMarks([{ start: 1, end: 2, bold: true }, { start: 2, end: 4, bold: true }, { start: -3, end: 0, highlight: 'blue' }, { start: 2, end: 99, highlight: 'pink' }], 4)).toEqual([{ start: 1, end: 2, bold: true }, { start: 2, end: 4, highlight: 'pink' }])
    expect(normalizeMarks(Array.from({ length: 205 }, (_, i) => ({ start: i * 2, end: i * 2 + 1, bold: true })), 410)).toHaveLength(200)
  })
  it('toggles bold over partially marked text and preserves highlights', () => {
    const marks = [{ start: 0, end: 5, bold: true as const, highlight: 'yellow' as const }, { start: 5, end: 10, highlight: 'yellow' as const }]
    expect(toggleBold(marks, 0, 10)).toEqual([{ start: 0, end: 10, bold: true, highlight: 'yellow' }])
    expect(toggleBold(toggleBold(marks, 0, 10), 0, 10)).toEqual([{ start: 0, end: 10, highlight: 'yellow' }])
  })
  it('toggles and clears partial highlights', () => {
    const marked = setHighlight([], 0, 5, 'yellow')
    expect(setHighlight(marked, 0, 5, 'yellow')).toEqual([])
    expect(setHighlight(marked, 0, 5, 'blue')).toEqual([{ start: 0, end: 5, highlight: 'blue' }])
    expect(clearMarks(marked, 1, 3)).toEqual([{ start: 0, end: 1, highlight: 'yellow' }, { start: 3, end: 5, highlight: 'yellow' }])
  })
  it('rebases insertion and deletion across boundaries', () => {
    const mark = [{ start: 6, end: 11, bold: true as const }]
    expect(rebaseMarks(mark, 'hello world', 'hello world!')).toEqual(mark)
    expect(rebaseMarks(mark, 'hello world', 'hello worxld')).toEqual([{ start: 6, end: 12, bold: true }])
    expect(rebaseMarks(mark, 'hello world', 'hi hello world')).toEqual([{ start: 9, end: 14, bold: true }])
    expect(rebaseMarks(mark, 'hello world', 'hello  world')).toEqual([{ start: 7, end: 12, bold: true }])
    expect(rebaseMarks(mark, 'hello world', 'held')).toEqual([{ start: 3, end: 4, bold: true }])
    expect(rebaseMarks(mark, 'hello world', '')).toEqual([])
  })
  it('uses UTF-16 offsets for Chinese and emoji', () => {
    expect(rebaseMarks([{ start: 3, end: 5, bold: true }], '你好😀世界', '你好😀世界!')).toEqual([{ start: 3, end: 5, bold: true }])
    expect(splitByMarks('你好😀世界', [{ start: 4, end: 6, bold: true }])[1].text).toBe('世界')
  })
  it('compares normalized styles', () => expect(marksEqual([{ start: 0, end: 1, bold: true }], [{ start: 0, end: 1, bold: true }])).toBe(true))
})
