import { NextResponse } from 'next/server'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler } from '@/lib/api-errors'

export const runtime = 'nodejs'

async function unavailable() {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  return NextResponse.json({ success: false, configured: false, error: { message: '视频转绘已停用：旧版 Ark 专用链路不再可用。已有剧本可在编剧工作台继续编辑。' } }, { status: 410 })
}

export const GET = apiHandler(unavailable)
export const POST = apiHandler(unavailable)
