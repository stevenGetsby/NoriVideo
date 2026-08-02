import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

function readSource(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8')
}

describe('three-level account management wiring', () => {
  it('keeps the platform Admin console separate from the NoriVideo shell', () => {
    const platformPage = readSource('src/app/[locale]/admin/accounts/page.tsx')
    const platform = readSource('src/components/admin/PlatformAdminAccountsClient.tsx')
    const subaccountsPage = readSource('src/app/[locale]/account-management/page.tsx')
    const subaccounts = readSource('src/components/frameos/FosAccountManagementClient.tsx')

    expect(platformPage).toContain('PlatformAdminAccountsClient')
    expect(platformPage).not.toContain('FosAccountManagementClient')
    expect(platform).not.toContain('<FosShell')
    expect(platform).toContain('添加管理账号')
    expect(platform).toContain('allowAccountTypeChoice={false}')
    expect(subaccountsPage).toContain('FosAccountManagementClient')
    expect(subaccounts).toContain('<FosShell activeKey="accounts">')
    expect(subaccounts).toContain('添加子账号')
    expect(subaccounts).not.toContain('添加管理账号')
  })

  it('uses distinct login routes and redirects the platform Admin away from NoriVideo', () => {
    const normalSignIn = readSource('src/app/[locale]/auth/signin/page.tsx')
    const platformSignIn = readSource('src/components/admin/PlatformAdminSignInClient.tsx')
    const platformSignInPage = readSource('src/app/[locale]/admin/signin/page.tsx')
    const rootMiddleware = readSource('middleware.ts')
    const shell = readSource('src/components/frameos/FosShell.tsx')
    const legacyTeamRoute = readSource('src/app/[locale]/team/page.tsx')

    expect(normalSignIn).toContain("session?.user?.role === 'super_admin'")
    expect(normalSignIn).toContain('`/${locale}/admin/accounts`')
    expect(platformSignIn).toContain("session?.user?.role !== 'super_admin'")
    expect(platformSignIn).toContain('此入口仅供平台 Admin 使用')
    expect(normalSignIn).toContain('SURFACE_LOGIN_ERRORS.adminRequired')
    expect(platformSignIn).toContain('SURFACE_LOGIN_ERRORS.workspaceRequired')
    expect(platformSignIn).toContain('href={workspaceSignInUrl}')
    expect(platformSignInPage).toContain("process.env.PUBLIC_APP_URL || 'http://localhost:3000'")
    expect(rootMiddleware).toContain('isPlatformAdminPage(pathname)')
    expect(rootMiddleware).toContain("target.port = process.env.ADMIN_PUBLIC_PORT || '8080'")
    expect(shell).toContain("session?.user?.role === 'admin'")
    expect(shell).toContain("pathname: '/account-management'")
    expect(shell).toContain("router.replace({ pathname: '/admin/accounts' })")
    expect(legacyTeamRoute).toContain('`/${locale}/account-management`')
  })

  it('allows each level to create only its direct child account type', () => {
    const createRoute = readSource('src/app/api/admin/accounts/route.ts')

    expect(createRoute).toContain("operatorRole === 'super_admin' && accountType !== 'manager'")
    expect(createRoute).toContain('平台 Admin 只负责创建管理账号')
    expect(createRoute).toContain("operatorRole === 'admin' && accountType !== 'subaccount'")
    expect(createRoute).toContain('管理账号只能创建自己工作区的角色子账号')
    expect(createRoute).toContain("parentAccountId: accountType === 'manager' ? actorId : managerId")
    expect(createRoute).toContain("workspaceOwnerId: accountType === 'manager' ? null : managerId")
  })

  it('treats custom role names as display metadata and functional areas as the authorization source', () => {
    const createRoute = readSource('src/app/api/admin/accounts/route.ts')
    const updateRoute = readSource('src/app/api/admin/accounts/[userId]/route.ts')
    const dialog = readSource('src/components/frameos/FosAccountManagementParts.tsx')
    const schema = readSource('prisma/schema.prisma')

    expect(schema).toContain('roleLabel')
    expect(createRoute).toContain('readRoleLabel(body.roleLabel')
    expect(createRoute).toContain('readSubaccountPermissions(body.permissions')
    expect(updateRoute).toContain('changedRoleLabel')
    expect(updateRoute).toContain('changedPermissions')
    expect(dialog).toContain('角色名称只用于团队展示')
    expect(dialog).toContain('快捷权限模板（可选）')
    expect(dialog).toContain('ACCOUNT_FUNCTION_PERMISSION_DEFINITIONS.map')
    expect(dialog).toContain('未勾选功能区时仍可查看，但不能编辑或发起生成')
  })

  it('uses 角色 consistently in user-facing account and collaboration copy', () => {
    const sources = [
      'src/components/frameos/FosAuthShell.tsx',
      'src/components/frameos/CreateProjectDialog.tsx',
      'src/components/admin/PlatformAdminServicesClient.tsx',
      'src/components/admin/PlatformAdminSignInClient.tsx',
      'src/app/[locale]/auth/signin/page.tsx',
      'src/app/[locale]/auth/signup/page.tsx',
      'src/app/api/auth/register/route.ts',
    ].map(readSource)

    for (const source of sources) expect(source).not.toContain('岗位')
    expect(sources.join('\n')).toContain('角色')
    expect(sources.join('\n')).toContain('功能区权限')
  })

  it('returns child details only to their owning management account', () => {
    const createRoute = readSource('src/app/api/admin/accounts/route.ts')

    expect(createRoute).toContain("subaccounts: operatorRole === 'admin' ? subaccounts : []")
    expect(createRoute).toContain('subaccountCount: subaccounts.length')
    expect(createRoute).toContain("where: operatorRole === 'super_admin'")
    expect(createRoute).toContain("role: 'admin', parentAccountId: actorId, status: { not: DELETED_ACCOUNT_STATUS }")
  })

  it('allows update and delete only across one direct hierarchy edge', () => {
    const updateRoute = readSource('src/app/api/admin/accounts/[userId]/route.ts')

    expect(updateRoute).toContain("targetRole === 'admin' && target.parentAccountId === operatorId")
    expect(updateRoute).toContain('isDirectSubaccountOf(target, operatorId)')
    expect(updateRoute).toContain('账号归属不能在此修改')
    expect(updateRoute).toContain('平台 Admin 只能管理自己创建的管理账号')
    expect(updateRoute).toContain('管理账号只能管理自己工作区内的角色子账号')
    expect(updateRoute).toContain('请先由该管理账号清理后再删除')
    expect(updateRoute).not.toContain('只有平台 Admin 可以转移角色子账号')
  })

  it('binds subaccounts to the management account data scope', () => {
    const auth = readSource('src/lib/api-auth.ts')
    expect(auth).toContain('isManagementRole(role) ? user.id : (user.workspaceOwnerId || user.id)')
    expect(auth).toContain('session.user.id = session.user.workspaceOwnerId')
  })

  it('uses the billing wallet as the single point-balance source at both levels', () => {
    const schema = readSource('prisma/schema.prisma')
    const shell = readSource('src/components/frameos/FosShell.tsx')
    const platform = readSource('src/components/admin/PlatformAdminAccountsClient.tsx')
    const subaccounts = readSource('src/components/frameos/FosAccountManagementClient.tsx')
    const createRoute = readSource('src/app/api/admin/accounts/route.ts')

    expect(schema).toMatch(/coinCredits\s+Int\s+@default\(0\)/)
    expect(schema).toMatch(/pointCredits\s+Int\s+@default\(0\)/)
    expect(shell).toContain('normalizeAccountPointCredit(session?.user?.pointCredits)')
    expect(shell).toContain("apiFetch('/api/user/balance'")
    expect(platform).toContain('credits: AccountCredits')
    expect(subaccounts).toContain('credits: AccountCredits')
    expect(createRoute).toContain('coinCredits: 0')
    expect(createRoute).toContain('tx.userBalance.create')
    expect(createRoute).not.toContain('pointCredits: 0')
  })

  it('lets platform Admin recharge a manager and previews the accumulated balance', () => {
    const platform = readSource('src/components/admin/PlatformAdminAccountsClient.tsx')
    const dialog = readSource('src/components/frameos/FosAccountManagementParts.tsx')
    const route = readSource('src/app/api/admin/accounts/[userId]/credits/route.ts')
    const ledger = readSource('src/lib/billing/credit-ledger.ts')

    expect(platform).toContain("operation=\"recharge\"")
    expect(platform).toContain("operation: 'recharge', points, note, idempotencyKey: rechargeRequestKey")
    expect(dialog).toContain('充值后余额')
    expect(dialog).toContain('currentTargetPoints + parsedPoints')
    expect(route).toContain('rechargeAccountPoints(target.id, points')
    expect(ledger).toContain('update: { balance: { increment: amountCny } }')
  })

  it('records actor-level token usage and aggregates each manager workspace for billing', () => {
    const createRoute = readSource('src/app/api/admin/accounts/route.ts')
    const usageRuntime = readSource('src/lib/platform-services/usage.ts')
    const platform = readSource('src/components/admin/PlatformAdminAccountsClient.tsx')
    const subaccounts = readSource('src/components/frameos/FosAccountManagementClient.tsx')

    expect(usageRuntime).toContain('getLogContext().userId')
    expect(createRoute).toContain('prisma.serviceUsageRecord.groupBy')
    expect(createRoute).toContain('_sum: { inputTokens: true, outputTokens: true }')
    expect(createRoute).toContain('usageAccounts.map')
    expect(platform).toContain('Token 用量（工作区合计）')
    expect(platform).toContain('usage.inputTokens')
    expect(platform).toContain('usage.outputTokens')
    expect(subaccounts).toContain('account.usage.totalTokens')
  })

  it('lets a manager permanently remove a child without cascading team data', () => {
    const updateRoute = readSource('src/app/api/admin/accounts/[userId]/route.ts')
    const subaccounts = readSource('src/components/frameos/FosAccountManagementClient.tsx')

    expect(updateRoute).toContain('permanentlyRemoveSubaccount(current)')
    expect(updateRoute).toContain("status: DELETED_ACCOUNT_STATUS")
    expect(updateRoute).toContain('preservedWorkspaceData: true')
    expect(updateRoute).toContain('tx.workMember.deleteMany')
    expect(updateRoute).toContain('tx.projectMember.deleteMany')
    expect(subaccounts).toContain('title="删除子账号"')
    expect(subaccounts).toContain("deletingId === account.id ? '删除中…' : '删除'")
    expect(subaccounts).toContain('sticky right-0')
  })
})
