import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  findAssignment: vi.fn(),
  findLegacyEpisode: vi.fn(),
  findConfirmedStage: vi.fn(),
  requireProjectReader: vi.fn(),
  requireProjectAssignmentReviewer: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    workflowAssignment: { findFirst: mocks.findAssignment },
    novelPromotionEpisode: { findFirst: mocks.findLegacyEpisode },
    workflowStageState: { findFirst: mocks.findConfirmedStage },
  },
}))

vi.mock('@/lib/collaboration/access', () => ({
  getWorkspaceActor: () => ({ workspaceOwnerId: 'owner-1', actorId: 'actor-1', isManagement: false }),
  requireProjectReader: mocks.requireProjectReader,
  requireProjectAssignmentReviewer: mocks.requireProjectAssignmentReviewer,
}))

import {
  parseAssignmentNavigationIntent,
  parseLegacyAssignmentEpisodeNumber,
  validateAssignmentNavigation,
} from '@/lib/collaboration/assignment-navigation'

const assetAssignment = {
  uuid: 'assignment-1',
  projectId: 'project-1',
  scopeId: 'project',
  stage: 'asset',
  status: 'in_progress',
  matched: true,
  assigneeUserId: 'actor-1',
  episodeId: null,
  episode: null,
}

const session = {
  user: {
    id: 'actor-1',
    actorId: 'actor-1',
    workspaceOwnerId: 'owner-1',
    role: 'asset',
    status: 'active',
  },
}

