import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  findAssignment: vi.fn(),
  findSubmission: vi.fn(),
  findEpisode: vi.fn(),
  countTasks: vi.fn(),
  findAnnotations: vi.fn(),
  requireProjectReader: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    workflowAssignment: { findFirst: mocks.findAssignment },
    workflowAssignmentEvent: { findFirst: mocks.findSubmission },
    novelPromotionEpisode: { findUnique: mocks.findEpisode },
    task: { count: mocks.countTasks },
    videoReviewAnnotation: { findMany: mocks.findAnnotations },
  },
}))

vi.mock('@/lib/collaboration/access', () => ({
  getWorkspaceActor: () => ({ workspaceOwnerId: 'owner-1', actorId: 'reviewer-1' }),
  requireProjectReader: mocks.requireProjectReader,
}))

import { getVideoReviewContext } from '@/lib/collaboration/video-review'

const session = {
  user: {
    id: 'owner-1',
    actorId: 'reviewer-1',
    role: 'admin',
  },
}

describe('video review context', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireProjectReader.mockResolvedValue({ canReviewAssignments: true })
    mocks.findAnnotations.mockResolvedValue([])
    mocks.findSubmission.mockResolvedValue(null)
    mocks.countTasks.mockResolvedValue(0)
    mocks.findAssignment.mockResolvedValue({
      uuid: 'assignment-1',
      projectId: 'project-1',
      episodeId: 'episode-1',
      status: 'pending_review',
      assigneeUserId: 'artist-1',
      submittedAt: new Date('2026-07-21T00:00:00.000Z'),
      lastReviewNote: null,
      project: { name: '项目一', work: { name: '作品一' } },
      episode: { id: 'episode-1', episodeNumber: 2, name: '第二集' },
    })
    mocks.findEpisode.mockResolvedValue({
      id: 'episode-1',
      name: '第二集',
      editorProject: null,
      storyboards: [{
        id: 'storyboard-1',
        createdAt: new Date('2026-07-20T00:00:00.000Z'),
        clip: { start: 0, location: '街道' },
        panels: [
          {
            id: 'panel-1',
            panelIndex: 0,
            panelNumber: 1,
            shotType: '近景',
            cameraMove: '固定',
            description: '第一镜',
            location: '街道',
            characters: '["甲"]',
            props: '[]',
            srtSegment: '甲走进街道。',
            duration: 8,
            imageUrl: null,
            videoPrompt: '甲走进街道',
            videoUrl: 'video/one.mp4',
            videoMedia: { durationMs: 6_240 },
            lipSyncVideoUrl: null,
            lipSyncVideoMedia: null,
          },
          {
            id: 'panel-2',
            panelIndex: 1,
            panelNumber: 2,
            shotType: null,
            cameraMove: null,
            description: '第二镜',
            location: null,
            characters: null,
            props: null,
            srtSegment: null,
            duration: null,
            imageUrl: null,
            videoPrompt: null,
            videoUrl: 'video/two.mp4',
            videoMedia: null,
            lipSyncVideoUrl: null,
            lipSyncVideoMedia: null,
          },
        ],
      }],
    })
  })

  it('builds the review timeline from actual metadata before the five-second fallback', async () => {
    const result = await getVideoReviewContext(session as never, 'assignment-1')

    expect(result.sources).toEqual([
      expect.objectContaining({ kind: 'episode', label: '整集连续预览', startMs: 0, endMs: 11_240, virtualSequence: true }),
      expect.objectContaining({ id: 'panel-1', label: 'S01 · Segment 01', startMs: 0, endMs: 6_240, durationMs: 6_240 }),
      expect.objectContaining({ id: 'panel-2', label: 'S01 · Segment 02', startMs: 6_240, endMs: 11_240, durationMs: 5_000 }),
    ])
    expect(result.durationMs).toBe(11_240)
    expect(result.readyForReview).toBe(false)
    expect(mocks.countTasks).toHaveBeenCalledWith({
      where: {
        targetType: 'NovelPromotionPanel',
        targetId: { in: ['panel-1', 'panel-2'] },
        type: { in: ['video_panel', 'lip_sync'] },
        status: { in: ['queued', 'processing'] },
      },
    })
  })

  it('treats a saved edit as ready even while an unused generation task is active', async () => {
    mocks.countTasks.mockResolvedValue(1)
    const liveEpisode = await mocks.findEpisode()
    mocks.findEpisode.mockResolvedValue({
      ...liveEpisode,
      editorProject: {
        outputUrl: null,
        projectData: JSON.stringify({
          episodeId: 'episode-1',
          config: { fps: 30, width: 1920, height: 1080 },
          timeline: [
            { id: 'clip-1', trim: { from: 0, to: 120 }, durationInFrames: 120, metadata: { panelId: 'panel-1' } },
          ],
        }),
      },
    })

    const result = await getVideoReviewContext(session as never, 'assignment-1')

    expect(result.readyPanelCount).toBe(2)
    expect(result.activeVideoTaskCount).toBe(1)
    expect(result.readyForReview).toBe(true)
  })

  it('uses the saved rough-cut order and trim ranges for the review timeline', async () => {
    const liveEpisode = await mocks.findEpisode()
    mocks.findEpisode.mockResolvedValue({
      ...liveEpisode,
      editorProject: {
        outputUrl: null,
        projectData: JSON.stringify({
          episodeId: 'episode-1',
          config: { fps: 30, width: 1920, height: 1080 },
          timeline: [
            { id: 'clip-2', trim: { from: 30, to: 120 }, durationInFrames: 90, metadata: { panelId: 'panel-2' } },
            { id: 'clip-1', trim: { from: 0, to: 60 }, durationInFrames: 60, metadata: { panelId: 'panel-1' } },
          ],
        }),
      },
    })

    const result = await getVideoReviewContext(session as never, 'assignment-1')

    expect(result.durationMs).toBe(5_000)
    expect(result.sources).toEqual([
      expect.objectContaining({ kind: 'episode', durationMs: 5_000, virtualSequence: true }),
      expect.objectContaining({ id: 'clip-2', panelId: 'panel-2', startMs: 0, endMs: 3_000, trimStartMs: 1_000, trimEndMs: 4_000 }),
      expect.objectContaining({ id: 'clip-1', panelId: 'panel-1', startMs: 3_000, endMs: 5_000, trimStartMs: 0, trimEndMs: 2_000 }),
    ])
    expect(result.readyForReview).toBe(true)
  })

  it('reviews the immutable submitted snapshot instead of later live panel changes', async () => {
    mocks.findSubmission.mockResolvedValue({
      createdAt: new Date('2026-07-21T00:00:00.000Z'),
      payload: {
        reviewSubmission: {
          version: 1,
          capturedAt: '2026-07-21T00:00:00.000Z',
          episodeId: 'episode-1',
          episodeName: '第二集',
          episodeOutputUrl: null,
          durationMs: 4_000,
          totalPanelCount: 1,
          readyPanelCount: 1,
          segments: [{
            panelId: 'submitted-panel', storyboardId: 'storyboard-old', sequence: 1,
            sceneLabel: 'S01', segmentLabel: 'Segment 01', label: 'S01 · Segment 01',
            description: '提交版本', sourceText: null, videoPrompt: null, location: null,
            shotType: null, cameraMove: null, characters: [], props: [], imageUrl: null,
            videoUrl: 'video/submitted.mp4', startMs: 0, endMs: 4_000, durationMs: 4_000,
          }],
        },
      },
    })

    const result = await getVideoReviewContext(session as never, 'assignment-1')

    expect(result.sources).toEqual([
      expect.objectContaining({ kind: 'episode', durationMs: 4_000 }),
      expect.objectContaining({ id: 'submitted-panel', description: '提交版本', videoUrl: 'video/submitted.mp4' }),
    ])
    expect(result.submissionCapturedAt).toBe('2026-07-21T00:00:00.000Z')
    expect(mocks.findEpisode).not.toHaveBeenCalled()
  })

  it('reviews a canvas playlist snapshot without trying to load a novel episode', async () => {
    mocks.findAssignment.mockResolvedValue({
      uuid: 'assignment-playlist',
      projectId: 'project-1',
      scopeId: 'canvas-playlist:canvas-1:playlist-1',
      episodeId: null,
      status: 'pending_review',
      assigneeUserId: 'artist-1',
      submittedAt: new Date('2026-07-30T00:00:00.000Z'),
      lastReviewNote: null,
      project: { name: '项目一', work: { name: '作品一' } },
      episode: null,
    })
    mocks.findSubmission.mockResolvedValue({
      createdAt: new Date('2026-07-30T00:00:00.000Z'),
      payload: {
        reviewTarget: { kind: 'canvas_playlist', canvasId: 'canvas-1', nodeId: 'playlist-1', title: '最终剪辑' },
        reviewSubmission: {
          version: 1,
          capturedAt: '2026-07-30T00:00:00.000Z',
          episodeId: 'canvas-playlist:canvas-1:playlist-1',
          episodeName: '最终剪辑',
          episodeOutputUrl: null,
          durationMs: 3_000,
          totalPanelCount: 1,
          readyPanelCount: 1,
          segments: [{
            clipId: 'clip-1', panelId: 'clip-1', storyboardId: 'canvas-1', sequence: 1,
            sceneLabel: 'PLAYLIST', segmentLabel: 'Clip 01', label: 'Clip 01 · 镜头 A',
            description: null, sourceText: null, videoPrompt: null, location: null,
            shotType: null, cameraMove: null, characters: [], props: [], imageUrl: null,
            videoUrl: 'video/a.mp4', startMs: 0, endMs: 3_000, durationMs: 3_000,
            trimStartMs: 500, trimEndMs: 3_500,
          }],
        },
      },
    })

    const result = await getVideoReviewContext(session as never, 'assignment-playlist')

    expect(result.reviewTarget).toMatchObject({ kind: 'canvas_playlist', nodeId: 'playlist-1' })
    expect(result.assignment).toMatchObject({ episodeId: null, episodeName: '最终剪辑', canAnnotate: true })
    expect(result.sources).toEqual([
      expect.objectContaining({ kind: 'episode', virtualSequence: true, durationMs: 3_000 }),
      expect.objectContaining({ id: 'clip-1', label: 'Clip 01 · 镜头 A', trimStartMs: 500 }),
    ])
    expect(mocks.findEpisode).not.toHaveBeenCalled()
  })

  it('keeps rejected feedback bound to the submitted version while checking live readiness for resubmit', async () => {
    mocks.findAssignment.mockResolvedValue({
      uuid: 'assignment-1', projectId: 'project-1', episodeId: 'episode-1', status: 'rejected',
      assigneeUserId: 'artist-1', submittedAt: new Date('2026-07-21T00:00:00.000Z'),
      lastReviewNote: '需要修改', project: { name: '项目一', work: { name: '作品一' } },
      episode: { id: 'episode-1', episodeNumber: 2, name: '第二集' },
    })
    mocks.findSubmission.mockResolvedValue({
      createdAt: new Date('2026-07-21T00:00:00.000Z'),
      payload: {
        reviewSubmission: {
          version: 1, capturedAt: '2026-07-21T00:00:00.000Z', episodeId: 'episode-1',
          episodeName: '第二集', episodeOutputUrl: null, durationMs: 5_000,
          totalPanelCount: 1, readyPanelCount: 1,
          segments: [{
            panelId: 'panel-1', storyboardId: 'storyboard-1', sequence: 1,
            sceneLabel: 'S01', segmentLabel: 'Segment 01', label: 'S01 · Segment 01',
            description: '被审核版本', sourceText: null, videoPrompt: null, location: null,
            shotType: null, cameraMove: null, characters: [], props: [], imageUrl: null,
            videoUrl: 'video/submitted.mp4', startMs: 0, endMs: 5_000, durationMs: 5_000,
          }],
        },
      },
    })
    const liveEpisode = await mocks.findEpisode()
    mocks.findEpisode.mockResolvedValue({
      ...liveEpisode,
      storyboards: liveEpisode.storyboards.map((storyboard: { panels: Array<Record<string, unknown>> }) => ({
        ...storyboard,
        panels: storyboard.panels.map((panel) => ({ ...panel, videoUrl: null })),
      })),
    })

    const result = await getVideoReviewContext(session as never, 'assignment-1')

    expect(result.sources[1]).toMatchObject({ description: '被审核版本', videoUrl: 'video/submitted.mp4' })
    expect(result.readyForReview).toBe(false)
    expect(mocks.findEpisode).toHaveBeenCalled()
  })
})
