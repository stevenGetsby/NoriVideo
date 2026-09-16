import type { Prisma } from '@prisma/client'
import type { AuthSession } from '@/lib/api-auth'
import { ApiError } from '@/lib/api-errors'
import { prisma } from '@/lib/prisma'
import { hasAccountPermissions, type AccountPermission } from '@/lib/account/permissions'
import {
  getWorkspaceActor,
  projectReadScopeWhere,
  requireActiveWorkspaceUser,
  requireProjectAssignmentManager,
  requireProjectAssignmentReviewer,
  requireProjectReader,
  workspaceUserWhere,
} from '@/lib/collaboration/access'
import {
  ASSIGNMENT_STAGES,
  assignmentStageSkipsReview,
  assertAssignmentTransition,
  isAssignmentStage,
  isAssignmentTab,
  nextAssignmentStatus,
  projectMembershipGrantsReview,
  resolveAssignmentCapabilities,
  statusesForAssignmentTab,
  type AssignmentAction,
  type AssignmentStage,
  type AssignmentTab,
} from '@/lib/collaboration/assignment-policy'
import {
  buildVideoReviewSubmissionSnapshot,
  normalizeVideoReviewAnnotations,
  readVideoReviewSubmissionSnapshot,
  replaceOpenVideoReviewAnnotations,
  resolveOpenVideoReviewAnnotations,
  validateVideoReviewAnnotationsAgainstSnapshot,
} from '@/lib/collaboration/video-review'
import { buildStoryboardReviewSubmissionSnapshot } from '@/lib/collaboration/storyboard-review'
import { CANVAS_PLAYLIST_SCOPE_PREFIX } from '@/lib/canvas/playlist'

const assignmentInclude = {
  project: {
    select: {
      id: true,
      name: true,
      workId: true,
      createdById: true,
      work: { select: { id: true, name: true, createdById: true } },
    },
  },
  episode: { select: { id: true, episodeNumber: true, name: true } },
  assignee: { select: { id: true, name: true, role: true, roleLabel: true, status: true } },
} satisfies Prisma.WorkflowAssignmentInclude

type AssignmentRow = Prisma.WorkflowAssignmentGetPayload<{ include: typeof assignmentInclude }>

interface AssignmentFilters {
  workId?: string | null
  projectId?: string | null
  projectIds?: string[]
  stage?: AssignmentStage | null
}

interface ProjectCapability {
  canManage: boolean
  canReview: boolean
}

const ASSIGNMENT_STAGE_PERMISSION: Record<AssignmentStage, AccountPermission> = {
  script: 'scriptWrite',
  asset: 'assetWrite',
  storyboard: 'storyboardWrite',
  video: 'storyboardWrite',
}

const ASSIGNMENT_STAGE_LABEL: Record<AssignmentStage, string> = {
  script: '剧本',
  asset: '资产',
  storyboard: '分镜',
  video: '视频',
}

function canWorkOnAssignmentStage(
  account: { role?: unknown; permissions?: unknown },
  stage: AssignmentStage,
) {
  return hasAccountPermissions(account, [ASSIGNMENT_STAGE_PERMISSION[stage]])
}

function normalizePage(value: unknown, fallback: number, maximum = Number.MAX_SAFE_INTEGER) {
  const parsed = typeof value === 'string' || typeof value === 'number' ? Number(value) : NaN
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(1, Math.min(maximum, Math.floor(parsed)))
}

function cleanId(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function parseProjectIds(value: unknown): string[] {
  if (Array.isArray(value)) {
    return Array.from(new Set(value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean)))
  }
  if (typeof value !== 'string') return []
  return Array.from(new Set(value.split(',').map((item) => item.trim()).filter(Boolean)))
}

export function parseAssignmentFilters(input: {
  workId?: unknown
  projectId?: unknown
  projectIds?: unknown
  stage?: unknown
}): AssignmentFilters {
  const stageValue = cleanId(input.stage)
  if (stageValue && !isAssignmentStage(stageValue)) {
    throw new ApiError('INVALID_PARAMS', { message: '任务阶段无效。' })
  }
  return {
    workId: cleanId(input.workId),
    projectId: cleanId(input.projectId),
    projectIds: parseProjectIds(input.projectIds),
    stage: stageValue as AssignmentStage | undefined,
  }
}

