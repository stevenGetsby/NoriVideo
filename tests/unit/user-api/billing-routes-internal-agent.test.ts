import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const authMock = vi.hoisted(() => ({
  requireUserAuth: vi.fn(async () => ({
    session: { user: { id: 'user-1' } },
  })),
  isErrorResponse: (value: unknown) => value instanceof NextResponse,
}))

const prismaMock = vi.hoisted(() => ({
  project: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    findFirst: vi.fn(),
  },
  usageCost: {
    findMany: vi.fn(),
  },
  userBalance: {
    findUnique: vi.fn(),
    create: vi.fn(),
  },
  balanceTransaction: {
    findMany: vi.fn(),
  },
  novelPromotionEpisode: {
    findMany: vi.fn(),
  },
}))

vi.mock('@/lib/api-auth', () => authMock)
vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}))

function usageCost(input: {
  id: string
  projectId?: string
  apiType?: string
  action?: string
  cost: number
  metadata?: string | null
  createdAt?: string
}) {
  return {
    id: input.id,
    projectId: input.projectId ?? 'project-1',
    userId: 'user-1',
    apiType: input.apiType ?? 'video',
    model: 'visible-model',
    action: input.action ?? 'video_panel',
    quantity: 1,
    unit: 'call',
    cost: input.cost,
    metadata: input.metadata ?? null,
    createdAt: new Date(input.createdAt ?? '2026-06-13T10:00:00.000Z'),
  }
}

function transaction(input: {
  id: string
  taskType?: string | null
  description?: string | null
  billingMeta?: string | null
  amount: number
  projectId?: string | null
  episodeId?: string | null
  createdAt?: string
}) {
  return {
    id: input.id,
    userId: 'user-1',
    type: 'consume',
    amount: input.amount,
    balanceAfter: 100 + input.amount,
    description: input.description ?? `${input.taskType ?? 'video_panel'} - visible model`,
    relatedId: null,
    freezeId: null,
    operatorId: null,
    externalOrderId: null,
    idempotencyKey: null,
    projectId: input.projectId ?? 'project-1',
    episodeId: input.episodeId ?? null,
    taskType: input.taskType ?? 'video_panel',
    billingMeta: input.billingMeta ?? JSON.stringify({ model: 'visible-model' }),
    createdAt: new Date(input.createdAt ?? '2026-06-13T10:00:00.000Z'),
  }
}

