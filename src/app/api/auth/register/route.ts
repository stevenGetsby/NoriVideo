import { NextResponse } from 'next/server'
import { apiHandler } from '@/lib/api-errors'

export const POST = apiHandler(async () => NextResponse.json(
  {
    success: false,
    code: 'REGISTRATION_DISABLED',
    message: '系统不开放注册，请联系管理账号分配账号、密码、角色和功能区权限。',
  },
  { status: 403 },
))
