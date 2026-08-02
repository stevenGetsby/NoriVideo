import { NextRequest, NextResponse } from 'next/server'
import { ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireUserAuth } from '@/lib/api-auth'
import {
  getAssignmentCounts,
  getProjectAssignmentOverview,
  listAssignmentCandidates,
  listMyAssignments,
  listPendingReviewAssignments,
  listProjectAssignments,
  mutateAssignment,
  mutateAssignmentsBatch,
  parseAssignmentFilters,
} from '@/lib/collaboration/assignments'
import type { AssignmentAction } from '@/lib/collaboration/assignment-policy'

export type AssignmentGetEndpoint = 'my' | 'pending-review' | 'counts' | 'pending-review-count' | 'list' | 'candidates'
export type AssignmentPostEndpoint = AssignmentAction | 'batch-assign' | 'batch-approve' | 'batch-reject'

type CanonicalAssignment = Awaited<ReturnType<typeof listProjectAssignments>>[number]

function readFilters(request: NextRequest) {
  const params = request.nextUrl.searchParams
  return parseAssignmentFilters({
    workId: params.get('workId') ?? params.get('work_id'),
    projectId: params.get('projectId') ?? params.get('project_id'),
    projectIds: params.get('projectIds') ?? params.get('project_ids'),
    stage: params.get('stage'),
  })
}

function legacyAssignment(item: CanonicalAssignment) {
  return {
    uuid: item.id,
    project_id: item.projectId,
    project_name: item.projectName,
    work_id: item.workId,
    work_name: item.workName,
    stage: item.stage,
    status: item.status,
    assignee_uid: item.assigneeUserId,
    assignee_name: item.assigneeName,
    assignee_disabled: item.assigneeDisabled,
    assignee_kind: item.assigneeKind,
    episode_uuid: item.episodeId,
    episode_number: item.episodeNumber,
    assigned_at: item.assignedAt,
    submitted_at: item.submittedAt,
    completed_at: item.completedAt,
    created_at: item.createdAt,
    updated_at: item.updatedAt,
    last_review_note: item.lastReviewNote,
    matched: item.matched,
    can_submit: item.canSubmit,
    can_assign: item.canAssign,
    can_mark_complete: item.canMarkComplete,
    can_review: item.canReview,
    can_reopen: item.canReopen,
    submit_completes_directly: item.submitCompletesDirectly,
  }
}

function requiredProjectId(request: NextRequest) {
  const projectId = request.nextUrl.searchParams.get('projectId')
    || request.nextUrl.searchParams.get('project_id')
  if (!projectId) throw new ApiError('INVALID_PARAMS', { message: '缺少项目 ID。' })
  return projectId
}

export async function handleAssignmentGet(
  request: NextRequest,
  endpoint: AssignmentGetEndpoint,
  legacy = false,
) {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const session = authResult.session
  const params = request.nextUrl.searchParams
  const filters = readFilters(request)

  if (endpoint === 'my' || endpoint === 'pending-review') {
    const result = endpoint === 'my'
      ? await listMyAssignments(session, {
        tab: params.get('tab'),
        page: params.get('page'),
        pageSize: params.get('pageSize') ?? params.get('page_size'),
        filters,
      })
      : await listPendingReviewAssignments(session, {
        page: params.get('page'),
        pageSize: params.get('pageSize') ?? params.get('page_size'),
        filters,
      })
    if (legacy) {
      return NextResponse.json({
        data: {
          items: result.assignments.map(legacyAssignment),
          total: result.total,
          page: result.page,
          page_size: result.pageSize,
        },
      })
    }
    return NextResponse.json(result)
  }

  if (endpoint === 'counts' || endpoint === 'pending-review-count') {
    const result = await getAssignmentCounts(session, filters)
    if (endpoint === 'pending-review-count') {
      const payload = {
        count: result.counts.pendingReview,
        showPendingReviewTab: result.showPendingReviewTab,
      }
      return legacy
        ? NextResponse.json({ data: { count: payload.count, show_tab: payload.showPendingReviewTab } })
        : NextResponse.json(payload)
    }
    return NextResponse.json(result)
  }

  const projectId = requiredProjectId(request)
  if (endpoint === 'list') {
    const overview = await getProjectAssignmentOverview(session, projectId)
    return legacy
      ? NextResponse.json({ data: overview.assignments.map(legacyAssignment) })
      : NextResponse.json(overview)
  }
  const candidates = await listAssignmentCandidates(session, projectId, filters.stage)
  if (legacy) {
    return NextResponse.json({ data: candidates.map((candidate) => ({
      uid: candidate.userId,
      username: candidate.name,
      display_name: candidate.name,
      role: candidate.role,
      role_label: candidate.roleLabel,
      status: candidate.status,
      is_account_owner: candidate.isWorkspaceOwner,
      is_project_member: candidate.inProject,
      in_project: candidate.inProject,
      can_manage_assignments: candidate.canManageAssignments,
      can_review_assignments: candidate.canReviewAssignments,
      eligible_stages: candidate.eligibleStages,
    })) })
  }
  return NextResponse.json({ candidates })
}

function readBodyId(body: Record<string, unknown>, canonical: string, legacy: string) {
  const value = body[canonical] ?? body[legacy]
  return typeof value === 'string' ? value.trim() : ''
}

export async function handleAssignmentPost(
  request: NextRequest,
  endpoint: AssignmentPostEndpoint,
  legacy = false,
) {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  const action = endpoint.startsWith('batch-') ? endpoint.slice(6) : endpoint

  if (endpoint.startsWith('batch-')) {
    const assignmentIds = body.assignmentIds ?? body.assignment_uuids
    const result = await mutateAssignmentsBatch(
      authResult.session,
      action as 'assign' | 'approve' | 'reject',
      {
        assignmentIds,
        assigneeUserId: body.assigneeUserId ?? body.assignee_uid,
        note: body.note,
      },
    )
    if (legacy) {
      return NextResponse.json({ data: result.results.map((item) => ({
        uuid: item.assignmentId,
        ok: item.ok,
        ...(item.error ? { error: item.error } : {}),
      })) })
    }
    return NextResponse.json(result)
  }

  const assignment = await mutateAssignment(authResult.session, action as AssignmentAction, {
    assignmentId: readBodyId(body, 'assignmentId', 'assignment_uuid'),
    assigneeUserId: readBodyId(body, 'assigneeUserId', 'assignee_uid') || undefined,
    note: typeof body.note === 'string' ? body.note : undefined,
    ...((body.videoAnnotations ?? body.video_annotations) !== undefined
      ? { videoAnnotations: body.videoAnnotations ?? body.video_annotations }
      : {}),
  })
  return legacy
    ? NextResponse.json({ data: legacyAssignment(assignment) })
    : NextResponse.json({ assignment })
}
