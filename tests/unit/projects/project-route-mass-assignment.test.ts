import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const authMock = vi.hoisted(() => ({
  requireUserAuth: vi.fn(async () => ({
    session: { user: { id: 'user-1', name: 'User 1' } },
  })),
  isErrorResponse: (value: unknown) => value instanceof NextResponse,
}))

const prismaMock = vi.hoisted(() => ({
  project: {
    findFirst: vi.fn(),
    update: vi.fn(),
  },
}))

vi.mock('@/lib/api-auth', () => authMock)
vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}))
vi.mock('@/lib/storage', () => ({
  addSignedUrlsToProject: vi.fn((project) => project),
  deleteObjects: vi.fn(),
}))
vi.mock('@/lib/media/service', () => ({
  resolveStorageKeyFromMediaValue: vi.fn(async () => null),
}))
vi.mock('@/lib/logging/semantic', () => ({
  logProjectAction: vi.fn(),
}))
vi.mock('@/lib/providers/bailian', () => ({
  collectProjectBailianManagedVoiceIds: vi.fn(async () => []),
  cleanupUnreferencedBailianVoices: vi.fn(async () => ({ attempted: 0, deleted: 0 })),
}))

describe('/api/projects/[projectId] PATCH', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.project.findFirst.mockResolvedValue({
      id: 'project-1',
      userId: 'user-1',
      name: 'Project 1',
      description: 'old description',
      user: { id: 'user-1' },
    })
    prismaMock.project.update.mockResolvedValue({
      id: 'project-1',
      userId: 'user-1',
      name: 'Renamed project',
      description: 'new description',
    })
  })

  it('only persists allowed editable fields and ignores userId mass assignment', async () => {
    const { PATCH } = await import('@/app/api/projects/[projectId]/route')

    const response = await PATCH(
      new NextRequest('http://localhost/api/projects/project-1', {
        method: 'PATCH',
        body: JSON.stringify({
          name: 'Renamed project',
          description: 'new description',
          userId: 'user-2',
          createdAt: '2000-01-01T00:00:00.000Z',
        }),
        headers: { 'Content-Type': 'application/json' },
      }) as never,
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(prismaMock.project.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'project-1',
        userId: 'user-1',
      },
      include: { user: true },
    })
    expect(prismaMock.project.update).toHaveBeenCalledWith({
      where: { id: 'project-1' },
      data: {
        name: 'Renamed project',
        description: 'new description',
      },
    })
    expect(payload.project.userId).toBe('user-1')
  })

  it('returns not found for projects outside the current user scope before updating', async () => {
    prismaMock.project.findFirst.mockResolvedValueOnce(null)
    const { PATCH } = await import('@/app/api/projects/[projectId]/route')

    const response = await PATCH(
      new NextRequest('http://localhost/api/projects/project-other', {
        method: 'PATCH',
        body: JSON.stringify({
          name: 'Renamed project',
        }),
        headers: { 'Content-Type': 'application/json' },
      }) as never,
      { params: Promise.resolve({ projectId: 'project-other' }) },
    )

    expect(response.status).toBe(404)
    expect(prismaMock.project.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'project-other',
        userId: 'user-1',
      },
      include: { user: true },
    })
    expect(prismaMock.project.update).not.toHaveBeenCalled()
  })
})
