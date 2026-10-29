'use client'

import { confirmAction } from '@/lib/ui/feedback'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSession } from 'next-auth/react'
import { AppIcon } from '@/components/ui/icons'
import {
  AccountDialog,
  CreditLedgerDialog,
  CreditOperationDialog,
  DailyUsageCell,
} from '@/components/frameos/FosAccountManagementParts'
import { AdminAlert, AdminMetric, AdminSearch, PlatformAdminShell } from '@/components/admin/PlatformAdminShell'
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
import { createCreditIdempotencyKey, notifyBalanceChanged, subscribeBalanceChanges } from '@/lib/billing/client'
import { createLatestRequestTracker } from '@/lib/api/latest-request'
import type { DailyUsagePayload } from '@/lib/billing/daily-limit'
import { updateDailyUsageLimit } from '@/lib/billing/daily-limit-display'
import { dailyLimitSaveMessage } from '@/lib/billing/daily-limit-policy'
import {
  emptyModelUsageSummary,
  formatUsageMoney,
  type ModelTypeUsage,
  type ModelUsageSummary,
} from '@/lib/platform-services/model-type-usage'

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
  subaccountCount: number
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

interface AccountTotals {
  managers: number
  subaccounts: number
  projects: number
  assets: number
  calls: number
  cost: number
  byType: ModelTypeUsage[]
}

