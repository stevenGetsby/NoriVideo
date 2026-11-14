import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireUserPermission } from '@/lib/api-auth'
import { requireInteractiveStoryAccess } from '@/lib/interactive/service'
import { prepareStoryAssetImage, uploadStoryAssetObject } from '@/lib/interactive/story-asset'
import { getSignedUrl } from '@/lib/storage'

type RouteContext = { params: Promise<{ workId: string }> }

// POST - upload one picture (button / option / prop art) used by the interactions of a 影游.
export const POST = apiHandler(async (request: NextRequest, context: RouteContext) => {
  const authResult = await requireUserPermission(['canvasWrite'])
  if (isErrorResponse(authResult)) return authResult
  const { workId } = await context.params
  await requireInteractiveStoryAccess(authResult.session, workId)

  const form = await request.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File)) {
    throw new ApiError('INVALID_PARAMS', { code: 'STORY_ASSET_FILE_REQUIRED', field: 'file', message: '请选择一张图片。' })
  }

  const prepared = await prepareStoryAssetImage(file)
  const key = await uploadStoryAssetObject(workId, prepared)
  return NextResponse.json({ success: true, key, url: getSignedUrl(key) })
})
