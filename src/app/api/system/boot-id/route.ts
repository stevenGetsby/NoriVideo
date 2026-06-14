import { NextResponse } from 'next/server'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler } from '@/lib/api-errors'
import { SERVER_BOOT_ID } from '@/lib/server-boot'

/**
 * GET /api/system/boot-id
 * 返回服务器启动ID，用于检测服务器是否重启
 */
export const GET = apiHandler(async () => {
    const authResult = await requireUserAuth()
    if (isErrorResponse(authResult)) return authResult

    return NextResponse.json({ bootId: SERVER_BOOT_ID })
})