const EMPTY_TOTALS: AccountTotals = {
  managers: 0,
  subaccounts: 0,
  projects: 0,
  assets: 0,
  calls: 0,
  cost: 0,
  byType: emptyModelUsageSummary().byType,
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
  dailyPointLimit: 'unlimited',
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

function TypeCosts({ rows }: { rows: ModelTypeUsage[] }) {
  return (
    <div className="nori-admin-type-costs">
      {(rows.length ? rows : emptyModelUsageSummary().byType).map((row) => (
        <div key={row.type} className="nori-admin-type-cost">
          <span>{row.label}</span>
          <strong>{formatUsageMoney(row.cost)}</strong>
        </div>
      ))}
    </div>
  )
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
  const accountsRequests = useRef(createLatestRequestTracker())

  const loadAccounts = useCallback(async (silent = false) => {
    if (session?.user?.role !== 'super_admin') return
    const request = accountsRequests.current.begin()
    if (!silent) setLoading(true)
    setPageError('')
    try {
      const response = await apiFetch(`/api/admin/accounts?refresh=${Date.now()}`, { cache: 'no-store' })
      if (!response.ok) throw new Error(await readApiErrorMessage(response, '获取管理账号失败'))
      const payload = await response.json() as {
        workspaces?: ManagedWorkspace[]
        totals?: AccountTotals
      }
      if (!accountsRequests.current.isCurrent(request)) return
      setWorkspaces(Array.isArray(payload.workspaces) ? payload.workspaces : [])
      setTotals(payload.totals || EMPTY_TOTALS)
    } catch (error) {
      if (!accountsRequests.current.isCurrent(request)) return
      setPageError(error instanceof Error ? error.message : '获取管理账号失败')
    } finally {
      if (accountsRequests.current.isCurrent(request)) setLoading(false)
    }
  }, [session?.user?.role])

  useEffect(() => { void loadAccounts() }, [loadAccounts])
  useEffect(() => {
    const refresh = () => void loadAccounts(true)
    const unsubscribe = subscribeBalanceChanges(refresh)
    window.addEventListener('focus', refresh)
    return () => { unsubscribe(); window.removeEventListener('focus', refresh); accountsRequests.current.invalidate() }
  }, [loadAccounts])

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
      dailyPointLimit: account.dailyLimitPoints === null ? 'unlimited' : String(account.dailyLimitPoints),
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
            dailyPointLimit: draft.dailyPointLimit === 'unlimited' ? 'unlimited' : Number(draft.dailyPointLimit),
            ...(!creating ? { status: draft.status } : {}),
            ...(draft.password ? { password: draft.password } : {}),
          }),
        },
      )
      if (!response.ok) throw new Error(await readApiErrorMessage(response, '保存管理账号失败'))
      const payload = await response.json() as { account?: ManagedAccount }
      accountsRequests.current.invalidate()
      const updated = payload.account
      if (updated && !creating) {
        setWorkspaces((current) => current.map((workspace) => workspace.manager.id === updated.id
          ? { ...workspace, manager: { ...workspace.manager, ...updated, usageToday: updateDailyUsageLimit(workspace.manager.usageToday, updated.dailyLimitPoints) } }
          : workspace))
      }
      setPageNotice(dailyLimitSaveMessage(updated?.dailyLimitPoints ?? null))
      setMode(null)
      notifyBalanceChanged()
      await loadAccounts(true)
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
    if (!await confirmAction({
      title: `删除管理账号「${manager.username}」？`,
      message: '只有空工作区的账号可以删除，此操作不可撤销。',
      confirmLabel: '删除',
      danger: true,
    })) return
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

  return (
    <PlatformAdminShell
      active="accounts"
      eyebrow="平台管理"
      title="账号与用量"
      description="创建工作区负责人，管理密码、状态与积分，并按文本、图片、视频、语音核对各工作区已计费金额。"
      actions={(
        <button type="button" onClick={openCreate} className="fos-btn fos-btn-primary">
          <AppIcon name="plus" className="h-4 w-4" />添加管理账号
        </button>
      )}
    >
      <div className="nori-admin-metrics">
        <AdminMetric label="管理账号" value={totals.managers} icon="usersRound" />
        <AdminMetric label="启用中" value={activeManagers} icon="badgeCheck" />
        <AdminMetric label="角色子账号" value={totals.subaccounts} icon="userRoundCog" />
        <AdminMetric label="管理账号积分" value={formatNumber(totalManagerPoints)} icon="coins" />
      </div>
      <div className="nori-admin-metrics nori-admin-metrics--compact">
        {(totals.byType.length ? totals.byType : emptyModelUsageSummary().byType).map((row) => (
          <AdminMetric key={row.type} label={`${row.label}模型`} value={formatUsageMoney(row.cost)} icon="chart" />
        ))}
      </div>

      {pageError ? <AdminAlert tone="error" action={<button type="button" onClick={() => void loadAccounts()}>重试</button>}>{pageError}</AdminAlert> : null}
      {pageNotice ? <AdminAlert tone="success">{pageNotice}</AdminAlert> : null}

      <section className="nori-admin-panel">
        <div className="nori-admin-panel-head">
          <div>
            <h2>管理工作区</h2>
            <p>每张卡片按模型类型列出工作区已计费金额，充值后余额实时累计。</p>
          </div>
          <AdminSearch value={query} onChange={setQuery} placeholder="搜索管理账号" />
        </div>
        <div className="nori-admin-panel-body nori-admin-stack">
          {loading ? <div className="nori-admin-empty">正在加载管理账号与用量…</div> : visibleWorkspaces.length === 0 ? (
            <div className="nori-admin-empty">{query ? '没有匹配的管理账号' : '尚未创建管理账号'}</div>
          ) : visibleWorkspaces.map((workspace) => {
            const { manager, subaccountCount, usage } = workspace
            return (
              <article key={manager.id} className="nori-admin-workspace-card">
                <header className="nori-admin-workspace-head">
                  <div className="nori-admin-identity">
                    <span className="nori-admin-avatar">{manager.username.slice(0, 1).toUpperCase()}</span>
                    <div>
                      <div className="nori-admin-identity-row">
                        <strong>{manager.username}</strong>
                        <span className={`nori-admin-pill ${manager.status === 'active' ? 'is-ok' : ''}`}>
                          <i />{manager.status === 'active' ? '启用' : '停用'}
                        </span>
                      </div>
                      <span className="nori-admin-subtle">创建于 {formatDate(manager.createdAt)}</span>
                    </div>
                  </div>
                  <div className="nori-admin-actions">
                    <button type="button" className="fos-btn fos-btn-ghost fos-btn-sm" onClick={() => setLedgerTarget(manager)}>积分流水</button>
                    <button type="button" className="fos-btn fos-btn-primary fos-btn-sm" onClick={() => { setCreditError(''); setRechargeRequestKey(createCreditIdempotencyKey('recharge', manager.id)); setRechargeTarget(manager) }}>
                      <AppIcon name="coins" className="h-3.5 w-3.5" />充值积分
                    </button>
                    <button type="button" className="fos-btn fos-btn-ghost fos-btn-sm" onClick={() => openEdit(manager)}>编辑账号</button>
                    <button type="button" className="fos-icon-btn nori-admin-danger-action" aria-label="删除管理账号" disabled={deletingId === manager.id} title={deletingId === manager.id ? '正在删除' : '删除管理账号'} onClick={() => void deleteManager(workspace)}>
                      <AppIcon name="trash" className="h-4 w-4" />
                    </button>
                  </div>
                </header>
                <div className="nori-admin-statgrid">
                  <div className="nori-admin-stat"><Credits credits={manager.credits} /></div>
                  <div className="nori-admin-stat">
                    <span>团队与内容</span>
                    <strong>{subaccountCount} 个子账号</strong>
                    <small>{usage.projects} 个作品 · {usage.assets} 项资产</small>
                  </div>
                  <div className="nori-admin-stat">
                    <span>模型用量（金额）</span>
                    <TypeCosts rows={usage.byType} />
                    <small>{usage.calls} 次计费</small>
                  </div>
                  <div className="nori-admin-stat">
                    <span>今日用量（积分）</span>
                    <DailyUsageCell usage={manager.usageToday} />
                    <small>按上海时间每天 00:00 重置</small>
                  </div>
                  <div className="nori-admin-stat">
                    <span>最后登录</span>
                    <strong>{formatDate(manager.lastLoginAt)}</strong>
                    <small>账号数据实时同步</small>
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      </section>

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
    </PlatformAdminShell>
  )
}
