import { NextResponse } from 'next/server'
import { apiHandler } from '@/lib/api-errors'

export const POST = apiHandler(async () => NextResponse.json(
  {
    success: false,
    code: 'REGISTRATION_DISABLED',
    message: '系统不开放注册，请联系管理账号创建账号并设置初始密码。',
  },
  { status: 403 },
))
