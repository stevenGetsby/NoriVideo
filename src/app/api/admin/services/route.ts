import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireSuperAdminAuth } from '@/lib/api-auth'
import { logInfo } from '@/lib/logging/core'
import { prisma } from '@/lib/prisma'
import {
  getLatestServiceHealth,
  getPlatformServiceConfigResponse,
  getPlatformServiceUsageOverview,
  savePlatformServiceConfig,
} from '@/lib/platform-services'

export const runtime = 'nodejs'

function rangeDays(request: NextRequest): number {
  const value = Number.parseInt(request.nextUrl.searchParams.get('days') || '30', 10)
  return value === 7 || value === 90 ? value : 30
}

export const GET = apiHandler(async (request: NextRequest) => {
  const authResult = await requireSuperAdminAuth()
  if (isErrorResponse(authResult)) return authResult

  const config = getPlatformServiceConfigResponse()
  const referencedUserIds = Array.from(new Set([
    ...config.internalModelViewUserIds,
    ...Object.keys(config.customerModelOverrides),
    ...Object.keys(config.customerModelRoutingOverrides),
  ]))
  const [health, usage, rawModelViewUsers, subAccountGroups] = await Promise.all([
    getLatestServiceHealth(),
    getPlatformServiceUsageOverview(rangeDays(request)),
    prisma.user.findMany({
      where: {
        OR: [
          ...(referencedUserIds.length > 0 ? [{ id: { in: referencedUserIds } }] : []),
          { role: { in: ['admin', 'super_admin', 'ADMIN'] } },
          { workspaceOwnerId: null },
        ],
      },
      select: { id: true, name: true, role: true, workspaceOwnerId: true },
      orderBy: { createdAt: 'asc' },
      take: 500,
    }).catch(() => []),
    prisma.user.groupBy({
      by: ['workspaceOwnerId'],
      where: {
        workspaceOwnerId: { not: null },
      },
      _count: { _all: true },
    }).catch(() => []),
  ])
  const subAccountCountByOwner = new Map<string, number>()
  for (const group of subAccountGroups) {
    if (group.workspaceOwnerId) {
      subAccountCountByOwner.set(group.workspaceOwnerId, group._count._all)
    }
  }
  const adminRoles = new Set(['super_admin', 'admin', 'ADMIN'])
  const modelViewUsers = rawModelViewUsers
    .map((user) => ({
      ...user,
      subAccountCount: user.workspaceOwnerId === null ? (subAccountCountByOwner.get(user.id) ?? 0) : 0,
    }))
    .sort((left, right) => {
      const rank = (user: { role: string; workspaceOwnerId: string | null }) => (
        adminRoles.has(user.role) ? 0 : user.workspaceOwnerId === null ? 1 : 2
      )
      return rank(left) - rank(right)
    })
  return NextResponse.json({
    success: true,
    config,
    health,
    usage,
    modelViewUsers,
  })
})

export const PUT = apiHandler(async (request: NextRequest) => {
  const authResult = await requireSuperAdminAuth()
  if (isErrorResponse(authResult)) return authResult
  const body = await request.json().catch(() => null)
  try {
    const config = await savePlatformServiceConfig(body)
    logInfo('[PlatformServices] 全局服务配置已更新', {
      audit: true,
      operatorUserId: authResult.session.user.actorId || authResult.session.user.id,
      providerCount: config.providers.length,
      modelCount: config.models.length,
      canvasAgentDefaultConfigured: config.canvasAgentModelCatalog.defaultModelKey !== null,
      canvasAgentEnabledModelCount: config.canvasAgentModelCatalog.models.filter((model) => model.enabled).length,
      storageType: config.storage.type,
    })
    return NextResponse.json({ success: true, config })
  } catch (error) {
    throw new ApiError('INVALID_PARAMS', {
      message: error instanceof Error
        ? error.message.replace(/^SERVICE_CONFIG_INVALID:\s*/i, '')
        : '服务配置格式无效',
    })
  }
})
