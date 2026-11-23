'use client'

/**
 * 「记一笔」弹窗（管理员页 / 成员页共用，§11.7）。
 * 折合金额只是前端预览（computeEntryAmountMicros + 当前汇率），服务端会重算（R5）。
 * 编辑 = 作废 + 新建（PATCH entries/[id]）。重复 / 大额都用行内确认，不用 window.confirm。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSession } from 'next-auth/react'
import { AppIcon } from '@/components/ui/icons'
import { apiFetch } from '@/lib/api-fetch'
import { readApiErrorMessage } from '@/lib/api/read-error-message'
import { computeEntryAmountMicros, fromMicros, todayKey, addDaysKey, type EntryKind } from '@/lib/compute-ledger/calc'
import { ViewportDialogLayer } from '../ViewportDialogLayer'
import { useDialogDismiss } from '../use-dialog-dismiss'
import { ENTRY_KIND_LABELS, ENTRY_KIND_UNITS, formatCny } from './ledger-format'
import type { EntryView, LedgerRates, ProjectOption, ProjectOptionsResponse } from './ledger-types'

const RECENT_KEY = 'nori.ledger.recentProjects'
const SANITY_MAX_CNY = 100_000
const MEMBER_BACKDATE_DAYS = 14

type Account = { id: string; name: string }

function readRecent(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENT_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string').slice(0, 5) : []
  } catch {
    return []
  }
}

function pushRecent(id: string) {
  try {
    const next = [id, ...readRecent().filter((item) => item !== id)].slice(0, 5)
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next))
  } catch {
    /* localStorage 不可用时忽略 */
  }
}

