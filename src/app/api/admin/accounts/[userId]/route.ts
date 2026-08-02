import { Prisma } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { forbidden, isErrorResponse, requireAdminAuth } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'
import { logInfo } from '@/lib/logging/core'
import {
  defaultSubaccountRoleLabel,
  effectiveAccountPermissions,
  isAccountPermission,
  isAccountStatus,
  isSubaccountRole,
  normalizeAccountRole,
  type AccountStatus,
  type SubaccountRole,
} from '@/lib/account/permissions'
import {
  isDirectSubaccountOf,
  managedAccountSelect,
  serializeManagedAccount,
  type ManagedAccountRecord,
} from '@/lib/account/management'

const USERNAME_MAX_LENGTH = 64
const PASSWORD_MIN_LENGTH = 8
const PASSWORD_MAX_LENGTH = 128
const ROLE_LABEL_MAX_LENGTH = 64
const DELETED_ACCOUNT_STATUS = 'deleted'

function readUsername(value: unknown): string | undefined {
  if (value === undefined) return undefined
  const username = typeof value === 'string' ? value.trim() : ''
  if (
    username.length < 2
    || username.length > USERNAME_MAX_LENGTH
    || /[\u0000-\u001f\u007f]/u.test(username)
  ) {
    throw new ApiError('INVALID_PARAMS', { message: '账号长度需为 2–64 个字符，且不能包含控制字符。' })
  }
  return username
}

function readPassword(value: unknown): string | undefined {
  if (value === undefined || value === '') return undefined
  if (typeof value !== 'string' || value.length < PASSWORD_MIN_LENGTH || value.length > PASSWORD_MAX_LENGTH) {
    throw new ApiError('INVALID_PARAMS', { message: '密码长度需为 8–128 个字符。' })
  }
  return value
}

function readRoleLabel(value: unknown): string | undefined {
  if (value === undefined) return undefined
  const roleLabel = typeof value === 'string' ? value.trim() : ''
  if (
    roleLabel.length < 1
    || roleLabel.length > ROLE_LABEL_MAX_LENGTH
    || /[\u0000-\u001f\u007f]/u.test(roleLabel)
  ) {
    throw new ApiError('INVALID_PARAMS', { message: '角色名称需为 1–64 个字符，且不能包含控制字符。' })
  }
  return roleLabel
}

function readSubaccountPermissions(value: unknown, role: SubaccountRole) {
  if (role === 'reviewer') return effectiveAccountPermissions(role)
  if (value === undefined) return undefined
  if (!Array.isArray(value)) {
    throw new ApiError('INVALID_PARAMS', { message: '功能区权限必须是数组。' })
  }
  const containsInvalidPermission = value.some((permission) => (
    permission !== 'creativeGenerate' && !isAccountPermission(permission)
  ))
  if (containsInvalidPermission || value.includes('admin')) {
    throw new ApiError('INVALID_PARAMS', { message: '子账号包含不可分配的功能区权限。' })
  }
  return effectiveAccountPermissions(role, value)
}

function canManageTarget(
  operatorId: string,
  operatorRole: ReturnType<typeof normalizeAccountRole>,
  target: ManagedAccountRecord,
) {
  const targetRole = normalizeAccountRole(target.role)
  if (operatorRole === 'super_admin') {
    return targetRole === 'admin' && target.parentAccountId === operatorId
  }
  return operatorRole === 'admin'
    && isSubaccountRole(targetRole)
    && isDirectSubaccountOf(target, operatorId)
}

async function readTarget(userId: string) {
  const account = await prisma.user.findFirst({
    where: { id: userId, status: { not: DELETED_ACCOUNT_STATUS } },
    select: managedAccountSelect,
  })
  if (!account) throw new ApiError('NOT_FOUND', { message: '账号不存在。' })
  return account
}

