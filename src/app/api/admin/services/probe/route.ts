import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireSuperAdminAuth } from '@/lib/api-auth'
import { probeProviderHealth, probeStorageHealth } from '@/lib/platform-services'

export const runtime = 'nodejs'
export const maxDuration = 60

export const POST = apiHandler(async (request: NextRequest) => {
  const authResult = await requireSuperAdminAuth()
  if (isErrorResponse(authResult)) return authResult
  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  if (!body) throw new ApiError('INVALID_PARAMS', { message: '检测参数无效' })
  const checkedBy = authResult.session.user.actorId || authResult.session.user.id
  if (body.targetType === 'storage') {
    return NextResponse.json({ success: true, health: await probeStorageHealth(checkedBy) })
  }
  if (body.targetType === 'provider' && typeof body.targetId === 'string' && body.targetId.trim()) {
    return NextResponse.json({
      success: true,
      health: await probeProviderHealth(body.targetId.trim(), checkedBy),
    })
  }
  throw new ApiError('INVALID_PARAMS', { message: '请选择要检测的服务' })
})
