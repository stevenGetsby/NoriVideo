import { NextRequest, NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireProjectAuthLight } from '@/lib/api-auth'
import { isManagementRole } from '@/lib/account/permissions'
import { requireCanvasInProject } from '@/lib/canvas/access'
import {
  canvasPlaylistScopeId,
  canvasPlaylistFingerprint,
  normalizeCanvasPlaylistItems,
  readCanvasPlaylistRenderRecord,
  resolveCanvasPlaylistTimeline,
} from '@/lib/canvas/playlist'
import {
  parseCanvasPlaylistRenderTaskPayload,
  serializeCanvasPlaylistRenderTask,
} from '@/lib/canvas/playlist-render-task'
import { getWorkspaceActor } from '@/lib/collaboration/access'
import { resolveOpenVideoReviewAnnotations } from '@/lib/collaboration/video-review'
import { prisma } from '@/lib/prisma'
import { TASK_TYPE } from '@/lib/task/types'
import type { CanvasNodeData, CanvasPlaylistReviewSummary } from '@/features/canvas/types'

async function requirePlaylistNode(canvasId: string, nodeId: string) {
  const node = await prisma.canvasNode.findFirst({
    where: { id: nodeId, canvasId, type: 'playlist' },
    select: { id: true, canvasId: true, data: true },
  })
  if (!node) throw new ApiError('NOT_FOUND', { message: '播放列表节点不存在或已被删除。' })
  return node
}

async function resolveCurrentRender(
  projectId: string,
  nodeId: string,
  fingerprint: string,
  persistedValue: unknown,
) {
  const persisted = readCanvasPlaylistRenderRecord(persistedValue)
  if (persisted?.fingerprint === fingerprint) return persisted

  // A later whole-document autosave may replace node.data after the worker has
  // patched playlistRender. The completed task remains the immutable authority.
  const tasks = await prisma.task.findMany({
    where: { projectId, targetType: 'CanvasNode', targetId: nodeId, type: TASK_TYPE.CANVAS_VIDEO_OPERATION },
    orderBy: { createdAt: 'desc' },
    take: 30,
  })
  const task = tasks.find((candidate) => (
    parseCanvasPlaylistRenderTaskPayload(candidate.payload)?.fingerprint === fingerprint
  )) || null
  const summary = serializeCanvasPlaylistRenderTask(task, fingerprint)
  return summary.status === 'completed' && summary.outputUrl
    ? { fingerprint, outputUrl: summary.outputUrl }
    : null
}

function reviewSummary(assignment: {
  uuid: string
  status: string
  submittedAt: Date | null
  completedAt: Date | null
  lastReviewNote: string | null
  _count?: { videoReviewAnnotations: number }
} | null): CanvasPlaylistReviewSummary {
  const status = assignment?.status === 'pending_review'
    || assignment?.status === 'completed'
    || assignment?.status === 'rejected'
    ? assignment.status
    : 'draft'
  return {
    assignmentId: assignment?.uuid || null,
    status,
    submittedAt: assignment?.submittedAt?.toISOString() || null,
    completedAt: assignment?.completedAt?.toISOString() || null,
    lastReviewNote: assignment?.lastReviewNote || null,
    annotationCount: assignment?._count?.videoReviewAnnotations || 0,
  }
}

export const GET = apiHandler(async (
  _request: NextRequest,
  context: { params: Promise<{ projectId: string; canvasId: string; nodeId: string }> },
) => {
  const { projectId, canvasId, nodeId } = await context.params
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult
  await requireCanvasInProject(canvasId, projectId)
  await requirePlaylistNode(canvasId, nodeId)
  const actor = getWorkspaceActor(authResult.session)
  const assignment = await prisma.workflowAssignment.findFirst({
    where: {
      workspaceOwnerId: actor.workspaceOwnerId,
      projectId,
      scopeId: canvasPlaylistScopeId(canvasId, nodeId),
      stage: 'video',
    },
    select: {
      uuid: true,
      status: true,
      submittedAt: true,
      completedAt: true,
      lastReviewNote: true,
      _count: { select: { videoReviewAnnotations: { where: { status: 'open' } } } },
    },
  })
  return NextResponse.json({ review: reviewSummary(assignment) })
})

