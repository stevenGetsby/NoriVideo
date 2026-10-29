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
    error: { code: 'VOICE_DESIGN_RETIRED', message: '声音设计已停用：旧版百炼专用服务不再可用。可使用 Kuaizi 配音与已有音色。' },
  }, { status: 410 })
})
