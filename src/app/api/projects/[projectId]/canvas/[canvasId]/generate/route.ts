import { NextRequest } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireProjectAuthLight } from '@/lib/api-auth'
import { requireCanvasInProject } from '@/lib/canvas/access'
import {
  CANVAS_LEGACY_PANORAMA_ASPECT_RATIO,
  normalizeCanvasImageGenerationOptions,
  normalizeCanvasVideoGenerationOptions,
} from '@/lib/canvas/generator-options'
import { POST as generateToolboxAsset } from '@/app/api/frameos/toolbox/generate/route'

function cleanText(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

/**
 * Canvas-scoped facade for the shared toolbox generator. The generic toolbox
 * remains admin-only; this route is available to storyboard editors only after
 * both the project and destination canvas have been authorized.
 */
export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string; canvasId: string }> },
) => {
  const { projectId, canvasId } = await context.params
  const authResult = await requireProjectAuthLight(projectId, ['canvasWrite'])
  if (isErrorResponse(authResult)) return authResult
  await requireCanvasInProject(canvasId, projectId)

  const body = await request.clone().json().catch(() => null) as Record<string, unknown> | null
  if (!body || cleanText(body.projectId) !== projectId) {
    throw new ApiError('INVALID_PARAMS', { message: '生成任务的项目与当前画布不一致。' })
  }

  const type = cleanText(body.type)
  let delegatedRequest = request
  if (type === 'image' || type === 'video') {
    try {
      const rawOptions = record(body.options)
      const normalizedBody = type === 'image'
        ? {
            ...body,
            options: normalizeCanvasImageGenerationOptions(rawOptions, {
              allowPanorama: rawOptions.aspectRatio === CANVAS_LEGACY_PANORAMA_ASPECT_RATIO,
            }),
          }
        : (() => {
            const { inputMode, ...videoOptions } = normalizeCanvasVideoGenerationOptions(rawOptions, body.inputMode)
            return {
              ...body,
              inputMode,
              options: videoOptions,
            }
          })()
      delegatedRequest = new NextRequest(request.url, {
        method: 'POST',
        headers: request.headers,
        body: JSON.stringify(normalizedBody),
      })
    } catch (error) {
      throw new ApiError('INVALID_PARAMS', {
        message: error instanceof Error ? error.message : '画布生成参数无效。',
      })
    }
  }

  return await generateToolboxAsset(delegatedRequest, { params: Promise.resolve({ projectId, canvasId }) })
})
