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

const transactionsRows: Array<Record<string, unknown>> = []
const prismaMock = vi.hoisted(() => ({
  task: { findMany: vi.fn(async () => []) },
  user: { findMany: vi.fn(async (args: { where?: { id?: string } }) => args.where?.id === 'child'
    ? [{ id: 'child', name: '分镜师', role: 'storyboard_artist', roleLabel: '分镜师' }]
    : [
    { id: 'owner', name: '蓝喵', role: 'manager', roleLabel: '管理账号' },
    { id: 'child', name: '分镜师', role: 'storyboard_artist', roleLabel: '分镜师' },
  ]) },
  project: { findMany: vi.fn(async (args: { select?: { work?: unknown } }) => args.select?.work
    ? [{ id: 'project-1', name: '海外短剧', workId: 'work-1', work: { id: 'work-1', name: '短剧作品' } }]
    : [{ id: 'project-1', name: '海外短剧' }]) },
  serviceUsageRecordRows: [
    { id: 1, userId: 'owner', projectId: 'project-1', modelKey: 'nori::nori-gpt', serviceType: 'text', operation: 'story_to_script_run', status: 'success', inputTokens: 20, outputTokens: 10, units: 30, createdAt: new Date('2026-07-24T08:00:00.000Z') },
    { id: 2, userId: 'child', projectId: 'project-1', modelKey: 'nori::nori-gpt', serviceType: 'text', operation: 'script_to_storyboard_run', status: 'success', inputTokens: 40, outputTokens: 30, units: 70, createdAt: new Date('2026-07-24T08:00:00.000Z') },
  ],
  serviceUsageRecord: { findMany: vi.fn(async () => [
    { id: 1, userId: 'owner', projectId: 'project-1', modelKey: 'nori::nori-gpt', serviceType: 'text', operation: 'story_to_script_run', status: 'success', inputTokens: 20, outputTokens: 10, units: 30, createdAt: new Date('2026-07-24T08:00:00.000Z') },
    { id: 2, userId: 'child', projectId: 'project-1', modelKey: 'nori::nori-gpt', serviceType: 'text', operation: 'script_to_storyboard_run', status: 'success', inputTokens: 40, outputTokens: 30, units: 70, createdAt: new Date('2026-07-24T08:00:00.000Z') },
  ]) },
  usageCost: { findMany: vi.fn(async (args: { where?: { OR?: Array<{ userId?: string; metadata?: { contains?: string } }>; AND?: Array<unknown>; userId?: string | { in?: string[] } } }) => {
    if (args.where?.OR) {
      const direct = args.where.OR.find((clause) => clause.userId && !clause.metadata)?.userId
      const managerTag = args.where.OR.find((clause) => clause.metadata)?.metadata?.contains
      return usageRows.filter((row) => row.userId === direct || (row.userId === 'owner' && row.metadata.includes(managerTag || '')))
    }
    if (args.where?.AND) {
      const scope = args.where.AND[0] as { OR?: Array<{ userId?: string; metadata?: { contains?: string } }> }
      const direct = scope.OR?.find((clause) => clause.userId && !clause.metadata)?.userId
      const managerTag = scope.OR?.find((clause) => clause.metadata)?.metadata?.contains
      return usageRows.filter((row) => row.userId === direct || (row.userId === 'owner' && row.metadata.includes(managerTag || '')))
    }
    return typeof args.where?.userId === 'string' ? usageRows.filter((row) => row.userId === args.where?.userId) : usageRows
  }) },
  balanceTransaction: {
    findMany: vi.fn(async (args: { where?: { OR?: Array<{ userId?: string; billingMeta?: { contains?: string }; description?: { contains?: string } }> } }) => {
      if (!args.where?.OR) return []
      const direct = args.where.OR.find((clause) => clause.userId && !clause.billingMeta && !clause.description)?.userId
      const tag = args.where.OR.find((clause) => clause.billingMeta)?.billingMeta?.contains
      const counterpartTag = args.where.OR.find((clause) => clause.description)?.description?.contains
      return transactionsRows.filter((row) => row.userId === direct || (row.userId === 'owner' && (String(row.billingMeta).includes(tag || '') || String(row.description).includes(counterpartTag || ''))))
    }),
    aggregate: vi.fn(async () => ({ _sum: { amount: -2.1 } })),
  },
  novelPromotionEpisode: { findMany: vi.fn(async () => []) },
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/billing', () => ({ getBalance: vi.fn(async () => ({ balance: 100, frozenAmount: 0, totalSpent: 0 })) }))
vi.mock('@/lib/billing/reporting', () => ({ getVisibleUserTotalSpent: vi.fn(async () => 3) }))
vi.mock('@/lib/model-pricing/catalog', () => ({ listBuiltinPricingCatalog: () => [] }))
vi.mock('@/lib/model-pricing/version', () => ({ BUILTIN_PRICING_VERSION: 'test' }))

import { buildServiceRecordsOverview } from '@/lib/workspace/service-records'

describe('filterable team service report', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    transactionsRows.length = 0
  })

  it('uses each management and child account exact billing bucket', async () => {
    const report = (await buildServiceRecordsOverview('owner')).report

    expect(report.options.accounts).toEqual([
      { id: 'owner', name: '蓝喵', role: '管理账号' },
      { id: 'child', name: '分镜师', role: '分镜师' },
    ])
    expect(prismaMock.serviceUsageRecord.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: { in: ['owner', 'child'] }, createdAt: { gte: expect.any(Date) } },
    }))
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

  it('shows a member only their own usage and manager-paid history', async () => {
    transactionsRows.push(
      {
        id: 'tx-manager-paid', userId: 'owner', type: 'consume', amount: -0.1, balanceAfter: 99.9,
        description: 'image_generation - test', relatedId: 'freeze-old', freezeId: 'freeze-old',
        operatorId: null, externalOrderId: null, idempotencyKey: null, projectId: 'project-1',
        episodeId: null, taskType: 'image_generation',
        billingMeta: JSON.stringify({ quotaUserId: 'child' }), createdAt: now,
      },
      {
        id: 'tx-other', userId: 'other', type: 'consume', amount: -0.2, balanceAfter: 50,
        description: null, relatedId: null, freezeId: null, operatorId: null,
        externalOrderId: null, idempotencyKey: null, projectId: null, episodeId: null,
        taskType: null, billingMeta: null, createdAt: now,
      },
    )
    prismaMock.serviceUsageRecord.findMany.mockResolvedValue([prismaMock.serviceUsageRecordRows[1]])
    const overview = await buildServiceRecordsOverview('owner', { actorId: 'child' })

    expect(prismaMock.usageCost.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { OR: [
        { userId: 'child' },
        { userId: 'owner', metadata: { contains: '"quotaUserId":"child"' } },
      ] },
    }))
    expect(prismaMock.balanceTransaction.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { OR: [
        { userId: 'child' },
        { userId: 'owner', type: 'consume', billingMeta: { contains: '"quotaUserId":"child"' } },
        { userId: 'owner', type: { in: ['allocate_out', 'allocate_in'] }, description: { contains: '"counterpartId":"child"' } },
      ] },
    }))
    expect(prismaMock.balanceTransaction.aggregate).toHaveBeenCalledWith({
      where: { AND: [expect.objectContaining({ OR: expect.any(Array) }), { type: 'consume' }] },
      _sum: { amount: true },
    })
    expect(prismaMock.serviceUsageRecord.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 'child', createdAt: { gte: expect.any(Date) } },
    }))
    expect(overview.report.options.accounts).toEqual([{ id: 'child', name: '分镜师', role: '分镜师' }])
    expect(overview.report.records.map((row) => row.id)).toEqual(['2'])
    expect(overview.report.records[0]).toMatchObject({ accountId: 'child', accountName: '分镜师' })
    expect(overview.transactions).toEqual([expect.objectContaining({
      id: 'tx-manager-paid', paidBy: 'manager', balanceAfter: null,
    })])
    expect(overview.balance.totalSpent).toBe(2.1)
  })
})
