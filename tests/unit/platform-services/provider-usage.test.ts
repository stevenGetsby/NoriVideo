import { describe, expect, it } from 'vitest'
import { summarizeUsageRowsByProvider } from '@/lib/platform-services/provider-usage'

describe('summarizeUsageRowsByProvider', () => {
  it('aggregates calls, failures and cost per provider and service type', () => {
    const result = summarizeUsageRowsByProvider([
      { provider: 'kuaizi', serviceType: 'video', calls: 3, success: 2, failed: 1, cost: 4.5, units: 15 },
      { provider: 'kuaizi', serviceType: 'audio', calls: 2, success: 2, failed: 0, cost: 0.6, units: 20 },
      { provider: 'tgg', serviceType: 'video', calls: 1, success: 1, failed: 0, cost: 1.5, units: 5 },
      { provider: 'tgg', serviceType: 'video', calls: 1, success: 0, failed: 1, cost: 0, units: 0 },
    ])

    expect(result.map((entry) => entry.provider)).toEqual(['kuaizi', 'tgg'])
    expect(result[0]).toMatchObject({ provider: 'kuaizi', calls: 5, success: 4, failed: 1, cost: 5.1 })
    expect(result[0].byType).toEqual([
      { serviceType: 'video', calls: 3, cost: 4.5, units: 15 },
      { serviceType: 'audio', calls: 2, cost: 0.6, units: 20 },
    ])
    expect(result[1]).toMatchObject({ provider: 'tgg', calls: 2, success: 1, failed: 1, cost: 1.5 })
    expect(result[1].byType).toEqual([{ serviceType: 'video', calls: 2, cost: 1.5, units: 5 }])
  })

  it('returns an empty list for no rows and keeps zero-cost providers visible', () => {
    expect(summarizeUsageRowsByProvider([])).toEqual([])
    expect(summarizeUsageRowsByProvider([
      { provider: 'tgg', serviceType: 'video', calls: 1, success: 0, failed: 1, cost: 0, units: 0 },
    ])).toEqual([
      { provider: 'tgg', calls: 1, success: 0, failed: 1, cost: 0, byType: [{ serviceType: 'video', calls: 1, cost: 0, units: 0 }] },
    ])
  })
})