export const PATCH = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ userId: string }> },
) => {
  const authResult = await requireAdminAuth()
  if (isErrorResponse(authResult)) return authResult

  const operatorId = authResult.session.user.actorId || authResult.session.user.id
  const operatorRole = normalizeAccountRole(authResult.session.user.role)
  const { userId } = await context.params
  const current = await readTarget(userId)
  if (!canManageTarget(operatorId, operatorRole, current)) {
    return forbidden(operatorRole === 'super_admin'
      ? '平台 Admin 只能管理自己创建的管理账号。'
      : '管理账号只能管理自己工作区内的角色子账号。')
  }

  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  const username = readUsername(body.username ?? body.name)
  const password = readPassword(body.password)
  const roleLabel = readRoleLabel(body.roleLabel)
  const role: SubaccountRole | null | undefined = body.role === undefined
    ? undefined
    : isSubaccountRole(body.role) ? body.role : null
  const status: AccountStatus | null | undefined = body.status === undefined
    ? undefined
    : isAccountStatus(body.status) ? body.status : null
  const requestedManagerId = body.managerId === undefined
    ? undefined
    : typeof body.managerId === 'string' ? body.managerId.trim() : ''

  if (role === null) throw new ApiError('INVALID_PARAMS', { message: '角色模板只能是编剧、资产师、分镜师或审核员。' })
  if (status === null) throw new ApiError('INVALID_PARAMS', { message: '无效的账号状态。' })
  if (requestedManagerId === '') throw new ApiError('INVALID_PARAMS', { message: '请选择管理账号。' })

  const currentRole = normalizeAccountRole(current.role)
  const isManagementAccount = currentRole === 'admin'
  const targetRole = role || currentRole
  const requestedPermissions = isSubaccountRole(targetRole)
    ? readSubaccountPermissions(body.permissions, targetRole)
    : undefined

  if (isManagementAccount && role !== undefined) {
    throw new ApiError('INVALID_PARAMS', { message: '管理账号不能改为角色子账号。' })
  }
  if (isManagementAccount && (roleLabel !== undefined || body.permissions !== undefined)) {
    throw new ApiError('INVALID_PARAMS', { message: '管理账号始终拥有全部权限，不能设置子账号角色或功能区。' })
  }
  if (requestedManagerId !== undefined) {
    return forbidden('账号归属不能在此修改。角色子账号始终由所属管理账号管理。')
  }

  if (
    username === undefined
    && password === undefined
    && role === undefined
    && roleLabel === undefined
    && requestedPermissions === undefined
    && status === undefined
  ) {
    throw new ApiError('INVALID_PARAMS', { message: '没有可更新的账号字段。' })
  }

  const passwordHash = password ? await bcrypt.hash(password, 12) : undefined
  try {
    const account = await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: current.id },
        data: {
          ...(username !== undefined ? { name: username } : {}),
          ...(role !== undefined ? { role } : {}),
          ...(roleLabel !== undefined
            ? { roleLabel }
            : role !== undefined ? { roleLabel: defaultSubaccountRoleLabel(role) } : {}),
          ...(requestedPermissions !== undefined
            ? { permissions: requestedPermissions }
            : role !== undefined ? { permissions: effectiveAccountPermissions(role) } : {}),
          ...(status !== undefined ? { status } : {}),
          ...(passwordHash ? { password: passwordHash, sessionVersion: { increment: 1 } } : {}),
        },
      })
      return await tx.user.findUniqueOrThrow({
        where: { id: current.id },
        select: managedAccountSelect,
      })
    })

    logInfo('[AccountAdmin] 账号已更新', {
      operatorUserId: operatorId,
      targetUserId: account.id,
      changedUsername: username !== undefined,
      changedRole: role !== undefined,
      changedRoleLabel: roleLabel !== undefined,
      changedPermissions: requestedPermissions !== undefined,
      changedStatus: status !== undefined,
      resetPassword: password !== undefined,
    })

    return NextResponse.json({ success: true, account: serializeManagedAccount(account) })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new ApiError('CONFLICT', { message: '该账号已存在。' })
    }
    throw error
  }
})

async function countOwnedWorkspaceData(userId: string) {
  const counts = await Promise.all([
    // Subaccounts create inside their manager's workspace, so `userId` alone
    // does not identify projects/works that would cascade through createdById.
    prisma.work.count({
      where: {
        OR: [
          { workspaceOwnerId: userId },
          { createdById: userId },
        ],
      },
    }),
    prisma.project.count({
      where: {
        OR: [
          { userId },
          { createdById: userId },
        ],
      },
    }),
    prisma.globalCharacter.count({ where: { userId } }),
    prisma.globalLocation.count({ where: { userId } }),
    prisma.globalVoice.count({ where: { userId } }),
    prisma.task.count({ where: { userId } }),
  ])
  return counts.reduce((total, count) => total + count, 0)
}