function assignmentWhere(session: AuthSession, filters: AssignmentFilters): Prisma.WorkflowAssignmentWhereInput {
  const actor = getWorkspaceActor(session)
  return {
    workspaceOwnerId: actor.workspaceOwnerId,
    matched: true,
    ...(filters.projectId
      ? { projectId: filters.projectId }
      : filters.projectIds?.length ? { projectId: { in: filters.projectIds } } : {}),
    project: {
      is: {
        AND: [
          projectReadScopeWhere(session),
          ...(filters.workId ? [{ workId: filters.workId }] : []),
        ],
      },
    },
    ...(filters.stage ? { stage: filters.stage } : {}),
  }
}

async function loadProjectCapabilities(
  session: AuthSession,
  projectIds?: string[],
  filters: AssignmentFilters = {},
): Promise<Map<string, ProjectCapability>> {
  const actor = getWorkspaceActor(session)
  const projects = await prisma.project.findMany({
    where: {
      userId: actor.workspaceOwnerId,
      collaborationMode: 'team',
      ...(projectIds ? { id: { in: projectIds } } : filters.projectId
        ? { id: filters.projectId }
        : filters.projectIds?.length ? { id: { in: filters.projectIds } } : {}),
      ...(filters.workId ? { workId: filters.workId } : {}),
    },
    select: {
      id: true,
      createdById: true,
      work: {
        select: {
          createdById: true,
          members: {
            where: { userId: actor.actorId },
            select: { role: true, canManage: true },
            take: 1,
          },
        },
      },
      members: {
        where: { userId: actor.actorId },
        select: { canManageAssignments: true, canReviewAssignments: true },
        take: 1,
      },
    },
  })
  return new Map(projects.map((project) => {
    const workMember = project.work.members[0]
    const projectMember = project.members[0]
    const capabilities = resolveAssignmentCapabilities({
      actorIsManagement: actor.isManagement,
      actorIsProjectCreator: project.createdById === actor.actorId,
      actorIsWorkCreator: project.work.createdById === actor.actorId,
      workMemberCanManage: workMember?.canManage === true,
      workMemberRole: workMember?.role,
      projectMemberCanManage: projectMember?.canManageAssignments === true,
      projectMemberCanReview: projectMembershipGrantsReview({
        membership: projectMember,
        accountRole: actor.role,
      }),
    })
    return [project.id, {
      canManage: capabilities.canManage,
      canReview: capabilities.canReview,
    }]
  }))
}

function toAssignmentDto(
  row: AssignmentRow,
  actorId: string,
  workspaceOwnerId: string,
  capability: ProjectCapability | undefined,
) {
  const canManage = capability?.canManage === true
  const canReviewProject = capability?.canReview === true
  const isCanvasPlaylist = row.stage === 'video' && row.scopeId.startsWith(CANVAS_PLAYLIST_SCOPE_PREFIX)
  return {
    id: row.uuid,
    projectId: row.projectId,
    projectName: row.project.name,
    scopeId: row.scopeId,
    workId: row.project.workId,
    workName: row.project.work.name,
    stage: row.stage,
    status: row.status,
    assigneeUserId: row.assigneeUserId,
    assigneeName: row.assignee?.name || null,
    assigneeDisabled: row.assignee ? row.assignee.status !== 'active' : false,
    assigneeKind: row.assignee
      ? row.assignee.id === workspaceOwnerId ? 'owner' : 'member'
      : null,
    episodeId: row.episodeId,
    episodeNumber: row.episode?.episodeNumber || null,
    assignedAt: row.assignedAt,
    submittedAt: row.submittedAt,
    completedAt: row.completedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastReviewNote: row.lastReviewNote,
    matched: row.matched,
    canSubmit: !isCanvasPlaylist && (row.status === 'in_progress' || row.status === 'rejected')
      && (row.assigneeUserId === actorId || canManage),
    canAssign: canManage && row.status !== 'completed',
    canMarkComplete: canManage && (row.status === 'in_progress' || row.status === 'rejected'),
    canReview: canReviewProject && row.status === 'pending_review' && !assignmentStageSkipsReview(row.stage),
    canReopen: canManage && row.status === 'completed',
    submitCompletesDirectly: row.submitCompletesDirectly,
  }
}

async function hydrateAssignmentDtos(session: AuthSession, rows: AssignmentRow[]) {
  const actor = getWorkspaceActor(session)
  const projectIds = Array.from(new Set(rows.map((row) => row.projectId)))
  const capabilities = projectIds.length
    ? await loadProjectCapabilities(session, projectIds)
    : new Map<string, ProjectCapability>()
  return rows.map((row) => toAssignmentDto(
    row,
    actor.actorId,
    actor.workspaceOwnerId,
    capabilities.get(row.projectId),
  ))
}

