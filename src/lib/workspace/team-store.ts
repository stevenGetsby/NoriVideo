import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

export const WORKSPACE_TEAM_ROLES = ['owner', 'writer', 'asset', 'producer'] as const
export const WORKSPACE_TEAM_PERMISSION_KEYS = ['projects', 'scripts', 'assets', 'production', 'records'] as const
export const WORKSPACE_TEAM_SEAT_STATUSES = ['enabled', 'reserved'] as const

export type WorkspaceTeamRole = typeof WORKSPACE_TEAM_ROLES[number]
export type WorkspaceTeamPermissionKey = typeof WORKSPACE_TEAM_PERMISSION_KEYS[number]
export type WorkspaceTeamSeatStatus = typeof WORKSPACE_TEAM_SEAT_STATUSES[number]

const ROLE_ORDER = new Map<WorkspaceTeamRole, number>(WORKSPACE_TEAM_ROLES.map((role, index) => [role, index]))

const DEFAULT_PERMISSIONS: Record<WorkspaceTeamRole, WorkspaceTeamPermissionKey[]> = {
  owner: ['projects', 'scripts', 'assets', 'production', 'records'],
  writer: ['projects', 'scripts'],
  asset: ['assets', 'records'],
  producer: ['projects', 'production', 'records'],
}

function unique<T>(values: T[]) {
  return Array.from(new Set(values))
}

function readString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function readOptionalString(body: Record<string, unknown>, key: string, maxLength: number) {
  if (!Object.prototype.hasOwnProperty.call(body, key)) return undefined
  const value = readString(body[key])
  return value ? value.slice(0, maxLength) : null
}

function readPermissionKeys(value: unknown) {
  if (Array.isArray(value)) {
    return value.filter((item): item is WorkspaceTeamPermissionKey => (
      typeof item === 'string' && WORKSPACE_TEAM_PERMISSION_KEYS.includes(item as WorkspaceTeamPermissionKey)
    ))
  }

  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .filter(([, enabled]) => Boolean(enabled))
      .map(([key]) => key)
      .filter((key): key is WorkspaceTeamPermissionKey => (
        WORKSPACE_TEAM_PERMISSION_KEYS.includes(key as WorkspaceTeamPermissionKey)
      ))
  }

  return []
}

export function isWorkspaceTeamRole(value: unknown): value is WorkspaceTeamRole {
  return typeof value === 'string' && WORKSPACE_TEAM_ROLES.includes(value as WorkspaceTeamRole)
}

export function defaultWorkspaceTeamPermissions(role: WorkspaceTeamRole) {
  return [...DEFAULT_PERMISSIONS[role]]
}

export function normalizeWorkspaceTeamSeatStatus(
  role: WorkspaceTeamRole,
  value: unknown,
): WorkspaceTeamSeatStatus {
  if (role === 'owner') return 'enabled'
  return WORKSPACE_TEAM_SEAT_STATUSES.includes(value as WorkspaceTeamSeatStatus)
    ? value as WorkspaceTeamSeatStatus
    : 'reserved'
}

export function normalizeWorkspaceTeamPermissions(role: WorkspaceTeamRole, value: unknown) {
  if (role === 'owner') return defaultWorkspaceTeamPermissions(role)
  const permissions = unique(readPermissionKeys(value))
  return permissions.length > 0 ? permissions : defaultWorkspaceTeamPermissions(role)
}

export function countWorkspaceTeamPermissions(role: WorkspaceTeamRole, value: unknown) {
  return normalizeWorkspaceTeamPermissions(role, value).length
}

export function normalizeWorkspaceTeamSeatPatch(body: Record<string, unknown>) {
  const role = body.role
  if (!isWorkspaceTeamRole(role)) return null

  return {
    role,
    status: normalizeWorkspaceTeamSeatStatus(role, body.status),
    displayName: readOptionalString(body, 'displayName', 191),
    email: readOptionalString(body, 'email', 191),
    permissions: Object.prototype.hasOwnProperty.call(body, 'permissions')
      ? normalizeWorkspaceTeamPermissions(role, body.permissions)
      : undefined,
  }
}

function sortSeats<T extends { role: string; sortOrder: number }>(seats: T[]) {
  return [...seats].sort((a, b) => {
    const orderA = ROLE_ORDER.get(a.role as WorkspaceTeamRole) ?? a.sortOrder
    const orderB = ROLE_ORDER.get(b.role as WorkspaceTeamRole) ?? b.sortOrder
    return orderA - orderB
  })
}

function defaultSeatCreateData(params: {
  profileId: string
  userId: string
  role: WorkspaceTeamRole
  name?: string | null
  email?: string | null
}) {
  const sortOrder = ROLE_ORDER.get(params.role) ?? 0
  const isOwner = params.role === 'owner'
  return {
    profileId: params.profileId,
    memberUserId: isOwner ? params.userId : null,
    role: params.role,
    status: isOwner ? 'enabled' : 'reserved',
    displayName: isOwner ? (params.name || params.email || 'Owner') : null,
    email: isOwner ? (params.email || null) : null,
    permissions: defaultWorkspaceTeamPermissions(params.role),
    sortOrder,
  } satisfies Prisma.WorkspaceTeamSeatUncheckedCreateInput
}

export async function ensureWorkspaceTeamState(params: {
  userId: string
  name?: string | null
  email?: string | null
}) {
  const profile = await prisma.workspaceTeamProfile.upsert({
    where: { userId: params.userId },
    create: {
      userId: params.userId,
      mode: 'personal',
      displayName: params.name || params.email || null,
      seatLimit: WORKSPACE_TEAM_ROLES.length,
    },
    update: {},
  })

  await Promise.all(WORKSPACE_TEAM_ROLES.map((role) => prisma.workspaceTeamSeat.upsert({
    where: {
      profileId_role: {
        profileId: profile.id,
        role,
      },
    },
    create: defaultSeatCreateData({
      profileId: profile.id,
      userId: params.userId,
      role,
      name: params.name,
      email: params.email,
    }),
    update: {},
  })))

  const seats = await prisma.workspaceTeamSeat.findMany({
    where: { profileId: profile.id },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  })

  return {
    profile,
    seats: sortSeats(seats),
  }
}

export async function updateWorkspaceTeamSeat(params: {
  userId: string
  name?: string | null
  email?: string | null
  body: Record<string, unknown>
}) {
  const patch = normalizeWorkspaceTeamSeatPatch(params.body)
  if (!patch) return null

  const state = await ensureWorkspaceTeamState(params)
  const data: Prisma.WorkspaceTeamSeatUncheckedUpdateInput = {
    status: patch.status,
  }
  if (patch.displayName !== undefined) data.displayName = patch.displayName
  if (patch.email !== undefined) data.email = patch.email
  if (patch.permissions !== undefined) data.permissions = patch.permissions

  const seat = await prisma.workspaceTeamSeat.update({
    where: {
      profileId_role: {
        profileId: state.profile.id,
        role: patch.role,
      },
    },
    data,
  })
  const seats = await prisma.workspaceTeamSeat.findMany({
    where: { profileId: state.profile.id },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  })

  return {
    profile: state.profile,
    seat,
    seats: sortSeats(seats),
  }
}
