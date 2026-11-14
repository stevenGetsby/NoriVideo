'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSession } from 'next-auth/react'
import { AppIcon } from '@/components/ui/icons'
import { statTileStyle } from '@/components/workspace/stat-tile-hue'
import { apiFetch } from '@/lib/api-fetch'
import { readApiErrorMessage } from '@/lib/api/read-error-message'
import { createLatestRequestTracker } from '@/lib/api/latest-request'
import {
  ACTIVITY_RANGES,
  ACTIVITY_RANGE_LABELS,
  MEDIA_KIND_LABELS,
  formatKeepRate,
  formatShanghaiDateTime,
  keepRate,
  type ActivityDetail,
  type ActivityOverview,
  type ActivityRange,
  type ActivityRow,
  type MediaCounts,
} from '@/lib/account/activity-stats-shared'
import { FosShell } from './FosShell'
import { ViewportDialogLayer } from './ViewportDialogLayer'
import { useDialogDismiss } from './use-dialog-dismiss'

type SortKey = 'name' | 'generated' | 'uploaded' | 'points' | 'failed' | 'retried' | 'keep' | 'lastOutput'
type SortDir = 'asc' | 'desc'

const COLUMNS: Array<{ key: SortKey; label: string; align?: 'right' }> = [
  { key: 'name', label: '子账号' },
  { key: 'generated', label: '生成（图 / 视 / 音）' },
  { key: 'uploaded', label: '上传（图 / 视 / 音）' },
  { key: 'points', label: '积分消耗', align: 'right' },
  { key: 'failed', label: '失败', align: 'right' },
  { key: 'retried', label: '重试', align: 'right' },
  { key: 'keep', label: '未删除占比', align: 'right' },
  { key: 'lastOutput', label: '最近产出', align: 'right' },
]
const GRID = 'grid-cols-[minmax(170px,1.3fr)_minmax(150px,1fr)_minmax(150px,1fr)_96px_64px_64px_96px_120px]'

function formatNumber(value: number) {
  return value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })
}

function formatTime(iso: string | null) {
  const text = formatShanghaiDateTime(iso)
  return text ? text.slice(5) : '—'
}

function sortValue(row: ActivityRow, key: SortKey): string | number | null {
  switch (key) {
    case 'name': return row.name
    case 'generated': return row.generated.total
    case 'uploaded': return row.uploaded.total
    case 'points': return row.points
    case 'failed': return row.failed
    case 'retried': return row.retried
    case 'keep': return keepRate(row)
    case 'lastOutput': return row.lastOutputAt ? Date.parse(row.lastOutputAt) : null
  }
}

function sortRows(rows: ActivityRow[], key: SortKey, dir: SortDir) {
  const factor = dir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    const left = sortValue(a, key)
    const right = sortValue(b, key)
    if (left == null && right == null) return a.name.localeCompare(b.name, 'zh-Hans-CN')
    if (left == null) return 1
    if (right == null) return -1
    const diff = typeof left === 'string' && typeof right === 'string'
      ? left.localeCompare(right, 'zh-Hans-CN')
      : Number(left) - Number(right)
    return diff === 0 ? a.name.localeCompare(b.name, 'zh-Hans-CN') : diff * factor
  })
}

function MediaBreakdown({ counts }: { counts: MediaCounts }) {
  return (
    <span className="block min-w-0">
      <strong className="text-[14px] text-white">{counts.total}</strong>
      <span className="ml-2 text-[11px] text-white/45">
        {counts.image} / {counts.video} / {counts.audio}
      </span>
    </span>
  )
}

function AccountStatus({ status }: { status: ActivityRow['status'] }) {
  return status === 'disabled'
    ? <span className="rounded-full border border-white/15 px-1.5 py-px text-[10px] text-white/50">停用</span>
    : null
}

