import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/api-errors'

const prismaMock = vi.hoisted(() => ({
  workflowAssignment: {
    count: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    updateMany: vi.fn(),
    upsert: vi.fn(),
  },
  workflowAssignmentEvent: {
    findMany: vi.fn(),
  },
  novelPromotionPanel: {
    findMany: vi.fn(),
  },
  project: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
  },
  projectMember: {
    findMany: vi.fn(),
  },
  user: {
    findMany: vi.fn(),
  },
  $transaction: vi.fn(),
}))

const accessMock = vi.hoisted(() => ({
  getWorkspaceActor: vi.fn(() => ({
    workspaceOwnerId: 'workspace-1',
    actorId: 'actor-1',
    isManagement: false,
  })),
  projectReadScopeWhere: vi.fn(() => ({ OR: [{ id: 'project-1' }] })),
  requireActiveWorkspaceUser: vi.fn(),
  requireProjectAssignmentManager: vi.fn(),
  requireProjectAssignmentReviewer: vi.fn(),
  requireProjectReader: vi.fn(),
  workspaceUserWhere: vi.fn(() => ({ OR: [] })),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/collaboration/access', () => accessMock)

const session = {
  user: {
    id: 'workspace-1',
    actorId: 'actor-1',
    role: 'writer' as const,
  },
}

function assignment(overrides: Record<string, unknown> = {}) {
  return {
    uuid: 'assignment-1',
    workspaceOwnerId: 'workspace-1',
    projectId: 'project-1',
    episodeId: null,
    scopeId: 'project',
    stage: 'asset',
    status: 'in_progress',
    assigneeUserId: 'actor-1',
    assignedById: 'manager-1',
    assignedAt: new Date('2026-07-17T00:00:00Z'),
    submittedAt: null,
    completedAt: null,
    lastReviewNote: null,
    submitCompletesDirectly: false,
    matched: true,
    sourceTaskId: null,
    createdAt: new Date('2026-07-17T00:00:00Z'),
    updatedAt: new Date('2026-07-17T00:00:00Z'),
    project: { collaborationMode: 'team' },
    ...overrides,
  }
}

function hydratedAssignment(overrides: Record<string, unknown> = {}) {
  const row = assignment(overrides)
  return {
    ...row,
    project: {
      id: 'project-1',
      name: 'Project',
      workId: 'work-1',
      createdById: 'manager-1',
      work: { id: 'work-1', name: 'Work', createdById: 'manager-1' },
    },
    episode: null,
    assignee: row.assigneeUserId
      ? { id: row.assigneeUserId, name: 'Assignee', role: 'admin', status: 'active' }
      : null,
  }
}

function episodeWithPanels(
  panels: Array<Record<string, unknown>>,
  options: { savedPanelIds?: string[] } = {},
) {
  const projectData = options.savedPanelIds
    ? JSON.stringify({
      episodeId: 'episode-1',
      config: { fps: 30, width: 1080, height: 1920 },
      timeline: options.savedPanelIds.map((panelId, index) => ({
        id: `clip-${index + 1}`,
        trim: { from: 0, to: 150 },
        durationInFrames: 150,
        metadata: { panelId },
      })),
    })
    : null
  return {
    id: 'episode-1',
    name: '第一集',
    editorProject: { outputUrl: null, projectData },
    storyboards: panels.length ? [{
      id: 'storyboard-1',
      createdAt: new Date('2026-07-17T00:00:00Z'),
      clip: { start: 0, location: '室内' },
      panels: panels.map((panel, index) => ({
        panelIndex: index,
        panelNumber: index + 1,
        shotType: null,
        cameraMove: null,
        description: `Segment ${index + 1}`,
        location: null,
        characters: '[]',
        props: '[]',
        srtSegment: null,
        duration: 5,
        imageUrl: null,
        videoPrompt: null,
        videoMedia: null,
        lipSyncVideoMedia: null,
        ...panel,
      })),
    }] : [],
  }
}

function submittedVideoReviewPayload() {
  return {
    reviewRound: 1,
    reviewSubmission: {
      version: 1,
      capturedAt: '2026-07-21T00:00:00.000Z',
      episodeId: 'episode-1',
      episodeName: '第一集',
      episodeOutputUrl: null,
      durationMs: 5_000,
      totalPanelCount: 1,
      readyPanelCount: 1,
      segments: [{
        panelId: 'panel-1',
        storyboardId: 'storyboard-1',
        sequence: 1,
        sceneLabel: 'S01',
        segmentLabel: 'Segment 01',
        label: 'S01 · Segment 01',
        description: '第一段',
        sourceText: null,
        videoPrompt: null,
        location: null,
        shotType: null,
        cameraMove: null,
        characters: [],
        props: [],
        imageUrl: null,
        videoUrl: 'https://cdn.example/video.mp4',
        startMs: 0,
        endMs: 5_000,
        durationMs: 5_000,
      }],
    },
  }
}

describe('workflow assignment service authorization and audit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    accessMock.getWorkspaceActor.mockReturnValue({
      workspaceOwnerId: 'workspace-1',
      actorId: 'actor-1',
      isManagement: false,
    })
    prismaMock.workflowAssignment.count.mockResolvedValue(0)
    prismaMock.workflowAssignment.findMany.mockResolvedValue([])
    prismaMock.workflowAssignment.updateMany.mockResolvedValue({ count: 0 })
    prismaMock.workflowAssignment.upsert.mockResolvedValue({})
    prismaMock.workflowAssignmentEvent.findMany.mockResolvedValue([])
    prismaMock.novelPromotionPanel.findMany.mockResolvedValue([])
    prismaMock.project.findFirst.mockResolvedValue(null)
    prismaMock.project.findMany.mockResolvedValue([])
    prismaMock.projectMember.findMany.mockResolvedValue([])
    prismaMock.user.findMany.mockResolvedValue([])
    accessMock.requireProjectReader.mockResolvedValue({
      canManageAssignments: false,
      canReviewAssignments: false,
    })
    accessMock.requireActiveWorkspaceUser.mockResolvedValue({
      id: 'actor-1',
      name: 'Active assignee',
      role: 'admin',
      status: 'active',
      workspaceOwnerId: 'workspace-1',
    })
  })

  it('uses the same matched-target filter for personal rows and totals', async () => {
    const { listMyAssignments } = await import('@/lib/collaboration/assignments')

    const result = await listMyAssignments(session, {
      tab: 'todo',
      page: 1,
      pageSize: 10,
      filters: {},
    })

    expect(result).toMatchObject({ assignments: [], total: 0 })
    expect(prismaMock.workflowAssignment.count).toHaveBeenCalledWith({
      where: expect.objectContaining({ matched: true, assigneeUserId: 'actor-1' }),
    })
    expect(prismaMock.workflowAssignment.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ matched: true, assigneeUserId: 'actor-1' }),
    }))
    expect(prismaMock.workflowAssignment.count).toHaveBeenCalledWith({
      where: expect.objectContaining({
        project: {
          is: {
            AND: expect.arrayContaining([{ OR: [{ id: 'project-1' }] }]),
          },
        },
      }),
    })
  })

  it('applies current project-read scope to every personal task count', async () => {
    const { getAssignmentCounts } = await import('@/lib/collaboration/assignments')

    await getAssignmentCounts(session, {})

    expect(prismaMock.workflowAssignment.count).toHaveBeenCalledTimes(3)
    for (const [input] of prismaMock.workflowAssignment.count.mock.calls) {
      expect(input).toEqual({
        where: expect.objectContaining({
          project: {
            is: {
              AND: expect.arrayContaining([{ OR: [{ id: 'project-1' }] }]),
            },
          },
        }),
      })
    }
  })

  it('returns a workspace-scoped assignment detail with its ordered audit timeline', async () => {
    const row = {
      ...assignment(),
      project: {
        id: 'project-1',
        name: 'Project',
        workId: 'work-1',
        createdById: 'manager-1',
        work: { id: 'work-1', name: 'Work', createdById: 'manager-1' },
      },
      episode: null,
      assignee: { id: 'actor-1', name: 'Writer', role: 'writer', status: 'active' },
    }
    prismaMock.workflowAssignment.findFirst.mockResolvedValue(row)
    prismaMock.workflowAssignmentEvent.findMany.mockResolvedValue([{
      id: 'event-1',
      eventType: 'submit',
      fromStatus: 'in_progress',
      toStatus: 'pending_review',
      note: '请审核',
      payload: null,
      createdAt: new Date('2026-07-17T01:00:00Z'),
      actor: { id: 'actor-1', name: 'Writer', role: 'writer', status: 'active' },
    }])
    const { getAssignmentDetail } = await import('@/lib/collaboration/assignments')

    const result = await getAssignmentDetail(session, 'assignment-1')

    expect(prismaMock.workflowAssignment.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { uuid: 'assignment-1', workspaceOwnerId: 'workspace-1' },
    }))
    expect(accessMock.requireProjectReader).toHaveBeenCalledWith(session, 'project-1')
    expect(prismaMock.workflowAssignmentEvent.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { assignmentUuid: 'assignment-1', workspaceOwnerId: 'workspace-1' },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    }))
    expect(result.events).toEqual([expect.objectContaining({
      id: 'event-1',
      eventType: 'submit',
      actorName: 'Writer',
      note: '请审核',
    })])
  })

  it('does not expose an assignment audit trail without project read access', async () => {
    prismaMock.workflowAssignment.findFirst.mockResolvedValue({
      ...assignment(),
      project: {
        id: 'project-1',
        name: 'Project',
        workId: 'work-1',
        createdById: 'manager-1',
        work: { id: 'work-1', name: 'Work', createdById: 'manager-1' },
      },
      episode: null,
      assignee: { id: 'actor-1', name: 'Writer', role: 'writer', status: 'active' },
    })
    accessMock.requireProjectReader.mockRejectedValueOnce(
      Object.assign(new Error('无权访问作品'), { code: 'FORBIDDEN' }),
    )
    const { getAssignmentDetail } = await import('@/lib/collaboration/assignments')

    await expect(getAssignmentDetail(session, 'assignment-1'))
      .rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(accessMock.requireProjectReader).toHaveBeenCalledWith(session, 'project-1')
    expect(prismaMock.workflowAssignmentEvent.findMany).not.toHaveBeenCalled()
  })

  it('does not synchronize or list project assignments without project read access', async () => {
    accessMock.requireProjectReader.mockRejectedValueOnce(
      Object.assign(new Error('无权访问作品'), { code: 'FORBIDDEN' }),
    )
    const { getProjectAssignmentOverview } = await import('@/lib/collaboration/assignments')

    await expect(getProjectAssignmentOverview(session, 'project-1'))
      .rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(accessMock.requireProjectReader).toHaveBeenCalledWith(session, 'project-1')
    expect(prismaMock.project.findFirst).not.toHaveBeenCalled()
    expect(prismaMock.workflowAssignment.findMany).not.toHaveBeenCalled()
  })

  it('synchronizes script, asset, storyboard, and video assignments from persisted production data', async () => {
    prismaMock.project.findFirst.mockResolvedValue({
      id: 'project-1',
      collaborationMode: 'team',
      novelPromotionData: {
        episodes: [
          { id: 'episode-1', novelText: '有剧本', clips: [], storyboards: [] },
          { id: 'episode-2', novelText: '', clips: [{ id: 'clip-1' }], storyboards: [{ panels: [{ id: 'panel-1' }] }] },
        ],
      },
    })
    prismaMock.$transaction.mockImplementation(async (operations: Array<Promise<unknown>>) => Promise.all(operations))
    const { syncProjectAssignmentsForProject } = await import('@/lib/collaboration/assignments')

    await syncProjectAssignmentsForProject({ projectId: 'project-1', workspaceOwnerId: 'workspace-1' })

    expect(prismaMock.workflowAssignment.upsert).toHaveBeenCalledTimes(6)
    expect(prismaMock.workflowAssignment.updateMany).toHaveBeenCalledWith({
      where: {
        workspaceOwnerId: 'workspace-1',
        projectId: 'project-1',
        matched: true,
        AND: [
          {
            NOT: {
              OR: [
                { scopeId: 'project', stage: 'script' },
                { scopeId: 'project', stage: 'asset' },
                { scopeId: 'episode-1', stage: 'storyboard' },
                { scopeId: 'episode-1', stage: 'video' },
                { scopeId: 'episode-2', stage: 'storyboard' },
                { scopeId: 'episode-2', stage: 'video' },
              ],
            },
          },
          { NOT: { scopeId: { startsWith: 'canvas-playlist:' } } },
        ],
      },
      data: { matched: false },
    })
    expect(prismaMock.workflowAssignment.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { projectId_scopeId_stage: { projectId: 'project-1', scopeId: 'project', stage: 'script' } },
      update: { episodeId: null, matched: true, submitCompletesDirectly: false },
      create: expect.objectContaining({
        stage: 'script',
        events: {
          create: expect.objectContaining({
            eventType: 'created',
            payload: expect.objectContaining({ stage: 'script', scopeId: 'project' }),
          }),
        },
      }),
    }))
    expect(prismaMock.workflowAssignment.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { projectId_scopeId_stage: { projectId: 'project-1', scopeId: 'project', stage: 'asset' } },
      update: { episodeId: null, matched: true, submitCompletesDirectly: false },
      create: expect.objectContaining({
        stage: 'asset',
        events: {
          create: {
            workspaceOwnerId: 'workspace-1',
            eventType: 'created',
            toStatus: 'unassigned',
            payload: {
              source: 'project_sync',
              stage: 'asset',
              scopeId: 'project',
            },
          },
        },
      }),
    }))
    expect(prismaMock.workflowAssignment.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { projectId_scopeId_stage: { projectId: 'project-1', scopeId: 'episode-1', stage: 'storyboard' } },
      update: { episodeId: 'episode-1', matched: true, submitCompletesDirectly: true },
    }))
    expect(prismaMock.workflowAssignment.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { projectId_scopeId_stage: { projectId: 'project-1', scopeId: 'episode-1', stage: 'video' } },
      update: { episodeId: 'episode-1', matched: false, submitCompletesDirectly: false },
    }))
    expect(prismaMock.workflowAssignment.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { projectId_scopeId_stage: { projectId: 'project-1', scopeId: 'episode-2', stage: 'video' } },
      update: { episodeId: 'episode-2', matched: true, submitCompletesDirectly: false },
    }))
    expect(prismaMock.workflowAssignment.updateMany).toHaveBeenCalledWith({
      where: {
        workspaceOwnerId: 'workspace-1',
        projectId: 'project-1',
        stage: 'storyboard',
        status: 'pending_review',
      },
      data: {
        status: 'completed',
        submitCompletesDirectly: true,
        completedAt: expect.any(Date),
      },
    })
  })

  it('hides stale assignments when a project no longer uses task collaboration', async () => {
    prismaMock.project.findFirst.mockResolvedValue({
      id: 'project-1',
      collaborationMode: 'solo',
      novelPromotionData: { episodes: [] },
    })
    const { syncProjectAssignmentsForProject } = await import('@/lib/collaboration/assignments')

    await syncProjectAssignmentsForProject({ projectId: 'project-1', workspaceOwnerId: 'workspace-1' })

    expect(prismaMock.workflowAssignment.updateMany).toHaveBeenCalledWith({
      where: { workspaceOwnerId: 'workspace-1', projectId: 'project-1', matched: true },
      data: { matched: false },
    })
    expect(prismaMock.workflowAssignment.upsert).not.toHaveBeenCalled()
  })

  it('rejects a non-assignee without project management permission', async () => {
    prismaMock.workflowAssignment.findFirst.mockResolvedValue(assignment({ assigneeUserId: 'actor-2' }))
    const { mutateAssignment } = await import('@/lib/collaboration/assignments')

    await expect(mutateAssignment(session, 'submit', { assignmentId: 'assignment-1' }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })

  it('allows a project manager to submit on behalf of the current assignee', async () => {
    const current = assignment({ assigneeUserId: 'actor-2' })
    prismaMock.workflowAssignment.findFirst.mockResolvedValue(current)
    prismaMock.workflowAssignment.findUnique.mockResolvedValue(hydratedAssignment({
      status: 'pending_review',
      assigneeUserId: 'actor-2',
    }))
    accessMock.requireProjectReader.mockResolvedValueOnce({
      canManageAssignments: true,
      canReviewAssignments: true,
    })
    const transaction = {
      workflowAssignment: {
        findFirst: vi.fn().mockResolvedValue(current),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      projectMember: { upsert: vi.fn() },
      workflowAssignmentEvent: {
        count: vi.fn().mockResolvedValue(0),
        create: vi.fn().mockResolvedValue({}),
      },
    }
    prismaMock.$transaction.mockImplementation(async (callback: (tx: typeof transaction) => unknown) => callback(transaction))
    const { mutateAssignment } = await import('@/lib/collaboration/assignments')

    const result = await mutateAssignment(session, 'submit', { assignmentId: 'assignment-1' })

    expect(result.status).toBe('pending_review')
    expect(accessMock.requireActiveWorkspaceUser).not.toHaveBeenCalled()
    expect(transaction.workflowAssignmentEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorUserId: 'actor-1',
        eventType: 'submit',
        fromStatus: 'in_progress',
        toStatus: 'pending_review',
      }),
    })
  })

  it.each([
    {
      label: 'unmatched',
      overrides: { matched: false },
    },
    {
      label: 'solo project',
      overrides: { project: { collaborationMode: 'solo' } },
    },
  ])('rejects a known assignment UUID after it becomes $label', async ({ overrides }) => {
    prismaMock.workflowAssignment.findFirst.mockResolvedValue(assignment(overrides))
    const { mutateAssignment } = await import('@/lib/collaboration/assignments')

    await expect(mutateAssignment(session, 'submit', { assignmentId: 'assignment-1' }))
      .rejects.toMatchObject({
        code: 'CONFLICT',
        message: '该任务已失效或作品已关闭任务分工，请刷新任务列表。',
      })
    expect(accessMock.requireProjectReader).not.toHaveBeenCalled()
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })

  it('rechecks matched and team mode inside the mutation transaction', async () => {
    const current = assignment({ assigneeUserId: 'actor-1' })
    prismaMock.workflowAssignment.findFirst.mockResolvedValue(current)
    const transaction = {
      workflowAssignment: {
        findFirst: vi.fn().mockResolvedValue(null),
        updateMany: vi.fn(),
      },
      projectMember: { upsert: vi.fn() },
      workflowAssignmentEvent: { create: vi.fn() },
    }
    prismaMock.$transaction.mockImplementation(async (callback: (tx: typeof transaction) => unknown) => callback(transaction))
    const { mutateAssignment } = await import('@/lib/collaboration/assignments')

    await expect(mutateAssignment(session, 'submit', { assignmentId: 'assignment-1' }))
      .rejects.toMatchObject({ code: 'CONFLICT' })
    expect(transaction.workflowAssignment.findFirst).toHaveBeenCalledWith({
      where: {
        uuid: 'assignment-1',
        workspaceOwnerId: 'workspace-1',
        matched: true,
        project: { is: { collaborationMode: 'team' } },
      },
    })
    expect(transaction.workflowAssignment.updateMany).not.toHaveBeenCalled()
    expect(transaction.workflowAssignmentEvent.create).not.toHaveBeenCalled()
  })

  it('does not let a removed project member submit through a known assignment id', async () => {
    prismaMock.workflowAssignment.findFirst.mockResolvedValue(assignment({ assigneeUserId: 'actor-1' }))
    accessMock.requireProjectReader.mockRejectedValueOnce(
      new ApiError('FORBIDDEN', { message: '当前账号没有访问该作品的权限。' }),
    )
    const { mutateAssignment } = await import('@/lib/collaboration/assignments')

    await expect(mutateAssignment(session, 'submit', { assignmentId: 'assignment-1' }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(accessMock.requireProjectReader).toHaveBeenCalledWith(session, 'project-1')
    expect(accessMock.requireActiveWorkspaceUser).not.toHaveBeenCalled()
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })

  it('rejects submit when the assignee no longer has the task-stage write permission', async () => {
    prismaMock.workflowAssignment.findFirst.mockResolvedValue(assignment({
      stage: 'asset',
      assigneeUserId: 'actor-1',
    }))
    accessMock.requireActiveWorkspaceUser.mockResolvedValueOnce({
      id: 'actor-1',
      name: 'Writer after role change',
      role: 'writer',
      status: 'active',
      workspaceOwnerId: 'workspace-1',
    })
    const { mutateAssignment } = await import('@/lib/collaboration/assignments')

    await expect(mutateAssignment(session, 'submit', { assignmentId: 'assignment-1' }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })

  it('rejects submit when the assignee account is no longer active', async () => {
    prismaMock.workflowAssignment.findFirst.mockResolvedValue(assignment({ assigneeUserId: 'actor-1' }))
    accessMock.requireActiveWorkspaceUser.mockRejectedValueOnce(
      new ApiError('INVALID_PARAMS', { message: '账号已停用' }),
    )
    const { mutateAssignment } = await import('@/lib/collaboration/assignments')

    await expect(mutateAssignment(session, 'submit', { assignmentId: 'assignment-1' }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })

  it('rejects assigning a task to an account without the stage write permission', async () => {
    prismaMock.workflowAssignment.findFirst.mockResolvedValue(assignment({ stage: 'asset', status: 'unassigned', assigneeUserId: null }))
    accessMock.requireActiveWorkspaceUser.mockResolvedValue({
      id: 'writer-1',
      name: 'Writer',
      role: 'writer',
      status: 'active',
      workspaceOwnerId: 'workspace-1',
    })
    const { mutateAssignment } = await import('@/lib/collaboration/assignments')

    await expect(mutateAssignment(session, 'assign', {
      assignmentId: 'assignment-1',
      assigneeUserId: 'writer-1',
    })).rejects.toMatchObject({ code: 'INVALID_PARAMS' })
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })

  it('filters assignment candidates by the selected task stage capability', async () => {
    accessMock.requireProjectAssignmentManager.mockResolvedValue({
      actor: { workspaceOwnerId: 'workspace-1', actorId: 'actor-1', isManagement: true },
    })
    prismaMock.user.findMany.mockResolvedValue([
      { id: 'admin-1', name: 'Admin', role: 'admin', status: 'active' },
      { id: 'writer-1', name: 'Writer', role: 'writer', status: 'active' },
      { id: 'asset-1', name: 'Asset', role: 'asset', status: 'active' },
      { id: 'storyboard-1', name: 'Storyboard', role: 'storyboard', status: 'active' },
    ])
    const { listAssignmentCandidates } = await import('@/lib/collaboration/assignments')

    const assetCandidates = await listAssignmentCandidates(session, 'project-1', 'asset')
    const scriptCandidates = await listAssignmentCandidates(session, 'project-1', 'script')
    const storyboardCandidates = await listAssignmentCandidates(session, 'project-1', 'storyboard')

    expect(assetCandidates.map((candidate) => candidate.userId)).toEqual(['admin-1', 'asset-1'])
    expect(scriptCandidates.map((candidate) => candidate.userId)).toEqual(['admin-1', 'writer-1'])
    expect(storyboardCandidates.map((candidate) => candidate.userId)).toEqual(['admin-1', 'storyboard-1'])
    expect(assetCandidates[0]?.eligibleStages).toEqual(['script', 'asset', 'storyboard', 'video'])
  })

  it('rejects stale or illegal transitions before writing an event', async () => {
    const current = assignment({ status: 'completed' })
    prismaMock.workflowAssignment.findFirst.mockResolvedValue(current)
    const transaction = {
      workflowAssignment: {
        findFirst: vi.fn().mockResolvedValue(current),
        updateMany: vi.fn(),
      },
      projectMember: { upsert: vi.fn() },
      workflowAssignmentEvent: { create: vi.fn() },
    }
    prismaMock.$transaction.mockImplementation(async (callback: (tx: typeof transaction) => unknown) => callback(transaction))
    const { mutateAssignment } = await import('@/lib/collaboration/assignments')

    await expect(mutateAssignment(session, 'submit', { assignmentId: 'assignment-1' }))
      .rejects.toMatchObject({ code: 'CONFLICT' })
    expect(transaction.workflowAssignment.updateMany).not.toHaveBeenCalled()
    expect(transaction.workflowAssignmentEvent.create).not.toHaveBeenCalled()
  })

  it('rejects a concurrent same-state reassignment when updatedAt is stale', async () => {
    const current = assignment({
      status: 'in_progress',
      assigneeUserId: 'actor-1',
      updatedAt: new Date('2026-07-17T00:00:00.000Z'),
    })
    prismaMock.workflowAssignment.findFirst.mockResolvedValue(current)
    const transaction = {
      workflowAssignment: {
        findFirst: vi.fn().mockResolvedValue(current),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      projectMember: { upsert: vi.fn().mockResolvedValue({}) },
      workflowAssignmentEvent: { create: vi.fn() },
    }
    prismaMock.$transaction.mockImplementation(async (callback: (tx: typeof transaction) => unknown) => callback(transaction))
    const { mutateAssignment } = await import('@/lib/collaboration/assignments')

    await expect(mutateAssignment(session, 'assign', {
      assignmentId: 'assignment-1',
      assigneeUserId: 'actor-2',
    })).rejects.toMatchObject({
      code: 'CONFLICT',
      message: '任务已被其他操作更新，请刷新后重试。',
    })

    expect(transaction.workflowAssignment.updateMany).toHaveBeenCalledWith({
      where: {
        uuid: 'assignment-1',
        status: 'in_progress',
        updatedAt: current.updatedAt,
      },
      data: expect.objectContaining({
        status: 'in_progress',
        assigneeUserId: 'actor-2',
        updatedAt: expect.any(Date),
      }),
    })
    const updateData = transaction.workflowAssignment.updateMany.mock.calls[0]?.[0]?.data
    expect(updateData.updatedAt.getTime()).toBeGreaterThan(current.updatedAt.getTime())
    expect(transaction.workflowAssignmentEvent.create).not.toHaveBeenCalled()
  })

  it.each([
    {
      action: 'assign' as const,
      currentStatus: 'rejected',
      nextStatus: 'in_progress',
      input: { assignmentId: 'assignment-1', assigneeUserId: 'actor-2' },
    },
    {
      action: 'mark-complete' as const,
      currentStatus: 'rejected',
      nextStatus: 'completed',
      input: { assignmentId: 'assignment-1' },
    },
    {
      action: 'reopen' as const,
      currentStatus: 'completed',
      nextStatus: 'in_progress',
      input: { assignmentId: 'assignment-1' },
    },
  ])('clears stale review notes for $action', async ({ action, currentStatus, nextStatus, input }) => {
    const current = assignment({
      status: currentStatus,
      lastReviewNote: '上一轮驳回原因',
    })
    prismaMock.workflowAssignment.findFirst.mockResolvedValue(current)
    prismaMock.workflowAssignment.findUnique.mockResolvedValue(hydratedAssignment({
      status: nextStatus,
      assigneeUserId: action === 'assign' ? 'actor-2' : current.assigneeUserId,
      lastReviewNote: null,
    }))
    const transaction = {
      workflowAssignment: {
        findFirst: vi.fn().mockResolvedValue(current),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      projectMember: { upsert: vi.fn().mockResolvedValue({}) },
      workflowAssignmentEvent: { create: vi.fn().mockResolvedValue({}) },
    }
    prismaMock.$transaction.mockImplementation(async (callback: (tx: typeof transaction) => unknown) => callback(transaction))
    const { mutateAssignment } = await import('@/lib/collaboration/assignments')

    await mutateAssignment(session, action, input)

    expect(transaction.workflowAssignment.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: nextStatus,
        lastReviewNote: null,
      }),
    }))
  })

  it('reports batch assignment partial success per task', async () => {
    const current = assignment({ status: 'unassigned', assigneeUserId: null })
    prismaMock.workflowAssignment.findFirst
      .mockResolvedValueOnce(current)
      .mockResolvedValueOnce(null)
    prismaMock.workflowAssignment.findUnique.mockResolvedValue(hydratedAssignment({
      status: 'in_progress',
      assigneeUserId: 'actor-2',
    }))
    const transaction = {
      workflowAssignment: {
        findFirst: vi.fn().mockResolvedValue(current),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      projectMember: { upsert: vi.fn().mockResolvedValue({}) },
      workflowAssignmentEvent: { create: vi.fn().mockResolvedValue({}) },
    }
    prismaMock.$transaction.mockImplementation(async (callback: (tx: typeof transaction) => unknown) => callback(transaction))
    const { mutateAssignmentsBatch } = await import('@/lib/collaboration/assignments')

    const result = await mutateAssignmentsBatch(session, 'assign', {
      assignmentIds: ['assignment-1', 'missing-assignment'],
      assigneeUserId: 'actor-2',
    })

    expect(result).toEqual({
      results: [
        { assignmentId: 'assignment-1', ok: true },
        { assignmentId: 'missing-assignment', ok: false, error: '协作任务不存在。' },
      ],
      total: 2,
      okCount: 1,
    })
  })

  it('rejects a video submission when the assignment is not linked to an episode', async () => {
    const current = assignment({
      stage: 'video',
      episodeId: null,
      assigneeUserId: 'actor-1',
    })
    prismaMock.workflowAssignment.findFirst.mockResolvedValue(current)
    const transaction = {
      workflowAssignment: {
        findFirst: vi.fn().mockResolvedValue(current),
        updateMany: vi.fn(),
      },
      novelPromotionPanel: { findMany: vi.fn() },
      projectMember: { upsert: vi.fn() },
      workflowAssignmentEvent: { create: vi.fn() },
    }
    prismaMock.$transaction.mockImplementation(async (callback: (tx: typeof transaction) => unknown) => callback(transaction))
    const { mutateAssignment } = await import('@/lib/collaboration/assignments')

    await expect(mutateAssignment(session, 'submit', { assignmentId: 'assignment-1' }))
      .rejects.toMatchObject({
        code: 'CONFLICT',
        message: '视频任务未关联分集，无法提交审核。请刷新任务列表后重试。',
      })
    expect(transaction.novelPromotionPanel.findMany).not.toHaveBeenCalled()
    expect(transaction.workflowAssignment.updateMany).not.toHaveBeenCalled()
    expect(transaction.workflowAssignmentEvent.create).not.toHaveBeenCalled()
  })

  it('rejects a video submission when the episode has no storyboard panels', async () => {
    const current = assignment({
      stage: 'video',
      episodeId: 'episode-1',
      assigneeUserId: 'actor-1',
    })
    prismaMock.workflowAssignment.findFirst.mockResolvedValue(current)
    const transaction = {
      workflowAssignment: {
        findFirst: vi.fn().mockResolvedValue(current),
        updateMany: vi.fn(),
      },
      novelPromotionEpisode: { findUnique: vi.fn().mockResolvedValue(episodeWithPanels([])) },
      projectMember: { upsert: vi.fn() },
      workflowAssignmentEvent: { create: vi.fn() },
    }
    prismaMock.$transaction.mockImplementation(async (callback: (tx: typeof transaction) => unknown) => callback(transaction))
    const { mutateAssignment } = await import('@/lib/collaboration/assignments')

    await expect(mutateAssignment(session, 'submit', { assignmentId: 'assignment-1' }))
      .rejects.toMatchObject({
        code: 'CONFLICT',
        message: '本集还没有 Segment，无法提交视频审核。请先完成分镜设计和视频制作。',
      })
    expect(transaction.novelPromotionEpisode.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'episode-1' } }))
    expect(transaction.workflowAssignment.updateMany).not.toHaveBeenCalled()
    expect(transaction.workflowAssignmentEvent.create).not.toHaveBeenCalled()
  })

  it('captures an immutable storyboard snapshot when submitting a storyboard task', async () => {
    const current = assignment({
      stage: 'storyboard',
      episodeId: 'episode-1',
      assigneeUserId: 'actor-1',
    })
    prismaMock.workflowAssignment.findFirst.mockResolvedValue(current)
    prismaMock.workflowAssignment.findUnique.mockResolvedValue(hydratedAssignment({
      stage: 'storyboard',
      status: 'completed',
      episodeId: 'episode-1',
      assigneeUserId: 'actor-1',
      submitCompletesDirectly: true,
    }))
    const transaction = {
      workflowAssignment: {
        findFirst: vi.fn().mockResolvedValue(current),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      novelPromotionEpisode: {
        findUnique: vi.fn().mockResolvedValue(episodeWithPanels([
          { id: 'panel-1', imageUrl: 'https://cdn.example/panel.jpg', imagePrompt: '雨夜近景' },
        ])),
      },
      projectMember: { upsert: vi.fn() },
      workflowAssignmentEvent: {
        count: vi.fn().mockResolvedValue(0),
        create: vi.fn().mockResolvedValue({}),
      },
    }
    prismaMock.$transaction.mockImplementation(async (callback: (tx: typeof transaction) => unknown) => callback(transaction))
    const { mutateAssignment } = await import('@/lib/collaboration/assignments')

    const result = await mutateAssignment(session, 'submit', { assignmentId: 'assignment-1' })

    expect(transaction.workflowAssignmentEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        assignmentUuid: 'assignment-1',
        eventType: 'submit',
        payload: expect.objectContaining({
          reviewRound: 1,
          storyboardReviewSubmission: expect.objectContaining({
            version: 1,
            episodeId: 'episode-1',
            totalPanelCount: 1,
            panels: [expect.objectContaining({
              panelId: 'panel-1',
              label: 'S01 · Segment 01',
              imagePrompt: '雨夜近景',
            })],
          }),
        }),
      }),
    })
    expect(transaction.workflowAssignment.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'completed' }),
    }))
    expect(result.status).toBe('completed')
  })

  it('rejects approve and reject on storyboard assignments', async () => {
    prismaMock.workflowAssignment.findFirst.mockResolvedValue(assignment({
      stage: 'storyboard',
      status: 'pending_review',
      episodeId: 'episode-1',
    }))
    const { mutateAssignment } = await import('@/lib/collaboration/assignments')

    await expect(mutateAssignment(session, 'approve', { assignmentId: 'assignment-1' }))
      .rejects.toMatchObject({ code: 'CONFLICT', message: '分镜任务不再进入审核，请在任务中标记完成。' })
    await expect(mutateAssignment(session, 'reject', { assignmentId: 'assignment-1', note: '改一下' }))
      .rejects.toMatchObject({ code: 'CONFLICT', message: '分镜任务不再进入审核，请在任务中标记完成。' })
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })

  it('requires the assignee to save the edit before submitting video review', async () => {
    const current = assignment({
      stage: 'video',
      episodeId: 'episode-1',
      assigneeUserId: 'actor-1',
    })
    prismaMock.workflowAssignment.findFirst.mockResolvedValue(current)
    const transaction = {
      workflowAssignment: {
        findFirst: vi.fn().mockResolvedValue(current),
        updateMany: vi.fn(),
      },
      novelPromotionEpisode: {
        findUnique: vi.fn().mockResolvedValue(episodeWithPanels([
          { id: 'panel-video', videoUrl: 'https://cdn.example/video.mp4', lipSyncVideoUrl: null },
          { id: 'panel-lipsync', videoUrl: null, lipSyncVideoUrl: 'https://cdn.example/lipsync.mp4' },
          { id: 'panel-missing', videoUrl: '   ', lipSyncVideoUrl: null },
        ])),
      },
      task: { count: vi.fn().mockResolvedValue(0) },
      projectMember: { upsert: vi.fn() },
      workflowAssignmentEvent: { create: vi.fn() },
    }
    prismaMock.$transaction.mockImplementation(async (callback: (tx: typeof transaction) => unknown) => callback(transaction))
    const { mutateAssignment } = await import('@/lib/collaboration/assignments')

    await expect(mutateAssignment(session, 'submit', { assignmentId: 'assignment-1' }))
      .rejects.toMatchObject({
        code: 'CONFLICT',
        message: '请先进入剪辑页保存本集剪辑，再提交审核。',
        details: expect.objectContaining({
          episodeId: 'episode-1',
          panelCount: 3,
        }),
      })
    expect(transaction.workflowAssignment.updateMany).not.toHaveBeenCalled()
    expect(transaction.workflowAssignmentEvent.create).not.toHaveBeenCalled()
  })

  it.each([
    { currentStatus: 'in_progress', label: '首次提交' },
    { currentStatus: 'rejected', label: '驳回后重新提交' },
  ])('accepts a complete episode video on $label', async ({ currentStatus }) => {
    const current = assignment({
      stage: 'video',
      status: currentStatus,
      episodeId: 'episode-1',
      assigneeUserId: 'actor-1',
      lastReviewNote: currentStatus === 'rejected' ? '请修改镜头节奏' : null,
    })
    prismaMock.workflowAssignment.findFirst.mockResolvedValue(current)
    prismaMock.workflowAssignment.findUnique.mockResolvedValue(hydratedAssignment({
      stage: 'video',
      status: 'pending_review',
      episodeId: 'episode-1',
      assigneeUserId: 'actor-1',
      lastReviewNote: currentStatus === 'rejected' ? '请修改镜头节奏' : null,
    }))
    const transaction = {
      workflowAssignment: {
        findFirst: vi.fn().mockResolvedValue(current),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      novelPromotionEpisode: {
        findUnique: vi.fn().mockResolvedValue(episodeWithPanels([
          { id: 'panel-video', videoUrl: 'https://cdn.example/video.mp4', lipSyncVideoUrl: null },
          { id: 'panel-lipsync', videoUrl: null, lipSyncVideoUrl: 'https://cdn.example/lipsync.mp4' },
        ], { savedPanelIds: ['panel-video', 'panel-lipsync'] })),
      },
      task: { count: vi.fn().mockResolvedValue(0) },
      videoReviewAnnotation: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
      projectMember: { upsert: vi.fn() },
      workflowAssignmentEvent: {
        count: vi.fn().mockResolvedValue(0),
        create: vi.fn().mockResolvedValue({}),
      },
    }
    prismaMock.$transaction.mockImplementation(async (callback: (tx: typeof transaction) => unknown) => callback(transaction))
    const { mutateAssignment } = await import('@/lib/collaboration/assignments')

    const result = await mutateAssignment(session, 'submit', { assignmentId: 'assignment-1' })

    expect(transaction.novelPromotionEpisode.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'episode-1' } }))
    expect(transaction.task.count).toHaveBeenCalledWith({
      where: {
        targetType: 'NovelPromotionPanel',
        targetId: { in: ['panel-video', 'panel-lipsync'] },
        type: { in: ['video_panel', 'lip_sync'] },
        status: { in: ['queued', 'processing'] },
      },
    })
    expect(transaction.workflowAssignment.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        uuid: 'assignment-1',
        status: currentStatus,
        updatedAt: current.updatedAt,
      }),
      data: currentStatus === 'rejected'
        ? expect.not.objectContaining({ lastReviewNote: null })
        : expect.objectContaining({ lastReviewNote: null }),
    }))
    expect(transaction.workflowAssignment.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: 'pending_review',
        submittedAt: expect.any(Date),
      }),
    }))
    expect(transaction.videoReviewAnnotation.updateMany).toHaveBeenCalledWith({
      where: { assignmentUuid: 'assignment-1', status: 'open' },
      data: { status: 'resolved', resolvedAt: expect.any(Date) },
    })
    expect(result.status).toBe('pending_review')
  })

  it('accepts a saved partial edit without waiting for unused Segments or active generation tasks', async () => {
    const current = assignment({
      stage: 'video',
      episodeId: 'episode-1',
      assigneeUserId: 'actor-1',
    })
    prismaMock.workflowAssignment.findFirst.mockResolvedValue(current)
    prismaMock.workflowAssignment.findUnique.mockResolvedValue(hydratedAssignment({
      stage: 'video',
      status: 'pending_review',
      episodeId: 'episode-1',
      assigneeUserId: 'actor-1',
    }))
    const transaction = {
      workflowAssignment: {
        findFirst: vi.fn().mockResolvedValue(current),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      novelPromotionEpisode: {
        findUnique: vi.fn().mockResolvedValue(episodeWithPanels([
          { id: 'panel-old-video', videoUrl: 'https://cdn.example/old.mp4', lipSyncVideoUrl: null },
          { id: 'panel-unused', videoUrl: null, lipSyncVideoUrl: null },
        ], { savedPanelIds: ['panel-old-video'] })),
      },
      task: { count: vi.fn().mockResolvedValue(1) },
      videoReviewAnnotation: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
      projectMember: { upsert: vi.fn() },
      workflowAssignmentEvent: {
        count: vi.fn().mockResolvedValue(0),
        create: vi.fn().mockResolvedValue({}),
      },
    }
    prismaMock.$transaction.mockImplementation(async (callback: (tx: typeof transaction) => unknown) => callback(transaction))
    const { mutateAssignment } = await import('@/lib/collaboration/assignments')

    const result = await mutateAssignment(session, 'submit', { assignmentId: 'assignment-1' })

    expect(result.status).toBe('pending_review')
    expect(transaction.workflowAssignment.updateMany).toHaveBeenCalled()
    expect(transaction.workflowAssignmentEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        payload: expect.objectContaining({
          reviewSubmission: expect.objectContaining({
            segments: [expect.objectContaining({ panelId: 'panel-old-video' })],
          }),
        }),
      }),
    })
  })

  it('lets the same assignee resubmit a rejected task without manager intervention', async () => {
    const current = assignment({ status: 'rejected', lastReviewNote: '请调整镜头节奏' })
    const pendingReview = {
      ...assignment({
        status: 'pending_review',
        submittedAt: new Date('2026-07-17T01:00:00Z'),
        lastReviewNote: '请调整镜头节奏',
      }),
      project: {
        id: 'project-1',
        name: 'Project',
        workId: 'work-1',
        createdById: 'manager-1',
        work: { id: 'work-1', name: 'Work', createdById: 'manager-1' },
      },
      episode: null,
      assignee: { id: 'actor-1', name: 'Writer', role: 'writer', status: 'active' },
    }
    prismaMock.workflowAssignment.findFirst.mockResolvedValue(current)
    prismaMock.workflowAssignment.findUnique.mockResolvedValue(pendingReview)
    prismaMock.project.findMany.mockResolvedValue([])
    const transaction = {
      workflowAssignment: {
        findFirst: vi.fn().mockResolvedValue(current),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      projectMember: { upsert: vi.fn() },
      workflowAssignmentEvent: { create: vi.fn().mockResolvedValue({}) },
    }
    prismaMock.$transaction.mockImplementation(async (callback: (tx: typeof transaction) => unknown) => callback(transaction))
    const { mutateAssignment } = await import('@/lib/collaboration/assignments')

    const result = await mutateAssignment(session, 'submit', { assignmentId: 'assignment-1' })

    expect(accessMock.requireProjectAssignmentManager).not.toHaveBeenCalled()
    expect(transaction.workflowAssignment.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        uuid: 'assignment-1',
        status: 'rejected',
        updatedAt: current.updatedAt,
      }),
      data: expect.objectContaining({
        status: 'pending_review',
        submittedAt: expect.any(Date),
        lastReviewNote: null,
      }),
    }))
    expect(transaction.workflowAssignmentEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        assignmentUuid: 'assignment-1',
        eventType: 'submit',
        fromStatus: 'rejected',
        toStatus: 'pending_review',
      }),
    })
    expect(result.status).toBe('pending_review')
  })

  it('atomically approves a pending review and records the reviewer note', async () => {
    const current = assignment({ status: 'pending_review' })
    const completed = {
      ...assignment({ status: 'completed', completedAt: new Date('2026-07-17T01:00:00Z'), lastReviewNote: '通过' }),
      project: {
        id: 'project-1',
        name: 'Project',
        workId: 'work-1',
        createdById: 'manager-1',
        work: { id: 'work-1', name: 'Work', createdById: 'manager-1' },
      },
      episode: null,
      assignee: { id: 'actor-2', name: 'Writer', role: 'writer', status: 'active' },
    }
    prismaMock.workflowAssignment.findFirst.mockResolvedValue(current)
    prismaMock.workflowAssignment.findUnique.mockResolvedValue(completed)
    prismaMock.project.findMany.mockResolvedValue([{
      id: 'project-1',
      createdById: 'manager-1',
      work: { createdById: 'manager-1', members: [] },
      members: [{ canManageAssignments: false, canReviewAssignments: true }],
    }])
    const transaction = {
      workflowAssignment: {
        findFirst: vi.fn().mockResolvedValue(current),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      projectMember: { upsert: vi.fn() },
      workflowAssignmentEvent: { create: vi.fn().mockResolvedValue({}) },
    }
    prismaMock.$transaction.mockImplementation(async (callback: (tx: typeof transaction) => unknown) => callback(transaction))
    const { mutateAssignment } = await import('@/lib/collaboration/assignments')

    const result = await mutateAssignment(session, 'approve', { assignmentId: 'assignment-1', note: '通过' })

    expect(accessMock.requireProjectAssignmentReviewer).toHaveBeenCalledWith(session, 'project-1')
    expect(transaction.workflowAssignment.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        uuid: 'assignment-1',
        status: 'pending_review',
        updatedAt: current.updatedAt,
      }),
      data: expect.objectContaining({ status: 'completed', lastReviewNote: '通过' }),
    }))
    expect(transaction.workflowAssignmentEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        assignmentUuid: 'assignment-1',
        eventType: 'approve',
        fromStatus: 'pending_review',
        toStatus: 'completed',
        note: '通过',
      }),
    })
    expect(result.status).toBe('completed')
  })

  it('requires an actionable modification note when rejecting a non-video submission', async () => {
    prismaMock.workflowAssignment.findFirst.mockResolvedValue(assignment({ status: 'pending_review' }))
    const { mutateAssignment } = await import('@/lib/collaboration/assignments')

    await expect(mutateAssignment(session, 'reject', {
      assignmentId: 'assignment-1',
      note: '   ',
    })).rejects.toMatchObject({
      code: 'INVALID_PARAMS',
      message: '驳回时请填写修改意见。',
    })
    expect(accessMock.requireProjectAssignmentReviewer).toHaveBeenCalledWith(session, 'project-1')
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })

  it('persists video time-range annotations atomically with rejection', async () => {
    const current = assignment({
      stage: 'video',
      status: 'pending_review',
      episodeId: 'episode-1',
      assigneeUserId: 'actor-2',
    })
    const rejected = hydratedAssignment({
      stage: 'video',
      status: 'rejected',
      episodeId: 'episode-1',
      assigneeUserId: 'actor-2',
      lastReviewNote: null,
    })
    prismaMock.workflowAssignment.findFirst.mockResolvedValue(current)
    prismaMock.workflowAssignment.findUnique.mockResolvedValue(rejected)
    prismaMock.project.findMany.mockResolvedValue([{
      id: 'project-1',
      createdById: 'manager-1',
      work: { createdById: 'manager-1', members: [] },
      members: [{ canManageAssignments: false, canReviewAssignments: true }],
    }])
    const transaction = {
      workflowAssignment: {
        findFirst: vi.fn().mockResolvedValue(current),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      videoReviewAnnotation: {
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      projectMember: { upsert: vi.fn() },
      workflowAssignmentEvent: {
        findFirst: vi.fn().mockResolvedValue({ payload: submittedVideoReviewPayload() }),
        create: vi.fn().mockResolvedValue({}),
      },
    }
    prismaMock.$transaction.mockImplementation(async (callback: (tx: typeof transaction) => unknown) => callback(transaction))
    const { mutateAssignment } = await import('@/lib/collaboration/assignments')

    const result = await mutateAssignment(session, 'reject', {
      assignmentId: 'assignment-1',
      note: '   ',
      videoAnnotations: [{ panelId: 'panel-1', startMs: 1_200, endMs: 3_400, note: '口型不同步' }],
    })

    expect(transaction.videoReviewAnnotation.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({
        assignmentUuid: 'assignment-1',
        projectId: 'project-1',
        episodeId: 'episode-1',
        panelId: 'panel-1',
        startMs: 1_200,
        endMs: 3_400,
        note: '口型不同步',
        status: 'open',
      })],
    })
    expect(transaction.workflowAssignmentEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventType: 'reject',
        note: null,
        payload: { videoAnnotationCount: 1 },
      }),
    })
    expect(result.status).toBe('rejected')
  })
})