export async function getAssignmentDetail(session: AuthSession, assignmentIdInput: unknown) {
  const assignmentId = cleanId(assignmentIdInput)
  if (!assignmentId) throw new ApiError('INVALID_PARAMS', { message: '缺少任务 ID。' })

  const actor = getWorkspaceActor(session)
  const assignment = await prisma.workflowAssignment.findFirst({
    where: {
      uuid: assignmentId,
      workspaceOwnerId: actor.workspaceOwnerId,
    },
    include: assignmentInclude,
  })
  if (!assignment) throw new ApiError('NOT_FOUND', { message: '协作任务不存在。' })

  // A workspace boundary alone is not an object read grant. Check project ACL
  // before exposing assignment metadata or its audit trail for a guessed UUID.
  await requireProjectReader(session, assignment.projectId)

  const events = await prisma.workflowAssignmentEvent.findMany({
    where: {
      assignmentUuid: assignmentId,
      workspaceOwnerId: actor.workspaceOwnerId,
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      eventType: true,
      fromStatus: true,
      toStatus: true,
      note: true,
      payload: true,
      createdAt: true,
      actor: {
        select: {
          id: true,
          name: true,
          role: true,
          status: true,
        },
      },
    },
  })
  const [detail] = await hydrateAssignmentDtos(session, [assignment])
  return {
    assignment: detail,
    events: events.map((event) => ({
      id: event.id,
      eventType: event.eventType,
      fromStatus: event.fromStatus,
      toStatus: event.toStatus,
      note: event.note,
      payload: event.payload,
      createdAt: event.createdAt,
      actorUserId: event.actor?.id || null,
      actorName: event.actor?.name || null,
      actorRole: event.actor?.role || null,
      actorDisabled: event.actor ? event.actor.status !== 'active' : false,
    })),
  }
}

async function showPendingReviewTab(session: AuthSession, filters: AssignmentFilters) {
  const capabilities = await loadProjectCapabilities(session, undefined, filters)
  return Array.from(capabilities.values()).some((capability) => capability.canReview)
}