export function FosStaffActivityClient() {
  const { data: session } = useSession()
  const [range, setRange] = useState<ActivityRange>('today')
  const [overview, setOverview] = useState<ActivityOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [selectedId, setSelectedId] = useState('')
  const [exporting, setExporting] = useState(false)
  const requests = useRef(createLatestRequestTracker())
  const isAdmin = session?.user?.role === 'admin'

  const load = useCallback(async (nextRange: ActivityRange, silent = false) => {
    if (!isAdmin) return
    const request = requests.current.begin()
    if (!silent) setLoading(true)
    setError('')
    try {
      const response = await apiFetch(`/api/admin/activity?range=${nextRange}&refresh=${Date.now()}`, { cache: 'no-store' })
      if (!response.ok) throw new Error(await readApiErrorMessage(response, '获取工作监督数据失败'))
      const payload = await response.json() as ActivityOverview
      if (!requests.current.isCurrent(request)) return
      setOverview(payload)
    } catch (cause) {
      if (!requests.current.isCurrent(request)) return
      setError(cause instanceof Error ? cause.message : '获取工作监督数据失败')
    } finally {
      if (requests.current.isCurrent(request)) setLoading(false)
    }
  }, [isAdmin])

  useEffect(() => { void load(range) }, [load, range])
  useEffect(() => {
    const tracker = requests.current
    const refresh = () => void load(range, true)
    window.addEventListener('focus', refresh)
    return () => { window.removeEventListener('focus', refresh); tracker.invalidate() }
  }, [load, range])

  const rows = useMemo(() => sortRows(overview?.rows ?? [], sortKey, sortDir), [overview, sortKey, sortDir])
  const selectedRow = useMemo(
    () => overview?.rows.find((row) => row.userId === selectedId) ?? null,
    [overview, selectedId],
  )
  const summary = overview?.summary

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((current) => (current === 'asc' ? 'desc' : 'asc'))
      return
    }
    setSortKey(key)
    setSortDir(key === 'name' ? 'asc' : 'desc')
  }

  const exportCsv = async () => {
    if (exporting) return
    setExporting(true)
    try {
      const response = await apiFetch(`/api/admin/activity?range=${range}&format=csv`, { cache: 'no-store' })
      if (!response.ok) throw new Error(await readApiErrorMessage(response, '导出失败'))
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `work-activity-${range}.csv`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '导出失败')
    } finally {
      setExporting(false)
    }
  }

  const tiles: Array<[string, string, string | number, string?]> = [
    ['subaccounts', '子账号', summary?.accounts ?? 0],
    ['image', '生成', summary?.generated.total ?? 0, summary ? `${summary.generated.image} / ${summary.generated.video} / ${summary.generated.audio}` : undefined],
    ['assets', '上传', summary?.uploaded.total ?? 0, summary ? `${summary.uploaded.image} / ${summary.uploaded.video} / ${summary.uploaded.audio}` : undefined],
    ['total', '积分消耗', formatNumber(summary?.points ?? 0)],
    ['workflow', '失败 / 重试', `${summary?.failed ?? 0} / ${summary?.retried ?? 0}`],
    ['renders', '未删除占比', summary ? formatKeepRate(keepRate(summary)) : '—'],
  ]

  return (
    <FosShell activeKey="activity">
      <div className="fos-scroll">
        <section className="mx-auto w-full max-w-[1180px] px-8 py-7" data-testid="staff-activity">
          <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className="text-[24px] font-bold text-white">工作监督</h1>
              <p className="mt-1 text-[12px] text-white/40">
                只读统计子账号的生成、上传与消耗，仅管理员可见；按上海时间自然日计算。
              </p>
            </div>
            <div className="flex items-center gap-3">
              <div className="fos-seg" role="group" aria-label="统计范围">
                {ACTIVITY_RANGES.map((item) => (
                  <button
                    key={item}
                    type="button"
                    className={`fos-seg-opt${range === item ? ' active' : ''}`}
                    aria-pressed={range === item}
                    onClick={() => setRange(item)}
                  >
                    {ACTIVITY_RANGE_LABELS[item]}
                  </button>
                ))}
              </div>
              <button type="button" className="fos-btn" disabled={exporting || loading || !overview} onClick={() => void exportCsv()}>
                <AppIcon name="download" className="h-4 w-4" />{exporting ? '导出中…' : '导出 CSV'}
              </button>
            </div>
          </div>

          <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
            {tiles.map(([key, label, value, hint]) => (
              <div key={label} style={statTileStyle(key)} className="fos-stat-tile px-4 py-3.5">
                <span className="text-[12px] text-white/50">{label}</span>
                <strong className="mt-1.5 block text-[22px] text-[var(--hue)]">{value}</strong>
                <span className="mt-0.5 block h-4 text-[11px] text-white/40">{hint ? `图 / 视 / 音  ${hint}` : ''}</span>
              </div>
            ))}
          </div>

          {error ? (
            <div role="alert" className="mb-4 flex items-center justify-between rounded-[9px] border border-white/15 bg-white/[.05] px-4 py-3 text-[12px] text-white/80">
              <span>{error}</span>
              <button type="button" className="underline" onClick={() => void load(range)}>重试</button>
            </div>
          ) : null}

          <section className="overflow-hidden rounded-[12px] border border-white/[.07] bg-[#131319]">
            <div className="overflow-x-auto">
              <div className="min-w-[1020px] w-full" role="table" aria-label="子账号工作统计">
                <div role="row" className={`grid ${GRID} gap-3 border-b border-white/[.055] px-5 py-2 text-[11px] font-semibold text-white/40 [&>*]:min-w-0`}>
                  {COLUMNS.map((column) => (
                    <button
                      key={column.key}
                      type="button"
                      role="columnheader"
                      aria-sort={sortKey === column.key ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                      className={`fos-activity-sort${column.align === 'right' ? ' is-right' : ''}${sortKey === column.key ? ' active' : ''}`}
                      onClick={() => toggleSort(column.key)}
                    >
                      <span className="truncate">{column.label}</span>
                      {sortKey === column.key ? <span aria-hidden>{sortDir === 'asc' ? '↑' : '↓'}</span> : null}
                    </button>
                  ))}
                </div>
                {loading && !overview ? (
                  <div className="px-5 py-12 text-center text-[11px] text-white/30">正在加载统计…</div>
                ) : rows.length === 0 ? (
                  <div className="px-5 py-12 text-center text-[11px] text-white/25">当前工作区还没有子账号</div>
                ) : rows.map((row) => (
                  <button
                    key={row.userId}
                    type="button"
                    role="row"
                    aria-label={`查看 ${row.name} 的明细`}
                    className={`fos-activity-row grid ${GRID} items-center gap-3 px-5 py-3 text-left [&>*]:min-w-0${row.userId === selectedId ? ' active' : ''}`}
                    onClick={() => setSelectedId(row.userId)}
                  >
                    <span role="cell" className="block min-w-0">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="truncate text-[13px] font-semibold text-white">{row.name}</span>
                        <AccountStatus status={row.status} />
                      </span>
                      <span className="mt-0.5 block truncate text-[11px] text-white/38">最近登录 {formatTime(row.lastLoginAt)}</span>
                    </span>
                    <span role="cell"><MediaBreakdown counts={row.generated} /></span>
                    <span role="cell"><MediaBreakdown counts={row.uploaded} /></span>
                    <span role="cell" className="text-right text-[13px] text-white">{formatNumber(row.points)}</span>
                    <span role="cell" className="text-right text-[13px] text-white">{row.failed}</span>
                    <span role="cell" className="text-right text-[13px] text-white">{row.retried}</span>
                    <span role="cell" className="text-right text-[13px] text-white">{formatKeepRate(keepRate(row))}</span>
                    <span role="cell" className="text-right text-[12px] text-white/70">{formatTime(row.lastOutputAt)}</span>
                  </button>
                ))}
              </div>
            </div>
          </section>

          <ul className="mt-4 space-y-1 text-[11px] leading-5 text-white/38">
            <li>生成 = 统计范围内成功完成的图片 / 视频 / 音频生成任务数；上传 = 上传到素材库的文件数，两者分开统计、不合并。</li>
            <li>上传按上传人用户名归属：部分上传入口暂未记录上传人，改名前的上传也无法归属，这部分不在统计内。</li>
            <li>积分消耗取自实际扣费流水；失败、重试按生成任务统计；未删除占比 = 统计范围内产出的素材里当前未被删除的比例。</li>
          </ul>
        </section>
      </div>
      {selectedRow && overview ? (
        <ActivityDrawer row={selectedRow} range={range} onClose={() => setSelectedId('')} />
      ) : null}
    </FosShell>
  )
}