async function permanentlyRemoveSubaccount(account: ManagedAccountRecord) {
  const tombstoneName = `deleted-${account.id}`
  return prisma.$transaction(async (tx) => {
    // Keep the row as an immutable audit principal so deleting a staff account
    // can never cascade-delete team projects, generations or billing history.
    const deleted = await tx.user.updateMany({
      where: {
        id: account.id,
        status: { not: DELETED_ACCOUNT_STATUS },
      },
      data: {
        name: tombstoneName,
        email: null,
        image: null,
        password: null,
        status: DELETED_ACCOUNT_STATUS,
        permissions: [],
        sessionVersion: { increment: 1 },
      },
    })
    if (deleted.count !== 1) {
      throw new ApiError('CONFLICT', { message: '账号状态已变化，请刷新后重试。' })
    }

    await tx.workMember.deleteMany({ where: { userId: account.id } })
    await tx.projectMember.deleteMany({ where: { userId: account.id } })
    await tx.workflowAssignment.updateMany({
      where: {
        assigneeUserId: account.id,
        status: { in: ['in_progress', 'rejected'] },
      },
      data: {
        assigneeUserId: null,
        assignedAt: null,
        submittedAt: null,
        status: 'unassigned',
      },
    })
    await tx.workspaceTeamSeat.updateMany({
      where: { memberUserId: account.id },
      data: { memberUserId: null, status: 'reserved', lastActivityAt: null },
    })
    await tx.session.deleteMany({ where: { userId: account.id } })
    return deleted
  })
}

export const DELETE = apiHandler(async (
  _request: NextRequest,
  context: { params: Promise<{ userId: string }> },
) => {
  const authResult = await requireAdminAuth()
  if (isErrorResponse(authResult)) return authResult

  const operatorId = authResult.session.user.actorId || authResult.session.user.id
  const operatorRole = normalizeAccountRole(authResult.session.user.role)
  const { userId } = await context.params
  const current = await readTarget(userId)
  const currentRole = normalizeAccountRole(current.role)

  if (current.id === operatorId) {
    throw new ApiError('CONFLICT', { message: '不能删除当前登录账号。' })
  }
  if (currentRole === 'super_admin') {
    return forbidden('平台 Admin 不能删除。')
  }
  if (!canManageTarget(operatorId, operatorRole, current)) {
    return forbidden('你只能删除自己工作区内的子账号。')
  }
  if (currentRole === 'admin' && operatorRole !== 'super_admin') {
    return forbidden('只有平台 Admin 可以删除管理账号。')
  }

  if (currentRole === 'admin') {
    const childCount = await prisma.user.count({
      where: {
        status: { not: DELETED_ACCOUNT_STATUS },
        OR: [
          { parentAccountId: current.id },
          { workspaceOwnerId: current.id },
        ],
      },
    })
    if (childCount > 0) {
      throw new ApiError('CONFLICT', { message: '该管理账号仍有角色子账号，请先由该管理账号清理后再删除。' })
    }
  }

  if (isSubaccountRole(currentRole)) {
    await permanentlyRemoveSubaccount(current)
    logInfo('[AccountAdmin] 子账号已删除', {
      operatorUserId: operatorId,
      targetUserId: current.id,
      role: currentRole,
      preservedWorkspaceData: true,
    })
    return NextResponse.json({ success: true, deletedUserId: current.id })
  }

  const ownedDataCount = await countOwnedWorkspaceData(current.id)
  if (ownedDataCount > 0) {
    throw new ApiError('CONFLICT', { message: '该账号仍拥有作品、项目、资产或任务数据，不能直接删除；可先停用账号。' })
  }

  try {
    // Repeat every user-generated-data guard in the delete predicate. This
    // closes the check/delete race without relying on FK errors, and prevents
    // createdById cascades from deleting a newly-created work or project.
    const deleted = await prisma.user.deleteMany({
      where: {
        id: current.id,
        ownedWorks: { none: {} },
        createdWorks: { none: {} },
        projects: { none: {} },
        createdProjects: { none: {} },
        globalCharacters: { none: {} },
        globalLocations: { none: {} },
        globalVoices: { none: {} },
        tasks: { none: {} },
      },
    })
    if (deleted.count !== 1) {
      throw new ApiError('CONFLICT', {
        message: '该账号的数据状态已变化，不能直接删除；可先停用账号。',
      })
    }
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
      throw new ApiError('CONFLICT', { message: '该账号仍有关联数据，不能直接删除；可先停用账号。' })
    }
    throw error
  }

  logInfo('[AccountAdmin] 账号已删除', {
    operatorUserId: operatorId,
    targetUserId: current.id,
    role: currentRole,
  })
  return NextResponse.json({ success: true, deletedUserId: current.id })
})
