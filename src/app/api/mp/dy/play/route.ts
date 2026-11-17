import { NextRequest, NextResponse } from 'next/server'
import { apiHandler } from '@/lib/api-errors'
import { assertUserApp, dyAppIdOf, requireDyUser, withDyTokenHeader } from '@/lib/mp/dy/auth'
import { dyPlayManifest } from '@/lib/mp/dy/play'

export const runtime = 'nodejs'

export const GET = apiHandler(async (request: NextRequest) => {
  const appId = dyAppIdOf(request)
  const auth = await requireDyUser(request)
  assertUserApp(auth.user, appId)
  const release = request.nextUrl.searchParams.get('release') ?? ''
  const data = await dyPlayManifest(appId, release)
  return withDyTokenHeader(NextResponse.json(data), auth)
})