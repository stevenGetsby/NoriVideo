'use client'

/**
 * 算力表（§11.2）：overview 全量返回，排序 / 名称搜索在前端（useMemo），
 * from/to/category/status/includeArchived 才发请求。展开行显示个人明细（不前端求和，R5）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AppIcon } from '@/components/ui/icons'
import { statTileStyle } from '@/components/workspace/stat-tile-hue'
import { apiFetch } from '@/lib/api-fetch'
import { readApiErrorMessage } from '@/lib/api/read-error-message'
import { createLatestRequestTracker } from '@/lib/api/latest-request'
import { CATEGORIES, CATEGORY_LABELS, PROJECT_STATUSES, STATUS_LABELS, addDaysKey, todayKey, type Category, type ProjectStatus } from '@/lib/compute-ledger/calc'
import { categoryLabel, formatCny, formatDateShort, formatMoney, formatRatio, levelText, statusLabel } from './ledger-format'
import { LedgerProjectDrawer } from './LedgerProjectDrawer'
import type { LedgerPanelProps, OverviewResponse, OverviewRow } from './ledger-types'

type RangeKey = 'all' | 'month' | '30d' | 'custom'
type SortKey = 'name' | 'totalCny' | 'remainingCny' | 'usageRatio' | 'startDate'
type SortDir = 'asc' | 'desc'

const GRID = 'fos-ledger-grid'
const RANGE_LABELS: Record<RangeKey, string> = { all: '全部', month: '本月', '30d': '近 30 天', custom: '自定义' }

function rangeToDates(range: RangeKey, customFrom: string, customTo: string): { from: string | null; to: string | null } {
  const today = todayKey()
  if (range === 'month') return { from: `${today.slice(0, 7)}-01`, to: today }
  if (range === '30d') return { from: addDaysKey(today, -29), to: today }
  if (range === 'custom') return { from: customFrom || null, to: customTo || null }
  return { from: null, to: null }
}

export function LedgerOverviewTable({ refreshToken, onStatus }: LedgerPanelProps) {
  const [data, setData] = useState<OverviewResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [range, setRange] = useState<RangeKey>('all')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [category, setCategory] = useState<Category | ''>('')
  const [status, setStatus] = useState<ProjectStatus | ''>('')
  const [includeArchived, setIncludeArchived] = useState(false)
  const [q, setQ] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('totalCny')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [expandedId, setExpandedId] = useState('')
  const [exporting, setExporting] = useState(false)
  const [drawer, setDrawer] = useState<{ mode: 'create' | 'edit'; row: OverviewRow | null } | null>(null)
  const requests = useRef(createLatestRequestTracker())

  const { from, to } = rangeToDates(range, customFrom, customTo)

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQ(q), 300)
    return () => window.clearTimeout(timer)
  }, [q])

  const buildQuery = useCallback((extra: Record<string, string> = {}) => {
    const params = new URLSearchParams()
    if (from) params.set('from', from)
    if (to) params.set('to', to)
    if (category) params.set('category', category)
    if (status) params.set('status', status)
    if (includeArchived) params.set('includeArchived', '1')
    for (const [key, value] of Object.entries(extra)) params.set(key, value)
    return params.toString()
  }, [from, to, category, status, includeArchived])

  const load = useCallback(async (refresh = false) => {
    const request = requests.current.begin()
    setLoading(true)
    try {
      const query = buildQuery(refresh ? { refresh: '1' } : {})
      const response = await apiFetch(`/api/admin/compute-ledger/overview?${query}`, { cache: 'no-store' })
      if (!response.ok) throw new Error(await readApiErrorMessage(response, '获取算力表失败'))
      const payload = await response.json() as OverviewResponse
      if (!requests.current.isCurrent(request)) return
      setData(payload)
      onStatus({ billingMode: payload.sync.billingMode, complete: payload.sync.complete, syncedThroughDate: payload.sync.syncedThroughDate, error: '' })
    } catch (cause) {
      if (!requests.current.isCurrent(request)) return
      onStatus({ error: cause instanceof Error ? cause.message : '获取算力表失败' })
    } finally {
      if (requests.current.isCurrent(request)) setLoading(false)
    }
  }, [buildQuery, onStatus])

  useEffect(() => { void load() }, [load, refreshToken])
  useEffect(() => {
    const tracker = requests.current
    return () => tracker.invalidate()
  }, [])

  const rows = useMemo(() => {
    const list = (data?.rows ?? []).filter((row) => !debouncedQ || row.name.toLowerCase().includes(debouncedQ.toLowerCase()))
    const dir = sortDir === 'asc' ? 1 : -1
    return [...list].sort((a, b) => {
      if (sortKey === 'name') return a.name.localeCompare(b.name, 'zh-Hans-CN') * dir
      if (sortKey === 'startDate') return (a.startDate ?? '').localeCompare(b.startDate ?? '') * dir
      const av = a[sortKey] ?? -Infinity
      const bv = b[sortKey] ?? -Infinity
      return (av - bv) * dir || a.name.localeCompare(b.name, 'zh-Hans-CN')
    })
  }, [data, debouncedQ, sortKey, sortDir])

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) { setSortDir((current) => (current === 'asc' ? 'desc' : 'asc')); return }
    setSortKey(key)
    setSortDir(key === 'name' ? 'asc' : 'desc')
  }

  const exportCsv = async () => {
    if (exporting) return
    setExporting(true)
    try {
      const response = await apiFetch(`/api/admin/compute-ledger/overview?${buildQuery({ format: 'csv' })}`, { cache: 'no-store' })
      if (!response.ok) throw new Error(await readApiErrorMessage(response, '导出失败'))
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `compute-ledger-overview-${from ?? 'all'}_${to ?? 'all'}.csv`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
    } catch (cause) {
      onStatus({ error: cause instanceof Error ? cause.message : '导出失败' })
    } finally {
      setExporting(false)
    }
  }

  const totals = data?.totals
  const budgetedCount = (data?.rows ?? []).filter((row) => row.budgetCny != null && row.budgetCny > 0).length
  const referenceYear = Number(todayKey().slice(0, 4))
  const tiles: Array<[string, string, string, string?]> = [
    ['total', '累计总消耗', formatCny(totals?.totalCny)],
    ['workflow', '所选区间消耗', formatCny(totals?.periodCny)],
    ['visual', '平台自动', formatCny(totals?.platformCny)],
    ['renders', '外部手填', formatCny(totals?.externalCny)],
    ['quality', '预算合计', formatCny(totals?.budgetCny), `${budgetedCount} 个项目设了预算`],
    ['failed', '超支 / 预警', `${totals?.overCount ?? 0} 超支 · ${totals?.warnCount ?? 0} 预警`],
  ]

  const sortHeader = (key: SortKey, label: string, right = false) => (
    <button type="button" role="columnheader" aria-sort={sortKey === key ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={`fos-activity-sort${right ? ' is-right' : ''}${sortKey === key ? ' active' : ''}`} onClick={() => toggleSort(key)}>
      <span className="truncate">{label}</span>
      {sortKey === key ? <span aria-hidden>{sortDir === 'asc' ? '↑' : '↓'}</span> : null}
    </button>
  )

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="fos-seg" role="group" aria-label="区间">
          {(Object.keys(RANGE_LABELS) as RangeKey[]).map((item) => (
            <button key={item} type="button" className={`fos-seg-opt${range === item ? ' active' : ''}`} aria-pressed={range === item} onClick={() => setRange(item)}>{RANGE_LABELS[item]}</button>
          ))}
        </div>
        {range === 'custom' ? (
          <span className="flex items-center gap-2">
            <input type="date" className="fos-input" style={{ width: 150 }} value={customFrom} max={customTo || undefined} onChange={(event) => setCustomFrom(event.target.value)} />
            <span className="text-white/40">—</span>
            <input type="date" className="fos-input" style={{ width: 150 }} value={customTo} min={customFrom || undefined} onChange={(event) => setCustomTo(event.target.value)} />
          </span>
        ) : null}
        <input type="search" className="fos-input" style={{ width: 200 }} placeholder="搜索项目名" value={q} onChange={(event) => setQ(event.target.value)} />
        <select className="fos-input" style={{ width: 130 }} value={category} onChange={(event) => setCategory(event.target.value as Category | '')}>
          <option value="">全部类型</option>
          {CATEGORIES.map((item) => <option key={item} value={item}>{CATEGORY_LABELS[item]}</option>)}
        </select>
        <select className="fos-input" style={{ width: 120 }} value={status} onChange={(event) => setStatus(event.target.value as ProjectStatus | '')}>
          <option value="">全部状态</option>
          {PROJECT_STATUSES.map((item) => <option key={item} value={item}>{STATUS_LABELS[item]}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-[12px] text-white/60">
          <input type="checkbox" checked={includeArchived} onChange={(event) => setIncludeArchived(event.target.checked)} />显示已归档
        </label>
        <span className="ml-auto flex items-center gap-2">
          <button type="button" className="fos-btn" onClick={() => void load(true)}><AppIcon name="refresh" className="h-4 w-4" />刷新</button>
          <button type="button" className="fos-btn" disabled={exporting || !data} onClick={() => void exportCsv()}><AppIcon name="download" className="h-4 w-4" />{exporting ? '导出中…' : '导出 CSV'}</button>
          <button type="button" className="fos-btn fos-btn-primary" onClick={() => setDrawer({ mode: 'create', row: null })}><AppIcon name="plus" className="h-4 w-4" />新建项目</button>
        </span>
      </div>

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        {tiles.map(([key, label, value, hint]) => (
          <div key={label} style={statTileStyle(key)} className="fos-stat-tile px-4 py-3.5">
            <span className="text-[12px] text-white/50">{label}</span>
            <strong className="mt-1.5 block text-[20px] text-[var(--hue)]">{value}</strong>
            <span className="mt-0.5 block h-4 text-[11px] text-white/40">{hint ?? ''}</span>
          </div>
        ))}
      </div>

      <section className="overflow-hidden rounded-[12px] border border-white/[.07] bg-[rgb(var(--nori-bg-2))]">
        <div className="overflow-x-auto">
          <div className="min-w-[1180px] w-full" role="table" aria-label="算力表">
            <div role="row" className={`grid ${GRID} gap-3 border-b border-white/[.055] px-5 py-2 text-[11px] font-semibold text-white/40 [&>*]:min-w-0`}>
              {sortHeader('name', '项目')}
              <span role="columnheader">类型</span>
              {sortHeader('totalCny', '总消耗（元）', true)}
              <span role="columnheader" className="text-right">算力预算（元）</span>
              {sortHeader('remainingCny', '预算余额（元）', true)}
              {sortHeader('usageRatio', '使用率', true)}
              <span role="columnheader" className="text-right">工期（天）</span>
              {sortHeader('startDate', '开工日期', true)}
              <span role="columnheader" className="text-right">时长（分钟）</span>
              <span role="columnheader" className="text-right">元 / 分钟</span>
              <span role="columnheader">完成情况</span>
            </div>
            {loading && !data ? (
              <div className="px-5 py-12 text-center text-[11px] text-white/30">正在加载算力表…</div>
            ) : rows.length === 0 ? (
              <div className="px-5 py-12 text-center text-[11px] leading-6 text-white/30">
                还没有账本项目。平台里一旦有付费调用，会自动出现；也可以点「新建项目」记录平台之外的项目。
              </div>
            ) : rows.map((row) => (
              <div key={row.projectId}>
                <div role="row" tabIndex={0} aria-label={`展开 ${row.name} 的个人明细`}
                  className={`fos-activity-row grid ${GRID} cursor-pointer items-center gap-3 px-5 py-3 [&>*]:min-w-0${expandedId === row.projectId ? ' active' : ''}`}
                  onClick={() => setExpandedId((current) => (current === row.projectId ? '' : row.projectId))}
                  onKeyDown={(event) => { if (event.key === 'Enter') setExpandedId((current) => (current === row.projectId ? '' : row.projectId)) }}>
                  <span role="cell" className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate text-[13px] font-semibold text-white">{row.name}{row.duplicateName ? ` · #${row.projectId.slice(0, 6)}` : ''}</span>
                    {row.workState === 'external' ? <span className="fos-ledger-tag">外部</span> : null}
                    {row.workState === 'recycled' ? <span className="fos-ledger-tag">已回收</span> : null}
                    {row.workState === 'purged' ? <span className="fos-ledger-tag" title="作品已从平台删除，历史花费仍保留">已删除</span> : null}
                    {row.archived ? <span className="fos-ledger-tag">已归档</span> : null}
                    <button type="button" className="fos-ledger-edit" aria-label={`编辑 ${row.name}`} onClick={(event) => { event.stopPropagation(); setDrawer({ mode: 'edit', row }) }}>
                      <AppIcon name="edit" className="h-3.5 w-3.5" />
                    </button>
                  </span>
                  <span role="cell" className="text-[12px] text-white/70">{categoryLabel(row.category)}</span>
                  <span role="cell" className="fos-ledger-num text-[13px] text-white" title={`平台自动 ${formatCny(row.platformCny)} + 手填 ${formatCny(row.externalCny)}`}>{formatMoney(row.totalCny)}</span>
                  <span role="cell" className="fos-ledger-num text-[12px] text-white/70">{row.budgetCny == null ? <span className="text-white/30">未设预算</span> : formatMoney(row.budgetCny)}</span>
                  <span role="cell" className={`fos-ledger-num text-[12px] ${row.remainingCny != null && row.remainingCny < 0 ? 'text-[var(--fos-danger-text)]' : 'text-white/70'}`}>
                    {row.remainingCny == null ? '—' : row.remainingCny < 0 ? `超支 ${formatMoney(-row.remainingCny)}` : formatMoney(row.remainingCny)}
                  </span>
                  <span role="cell" className="flex items-center justify-end gap-2">
                    {row.level !== 'none' && row.usageRatio != null ? (
                      <span className="fos-ledger-bar" data-level={row.level}><span style={{ width: `${Math.min(row.usageRatio, 1) * 100}%` }} /></span>
                    ) : null}
                    <span className="fos-ledger-num text-[12px] text-white/70">{row.usageRatio == null ? '—' : formatRatio(row.usageRatio)}</span>
                  </span>
                  <span role="cell" className="fos-ledger-num text-[12px] text-white/70">{row.elapsedDays ?? '—'}</span>
                  <span role="cell" className="fos-ledger-num text-[12px] text-white/70">{formatDateShort(row.startDate, referenceYear)}</span>
                  <span role="cell" className="fos-ledger-num text-[12px] text-white/70">{row.durationMinutes == null ? '—' : formatMoney(row.durationMinutes)}</span>
                  <span role="cell" className="fos-ledger-num text-[12px] text-white/70">{row.costPerMinute == null ? '—' : formatMoney(row.costPerMinute)}</span>
                  <span role="cell" className="text-[12px] text-white/70">
                    {row.totalEpisodes != null && row.totalEpisodes > 0
                      ? `${row.doneEpisodes ?? 0}/${row.totalEpisodes}（${row.completionRatio == null ? '0' : Math.round(row.completionRatio * 100)}%）`
                      : <span className="fos-ledger-tag">{statusLabel(row.status)}</span>}
                  </span>
                </div>
                {expandedId === row.projectId ? (
                  <div className="border-b border-white/[.055] bg-white/[.02] px-5 py-3">
                    <div className="grid grid-cols-[1.5fr_1fr_1fr_1fr] gap-3 text-[11px] font-semibold text-white/40">
                      <span>姓名</span><span className="text-right">区间金额（元）</span><span className="text-right">累计金额（元）</span><span className="text-right">占该项目累计</span>
                    </div>
                    {row.byActor.map((actor) => (
                      <div key={actor.actorKey} className="grid grid-cols-[1.5fr_1fr_1fr_1fr] gap-3 py-1 text-[12px] text-white/75">
                        <span className="truncate">{actor.name}</span>
                        <span className="fos-ledger-num">{formatMoney(actor.periodCny)}</span>
                        <span className="fos-ledger-num">{formatMoney(actor.totalCny)}</span>
                        <span className="fos-ledger-num">{row.totalCny > 0 ? formatRatio(actor.totalCny / row.totalCny) : '—'}</span>
                      </div>
                    ))}
                    <div className="grid grid-cols-[1.5fr_1fr_1fr_1fr] gap-3 border-t border-white/[.07] pt-1 text-[12px] font-semibold text-white">
                      <span>合计</span><span className="fos-ledger-num">{formatMoney(row.periodCny)}</span><span className="fos-ledger-num">{formatMoney(row.totalCny)}</span><span className="fos-ledger-num">100%</span>
                    </div>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      </section>
      <p className="mt-3 text-[11px] text-white/38">不含资产库、工具箱等无项目归属的消耗。{data ? `平台自动记账同步到 ${data.sync.syncedThroughDate ?? '—'}。` : ''}</p>

      {drawer ? (
        <LedgerProjectDrawer mode={drawer.mode} row={drawer.row} onClose={() => setDrawer(null)} onSaved={() => void load(true)} />
      ) : null}
    </div>
  )
}
