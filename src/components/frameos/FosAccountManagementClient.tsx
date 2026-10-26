'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useSession } from 'next-auth/react'
import { AppIcon } from '@/components/ui/icons'
import { apiFetch } from '@/lib/api-fetch'
import { readApiErrorMessage } from '@/lib/api/read-error-message'
import type { AccountCredits } from '@/lib/account/credits'
import { createCreditIdempotencyKey, notifyBalanceChanged, subscribeBalanceChanges } from '@/lib/billing/client'
import { createLatestRequestTracker } from '@/lib/api/latest-request'
import {
  ACCOUNT_FUNCTION_PERMISSION_DEFINITIONS,
  ACCOUNT_ROLE_DEFINITIONS,
  defaultSubaccountRoleLabel,
  effectiveAccountPermissions,
  type AccountPermission,
  type AccountRole,
  type AccountStatus,
  type SubaccountRole,
} from '@/lib/account/permissions'
import {
  emptyModelUsageSummary,
  formatUsageMoney,
  type ModelUsageSummary,
} from '@/lib/platform-services/model-type-usage'
import { FosShell } from './FosShell'
import {
  AccountDialog,
  CreditLedgerDialog,
  CreditOperationDialog,
  DailyUsageCell,
  PermissionMatrix,
} from './FosAccountManagementParts'
import type { DailyUsagePayload } from '@/lib/billing/daily-limit'
import { updateDailyUsageLimit } from '@/lib/billing/daily-limit-display'
import { dailyLimitSaveMessage } from '@/lib/billing/daily-limit-policy'

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
  dailyLimitPoints: number | null
  usageToday?: DailyUsagePayload | null
  createdAt: string
  updatedAt: string
  lastLoginAt: string | null
  usage: ModelUsageSummary
}

interface ManagedWorkspace {
  manager: ManagedAccount
  subaccounts: ManagedAccount[]
  usage: ModelUsageSummary & { projects: number; assets: number }
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
  dailyPointLimit: string
}

const NEW_ACCOUNT_DRAFT: AccountDraft = {
  accountType: 'subaccount',
  managerId: '',
  username: '',
  password: '',
  role: 'writer',
  roleLabel: defaultSubaccountRoleLabel('writer'),
  permissions: effectiveAccountPermissions('writer'),
  status: 'active',
  coinCredits: '0',
  pointCredits: '0',
  dailyPointLimit: 'unlimited',
}

const ROLE_TONES: Record<AccountRole, string> = {
  super_admin: 'border-fuchsia-400/30 bg-fuchsia-400/[.09] text-fuchsia-200',
  admin: 'border-violet-400/25 bg-violet-400/[.08] text-violet-200',
  writer: 'border-white/15 bg-white/[.08] text-neutral-200',
  asset: 'border-amber-400/25 bg-amber-400/[.08] text-amber-200',
  storyboard: 'border-emerald-400/25 bg-emerald-400/[.08] text-emerald-200',
  reviewer: 'border-cyan-400/25 bg-cyan-400/[.08] text-cyan-200',
}

function roleDefinition(role: AccountRole) {
  return ACCOUNT_ROLE_DEFINITIONS.find((item) => item.role === role) || ACCOUNT_ROLE_DEFINITIONS[0]
}

