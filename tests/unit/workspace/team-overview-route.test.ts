import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const authMock = vi.hoisted(() => ({
  requireUserAuth: vi.fn(async () => ({
    session: {
      user: {
        id: 'user-1',
        name: 'Owner',
        email: 'owner@example.com',
      },
    },
  })),
  isErrorResponse: (value: unknown) => value instanceof NextResponse,
}))

const prismaMock = vi.hoisted(() => ({
  project: {
    count: vi.fn(),
    findMany: vi.fn(),
  },
  task: {
    findMany: vi.fn(),
  },
}))

const teamStoreMock = vi.hoisted(() => ({
  ensureWorkspaceTeamState: vi.fn(),
  isWorkspaceTeamRole: vi.fn((value: unknown) => (
    value === 'owner' || value === 'writer' || value === 'asset' || value === 'producer'
  )),
  normalizeWorkspaceTeamSeatStatus: vi.fn((role: string, value: unknown) => (
    role === 'owner' ? 'enabled' : value === 'enabled' ? 'enabled' : 'reserved'
  )),
  countWorkspaceTeamPermissions: vi.fn((_role: string, permissions: unknown) => (
    Array.isArray(permissions) ? permissions.length : 0
  )),
}))

vi.mock('@/lib/api-auth', () => authMock)
vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}))
vi.mock('@/lib/workspace/team-store', () => teamStoreMock)

function taskRow(input: {
  id: string
  type: string
  targetType?: string
  errorMessage?: string | null
  status?: string
  updatedAt?: string
}) {
  return {
    id: input.id,
    type: input.type,
    targetType: input.targetType ?? 'panel',
    status: input.status ?? 'completed',
    errorMessage: input.errorMessage ?? null,
    projectId: 'project-1',
    updatedAt: new Date(input.updatedAt ?? '2026-06-13T10:00:00.000Z'),
  }
}

function seatRow() {
  return {
    id: 'seat-owner',
    role: 'owner',
    status: 'enabled',
    displayName: 'Owner',
    email: 'owner@example.com',
    permissions: ['projects', 'scripts', 'assets', 'production', 'records'],
    lastActivityAt: null,
    updatedAt: new Date('2026-06-13T10:00:00.000Z'),
  }
}

describe('/api/workspace/team-overview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.project.count.mockResolvedValue(1)
    prismaMock.project.findMany.mockResolvedValue([
      {
        id: 'project-1',
        name: 'Visible Project',
        updatedAt: new Date('2026-06-13T09:00:00.000Z'),
        novelPromotionData: {
          episodes: [],
        },
      },
    ])
    prismaMock.task.findMany.mockResolvedValue([
      taskRow({
        id: 'task-agent',
        type: 'super_agent_execute',
        status: 'completed',
        updatedAt: '2026-06-13T12:00:00.000Z',
      }),
      taskRow({
        id: 'task-agent-wrapped',
        type: 'background_text',
        targetType: 'super_agent_stage',
        status: 'completed',
        updatedAt: '2026-06-13T11:30:00.000Z',
      }),
      taskRow({
        id: 'task-video',
        type: 'video_panel',
        status: 'completed',
        updatedAt: '2026-06-13T11:00:00.000Z',
      }),
      taskRow({
        id: 'task-image-failed',
        type: 'image_panel',
        status: 'failed',
        updatedAt: '2026-06-13T10:00:00.000Z',
      }),
    ])
    teamStoreMock.ensureWorkspaceTeamState.mockResolvedValue({
      profile: {
        id: 'team-profile-1',
        mode: 'personal',
        displayName: 'Owner',
        seatLimit: 4,
      },
      seats: [seatRow()],
    })
  })

  it('filters internal agent tasks out of team workload, task list and quota units', async () => {
    const { GET } = await import('@/app/api/workspace/team-overview/route')

    const response = await GET(
      new NextRequest('http://localhost/api/workspace/team-overview') as never,
      { params: Promise.resolve({}) },
    )
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.tasks.map((task: { id: string }) => task.id)).toEqual(['task-video', 'task-image-failed'])
    expect(payload.workloadRows.map((row: { key: string }) => row.key)).toEqual(['video_panel', 'image_panel'])
    expect(payload.stats).toMatchObject({
      projects: 1,
      activeTasks: 0,
      failedTasks: 1,
    })
    expect(payload.quotaRows.serviceUnits.used).toBe(6)
    expect(payload.seatRows[0]).toMatchObject({
      id: 'seat-owner',
      workload: 2,
      lastActivity: '2026-06-13T11:00:00.000Z',
    })
  })
})
