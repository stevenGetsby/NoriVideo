import { NextResponse } from 'next/server'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler } from '@/lib/api-errors'

async function unavailable() {
  const auth = await requireUserAuth()
  if (isErrorResponse(auth)) return auth
  return NextResponse.json({
    success: false,
    configured: false,
    error: { code: 'SEEDANCE_ASSETS_RETIRED', message: '旧版 Ark 素材库已停用，不再读取、保存或测试第三方密钥。' },
  }, { status: 410 })
}

export const GET = apiHandler(unavailable)
export const PUT = apiHandler(unavailable)
