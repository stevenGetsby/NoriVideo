import { describe, expect, it } from 'vitest'
import {
  buildExportReadinessItems,
  formatExportReadinessBlocker,
  normalizeExportReadinessCardId,
} from '@/lib/novel-promotion/export-readiness'

describe('export delivery readiness', () => {
  it('blocks final video until every panel has generated video', () => {
    const items = buildExportReadinessItems({
      clips: 2,
      panels: 4,
      images: 4,
      videos: 3,
      voices: 2,
    })

    expect(items.find((item) => item.cardId === 'final-video')).toMatchObject({
      status: 'blocked',
      blockerCode: 'missingVideos',
      blockerParams: { count: 1 },
    })
    expect(items.find((item) => item.cardId === 'asset-package')).toMatchObject({
      status: 'ready',
      blockerCode: 'ready',
    })
    expect(items.find((item) => item.cardId === 'voice-package')).toMatchObject({
      status: 'ready',
      blockerCode: 'ready',
    })
    expect(items.find((item) => item.cardId === 'jianying-draft')).toMatchObject({
      status: 'available',
      blockerCode: 'manifestOnly',
    })
  })

  it('marks all queue cards blocked when there are no panels', () => {
    const items = buildExportReadinessItems({
      clips: 0,
      panels: 0,
      images: 0,
      videos: 0,
      voices: 0,
    })

    expect(items.map((item) => [item.cardId, item.status, item.blockerCode])).toEqual([
      ['final-video', 'blocked', 'noPanels'],
      ['asset-package', 'blocked', 'noImages'],
      ['voice-package', 'blocked', 'noVoices'],
      ['jianying-draft', 'blocked', 'noPanels'],
    ])
  })

  it('normalizes card ids and formats persisted blocker text', () => {
    expect(normalizeExportReadinessCardId('final-video')).toBe('final-video')
    expect(normalizeExportReadinessCardId('voice-package')).toBe('voice-package')
    expect(normalizeExportReadinessCardId('unknown')).toBeNull()
    expect(formatExportReadinessBlocker({
      blockerCode: 'missingVideos',
      blockerParams: { count: 3 },
    })).toContain('3 video shots')
  })
})
