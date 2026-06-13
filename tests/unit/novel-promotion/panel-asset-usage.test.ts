import { describe, expect, it } from 'vitest'
import {
  clearPanelAssetUsageConfirmation,
  getPanelAssetUsage,
  readPanelAssetUsageConfirmation,
  writePanelAssetUsageConfirmation,
} from '@/lib/novel-promotion/panel-asset-usage'

describe('panel asset usage helpers', () => {
  it('parses character, location, and prop usage from panel fields', () => {
    const usage = getPanelAssetUsage({
      characters: JSON.stringify([
        { name: '主角', appearance: '初始形象' },
        { name: '旁白' },
      ]),
      location: '直播间',
      props: JSON.stringify(['帆布包', { name: '手机支架' }]),
    })

    expect(usage.characters).toEqual([
      { name: '主角', appearance: '初始形象', slot: undefined },
      { name: '旁白', appearance: undefined, slot: undefined },
    ])
    expect(usage.locations).toEqual(['直播间'])
    expect(usage.props).toEqual(['帆布包', '手机支架'])
  })

  it('writes and reads confirmation metadata without dropping acting notes', () => {
    const actingNotes = JSON.stringify({
      characters: [{ name: '主角', acting: '自然口播' }],
    })

    const confirmedNotes = writePanelAssetUsageConfirmation(actingNotes, true)
    const parsed = JSON.parse(confirmedNotes ?? '{}')

    expect(parsed.characters).toEqual([{ name: '主角', acting: '自然口播' }])
    expect(readPanelAssetUsageConfirmation(confirmedNotes).confirmed).toBe(true)
    expect(readPanelAssetUsageConfirmation(confirmedNotes).confirmedAt).toEqual(expect.any(String))
  })

  it('clears confirmation metadata when asset usage changes', () => {
    const confirmedNotes = writePanelAssetUsageConfirmation(null, true)
    const clearedNotes = clearPanelAssetUsageConfirmation(confirmedNotes)

    expect(clearedNotes).toBeNull()
    expect(readPanelAssetUsageConfirmation(clearedNotes).confirmed).toBe(false)
  })
})
