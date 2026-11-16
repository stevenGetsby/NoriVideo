import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireSuperAdminAuth } from '@/lib/api-auth'
import { logInfo } from '@/lib/logging/core'
import { prisma } from '@/lib/prisma'
import { listNoriBusinessModels } from '@/lib/nori-model-catalog'
import { listTggSelectableModels } from '@/lib/providers/tgg/catalog'
import { VIDEO_BUSINESS_KEYS } from '@/lib/providers/tgg/routes'
import {
  getPlatformServiceConfigResponse,
  isUsableServiceSecret,
  readMaterializedPlatformServiceConfig,
  savePlatformModelRouting,
} from '@/lib/platform-services/config'
import { deriveVideoProvider, planVideoProviderSwitch, type VideoProvider } from '@/lib/platform-services/video-provider-switch'

export const runtime = 'nodejs'

function countInFlightVideoTasks(externalIdPrefix: string): Promise<number> {
  return prisma.task.count({
    where: { status: { in: ['queued', 'processing'] }, externalId: { startsWith: externalIdPrefix } },
  })
}

export const GET = apiHandler(async () => {
  const authResult = await requireSuperAdminAuth()
  if (isErrorResponse(authResult)) return authResult

  const config = getPlatformServiceConfigResponse()
  const [kuaizi, tgg] = await Promise.all([
    countInFlightVideoTasks('KUAIZI:VIDEO:'),
    countInFlightVideoTasks('TGG:VIDEO:'),
  ])
  return NextResponse.json({
    success: true,
    current: deriveVideoProvider(config.modelRouting, VIDEO_BUSINESS_KEYS),
    inFlight: { kuaizi, tgg },
  })
})

export const POST = apiHandler(async (request: NextRequest) => {
  const authResult = await requireSuperAdminAuth()
  if (isErrorResponse(authResult)) return authResult

  const body = await request.json().catch(() => null) as { target?: unknown; dryRun?: unknown } | null
  const target: VideoProvider | null = body?.target === 'kuaizi' || body?.target === 'tgg' ? body.target : null
  if (!target) throw new ApiError('INVALID_PARAMS', { message: 'target 必须是 kuaizi 或 tgg' })

  const config = getPlatformServiceConfigResponse()
  const materialized = readMaterializedPlatformServiceConfig()
  const hasProviderKey = (providerId: string) => isUsableServiceSecret(
    materialized.llm?.providers?.find((provider) => provider.id === providerId)?.apiKey,
  )
  const plan = planVideoProviderSwitch({
    routing: config.modelRouting,
    businessModels: listNoriBusinessModels(),
    selectableTgg: listTggSelectableModels().map((model) => `tgg::${model.modelId}`),
    hasTggKey: hasProviderKey('tgg'),
    hasKuaiziKey: hasProviderKey('kuaizi'),
    target,
  })

  if (body?.dryRun === true) return NextResponse.json({ success: true, plan })
  if (plan.blockers.length > 0) return NextResponse.json({ success: false, plan }, { status: 409 })

  const patch = Object.fromEntries(
    plan.rows.filter((row) => row.action === 'switch').map((row) => [row.businessKey, row.to]),
  )
  try {
    await savePlatformModelRouting(patch)
  } catch (error) {
    throw new ApiError('INVALID_PARAMS', {
      message: error instanceof Error
        ? error.message.replace(/^SERVICE_CONFIG_INVALID:\s*/i, '')
        : '视频路由切换失败',
    })
  }
  logInfo('[PlatformServices] 视频上游已切换', {
    audit: true,
    operatorUserId: authResult.session.user.actorId || authResult.session.user.id,
    from: plan.current,
    to: target,
    changedKeys: Object.keys(patch),
  })
  return NextResponse.json({ success: true, plan: { ...plan, applied: true } })
})
