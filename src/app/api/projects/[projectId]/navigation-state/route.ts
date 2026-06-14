import { NextResponse } from 'next/server'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler } from '@/lib/api-errors'
import { readSuperAgentNavigationState } from '@/lib/super-agent/navigation-state'

export const GET = apiHandler(async (
  _request: Request,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const navigationState = await readSuperAgentNavigationState({
    userId: authResult.session.user.id,
    projectId,
  })

  return NextResponse.json({
    success: true,
    projectId,
    navigationLocked: navigationState.locked,
  })
})