function ActivityDrawer({ row, range, onClose }: { row: ActivityRow; range: ActivityRange; onClose: () => void }) {
  const [detail, setDetail] = useState<ActivityDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const requests = useRef(createLatestRequestTracker())
  useDialogDismiss(true, onClose)

  const load = useCallback(async () => {
    const request = requests.current.begin()
    setLoading(true)
    setError('')
    try {
      const response = await apiFetch(`/api/admin/activity/${encodeURIComponent(row.userId)}?range=${range}&refresh=${Date.now()}`, { cache: 'no-store' })
      if (!response.ok) throw new Error(await readApiErrorMessage(response, '获取明细失败'))
      const payload = await response.json() as ActivityDetail
      if (!requests.current.isCurrent(request)) return
      setDetail(payload)
    } catch (cause) {
      if (!requests.current.isCurrent(request)) return
      setError(cause instanceof Error ? cause.message : '获取明细失败')
    } finally {
      if (requests.current.isCurrent(request)) setLoading(false)
    }
  }, [range, row.userId])

  useEffect(() => {
    const tracker = requests.current
    void load()
    return () => tracker.invalidate()
  }, [load])

  const current = detail?.row ?? row
  const trendMax = Math.max(1, ...(detail?.trend.map((point) => Math.max(point.generated, point.uploaded)) ?? [1]))
  const hourMax = Math.max(1, ...(detail?.hours ?? [1]))

  return (
    <ViewportDialogLayer>
      <div className="fos-activity-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
        <aside role="dialog" aria-modal="true" aria-label={`${row.name} 的工作明细`} className="fos-activity-drawer" data-testid="staff-activity-drawer">
          <header className="fos-activity-drawer-head">
            <div className="min-w-0">
              <h2 className="truncate text-[16px] font-bold text-white">{row.name}</h2>
              <p className="mt-0.5 text-[11px] text-white/40">
                {ACTIVITY_RANGE_LABELS[range]} · 最近登录 {formatTime(row.lastLoginAt)}{row.status === 'disabled' ? ' · 已停用' : ''}
              </p>
            </div>
            <button type="button" className="fos-dialog-x" aria-label="关闭" onClick={onClose}>
              <AppIcon name="close" className="h-4 w-4" />
            </button>
          </header>

          <div className="fos-activity-drawer-body">
            <div className="grid grid-cols-3 gap-2">
              {([
                ['生成', `${current.generated.total}`, `${current.generated.image} / ${current.generated.video} / ${current.generated.audio}`],
                ['上传', `${current.uploaded.total}`, `${current.uploaded.image} / ${current.uploaded.video} / ${current.uploaded.audio}`],
                ['积分消耗', formatNumber(current.points), ''],
                ['失败', `${current.failed}`, ''],
                ['重试', `${current.retried}`, ''],
                ['未删除占比', formatKeepRate(keepRate(current)), ''],
              ] as const).map(([label, value, hint]) => (
                <div key={label} className="rounded-[9px] border border-white/[.07] bg-white/[.03] px-3 py-2.5">
                  <span className="block text-[11px] text-white/45">{label}</span>
                  <strong className="mt-0.5 block text-[17px] text-white">{value}</strong>
                  <span className="block h-4 text-[10px] text-white/35">{hint}</span>
                </div>
              ))}
            </div>

            {error ? (
              <div role="alert" className="flex items-center justify-between rounded-[9px] border border-white/15 bg-white/[.05] px-3 py-2.5 text-[12px] text-white/80">
                <span>{error}</span>
                <button type="button" className="underline" onClick={() => void load()}>重试</button>
              </div>
            ) : null}

            {loading && !detail ? (
              <div className="py-10 text-center text-[11px] text-white/30">正在加载明细…</div>
            ) : detail ? (
              <>
                <section>
                  <h3 className="fos-activity-section">近 14 天趋势</h3>
                  <div className="fos-activity-chart" role="img" aria-label="近 14 天生成与上传趋势">
                    {detail.trend.map((point) => (
                      <div key={point.date} className="fos-activity-col" title={`${point.date}：生成 ${point.generated}（视频 ${point.video}），上传 ${point.uploaded}，失败 ${point.failed}`}>
                        <div className="fos-activity-bars">
                          <i className="is-generated" style={{ height: `${(point.generated / trendMax) * 100}%` }} />
                          <i className="is-uploaded" style={{ height: `${(point.uploaded / trendMax) * 100}%` }} />
                        </div>
                        <span>{point.date.slice(8)}</span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-2 flex items-center gap-4 text-[11px] text-white/45">
                    <span className="flex items-center gap-1.5"><i className="fos-activity-dot is-generated" />生成</span>
                    <span className="flex items-center gap-1.5"><i className="fos-activity-dot is-uploaded" />上传</span>
                  </div>
                </section>

                <section>
                  <h3 className="fos-activity-section">24 小时分布（{ACTIVITY_RANGE_LABELS[range]}，生成 + 上传）</h3>
                  <div className="fos-activity-chart is-hours" role="img" aria-label="24 小时产出分布">
                    {detail.hours.map((count, hour) => (
                      <div key={hour} className="fos-activity-col" title={`${hour}:00–${hour}:59：${count}`}>
                        <div className="fos-activity-bars">
                          <i className="is-generated" style={{ height: `${(count / hourMax) * 100}%` }} />
                        </div>
                        <span>{hour % 6 === 0 ? hour : ''}</span>
                      </div>
                    ))}
                  </div>
                </section>

                <section>
                  <h3 className="fos-activity-section">今日时间线</h3>
                  {detail.timeline.length === 0 ? (
                    <p className="py-3 text-[12px] text-white/30">今天还没有生成或上传记录</p>
                  ) : (
                    <ul className="fos-activity-list">
                      {detail.timeline.map((event, index) => (
                        <li key={`${event.at}-${index}`}>
                          <span className="fos-num w-[46px] shrink-0 text-white/45">{formatShanghaiDateTime(event.at).slice(11)}</span>
                          <span className="shrink-0 text-white/60">{event.kind === 'upload' ? '上传' : '生成'}{event.media ? ` · ${MEDIA_KIND_LABELS[event.media]}` : ''}</span>
                          <span className="min-w-0 flex-1 truncate text-white/85">{event.kind === 'upload' ? event.title : event.status === 'failed' ? '失败' : '完成'}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <section>
                  <h3 className="fos-activity-section">最近生成（{ACTIVITY_RANGE_LABELS[range]}，最多 20 条）</h3>
                  {detail.recent.length === 0 ? (
                    <p className="py-3 text-[12px] text-white/30">所选范围内没有生成记录</p>
                  ) : (
                    <ul className="fos-activity-list">
                      {detail.recent.map((task) => (
                        <li key={task.id}>
                          <span className="fos-num w-[88px] shrink-0 text-white/45">{formatTime(task.at)}</span>
                          <span className="shrink-0 text-white/60">{task.media ? MEDIA_KIND_LABELS[task.media] : '其他'}</span>
                          <span className="min-w-0 flex-1 truncate text-white/85">
                            {task.status === 'failed' ? `失败${task.errorCode ? `（${task.errorCode}）` : ''}` : '完成'}
                            {task.attempt > 1 ? ` · 第 ${task.attempt} 次执行` : ''}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </>
            ) : null}
          </div>
        </aside>
      </div>
    </ViewportDialogLayer>
  )
}
