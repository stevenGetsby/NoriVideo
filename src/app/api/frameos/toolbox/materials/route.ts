import { NextRequest } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireProjectAuthLight } from '@/lib/api-auth'
import { uploadFrameosMaterial } from '@/lib/frameos/material-upload'

export const POST = apiHandler(async (request: NextRequest) => {
  const projectId = request.nextUrl.searchParams.get('projectId')?.trim() || ''
  if (!projectId) {
    throw new ApiError('INVALID_PARAMS', { message: '工具箱上传缺少项目。' })
  }

  const authResult = await requireProjectAuthLight(projectId, ['toolboxUse'])
  if (isErrorResponse(authResult)) return authResult

  return await uploadFrameosMaterial(request, authResult.session, {
    expectedProjectId: projectId,
    projectAccessVerified: true,
  })
})
