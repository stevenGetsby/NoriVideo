import { NextResponse } from 'next/server'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler } from '@/lib/api-errors'
import { prisma } from '@/lib/prisma'
import { containsInternalRecordMarker } from '@/lib/workspace/internal-record-visibility'
import {
  countWorkspaceTeamPermissions,
  ensureWorkspaceTeamState,
  isWorkspaceTeamRole,
  normalizeWorkspaceTeamSeatStatus,
} from '@/lib/workspace/team-store'

function isInternalTask(task: { type: string; targetType?: string | null; errorMessage?: string | null }) {
  return containsInternalRecordMarker(task.type, task.targetType, task.errorMessage)
}

function latestIso(values: Array<Date | string | null | undefined>) {
  const timestamps = values
    .map((value) => value ? new Date(value).getTime() : Number.NaN)
    .filter((value) => Number.isFinite(value))
  if (timestamps.length === 0) return null
  return new Date(Math.max(...timestamps)).toISOString()
}

function estimateServiceUnits(tasks: Array<{ type: string; status: string }>) {
  return tasks.reduce((sum, task) => {
    if (task.status !== 'completed') return sum
    const text = task.type.toLowerCase()
    if (text.includes('video')) return sum + 6
    if (text.includes('voice') || text.includes('tts')) return sum + 2
    if (text.includes('image') || text.includes('storyboard')) return sum + 1
    return sum
  }, 0)
}

export const GET = apiHandler(async () => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  const [projectTotal, projects, tasks, teamState] = await Promise.all([
    prisma.project.count({ where: { userId: session.user.id } }),
    prisma.project.findMany({
      where: { userId: session.user.id },
      orderBy: { updatedAt: 'desc' },
      take: 6,
      select: {
        id: true,
        name: true,
        updatedAt: true,
        novelPromotionData: {
          select: {
            episodes: {
              select: {
                id: true,
                storyboards: {
                  select: {
                    _count: { select: { panels: true } },
                    panels: {
                      select: { videoUrl: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
    }),
    prisma.task.findMany({
      where: { userId: session.user.id },
      orderBy: { updatedAt: 'desc' },
      take: 80,
      select: {
        id: true,
        type: true,
        targetType: true,
        status: true,
        errorMessage: true,
        updatedAt: true,
        projectId: true,
      },
    }),
    ensureWorkspaceTeamState({
      userId: session.user.id,
      name: session.user.name,
      email: session.user.email,
    }),
  ])

  const visibleTasks = tasks.filter((task) => !isInternalTask(task))
  const projectRows = projects.map((project) => {
    const episodes = project.novelPromotionData?.episodes || []
    let panels = 0
    let videos = 0
    for (const episode of episodes) {
      for (const storyboard of episode.storyboards) {
        panels += storyboard._count.panels
        videos += storyboard.panels.filter((panel) => Boolean(panel.videoUrl)).length
      }
    }
    return {
      id: project.id,
      name: project.name,
      updatedAt: project.updatedAt.toISOString(),
      stats: {
        episodes: episodes.length,
        panels,
        videos,
      },
    }
  })

  const activeTasks = visibleTasks.filter((task) => task.status === 'queued' || task.status === 'processing').length
  const failedTasks = visibleTasks.filter((task) => task.status === 'failed').length
  const serviceUnits = estimateServiceUnits(visibleTasks)
  const latestActivity = latestIso([
    ...projectRows.map((project) => project.updatedAt),
    ...visibleTasks.map((task) => task.updatedAt),
  ])

  const workloadMap = new Map<string, { key: string; count: number; failed: number }>()
  for (const task of visibleTasks) {
    const current = workloadMap.get(task.type) || { key: task.type, count: 0, failed: 0 }
    current.count += 1
    if (task.status === 'failed') current.failed += 1
    workloadMap.set(task.type, current)
  }

  return NextResponse.json({
    success: true,
    source: 'workspace-team-overview',
    teamStateSource: 'database',
    profile: {
      id: session.user.id,
      teamProfileId: teamState.profile.id,
      name: session.user.name || null,
      email: session.user.email || null,
      mode: teamState.profile.mode,
      displayName: teamState.profile.displayName,
      seatLimit: teamState.profile.seatLimit,
    },
    projects: projectRows,
    projectTotal,
    tasks: visibleTasks.map((task) => ({
      id: task.id,
      type: task.type,
      status: task.status,
      updatedAt: task.updatedAt.toISOString(),
      projectId: task.projectId,
    })),
    stats: {
      projects: projectTotal,
      episodes: projectRows.reduce((sum, project) => sum + project.stats.episodes, 0),
      activeTasks,
      failedTasks,
    },
    workloadRows: Array.from(workloadMap.values()).sort((a, b) => b.count - a.count).slice(0, 8),
    quotaRows: {
      projects: { used: projectTotal, limit: Math.max(10, projectTotal) },
      runningTasks: { used: activeTasks, limit: 8 },
      serviceUnits: { used: serviceUnits, limit: Math.max(120, serviceUnits) },
    },
    seatRows: teamState.seats.map((seat) => {
      if (!isWorkspaceTeamRole(seat.role)) return null
      const role = seat.role
      return {
        id: seat.id,
        role,
        status: normalizeWorkspaceTeamSeatStatus(role, seat.status),
        displayName: seat.displayName,
        email: seat.email,
        projects: role === 'owner' ? projectTotal : 0,
        workload: role === 'owner' ? visibleTasks.length : 0,
        lastActivity: seat.lastActivityAt?.toISOString() || (role === 'owner' ? latestActivity : null),
        permissions: countWorkspaceTeamPermissions(role, seat.permissions),
        permissionKeys: seat.permissions,
        updatedAt: seat.updatedAt.toISOString(),
      }
    }).filter(Boolean),
  })
})
