'use client'

/**
 * 成员「我的算力」（§11.8）：只展示 actor=我 的日报 + 我的手填条目（带 editable）。
 * 不展示预算、项目累计、别人的数据（D4）。记一笔 / 编辑 / 作废共用 RecordEntryDialog。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { AppIcon } from '@/components/ui/icons'
import { statTileStyle } from '@/components/workspace/stat-tile-hue'
import { apiFetch } from '@/lib/api-fetch'
import { readApiErrorMessage } from '@/lib/api/read-error-message'
import { createLatestRequestTracker } from '@/lib/api/latest-request'
import { addDaysKey, todayKey } from '@/lib/compute-ledger/calc'
import { FosShell } from './FosShell'
import { RecordEntryDialog } from './compute-ledger/RecordEntryDialog'
import { ENTRY_KIND_LABELS, formatCny, formatDateShort, formatMoney, formatPoints, formatQuantity, formatTokens } from './compute-ledger/ledger-format'
import type { EntryView, MeResponse } from './compute-ledger/ledger-types'

type RangeKey = '14d' | '30d' | 'month'
const RANGE_LABELS: Record<RangeKey, string> = { '14d': '近 14 天', '30d': '近 30 天', month: '本月' }
const DAY_GRID = '90px minmax(160px,1.6fr) 110px 110px 100px 100px 110px minmax(160px,1.3fr)'
const ENTRY_GRID = '90px minmax(150px,1.5fr) 100px 110px 110px minmax(150px,1.3fr) 130px'

function rangeToDates(range: RangeKey): { from: string; to: string } {
  const today = todayKey()
  if (range === 'month') return { from: `${today.slice(0, 7)}-01`, to: today }
  if (range === '30d') return { from: addDaysKey(today, -29), to: today }
  return { from: addDaysKey(today, -13), to: today }
}

const blank = (value: number, formatted: string) => (value === 0 ? '' : formatted)

export function FosMyLedgerClient() {
  const [range, setRange] = useState<RangeKey>('14d')
  const [data, setData] = useState<MeResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [dialog, setDialog] = useState<{ initial: EntryView | null } | null>(null)
  const [voidConfirmId, setVoidConfirmId] = useState('')
  const [toast, setToast] = useState('')
  const requests = useRef(createLatestRequestTracker())
  const toastTimer = useRef<number | undefined>(undefined)
  const { from, to } = rangeToDates(range)

  const showToast = useCallback((message: string) => {
    setToast(message)
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(''), 3000)
  }, [])
  useEffect(() => () => window.clearTimeout(toastTimer.current), [])

  const load = useCallback(async () => {
    const request = requests.current.begin()
    setLoading(true)
    setError('')
    try {
      const response = await apiFetch(`/api/compute-ledger/me?from=${from}&to=${to}`, { cache: 'no-store' })
      if (!response.ok) throw new Error(await readApiErrorMessage(response, '获取我的算力失败'))
      const payload = await response.json() as MeResponse
      if (!requests.current.isCurrent(request)) return
      setData(payload)
    } catch (cause) {
      if (!requests.current.isCurrent(request)) return
      setError(cause instanceof Error ? cause.message : '获取我的算力失败')
    } finally {
      if (requests.current.isCurrent(request)) setLoading(false)
    }
  }, [from, to])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    const tracker = requests.current
    return () => tracker.invalidate()
  }, [])

  const voidEntry = async (id: string) => {
    try {
      const response = await apiFetch(`/api/compute-ledger/entries/${id}`, { method: 'DELETE' })
      if (!response.ok) throw new Error(await readApiErrorMessage(response, '作废失败'))
      setVoidConfirmId('')
      showToast('已作废')
      void load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '作废失败')
    }
  }

  const referenceYear = Number(todayKey().slice(0, 4))
  const summary = data?.summary
  const tiles: Array<[string, string, string]> = [
    ['total', '区间合计', formatCny(summary?.totalCny)],
    ['visual', '平台自动', formatCny(summary?.platformCny)],
    ['renders', '手填', formatCny(summary?.externalCny)],
  ]

  return (
    <FosShell activeKey="computeLedger">
      <div className="fos-scroll">
        <section className="mx-auto w-full max-w-[1180px] px-8 py-7" data-testid="my-ledger">
          <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className="text-[24px] font-bold text-white">我的算力</h1>
              <p className="mt-1 text-[12px] text-white/40">你在平台内的花费会自动记录；平台之外的花费请在这里补记。只有你和管理员能看到。</p>
            </div>
            <div className="flex items-center gap-3">
              <div className="fos-seg" role="group" aria-label="区间">
                {(Object.keys(RANGE_LABELS) as RangeKey[]).map((item) => (
                  <button key={item} type="button" className={`fos-seg-opt${range === item ? ' active' : ''}`} aria-pressed={range === item} onClick={() => setRange(item)}>{RANGE_LABELS[item]}</button>
                ))}
              </div>
              <button type="button" className="fos-btn fos-btn-primary" onClick={() => setDialog({ initial: null })}><AppIcon name="plus" className="h-4 w-4" />记一笔</button>
            </div>
          </div>

          <div className="mb-5 grid gap-3 sm:grid-cols-3">
            {tiles.map(([key, label, value]) => (
              <div key={label} style={statTileStyle(key)} className="fos-stat-tile px-4 py-3.5">
                <span className="text-[12px] text-white/50">{label}</span>
                <strong className="mt-1.5 block text-[22px] text-[var(--hue)]">{value}</strong>
                <span className="mt-0.5 block h-4 text-[11px] text-white/40" />
              </div>
            ))}
          </div>

          {error ? (
            <div role="alert" className="mb-4 flex items-center justify-between rounded-[9px] border border-white/15 bg-white/[.05] px-4 py-3 text-[12px] text-white/80">
              <span>{error}</span>
              <button type="button" className="underline" onClick={() => void load()}>重试</button>
            </div>
          ) : null}

          <h2 className="mb-2 text-[14px] font-bold text-white">每日明细</h2>
          <section className="overflow-hidden rounded-[12px] border border-white/[.07] bg-[rgb(var(--nori-bg-2))]">
            <div className="overflow-x-auto">
              <div className="min-w-[1000px] w-full" role="table" aria-label="我的每日算力">
                <div role="row" className="grid gap-3 border-b border-white/[.055] px-5 py-2 text-[11px] font-semibold text-white/40 [&>*]:min-w-0" style={{ gridTemplateColumns: DAY_GRID }}>
                  <span role="columnheader">日期</span><span role="columnheader">项目</span><span role="columnheader" className="text-right">平台自动（元）</span>
                  <span role="columnheader" className="text-right">token</span><span role="columnheader" className="text-right">即梦</span>
                  <span role="columnheader" className="text-right">其它（元）</span><span role="columnheader" className="text-right">当天合计（元）</span><span role="columnheader">备注</span>
                </div>
                {loading && !data ? <div className="px-5 py-12 text-center text-[11px] text-white/30">正在加载…</div>
                  : (data?.rows.length ?? 0) === 0 ? <div className="px-5 py-12 text-center text-[11px] text-white/25">该区间没有你的消耗记录</div>
                  : (data?.rows ?? []).map((row, index) => (
                    <div key={`${row.dateKey}-${row.projectId}-${index}`} role="row" className="fos-activity-row grid items-center gap-3 px-5 py-2.5 text-[12px] [&>*]:min-w-0" style={{ gridTemplateColumns: DAY_GRID }}>
                      <span role="cell" className="text-white/75">{formatDateShort(row.dateKey, referenceYear)}</span>
                      <span role="cell" className="truncate text-white">{row.projectName}</span>
                      <span role="cell" className="fos-ledger-num text-white/75">{blank(row.platformCny, formatMoney(row.platformCny))}</span>
                      <span role="cell" className="fos-ledger-num text-white/75">{blank(row.apiTokens, formatTokens(row.apiTokens))}</span>
                      <span role="cell" className="fos-ledger-num text-white/75">{blank(row.jimengPoints, formatPoints(row.jimengPoints))}</span>
                      <span role="cell" className="fos-ledger-num text-white/75">{blank(row.otherCny, formatMoney(row.otherCny))}</span>
                      <span role="cell" className="fos-ledger-num font-semibold text-white">{formatMoney(row.totalCny)}</span>
                      <span role="cell" className="truncate text-white/55" title={row.remark ?? ''}>{row.remark ?? ''}</span>
                    </div>
                  ))}
              </div>
            </div>
          </section>

          <h2 className="mb-2 mt-6 text-[14px] font-bold text-white">我的手填</h2>
          <section className="overflow-hidden rounded-[12px] border border-white/[.07] bg-[rgb(var(--nori-bg-2))]">
            <div className="overflow-x-auto">
              <div className="min-w-[900px] w-full" role="table" aria-label="我的手填条目">
                <div role="row" className="grid gap-3 border-b border-white/[.055] px-5 py-2 text-[11px] font-semibold text-white/40 [&>*]:min-w-0" style={{ gridTemplateColumns: ENTRY_GRID }}>
                  <span role="columnheader">日期</span><span role="columnheader">项目</span><span role="columnheader">类型</span>
                  <span role="columnheader" className="text-right">数量</span><span role="columnheader" className="text-right">金额（元）</span><span role="columnheader">备注</span><span role="columnheader">操作</span>
                </div>
                {(data?.entries.length ?? 0) === 0 ? <div className="px-5 py-10 text-center text-[11px] text-white/25">还没有手填条目</div>
                  : (data?.entries ?? []).map((entry) => (
                    <div key={entry.id} role="row" className="fos-activity-row grid items-center gap-3 px-5 py-2.5 text-[12px] [&>*]:min-w-0" style={{ gridTemplateColumns: ENTRY_GRID }}>
                      <span role="cell" className="text-white/75">{formatDateShort(entry.dateKey, referenceYear)}</span>
                      <span role="cell" className="truncate text-white">{entry.projectName}</span>
                      <span role="cell" className="text-white/60">{ENTRY_KIND_LABELS[entry.kind]}</span>
                      <span role="cell" className="fos-ledger-num text-white/75">{formatQuantity(entry.kind, entry.quantity)}</span>
                      <span role="cell" className="fos-ledger-num text-white">{formatMoney(entry.amountCny)}</span>
                      <span role="cell" className="truncate text-white/55" title={entry.remark ?? ''}>{entry.remark ?? ''}</span>
                      <span role="cell" className="flex items-center gap-1.5">
                        {voidConfirmId === entry.id ? (
                          <>
                            <button type="button" className="fos-btn fos-btn-sm fos-btn-danger" onClick={() => void voidEntry(entry.id)}>确认作废</button>
                            <button type="button" className="fos-btn fos-btn-sm fos-btn-ghost" onClick={() => setVoidConfirmId('')}>返回</button>
                          </>
                        ) : (
                          <>
                            <button type="button" className="fos-btn fos-btn-sm fos-btn-ghost" disabled={!entry.editable} title={entry.editable ? '' : '只能修改最近 14 天内、自己记的条目'} onClick={() => setDialog({ initial: entry })}>编辑</button>
                            <button type="button" className="fos-btn fos-btn-sm fos-btn-ghost" disabled={!entry.editable} title={entry.editable ? '' : '只能修改最近 14 天内、自己记的条目'} onClick={() => setVoidConfirmId(entry.id)}>作废</button>
                          </>
                        )}
                      </span>
                    </div>
                  ))}
              </div>
            </div>
          </section>
          <p className="mt-3 text-[11px] text-white/38">不含资产库、工具箱等无项目归属的消耗。在平台内生成的花费已自动记账，这里只补记平台之外的花费。</p>
        </section>
      </div>

      {dialog ? (
        <RecordEntryDialog isAdmin={false} initial={dialog.initial} existingEntries={data?.entries ?? []} onClose={() => setDialog(null)}
          onSaved={(entry) => { showToast(`已记录 ${formatCny(entry.amountCny)}`); void load() }} />
      ) : null}
      {toast ? <div className="fixed bottom-6 left-1/2 z-[100200] -translate-x-1/2 rounded-[9px] border border-white/[.12] bg-[rgb(var(--nori-bg-3))] px-4 py-2 text-[12px] text-white shadow-lg" role="status">{toast}</div> : null}
    </FosShell>
  )
}
