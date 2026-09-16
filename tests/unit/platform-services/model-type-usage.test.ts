import { describe, expect, it } from 'vitest'
import {
  buildModelUsageByAccount,
  emptyModelUsageSummary,
  formatUsageMoney,
  mergeModelUsageSummaries,
  normalizeModelUsageType,
  summarizeUsageRowsByType,
} from '@/lib/platform-services/model-type-usage'

describe('model type usage amounts', () => {
  it('maps billing and telemetry types onto text/image/video/audio', () => {
    expect(normalizeModelUsageType('llm')).toBe('text')
    expect(normalizeModelUsageType('text')).toBe('text')
    expect(normalizeModelUsageType('video-repaint')).toBe('text')
    expect(normalizeModelUsageType('image')).toBe('image')
    expect(normalizeModelUsageType('video')).toBe('video')
    expect(normalizeModelUsageType('voice-design')).toBe('audio')
    expect(normalizeModelUsageType('lip-sync')).toBe('audio')
    expect(normalizeModelUsageType('storage')).toBeNull()
  })

  it('aggregates billed amounts by account and model type instead of a token total', () => {
    const usage = buildModelUsageByAccount([
      { userId: 'manager', apiType: 'text', cost: 1.25, createdAt: '2026-08-01T00:00:00.000Z' },
      { userId: 'manager', apiType: 'video', cost: 12.5, createdAt: '2026-08-02T00:00:00.000Z' },
      { userId: 'child', apiType: 'image', cost: 3, createdAt: '2026-08-03T00:00:00.000Z' },
      { userId: 'child', apiType: 'voice', cost: 0.4, createdAt: '2026-08-04T00:00:00.000Z' },
      { userId: 'child', apiType: 'text', action: 'NORI_AGENT_run', cost: 99, createdAt: '2026-08-05T00:00:00.000Z' },
    ])

    const workspace = mergeModelUsageSummaries([
      usage.get('manager') || emptyModelUsageSummary(),
      usage.get('child') || emptyModelUsageSummary(),
    ])

    expect(workspace.byType.map((row) => [row.type, row.cost, row.calls])).toEqual([
      ['text', 1.25, 1],
      ['image', 3, 1],
      ['video', 12.5, 1],
      ['audio', 0.4, 1],
    ])
    expect(workspace.cost).toBe(17.15)
    expect(formatUsageMoney(workspace.byType[2].cost)).toBe('¥12.50')
  })

  it('summarizes service telemetry by model type amount', () => {
    const summary = summarizeUsageRowsByType([
      { serviceType: 'llm', calls: 4, cost: 0.8 },
      { serviceType: 'image', calls: 2, cost: 6 },
      { serviceType: 'video', calls: 1, cost: 18.25 },
      { serviceType: 'storage', calls: 3, cost: 1 },
    ])

    expect(summary.byType.find((row) => row.type === 'text')?.cost).toBe(0.8)
    expect(summary.byType.find((row) => row.type === 'image')?.cost).toBe(6)
    expect(summary.byType.find((row) => row.type === 'video')?.cost).toBe(18.25)
    expect(summary.byType.find((row) => row.type === 'audio')?.cost).toBe(0)
    expect(summary.cost).toBe(25.05)
  })
})
