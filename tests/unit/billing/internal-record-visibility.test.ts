import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  usageCost: {
    findMany: vi.fn(),
  },
}))

vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}))

import { getProjectCostDetails, getProjectTotalCost, getUserCostDetails, getUserCostSummary } from '@/lib/billing/reporting'
import {
  containsInternalRecordMarker,
  isInternalBalanceTransactionRecord,
  isInternalUsageCostRecord,
  recordContainsInternalRecordMarker,
} from '@/lib/workspace/internal-record-visibility'

function usageCost(input: {
  id: string
  projectId?: string
  apiType?: string
  action?: string
  model?: string
  cost: number
  metadata?: string | null
  createdAt?: string
}) {
  return {
    id: input.id,
    projectId: input.projectId ?? 'project-1',
    userId: 'user-1',
    apiType: input.apiType ?? 'video',
    model: input.model ?? 'visible-model',
    action: input.action ?? 'video_panel',
    quantity: 1,
    unit: 'call',
    cost: input.cost,
    metadata: input.metadata ?? null,
    createdAt: new Date(input.createdAt ?? '2026-06-13T10:00:00.000Z'),
  }
}

describe('billing internal record visibility', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('matches explicit internal record markers without hiding generic agent text', () => {
    expect(containsInternalRecordMarker('customer agent voice')).toBe(false)
    expect(containsInternalRecordMarker('agent_storyboard_plan')).toBe(false)
    expect(containsInternalRecordMarker('super_agent_execute')).toBe(true)
    expect(containsInternalRecordMarker('wrapped-super-agent-stage')).toBe(true)
    expect(containsInternalRecordMarker('_NORI_AGENT_BACKGROUND')).toBe(true)
    expect(recordContainsInternalRecordMarker({ source: { mode: '自动创作模式' } })).toBe(true)
    expect(isInternalUsageCostRecord({
      action: 'text_generation',
      metadata: JSON.stringify({ workflow: 'NORI_AGENT_BACKGROUND' }),
    })).toBe(true)
    expect(isInternalBalanceTransactionRecord({
      taskType: 'voice_generation',
      description: 'customer agent voice',
      billingMeta: JSON.stringify({ model: 'visible-model' }),
    })).toBe(false)
  })

  it('excludes internal agent usage costs from user summary and details', async () => {
    prismaMock.usageCost.findMany.mockResolvedValue([
      usageCost({
        id: 'internal-action',
        projectId: 'project-hidden',
        action: 'super_agent_execute',
        cost: 9,
        metadata: JSON.stringify({ workflow: 'NORI_AGENT_BACKGROUND' }),
        createdAt: '2026-06-13T12:00:00.000Z',
      }),
      usageCost({
        id: 'visible-video',
        projectId: 'project-visible',
        action: 'video_panel',
        cost: 3,
        createdAt: '2026-06-13T11:00:00.000Z',
      }),
      usageCost({
        id: 'visible-image',
        projectId: 'project-visible',
        apiType: 'image',
        action: 'image_panel',
        cost: 2,
        createdAt: '2026-06-13T10:00:00.000Z',
      }),
    ])

    const summary = await getUserCostSummary('user-1')
    const details = await getUserCostDetails('user-1', 1, 1)
    const clampedDetails = await getUserCostDetails('user-1', -1, 999999)

    expect(summary).toEqual({
      total: 5,
      byProject: [
        {
          projectId: 'project-visible',
          _sum: { cost: 5 },
          _count: 2,
        },
      ],
    })
    expect(details.records.map((record) => record.id)).toEqual(['visible-video'])
    expect(details.total).toBe(2)
    expect(details.totalPages).toBe(2)
    expect(clampedDetails.page).toBe(1)
    expect(clampedDetails.pageSize).toBe(100)
    expect(clampedDetails.totalPages).toBe(1)
  })

  it('excludes internal agent usage costs from project totals and breakdowns', async () => {
    prismaMock.usageCost.findMany.mockResolvedValue([
      usageCost({
        id: 'internal-metadata',
        action: 'text_generation',
        apiType: 'text',
        cost: 10,
        metadata: JSON.stringify({ source: { mode: '自动创作模式' } }),
        createdAt: '2026-06-13T12:00:00.000Z',
      }),
      usageCost({
        id: 'visible-video',
        action: 'video_panel',
        apiType: 'video',
        cost: 6,
        createdAt: '2026-06-13T11:00:00.000Z',
      }),
      usageCost({
        id: 'visible-video-2',
        action: 'video_panel',
        apiType: 'video',
        cost: 4,
        createdAt: '2026-06-13T10:00:00.000Z',
      }),
    ])

    await expect(getProjectTotalCost('project-1')).resolves.toBe(10)

    const details = await getProjectCostDetails('project-1')

    expect(details.total).toBe(10)
    expect(details.byType).toEqual([
      {
        apiType: 'video',
        _sum: { cost: 10 },
        _count: 2,
      },
    ])
    expect(details.byAction).toEqual([
      {
        action: 'video_panel',
        _sum: { cost: 10 },
        _count: 2,
      },
    ])
    expect(details.recentRecords.map((record) => record.id)).toEqual(['visible-video', 'visible-video-2'])
  })
})
