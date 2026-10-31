import { beforeEach, describe, expect, it, vi } from 'vitest'

const now = new Date('2026-07-24T08:00:00.000Z')
const usageRows = [
  {
    id: 'cost-owner', userId: 'owner', projectId: 'project-1', apiType: 'text', model: 'nori::nori-gpt',
    action: 'story_to_script_run', quantity: 30, unit: 'token', cost: 1,
    metadata: JSON.stringify({ inputTokens: 20, outputTokens: 10 }), createdAt: now,
  },
  {
    id: 'cost-child', userId: 'owner', projectId: 'project-1', apiType: 'text', model: 'nori::nori-gpt',
    action: 'script_to_storyboard_run', quantity: 70, unit: 'token', cost: 2,
    metadata: JSON.stringify({ inputTokens: 40, outputTokens: 30, quotaUserId: 'child' }), createdAt: now,
  },
]

const prismaMock = vi.hoisted(() => ({
  task: { findMany: vi.fn(async () => []) },
  user: { findMany: vi.fn(async () => [
    { id: 'owner', name: '蓝喵', role: 'manager', roleLabel: '管理账号' },
    { id: 'child', name: '分镜师', role: 'storyboard_artist', roleLabel: '分镜师' },
  ]) },
  project: { findMany: vi.fn(async (args: { select?: { work?: unknown } }) => args.select?.work
    ? [{ id: 'project-1', name: '海外短剧', workId: 'work-1', work: { id: 'work-1', name: '短剧作品' } }]
    : [{ id: 'project-1', name: '海外短剧' }]) },
  serviceUsageRecord: { findMany: vi.fn(async () => [
    { id: 1, userId: 'owner', projectId: 'project-1', modelKey: 'nori::nori-gpt', serviceType: 'text', operation: 'story_to_script_run', status: 'success', inputTokens: 20, outputTokens: 10, units: 30, createdAt: new Date('2026-07-24T08:00:00.000Z') },
    { id: 2, userId: 'child', projectId: 'project-1', modelKey: 'nori::nori-gpt', serviceType: 'text', operation: 'script_to_storyboard_run', status: 'success', inputTokens: 40, outputTokens: 30, units: 70, createdAt: new Date('2026-07-24T08:00:00.000Z') },
  ]) },
  usageCost: { findMany: vi.fn(async (args: { where?: { userId?: string | { in?: string[] } } }) => typeof args.where?.userId === 'string' ? usageRows.filter((row) => row.userId === args.where?.userId) : usageRows) },
  balanceTransaction: { findMany: vi.fn(async () => []) },
  novelPromotionEpisode: { findMany: vi.fn(async () => []) },
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/billing', () => ({ getBalance: vi.fn(async () => ({ balance: 100, frozenAmount: 0, totalSpent: 0 })) }))
vi.mock('@/lib/billing/reporting', () => ({ getVisibleUserTotalSpent: vi.fn(async () => 3) }))
vi.mock('@/lib/model-pricing/catalog', () => ({ listBuiltinPricingCatalog: () => [] }))
vi.mock('@/lib/model-pricing/version', () => ({ BUILTIN_PRICING_VERSION: 'test' }))

import { buildServiceRecordsOverview } from '@/lib/workspace/service-records'

describe('filterable team service report', () => {
  beforeEach(() => vi.clearAllMocks())

  it('uses each management and child account exact billing bucket', async () => {
    const report = (await buildServiceRecordsOverview('owner')).report

    expect(report.options.accounts).toEqual([
      { id: 'owner', name: '蓝喵', role: '管理账号' },
      { id: 'child', name: '分镜师', role: '分镜师' },
    ])
    expect(report.records).toHaveLength(2)
    expect(report.records.find((row) => row.accountId === 'owner')).toMatchObject({
      inputTokens: 20,
      outputTokens: 10,
      cost: 1,
      points: 100,
    })
    expect(report.records.find((row) => row.accountId === 'child')).toMatchObject({
      inputTokens: 40,
      outputTokens: 30,
      cost: 2,
      points: 200,
    })
  })
})
