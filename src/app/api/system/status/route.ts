import { NextResponse } from 'next/server'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler } from '@/lib/api-errors'
import { readSystemStatusSnapshot } from '@/lib/system/status'

export const GET = apiHandler(async () => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult

  return NextResponse.json(await readSystemStatusSnapshot({ userId: authResult.session.user.id }))
})
