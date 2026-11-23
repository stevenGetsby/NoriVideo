'use client'

/**
 * 手填记录（管理员看全员，§11.4）：含已作废；作废行灰显 + 删除线金额。
 * 编辑 = 作废 + 新建（RecordEntryDialog 预填）；导入行只有作废。记一笔可代谁记。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { AppIcon } from '@/components/ui/icons'
import { apiFetch } from '@/lib/api-fetch'
import { readApiErrorMessage } from '@/lib/api/read-error-message'
import { createLatestRequestTracker } from '@/lib/api/latest-request'
import { ENTRY_KINDS, addDaysKey, todayKey, type EntryKind } from '@/lib/compute-ledger/calc'
import { ENTRY_KIND_LABELS, formatCny, formatDateShort, formatMoney, formatQuantity } from './ledger-format'
import { RecordEntryDialog } from './RecordEntryDialog'
import type { EntryListResponse, EntryView, LedgerPanelProps, OverviewResponse } from './ledger-types'

const PAGE_SIZE = 100
const GRID = '90px minmax(150px,1.5fr) 110px 100px 110px 90px 110px minmax(150px,1.3fr) 70px 80px 130px'

export function LedgerEntriesPanel({ refreshToken, onStatus }: LedgerPanelProps) {
  const [from, setFrom] = useState(addDaysKey(todayKey(), -29))
  const [to, setTo] = useState(todayKey())
  const [projectId, setProjectId] = useState('')
  const [actorKey, setActorKey] = useState('')
  const [kind, setKind] = useState<EntryKind | ''>('')
  const [source, setSource] = useState('')
  const [includeVoided, setIncludeVoided] = useState(true)
  const [page, setPage] = useState(1)
  const [data, setData] = useState<EntryListResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>([])
  const [actors, setActors] = useState<Array<{ key: string; name: string }>>([])
  const [dialog, setDialog] = useState<{ initial: EntryView | null } | null>(null)
  const [voidConfirmId, setVoidConfirmId] = useState('')
  const [toast, setToast] = useState('')
  const requests = useRef(createLatestRequestTracker())
  const optionsLoaded = useRef(false)
  const toastTimer = useRef<number | undefined>(undefined)

  const showToast = useCallback((message: string) => {
    setToast(message)
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(''), 3000)
  }, [])
  useEffect(() => () => window.clearTimeout(toastTimer.current), [])

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
        /* 下拉选项加载失败不阻塞列表 */
      }
    })()
  }, [onStatus])

  const load = useCallback(async () => {
    const request = requests.current.begin()
    setLoading(true)
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) })
      if (from) params.set('from', from)
      if (to) params.set('to', to)
      if (projectId) params.set('projectId', projectId)
      if (actorKey) params.set('actorKey', actorKey)
      if (kind) params.set('kind', kind)
      if (source) params.set('source', source)
      if (includeVoided) params.set('includeVoided', '1')
      const response = await apiFetch(`/api/admin/compute-ledger/entries?${params}`, { cache: 'no-store' })
      if (!response.ok) throw new Error(await readApiErrorMessage(response, '获取手填记录失败'))
      const payload = await response.json() as EntryListResponse
      if (!requests.current.isCurrent(request)) return
      setData(payload)
      onStatus({ error: '' })
    } catch (cause) {
      if (!requests.current.isCurrent(request)) return
      onStatus({ error: cause instanceof Error ? cause.message : '获取手填记录失败' })
    } finally {
      if (requests.current.isCurrent(request)) setLoading(false)
    }
  }, [from, to, projectId, actorKey, kind, source, includeVoided, page, onStatus])

  useEffect(() => { void load() }, [load, refreshToken])
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
      onStatus({ error: cause instanceof Error ? cause.message : '作废失败' })
    }
  }

  const referenceYear = Number(todayKey().slice(0, 4))
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <span className="flex items-center gap-2">
          <input type="date" className="fos-input" style={{ width: 150 }} value={from} max={to} onChange={(event) => { setFrom(event.target.value); setPage(1) }} />
          <span className="text-white/40">—</span>
          <input type="date" className="fos-input" style={{ width: 150 }} value={to} min={from} onChange={(event) => { setTo(event.target.value); setPage(1) }} />
        </span>
        <select className="fos-input" style={{ width: 170 }} value={projectId} onChange={(event) => { setProjectId(event.target.value); setPage(1) }}>
          <option value="">全部项目</option>
          {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
        </select>
        <select className="fos-input" style={{ width: 140 }} value={actorKey} onChange={(event) => { setActorKey(event.target.value); setPage(1) }}>
          <option value="">全部提交人</option>
          {actors.map((actor) => <option key={actor.key} value={actor.key}>{actor.name}</option>)}
        </select>
        <select className="fos-input" style={{ width: 130 }} value={kind} onChange={(event) => { setKind(event.target.value as EntryKind | ''); setPage(1) }}>
          <option value="">全部类型</option>
          {ENTRY_KINDS.map((item) => <option key={item} value={item}>{ENTRY_KIND_LABELS[item]}</option>)}
        </select>
        <select className="fos-input" style={{ width: 110 }} value={source} onChange={(event) => { setSource(event.target.value); setPage(1) }}>
          <option value="">全部来源</option>
          <option value="manual">手填</option>
          <option value="import">导入</option>
        </select>
        <label className="flex items-center gap-1.5 text-[12px] text-white/60">
          <input type="checkbox" checked={includeVoided} onChange={(event) => { setIncludeVoided(event.target.checked); setPage(1) }} />含已作废
        </label>
        <button type="button" className="fos-btn fos-btn-primary ml-auto" onClick={() => setDialog({ initial: null })}><AppIcon name="plus" className="h-4 w-4" />记一笔</button>
      </div>

      <section className="overflow-hidden rounded-[12px] border border-white/[.07] bg-[rgb(var(--nori-bg-2))]">
        <div className="overflow-x-auto">
          <div className="min-w-[1200px] w-full" role="table" aria-label="手填记录">
            <div role="row" className="grid gap-3 border-b border-white/[.055] px-5 py-2 text-[11px] font-semibold text-white/40 [&>*]:min-w-0" style={{ gridTemplateColumns: GRID }}>
              <span role="columnheader">日期</span><span role="columnheader">项目</span><span role="columnheader">提交人</span><span role="columnheader">类型</span>
              <span role="columnheader" className="text-right">数量</span><span role="columnheader" className="text-right">单价快照</span><span role="columnheader" className="text-right">金额（元）</span>
              <span role="columnheader">备注</span><span role="columnheader">来源</span><span role="columnheader">状态</span><span role="columnheader">操作</span>
            </div>
            {loading && !data ? <div className="px-5 py-12 text-center text-[11px] text-white/30">正在加载手填记录…</div>
              : (data?.rows.length ?? 0) === 0 ? <div className="px-5 py-12 text-center text-[11px] text-white/25">还没有手填记录</div>
              : (data?.rows ?? []).map((entry) => {
                const voided = entry.voidedAt != null
                return (
                  <div key={entry.id} role="row" className={`fos-activity-row grid items-center gap-3 px-5 py-2.5 text-[12px] [&>*]:min-w-0${voided ? ' opacity-50' : ''}`} style={{ gridTemplateColumns: GRID }}>
                    <span role="cell" className="text-white/75">{formatDateShort(entry.dateKey, referenceYear)}</span>
                    <span role="cell" className="truncate text-white">{entry.projectName}</span>
                    <span role="cell" className="truncate text-white/75">{entry.actorLabel}</span>
                    <span role="cell" className="text-white/60">{ENTRY_KIND_LABELS[entry.kind]}</span>
                    <span role="cell" className="fos-ledger-num text-white/75">{formatQuantity(entry.kind, entry.quantity)}</span>
                    <span role="cell" className="fos-ledger-num text-white/60">{formatMoney(entry.rate)}</span>
                    <span role="cell" className={`fos-ledger-num text-white${voided ? ' line-through' : ''}`}>{formatMoney(entry.amountCny)}</span>
                    <span role="cell" className="truncate text-white/55" title={entry.remark ?? ''}>{entry.remark ?? ''}</span>
                    <span role="cell" className="text-white/60">{entry.source === 'import' ? '导入' : '手填'}</span>
                    <span role="cell" className={voided ? 'text-white/40' : 'text-[var(--fos-success)]'}>{voided ? '已作废' : '正常'}</span>
                    <span role="cell" className="flex items-center gap-1.5">
                      {voidConfirmId === entry.id ? (
                        <>
                          <button type="button" className="fos-btn fos-btn-sm fos-btn-danger" onClick={() => void voidEntry(entry.id)}>确认作废</button>
                          <button type="button" className="fos-btn fos-btn-sm fos-btn-ghost" onClick={() => setVoidConfirmId('')}>返回</button>
                        </>
                      ) : (
                        <>
                          {!voided && entry.source !== 'import' ? (
                            <button type="button" className="fos-btn fos-btn-sm fos-btn-ghost" disabled={!entry.editable} onClick={() => setDialog({ initial: entry })}>编辑</button>
                          ) : null}
                          {!voided ? (
                            <button type="button" className="fos-btn fos-btn-sm fos-btn-ghost" onClick={() => setVoidConfirmId(entry.id)}>作废</button>
                          ) : null}
                        </>
                      )}
                    </span>
                  </div>
                )
              })}
          </div>
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-white/[.055] px-5 py-3 text-[12px] text-white/70">
          <span>共 {data?.total ?? 0} 条</span>
          <span className="flex items-center gap-2">
            <button type="button" className="fos-btn fos-btn-sm" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>上一页</button>
            <span>第 {data?.page ?? 1} / {totalPages} 页</span>
            <button type="button" className="fos-btn fos-btn-sm" disabled={page >= totalPages} onClick={() => setPage((current) => current + 1)}>下一页</button>
          </span>
        </div>
      </section>

      {dialog ? (
        <RecordEntryDialog isAdmin initial={dialog.initial} existingEntries={data?.rows ?? []} onClose={() => setDialog(null)}
          onSaved={(entry) => { showToast(`已记录 ${formatCny(entry.amountCny)}`); void load() }} />
      ) : null}
      {toast ? <div className="fixed bottom-6 left-1/2 z-[100200] -translate-x-1/2 rounded-[9px] border border-white/[.12] bg-[rgb(var(--nori-bg-3))] px-4 py-2 text-[12px] text-white shadow-lg" role="status">{toast}</div> : null}
    </div>
  )
}