export async function syncProjectAssignmentsForProject(input: {
  projectId: string
  workspaceOwnerId: string
}) {
  const project = await prisma.project.findFirst({
    where: { id: input.projectId, userId: input.workspaceOwnerId },
    select: {
      id: true,
      createdById: true,
      collaborationMode: true,
      members: {
        orderBy: { createdAt: 'asc' },
        select: {
          userId: true,
          user: { select: { role: true, permissions: true, status: true } },
        },
      },
      novelPromotionData: {
        select: {
          episodes: {
            orderBy: { episodeNumber: 'asc' },
            select: {
              id: true,
              episodeNumber: true,
              novelText: true,
              clips: { select: { id: true }, take: 1 },
              storyboards: {
                select: { panels: { select: { id: true }, take: 1 } },
                take: 1,
              },
            },
          },
        },
      },
    },
  })
  if (!project) throw new ApiError('NOT_FOUND', { message: '项目不存在。' })
  if (project.collaborationMode !== 'team') {
    await prisma.workflowAssignment.updateMany({
      where: {
        workspaceOwnerId: input.workspaceOwnerId,
        projectId: input.projectId,
        matched: true,
      },
      data: { matched: false },
    })
    return
  }

  const defaultAssigneeByStage: Partial<Record<AssignmentStage, string>> = {}
  for (const member of project.members || []) {
    if (member.user.status !== 'active') continue
    if (canWorkOnAssignmentStage(member.user, 'script') && !defaultAssigneeByStage.script) {
      defaultAssigneeByStage.script = member.userId
    }
    if (canWorkOnAssignmentStage(member.user, 'asset') && !defaultAssigneeByStage.asset) {
      defaultAssigneeByStage.asset = member.userId
    }
    if (canWorkOnAssignmentStage(member.user, 'storyboard')) {
      if (!defaultAssigneeByStage.storyboard) defaultAssigneeByStage.storyboard = member.userId
      if (!defaultAssigneeByStage.video) defaultAssigneeByStage.video = member.userId
    }
  }

  const records: Array<{
    scopeId: string
    episodeId: string | null
    stage: AssignmentStage
    matched: boolean
    assigneeUserId: string | null
  }> = [
    { scopeId: 'project', episodeId: null, stage: 'script', matched: true, assigneeUserId: defaultAssigneeByStage.script || null },
    { scopeId: 'project', episodeId: null, stage: 'asset', matched: true, assigneeUserId: defaultAssigneeByStage.asset || null },
  ]
  for (const episode of project.novelPromotionData?.episodes || []) {
    const hasScript = Boolean(episode.novelText?.trim() || episode.clips.length)
    const hasStoryboard = episode.storyboards.some((storyboard) => storyboard.panels.length > 0)
    records.push(
      {
        scopeId: episode.id,
        episodeId: episode.id,
        stage: 'storyboard',
        matched: hasScript,
        assigneeUserId: defaultAssigneeByStage.storyboard || null,
      },
      {
        scopeId: episode.id,
        episodeId: episode.id,
        stage: 'video',
        matched: hasStoryboard,
        assigneeUserId: defaultAssigneeByStage.video || null,
      },
    )
  }

  const currentTargets = records.map((record) => ({
    scopeId: record.scopeId,
    stage: record.stage,
  }))
  await prisma.$transaction([
    // A deleted episode no longer appears in `records`; retire its old rows so
    // personal lists and counts cannot keep exposing an orphaned assignment.
    prisma.workflowAssignment.updateMany({
      where: {
        workspaceOwnerId: input.workspaceOwnerId,
        projectId: input.projectId,
        matched: true,
        AND: [
          { NOT: { OR: currentTargets } },
          { NOT: { scopeId: { startsWith: CANVAS_PLAYLIST_SCOPE_PREFIX } } },
        ],
      },
      data: { matched: false },
    }),
    prisma.workflowAssignment.updateMany({
      where: {
        workspaceOwnerId: input.workspaceOwnerId,
        projectId: input.projectId,
        stage: 'storyboard',
        status: 'pending_review',
      },
      data: {
        status: 'completed',
        submitCompletesDirectly: true,
        completedAt: new Date(),
      },
    }),
    ...records.map((record) => prisma.workflowAssignment.upsert({
      where: {
        projectId_scopeId_stage: {
          projectId: input.projectId,
          scopeId: record.scopeId,
          stage: record.stage,
        },
      },
      update: {
        episodeId: record.episodeId,
        matched: record.matched,
        submitCompletesDirectly: assignmentStageSkipsReview(record.stage),
      },
      create: {
        workspaceOwnerId: input.workspaceOwnerId,
        projectId: input.projectId,
        episodeId: record.episodeId,
        scopeId: record.scopeId,
        stage: record.stage,
        status: record.assigneeUserId ? 'in_progress' : 'unassigned',
        assigneeUserId: record.assigneeUserId,
        assignedById: record.assigneeUserId ? project.createdById : null,
        assignedAt: record.assigneeUserId ? new Date() : null,
        submitCompletesDirectly: assignmentStageSkipsReview(record.stage),
        matched: record.matched,
        events: {
          create: {
            workspaceOwnerId: input.workspaceOwnerId,
            actorUserId: project.createdById,
            eventType: record.assigneeUserId ? 'assigned' : 'created',
            toStatus: record.assigneeUserId ? 'in_progress' : 'unassigned',
            payload: {
              source: 'project_sync',
              stage: record.stage,
              scopeId: record.scopeId,
              ...(record.assigneeUserId ? { assigneeUserId: record.assigneeUserId } : {}),
            },
          },
        },
      },
    })),
  ])
}

export async function ensureProjectAssignments(session: AuthSession, projectId: string) {
  const actor = getWorkspaceActor(session)
  await syncProjectAssignmentsForProject({
    projectId,
    workspaceOwnerId: actor.workspaceOwnerId,
  })
}

export async function listMyAssignments(session: AuthSession, input: {
  tab?: unknown
  page?: unknown
  pageSize?: unknown
  filters: AssignmentFilters
}) {
  const actor = getWorkspaceActor(session)
  const tabValue = cleanId(input.tab) || 'todo'
  if (!isAssignmentTab(tabValue)) throw new ApiError('INVALID_PARAMS', { message: '任务标签无效。' })
  const tab = tabValue as AssignmentTab
  const page = normalizePage(input.page, 1)
  const pageSize = normalizePage(input.pageSize, 10, 100)
  const where: Prisma.WorkflowAssignmentWhereInput = {
    ...assignmentWhere(session, input.filters),
    assigneeUserId: actor.actorId,
    status: { in: statusesForAssignmentTab(tab) },
  }
  const [total, rows, showReview] = await Promise.all([
    prisma.workflowAssignment.count({ where }),
    prisma.workflowAssignment.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: assignmentInclude,
    }),
    showPendingReviewTab(session, input.filters),
  ])
  return {
    assignments: await hydrateAssignmentDtos(session, rows),
    total,
    page,
    pageSize,
    showPendingReviewTab: showReview,
  }
}