export function RecordEntryDialog({
  isAdmin,
  onClose,
  onSaved,
  initial,
  existingEntries = [],
}: {
  isAdmin: boolean
  onClose: () => void
  onSaved: (entry: EntryView) => void
  initial?: EntryView | null
  existingEntries?: EntryView[]
}) {
  const { data: session } = useSession()
  const selfId = session?.user?.id ?? ''
  const today = todayKey()
  const minDate = isAdmin ? '2020-01-01' : addDaysKey(today, -MEMBER_BACKDATE_DAYS)

  const [dateKey, setDateKey] = useState(initial?.dateKey ?? today)
  const [projectId, setProjectId] = useState(initial?.ledgerProjectId ?? '')
  const [kind, setKind] = useState<EntryKind>(initial?.kind ?? 'api_token')
  const [quantity, setQuantity] = useState(initial ? String(initial.quantity) : '')
  const [remark, setRemark] = useState(initial?.remark ?? '')
  const [actorUserId, setActorUserId] = useState(initial?.actorUserId ?? selfId)
  const [options, setOptions] = useState<ProjectOption[]>([])
  const [rates, setRates] = useState<LedgerRates>({ tokenRateCnyPerMillion: 46, jimengCnyPerPoint: 0.1 })
  const [accounts, setAccounts] = useState<Account[]>([])
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [duplicateAck, setDuplicateAck] = useState(false)
  const [largeAck, setLargeAck] = useState(false)
  const loadedRef = useRef(false)

  useDialogDismiss(true, onClose)

  useEffect(() => {
    if (loadedRef.current) return
    loadedRef.current = true
    void (async () => {
      try {
        const response = await apiFetch('/api/compute-ledger/project-options', { cache: 'no-store' })
        if (!response.ok) throw new Error(await readApiErrorMessage(response, '获取项目列表失败'))
        const payload = await response.json() as ProjectOptionsResponse
        const recent = readRecent()
        const sorted = [...payload.projects].sort((a, b) => {
          const ia = recent.indexOf(a.id)
          const ib = recent.indexOf(b.id)
          return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
        })
        setOptions(sorted)
        setRates(payload.rates)
        setProjectId((current) => current || (initial ? '' : sorted[0]?.id ?? ''))
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : '获取项目列表失败')
      }
    })()
    if (isAdmin) {
      void (async () => {
        try {
          const response = await apiFetch(`/api/admin/accounts?refresh=${Date.now()}`, { cache: 'no-store' })
          if (!response.ok) return
          const payload = await response.json() as { accounts?: Array<{ id: string; username: string; status: string; isPlatformAdmin?: boolean }> }
          const active = (payload.accounts ?? [])
            .filter((account) => account.status === 'active' && !account.isPlatformAdmin)
            .map((account) => ({ id: account.id, name: account.username }))
          setAccounts(active)
        } catch {
          /* 代谁记下拉失败不阻塞录入 */
        }
      })()
    }
  }, [isAdmin, initial])

  const rate = kind === 'api_token' ? rates.tokenRateCnyPerMillion : kind === 'jimeng_points' ? rates.jimengCnyPerPoint : 1
  const qtyNum = Number(quantity)
  const qtyValid = Number.isFinite(qtyNum) && quantity.trim() !== ''
  const previewMicros = qtyValid ? computeEntryAmountMicros(kind, qtyNum, rate) : null
  const previewCny = previewMicros == null ? null : fromMicros(previewMicros)

  const quantityError = useMemo(() => {
    if (!qtyValid) return ''
    if (kind === 'api_token') {
      if (!Number.isInteger(qtyNum) || qtyNum < 1 || qtyNum > 1e12) return 'API token 数量必须是 1 到 1e12 的整数。'
    } else if (kind === 'jimeng_points') {
      if (qtyNum < 0.01 || qtyNum > 1e9 || Math.round(qtyNum * 100) / 100 !== qtyNum) return '即梦积分必须在 0.01 到 1e9 之间，最多 2 位小数。'
    } else if (isAdmin) {
      if (qtyNum === 0) return '金额不能为 0。'
      if (qtyNum < 0 && !remark.trim()) return '负数校准条目必须填写备注。'
    } else if (qtyNum < 0.01 || qtyNum > 1e7) {
      return '金额必须在 0.01 到 1e7 元之间。'
    }
    return ''
  }, [kind, qtyNum, qtyValid, isAdmin, remark])

  const resolvedActor = isAdmin ? actorUserId : selfId
  const duplicate = useMemo(() => existingEntries.some((entry) =>
    entry.voidedAt == null
    && entry.dateKey === dateKey
    && entry.ledgerProjectId === projectId
    && entry.kind === kind
    && (entry.actorUserId ?? '') === resolvedActor
  ), [existingEntries, dateKey, projectId, kind, resolvedActor])

  const large = previewCny != null && previewCny > SANITY_MAX_CNY
  const dateValid = dateKey >= minDate && dateKey <= today
  const canSubmit = !!projectId && dateValid && qtyValid && !quantityError && !submitting
    && (!duplicate || duplicateAck)
    && (!large || (isAdmin && largeAck))

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return
    setSubmitting(true)
    setError('')
    try {
      const body = {
        ledgerProjectId: projectId,
        dateKey,
        kind,
        quantity: qtyNum,
        remark: remark.trim() ? remark.trim() : null,
        actorUserId: isAdmin ? actorUserId : null,
        confirmLarge: isAdmin && largeAck,
      }
      const url = initial ? `/api/compute-ledger/entries/${initial.id}` : '/api/compute-ledger/entries'
      const response = await apiFetch(url, {
        method: initial ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!response.ok) throw new Error(await readApiErrorMessage(response, '记录失败'))
      const entry = await response.json() as EntryView
      pushRecent(projectId)
      onSaved(entry)
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '记录失败')
    } finally {
      setSubmitting(false)
    }
  }, [canSubmit, projectId, dateKey, kind, qtyNum, remark, isAdmin, actorUserId, largeAck, initial, onSaved, onClose])

  const rateHint = kind === 'api_token'
    ? `单价 ${rates.tokenRateCnyPerMillion} 元/百万 token`
    : kind === 'jimeng_points'
      ? `单价 ${rates.jimengCnyPerPoint} 元/积分`
      : '直接填元'

  return (
    <ViewportDialogLayer>
      <div className="fos-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
        <div className="fos-dialog" style={{ maxWidth: 560 }} role="dialog" aria-modal="true" aria-label={initial ? '编辑记录' : '记一笔'}>
          <div className="fos-dialog-head">
            <div className="fos-dialog-title text-white">{initial ? '编辑记录' : '记一笔'}</div>
            <button type="button" className="fos-dialog-x" aria-label="关闭" onClick={onClose}><AppIcon name="close" className="h-4 w-4" /></button>
          </div>
          <div className="fos-dialog-body" style={{ display: 'grid', gap: 14 }}>
            <p className="text-[11px] leading-5 text-white/40">在平台内生成的花费已经自动记账，这里只记平台之外的花费，否则会重复计算。</p>
            {initial ? <p className="text-[11px] text-white/40">编辑会作废原条目并新建一条，单价按当前汇率重新计算。</p> : null}

            <label className="grid gap-1.5">
              <span className="text-[12px] text-white/55">日期</span>
              <input type="date" className="fos-input" value={dateKey} min={minDate} max={today} autoFocus onChange={(event) => { setDateKey(event.target.value); setDuplicateAck(false) }} />
            </label>

            <label className="grid gap-1.5">
              <span className="text-[12px] text-white/55">项目</span>
              <select className="fos-input" value={projectId} onChange={(event) => { setProjectId(event.target.value); setDuplicateAck(false) }}>
                <option value="">请选择项目</option>
                {options.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
              </select>
            </label>

            <div className="grid gap-1.5">
              <span className="text-[12px] text-white/55">类型</span>
              <div className="fos-seg" role="group" aria-label="条目类型">
                {(['api_token', 'jimeng_points', 'other_cny'] as EntryKind[]).map((item) => (
                  <button key={item} type="button" className={`fos-seg-opt${kind === item ? ' active' : ''}`} aria-pressed={kind === item} onClick={() => { setKind(item); setDuplicateAck(false); setLargeAck(false) }}>
                    {ENTRY_KIND_LABELS[item]}
                  </button>
                ))}
              </div>
            </div>

            <label className="grid gap-1.5">
              <span className="text-[12px] text-white/55">数量（{ENTRY_KIND_UNITS[kind]}）</span>
              <input type="number" className="fos-input" value={quantity} step={kind === 'api_token' ? 1 : 0.01} onChange={(event) => { setQuantity(event.target.value); setLargeAck(false) }} />
              {quantityError ? <span className="text-[11px] text-[var(--fos-danger-text)]">{quantityError}</span> : null}
            </label>

            <div className="rounded-[9px] border border-white/[.07] bg-white/[.03] px-3 py-2 text-[12px] text-white/70">
              折合金额：<strong className="text-white">{previewCny == null ? '—' : `≈ ${formatCny(previewCny)}`}</strong>
              <span className="ml-2 text-white/40">（{rateHint}，仅供参考，服务端重算）</span>
            </div>

            <label className="grid gap-1.5">
              <span className="text-[12px] text-white/55">备注</span>
              <input type="text" className="fos-input" value={remark} maxLength={500} placeholder="例：和婚介拆账，婚介 65 + 悬疑 131" onChange={(event) => setRemark(event.target.value)} />
            </label>

            {isAdmin ? (
              <label className="grid gap-1.5">
                <span className="text-[12px] text-white/55">代谁记</span>
                <select className="fos-input" value={actorUserId} onChange={(event) => { setActorUserId(event.target.value); setDuplicateAck(false) }}>
                  {accounts.length === 0 ? <option value={selfId}>我自己</option> : null}
                  {accounts.map((account) => <option key={account.id} value={account.id}>{account.id === selfId ? `${account.name}（我）` : account.name}</option>)}
                </select>
              </label>
            ) : null}

            {duplicate && !duplicateAck ? (
              <div className="flex items-center justify-between gap-3 rounded-[9px] border border-[var(--fos-warning)]/40 bg-[var(--fos-warning)]/10 px-3 py-2 text-[12px] text-white/80">
                <span>你今天已为这个项目记过一条 {ENTRY_KIND_LABELS[kind]}，确定再加一条？</span>
                <button type="button" className="fos-btn fos-btn-sm fos-btn-soft shrink-0" onClick={() => setDuplicateAck(true)}>仍然记录</button>
              </div>
            ) : null}

            {large ? (
              <div className="flex items-center justify-between gap-3 rounded-[9px] border border-[var(--fos-warning)]/40 bg-[var(--fos-warning)]/10 px-3 py-2 text-[12px] text-white/80">
                <span>单条金额超过 {formatCny(SANITY_MAX_CNY)}，请核对数量。</span>
                {isAdmin ? <button type="button" className="fos-btn fos-btn-sm fos-btn-soft shrink-0" onClick={() => setLargeAck(true)}>{largeAck ? '已确认' : '确认放行'}</button> : null}
              </div>
            ) : null}

            {error ? <div role="alert" className="rounded-[9px] border border-[var(--fos-danger)]/40 bg-[var(--fos-danger)]/10 px-3 py-2 text-[12px] text-[var(--fos-danger-text)]">{error}</div> : null}
          </div>
          <div className="fos-dialog-foot">
            <button type="button" className="fos-btn fos-btn-ghost fos-btn-lg" onClick={onClose}>取消</button>
            <button type="button" className="fos-btn fos-btn-primary fos-btn-lg" disabled={!canSubmit} onClick={() => void handleSubmit()}>
              {submitting ? '记录中…' : initial ? '保存修改' : '记录'}
            </button>
          </div>
        </div>
      </div>
    </ViewportDialogLayer>
  )
}
