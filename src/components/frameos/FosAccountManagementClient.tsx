'use client'

import { useCallback, useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { AppIcon } from '@/components/ui/icons'
import { apiFetch } from '@/lib/api-fetch'
import { readApiErrorMessage } from '@/lib/api/read-error-message'
import type { AccountCredits } from '@/lib/account/credits'
import { createCreditIdempotencyKey, notifyBalanceChanged } from '@/lib/billing/client'
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
import { FosShell } from './FosShell'
import {
  AccountDialog,
  CreditLedgerDialog,
  CreditOperationDialog,
  PermissionMatrix,
  type CreditOperationKind,
} from './FosAccountManagementParts'

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
}

const ROLE_TONES: Record<AccountRole, string> = {
  super_admin: 'border-fuchsia-400/30 bg-fuchsia-400/[.09] text-fuchsia-200',
  admin: 'border-violet-400/25 bg-violet-400/[.08] text-violet-200',
  writer: 'border-blue-400/25 bg-blue-400/[.08] text-blue-200',
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
      <span className="inline-flex items-center gap-1"><i className="flex h-4 w-4 items-center justify-center rounded-full bg-blue-400 text-[8px] not-italic text-blue-950">◆</i>{credits.points}</span>
    </span>
  )
}

export function FosAccountManagementClient() {
  const { data: session } = useSession()
  const [workspace, setWorkspace] = useState<ManagedWorkspace | null>(null)
  const [loading, setLoading] = useState(true)
  const [pageError, setPageError] = useState('')
  const [mode, setMode] = useState<'create' | 'edit' | null>(null)
  const [target, setTarget] = useState<ManagedAccount | null>(null)
  const [draft, setDraft] = useState<AccountDraft>(NEW_ACCOUNT_DRAFT)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState('')
  const [dialogError, setDialogError] = useState('')
  const [creditOperation, setCreditOperation] = useState<Exclude<CreditOperationKind, 'recharge'> | null>(null)
  const [creditTarget, setCreditTarget] = useState<ManagedAccount | null>(null)
  const [ledgerTarget, setLedgerTarget] = useState<ManagedAccount | null>(null)
  const [creditRequestKey, setCreditRequestKey] = useState('')
  const [creditSaving, setCreditSaving] = useState(false)
  const [creditError, setCreditError] = useState('')

  const loadAccounts = useCallback(async (silent = false) => {
    if (session?.user?.role !== 'admin') return
    if (!silent) setLoading(true)
    setPageError('')
    try {
      const response = await apiFetch('/api/admin/accounts')
      if (!response.ok) throw new Error(await readApiErrorMessage(response, '获取子账号失败'))
      const payload = await response.json() as { workspaces?: ManagedWorkspace[] }
      setWorkspace(Array.isArray(payload.workspaces) ? payload.workspaces[0] || null : null)
    } catch (error) {
      setPageError(error instanceof Error ? error.message : '获取子账号失败')
    } finally {
      if (!silent) setLoading(false)
    }
  }, [session?.user?.role])

  useEffect(() => { void loadAccounts() }, [loadAccounts])

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
            ...(!isCreate ? { status: draft.status } : {}),
            ...(draft.password ? { password: draft.password } : {}),
          }),
        },
      )
      if (!response.ok) throw new Error(await readApiErrorMessage(response, '保存子账号失败'))
      setMode(null)
      await loadAccounts()
    } catch (error) {
      setDialogError(error instanceof Error ? error.message : '保存子账号失败')
    } finally {
      setSaving(false)
    }
  }

  const openCreditOperation = (operation: 'allocate' | 'reclaim', account: ManagedAccount) => {
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
        throw new Error(await readApiErrorMessage(response, creditOperation === 'allocate' ? '分配积分失败' : '收回积分失败'))
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

          <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-7">
            {[
              ['我的可用积分', workspace?.manager.credits.points || 0],
              ['角色子账号', subaccounts.length],
              ['工作区项目', workspace?.usage.projects || 0],
              ['工作区资产', workspace?.usage.assets || 0],
              ['输入 Token', formatNumber(workspace?.usage.inputTokens || 0)],
              ['输出 Token', formatNumber(workspace?.usage.outputTokens || 0)],
              ['总 Token', formatNumber(workspace?.usage.totalTokens || 0)],
            ].map(([label, value]) => (
              <div key={label} className="rounded-[11px] border border-white/[.07] bg-white/[.025] px-5 py-4">
                <span className="text-[12px] text-white/50">{label}</span>
                <strong className="mt-2 block text-[22px] text-white">{value}</strong>
              </div>
            ))}
          </div>

          <PermissionMatrix />

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
                <p className="mt-1 text-[9px] text-white/30">所有子账号共享当前管理账号的项目和资产读取范围。</p>
              </div>
            </div>
            <div className="overflow-x-auto">
              <div className="min-w-[1240px]">
                <div className="grid grid-cols-[minmax(170px,1.2fr)_100px_80px_130px_210px_minmax(180px,1fr)_130px_300px] gap-3 border-b border-white/[.055] px-5 py-3 text-[11px] font-semibold text-white/40">
                  <span>子账号</span><span>角色</span><span>状态</span><span>金币 / 积分</span><span>Token 用量</span><span>功能区权限</span><span>最后登录</span>
                  <span className="sticky right-0 z-10 -my-3 flex items-center justify-end border-l border-white/[.055] bg-[#151515] py-3 pl-3 text-white/55 shadow-[-12px_0_18px_rgba(21,21,21,.92)]">操作</span>
                </div>
                {loading ? (
                  <div className="px-5 py-12 text-center text-[11px] text-white/30">正在加载子账号…</div>
                ) : subaccounts.length === 0 ? (
                  <div className="px-5 py-12 text-center text-[11px] text-white/25">当前工作区还没有子账号</div>
                ) : subaccounts.map((account) => {
                  const definition = roleDefinition(account.role)
                  return (
                    <div key={account.id} className="grid grid-cols-[minmax(170px,1.2fr)_100px_80px_130px_210px_minmax(180px,1fr)_130px_300px] items-center gap-3 border-b border-white/[.045] px-5 py-4 last:border-b-0">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#31528d]/25 text-[#8aa8ff]"><AppIcon name="user" className="h-4 w-4" /></span>
                        <span className="truncate text-[12px] font-semibold text-white">{account.username}</span>
                      </div>
                      <span className={`w-fit max-w-full truncate rounded-full border px-2 py-1 text-[10px] font-semibold ${ROLE_TONES[account.role]}`} title={account.roleLabel || definition.shortLabel}>{account.roleLabel || definition.shortLabel}</span>
                      <span className={`flex w-fit items-center gap-1.5 text-[10px] ${account.status === 'active' ? 'text-emerald-300' : 'text-white/35'}`}>
                        <i className={`h-1.5 w-1.5 rounded-full ${account.status === 'active' ? 'bg-emerald-400' : 'bg-white/25'}`} />
                        {account.status === 'active' ? '启用' : '停用'}
                      </span>
                      <Credits credits={account.credits} />
                      <span><strong className="block text-[12px] text-white">{formatNumber(account.usage.totalTokens)} total</strong><span className="mt-1 block text-[10px] text-white/40">输入 {formatNumber(account.usage.inputTokens)} · 输出 {formatNumber(account.usage.outputTokens)}</span></span>
                      <span className="flex flex-wrap gap-1">
                        {ACCOUNT_FUNCTION_PERMISSION_DEFINITIONS.filter((item) => account.permissions.includes(item.key)).map((item) => (
                          <small key={item.key} className="rounded-full border border-blue-300/15 bg-blue-400/[.07] px-2 py-0.5 text-[9px] text-blue-100/65">{item.label}</small>
                        ))}
                        {ACCOUNT_FUNCTION_PERMISSION_DEFINITIONS.every((item) => !account.permissions.includes(item.key)) ? <small className="text-[10px] text-white/30">仅查看</small> : null}
                      </span>
                      <span className="text-[10px] text-white/35">{formatDate(account.lastLoginAt)}</span>
                      <span className="sticky right-0 z-10 -my-4 flex items-center justify-end gap-2 border-l border-white/[.055] bg-[#151515] py-4 pl-3 shadow-[-12px_0_18px_rgba(21,21,21,.92)]">
                        <button type="button" className="fos-btn fos-btn-ghost fos-btn-sm" onClick={() => setLedgerTarget(account)}>流水</button>
                        <button type="button" className="fos-btn fos-btn-primary fos-btn-sm" onClick={() => openCreditOperation('allocate', account)}>分配</button>
                        <button type="button" className="fos-btn fos-btn-ghost fos-btn-sm" onClick={() => openCreditOperation('reclaim', account)}>收回</button>
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
          sourceBalancePoints={creditOperation === 'allocate'
            ? workspace?.manager.credits.points
            : creditTarget.credits.points}
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
