'use client'

import { useEffect, useState } from 'react'
import { AppIcon } from '@/components/ui/icons'
import { apiFetch } from '@/lib/api-fetch'
import { readApiErrorMessage } from '@/lib/api/read-error-message'
import {
  ACCOUNT_FUNCTION_PERMISSION_DEFINITIONS,
  ACCOUNT_ROLE_DEFINITIONS,
  SUBACCOUNT_ROLES,
  defaultSubaccountRoleLabel,
  effectiveAccountPermissions,
  type AccountPermission,
  type AccountRole,
  type AccountStatus,
  type SubaccountRole,
} from '@/lib/account/permissions'
import type { AccountCredits } from '@/lib/account/credits'

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
}

interface ManagedWorkspace {
  manager: ManagedAccount
  subaccounts: ManagedAccount[]
  usage: { projects: number; assets: number }
}

export type CreditOperationKind = 'recharge' | 'allocate' | 'reclaim'

interface CreditLedgerPayload {
  balance: {
    availablePoints: number
    frozenPoints: number
    totalSpentPoints: number
  }
  transactions: Array<{
    id: string
    type: string
    amountPoints: number
    balanceAfterPoints: number
    description: string | null
    createdAt: string
  }>
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

function matchesPermissionPreset(permissions: readonly AccountPermission[], role: SubaccountRole) {
  const expected = new Set(effectiveAccountPermissions(role))
  return ACCOUNT_FUNCTION_PERMISSION_DEFINITIONS.every((definition) => (
    permissions.includes(definition.key) === expected.has(definition.key)
  ))
}

function roleLabelAfterPreset(current: string, role: SubaccountRole) {
  const normalized = current.trim()
  const isDefaultLabel = SUBACCOUNT_ROLES.some((candidate) => (
    defaultSubaccountRoleLabel(candidate) === normalized
  ))
  return !normalized || isDefaultLabel ? defaultSubaccountRoleLabel(role) : current
}

export function PermissionMatrix() {
  return (
    <section className="mb-5 overflow-hidden rounded-[12px] border border-white/[.07] bg-[#151515]">
      <div className="border-b border-white/[.07] px-5 py-4">
        <h2 className="text-[13px] font-bold text-white">功能区权限</h2>
        <p className="mt-1 text-[10px] text-white/35">角色名称只用于团队展示。每个生产子账号能做什么，由下面 {ACCOUNT_FUNCTION_PERMISSION_DEFINITIONS.length} 个功能区独立决定；审核员的审核范围由所属管理账号按项目指定。</p>
      </div>
      <div className="grid gap-2 p-4 sm:grid-cols-2 xl:grid-cols-6">
        {ACCOUNT_FUNCTION_PERMISSION_DEFINITIONS.map((permission) => (
          <article key={permission.key} className="rounded-[10px] border border-blue-300/10 bg-blue-400/[.045] p-3.5">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-[7px] bg-blue-500/15 text-blue-200">
                <AppIcon name="check" className="h-3.5 w-3.5" />
              </span>
              <strong className="text-[12px] font-semibold text-white/85">{permission.label}</strong>
            </div>
            <p className="mt-2 text-[10px] leading-5 text-white/40">{permission.description}</p>
          </article>
        ))}
      </div>
      <div className="flex items-center gap-2 border-t border-emerald-300/10 bg-emerald-400/[.035] px-5 py-3 text-[10px] text-emerald-100/60">
        <AppIcon name="check" className="h-3.5 w-3.5 text-emerald-300" />
        所有子账号固定拥有团队内容读取权限；未勾选功能区时仍可查看，但不能编辑或发起生成。
      </div>
    </section>
  )
}

export function AccountDialog({
  mode,
  draft,
  target,
  operatorRole,
  workspaces,
  allowAccountTypeChoice = true,
  saving,
  error,
  onDraft,
  onClose,
  onSubmit,
}: {
  mode: 'create' | 'edit'
  draft: AccountDraft
  target: ManagedAccount | null
  operatorRole: AccountRole
  workspaces: ManagedWorkspace[]
  allowAccountTypeChoice?: boolean
  saving: boolean
  error: string
  onDraft: (draft: AccountDraft) => void
  onClose: () => void
  onSubmit: () => void
}) {
  const platformOperator = operatorRole === 'super_admin'
  const creatingManager = mode === 'create' && draft.accountType === 'manager'
  const editingManagementAccount = mode === 'edit' && Boolean(target?.isManager)
  const canEditStatus = mode === 'edit'
    && target?.role !== 'super_admin'
    && (platformOperator || !editingManagementAccount)
  const title = mode === 'create'
    ? creatingManager ? '添加管理账号' : '添加角色子账号'
    : `编辑 ${draft.username}`

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-5 backdrop-blur-sm">
      <div className="account-management-dialog flex max-h-[90vh] w-full max-w-[700px] flex-col overflow-hidden rounded-[14px] border border-white/10 bg-[#171717] shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/[.07] px-6 py-4">
          <div>
            <h2 className="text-[16px] font-bold text-white">{title}</h2>
            <p className="mt-1 text-[11px] text-white/40">角色名称用于展示；功能区开关才决定账号可以执行哪些操作。</p>
          </div>
          <button type="button" className="fos-icon-btn" onClick={onClose} aria-label="关闭"><AppIcon name="close" className="h-4 w-4" /></button>
        </div>

        <div className="overflow-y-auto px-6 py-5">
          {mode === 'create' && platformOperator && allowAccountTypeChoice ? (
            <div className="mb-5 grid grid-cols-2 gap-2">
              {([
                ['manager', '管理账号', '拥有独立工作区，可管理自己的角色子账号'],
                ['subaccount', '角色子账号', '归属于指定管理账号，按功能区独立授权'],
              ] as const).map(([value, label, description]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => onDraft({
                    ...draft,
                    accountType: value,
                    ...(value === 'subaccount' && !draft.managerId
                      ? { managerId: workspaces.find((workspace) => workspace.manager.status === 'active')?.manager.id || '' }
                      : {}),
                  })}
                  className={`rounded-[10px] border p-3 text-left ${draft.accountType === value ? 'border-violet-400/35 bg-violet-400/[.09]' : 'border-white/[.07] bg-white/[.025]'}`}
                >
                  <span className="block text-[12px] font-semibold text-white">{label}</span>
                  <span className="mt-1 block text-[9px] leading-4 text-white/40">{description}</span>
                </button>
              ))}
            </div>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-2 block text-[11px] font-semibold text-white/60">登录账号</span>
              <input
                className="fos-input w-full"
                value={draft.username}
                autoComplete="off"
                onChange={(event) => onDraft({ ...draft, username: event.target.value })}
                placeholder={creatingManager ? '例如 manager-us' : '例如 writer-01'}
              />
            </label>
            <label className="block">
              <span className="mb-2 block text-[11px] font-semibold text-white/60">
                {mode === 'create' ? '初始密码' : '重置密码（留空则不修改）'}
              </span>
              <input
                className="fos-input w-full"
                type="password"
                value={draft.password}
                autoComplete="new-password"
                onChange={(event) => onDraft({ ...draft, password: event.target.value })}
                placeholder="至少 8 位"
              />
            </label>
          </div>

          {!creatingManager && !editingManagementAccount ? (
            <>
              {platformOperator ? (
                <label className="mt-5 block">
                  <span className="mb-2 block text-[11px] font-semibold text-white/60">所属管理账号</span>
                  <select
                    className="fos-input w-full"
                    value={draft.managerId}
                    onChange={(event) => onDraft({ ...draft, managerId: event.target.value })}
                  >
                    {workspaces.map((workspace) => (
                      <option key={workspace.manager.id} value={workspace.manager.id} disabled={workspace.manager.status === 'disabled'}>
                        {workspace.manager.username}{workspace.manager.isPlatformAdmin ? '（平台 Admin 工作区）' : ''}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}

              <div className="mt-5">
                <span className="mb-2 block text-[11px] font-semibold text-white/60">快捷权限模板（可选）</span>
                <div className="grid gap-2 sm:grid-cols-4">
                  {SUBACCOUNT_ROLES.map((role) => {
                    const definition = roleDefinition(role)
                    const selected = matchesPermissionPreset(draft.permissions, role)
                    return (
                      <button
                        key={role}
                        type="button"
                        onClick={() => onDraft({
                          ...draft,
                          role,
                          roleLabel: roleLabelAfterPreset(draft.roleLabel, role),
                          permissions: effectiveAccountPermissions(role),
                        })}
                        className={`rounded-[10px] border p-3 text-left transition-colors ${selected ? ROLE_TONES[role] : 'border-white/[.07] bg-white/[.025] text-white/55 hover:bg-white/[.05]'}`}
                      >
                        <span className="block text-[12px] font-semibold">{definition.shortLabel}</span>
                        <span className="mt-1 block text-[9px] leading-4 opacity-60">{definition.description}</span>
                      </button>
                    )
                  })}
                </div>
              </div>

              <label className="mt-5 block">
                <span className="mb-2 block text-[11px] font-semibold text-white/60">角色名称（仅展示）</span>
                <input
                  className="fos-input w-full"
                  value={draft.roleLabel}
                  maxLength={64}
                  onChange={(event) => onDraft({ ...draft, roleLabel: event.target.value })}
                  placeholder="例如：海外短剧导演、提示词设计师"
                />
                <span className="mt-1.5 block text-[10px] text-white/35">可自由命名，不影响权限；任务分配会按下面的实际功能区筛选可选账号。</span>
              </label>

              {draft.role === 'reviewer' ? (
                <div className="mt-5 rounded-[10px] border border-cyan-300/20 bg-cyan-400/[.07] px-4 py-3">
                  <div className="flex items-center gap-2 text-[12px] font-semibold text-cyan-100"><AppIcon name="clipboardCheck" className="h-4 w-4" />审核权限由项目授权</div>
                  <p className="mt-1.5 text-[10px] leading-5 text-white/45">审核员固定为只读，不能编辑剧本、资产、分镜或视频。由所属管理账号在项目协作者里加入该账号后，才能查看并处理该项目的待审核任务。</p>
                </div>
              ) : (
                <div className="mt-5">
                  <div className="mb-2 flex items-end justify-between gap-3">
                    <span className="block text-[11px] font-semibold text-white/60">功能区权限</span>
                    <span className="text-[10px] text-white/35">团队项目默认可读</span>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {ACCOUNT_FUNCTION_PERMISSION_DEFINITIONS.map((permission) => {
                      const checked = draft.permissions.includes(permission.key)
                      return (
                        <button
                          key={permission.key}
                          type="button"
                          aria-pressed={checked}
                          onClick={() => onDraft({
                            ...draft,
                            permissions: checked
                              ? draft.permissions.filter((item) => item !== permission.key)
                              : [...draft.permissions, permission.key],
                          })}
                          className={`flex items-start gap-3 rounded-[10px] border p-3 text-left transition-colors ${checked ? 'border-blue-400/35 bg-blue-400/[.09]' : 'border-white/[.07] bg-white/[.025] hover:bg-white/[.05]'}`}
                        >
                          <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] border ${checked ? 'border-blue-300/45 bg-blue-500 text-white' : 'border-white/15 bg-black/10 text-transparent'}`}><AppIcon name="check" className="h-3.5 w-3.5" /></span>
                          <span><strong className="block text-[12px] font-semibold text-white/85">{permission.label}</strong><small className="mt-1 block text-[10px] leading-4 text-white/40">{permission.description}</small></span>
                        </button>
                      )
                    })}
                  </div>
                  <div className="mt-2 flex items-center gap-2 rounded-[9px] border border-emerald-400/15 bg-emerald-400/[.055] px-3 py-2 text-[10px] text-emerald-100/65"><AppIcon name="check" className="h-3.5 w-3.5 text-emerald-300" />读取团队全部项目与资产（固定开启）</div>
                </div>
              )}
            </>
          ) : (
            <div className="mt-5 rounded-[10px] border border-violet-400/20 bg-violet-400/[.07] px-4 py-3">
              <span className="text-[12px] font-semibold text-violet-200">
                {target?.isPlatformAdmin ? '平台 Admin' : '管理账号'}
              </span>
              <p className="mt-1 text-[10px] leading-5 text-white/40">
                {target?.isPlatformAdmin ? '平台最高权限账号，不能停用、改角色或删除。' : '拥有独立工作区及全部生产权限，角色不可修改。'}
              </p>
            </div>
          )}

          {canEditStatus ? (
            <label className="mt-5 block">
              <span className="mb-2 block text-[11px] font-semibold text-white/60">账号状态</span>
              <select
                className="fos-input w-full"
                value={draft.status}
                onChange={(event) => onDraft({ ...draft, status: event.target.value as AccountStatus })}
              >
                <option value="active">启用</option>
                <option value="disabled">停用</option>
              </select>
            </label>
          ) : null}

          {mode === 'create' ? (
            <div className="mt-5 rounded-[10px] border border-blue-400/15 bg-blue-400/[.06] px-4 py-3">
              <p className="text-[11px] leading-5 text-blue-100/70">新账号积分默认为 0。创建后请使用独立的充值、分配或收回操作，所有变动都会记录到账本。</p>
            </div>
          ) : null}

          {target?.id && draft.password ? (
            <p className="mt-4 rounded-[8px] border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-[11px] text-amber-200">
              重置密码会使该账号已有登录立即失效。
            </p>
          ) : null}
          {error ? <p className="mt-4 rounded-[8px] border border-red-400/20 bg-red-400/10 px-3 py-2 text-[11px] text-red-200">{error}</p> : null}
        </div>

        <div className="flex justify-end gap-2 border-t border-white/[.07] px-6 py-4">
          <button type="button" className="fos-btn fos-btn-ghost" onClick={onClose} disabled={saving}>取消</button>
          <button type="button" className="fos-btn fos-btn-primary" onClick={onSubmit} disabled={saving}>
            {saving ? '保存中…' : mode === 'create' ? '创建账号' : '保存修改'}
          </button>
        </div>
      </div>
    </div>
  )
}

const CREDIT_OPERATION_COPY: Record<CreditOperationKind, { title: string; action: string; hint: string }> = {
  recharge: {
    title: '充值积分',
    action: '确认充值',
    hint: '平台向管理账号增发积分，不扣减平台 Admin 余额。',
  },
  allocate: {
    title: '分配积分',
    action: '确认分配',
    hint: '积分将从管理账号余额转入该子账号。',
  },
  reclaim: {
    title: '收回积分',
    action: '确认收回',
    hint: '只能收回子账号当前可用的积分，已消耗积分不能收回。',
  },
}

const CREDIT_TRANSACTION_LABELS: Record<string, string> = {
  recharge: '平台充值',
  allocate_out: '分配给子账号',
  allocate_in: '管理账号分配',
  reclaim_out: '积分被收回',
  reclaim_in: '收回子账号积分',
  usage: '服务消耗',
  refund: '消费退回',
}

function transactionNote(description: string | null) {
  if (!description) return ''
  try {
    const payload = JSON.parse(description) as { note?: unknown }
    return typeof payload.note === 'string' ? payload.note : ''
  } catch {
    return description.length > 80 ? `${description.slice(0, 80)}…` : description
  }
}

export function CreditLedgerDialog({
  target,
  onClose,
}: {
  target: ManagedAccount
  onClose: () => void
}) {
  const [payload, setPayload] = useState<CreditLedgerPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    const load = async () => {
      setLoading(true)
      setError('')
      try {
        const response = await apiFetch(`/api/admin/accounts/${target.id}/credits`, {
          cache: 'no-store',
          signal: AbortSignal.timeout(15_000),
        })
        if (!response.ok) throw new Error(await readApiErrorMessage(response, '获取积分流水失败'))
        const next = await response.json() as CreditLedgerPayload
        if (active) setPayload(next)
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : '获取积分流水失败')
      } finally {
        if (active) setLoading(false)
      }
    }
    void load()
    return () => { active = false }
  }, [target.id])

  return (
    <div className="fixed inset-0 z-[115] flex items-center justify-center bg-black/70 p-5 backdrop-blur-sm">
      <div className="flex max-h-[88vh] w-full max-w-[780px] flex-col overflow-hidden rounded-[14px] border border-white/10 bg-[#151a27] shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/[.08] px-6 py-4">
          <div><h2 className="text-[16px] font-bold text-white">积分账户流水</h2><p className="mt-1 text-[11px] text-white/45">{target.username} · 最近 50 条不可变账本记录</p></div>
          <button type="button" className="fos-icon-btn" onClick={onClose} aria-label="关闭"><AppIcon name="close" className="h-4 w-4" /></button>
        </div>
        <div className="overflow-y-auto p-5">
          {loading ? <div className="py-16 text-center text-[12px] text-white/45">正在核对余额与流水…</div> : error ? <div className="rounded-lg border border-red-400/20 bg-red-400/[.08] px-4 py-3 text-[12px] text-red-200">{error}</div> : payload ? (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                {[
                  ['可用积分', payload.balance.availablePoints],
                  ['冻结积分', payload.balance.frozenPoints],
                  ['累计消费', payload.balance.totalSpentPoints],
                ].map(([label, value]) => <div key={String(label)} className="rounded-xl border border-white/[.08] bg-white/[.035] px-4 py-3"><span className="text-[11px] text-white/45">{label}</span><strong className="mt-1.5 block text-[19px] text-white">{Number(value).toLocaleString('zh-CN', { maximumFractionDigits: 4 })}</strong></div>)}
              </div>
              <div className="mt-4 overflow-hidden rounded-xl border border-white/[.08]">
                <div className="grid grid-cols-[130px_1fr_130px_150px] gap-3 border-b border-white/[.08] bg-white/[.025] px-4 py-3 text-[10px] font-semibold text-white/40"><span>时间</span><span>类型 / 备注</span><span className="text-right">积分变动</span><span className="text-right">变动后余额</span></div>
                {payload.transactions.length ? payload.transactions.map((transaction) => {
                  const note = transactionNote(transaction.description)
                  return <div key={transaction.id} className="grid grid-cols-[130px_1fr_130px_150px] items-center gap-3 border-b border-white/[.055] px-4 py-3 text-[11px] last:border-0"><span className="text-white/40">{new Date(transaction.createdAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Shanghai' })}</span><span className="min-w-0"><strong className="block text-white/80">{CREDIT_TRANSACTION_LABELS[transaction.type] || transaction.type}</strong>{note ? <small className="mt-1 block truncate text-white/35">{note}</small> : null}</span><strong className={`text-right ${transaction.amountPoints >= 0 ? 'text-emerald-300' : 'text-amber-200'}`}>{transaction.amountPoints >= 0 ? '+' : ''}{transaction.amountPoints.toLocaleString('zh-CN', { maximumFractionDigits: 4 })}</strong><span className="text-right text-white/65">{transaction.balanceAfterPoints.toLocaleString('zh-CN', { maximumFractionDigits: 4 })}</span></div>
                }) : <div className="py-12 text-center text-[11px] text-white/35">暂无积分变动</div>}
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  )
}

export function CreditOperationDialog({
  operation,
  target,
  sourceBalancePoints,
  saving,
  error,
  onClose,
  onSubmit,
}: {
  operation: CreditOperationKind
  target: ManagedAccount
  sourceBalancePoints?: number | null
  saving: boolean
  error: string
  onClose: () => void
  onSubmit: (input: { points: number; note: string }) => void
}) {
  const [points, setPoints] = useState('')
  const [note, setNote] = useState('')
  const copy = CREDIT_OPERATION_COPY[operation]
  const parsedPoints = Number(points)
  const valid = Number.isSafeInteger(parsedPoints) && parsedPoints > 0 && parsedPoints <= 2_000_000_000
  const currentTargetPoints = target.credits.points
  const projectedTargetPoints = operation === 'recharge' && valid
    ? currentTargetPoints + parsedPoints
    : currentTargetPoints

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/70 p-5 backdrop-blur-sm">
      <div className="credit-operation-dialog w-full max-w-[500px] overflow-hidden rounded-[14px] border border-white/10 bg-[#171717] shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/[.07] px-6 py-4">
          <div>
            <h2 className="text-[16px] font-bold text-white">{copy.title}</h2>
            <p className="mt-1 text-[11px] text-white/40">目标账号：{target.username}</p>
          </div>
          <button type="button" className="fos-icon-btn" onClick={onClose} aria-label="关闭">
            <AppIcon name="close" className="h-4 w-4" />
          </button>
        </div>
        <div className="px-6 py-5">
          <div className="rounded-[10px] border border-blue-400/15 bg-blue-400/[.06] px-4 py-3 text-[11px] leading-5 text-blue-100/65">
            {copy.hint} 换算标准：¥1 = 100 积分。
          </div>
          {operation === 'recharge' ? (
            <div className="mt-4 grid grid-cols-[1fr_auto_1fr_auto_1fr] items-center gap-2 rounded-[12px] border border-blue-300/15 bg-[#101827] px-4 py-4 text-center">
              <span><small className="block text-[10px] text-white/45">当前余额</small><strong className="mt-1 block text-[15px] text-white">{currentTargetPoints.toLocaleString('zh-CN')}</strong></span>
              <span className="text-[15px] text-blue-200/55">+</span>
              <span><small className="block text-[10px] text-white/45">本次充值</small><strong className="mt-1 block text-[15px] text-blue-200">{valid ? parsedPoints.toLocaleString('zh-CN') : '—'}</strong></span>
              <span className="text-[15px] text-blue-200/55">=</span>
              <span><small className="block text-[10px] text-white/45">充值后余额</small><strong className="mt-1 block text-[15px] text-emerald-300">{projectedTargetPoints.toLocaleString('zh-CN')}</strong></span>
            </div>
          ) : null}
          {typeof sourceBalancePoints === 'number' && operation !== 'recharge' ? (
            <div className="mt-4 flex items-center justify-between rounded-[9px] border border-white/[.07] bg-white/[.025] px-4 py-3">
              <span className="text-[11px] text-white/45">可操作余额</span>
              <strong className="text-[15px] text-white">{sourceBalancePoints.toLocaleString('zh-CN', { maximumFractionDigits: 4 })} 积分</strong>
            </div>
          ) : null}
          <label className="mt-4 block">
            <span className="mb-2 block text-[11px] font-semibold text-white/60">积分数量</span>
            <input
              className="fos-input w-full"
              type="number"
              min={1}
              step={1}
              inputMode="numeric"
              autoFocus
              value={points}
              onChange={(event) => setPoints(event.target.value)}
              placeholder="请输入正整数积分"
            />
            {valid ? <span className="mt-2 block text-[10px] text-white/35">人民币等值 ¥{(parsedPoints / 100).toFixed(2)}</span> : null}
          </label>
          <label className="mt-4 block">
            <span className="mb-2 block text-[11px] font-semibold text-white/60">备注（选填）</span>
            <input
              className="fos-input w-full"
              maxLength={200}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="例如：7 月项目额度"
            />
          </label>
          {error ? <p className="mt-4 rounded-[8px] border border-red-400/20 bg-red-400/10 px-3 py-2 text-[11px] text-red-200">{error}</p> : null}
        </div>
        <div className="flex justify-end gap-2 border-t border-white/[.07] px-6 py-4">
          <button type="button" className="fos-btn fos-btn-ghost" onClick={onClose} disabled={saving}>取消</button>
          <button
            type="button"
            className="fos-btn fos-btn-primary"
            disabled={saving || !valid}
            onClick={() => onSubmit({ points: parsedPoints, note })}
          >
            {saving ? '处理中…' : copy.action}
          </button>
        </div>
      </div>
    </div>
  )
}
