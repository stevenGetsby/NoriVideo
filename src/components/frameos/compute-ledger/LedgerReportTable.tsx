'use client'

/**
 * 日报 / 周 / 三日 共用表（§11.3）。列合计由后端 footer 给，前端不再相加（R5）。
 * 项目 / 提交人下拉来自 overview（含归档），同时把 overview 的同步状态汇报给外壳驱动横幅。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AppIcon } from '@/components/ui/icons'
import { apiFetch } from '@/lib/api-fetch'
import { readApiErrorMessage } from '@/lib/api/read-error-message'
import { createLatestRequestTracker } from '@/lib/api/latest-request'
import { addDaysKey, todayKey, weekStartKey } from '@/lib/compute-ledger/calc'
import { categoryLabel, formatCny, formatDateShort, formatMoney, formatPoints, formatTokens } from './ledger-format'
import type { DayReportRow, LedgerPanelProps, OverviewResponse, ReportResponse, ReportView, TriReportRow, WeekReportRow } from './ledger-types'

const PAGE_SIZE = 200

function defaultRange(view: ReportView): { from: string; to: string } {
  const today = todayKey()
  if (view === 'week') return { from: addDaysKey(weekStartKey(today), -49), to: today }
  return { from: addDaysKey(today, -29), to: today }
}

const blank = (value: number, formatted: string) => (value === 0 ? '' : formatted)

export function LedgerReportTable({ view, refreshToken, onStatus }: LedgerPanelProps & { view: ReportView }) {
  const initial = defaultRange(view)
  const [from, setFrom] = useState(initial.from)
  const [to, setTo] = useState(initial.to)
  const [projectId, setProjectId] = useState('')
  const [actorKey, setActorKey] = useState('')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<ReportResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [expanded, setExpanded] = useState('')
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>([])
  const [actors, setActors] = useState<Array<{ key: string; name: string }>>([])
  const requests = useRef(createLatestRequestTracker())
  const optionsLoaded = useRef(false)

  useEffect(() => {
    const next = defaultRange(view)
    setFrom(next.from)
    setTo(next.to)
    setPage(1)
    setExpanded('')
  }, [view])

  useEffect(() => {
    if (optionsLoaded.current) return
    optionsLoaded.current = true
    void (async () => {
      try {
        const response = await apiFetch('/api/admin/compute-ledger/overview?includeArchived=1', { cache: 'no-store' })
        if (!response.ok) return
        const payload = await response.json() as OverviewResponse
        setProjects(payload.rows.map((row) => ({ id: row.projectId, name: row.name })))
        const actorMap = new Map<string, string>()
        for (const row of payload.rows) for (const actor of row.byActor) actorMap.set(actor.actorKey, actor.name)
        setActors([...actorMap.entries()].map(([key, name]) => ({ key, name })))
        onStatus({ billingMode: payload.sync.billingMode, complete: payload.sync.complete, syncedThroughDate: payload.sync.syncedThroughDate })
      } catch {
        /* 下拉选项加载失败不阻塞报表 */
      }
    })()
  }, [onStatus])

  const buildQuery = useCallback((extra: Record<string, string> = {}) => {
    const params = new URLSearchParams({ view })
    if (from) params.set('from', from)
    if (to) params.set('to', to)
    if (projectId) params.set('projectId', projectId)
    if (actorKey) params.set('actorKey', actorKey)
    if (view === 'day') { params.set('page', String(page)); params.set('pageSize', String(PAGE_SIZE)) }
    for (const [key, value] of Object.entries(extra)) params.set(key, value)
    return params.toString()
  }, [view, from, to, projectId, actorKey, page])

  const load = useCallback(async () => {
    const request = requests.current.begin()
    setLoading(true)
    try {
      const response = await apiFetch(`/api/admin/compute-ledger/report?${buildQuery()}`, { cache: 'no-store' })
      if (!response.ok) throw new Error(await readApiErrorMessage(response, '获取报表失败'))
      const payload = await response.json() as ReportResponse
      if (!requests.current.isCurrent(request)) return
      setData(payload)
      onStatus({ error: '' })
    } catch (cause) {
      if (!requests.current.isCurrent(request)) return
      onStatus({ error: cause instanceof Error ? cause.message : '获取报表失败' })
    } finally {
      if (requests.current.isCurrent(request)) setLoading(false)
    }
  }, [buildQuery, onStatus])

  useEffect(() => { void load() }, [load, refreshToken])
  useEffect(() => {
    const tracker = requests.current
    return () => tracker.invalidate()
  }, [])

  const exportCsv = async () => {
    if (exporting) return
    setExporting(true)
    try {
      const response = await apiFetch(`/api/admin/compute-ledger/report?${buildQuery({ format: 'csv' })}`, { cache: 'no-store' })
      if (!response.ok) throw new Error(await readApiErrorMessage(response, '导出失败'))
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `compute-ledger-${view}-${from}_${to}.csv`
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

  const referenceYear = Number(todayKey().slice(0, 4))
  const totalPages = data && view === 'day' ? Math.max(1, Math.ceil(data.totalRows / data.pageSize)) : 1
  const dayRows = (data?.rows ?? []) as DayReportRow[]
  const weekRows = (data?.rows ?? []) as WeekReportRow[]
  const triRows = (data?.rows ?? []) as TriReportRow[]

  const dayGrid = '90px minmax(150px,1.5fr) 70px 100px 100px 100px 90px 90px 90px 90px 100px 100px minmax(150px,1.3fr)'

  const filterBar = (
    <div className="mb-4 flex flex-wrap items-center gap-3">
      <span className="flex items-center gap-2">
        <input type="date" className="fos-input" style={{ width: 150 }} value={from} max={to} onChange={(event) => { setFrom(event.target.value); setPage(1) }} />
        <span className="text-white/40">—</span>
        <input type="date" className="fos-input" style={{ width: 150 }} value={to} min={from} onChange={(event) => { setTo(event.target.value); setPage(1) }} />
      </span>
      <select className="fos-input" style={{ width: 180 }} value={projectId} onChange={(event) => { setProjectId(event.target.value); setPage(1) }}>
        <option value="">全部项目</option>
        {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
      </select>
      <select className="fos-input" style={{ width: 150 }} value={actorKey} onChange={(event) => { setActorKey(event.target.value); setPage(1) }}>
        <option value="">全部提交人</option>
        {actors.map((actor) => <option key={actor.key} value={actor.key}>{actor.name}</option>)}
      </select>
      <button type="button" className="fos-btn ml-auto" disabled={exporting || !data} onClick={() => void exportCsv()}>
        <AppIcon name="download" className="h-4 w-4" />{exporting ? '导出中…' : '导出 CSV'}
      </button>
    </div>
  )

  const footer = (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/[.055] px-5 py-3 text-[12px] text-white/70">
      <span>整个筛选结果合计：<strong className="text-white">{formatCny(data?.footer.totalCny)}</strong></span>
      {view === 'day' ? (
        <span className="flex items-center gap-2">
          <button type="button" className="fos-btn fos-btn-sm" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>上一页</button>
          <span>第 {data?.page ?? 1} / {totalPages} 页 · 共 {data?.totalRows ?? 0} 行</span>
          <button type="button" className="fos-btn fos-btn-sm" disabled={page >= totalPages} onClick={() => setPage((current) => current + 1)}>下一页</button>
        </span>
      ) : null}
    </div>
  )

  return (
    <div>
      {filterBar}
      <section className="overflow-hidden rounded-[12px] border border-white/[.07] bg-[rgb(var(--nori-bg-2))]">
        <div className="overflow-x-auto">
          {view === 'day' ? (
            <div className="min-w-[1280px] w-full" role="table" aria-label="每日算力日报">
              <div role="row" className="grid gap-3 border-b border-white/[.055] px-5 py-2 text-[11px] font-semibold text-white/40 [&>*]:min-w-0" style={{ gridTemplateColumns: dayGrid }}>
                <span role="columnheader">日期</span><span role="columnheader">项目</span><span role="columnheader">类型</span><span role="columnheader">周区间</span><span role="columnheader">提交人</span>
                <span role="columnheader" className="text-right">API token</span><span role="columnheader" className="text-right">API 折元</span>
                <span role="columnheader" className="text-right">即梦积分</span><span role="columnheader" className="text-right">即梦折元</span>
                <span role="columnheader" className="text-right">其它（元）</span><span role="columnheader" className="text-right">平台自动（元）</span>
                <span role="columnheader" className="text-right">当天合计（元）</span><span role="columnheader">备注</span>
              </div>
              {loading && !data ? <div className="px-5 py-12 text-center text-[11px] text-white/30">正在加载报表…</div>
                : dayRows.length === 0 ? <div className="px-5 py-12 text-center text-[11px] text-white/25">该区间没有消耗记录</div>
                : dayRows.map((row, index) => (
                  <div key={`${row.dateKey}-${row.projectId}-${row.actorKey}-${index}`} role="row" className="fos-activity-row grid items-center gap-3 px-5 py-2.5 text-[12px] [&>*]:min-w-0" style={{ gridTemplateColumns: dayGrid }}>
                    <span role="cell" className="text-white/75">{formatDateShort(row.dateKey, referenceYear)}</span>
                    <span role="cell" className="truncate text-white">{row.projectName}</span>
                    <span role="cell" className="text-white/60">{categoryLabel(row.category)}</span>
                    <span role="cell" className="text-white/60">{row.weekLabel}</span>
                    <span role="cell" className="truncate text-white/75">{row.actorName}</span>
                    <span role="cell" className="fos-ledger-num text-white/75">{blank(row.apiTokens, formatTokens(row.apiTokens))}</span>
                    <span role="cell" className="fos-ledger-num text-white/75">{blank(row.apiTokenCny, formatMoney(row.apiTokenCny))}</span>
                    <span role="cell" className="fos-ledger-num text-white/75">{blank(row.jimengPoints, formatPoints(row.jimengPoints))}</span>
                    <span role="cell" className="fos-ledger-num text-white/75">{blank(row.jimengCny, formatMoney(row.jimengCny))}</span>
                    <span role="cell" className="fos-ledger-num text-white/75">{blank(row.otherCny, formatMoney(row.otherCny))}</span>
                    <span role="cell" className="fos-ledger-num text-white/75">{blank(row.platformCny, formatMoney(row.platformCny))}</span>
                    <span role="cell" className="fos-ledger-num font-semibold text-white">{formatMoney(row.totalCny)}</span>
                    <span role="cell" className="truncate text-white/55" title={row.remark ?? ''}>{row.remark ?? ''}</span>
                  </div>
                ))}
            </div>
          ) : view === 'week' ? (
            <div className="min-w-[720px] w-full" role="table" aria-label="周项目算力">
              <div role="row" className="grid grid-cols-[120px_minmax(200px,2fr)_140px] gap-3 border-b border-white/[.055] px-5 py-2 text-[11px] font-semibold text-white/40">
                <span role="columnheader">周区间</span><span role="columnheader">项目</span><span role="columnheader" className="text-right">周合计（元）</span>
              </div>
              {loading && !data ? <div className="px-5 py-12 text-center text-[11px] text-white/30">正在加载报表…</div>
                : weekRows.length === 0 ? <div className="px-5 py-12 text-center text-[11px] text-white/25">该区间没有消耗记录</div>
                : weekRows.map((row, index) => {
                  const key = `${row.weekStart}-${row.projectId}-${index}`
                  return (
                    <div key={key}>
                      <div role="row" tabIndex={0} className="fos-activity-row grid cursor-pointer grid-cols-[120px_minmax(200px,2fr)_140px] items-center gap-3 px-5 py-2.5 text-[12px]"
                        onClick={() => setExpanded((current) => (current === key ? '' : key))}
                        onKeyDown={(event) => { if (event.key === 'Enter') setExpanded((current) => (current === key ? '' : key)) }}>
                        <span role="cell" className="text-white/75">{row.weekLabel}</span>
                        <span role="cell" className="truncate text-white">{row.projectName}</span>
                        <span role="cell" className="fos-ledger-num font-semibold text-white">{formatMoney(row.totalCny)}</span>
                      </div>
                      {expanded === key ? (
                        <div className="bg-white/[.02] px-5 py-2">
                          {row.people.map((person) => (
                            <div key={person.actorKey} className="grid grid-cols-[120px_minmax(200px,2fr)_140px] gap-3 py-1 text-[12px] text-white/70">
                              <span /><span className="truncate">{person.actorName}</span><span className="fos-ledger-num">{formatMoney(person.totalCny)}</span>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  )
                })}
            </div>
          ) : (
            <div className="min-w-[720px] w-full" role="table" aria-label="三日算力总消耗">
              <div role="row" className="grid grid-cols-[160px_minmax(200px,2fr)_140px] gap-3 border-b border-white/[.055] px-5 py-2 text-[11px] font-semibold text-white/40">
                <span role="columnheader">每三天分组</span><span role="columnheader">项目</span><span role="columnheader" className="text-right">三日合计（元）</span>
              </div>
              {loading && !data ? <div className="px-5 py-12 text-center text-[11px] text-white/30">正在加载报表…</div>
                : triRows.length === 0 ? <div className="px-5 py-12 text-center text-[11px] text-white/25">该区间没有消耗记录</div>
                : triRows.map((row, index) => (
                  <div key={`${row.bucketStart}-${row.projectId}-${index}`} role="row" className="fos-activity-row grid grid-cols-[160px_minmax(200px,2fr)_140px] items-center gap-3 px-5 py-2.5 text-[12px]">
                    <span role="cell" className="text-white/75">{row.label}</span>
                    <span role="cell" className="truncate text-white">{row.projectName}</span>
                    <span role="cell" className="fos-ledger-num font-semibold text-white">{formatMoney(row.totalCny)}</span>
                  </div>
                ))}
            </div>
          )}
        </div>
        {footer}
      </section>
    </div>
  )
}
