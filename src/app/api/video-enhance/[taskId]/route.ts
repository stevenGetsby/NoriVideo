import { NextRequest, NextResponse } from 'next/server'
import { apiHandler } from '@/lib/api-errors'
import { isErrorResponse, requireUserAuth } from '@/lib/api-auth'

export const GET = apiHandler(async (_request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  return NextResponse.json({
    success: false,
    error: { code: 'VIDEO_ENHANCE_RETIRED', message: '视频画质增强已停用，不再查询 MediaKit 任务。已有完成结果仍可在历史记录中下载。' },
  }, { status: 410 })
})
