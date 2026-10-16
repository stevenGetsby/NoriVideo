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
  isSubaccountRole,
  normalizeAccountRole,
  type AccountRole,
  type SubaccountRole,
} from '@/lib/account/permissions'
import {
  isDirectSubaccountOf,
  managedAccountSelect,
  serializeManagedAccount,
  type ManagedAccountRecord,
} from '@/lib/account/management'
import {
  buildModelUsageByAccount,
  emptyModelUsageSummary,
  mergeModelUsageSummaries,
} from '@/lib/platform-services/model-type-usage'
import {
  getDailyUsageSnapshotMap,
  isValidDailyPointLimitInput,
  normalizeDailyPointLimit,
  serializeDailyUsage,
  type DailyUsagePayload,
} from '@/lib/billing/daily-limit'

const USERNAME_MAX_LENGTH = 64
const PASSWORD_MIN_LENGTH = 8
const PASSWORD_MAX_LENGTH = 128
const ROLE_LABEL_MAX_LENGTH = 64
const DELETED_ACCOUNT_STATUS = 'deleted'

function readUsername(value: unknown): string {
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

function readDailyPointLimit(value: unknown): number | null {
  if (!isValidDailyPointLimitInput(value)) {
    throw new ApiError('INVALID_PARAMS', {
      message: '每日上限必须是 0–100000000 的整数积分或 unlimited（0 禁止生成，unlimited 不限量）。',
    })
  }
  return normalizeDailyPointLimit(value)
}

function readPassword(value: unknown): string {
  const password = typeof value === 'string' ? value : ''
  if (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) {
    throw new ApiError('INVALID_PARAMS', { message: '密码长度需为 8–128 个字符。' })
  }
  return password
}

function readSubaccountRole(value: unknown): SubaccountRole {
  if (value === undefined) return 'writer'
  if (!isSubaccountRole(value)) {
    throw new ApiError('INVALID_PARAMS', { message: '角色模板只能是编剧、资产师、分镜师或审核员。' })
  }
  return value
}

function readRoleLabel(value: unknown, role: SubaccountRole): string {
  if (value === undefined || value === null) return defaultSubaccountRoleLabel(role)
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
  if (value === undefined) return effectiveAccountPermissions(role)
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

function readAccountType(body: Record<string, unknown>): 'manager' | 'subaccount' {
  if (body.accountType === undefined) return body.role === 'admin' ? 'manager' : 'subaccount'
  if (body.accountType !== 'manager' && body.accountType !== 'subaccount') {
    throw new ApiError('INVALID_PARAMS', { message: '账号类型只能是管理账号或角色子账号。' })
  }
  return body.accountType
}

function sortManagers(accounts: ManagedAccountRecord[], actorId: string) {
  return [...accounts].sort((left, right) => {
    if (left.id === actorId) return -1
    if (right.id === actorId) return 1
    return left.createdAt.getTime() - right.createdAt.getTime()
  })
}

function addUsage(
  usage: Map<string, { projects: number; assets: number }>,
  records: Array<{ userId: string }>,
  field: 'projects' | 'assets',
) {
  for (const record of records) {
    const current = usage.get(record.userId) || { projects: 0, assets: 0 }
    current[field] += 1
    usage.set(record.userId, current)
  }
}

export const GET = apiHandler(async () => {
  const authResult = await requireAdminAuth()
  if (isErrorResponse(authResult)) return authResult

  const actorId = authResult.session.user.actorId || authResult.session.user.id
  const operatorRole = normalizeAccountRole(authResult.session.user.role)
  const managers = sortManagers(
    await prisma.user.findMany({
      where: operatorRole === 'super_admin'
        ? { role: 'admin', parentAccountId: actorId, status: { not: DELETED_ACCOUNT_STATUS } }
        : { id: actorId, role: 'admin', status: { not: DELETED_ACCOUNT_STATUS } },
      select: managedAccountSelect,
    }),
    actorId,
  )
  const managerIds = managers.map((manager) => manager.id)

  const accounts = await prisma.user.findMany({
    where: {
      OR: [
        { id: { in: managerIds } },
        { parentAccountId: { in: managerIds } },
        { workspaceOwnerId: { in: managerIds } },
      ],
    },
    select: managedAccountSelect,
    orderBy: { createdAt: 'asc' },
  })
  const accountIds = Array.from(new Set([...managerIds, ...accounts.map((account) => account.id)]))
  const [projects, characters, locations, voices, costRows] = await Promise.all([
    prisma.project.findMany({ where: { userId: { in: managerIds }, deletedAt: null }, select: { userId: true } }),
    prisma.globalCharacter.findMany({ where: { userId: { in: managerIds } }, select: { userId: true } }),
    prisma.globalLocation.findMany({ where: { userId: { in: managerIds } }, select: { userId: true } }),
    prisma.globalVoice.findMany({ where: { userId: { in: managerIds } }, select: { userId: true } }),
    prisma.usageCost.findMany({
      where: { userId: { in: accountIds } },
      select: {
        userId: true,
        apiType: true,
        model: true,
        action: true,
        metadata: true,
        cost: true,
        createdAt: true,
      },
    }),
  ])
  const dailyUsageByAccount = await getDailyUsageSnapshotMap(accountIds)
  const dailyUsageFor = (accountId: string): DailyUsagePayload | null => {
    const snapshot = dailyUsageByAccount.get(accountId)
    return snapshot ? serializeDailyUsage(snapshot) : null
  }

  const usageByAccount = buildModelUsageByAccount(costRows)

  const usage = new Map(managerIds.map((id) => [id, { projects: 0, assets: 0 }]))
  addUsage(usage, projects, 'projects')
  addUsage(usage, characters, 'assets')
  addUsage(usage, locations, 'assets')
  addUsage(usage, voices, 'assets')

  const workspaces = managers.map((manager) => {
    const usageAccounts = accounts.filter((account) => (
      account.id === manager.id
      || (isSubaccountRole(normalizeAccountRole(account.role)) && isDirectSubaccountOf(account, manager.id))
    ))
    const visibleWorkspaceAccounts = usageAccounts.filter((account) => account.status !== DELETED_ACCOUNT_STATUS)
    const subaccounts = visibleWorkspaceAccounts
      .filter((account) => account.id !== manager.id)
      .map((account) => ({
        ...serializeManagedAccount(account),
        usage: usageByAccount.get(account.id) || emptyModelUsageSummary(),
        usageToday: dailyUsageFor(account.id),
      }))
    const modelUsage = mergeModelUsageSummaries(
      usageAccounts.map((account) => usageByAccount.get(account.id) || emptyModelUsageSummary()),
    )
    return {
      manager: {
        ...serializeManagedAccount(manager),
        usage: usageByAccount.get(manager.id) || emptyModelUsageSummary(),
        usageToday: dailyUsageFor(manager.id),
      },
      subaccountCount: subaccounts.length,
      // 平台 Admin 的接口只返回管理账号和汇总；角色子账号明细仅向所属管理账号返回。
      subaccounts: operatorRole === 'admin' ? subaccounts : [],
      usage: {
        ...(usage.get(manager.id) || { projects: 0, assets: 0 }),
        ...modelUsage,
      },
    }
  })

  const totalModelUsage = mergeModelUsageSummaries(workspaces.map((workspace) => workspace.usage))

  return NextResponse.json({
    success: true,
    currentUserId: actorId,
    currentRole: operatorRole,
    canCreateManagers: operatorRole === 'super_admin',
    workspaces,
    accounts: workspaces.flatMap((workspace) => [workspace.manager, ...workspace.subaccounts]),
    totals: {
      managers: workspaces.filter((workspace) => workspace.manager.role === 'admin').length,
      subaccounts: workspaces.reduce((total, workspace) => total + workspace.subaccountCount, 0),
      projects: projects.length,
      assets: characters.length + locations.length + voices.length,
      calls: totalModelUsage.calls,
      cost: totalModelUsage.cost,
      byType: totalModelUsage.byType,
    },
    usageRange: 'all_time',
  }, { headers: { 'Cache-Control': 'private, no-store, max-age=0', Pragma: 'no-cache' } })
})

export const POST = apiHandler(async (request: NextRequest) => {
  const authResult = await requireAdminAuth()
  if (isErrorResponse(authResult)) return authResult

  const actorId = authResult.session.user.actorId || authResult.session.user.id
  const operatorRole = normalizeAccountRole(authResult.session.user.role)
  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  const accountType = readAccountType(body)
  const username = readUsername(body.username ?? body.name)
  const password = readPassword(body.password)

  if (operatorRole === 'super_admin' && accountType !== 'manager') {
    return forbidden('平台 Admin 只负责创建管理账号。角色子账号由所属管理账号创建。')
  }
  if (operatorRole === 'admin' && accountType !== 'subaccount') {
    return forbidden('管理账号只能创建自己工作区的角色子账号。')
  }

  const managerId = actorId
  const role: AccountRole = accountType === 'manager' ? 'admin' : readSubaccountRole(body.role)
  const roleLabel = accountType === 'subaccount'
    ? readRoleLabel(body.roleLabel, role as SubaccountRole)
    : null
  const permissions = accountType === 'subaccount'
    ? readSubaccountPermissions(body.permissions, role as SubaccountRole)
    : effectiveAccountPermissions(role)
  const dailyPointLimit = readDailyPointLimit(body.dailyPointLimit)
  if (accountType === 'subaccount') {
    const requestedManagerId = typeof body.managerId === 'string' ? body.managerId.trim() : ''
    if (requestedManagerId && requestedManagerId !== actorId) {
      return forbidden('管理账号只能在自己的工作区创建子账号。')
    }
  }

  const passwordHash = await bcrypt.hash(password, 12)
  try {
    const account = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          name: username,
          password: passwordHash,
          role,
          roleLabel,
          status: 'active',
          permissions,
          workspaceOwnerId: accountType === 'manager' ? null : managerId,
          parentAccountId: accountType === 'manager' ? actorId : managerId,
          coinCredits: 0,
          dailyPointLimit,
        },
        select: managedAccountSelect,
      })
      await tx.userBalance.create({
        data: {
          userId: created.id,
          balance: 0,
          frozenAmount: 0,
          totalSpent: 0,
        },
      })
      return created
    })

    logInfo('[AccountAdmin] 账号已创建', {
      operatorUserId: actorId,
      targetUserId: account.id,
      accountType,
      managerId: accountType === 'manager' ? account.id : managerId,
      role,
      roleLabel,
      permissions,
      dailyPointLimit,
    })

    return NextResponse.json({ success: true, account: serializeManagedAccount(account) }, { status: 201 })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new ApiError('CONFLICT', { message: '该账号已存在。' })
    }
    throw error
  }
})
