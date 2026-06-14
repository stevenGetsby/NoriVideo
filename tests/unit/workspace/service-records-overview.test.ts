import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  task: {
    findMany: vi.fn(),
  },
  usageCost: {
    findMany: vi.fn<(...args: unknown[]) => Promise<Array<Record<string, unknown>>>>(async () => []),
  },
  project: {
    findMany: vi.fn<(...args: unknown[]) => Promise<Array<Record<string, unknown>>>>(async () => []),
  },
  balanceTransaction: {
    findMany: vi.fn<(...args: unknown[]) => Promise<Array<Record<string, unknown>>>>(async () => []),
  },
  novelPromotionEpisode: {
    findMany: vi.fn<(...args: unknown[]) => Promise<Array<Record<string, unknown>>>>(async () => []),
  },
}))

vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}))

vi.mock('@/lib/billing', () => ({
  getBalance: vi.fn(async () => ({
    balance: 100,
    frozenAmount: 0,
    totalSpent: 0,
  })),
  getUserCostSummary: vi.fn(async () => ({
    total: 0,
    byProject: [],
  })),
}))

vi.mock('@/lib/model-pricing/catalog', () => ({
  listBuiltinPricingCatalog: () => [
    {
      provider: 'test',
      apiType: 'text',
      pricing: { mode: 'flat', flatAmount: 1 },
    },
  ],
}))

vi.mock('@/lib/model-pricing/version', () => ({
  BUILTIN_PRICING_VERSION: 'test-pricing',
}))

import { buildServiceRecordsOverview } from '@/lib/workspace/service-records'

function taskRow(input: {
  id: string
  type: string
  targetType?: string
  status?: string
  createdAt: string
}) {
  const createdAt = new Date(input.createdAt)
  return {
    id: input.id,
    userId: 'user-1',
    projectId: 'project-1',
    episodeId: null,
    type: input.type,
    targetType: input.targetType ?? 'project',
    targetId: 'target-1',
    status: input.status ?? 'completed',
    progress: 100,
    errorCode: null,
    errorMessage: null,
    queuedAt: createdAt,
    startedAt: null,
    finishedAt: createdAt,
    heartbeatAt: null,
    enqueuedAt: null,
    createdAt,
    updatedAt: createdAt,
  }
}

describe('service records overview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.usageCost.findMany.mockResolvedValue([])
    prismaMock.balanceTransaction.findMany.mockResolvedValue([])
    prismaMock.project.findMany.mockResolvedValue([])
    prismaMock.novelPromotionEpisode.findMany.mockResolvedValue([])
  })

  it('overfetches task rows before filtering internal agent tasks', async () => {
    const rows = [
      ...Array.from({ length: 12 }, (_, index) => taskRow({
        id: `internal-${index}`,
        type: 'super_agent_internal',
        createdAt: `2026-06-13T10:${String(index).padStart(2, '0')}:00.000Z`,
      })),
      taskRow({ id: 'visible-video', type: 'video_panel', createdAt: '2026-06-13T09:00:00.000Z' }),
      taskRow({ id: 'visible-image', type: 'image_panel', createdAt: '2026-06-13T08:00:00.000Z' }),
      taskRow({ id: 'visible-text', type: 'script_analysis', createdAt: '2026-06-13T07:00:00.000Z' }),
    ]
    prismaMock.task.findMany.mockImplementation(async ({ take }: { take: number }) => rows.slice(0, take))
    prismaMock.usageCost.findMany.mockResolvedValue([
      {
        id: 'usage-internal',
        userId: 'user-1',
        projectId: 'project-internal',
        apiType: 'text',
        model: 'test-model',
        action: 'super_agent_execute',
        quantity: 100,
        unit: 'token',
        cost: 9,
        metadata: JSON.stringify({ workflow: 'NORI_AGENT_BACKGROUND' }),
        createdAt: new Date('2026-06-13T11:00:00.000Z'),
      },
      {
        id: 'usage-visible',
        userId: 'user-1',
        projectId: 'project-visible',
        apiType: 'video',
        model: 'visible-model',
        action: 'video_panel',
        quantity: 2,
        unit: 'second',
        cost: 3,
        metadata: null,
        createdAt: new Date('2026-06-13T10:00:00.000Z'),
      },
    ])
    const hiddenTransaction = {
      id: 'tx-internal',
      userId: 'user-1',
      type: 'consume',
      amount: -9,
      balanceAfter: 91,
      description: 'super_agent_execute - hidden model',
      relatedId: null,
      freezeId: null,
      operatorId: null,
      externalOrderId: null,
      idempotencyKey: null,
      projectId: 'project-internal',
      episodeId: null,
      taskType: 'super_agent_execute',
      billingMeta: JSON.stringify({ action: 'NORI_AGENT_BACKGROUND' }),
      createdAt: new Date('2026-06-13T11:00:00.000Z'),
    }
    const visibleTransaction = {
      id: 'tx-visible',
      userId: 'user-1',
      type: 'consume',
      amount: -3,
      balanceAfter: 88,
      description: 'video_panel - visible model',
      relatedId: null,
      freezeId: null,
      operatorId: null,
      externalOrderId: null,
      idempotencyKey: null,
      projectId: 'project-visible',
      episodeId: null,
      taskType: 'video_panel',
      billingMeta: JSON.stringify({ model: 'visible-model' }),
      createdAt: new Date('2026-06-13T10:00:00.000Z'),
    }
    prismaMock.balanceTransaction.findMany.mockImplementation(async (query: unknown) => {
      const hasSelect = Boolean(query && typeof query === 'object' && 'select' in query)
      if (hasSelect) {
        return [
          {
            amount: hiddenTransaction.amount,
            taskType: hiddenTransaction.taskType,
            description: hiddenTransaction.description,
            billingMeta: hiddenTransaction.billingMeta,
          },
          {
            amount: visibleTransaction.amount,
            taskType: visibleTransaction.taskType,
            description: visibleTransaction.description,
            billingMeta: visibleTransaction.billingMeta,
          },
        ]
      }
      return [hiddenTransaction, visibleTransaction]
    })
    prismaMock.project.findMany.mockResolvedValue([
      { id: 'project-visible', name: 'Visible Project' },
    ])

    const overview = await buildServiceRecordsOverview('user-1', { limit: 3 })

    expect(prismaMock.task.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 'user-1' },
      take: 15,
    }))
    expect(overview.tasks.map((task) => task.id)).toEqual([
      'visible-video',
      'visible-image',
      'visible-text',
    ])
    expect(overview.taskWindow).toMatchObject({
      limit: 3,
      readLimit: 15,
      rawCount: 15,
      filteredInternalCount: 12,
      returnedCount: 3,
      hasMore: false,
    })
    expect(overview.usageRows).toEqual([
      { key: 'video_panel', total: 1, completed: 1, failed: 0, units: 2 },
    ])
    expect(overview.usageSummary).toMatchObject({
      billableTasks: 1,
      estimatedUnits: 2,
      serviceTypes: 1,
    })
    expect(overview.costs).toMatchObject({
      total: 3,
      byProject: [
        {
          projectId: 'project-visible',
          projectName: 'Visible Project',
          totalCost: 3,
          recordCount: 1,
        },
      ],
    })
    expect(overview.balance).toMatchObject({
      balance: 100,
      frozenAmount: 0,
      totalSpent: 3,
    })
    expect(overview.transactions.map((transaction) => transaction.id)).toEqual(['tx-visible'])
  })
})
