import { NextResponse } from 'next/server'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler } from '@/lib/api-errors'

export const POST = apiHandler(async () => {
  const auth = await requireUserAuth()
  if (isErrorResponse(auth)) return auth
  return NextResponse.json({
    success: false,
    error: { code: 'CUSTOM_PROVIDER_TEST_RETIRED', message: '自定义 Provider 已停用。请由管理员在平台服务配置中检测 DeepSeek 或 Kuaizi。' },
  }, { status: 410 })
})
