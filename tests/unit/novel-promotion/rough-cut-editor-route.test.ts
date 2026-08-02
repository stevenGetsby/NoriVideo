import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockRequest } from '../../helpers/request'

const mocks = vi.hoisted(() => ({
  findEpisode: vi.fn(),
  upsertEditor: vi.fn(),
}))

vi.mock('@/lib/api-auth', () => ({
  requireProjectAuthLight: vi.fn(async (projectId: string) => ({ project: { id: projectId } })),
  isErrorResponse: (value: unknown) => value instanceof Response,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    novelPromotionEpisode: { findFirst: mocks.findEpisode },
    videoEditorProject: { upsert: mocks.upsertEditor },
  },
}))

function episode(editorProject: Record<string, unknown> | null = null) {
  return {
    id: 'episode-1',
    editorProject,
    storyboards: [{
      id: 'storyboard-1',
      createdAt: new Date('2026-07-21T00:00:00.000Z'),
      clip: { start: 0 },
      panels: [{
        id: 'panel-1', panelIndex: 0, panelNumber: 1, description: '第一镜', duration: 5,
        imageUrl: 'one.jpg', videoUrl: 'canonical.mp4', videoMedia: { durationMs: 6_000 },
        lipSyncVideoUrl: null, lipSyncVideoMedia: null,
      }],
    }],
  }
}

describe('rough-cut editor route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.findEpisode.mockResolvedValue(episode())
    mocks.upsertEditor.mockResolvedValue({ id: 'editor-1', updatedAt: new Date('2026-07-21T01:00:00.000Z') })
  })

  it('returns actual generated Segment videos as the media bin', async () => {
    const { GET } = await import('@/app/api/novel-promotion/[projectId]/editor/route')
    const response = await GET(buildMockRequest({
      path: '/api/novel-promotion/project-1/editor',
      method: 'GET',
      query: { episodeId: 'episode-1' },
    }), { params: Promise.resolve({ projectId: 'project-1' }) })
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.projectData).toBeNull()
    expect(payload.sourcePanels).toEqual([expect.objectContaining({
      panelId: 'panel-1', videoUrl: 'canonical.mp4', durationMs: 6_000,
      sceneLabel: 'S01', segmentLabel: 'Segment 01',
    })])
  })

  it('canonicalizes client clips and invalidates a stale rendered output on save', async () => {
    const { PUT } = await import('@/app/api/novel-promotion/[projectId]/editor/route')
    const response = await PUT(buildMockRequest({
      path: '/api/novel-promotion/project-1/editor',
      method: 'PUT',
      body: {
        episodeId: 'episode-1',
        projectData: {
          episodeId: 'episode-1',
          config: { fps: 30, width: 1920, height: 1080 },
          timeline: [{ id: 'clip-1', src: 'untrusted.mp4', trim: { from: 30, to: 120 }, metadata: { panelId: 'panel-1' } }],
        },
      },
    }), { params: Promise.resolve({ projectId: 'project-1' }) })
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.projectData.timeline[0]).toMatchObject({
      src: 'canonical.mp4', trim: { from: 30, to: 120 }, durationInFrames: 90,
    })
    expect(mocks.upsertEditor).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({ renderStatus: null, renderTaskId: null, outputUrl: null }),
    }))
  })
})
