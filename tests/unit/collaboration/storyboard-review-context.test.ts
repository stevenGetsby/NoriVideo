import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  findAssignment: vi.fn(),
  findSubmission: vi.fn(),
  findEpisode: vi.fn(),
  requireProjectReader: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    workflowAssignment: { findFirst: mocks.findAssignment },
    workflowAssignmentEvent: { findFirst: mocks.findSubmission },
    novelPromotionEpisode: { findUnique: mocks.findEpisode },
  },
}))

vi.mock('@/lib/collaboration/access', () => ({
  getWorkspaceActor: () => ({ workspaceOwnerId: 'owner-1', actorId: 'reviewer-1' }),
  requireProjectReader: mocks.requireProjectReader,
}))

import { getStoryboardReviewContext } from '@/lib/collaboration/storyboard-review'

const session = { user: { id: 'owner-1', actorId: 'reviewer-1', role: 'admin' } }

describe('storyboard review context', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireProjectReader.mockResolvedValue({ canReviewAssignments: true })
    mocks.findSubmission.mockResolvedValue(null)
    mocks.findAssignment.mockResolvedValue({
      uuid: 'assignment-1',
      projectId: 'project-1',
      episodeId: 'episode-1',
      status: 'pending_review',
      assigneeUserId: 'storyboard-1',
      submittedAt: new Date('2026-07-21T00:00:00.000Z'),
      lastReviewNote: null,
      project: { name: '项目一', work: { name: '作品一' } },
      episode: { episodeNumber: 1, name: '第一集' },
    })
    mocks.findEpisode.mockResolvedValue({
      id: 'episode-1',
      name: '第一集',
      storyboards: [{
        id: 'storyboard-1',
        createdAt: new Date('2026-07-20T00:00:00.000Z'),
        clip: { start: 0, location: '雨夜街道' },
        panels: [{
          id: 'panel-1',
          panelIndex: 0,
          panelNumber: 1,
          shotType: '近景',
          cameraMove: '缓慢推进',
          description: '角色抬头看向镜头',
          location: null,
          characters: '["苏晚卿"]',
          props: '["油灯"]',
          srtSegment: '她从角落惊醒。',
          duration: 3.5,
          imagePrompt: '雨夜，近景',
          imageUrl: 'images/panel-1.jpg',
          videoPrompt: '镜头缓慢推进',
        }],
      }],
    })
  })

  it('builds a read-only review surface from current panels for legacy submissions', async () => {
    const result = await getStoryboardReviewContext(session as never, 'assignment-1')

    expect(result.assignment).toMatchObject({ canReview: true, episodeNumber: 1 })
    expect(result.snapshotSource).toBe('live')
    expect(result.panels).toEqual([
      expect.objectContaining({
        panelId: 'panel-1',
        label: 'S01 · Segment 01',
        sourceText: '她从角落惊醒。',
        location: '雨夜街道',
        characters: ['苏晚卿'],
        props: ['油灯'],
      }),
    ])
  })

  it('reviews the submitted storyboard snapshot instead of later live edits', async () => {
    mocks.findSubmission.mockResolvedValue({
      createdAt: new Date('2026-07-21T00:00:00.000Z'),
      payload: {
        storyboardReviewSubmission: {
          version: 1,
          capturedAt: '2026-07-21T00:00:00.000Z',
          episodeId: 'episode-1',
          episodeName: '第一集',
          totalPanelCount: 1,
          panels: [{
            panelId: 'submitted-panel', storyboardId: 'storyboard-old', sequence: 1,
            sceneLabel: 'S01', segmentLabel: 'Segment 01', label: 'S01 · Segment 01',
            sourceText: '提交内容', description: '提交版本', location: null,
            shotType: null, cameraMove: null, durationSeconds: 4,
            imagePrompt: null, videoPrompt: null, characters: [], props: [], imageUrl: null,
          }],
        },
      },
    })

    const result = await getStoryboardReviewContext(session as never, 'assignment-1')

    expect(result.snapshotSource).toBe('submission')
    expect(result.panels[0]).toMatchObject({ panelId: 'submitted-panel', description: '提交版本' })
    expect(mocks.findEpisode).not.toHaveBeenCalled()
  })
})
