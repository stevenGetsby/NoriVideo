import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireSuperAdminAuth } from '@/lib/api-auth'
import { discoverProviderTextModels } from '@/lib/platform-services/discovery'

export const runtime = 'nodejs'
export const maxDuration = 30

export const POST = apiHandler(async (request: NextRequest) => {
  const authResult = await requireSuperAdminAuth()
  if (isErrorResponse(authResult)) return authResult
  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  const providerId = typeof body?.providerId === 'string' ? body.providerId.trim() : ''
  if (!providerId) throw new ApiError('INVALID_PARAMS', { message: '请选择要同步模型的服务' })

  try {
    const result = await discoverProviderTextModels(providerId)
    return NextResponse.json({ success: true, ...result, discoveredAt: new Date().toISOString() })
  } catch (error) {
    throw new ApiError('INVALID_PARAMS', {
      message: error instanceof Error ? error.message : '读取模型列表失败',
    })
  }
})
