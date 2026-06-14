import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockRequest } from '../../helpers/request'

const authMock = vi.hoisted(() => ({
  requireUserAuth: vi.fn(async () => ({
    session: { user: { id: 'user-1' } },
  })),
  isErrorResponse: (value: unknown) => value instanceof Response,
}))

const prismaMock = vi.hoisted(() => ({
  project: {
    findFirst: vi.fn(),
  },
  novelPromotionProject: {
    findUnique: vi.fn(),
  },
}))

const attachMediaFieldsToProjectMock = vi.hoisted(() => vi.fn(async (value: unknown) => value))

vi.mock('@/lib/api-auth', () => authMock)
vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}))
vi.mock('@/lib/media/attach', () => ({
  attachMediaFieldsToProject: attachMediaFieldsToProjectMock,
}))

describe('/api/projects/[projectId]/assets scope', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.project.findFirst.mockResolvedValue({ id: 'project-1' })
    prismaMock.novelPromotionProject.findUnique.mockResolvedValue({
      id: 'novel-project-1',
      projectId: 'project-1',
      characters: [{ id: 'character-1' }],
      locations: [
        { id: 'location-1', assetKind: 'location', images: [] },
        { id: 'prop-1', assetKind: 'prop', images: [] },
      ],
    })
  })

  it('reads assets only after finding the project in the current user scope', async () => {
    const { GET } = await import('@/app/api/projects/[projectId]/assets/route')

    const res = await GET(
      buildMockRequest({
        path: '/api/projects/project-1/assets',
        method: 'GET',
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )
    const body = await res.json() as {
      characters?: unknown[]
      locations?: unknown[]
      props?: unknown[]
    }

    expect(res.status).toBe(200)
    expect(prismaMock.project.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'project-1',
        userId: 'user-1',
      },
      select: { id: true },
    })
    expect(prismaMock.novelPromotionProject.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { projectId: 'project-1' },
    }))
    expect(body.characters).toHaveLength(1)
    expect(body.locations).toHaveLength(1)
    expect(body.props).toHaveLength(1)
  })

  it('does not read novel-promotion assets for projects outside the current user scope', async () => {
    prismaMock.project.findFirst.mockResolvedValueOnce(null)
    const { GET } = await import('@/app/api/projects/[projectId]/assets/route')

    const res = await GET(
      buildMockRequest({
        path: '/api/projects/project-other/assets',
        method: 'GET',
      }),
      { params: Promise.resolve({ projectId: 'project-other' }) },
    )

    expect(res.status).toBe(404)
    expect(prismaMock.project.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'project-other',
        userId: 'user-1',
      },
      select: { id: true },
    })
    expect(prismaMock.novelPromotionProject.findUnique).not.toHaveBeenCalled()
    expect(attachMediaFieldsToProjectMock).not.toHaveBeenCalled()
  })
})
