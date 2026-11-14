import { NextRequest } from 'next/server'
import { apiHandler } from '@/lib/api-errors'
import { isErrorResponse, requireUserPermission } from '@/lib/api-auth'
import { replaceFrameosMaterialImage } from '@/lib/frameos/material-replace-image'

export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ materialId: string }> },
) => {
  const authResult = await requireUserPermission(['assetWrite'])
  if (isErrorResponse(authResult)) return authResult
  const { materialId } = await context.params
  return await replaceFrameosMaterialImage(request, authResult.session, materialId)
})