export async function listPendingReviewAssignments(session: AuthSession, input: {
  page?: unknown
  pageSize?: unknown
  filters: AssignmentFilters
}) {
  const page = normalizePage(input.page, 1)
  const pageSize = normalizePage(input.pageSize, 10, 100)
  const capabilities = await loadProjectCapabilities(session, undefined, input.filters)
  const reviewableProjectIds = Array.from(capabilities.entries())
    .filter(([, capability]) => capability.canReview)
    .map(([projectId]) => projectId)
  const where: Prisma.WorkflowAssignmentWhereInput = {
    ...assignmentWhere(session, input.filters),
    projectId: { in: reviewableProjectIds },
    status: 'pending_review',
    stage: { not: 'storyboard' },
  }
  const [total, rows] = reviewableProjectIds.length ? await Promise.all([
    prisma.workflowAssignment.count({ where }),
    prisma.workflowAssignment.findMany({
      where,
      orderBy: { submittedAt: 'asc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: assignmentInclude,
    }),
  ]) : [0, [] as AssignmentRow[]]
  return {
    assignments: await hydrateAssignmentDtos(session, rows),
    total,
    page,
    pageSize,
    showPendingReviewTab: reviewableProjectIds.length > 0,
  }
}

export async function getAssignmentCounts(session: AuthSession, filters: AssignmentFilters) {
  const actor = getWorkspaceActor(session)
  const baseWhere = assignmentWhere(session, filters)
  const capabilities = await loadProjectCapabilities(session, undefined, filters)
  const reviewableProjectIds = Array.from(capabilities.entries())
    .filter(([, capability]) => capability.canReview)
    .map(([projectId]) => projectId)
  const [todo, inReview, done, pendingReview] = await Promise.all([
    prisma.workflowAssignment.count({ where: {
      ...baseWhere,
      assigneeUserId: actor.actorId,
      status: { in: statusesForAssignmentTab('todo') },
    } }),
    prisma.workflowAssignment.count({ where: {
      ...baseWhere,
      assigneeUserId: actor.actorId,
      status: { in: statusesForAssignmentTab('in_review') },
    } }),
    prisma.workflowAssignment.count({ where: {
      ...baseWhere,
      assigneeUserId: actor.actorId,
      status: { in: statusesForAssignmentTab('done') },
    } }),
    reviewableProjectIds.length
      ? prisma.workflowAssignment.count({ where: {
        ...baseWhere,
        projectId: { in: reviewableProjectIds },
        status: 'pending_review',
        stage: { not: 'storyboard' },
      } })
      : Promise.resolve(0),
  ])
  return {
    counts: { todo, inReview, done, pendingReview },
    showPendingReviewTab: reviewableProjectIds.length > 0,
  }
}

export async function listProjectAssignments(session: AuthSession, projectId: string) {
  return (await getProjectAssignmentOverview(session, projectId)).assignments
}

export async function getProjectAssignmentOverview(session: AuthSession, projectId: string) {
  const access = await requireProjectReader(session, projectId)
  await ensureProjectAssignments(session, projectId)
  const actor = getWorkspaceActor(session)
  const rows = await prisma.workflowAssignment.findMany({
    where: { workspaceOwnerId: actor.workspaceOwnerId, projectId, matched: true },
    orderBy: [{ stage: 'asc' }, { episode: { episodeNumber: 'asc' } }, { createdAt: 'asc' }],
    include: assignmentInclude,
  })
  return {
    assignments: await hydrateAssignmentDtos(session, rows),
    canManageAssignments: access.canManageAssignments,
    canReviewAssignments: access.canReviewAssignments,
  }
}

export async function listAssignmentCandidates(
  session: AuthSession,
  projectId: string,
  stage?: AssignmentStage | null,
) {
  const { actor } = await requireProjectAssignmentManager(session, projectId)
  const [users, members] = await Promise.all([
    prisma.user.findMany({
      where: { status: 'active', ...workspaceUserWhere(actor.workspaceOwnerId) },
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true, role: true, roleLabel: true, permissions: true, status: true },
    }),
    prisma.projectMember.findMany({
      where: { projectId },
      select: { userId: true, canManageAssignments: true, canReviewAssignments: true },
    }),
  ])
  const memberMap = new Map(members.map((member) => [member.userId, member]))
  return users.map((user) => {
    const member = memberMap.get(user.id)
    const eligibleStages = ASSIGNMENT_STAGES.filter((candidateStage) => canWorkOnAssignmentStage(user, candidateStage))
    return {
      userId: user.id,
      name: user.name,
      role: user.role,
      roleLabel: user.roleLabel,
      status: user.status,
      isWorkspaceOwner: user.id === actor.workspaceOwnerId,
      inProject: user.id === actor.workspaceOwnerId || Boolean(member),
      canManageAssignments: member?.canManageAssignments === true,
      canReviewAssignments: projectMembershipGrantsReview({
        membership: member,
        accountRole: user.role,
      }),
      eligibleStages,
    }
  }).filter((candidate) => !stage || candidate.eligibleStages.includes(stage))
}

