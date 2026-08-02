import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireSuperAdminAuth } from '@/lib/api-auth'
import { logInfo } from '@/lib/logging/core'
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

  const [health, usage] = await Promise.all([
    getLatestServiceHealth(),
    getPlatformServiceUsageOverview(rangeDays(request)),
  ])
  return NextResponse.json({
    success: true,
    config: getPlatformServiceConfigResponse(),
    health,
    usage,
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