function formatDate(value: string | null) {
  if (!value) return '从未登录'
  return new Date(value).toLocaleString('zh-CN', {
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
    <span className="flex items-center gap-2 text-[10px] text-white/55">
      <span className="inline-flex items-center gap-1"><i className="flex h-4 w-4 items-center justify-center rounded-full bg-amber-400 text-[9px] not-italic text-amber-950">¥</i>{credits.coins}</span>
      <span className="inline-flex items-center gap-1"><i className="flex h-4 w-4 items-center justify-center rounded-full bg-[linear-gradient(270deg,#8109ff_15%,#3265ff)] text-[8px] not-italic text-white">◆</i>{credits.points}</span>
    </span>
  )
}

export function FosAccountManagementClient() {
  const { data: session } = useSession()
  const [workspace, setWorkspace] = useState<ManagedWorkspace | null>(null)
  const [loading, setLoading] = useState(true)
  const [pageError, setPageError] = useState('')
  const [pageNotice, setPageNotice] = useState('')
  const [mode, setMode] = useState<'create' | 'edit' | null>(null)
  const [target, setTarget] = useState<ManagedAccount | null>(null)
  const [draft, setDraft] = useState<AccountDraft>(NEW_ACCOUNT_DRAFT)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState('')
  const [dialogError, setDialogError] = useState('')
  const [creditOperation, setCreditOperation] = useState<'reclaim' | null>(null)
  const [creditTarget, setCreditTarget] = useState<ManagedAccount | null>(null)
  const [ledgerTarget, setLedgerTarget] = useState<ManagedAccount | null>(null)
  const [creditRequestKey, setCreditRequestKey] = useState('')
  const [creditSaving, setCreditSaving] = useState(false)
  const [creditError, setCreditError] = useState('')
  const accountsRequests = useRef(createLatestRequestTracker())

  const loadAccounts = useCallback(async (silent = false) => {
    if (session?.user?.role !== 'admin') return
    const request = accountsRequests.current.begin()
    if (!silent) setLoading(true)
    setPageError('')
    try {
      const response = await apiFetch(`/api/admin/accounts?refresh=${Date.now()}`, { cache: 'no-store' })
      if (!response.ok) throw new Error(await readApiErrorMessage(response, '获取子账号失败'))
      const payload = await response.json() as { workspaces?: ManagedWorkspace[] }
      if (!accountsRequests.current.isCurrent(request)) return
      setWorkspace(Array.isArray(payload.workspaces) ? payload.workspaces[0] || null : null)
    } catch (error) {
      if (!accountsRequests.current.isCurrent(request)) return
      setPageError(error instanceof Error ? error.message : '获取子账号失败')
    } finally {
      if (accountsRequests.current.isCurrent(request)) setLoading(false)
    }
  }, [session?.user?.role])

  useEffect(() => { void loadAccounts() }, [loadAccounts])
  useEffect(() => {
    const requests = accountsRequests.current
    const refresh = () => void loadAccounts(true)
    const unsubscribe = subscribeBalanceChanges(refresh)
    window.addEventListener('focus', refresh)
    return () => { unsubscribe(); window.removeEventListener('focus', refresh); requests.invalidate() }
  }, [loadAccounts])

  const openCreate = () => {
    setTarget(null)
    setDraft({
      ...NEW_ACCOUNT_DRAFT,
      managerId: workspace?.manager.id || '',
    })
    setDialogError('')
    setMode('create')
  }

  const openEdit = (account: ManagedAccount) => {
    setTarget(account)
    setDraft({
      accountType: 'subaccount',
      managerId: workspace?.manager.id || '',
      username: account.username,
      password: '',
      role: account.role as SubaccountRole,
      roleLabel: account.roleLabel || defaultSubaccountRoleLabel(account.role),
      permissions: account.permissions,
      status: account.status,
      coinCredits: String(account.credits.coins),
      pointCredits: String(account.credits.points),
      dailyPointLimit: account.dailyLimitPoints === null ? 'unlimited' : String(account.dailyLimitPoints),
    })
    setDialogError('')
    setMode('edit')
  }

  const submit = async () => {
    setSaving(true)
    setDialogError('')
    try {
      const isCreate = mode === 'create'
      const response = await apiFetch(
        isCreate ? '/api/admin/accounts' : `/api/admin/accounts/${target?.id || ''}`,
        {
          method: isCreate ? 'POST' : 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...(isCreate ? { accountType: 'subaccount' } : {}),
            username: draft.username.trim(),
            role: draft.role,
            roleLabel: draft.roleLabel.trim(),
            permissions: draft.permissions,
            dailyPointLimit: draft.dailyPointLimit === 'unlimited' ? 'unlimited' : Number(draft.dailyPointLimit),
            ...(!isCreate ? { status: draft.status } : {}),
            ...(draft.password ? { password: draft.password } : {}),
          }),
        },
      )
      if (!response.ok) throw new Error(await readApiErrorMessage(response, '保存子账号失败'))
      const payload = await response.json() as { account?: ManagedAccount }
      accountsRequests.current.invalidate()
      const updated = payload.account
      if (updated && !isCreate) {
        setWorkspace((current) => current ? {
          ...current,
          subaccounts: current.subaccounts.map((item) => item.id === updated.id
            ? { ...item, ...updated, usageToday: updateDailyUsageLimit(item.usageToday, updated.dailyLimitPoints) }
            : item),
        } : current)
      }
      setPageNotice(dailyLimitSaveMessage(updated?.dailyLimitPoints ?? null))
      setMode(null)
      notifyBalanceChanged()
      await loadAccounts(true)
    } catch (error) {
      setDialogError(error instanceof Error ? error.message : '保存子账号失败')
    } finally {
      setSaving(false)
    }
  }

  const openCreditOperation = (operation: 'reclaim', account: ManagedAccount) => {
    setCreditOperation(operation)
    setCreditTarget(account)
    setCreditRequestKey(createCreditIdempotencyKey(operation, account.id))
    setCreditError('')
  }

  const mutateCredits = async ({ points, note }: { points: number; note: string }) => {
    if (!creditOperation || !creditTarget || !creditRequestKey) return
    setCreditSaving(true)
    setCreditError('')
    try {
      const response = await apiFetch(`/api/admin/accounts/${creditTarget.id}/credits`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': creditRequestKey,
        },
        body: JSON.stringify({ operation: creditOperation, points, note, idempotencyKey: creditRequestKey }),
        signal: AbortSignal.timeout(15_000),
      })
      if (!response.ok) {
        throw new Error(await readApiErrorMessage(response, '收回历史积分失败'))
      }
      setCreditOperation(null)
      setCreditTarget(null)
      setCreditRequestKey('')
      notifyBalanceChanged()
      void loadAccounts(true)
    } catch (error) {
      setCreditError(error instanceof DOMException && error.name === 'TimeoutError'
        ? '积分请求超时，系统会使用同一请求编号安全重试，不会重复入账。请再次点击确认。'
        : error instanceof Error ? error.message : '积分操作失败')
    } finally {
      setCreditSaving(false)
    }
  }

  const deleteAccount = async (account: ManagedAccount) => {
    if (!window.confirm(`确定删除子账号“${account.username}”吗？此操作不可撤销。`)) return
    setDeletingId(account.id)
    setPageError('')
    try {
      const response = await apiFetch(`/api/admin/accounts/${account.id}`, { method: 'DELETE' })
      if (!response.ok) throw new Error(await readApiErrorMessage(response, '删除子账号失败'))
      await loadAccounts()
    } catch (error) {
      setPageError(error instanceof Error ? error.message : '删除子账号失败')
    } finally {
      setDeletingId('')
    }
  }

  const subaccounts = workspace?.subaccounts || []

  return (
    <FosShell activeKey="accounts">
      <div className="fos-scroll">
        <section className="mx-auto w-full max-w-[1180px] px-8 py-7">
          <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className="text-[24px] font-bold text-white">子账号管理</h1>
              <p className="mt-1 text-[12px] text-white/40">为子账号自定义角色与功能区，并统一管理状态、密码、积分和用量。</p>
            </div>
            <button type="button" className="fos-btn fos-btn-primary" onClick={openCreate}>
              <AppIcon name="plus" className="h-4 w-4" />添加子账号
            </button>
          </div>

          <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              ['共享可用积分', formatNumber(workspace?.manager.credits.points || 0)],
              ['角色子账号', subaccounts.length],
              ['工作区作品', workspace?.usage.projects || 0],
              ['工作区资产', workspace?.usage.assets || 0],
              ...((workspace?.usage.byType || emptyModelUsageSummary().byType).map((row) => (
                [`${row.label}模型`, formatUsageMoney(row.cost)] as const
              ))),
            ].map(([label, value]) => (
              <div key={label} className="rounded-[11px] border border-white/[.07] bg-white/[.025] px-5 py-4">
                <span className="text-[12px] text-white/50">{label}</span>
                <strong className="mt-2 block text-[22px] text-white">{value}</strong>
              </div>
            ))}
          </div>

          <PermissionMatrix />
          {pageNotice ? <div role="status" className="mb-4 rounded-[9px] border border-emerald-400/20 bg-emerald-400/10 px-4 py-3 text-[12px] text-emerald-200">{pageNotice}</div> : null}

          {pageError ? (
            <div className="mb-4 flex items-center justify-between rounded-[9px] border border-red-400/20 bg-red-400/10 px-4 py-3 text-[12px] text-red-200">
              <span>{pageError}</span>
              <button type="button" className="underline" onClick={() => void loadAccounts()}>重试</button>
            </div>
          ) : null}

          <section className="overflow-hidden rounded-[12px] border border-white/[.07] bg-[#151515]">
            <div className="flex items-center justify-between border-b border-white/[.07] px-5 py-4">
              <div>
                <h2 className="text-[13px] font-bold text-white">{workspace?.manager.username || '当前管理账号'}的子账号</h2>
                <p className="mt-1 text-[11px] leading-5 text-white/45">所有子账号从管理账号共享钱包扣费；个人每日额度 0 禁止生成，unlimited 不限每日用量。历史个人积分不参与共享生成，可收回共享钱包。</p>
              </div>
            </div>
            <div className="overflow-x-auto">
              <div className="min-w-[1370px]">
                <div className="grid grid-cols-[minmax(170px,1.2fr)_100px_80px_130px_130px_210px_minmax(180px,1fr)_130px_300px] gap-3 border-b border-white/[.055] px-5 py-3 text-[11px] font-semibold text-white/40">
                  <span>子账号</span><span>角色</span><span>状态</span><span>历史个人积分</span><span>今日额度 / 用量</span><span>模型金额</span><span>功能区权限</span><span>最后登录</span>
                  <span className="sticky right-0 z-10 -my-3 flex items-center justify-end border-l border-white/[.055] bg-[#151515] py-3 pl-3 text-white/55 shadow-[-12px_0_18px_rgba(21,21,21,.92)]">操作</span>
                </div>
                {loading ? (
                  <div className="px-5 py-12 text-center text-[11px] text-white/30">正在加载子账号…</div>
                ) : subaccounts.length === 0 ? (
                  <div className="px-5 py-12 text-center text-[11px] text-white/25">当前工作区还没有子账号</div>
                ) : subaccounts.map((account) => {
                  const definition = roleDefinition(account.role)
                  return (
                    <div key={account.id} className="grid grid-cols-[minmax(170px,1.2fr)_100px_80px_130px_130px_210px_minmax(180px,1fr)_130px_300px] items-center gap-3 border-b border-white/[.045] px-5 py-4 last:border-b-0">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#4f4f4f]/25 text-[#e5e5e5]"><AppIcon name="user" className="h-4 w-4" /></span>
                        <span className="truncate text-[12px] font-semibold text-white">{account.username}</span>
                      </div>
                      <span className={`w-fit max-w-full truncate rounded-full border px-2 py-1 text-[10px] font-semibold ${ROLE_TONES[account.role]}`} title={account.roleLabel || definition.shortLabel}>{account.roleLabel || definition.shortLabel}</span>
                      <span className={`flex w-fit items-center gap-1.5 text-[10px] ${account.status === 'active' ? 'text-emerald-300' : 'text-white/35'}`}>
                        <i className={`h-1.5 w-1.5 rounded-full ${account.status === 'active' ? 'bg-emerald-400' : 'bg-white/25'}`} />
                        {account.status === 'active' ? '启用' : '停用'}
                      </span>
                      <Credits credits={account.credits} />
                      <DailyUsageCell usage={account.usageToday} />
                      <span className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px] text-white/55">
                        {(account.usage.byType || emptyModelUsageSummary().byType).map((row) => (
                          <span key={row.type}>
                            {row.label}
                            <strong className="ml-1 text-[12px] text-white">{formatUsageMoney(row.cost)}</strong>
                          </span>
                        ))}
                      </span>
                      <span className="flex flex-wrap gap-1">
                        {ACCOUNT_FUNCTION_PERMISSION_DEFINITIONS.filter((item) => account.permissions.includes(item.key)).map((item) => (
                          <small key={item.key} className="rounded-full border border-white/15 bg-white/[.07] px-2 py-0.5 text-[9px] text-neutral-200/65">{item.label}</small>
                        ))}
                        {ACCOUNT_FUNCTION_PERMISSION_DEFINITIONS.every((item) => !account.permissions.includes(item.key)) ? <small className="text-[10px] text-white/30">仅查看</small> : null}
                      </span>
                      <span className="text-[10px] text-white/35">{formatDate(account.lastLoginAt)}</span>
                      <span className="sticky right-0 z-10 -my-4 flex items-center justify-end gap-2 border-l border-white/[.055] bg-[#151515] py-4 pl-3 shadow-[-12px_0_18px_rgba(21,21,21,.92)]">
                        <button type="button" className="fos-btn fos-btn-ghost fos-btn-sm" onClick={() => setLedgerTarget(account)}>流水</button>
                        <button type="button" className="fos-btn fos-btn-primary fos-btn-sm" onClick={() => openEdit(account)}>设置额度</button>
                        <button type="button" className="fos-btn fos-btn-ghost fos-btn-sm" disabled={account.credits.points <= 0} title="将历史个人积分收回共享钱包" onClick={() => openCreditOperation('reclaim', account)}>收回</button>
                        <button type="button" className="fos-btn fos-btn-ghost fos-btn-sm" onClick={() => openEdit(account)}>编辑</button>
                        <button type="button" className="fos-btn fos-btn-danger fos-btn-sm" title="删除子账号" aria-label={`删除子账号 ${account.username}`} disabled={deletingId === account.id} onClick={() => void deleteAccount(account)}>
                          <AppIcon name="trash" className="h-3.5 w-3.5" />
                          {deletingId === account.id ? '删除中…' : '删除'}
                        </button>
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          </section>
        </section>
      </div>

      {mode ? (
        <AccountDialog
          mode={mode}
          draft={draft}
          target={target}
          operatorRole="admin"
          workspaces={workspace ? [workspace] : []}
          saving={saving}
          error={dialogError}
          onDraft={setDraft}
          onClose={() => setMode(null)}
          onSubmit={() => void submit()}
        />
      ) : null}
      {creditOperation && creditTarget ? (
        <CreditOperationDialog
          operation={creditOperation}
          target={creditTarget}
          sourceBalancePoints={creditTarget.credits.points}
          saving={creditSaving}
          error={creditError}
          onClose={() => { setCreditOperation(null); setCreditTarget(null); setCreditRequestKey('') }}
          onSubmit={(input) => void mutateCredits(input)}
        />
      ) : null}
      {ledgerTarget ? <CreditLedgerDialog target={ledgerTarget} onClose={() => setLedgerTarget(null)} /> : null}
    </FosShell>
  )
}
