import { NextResponse } from 'next/server'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler } from '@/lib/api-errors'

export const POST = apiHandler(async (
  _request: Request,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params
  const auth = await requireProjectAuthLight(projectId)
  if (isErrorResponse(auth)) return auth
  return NextResponse.json({
    success: false,
    error: { code: 'LIP_SYNC_RETIRED', message: '唇形同步已停用：当前平台没有配置对应的生成服务。' },
  }, { status: 410 })
})
