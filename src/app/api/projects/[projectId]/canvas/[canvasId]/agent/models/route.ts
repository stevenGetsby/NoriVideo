import { NextResponse, type NextRequest } from 'next/server'
import { isErrorResponse, requireProjectAuthLight } from '@/lib/api-auth'
import { apiHandler } from '@/lib/api-errors'
import { getCanvasAgentModelCatalog } from '@/lib/canvas-agent/model-runtime'
import { assertCanvasAgentProjectSupported } from '@/lib/canvas-agent/project-scope'
import { requireCanvasInProject } from '@/lib/canvas/access'
import { getPlatformServiceConfigResponse } from '@/lib/platform-services/config'
import { isInternalModelViewer, viewerContextFromSession } from '@/lib/platform-services/model-selection'

export const GET = apiHandler(async (_request: NextRequest, { params }: { params: Promise<{ projectId: string; canvasId: string }> }) => {
  const { projectId, canvasId } = await params
  const auth = await requireProjectAuthLight(projectId, ['canvasWrite'])
  if (isErrorResponse(auth)) return auth
  await requireCanvasInProject(canvasId, projectId)
  await assertCanvasAgentProjectSupported(projectId)
  const internalViewer = isInternalModelViewer(getPlatformServiceConfigResponse(), viewerContextFromSession(auth.session))
  const { defaultModelKey, models } = getCanvasAgentModelCatalog()
  return NextResponse.json({
    defaultModelKey,
    ...(process.env.NODE_ENV !== 'production' && process.env.CANVAS_AGENT_FAKE_MODEL === '1' ? { fixtureAvailable: true } : {}),
    models: models.filter((item) => item.enabled).map(({ modelKey, providerId, modelId, displayName, protocol, supportsTemperature }) => (
      internalViewer
        ? { modelKey, providerId, modelId, displayName, protocol, supportsTemperature }
        : { modelKey, modelId, displayName, protocol, supportsTemperature }
    )),
  }, { headers: { 'Cache-Control': 'no-store' } })
})
