import { NextRequest, NextResponse } from 'next/server'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import {
  countWorkspaceTeamPermissions,
  isWorkspaceTeamRole,
  normalizeWorkspaceTeamSeatStatus,
  updateWorkspaceTeamSeat,
} from '@/lib/workspace/team-store'

function serializeSeat(seat: {
  id: string
  role: string
  status: string
  displayName: string | null
  email: string | null
  permissions: unknown
  lastActivityAt: Date | null
  updatedAt: Date
}) {
  if (!isWorkspaceTeamRole(seat.role)) return null
  const role = seat.role
  return {
    id: seat.id,
    role,
    status: normalizeWorkspaceTeamSeatStatus(role, seat.status),
    displayName: seat.displayName,
    email: seat.email,
    lastActivity: seat.lastActivityAt?.toISOString() || null,
    permissions: countWorkspaceTeamPermissions(role, seat.permissions),
    permissionKeys: seat.permissions,
    updatedAt: seat.updatedAt.toISOString(),
  }
}

export const PATCH = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult

  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  const result = await updateWorkspaceTeamSeat({
    userId: authResult.session.user.id,
    name: authResult.session.user.name,
    email: authResult.session.user.email,
    body,
  })

  if (!result) {
    throw new ApiError('INVALID_PARAMS', { message: 'Invalid workspace team seat payload' })
  }

  const seat = serializeSeat(result.seat)
  return NextResponse.json({
    success: true,
    source: 'workspace-team-seats',
    profile: {
      id: result.profile.id,
      mode: result.profile.mode,
      seatLimit: result.profile.seatLimit,
      displayName: result.profile.displayName,
    },
    seat,
    seats: result.seats.map(serializeSeat).filter(Boolean),
  })
})
