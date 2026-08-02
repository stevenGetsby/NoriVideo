import type { AuthSession } from '@/lib/api-auth'
import { ApiError } from '@/lib/api-errors'
import { hasAccountPermissions, type AccountPermission } from '@/lib/account/permissions'
import {
  getWorkspaceActor,
  requireProjectAssignmentReviewer,
  requireProjectReader,
} from '@/lib/collaboration/access'
import { prisma } from '@/lib/prisma'
import { isCanvasPlaylistScopeId } from '@/lib/canvas/playlist'

export type AssignmentNavigationIntent = 'work' | 'review' | 'view'

const STAGE_PERMISSION: Record<string, AccountPermission> = {
  script: 'scriptWrite',
  asset: 'assetWrite',
  storyboard: 'storyboardWrite',
  video: 'storyboardWrite',
}

function isProjectLevelStage(stage: string) {
  return stage === 'script' || stage === 'asset'
}

export function parseAssignmentNavigationIntent(value: unknown): AssignmentNavigationIntent {
  if (value === 'work' || value === 'review' || value === 'view') return value
  throw new ApiError('INVALID_PARAMS', { message: '任务导航意图无效。' })
}

export function parseLegacyAssignmentEpisodeNumber(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  const match = normalized.match(/^\d+$/)
    || normalized.match(/^(?:episode|ep)\s*[:#/_-]?\s*(\d+)$/i)
    || normalized.match(/^第\s*(\d+)\s*集$/)
  if (!match) return null
  const episodeNumber = Number(match[1] || match[0])
  return Number.isSafeInteger(episodeNumber) && episodeNumber > 0 ? episodeNumber : null
}

export async function validateAssignmentNavigation(
  session: AuthSession,
  assignmentId: string,
  intent: AssignmentNavigationIntent,
) {
  const actor = getWorkspaceActor(session)
  const assignment = await prisma.workflowAssignment.findFirst({
    where: {
      uuid: assignmentId,
      workspaceOwnerId: actor.workspaceOwnerId,
    },
    select: {
      uuid: true,
      projectId: true,
      scopeId: true,
      stage: true,
      status: true,
      matched: true,
      assigneeUserId: true,
      episodeId: true,
      episode: {
        select: {
          id: true,
          novelPromotionProject: { select: { projectId: true } },
          storyboards: {
            select: { panels: { select: { id: true }, take: 1 } },
          },
        },
      },
    },
  })
  if (!assignment) throw new ApiError('NOT_FOUND', { message: '协作任务不存在。' })

  await requireProjectReader(session, assignment.projectId)
  if (!assignment.matched) {
    throw new ApiError('CONFLICT', { message: '该任务已不再匹配当前项目内容，请刷新任务列表。' })
  }

  const stagePermission = STAGE_PERMISSION[assignment.stage]
  if (!stagePermission) throw new ApiError('CONFLICT', { message: '任务阶段无效，请刷新任务列表。' })

  if (intent === 'work') {
    if (assignment.assigneeUserId !== actor.actorId) {
      throw new ApiError('FORBIDDEN', { message: '该任务已不再分配给当前账号。' })
    }
    if (assignment.status !== 'in_progress' && assignment.status !== 'rejected') {
      throw new ApiError('CONFLICT', { message: '任务状态已变化，请刷新任务列表。' })
    }
    if (!hasAccountPermissions({ role: session.user.role, permissions: session.user.permissions }, [stagePermission])) {
      throw new ApiError('FORBIDDEN', { message: '当前账号不再具有该任务阶段的编辑权限。' })
    }
  } else if (intent === 'review') {
    if (assignment.status !== 'pending_review') {
      throw new ApiError('CONFLICT', { message: '任务已不在待审核状态，请刷新任务列表。' })
    }
    await requireProjectAssignmentReviewer(session, assignment.projectId)
  }

  if (assignment.stage === 'video' && isCanvasPlaylistScopeId(assignment.scopeId)) {
    return {
      allowed: true as const,
      assignment: {
        id: assignment.uuid,
        projectId: assignment.projectId,
        stage: assignment.stage,
        episodeId: null,
        scopeId: assignment.scopeId,
      },
    }
  }

  let resolvedEpisodeId = assignment.episodeId
  let resolvedEpisode = assignment.episode
  if (!isProjectLevelStage(assignment.stage) && !resolvedEpisodeId) {
    const legacyEpisodeNumber = parseLegacyAssignmentEpisodeNumber(assignment.scopeId)
    if (legacyEpisodeNumber) {
      resolvedEpisode = await prisma.novelPromotionEpisode.findFirst({
        where: {
          episodeNumber: legacyEpisodeNumber,
          novelPromotionProject: { projectId: assignment.projectId },
        },
        select: {
          id: true,
          novelPromotionProject: { select: { projectId: true } },
          storyboards: {
            select: { panels: { select: { id: true }, take: 1 } },
          },
        },
      })
      resolvedEpisodeId = resolvedEpisode?.id || null
    }
  }

  if (!isProjectLevelStage(assignment.stage)) {
    if (
      !resolvedEpisodeId
      || !resolvedEpisode
      || resolvedEpisode.id !== resolvedEpisodeId
      || resolvedEpisode.novelPromotionProject.projectId !== assignment.projectId
    ) {
      throw new ApiError('CONFLICT', { message: '任务对应分集已不存在或不属于当前项目。' })
    }
  }

  if (assignment.stage === 'video') {
    const hasPanel = resolvedEpisode?.storyboards.some((storyboard) => storyboard.panels.length > 0) === true
    if (!hasPanel) {
      throw new ApiError('CONFLICT', { message: '本集尚未生成分镜 Panel，暂不能进入视频制作。' })
    }
    const confirmed = await prisma.workflowStageState.findFirst({
      where: {
        projectId: assignment.projectId,
        scopeId: resolvedEpisodeId!,
        stageKey: 'storyboard',
        OR: [
          { reviewState: 'confirmed' },
          { status: 'approved' },
        ],
      },
      select: { id: true },
    })
    if (!confirmed) {
      throw new ApiError('CONFLICT', { message: '请先确认本集分镜 Panel，再进入视频制作。' })
    }
  }

  return {
    allowed: true as const,
    assignment: {
      id: assignment.uuid,
      projectId: assignment.projectId,
      stage: assignment.stage,
      episodeId: resolvedEpisodeId,
    },
  }
}