describe('billing routes internal agent visibility', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMock.requireUserAuth.mockResolvedValue({
      session: { user: { id: 'user-1' } },
    })
    prismaMock.project.findMany.mockResolvedValue([{ id: 'project-1', name: 'Visible Project' }])
    prismaMock.project.findUnique.mockResolvedValue({ userId: 'user-1', name: 'Visible Project' })
    prismaMock.project.findFirst.mockResolvedValue({ id: 'project-1', name: 'Visible Project' })
    prismaMock.novelPromotionEpisode.findMany.mockResolvedValue([])
    prismaMock.userBalance.findUnique.mockResolvedValue({
      id: 'balance-1',
      userId: 'user-1',
      balance: 88,
      frozenAmount: 0,
      totalSpent: 12,
      createdAt: new Date('2026-06-13T09:00:00.000Z'),
      updatedAt: new Date('2026-06-13T12:00:00.000Z'),
    })
    prismaMock.userBalance.create.mockResolvedValue({
      id: 'balance-1',
      userId: 'user-1',
      balance: 0,
      frozenAmount: 0,
      totalSpent: 0,
      createdAt: new Date('2026-06-13T09:00:00.000Z'),
      updatedAt: new Date('2026-06-13T09:00:00.000Z'),
    })
  })

  it('/api/user/costs excludes internal agent usage from totals', async () => {
    prismaMock.usageCost.findMany.mockResolvedValue([
      usageCost({
        id: 'internal',
        projectId: 'project-hidden',
        action: 'super_agent_execute',
        cost: 9,
        metadata: JSON.stringify({ workflow: 'NORI_AGENT_BACKGROUND' }),
      }),
      usageCost({
        id: 'visible',
        projectId: 'project-1',
        action: 'video_panel',
        cost: 3,
      }),
    ])
    const { GET } = await import('@/app/api/user/costs/route')

    const response = await GET(
      new NextRequest('http://localhost/api/user/costs') as never,
      { params: Promise.resolve({}) },
    )
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.total).toBe(3)
    expect(payload.byProject).toEqual([
      {
        projectId: 'project-1',
        projectName: 'Visible Project',
        totalCost: 3,
        recordCount: 1,
      },
    ])
    expect(prismaMock.project.findMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['project-1'] },
        userId: 'user-1',
      },
      select: { id: true, name: true },
    })
  })

  it('/api/user/costs does not attach another user project name from mismatched cost rows', async () => {
    prismaMock.usageCost.findMany.mockResolvedValue([
      usageCost({
        id: 'visible',
        projectId: 'other-project',
        action: 'video_panel',
        cost: 3,
      }),
    ])
    prismaMock.project.findMany.mockResolvedValue([])
    const { GET } = await import('@/app/api/user/costs/route')

    const response = await GET(
      new NextRequest('http://localhost/api/user/costs') as never,
      { params: Promise.resolve({}) },
    )
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(prismaMock.project.findMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['other-project'] },
        userId: 'user-1',
      },
      select: { id: true, name: true },
    })
    expect(payload.byProject).toEqual([
      {
        projectId: 'other-project',
        projectName: '未知项目',
        totalCost: 3,
        recordCount: 1,
      },
    ])
  })

  it('/api/user/costs/details filters internal agent usage before pagination', async () => {
    prismaMock.usageCost.findMany.mockResolvedValue([
      usageCost({
        id: 'internal',
        projectId: 'project-hidden',
        action: 'super_agent_execute',
        cost: 9,
        metadata: JSON.stringify({ workflow: 'NORI_AGENT_BACKGROUND' }),
        createdAt: '2026-06-13T12:00:00.000Z',
      }),
      usageCost({
        id: 'visible-1',
        projectId: 'project-1',
        action: 'video_panel',
        cost: 3,
        createdAt: '2026-06-13T11:00:00.000Z',
      }),
      usageCost({
        id: 'visible-2',
        projectId: 'project-1',
        apiType: 'image',
        action: 'image_panel',
        cost: 2,
        createdAt: '2026-06-13T10:00:00.000Z',
      }),
    ])
    const { GET } = await import('@/app/api/user/costs/details/route')

    const response = await GET(
      new NextRequest('http://localhost/api/user/costs/details?page=1&pageSize=1') as never,
      { params: Promise.resolve({}) },
    )
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.records.map((record: { id: string }) => record.id)).toEqual(['visible-1'])
    expect(payload).toMatchObject({
      success: true,
      total: 2,
      page: 1,
      pageSize: 1,
      totalPages: 2,
    })
  })

  it('/api/user/costs/details clamps invalid pagination parameters', async () => {
    prismaMock.usageCost.findMany.mockResolvedValue([
      usageCost({ id: 'visible-1', cost: 1 }),
      usageCost({ id: 'visible-2', cost: 2 }),
    ])
    const { GET } = await import('@/app/api/user/costs/details/route')

    const response = await GET(
      new NextRequest('http://localhost/api/user/costs/details?page=abc&pageSize=999999') as never,
      { params: Promise.resolve({}) },
    )
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toMatchObject({
      page: 1,
      pageSize: 100,
      total: 2,
      totalPages: 1,
    })
    expect(Number.isFinite(payload.totalPages)).toBe(true)
  })

  it('/api/projects/[projectId]/costs excludes internal agent usage from project records', async () => {
    prismaMock.usageCost.findMany.mockResolvedValue([
      usageCost({
        id: 'internal',
        action: 'text_generation',
        apiType: 'text',
        cost: 9,
        metadata: JSON.stringify({ source: '自动创作模式' }),
      }),
      usageCost({
        id: 'visible',
        action: 'video_panel',
        apiType: 'video',
        cost: 3,
      }),
    ])
    const { GET } = await import('@/app/api/projects/[projectId]/costs/route')

    const response = await GET(
      new NextRequest('http://localhost/api/projects/project-1/costs') as never,
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.total).toBe(3)
    expect(payload.recentRecords.map((record: { id: string }) => record.id)).toEqual(['visible'])
  })

  it('/api/user/transactions filters internal agent rows before pagination and total count', async () => {
    prismaMock.balanceTransaction.findMany.mockResolvedValue([
      transaction({
        id: 'internal',
        taskType: 'super_agent_execute',
        billingMeta: JSON.stringify({ action: 'NORI_AGENT_BACKGROUND' }),
        amount: -9,
        createdAt: '2026-06-13T12:00:00.000Z',
      }),
      transaction({
        id: 'visible-1',
        taskType: 'video_panel',
        amount: -3,
        createdAt: '2026-06-13T11:00:00.000Z',
      }),
      transaction({
        id: 'visible-2',
        taskType: 'image_panel',
        amount: -2,
        createdAt: '2026-06-13T10:00:00.000Z',
      }),
    ])
    const { GET } = await import('@/app/api/user/transactions/route')

    const response = await GET(
      new NextRequest('http://localhost/api/user/transactions?page=1&pageSize=1') as never,
      { params: Promise.resolve({}) },
    )
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.transactions.map((item: { id: string }) => item.id)).toEqual(['visible-1'])
    expect(payload.pagination).toMatchObject({
      page: 1,
      pageSize: 1,
      total: 2,
      totalPages: 2,
    })
    expect(payload.transactions[0]).toMatchObject({
      action: 'video_panel',
      projectName: 'Visible Project',
      billingMeta: { model: 'visible-model' },
    })
    expect(prismaMock.project.findMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['project-1'] },
        userId: 'user-1',
      },
      select: { id: true, name: true },
    })
  })

  it('/api/user/transactions does not attach another user project or episode names from mismatched rows', async () => {
    prismaMock.balanceTransaction.findMany.mockResolvedValue([
      transaction({
        id: 'visible-other',
        taskType: 'video_panel',
        amount: -3,
        projectId: 'other-project',
        episodeId: 'other-episode',
      }),
    ])
    prismaMock.project.findMany.mockResolvedValue([])
    prismaMock.novelPromotionEpisode.findMany.mockResolvedValue([])
    const { GET } = await import('@/app/api/user/transactions/route')

    const response = await GET(
      new NextRequest('http://localhost/api/user/transactions?page=1&pageSize=20') as never,
      { params: Promise.resolve({}) },
    )
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(prismaMock.project.findMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['other-project'] },
        userId: 'user-1',
      },
      select: { id: true, name: true },
    })
    expect(prismaMock.novelPromotionEpisode.findMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['other-episode'] },
        novelPromotionProject: {
          project: {
            userId: 'user-1',
          },
        },
      },
      select: { id: true, episodeNumber: true, name: true },
    })
    expect(payload.transactions[0]).toMatchObject({
      id: 'visible-other',
      projectName: null,
      episodeNumber: null,
      episodeName: null,
    })
  })

  it('/api/user/transactions clamps invalid pagination parameters', async () => {
    prismaMock.balanceTransaction.findMany.mockResolvedValue([
      transaction({ id: 'visible-1', amount: -1 }),
      transaction({ id: 'visible-2', amount: -2 }),
    ])
    const { GET } = await import('@/app/api/user/transactions/route')

    const response = await GET(
      new NextRequest('http://localhost/api/user/transactions?page=0&pageSize=999999') as never,
      { params: Promise.resolve({}) },
    )
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.pagination).toMatchObject({
      page: 1,
      pageSize: 100,
      total: 2,
      totalPages: 1,
    })
    expect(Number.isFinite(payload.pagination.totalPages)).toBe(true)
  })

  it('/api/user/balance reports visible totalSpent while keeping wallet balance from ledger', async () => {
    prismaMock.balanceTransaction.findMany.mockResolvedValue([
      transaction({
        id: 'internal',
        taskType: 'super_agent_execute',
        billingMeta: JSON.stringify({ action: 'NORI_AGENT_BACKGROUND' }),
        amount: -9,
      }),
      transaction({
        id: 'visible',
        taskType: 'video_panel',
        amount: -3,
      }),
    ])
    const { GET } = await import('@/app/api/user/balance/route')

    const response = await GET(
      new NextRequest('http://localhost/api/user/balance') as never,
      { params: Promise.resolve({}) },
    )
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(prismaMock.userBalance.findUnique).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
    })
    expect(prismaMock.balanceTransaction.findMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', type: 'consume' },
      select: {
        amount: true,
        taskType: true,
        description: true,
        billingMeta: true,
      },
    })
    expect(payload).toMatchObject({
      success: true,
      balance: 88,
      frozenAmount: 0,
      totalSpent: 3,
    })
  })
})