describe('assignment navigation gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.findAssignment.mockResolvedValue(assetAssignment)
    mocks.requireProjectReader.mockResolvedValue({})
    mocks.requireProjectAssignmentReviewer.mockResolvedValue({})
    mocks.findLegacyEpisode.mockResolvedValue(null)
    mocks.findConfirmedStage.mockResolvedValue({ id: 'stage-1' })
  })

  it('parses only explicit navigation intents', () => {
    expect(parseAssignmentNavigationIntent('work')).toBe('work')
    expect(parseAssignmentNavigationIntent('review')).toBe('review')
    expect(parseAssignmentNavigationIntent('view')).toBe('view')
    expect(() => parseAssignmentNavigationIntent('edit')).toThrow('任务导航意图无效')
    expect(parseLegacyAssignmentEpisodeNumber('episode-12')).toBe(12)
    expect(parseLegacyAssignmentEpisodeNumber('第 3 集')).toBe(3)
    expect(parseLegacyAssignmentEpisodeNumber('episode-uuid-value')).toBeNull()
  })

  it('falls back to the project episode number for a legacy task without episodeId', async () => {
    mocks.findAssignment.mockResolvedValue({
      ...assetAssignment,
      stage: 'storyboard',
      scopeId: 'episode-2',
      episodeId: null,
      episode: null,
    })
    mocks.findLegacyEpisode.mockResolvedValue({
      id: 'resolved-episode-2',
      novelPromotionProject: { projectId: 'project-1' },
      storyboards: [],
    })

    await expect(validateAssignmentNavigation(
      { ...session, user: { ...session.user, role: 'storyboard' } } as never,
      'assignment-1',
      'view',
    )).resolves.toMatchObject({
      allowed: true,
      assignment: { episodeId: 'resolved-episode-2' },
    })
    expect(mocks.findLegacyEpisode).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        episodeNumber: 2,
        novelPromotionProject: { projectId: 'project-1' },
      },
    }))
  })

  it('validates project read access and current stage permission before work navigation', async () => {
    await expect(validateAssignmentNavigation(session as never, 'assignment-1', 'work')).resolves.toMatchObject({
      allowed: true,
      assignment: { id: 'assignment-1', projectId: 'project-1', stage: 'asset' },
    })
    expect(mocks.requireProjectReader).toHaveBeenCalledWith(session, 'project-1')

    await expect(validateAssignmentNavigation({ ...session, user: { ...session.user, role: 'writer' } } as never, 'assignment-1', 'work'))
      .rejects.toThrow('不再具有该任务阶段的编辑权限')
  })

  it('treats the script assignment as project-level and enforces writer permission', async () => {
    mocks.findAssignment.mockResolvedValue({
      ...assetAssignment,
      stage: 'script',
    })

    await expect(validateAssignmentNavigation(
      { ...session, user: { ...session.user, role: 'writer' } } as never,
      'assignment-1',
      'work',
    )).resolves.toMatchObject({
      allowed: true,
      assignment: { stage: 'script', episodeId: null },
    })
    expect(mocks.findLegacyEpisode).not.toHaveBeenCalled()

    await expect(validateAssignmentNavigation(session as never, 'assignment-1', 'work'))
      .rejects.toThrow('不再具有该任务阶段的编辑权限')
  })

  it('rejects a stale assignment or a missing cross-project episode', async () => {
    mocks.findAssignment.mockResolvedValueOnce({ ...assetAssignment, matched: false })
    await expect(validateAssignmentNavigation(session as never, 'assignment-1', 'view'))
      .rejects.toThrow('不再匹配当前项目内容')

    mocks.findAssignment.mockResolvedValueOnce({
      ...assetAssignment,
      stage: 'storyboard',
      episodeId: 'episode-1',
      episode: {
        id: 'episode-1',
        novelPromotionProject: { projectId: 'another-project' },
        storyboards: [],
      },
    })
    await expect(validateAssignmentNavigation({ ...session, user: { ...session.user, role: 'storyboard' } } as never, 'assignment-1', 'view'))
      .rejects.toThrow('不属于当前项目')
  })

  it('requires a generated and confirmed storyboard Panel before video navigation', async () => {
    const video = {
      ...assetAssignment,
      stage: 'video',
      episodeId: 'episode-1',
      episode: {
        id: 'episode-1',
        novelPromotionProject: { projectId: 'project-1' },
        storyboards: [{ panels: [] }],
      },
    }
    mocks.findAssignment.mockResolvedValueOnce(video)
    await expect(validateAssignmentNavigation({ ...session, user: { ...session.user, role: 'storyboard' } } as never, 'assignment-1', 'view'))
      .rejects.toThrow('尚未生成分镜 Panel')

    mocks.findAssignment.mockResolvedValue({
      ...video,
      episode: { ...video.episode, storyboards: [{ panels: [{ id: 'panel-1' }] }] },
    })
    mocks.findConfirmedStage.mockResolvedValueOnce(null)
    await expect(validateAssignmentNavigation({ ...session, user: { ...session.user, role: 'storyboard' } } as never, 'assignment-1', 'view'))
      .rejects.toThrow('请先确认本集分镜 Panel')

    await expect(validateAssignmentNavigation({ ...session, user: { ...session.user, role: 'storyboard' } } as never, 'assignment-1', 'view'))
      .resolves.toMatchObject({ allowed: true })
  })

  it('routes a canvas playlist video task without requiring an episode or storyboard Panel', async () => {
    mocks.findAssignment.mockResolvedValue({
      ...assetAssignment,
      stage: 'video',
      scopeId: 'canvas-playlist:canvas-1:playlist-1',
      episodeId: null,
      episode: null,
    })
    await expect(validateAssignmentNavigation(
      { ...session, user: { ...session.user, role: 'storyboard' } } as never,
      'assignment-1',
      'work',
    )).resolves.toMatchObject({
      allowed: true,
      assignment: {
        episodeId: null,
        scopeId: 'canvas-playlist:canvas-1:playlist-1',
      },
    })
    expect(mocks.findLegacyEpisode).not.toHaveBeenCalled()
    expect(mocks.findConfirmedStage).not.toHaveBeenCalled()
  })

  it('rechecks reviewer capability for pending-review navigation', async () => {
    mocks.findAssignment.mockResolvedValue({ ...assetAssignment, status: 'pending_review' })
    await expect(validateAssignmentNavigation(session as never, 'assignment-1', 'review')).resolves.toMatchObject({ allowed: true })
    expect(mocks.requireProjectAssignmentReviewer).toHaveBeenCalledWith(session, 'project-1')
  })
})