export const POST = apiHandler(async (
  _request: NextRequest,
  context: { params: Promise<{ projectId: string; canvasId: string; nodeId: string }> },
) => {
  const { projectId, canvasId, nodeId } = await context.params
  const authResult = await requireProjectAuthLight(projectId, ['canvasWrite', 'storyboardWrite'])
  if (isErrorResponse(authResult)) return authResult
  await requireCanvasInProject(canvasId, projectId)
  const actor = getWorkspaceActor(authResult.session)
  const [node, project] = await Promise.all([
    requirePlaylistNode(canvasId, nodeId),
    prisma.project.findFirst({
      where: { id: projectId, userId: actor.workspaceOwnerId, deletedAt: null },
      select: { id: true, name: true, collaborationMode: true },
    }),
  ])
  if (!project) throw new ApiError('NOT_FOUND', { message: '项目不存在。' })
  if (project.collaborationMode !== 'team') {
    throw new ApiError('CONFLICT', { message: '请先为项目开启团队任务分工并配置审核员，再提交播放列表终审。' })
  }

  const nodeData = (node.data || {}) as CanvasNodeData
  const playlistItems = normalizeCanvasPlaylistItems(nodeData.playlistItems)
  const fingerprint = canvasPlaylistFingerprint(playlistItems)
  const render = await resolveCurrentRender(projectId, nodeId, fingerprint, nodeData.playlistRender)
  if (!render) {
    throw new ApiError('CONFLICT', { message: '当前播放列表尚未渲染成片，或剪辑已在渲染后发生变化。请先重新渲染成片。' })
  }
  const sourceNodeIds = Array.from(new Set(playlistItems.map((item) => item.sourceNodeId).filter((value): value is string => Boolean(value))))
  const sourceNodes = sourceNodeIds.length ? await prisma.canvasNode.findMany({
    where: { canvasId, id: { in: sourceNodeIds } },
    select: { id: true, type: true, data: true },
  }) : []

  let submission: ReturnType<typeof resolveCanvasPlaylistTimeline>
  try {
    submission = resolveCanvasPlaylistTimeline({
      projectName: project.name,
      canvasId,
      nodeId,
      title: nodeData.title || '播放列表',
      items: playlistItems,
      sourceNodes: sourceNodes.map((source) => ({
        id: source.id,
        type: source.type,
        data: (source.data || {}) as CanvasNodeData,
      })),
      requireReady: true,
      episodeOutputUrl: render.outputUrl,
      renderFingerprint: render.fingerprint,
    })
  } catch (error) {
    throw new ApiError('CONFLICT', { message: error instanceof Error ? error.message : '播放列表无法提交审核。' })
  }

  const scopeId = canvasPlaylistScopeId(canvasId, nodeId)
  const assignment = await prisma.$transaction(async (tx) => {
    const current = await tx.workflowAssignment.findUnique({
      where: { projectId_scopeId_stage: { projectId, scopeId, stage: 'video' } },
    })
    if (current?.status === 'pending_review') {
      throw new ApiError('CONFLICT', { message: '当前播放列表版本正在审核，请等待审核结果后再提交。' })
    }
    if (current?.assigneeUserId && current.assigneeUserId !== actor.actorId && !isManagementRole(authResult.session.user.role)) {
      throw new ApiError('FORBIDDEN', { message: '只有该播放列表任务的执行人或管理账号可以重新提交。' })
    }

    const now = new Date()
    const record = current
      ? await tx.workflowAssignment.update({
          where: { uuid: current.uuid },
          data: {
            matched: true,
            status: 'pending_review',
            assigneeUserId: current.assigneeUserId || actor.actorId,
            assignedById: current.assignedById || actor.actorId,
            assignedAt: current.assignedAt || now,
            submittedAt: now,
            completedAt: null,
            submitCompletesDirectly: false,
          },
        })
      : await tx.workflowAssignment.create({
          data: {
            workspaceOwnerId: actor.workspaceOwnerId,
            projectId,
            episodeId: null,
            scopeId,
            stage: 'video',
            status: 'pending_review',
            assigneeUserId: actor.actorId,
            assignedById: actor.actorId,
            assignedAt: now,
            submittedAt: now,
            matched: true,
            submitCompletesDirectly: false,
          },
        })
    await resolveOpenVideoReviewAnnotations(tx, record.uuid, now)
    const reviewRound = await tx.workflowAssignmentEvent.count({
      where: { assignmentUuid: record.uuid, eventType: 'submit' },
    }) + 1
    await tx.workflowAssignmentEvent.create({
      data: {
        assignmentUuid: record.uuid,
        workspaceOwnerId: actor.workspaceOwnerId,
        actorUserId: actor.actorId,
        eventType: 'submit',
        fromStatus: current?.status || 'in_progress',
        toStatus: 'pending_review',
        payload: JSON.parse(JSON.stringify({
          reviewRound,
          reviewSubmission: submission.snapshot,
          reviewTarget: submission.target,
        })) as Prisma.InputJsonValue,
      },
    })
    return tx.workflowAssignment.findUniqueOrThrow({
      where: { uuid: record.uuid },
      select: {
        uuid: true,
        status: true,
        submittedAt: true,
        completedAt: true,
        lastReviewNote: true,
        _count: { select: { videoReviewAnnotations: { where: { status: 'open' } } } },
      },
    })
  })

  return NextResponse.json({
    review: reviewSummary(assignment),
    submission: {
      durationMs: submission.snapshot.durationMs,
      itemCount: submission.snapshot.segments.length,
    },
  })
})