interface AssignmentActionInput {
  assignmentId: string
  assigneeUserId?: string
  note?: string
  videoAnnotations?: unknown
}

function normalizeNote(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const note = value.trim()
  return note ? note.slice(0, 4000) : null
}

async function getScopedAssignment(session: AuthSession, assignmentId: string) {
  const actor = getWorkspaceActor(session)
  const assignment = await prisma.workflowAssignment.findFirst({
    where: { uuid: assignmentId, workspaceOwnerId: actor.workspaceOwnerId },
    include: {
      project: { select: { collaborationMode: true } },
    },
  })
  if (!assignment) throw new ApiError('NOT_FOUND', { message: '协作任务不存在。' })
  return { actor, assignment }
}

async function requireAssignmentSubmitterAccess(input: {
  workspaceOwnerId: string
  actorId: string
  stage: AssignmentStage
}) {
  let assignee: Awaited<ReturnType<typeof requireActiveWorkspaceUser>>
  try {
    assignee = await requireActiveWorkspaceUser(input.workspaceOwnerId, input.actorId)
  } catch (error) {
    if (error instanceof ApiError && error.code === 'INVALID_PARAMS') {
      throw new ApiError('FORBIDDEN', {
        message: '当前任务执行账号已停用或不再属于该工作区，不能提交任务。',
      })
    }
    throw error
  }
  if (!canWorkOnAssignmentStage(assignee, input.stage)) {
    throw new ApiError('FORBIDDEN', {
      message: '当前账号已不具备该任务阶段的编辑权限，不能提交任务。',
      stage: input.stage,
    })
  }
}

