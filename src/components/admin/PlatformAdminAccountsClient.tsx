'use client'

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { signOut, useSession } from 'next-auth/react'
import { useLocale } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import { AccountDialog, CreditLedgerDialog, CreditOperationDialog } from '@/components/frameos/FosAccountManagementParts'
import { apiFetch } from '@/lib/api-fetch'
import { readApiErrorMessage } from '@/lib/api/read-error-message'
import type { AccountCredits } from '@/lib/account/credits'
import { defaultSubaccountRoleLabel, effectiveAccountPermissions } from '@/lib/account/permissions'
import type {
  AccountPermission,
  AccountRole,
  AccountStatus,
  SubaccountRole,
} from '@/lib/account/permissions'
import { createCreditIdempotencyKey } from '@/lib/billing/client'

interface ManagedAccount {
  id: string
  username: string
  role: AccountRole
  roleLabel: string | null
  status: AccountStatus
  permissions: AccountPermission[]
  isPlatformAdmin: boolean
  isManager: boolean
  parentAccountId: string | null
  workspaceOwnerId: string | null
  credits: AccountCredits
  createdAt: string
  updatedAt: string
  lastLoginAt: string | null
  usage: TokenUsage
}

interface TokenUsage {
  calls: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  lastUsedAt: string | null
}

interface ManagedWorkspace {
  manager: ManagedAccount
  subaccounts: ManagedAccount[]
  subaccountCount: number
  usage: TokenUsage & { projects: number; assets: number }
}

interface AccountDraft {
  accountType: 'manager' | 'subaccount'
  managerId: string
  username: string
  password: string
  role: SubaccountRole
  roleLabel: string
  permissions: AccountPermission[]
  status: AccountStatus
  coinCredits: string
  pointCredits: string
}

interface AccountTotals {
  managers: number
  subaccounts: number
  projects: number
  assets: number
  calls: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
}

const EMPTY_TOTALS: AccountTotals = {
  managers: 0,
  subaccounts: 0,
  projects: 0,
  assets: 0,
  calls: 0,
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
}
const NEW_MANAGER_DRAFT: AccountDraft = {
  accountType: 'manager',
  managerId: '',
  username: '',
  password: '',
  role: 'writer',
  roleLabel: defaultSubaccountRoleLabel('writer'),
  permissions: effectiveAccountPermissions('writer'),
  status: 'active',
  coinCredits: '0',
  pointCredits: '0',
}

function formatDate(value: string | null) {
  if (!value) return '从未登录'
  return new Date(value).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Shanghai',
  })
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('zh-CN', {
    notation: value >= 100_000 ? 'compact' : 'standard',
    maximumFractionDigits: 1,
  }).format(value)
}

function Credits({ credits }: { credits: AccountCredits }) {
  return (
    <div className="nori-admin-balance">
      <span>可用积分</span>
      <strong>{credits.points.toLocaleString('zh-CN', { maximumFractionDigits: 4 })}</strong>
      <small>金币 {credits.coins.toLocaleString('zh-CN')}</small>
    </div>
  )
}

