import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockRequest } from '../../../helpers/request'

const authMock = vi.hoisted(() => ({
  requireUserAuth: vi.fn(async () => ({
    session: { user: { id: 'user-1' } },
  })),
  isErrorResponse: vi.fn((value: unknown) => value instanceof Response),
}))

const prismaMock = vi.hoisted(() => ({
  project: {
    findUnique: vi.fn(),
    update: vi.fn(async () => ({})),
  },
  userPreference: {
    findUnique: vi.fn(),
  },
}))

const attachMediaFieldsToProjectMock = vi.hoisted(() =>
  vi.fn(async (value: unknown) => value),
)

vi.mock('@/lib/api-auth', () => authMock)
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/media/attach', () => ({
  attachMediaFieldsToProject: attachMediaFieldsToProjectMock,
}))

describe('api specific - project data route', () => {
  const routeContext = { params: Promise.resolve({ projectId: 'project-1' }) }

  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.project.findUnique.mockResolvedValue({
      id: 'project-1',
      name: 'Project 1',
      description: null,
      userId: 'user-1',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
      novelPromotionData: {
        id: 'novel-1',
        projectId: 'project-1',
        importStatus: 'pending',
        characters: [],
        locations: [
          { id: 'location-1', assetKind: 'location', images: [] },
          { id: 'prop-1', assetKind: 'prop', images: [] },
        ],
        episodes: [],
      },
    })
    prismaMock.userPreference.findUnique.mockResolvedValue(null)
  })

  it('returns project data as JSON for the project owner', async () => {
    const mod = await import('@/app/api/projects/[projectId]/data/route')
    const req = buildMockRequest({
      path: '/api/projects/project-1/data',
      method: 'GET',
    })

    const res = await mod.GET(req, routeContext)
    const body = await res.json() as {
      project?: {
        id?: string
        novelPromotionData?: {
          importStatus?: string
          locations?: unknown[]
          props?: unknown[]
        }
      }
    }

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/json')
    expect(body.project?.id).toBe('project-1')
    expect(body.project?.novelPromotionData?.importStatus).toBe('pending')
    expect(body.project?.novelPromotionData?.locations).toHaveLength(1)
    expect(body.project?.novelPromotionData?.props).toHaveLength(1)
    expect(attachMediaFieldsToProjectMock).toHaveBeenCalled()
    expect(prismaMock.project.update).toHaveBeenCalledWith({
      where: { id: 'project-1' },
      data: { lastAccessedAt: expect.any(Date) },
    })
  })

  it('exposes user default models when project has no explicit model override', async () => {
    prismaMock.project.findUnique.mockResolvedValueOnce({
      id: 'project-1',
      name: 'Project 1',
      description: null,
      userId: 'user-1',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
      novelPromotionData: {
        id: 'novel-1',
        projectId: 'project-1',
        importStatus: 'completed',
        analysisModel: null,
        characterModel: null,
        locationModel: null,
        storyboardModel: null,
        editModel: null,
        videoModel: null,
        audioModel: null,
        characters: [],
        locations: [],
        episodes: [],
      },
    })
    prismaMock.userPreference.findUnique.mockResolvedValueOnce({
      analysisModel: 'llm-provider::text-model',
      characterModel: 'image-provider::character-model',
      locationModel: 'image-provider::location-model',
      storyboardModel: 'image-provider::storyboard-model',
      editModel: 'image-provider::edit-model',
      videoModel: 'video-provider::video-model',
      audioModel: 'audio-provider::audio-model',
    })

    const mod = await import('@/app/api/projects/[projectId]/data/route')
    const req = buildMockRequest({
      path: '/api/projects/project-1/data',
      method: 'GET',
    })

    const res = await mod.GET(req, routeContext)
    const body = await res.json() as {
      project?: {
        novelPromotionData?: {
          analysisModel?: string | null
          characterModel?: string | null
          storyboardModel?: string | null
          editModel?: string | null
          videoModel?: string | null
        }
      }
    }

    expect(res.status).toBe(200)
    expect(body.project?.novelPromotionData?.analysisModel).toBe('llm-provider::text-model')
    expect(body.project?.novelPromotionData?.characterModel).toBe('image-provider::character-model')
    expect(body.project?.novelPromotionData?.storyboardModel).toBe('image-provider::storyboard-model')
    expect(body.project?.novelPromotionData?.editModel).toBe('image-provider::edit-model')
    expect(body.project?.novelPromotionData?.videoModel).toBe('video-provider::video-model')
  })

  it('returns a JSON forbidden error for another user project', async () => {
    prismaMock.project.findUnique.mockResolvedValueOnce({
      id: 'project-1',
      name: 'Project 1',
      userId: 'other-user',
      novelPromotionData: { id: 'novel-1', projectId: 'project-1' },
    })

    const mod = await import('@/app/api/projects/[projectId]/data/route')
    const req = buildMockRequest({
      path: '/api/projects/project-1/data',
      method: 'GET',
    })

    const res = await mod.GET(req, routeContext)
    const body = await res.json() as { error?: { code?: string } }

    expect(res.status).toBe(403)
    expect(res.headers.get('content-type')).toContain('application/json')
    expect(body.error?.code).toBe('FORBIDDEN')
  })
})