export async function mutateAssignment(
  session: AuthSession,
  action: AssignmentAction,
  input: AssignmentActionInput,
) {
  const assignmentId = cleanId(input.assignmentId)
  if (!assignmentId) throw new ApiError('INVALID_PARAMS', { message: '缺少任务 ID。' })
  const { actor, assignment } = await getScopedAssignment(session, assignmentId)
  if (!assignment.matched || assignment.project.collaborationMode !== 'team') {
    throw new ApiError('CONFLICT', {
      message: '该任务已失效或项目已关闭任务分工，请刷新任务列表。',
    })
  }
  const note = normalizeNote(input.note)
  const videoAnnotations = action === 'reject' && assignment.stage === 'video'
    ? normalizeVideoReviewAnnotations(input.videoAnnotations)
    : []
  let submittingAsManager = false

  if ((action === 'approve' || action === 'reject') && assignmentStageSkipsReview(assignment.stage)) {
    throw new ApiError('CONFLICT', { message: '分镜任务不再进入审核，请在任务中标记完成。' })
  }
  if (action === 'assign' || action === 'mark-complete' || action === 'reopen') {
    await requireProjectAssignmentManager(session, assignment.projectId)
  } else if (action === 'approve' || action === 'reject') {
    await requireProjectAssignmentReviewer(session, assignment.projectId)
  } else {
    // Being the historical assignee is not an object-level read grant. A user
    // removed from the project must not be able to mutate it through a known
    // assignment UUID after it disappears from their personal task list.
    const access = await requireProjectReader(session, assignment.projectId)
    if (assignment.assigneeUserId !== actor.actorId) {
      if (!access.canManageAssignments) {
        throw new ApiError('FORBIDDEN', { message: '只有当前任务执行人或项目管理账号可以提交任务。' })
      }
      submittingAsManager = true
    } else {
      await requireAssignmentSubmitterAccess({
        workspaceOwnerId: actor.workspaceOwnerId,
        actorId: actor.actorId,
        stage: assignment.stage as AssignmentStage,
      })
    }
  }
  if (action === 'reject' && !note && videoAnnotations.length === 0) {
    throw new ApiError('INVALID_PARAMS', {
      message: assignment.stage === 'video'
        ? '驳回时请填写整集修改意见，或至少添加一条 Segment 时段批注。'
        : '驳回时请填写修改意见。',
    })
  }

  let assigneeUserId: string | undefined
  if (action === 'assign') {
    assigneeUserId = cleanId(input.assigneeUserId)
    if (!assigneeUserId) throw new ApiError('INVALID_PARAMS', { message: '请选择任务执行人。' })
    const assignee = await requireActiveWorkspaceUser(actor.workspaceOwnerId, assigneeUserId)
    if (!canWorkOnAssignmentStage(assignee, assignment.stage as AssignmentStage)) {
      throw new ApiError('INVALID_PARAMS', {
        message: `所选账号没有执行${ASSIGNMENT_STAGE_LABEL[assignment.stage as AssignmentStage] || '当前'}任务的权限。`,
        assigneeUserId,
        stage: assignment.stage,
      })
    }
  }

  await prisma.$transaction(async (tx) => {
    const current = await tx.workflowAssignment.findFirst({
      where: {
        uuid: assignmentId,
        workspaceOwnerId: actor.workspaceOwnerId,
        matched: true,
        project: { is: { collaborationMode: 'team' } },
      },
    })
    if (!current) {
      throw new ApiError('CONFLICT', {
        message: '该任务已失效或项目已关闭任务分工，请刷新任务列表。',
      })
    }
    if (action === 'submit' && current.assigneeUserId !== actor.actorId && !submittingAsManager) {
      throw new ApiError('FORBIDDEN', { message: '只有当前任务执行人或项目管理账号可以提交任务。' })
    }
    assertAssignmentTransition(action, current.status)
    const videoReviewSubmission = action === 'submit' && current.stage === 'video'
      ? (await buildVideoReviewSubmissionSnapshot(tx, current.episodeId, { requireReady: true })).snapshot
      : null
    const storyboardReviewSubmission = action === 'submit' && current.stage === 'storyboard'
      ? await buildStoryboardReviewSubmissionSnapshot(tx, current.episodeId, { requireReady: true })
      : null
    if (action === 'reject' && current.stage === 'video' && videoAnnotations.length > 0) {
      const latestSubmission = await tx.workflowAssignmentEvent.findFirst({
        where: {
          assignmentUuid: assignmentId,
          workspaceOwnerId: actor.workspaceOwnerId,
          eventType: 'submit',
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { payload: true },
      })
      const submittedSnapshot = readVideoReviewSubmissionSnapshot(latestSubmission?.payload)
        || (await buildVideoReviewSubmissionSnapshot(tx, current.episodeId)).snapshot
      validateVideoReviewAnnotationsAgainstSnapshot(videoAnnotations, submittedSnapshot)
    }
    const nextStatus = nextAssignmentStatus(
      action,
      current.submitCompletesDirectly || assignmentStageSkipsReview(current.stage),
    )
    // `updatedAt` is the existing optimistic-concurrency token. Explicitly
    // advance it by at least 1 ms so same-state reassignments cannot both win.
    const now = new Date(Math.max(Date.now(), current.updatedAt.getTime() + 1))
    const data: Prisma.WorkflowAssignmentUncheckedUpdateManyInput = {
      status: nextStatus,
      updatedAt: now,
    }

    if (action === 'assign') {
      data.assigneeUserId = assigneeUserId
      data.assignedById = actor.actorId
      data.assignedAt = now
      data.submittedAt = null
      data.completedAt = null
      data.lastReviewNote = null
      if (assigneeUserId !== actor.workspaceOwnerId) {
        await tx.projectMember.upsert({
          where: { projectId_userId: { projectId: current.projectId, userId: assigneeUserId! } },
          update: {},
          create: { projectId: current.projectId, userId: assigneeUserId! },
        })
      }
    } else if (action === 'submit') {
      data.submittedAt = now
      // Keep the latest overall video review note visible across a rejected
      // submission's next review round. The time-range annotations are
      // resolved below, while the summary remains useful to both parties.
      if (!(current.stage === 'video' && current.status === 'rejected')) {
        data.lastReviewNote = null
      }
      if (nextStatus === 'completed') data.completedAt = now
      if (current.stage === 'video') {
        await resolveOpenVideoReviewAnnotations(tx, assignmentId, now)
      }
    } else if (action === 'approve' || action === 'mark-complete') {
      data.completedAt = now
      data.lastReviewNote = action === 'approve' ? note : null
      if (current.stage === 'video') {
        await resolveOpenVideoReviewAnnotations(tx, assignmentId, now)
      }
    } else if (action === 'reject') {
      data.lastReviewNote = note
      data.completedAt = null
      if (current.stage === 'video') {
        await replaceOpenVideoReviewAnnotations(tx, {
          assignmentUuid: assignmentId,
          workspaceOwnerId: actor.workspaceOwnerId,
          projectId: current.projectId,
          episodeId: current.episodeId,
          reviewerUserId: actor.actorId,
          annotations: videoAnnotations,
        })
      }
    } else if (action === 'reopen') {
      data.submittedAt = null
      data.completedAt = null
      data.lastReviewNote = null
    }

    const changed = await tx.workflowAssignment.updateMany({
      where: {
        uuid: assignmentId,
        status: current.status,
        updatedAt: current.updatedAt,
      },
      data,
    })
    if (changed.count !== 1) {
      throw new ApiError('CONFLICT', { message: '任务已被其他操作更新，请刷新后重试。' })
    }
    const eventType = action === 'assign' && current.assigneeUserId ? 'reassign' : action
    const reviewRound = videoReviewSubmission || storyboardReviewSubmission
      ? await tx.workflowAssignmentEvent.count({
        where: { assignmentUuid: assignmentId, eventType: 'submit' },
      }) + 1
      : null
    await tx.workflowAssignmentEvent.create({
      data: {
        assignmentUuid: assignmentId,
        workspaceOwnerId: actor.workspaceOwnerId,
        actorUserId: actor.actorId,
        eventType,
        fromStatus: current.status,
        toStatus: nextStatus,
        note,
        payload: action === 'assign'
          ? { assigneeUserId }
          : videoReviewSubmission
            ? JSON.parse(JSON.stringify({
              reviewRound,
              reviewSubmission: videoReviewSubmission,
            })) as Prisma.InputJsonValue
            : storyboardReviewSubmission
              ? JSON.parse(JSON.stringify({
                reviewRound,
                storyboardReviewSubmission,
              })) as Prisma.InputJsonValue
            : action === 'reject' && current.stage === 'video'
              ? { videoAnnotationCount: videoAnnotations.length }
              : undefined,
      },
    })
  })

  const updated = await prisma.workflowAssignment.findUnique({
    where: { uuid: assignmentId },
    include: assignmentInclude,
  })
  if (!updated) throw new ApiError('NOT_FOUND', { message: '协作任务不存在。' })
  const [dto] = await hydrateAssignmentDtos(session, [updated])
  return dto
}

export async function mutateAssignmentsBatch(
  session: AuthSession,
  action: Extract<AssignmentAction, 'assign' | 'approve' | 'reject'>,
  input: {
    assignmentIds: unknown
    assigneeUserId?: unknown
    note?: unknown
  },
) {
  const assignmentIds = Array.from(new Set(
    Array.isArray(input.assignmentIds)
      ? input.assignmentIds.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean)
      : [],
  ))
  if (!assignmentIds.length) throw new ApiError('INVALID_PARAMS', { message: '请选择至少一个任务。' })
  if (assignmentIds.length > 100) throw new ApiError('INVALID_PARAMS', { message: '单次最多处理 100 个任务。' })

  const results: Array<{ assignmentId: string; ok: boolean; error?: string }> = []
  for (const assignmentId of assignmentIds) {
    try {
      await mutateAssignment(session, action, {
        assignmentId,
        assigneeUserId: cleanId(input.assigneeUserId),
        note: normalizeNote(input.note) || undefined,
      })
      results.push({ assignmentId, ok: true })
    } catch (error) {
      results.push({
        assignmentId,
        ok: false,
        error: error instanceof Error ? error.message : '操作失败',
      })
    }
  }
  return {
    results,
    total: results.length,
    okCount: results.filter((result) => result.ok).length,
  }
}
