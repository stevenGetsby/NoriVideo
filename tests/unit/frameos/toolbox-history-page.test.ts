import { describe, expect, it } from 'vitest'
import { formatToolboxHistoryPageLabel } from '@/components/frameos/views/toolbox-history-page'

describe('toolbox history page label', () => {
  it('shows the total page count once the server reports a total', () => {
    expect(formatToolboxHistoryPageLabel(1, 37)).toBe('第 1 / 4 页 · 共 37 条 · 每页 12 条')
    expect(formatToolboxHistoryPageLabel(3, 36)).toBe('第 3 / 3 页 · 共 36 条 · 每页 12 条')
  })

  it('keeps at least one page for an empty history and clamps a stale page number', () => {
    expect(formatToolboxHistoryPageLabel(1, 0)).toBe('第 1 / 1 页 · 共 0 条 · 每页 12 条')
    expect(formatToolboxHistoryPageLabel(5, 13)).toBe('第 2 / 2 页 · 共 13 条 · 每页 12 条')
  })

  it('falls back to the old label when the total is unavailable', () => {
    expect(formatToolboxHistoryPageLabel(2, null)).toBe('第 2 页 · 每页 12 条')
  })
})
