import { NextResponse } from 'next/server'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler } from '@/lib/api-errors'
import { readSystemStatusSnapshot } from '@/lib/system/status'
import { appendUpdateCheckRecord, readUpdateCheckRecords } from '@/lib/system/update-check-store'

export const GET = apiHandler(async () => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult

  const records = await readUpdateCheckRecords(authResult.session.user.id)
  return NextResponse.json({
    success: true,
    records,
  })
})

export const POST = apiHandler(async () => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult

  const status = await readSystemStatusSnapshot()
  const records = await appendUpdateCheckRecord(authResult.session.user.id, status)
  return NextResponse.json({
    success: true,
    status,
    records,
  })
})