export function PlatformAdminAccountsClient() {
  const { data: session } = useSession()
  const locale = useLocale()
  const [workspaces, setWorkspaces] = useState<ManagedWorkspace[]>([])
  const [totals, setTotals] = useState<AccountTotals>(EMPTY_TOTALS)
  const [loading, setLoading] = useState(true)
  const [pageError, setPageError] = useState('')
  const [pageNotice, setPageNotice] = useState('')
  const [query, setQuery] = useState('')
  const [mode, setMode] = useState<'create' | 'edit' | null>(null)
  const [target, setTarget] = useState<ManagedAccount | null>(null)
  const [draft, setDraft] = useState<AccountDraft>(NEW_MANAGER_DRAFT)
  const [dialogError, setDialogError] = useState('')
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState('')
  const [rechargeTarget, setRechargeTarget] = useState<ManagedAccount | null>(null)
  const [ledgerTarget, setLedgerTarget] = useState<ManagedAccount | null>(null)
  const [rechargeRequestKey, setRechargeRequestKey] = useState('')
  const [creditSaving, setCreditSaving] = useState(false)
  const [creditError, setCreditError] = useState('')

  const loadAccounts = useCallback(async (silent = false) => {
    if (session?.user?.role !== 'super_admin') return
    if (!silent) setLoading(true)
    setPageError('')
    try {
      const response = await apiFetch('/api/admin/accounts')
      if (!response.ok) throw new Error(await readApiErrorMessage(response, '获取管理账号失败'))
      const payload = await response.json() as {
        workspaces?: ManagedWorkspace[]
        totals?: AccountTotals
      }
      setWorkspaces(Array.isArray(payload.workspaces) ? payload.workspaces : [])
      setTotals(payload.totals || EMPTY_TOTALS)
    } catch (error) {
      setPageError(error instanceof Error ? error.message : '获取管理账号失败')
    } finally {
      if (!silent) setLoading(false)
    }
  }, [session?.user?.role])

  useEffect(() => { void loadAccounts() }, [loadAccounts])

  const visibleWorkspaces = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    if (!normalized) return workspaces
    return workspaces.filter(({ manager }) => manager.username.toLowerCase().includes(normalized))
  }, [query, workspaces])

  const activeManagers = workspaces.filter(({ manager }) => manager.status === 'active').length
  const totalManagerPoints = workspaces.reduce((sum, workspace) => sum + workspace.manager.credits.points, 0)

  const openCreate = () => {
    setTarget(null)
    setDraft({ ...NEW_MANAGER_DRAFT })
    setDialogError('')
    setMode('create')
  }

  const openEdit = (account: ManagedAccount) => {
    setTarget(account)
    setDraft({
      ...NEW_MANAGER_DRAFT,
      username: account.username,
      status: account.status,
      coinCredits: String(account.credits.coins),
      pointCredits: String(account.credits.points),
    })
    setDialogError('')
    setMode('edit')
  }

  const submit = async () => {
    setSaving(true)
    setDialogError('')
    try {
      const creating = mode === 'create'
      const response = await apiFetch(
        creating ? '/api/admin/accounts' : `/api/admin/accounts/${target?.id || ''}`,
        {
          method: creating ? 'POST' : 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...(creating ? { accountType: 'manager' } : {}),
            username: draft.username.trim(),
            ...(!creating ? { status: draft.status } : {}),
            ...(draft.password ? { password: draft.password } : {}),
          }),
        },
      )
      if (!response.ok) throw new Error(await readApiErrorMessage(response, '保存管理账号失败'))
      setMode(null)
      await loadAccounts()
    } catch (error) {
      setDialogError(error instanceof Error ? error.message : '保存管理账号失败')
    } finally {
      setSaving(false)
    }
  }

  const recharge = async ({ points, note }: { points: number; note: string }) => {
    if (!rechargeTarget || !rechargeRequestKey) return
    setCreditSaving(true)
    setCreditError('')
    setPageNotice('')
    try {
      const response = await apiFetch(`/api/admin/accounts/${rechargeTarget.id}/credits`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': rechargeRequestKey,
        },
        body: JSON.stringify({ operation: 'recharge', points, note, idempotencyKey: rechargeRequestKey }),
        signal: AbortSignal.timeout(15_000),
      })
      if (!response.ok) throw new Error(await readApiErrorMessage(response, '充值积分失败'))
      const payload = await response.json() as {
        result?: { target?: { balancePoints?: number } }
        account?: ManagedAccount
      }
      const nextBalance = payload.result?.target?.balancePoints
      setPageNotice(`已为 ${rechargeTarget.username} 充值 ${points.toLocaleString('zh-CN')} 积分${typeof nextBalance === 'number' ? `，当前余额 ${nextBalance.toLocaleString('zh-CN')} 积分` : ''}。`)
      if (payload.account) {
        setWorkspaces((current) => current.map((workspace) => workspace.manager.id === payload.account?.id
          ? { ...workspace, manager: { ...workspace.manager, ...payload.account } }
          : workspace))
      }
      setRechargeTarget(null)
      setRechargeRequestKey('')
      void loadAccounts(true)
    } catch (error) {
      setCreditError(error instanceof DOMException && error.name === 'TimeoutError'
        ? '充值请求超时，系统会使用同一请求编号安全重试，不会重复入账。请再次点击确认。'
        : error instanceof Error ? error.message : '充值积分失败')
    } finally {
      setCreditSaving(false)
    }
  }

  const deleteManager = async (workspace: ManagedWorkspace) => {
    const { manager } = workspace
    if (!window.confirm(`确定删除管理账号“${manager.username}”吗？只有空工作区账号可以删除。`)) return
    setDeletingId(manager.id)
    setPageError('')
    try {
      const response = await apiFetch(`/api/admin/accounts/${manager.id}`, { method: 'DELETE' })
      if (!response.ok) throw new Error(await readApiErrorMessage(response, '删除管理账号失败'))
      await loadAccounts()
    } catch (error) {
      setPageError(error instanceof Error ? error.message : '删除管理账号失败')
    } finally {
      setDeletingId('')
    }
  }

  const logout = () => {
    void signOut({ callbackUrl: `/${locale}/admin/signin` })
  }

  return (
    <main
      className="nori-admin min-h-screen text-white"
      style={{
        '--fos-bg-1': '#0c1220',
        '--fos-bg-2': '#121a2a',
        '--fos-bg-3': '#182237',
        '--fos-bg-4': '#202d46',
        '--fos-text-1': '#f8faff',
        '--fos-text-2': '#dbe3f3',
        '--fos-text-3': '#aab7cd',
        '--fos-text-4': '#7f8da6',
        '--fos-primary': '#5c82f6',
        '--fos-primary-hover': '#6a8df8',
        '--fos-primary-soft': 'rgba(92,130,246,.13)',
        '--fos-primary-border': 'rgba(111,145,248,.34)',
        '--fos-border-soft': 'rgba(180,198,230,.08)',
        '--fos-border-mid': 'rgba(180,198,230,.13)',
        '--fos-border-strong': 'rgba(180,198,230,.2)',
        '--fos-fill-soft': 'rgba(255,255,255,.04)',
        '--fos-fill-mid': 'rgba(255,255,255,.08)',
        fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", "Segoe UI", sans-serif',
      } as CSSProperties}
    >
      <header className="nori-admin-header sticky top-0 z-30 flex h-[68px] items-center px-5 lg:px-8">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-blue-400/25 bg-[linear-gradient(145deg,rgba(82,215,255,.16),rgba(77,124,255,.18),rgba(124,92,255,.2))] text-[#8fb0ff]"><AppIcon name="lock" className="h-[18px] w-[18px]" /></span>
          <div><strong className="block text-[16px] font-bold tracking-[-.01em]">NoriVideo <span className="font-medium text-[#8fb0ff]">Admin</span></strong><span className="mt-0.5 block text-[11px] text-white/45">平台管理中心</span></div>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <div className="hidden text-right sm:block"><span className="block text-[13px] font-semibold text-white/90">{session?.user?.name || 'Platform Admin'}</span><span className="block text-[11px] text-white/45">平台最高管理员</span></div>
          <button type="button" onClick={logout} className="flex h-9 items-center gap-2 rounded-lg border border-white/[.12] bg-white/[.04] px-3 text-[13px] text-white/70 transition hover:bg-white/[.08] hover:text-white"><AppIcon name="logout" className="h-4 w-4" />退出</button>
        </div>
      </header>

      <div className="nori-admin-layout mx-auto flex w-full max-w-[1560px]">
        <aside className="nori-admin-sidebar sticky top-[68px] hidden h-[calc(100vh-68px)] w-[236px] shrink-0 px-4 py-6 lg:block">
          <p className="px-3 text-[11px] font-semibold tracking-[.12em] text-white/40">平台管理</p>
          <nav className="mt-3 space-y-1.5">
            <a href={`/${locale}/admin/accounts`} className="flex items-center gap-3 rounded-lg border border-blue-400/25 bg-blue-500/[.12] px-3 py-3 text-[14px] font-semibold text-[#b8c9ff]"><AppIcon name="usersRound" className="h-[18px] w-[18px]" />账号与用量</a>
            <a href={`/${locale}/admin/reviewers`} className="flex items-center gap-3 rounded-lg px-3 py-3 text-[14px] text-white/60 transition hover:bg-white/[.05] hover:text-white"><AppIcon name="clipboardCheck" className="h-[18px] w-[18px]" />审核分配</a>
            <a href={`/${locale}/admin/services`} className="flex items-center gap-3 rounded-lg px-3 py-3 text-[14px] text-white/60 transition hover:bg-white/[.05] hover:text-white"><AppIcon name="settingsHex" className="h-[18px] w-[18px]" />服务配置</a>
          </nav>
          <div className="mt-8 rounded-xl border border-white/[.09] bg-[#17171c] p-4"><AppIcon name="infoCircle" className="h-4 w-4 text-[#8fb0ff]" /><p className="mt-3 text-[12px] leading-6 text-white/55">此处创建管理账号并查看整个工作区用量。角色子账号及其功能区权限由对应管理账号在 NoriVideo 内维护。</p></div>
        </aside>

        <section className="nori-admin-content min-w-0 flex-1 px-5 py-8 lg:px-9 lg:py-9">
          <div className="mb-5 flex gap-2 lg:hidden"><a href={`/${locale}/admin/accounts`} className="fos-btn fos-btn-primary fos-btn-sm">账号与用量</a><a href={`/${locale}/admin/reviewers`} className="fos-btn fos-btn-ghost fos-btn-sm">审核分配</a><a href={`/${locale}/admin/services`} className="fos-btn fos-btn-ghost fos-btn-sm">服务配置</a></div>
          <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
            <div><span className="text-[12px] font-semibold tracking-[.1em] text-[#8fb0ff]">ACCOUNT & USAGE</span><h1 className="mt-2 text-[28px] font-bold tracking-[-.025em]">管理账号</h1><p className="mt-2 text-[14px] text-white/55">创建工作区负责人，管理密码、状态与积分，并核对管理账号及其全部子账号的 Token 用量。</p></div>
            <button type="button" onClick={openCreate} className="flex h-10 items-center gap-2 rounded-lg bg-[#4d7cff] px-4 text-[14px] font-semibold text-white shadow-[0_8px_24px_rgba(77,124,255,.22)] transition hover:bg-[#3b6df0]"><AppIcon name="plus" className="h-4 w-4" />添加管理账号</button>
          </div>

          <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              ['管理账号', totals.managers, 'usersRound'],
              ['启用中', activeManagers, 'badgeCheck'],
              ['角色子账号', totals.subaccounts, 'userRoundCog'],
              ['项目 / 资产', `${totals.projects} / ${totals.assets}`, 'package'],
              ['输入 Token', formatNumber(totals.inputTokens), 'download'],
              ['输出 Token', formatNumber(totals.outputTokens), 'cloudUpload'],
              ['总 Token', formatNumber(totals.totalTokens), 'chart'],
              ['管理账号积分', formatNumber(totalManagerPoints), 'coins'],
            ].map(([label, value, icon]) => (
              <div key={String(label)} className="nori-admin-metric rounded-xl border p-4"><div className="flex items-center justify-between text-[12px] text-white/55"><span>{label}</span><AppIcon name={icon as 'usersRound'} className="h-4 w-4 text-[#8eabff]" /></div><strong className="mt-3 block text-[22px] font-semibold tracking-[-.02em] text-white">{value}</strong></div>
            ))}
          </div>

          {pageError ? <div className="mb-5 flex items-center justify-between gap-4 rounded-lg border border-red-400/25 bg-red-400/[.09] px-4 py-3 text-[13px] text-red-200"><span>{pageError}</span><button className="underline" type="button" onClick={() => void loadAccounts()}>重试</button></div> : null}
          {pageNotice ? <div className="mb-5 flex items-center gap-2 rounded-xl border border-emerald-300/20 bg-emerald-400/[.08] px-4 py-3 text-[13px] text-emerald-100"><AppIcon name="badgeCheck" className="h-4 w-4 text-emerald-300" />{pageNotice}</div> : null}

          <section className="nori-admin-panel overflow-hidden rounded-2xl border">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/[.08] px-5 py-5 lg:px-6">
              <div><h2 className="text-[17px] font-semibold tracking-[-.01em]">管理工作区</h2><p className="mt-1.5 text-[12px] leading-5 text-white/55">每张卡片集中显示账号、积分、团队规模和 Token 用量，充值后余额实时累计。</p></div>
              <label className="relative block w-full sm:w-80"><AppIcon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" /><input value={query} onChange={(event) => setQuery(event.target.value)} className="fos-input h-10 w-full pl-9 text-[13px]" placeholder="搜索管理账号" /></label>
            </div>
            <div className="space-y-3 p-4 lg:p-5">
              {loading ? <div className="py-16 text-center text-[13px] text-white/50">正在加载管理账号与用量…</div> : visibleWorkspaces.length === 0 ? <div className="py-16 text-center text-[13px] text-white/45">{query ? '没有匹配的管理账号' : '尚未创建管理账号'}</div> : visibleWorkspaces.map((workspace) => {
                const { manager, subaccountCount, usage } = workspace
                return (
                  <article key={manager.id} className="nori-admin-workspace-card overflow-hidden rounded-xl border">
                    <header className="flex flex-wrap items-center justify-between gap-4 border-b border-white/[.07] px-4 py-4 lg:px-5">
                      <div className="flex min-w-0 items-center gap-3.5">
                        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-blue-300/20 bg-blue-400/[.1] text-[#a9bdff]"><AppIcon name="user" className="h-[19px] w-[19px]" /></span>
                        <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><strong className="truncate text-[15px] font-semibold text-white">{manager.username}</strong><span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] ${manager.status === 'active' ? 'border-emerald-300/20 bg-emerald-400/[.08] text-emerald-200' : 'border-white/10 bg-white/[.04] text-white/45'}`}><i className={`h-1.5 w-1.5 rounded-full ${manager.status === 'active' ? 'bg-emerald-400' : 'bg-white/30'}`} />{manager.status === 'active' ? '启用' : '停用'}</span></div><span className="mt-1 block text-[11px] text-white/45">创建于 {formatDate(manager.createdAt)}</span></div>
                      </div>
                      <div className="flex items-center gap-2"><button type="button" className="fos-btn fos-btn-ghost fos-btn-sm" onClick={() => setLedgerTarget(manager)}>积分流水</button><button type="button" className="fos-btn fos-btn-primary fos-btn-sm" onClick={() => { setCreditError(''); setRechargeRequestKey(createCreditIdempotencyKey('recharge', manager.id)); setRechargeTarget(manager) }}><AppIcon name="coins" className="h-3.5 w-3.5" />充值积分</button><button type="button" className="fos-btn fos-btn-ghost fos-btn-sm" onClick={() => openEdit(manager)}>编辑账号</button><button type="button" className="fos-icon-btn text-red-300" disabled={deletingId === manager.id} title="删除管理账号" onClick={() => void deleteManager(workspace)}><AppIcon name="trash" className="h-4 w-4" /></button></div>
                    </header>
                    <div className="grid gap-px bg-white/[.06] sm:grid-cols-2 xl:grid-cols-[1.05fr_.9fr_1.35fr_1fr]">
                      <div className="bg-[var(--fos-bg-2)] px-4 py-4 lg:px-5"><Credits credits={manager.credits} /></div>
                      <div className="bg-[var(--fos-bg-2)] px-4 py-4 lg:px-5"><span className="block text-[11px] text-white/45">团队与内容</span><strong className="mt-1.5 block text-[15px] font-semibold text-white">{subaccountCount} 个子账号</strong><small className="mt-1 block text-[11px] text-white/50">{usage.projects} 个项目 · {usage.assets} 项资产</small></div>
                      <div className="bg-[var(--fos-bg-2)] px-4 py-4 lg:px-5"><span className="block text-[11px] text-white/45">Token 用量（工作区合计）</span><strong className="mt-1.5 block text-[15px] font-semibold text-white">{formatNumber(usage.totalTokens)} total</strong><small className="mt-1 block text-[11px] text-white/50">输入 {formatNumber(usage.inputTokens)} · 输出 {formatNumber(usage.outputTokens)} · {formatNumber(usage.calls)} 次</small></div>
                      <div className="bg-[var(--fos-bg-2)] px-4 py-4 lg:px-5"><span className="block text-[11px] text-white/45">最后登录</span><strong className="mt-1.5 block text-[13px] font-medium text-white/80">{formatDate(manager.lastLoginAt)}</strong><small className="mt-1 block text-[11px] text-white/40">账号数据实时同步</small></div>
                    </div>
                  </article>
                )
              })}
            </div>
          </section>
        </section>
      </div>

      {mode ? (
        <AccountDialog
          mode={mode}
          draft={draft}
          target={target}
          operatorRole="super_admin"
          workspaces={workspaces}
          allowAccountTypeChoice={false}
          saving={saving}
          error={dialogError}
          onDraft={setDraft}
          onClose={() => setMode(null)}
          onSubmit={() => void submit()}
        />
      ) : null}
      {rechargeTarget ? (
        <CreditOperationDialog
          operation="recharge"
          target={rechargeTarget}
          sourceBalancePoints={rechargeTarget.credits.points}
          saving={creditSaving}
          error={creditError}
          onClose={() => { setRechargeTarget(null); setRechargeRequestKey('') }}
          onSubmit={(input) => void recharge(input)}
        />
      ) : null}
      {ledgerTarget ? <CreditLedgerDialog target={ledgerTarget} onClose={() => setLedgerTarget(null)} /> : null}
    </main>
  )
}
