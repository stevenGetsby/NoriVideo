import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const authMock = vi.hoisted(() => ({
  requireProjectAuthLight: vi.fn(async () => ({
    session: { user: { id: 'user-1' } },
    project: { id: 'project-1', userId: 'user-1', name: 'Project' },
  })),
  isErrorResponse: (value: unknown) => value instanceof NextResponse,
}))

const scopeMock = vi.hoisted(() => ({
  resolveExportScope: vi.fn(),
}))

const prismaMock = vi.hoisted(() => ({
  novelPromotionEpisode: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
  },
  novelPromotionProject: {
    findFirst: vi.fn(),
  },
  novelPromotionVoiceLine: {
    findMany: vi.fn(),
  },
}))

vi.mock('@/lib/api-auth', () => authMock)
vi.mock('@/lib/novel-promotion/export-scope', () => scopeMock)
vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}))

function getRequest(path: string) {
  return new NextRequest(`http://localhost${path}`, { method: 'GET' })
}

function postRequest(path: string, body: Record<string, unknown>) {
  return new NextRequest(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('legacy export compatibility route episode scope', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    scopeMock.resolveExportScope.mockResolvedValue(null)
  })

  it('returns not found before manifest data lookup for an episode outside the project', async () => {
    const { GET } = await import('@/app/api/novel-promotion/[projectId]/export-manifest/route')

    const response = await GET(
      getRequest('/api/novel-promotion/project-1/export-manifest?episodeId=episode-other') as never,
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(response.status).toBe(404)
    expect(scopeMock.resolveExportScope).toHaveBeenCalledWith({
      projectId: 'project-1',
      episodeId: 'episode-other',
    })
    expect(prismaMock.novelPromotionEpisode.findMany).not.toHaveBeenCalled()
    expect(prismaMock.novelPromotionProject.findFirst).not.toHaveBeenCalled()
  })

  it('returns not found before image ZIP data lookup for an episode outside the project', async () => {
    const { GET } = await import('@/app/api/novel-promotion/[projectId]/download-images/route')

    const response = await GET(
      getRequest('/api/novel-promotion/project-1/download-images?episodeId=episode-other') as never,
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(response.status).toBe(404)
    expect(prismaMock.novelPromotionEpisode.findFirst).not.toHaveBeenCalled()
    expect(prismaMock.novelPromotionProject.findFirst).not.toHaveBeenCalled()
  })

  it('returns not found before video ZIP data lookup for an episode outside the project', async () => {
    const { POST } = await import('@/app/api/novel-promotion/[projectId]/download-videos/route')

    const response = await POST(
      postRequest('/api/novel-promotion/project-1/download-videos', { episodeId: 'episode-other' }) as never,
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(response.status).toBe(404)
    expect(prismaMock.novelPromotionEpisode.findFirst).not.toHaveBeenCalled()
    expect(prismaMock.novelPromotionProject.findFirst).not.toHaveBeenCalled()
  })

  it('returns not found before voice ZIP data lookup for an episode outside the project', async () => {
    const { GET } = await import('@/app/api/novel-promotion/[projectId]/download-voices/route')

    const response = await GET(
      getRequest('/api/novel-promotion/project-1/download-voices?episodeId=episode-other') as never,
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(response.status).toBe(404)
    expect(prismaMock.novelPromotionVoiceLine.findMany).not.toHaveBeenCalled()
  })
})
