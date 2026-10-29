'use client'

import { useEffect, useMemo, useState } from 'react'
import { AppIcon } from '@/components/ui/icons'
import { apiFetch } from '@/lib/api-fetch'
import {
  buildAccountModelUsageCsv,
  buildAccountModelUsageRows,
} from '@/lib/workspace/service-records-export'

type ReportRecord = {
  id: string
  projectId: string | null
  projectName: string
  workId: string | null
  workName: string
  accountId: string | null
  accountName: string
  accountRole: string
  serviceType: string
  operation: string
  modelKey: string
  modelName: string
  status: 'success' | 'failed'
  inputTokens: number
  outputTokens: number
  units: number
  cost: number
  points: number
  createdAt: string
}

type ReportOption = { id: string; name: string }
type ReportProjectOption = ReportOption & { workId: string }

type ServiceReport = {
  records: ReportRecord[]
  options: {
    works: ReportOption[]
    projects: ReportProjectOption[]
    accounts: Array<ReportOption & { role: string }>
    services: string[]
    models: ReportOption[]
  }
  generatedAt: string
}

type ServiceRecordsResponse = {
  report?: ServiceReport
}

type RangePreset = 'today' | 'yesterday' | '7d' | '30d' | 'month' | 'all' | 'custom'

const SERVICE_LABELS: Record<string, string> = {
  text: '文本生成',
  image: '图片生成',
  video: '视频生成',
  voice: '音频生成',
  'voice-design': '音色设计',
  'lip-sync': '口型同步',
  storage: '素材存储',
  other: '其他服务',
}

const ACTION_LABELS: Record<string, string> = {
  video_panel: '分镜视频生成',
  image_panel: '分镜图片生成',
  toolbox_image: '工具箱图片生成',
  toolbox_video: '工具箱视频生成',
  toolbox_audio: '工具箱音频生成',
  canvas_generation: '画布内容生成',
  canvas_text_generation: '画布文本生成',
  canvas_storyboard_plan: '画布故事板规划',
  asset_extraction_run: '作品资产解析',
  script_to_storyboard_run: '作品分镜解析',
  story_to_script_run: '剧本格式化',
  source_storyboard: '视频分镜反译',
  'source-storyboard': '视频分镜反译',
  'video-understanding-board': '视频分镜反译',
  'video-understanding-script': '视频剧本反译',
  'script-adaptation': '转绘剧本生成',
  'generate-image': '图片生成',
  'generate-video': '视频生成',
  'generate-audio': '音频生成',
}

const CHART_COLORS = ['#3265ff', '#17b890', '#f59e0b', '#e0529a', '#3265ff', '#3265ff']

function pad(value: number) {
  return String(value).padStart(2, '0')
}

function dateInputValue(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function startOfDay(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate())
}

function endOfDay(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate(), 23, 59, 59, 999)
}

function presetDates(preset: RangePreset) {
  const today = startOfDay(new Date())
  const end = endOfDay(today)
  if (preset === 'today') return { start: today, end }
  if (preset === 'yesterday') {
    const day = new Date(today)
    day.setDate(day.getDate() - 1)
    return { start: day, end: endOfDay(day) }
  }
  if (preset === '30d') {
    const start = new Date(today)
    start.setDate(start.getDate() - 29)
    return { start, end }
  }
  if (preset === 'month') return { start: new Date(today.getFullYear(), today.getMonth(), 1), end }
  if (preset === 'all') return { start: new Date(2020, 0, 1), end }
  const start = new Date(today)
  start.setDate(start.getDate() - 6)
  return { start, end }
}

function number(value: number, digits = 0) {
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: digits }).format(Number.isFinite(value) ? value : 0)
}

function serviceLabel(value: string) {
  return SERVICE_LABELS[value] || SERVICE_LABELS.other
}

function operationLabel(value: string, serviceType: string) {
  const normalized = value.trim().toLowerCase()
  if (ACTION_LABELS[normalized]) return ACTION_LABELS[normalized]
  if (normalized.includes('storyboard')) return '分镜内容生成'
  if (normalized.includes('character') || normalized.includes('location') || normalized.includes('asset')) return '资产内容生成'
  if (normalized.includes('image')) return '图片生成'
  if (normalized.includes('video')) return '视频生成'
  if (normalized.includes('voice') || normalized.includes('audio') || normalized.includes('tts')) return '音频生成'
  if (normalized.includes('script') || normalized.includes('text') || normalized.includes('analysis')) return '文本内容生成'
  return serviceLabel(serviceType)
}

function modelLabel(record: Pick<ReportRecord, 'modelName' | 'serviceType'>) {
  const value = record.modelName.trim()
  if (!value || value === 'unknown' || value === '未记录模型') return `${serviceLabel(record.serviceType)}模型`
  return value
}

function localDay(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return dateInputValue(date)
}

function EmptyChart({ text = '当前筛选范围暂无用量' }: { text?: string }) {
  return <div className="flex h-[190px] items-center justify-center text-[12px] text-white/35">{text}</div>
}

function CumulativeLineChart({ rows }: { rows: Array<{ day: string; value: number }> }) {
  if (!rows.length) return <EmptyChart />
  const width = 1000
  const height = 225
  const left = 52
  const right = 20
  const top = 18
  const bottom = 32
  const max = Math.max(1, ...rows.map((row) => row.value))
  const points = rows.map((row, index) => ({
    ...row,
    x: left + (rows.length === 1 ? (width - left - right) / 2 : (index / (rows.length - 1)) * (width - left - right)),
    y: top + (1 - row.value / max) * (height - top - bottom),
  }))
  const line = points.map((point) => `${point.x},${point.y}`).join(' ')
  const area = `${left},${height - bottom} ${line} ${points.at(-1)?.x || left},${height - bottom}`
  const labelStep = Math.max(1, Math.ceil(rows.length / 6))
  return (
    // eslint-disable-next-line no-restricted-syntax -- This SVG is a data chart, not an interface icon.
    <svg className="h-[225px] w-full" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="积分累计消耗趋势">
      <defs>
        <linearGradient id="service-report-area" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#fbbf24" stopOpacity=".28" /><stop offset="1" stopColor="#fbbf24" stopOpacity="0" /></linearGradient>
      </defs>
      {[0, 1, 2, 3, 4].map((index) => {
        const y = top + (index / 4) * (height - top - bottom)
        const value = max * (1 - index / 4)
        return <g key={index}><line x1={left} x2={width - right} y1={y} y2={y} stroke="rgba(255,255,255,.075)" /><text x={left - 10} y={y + 4} textAnchor="end" fill="rgba(255,255,255,.34)" fontSize="10">{number(value)}</text></g>
      })}
      <polygon points={area} fill="url(#service-report-area)" />
      <polyline points={line} fill="none" stroke="#fbbf24" strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round" />
      {points.map((point, index) => index % labelStep === 0 || index === points.length - 1 ? <text key={point.day} x={point.x} y={height - 9} textAnchor="middle" fill="rgba(255,255,255,.38)" fontSize="10">{point.day.slice(5)}</text> : null)}
    </svg>
  )
}

function HorizontalBars({ rows, valueLabel }: { rows: Array<{ id: string; label: string; value: number; detail?: string }>; valueLabel: (value: number) => string }) {
  if (!rows.length) return <EmptyChart />
  const max = Math.max(1, ...rows.map((row) => row.value))
  return (
    <div className="space-y-4 py-3">
      {rows.slice(0, 7).map((row) => (
        <div key={row.id} className="grid grid-cols-[130px_minmax(0,1fr)_86px] items-center gap-3 text-[12px]">
          <div className="min-w-0"><strong className="block truncate font-medium text-white/72">{row.label}</strong>{row.detail ? <small className="mt-0.5 block truncate text-[10px] text-white/30">{row.detail}</small> : null}</div>
          <div className="h-3 overflow-hidden rounded-[3px] bg-white/[.045]"><div className="h-full min-w-[3px] rounded-[3px] bg-gradient-to-r from-[#fbbf24] to-[#ffc34a]" style={{ width: `${Math.max(1.5, (row.value / max) * 100)}%` }} /></div>
          <span className="text-right font-mono text-[11px] text-white/48">{valueLabel(row.value)}</span>
        </div>
      ))}
    </div>
  )
}

function DonutChart({ rows, unit = '次调用', valueLabel = (value: number) => number(value) }: { rows: Array<{ id: string; label: string; value: number }>; unit?: string; valueLabel?: (value: number) => string }) {
  if (!rows.length) return <EmptyChart />
  const total = rows.reduce((sum, row) => sum + row.value, 0)
  if (total <= 0) return <EmptyChart />
  let cursor = 0
  const stops = rows.slice(0, CHART_COLORS.length).map((row, index) => {
    const start = cursor
    cursor += (row.value / total) * 100
    return `${CHART_COLORS[index]} ${start}% ${cursor}%`
  })
  return (
    <div className="flex min-h-[210px] items-center justify-center gap-10 py-4">
      <div className="relative h-36 w-36 shrink-0 rounded-full" style={{ background: `conic-gradient(${stops.join(',')})` }}><div className="absolute inset-[23px] flex flex-col items-center justify-center rounded-full bg-[var(--fos-bg-2)]"><strong className="text-[20px] text-white">{valueLabel(total)}</strong><small className="text-[10px] text-white/34">{unit}</small></div></div>
      <div className="min-w-0 space-y-2.5">{rows.slice(0, CHART_COLORS.length).map((row, index) => <div key={row.id} className="flex min-w-0 items-center gap-2 text-[11px] text-white/55"><i className="h-2.5 w-2.5 shrink-0 rounded-[2px]" style={{ background: CHART_COLORS[index] }} /><span className="max-w-[190px] truncate">{row.label}</span><b className="ml-auto font-mono font-medium text-white/70">{valueLabel(row.value)}</b></div>)}</div>
    </div>
  )
}

function ReportCard({ title, subtitle, children, className = '' }: { title: string; subtitle?: string; children: React.ReactNode; className?: string }) {
  return <section className={`rounded-[12px] border border-white/[.075] bg-[var(--fos-bg-2)] ${className}`}><header className="flex min-h-[45px] items-center justify-between gap-3 border-b border-white/[.055] px-4"><div><strong className="text-[13px] font-semibold text-white/82">{title}</strong>{subtitle ? <span className="ml-2 text-[10px] text-white/32">{subtitle}</span> : null}</div></header><div className="px-4 py-2">{children}</div></section>
}

export function FrameServiceRecordsDashboard() {
  const initialDates = useMemo(() => presetDates('7d'), [])
  const [report, setReport] = useState<ServiceReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [workId, setWorkId] = useState('all')
  const [projectId, setProjectId] = useState('all')
  const [accountId, setAccountId] = useState('all')
  const [serviceType, setServiceType] = useState('all')
  const [modelKey, setModelKey] = useState('all')
  const [status, setStatus] = useState('all')
  const [rangePreset, setRangePreset] = useState<RangePreset>('7d')
  const [startDate, setStartDate] = useState(dateInputValue(initialDates.start))
  const [endDate, setEndDate] = useState(dateInputValue(initialDates.end))

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const response = await apiFetch('/api/service-records?limit=200', { cache: 'no-store' })
        if (!response.ok) throw new Error('报表数据暂时不可用')
        const payload = await response.json() as ServiceRecordsResponse
        if (!cancelled) setReport(payload.report || null)
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : '加载报表失败')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [refreshKey])

  const choosePreset = (preset: RangePreset) => {
    const dates = presetDates(preset)
    setRangePreset(preset)
    setStartDate(dateInputValue(dates.start))
    setEndDate(dateInputValue(dates.end))
  }

  const projectOptions = useMemo(() => (report?.options.projects || []).filter((project) => workId === 'all' || project.workId === workId), [report?.options.projects, workId])
  useEffect(() => {
    if (projectId !== 'all' && !projectOptions.some((project) => project.id === projectId)) setProjectId('all')
  }, [projectId, projectOptions])

  const filtered = useMemo(() => {
    const start = startDate ? startOfDay(new Date(`${startDate}T00:00:00`)).getTime() : Number.NEGATIVE_INFINITY
    const end = endDate ? endOfDay(new Date(`${endDate}T00:00:00`)).getTime() : Number.POSITIVE_INFINITY
    return (report?.records || []).filter((record) => {
      const created = new Date(record.createdAt).getTime()
      return created >= start && created <= end
        && (workId === 'all' || record.workId === workId)
        && (projectId === 'all' || record.projectId === projectId)
        && (accountId === 'all' || record.accountId === accountId)
        && (serviceType === 'all' || record.serviceType === serviceType)
        && (modelKey === 'all' || record.modelKey === modelKey)
        && (status === 'all' || record.status === status)
    })
  }, [accountId, endDate, modelKey, projectId, report?.records, serviceType, startDate, status, workId])

  const points = filtered.reduce((sum, record) => sum + record.points, 0)
  const inputTokens = filtered.reduce((sum, record) => sum + record.inputTokens, 0)
  const outputTokens = filtered.reduce((sum, record) => sum + record.outputTokens, 0)
  const imageCount = filtered.filter((record) => record.status === 'success' && record.serviceType === 'image').reduce((sum, record) => sum + Math.max(1, record.units), 0)
  const successfulVideoRecords = filtered.filter((record) => record.status === 'success' && record.serviceType === 'video')
  const videoCount = successfulVideoRecords.length
  const videoSeconds = successfulVideoRecords.reduce((sum, record) => sum + Math.max(0, record.units), 0)
  const videoTokens = successfulVideoRecords.reduce((sum, record) => sum + record.inputTokens + record.outputTokens, 0)
  const failureCount = filtered.filter((record) => record.status === 'failed').length

  const dailyRows = useMemo(() => {
    const byDay = new Map<string, number>()
    filtered.forEach((record) => byDay.set(localDay(record.createdAt), (byDay.get(localDay(record.createdAt)) || 0) + record.points))
    const entries = Array.from(byDay.entries()).filter(([day]) => Boolean(day)).sort(([left], [right]) => left.localeCompare(right))
    let cumulative = 0
    return entries.map(([day, value]) => ({ day, value: cumulative += value }))
  }, [filtered])

  const projectRows = useMemo(() => {
    const rows = new Map<string, { label: string; value: number; calls: number }>()
    filtered.forEach((record) => {
      const id = record.projectId || 'workspace'
      const row = rows.get(id) || { label: record.projectName, value: 0, calls: 0 }
      row.value += record.points
      row.calls += 1
      rows.set(id, row)
    })
    return Array.from(rows, ([id, row]) => ({ id, label: row.label, value: row.value || row.calls, detail: row.value > 0 ? `${row.calls} 次调用` : '按调用次数展示' })).sort((left, right) => right.value - left.value)
  }, [filtered])

  const accountRows = useMemo(() => {
    const rows = new Map<string, { label: string; role: string; points: number; calls: number }>()
    filtered.forEach((record) => {
      const id = record.accountId || 'system'
      const row = rows.get(id) || { label: record.accountName, role: record.accountRole, points: 0, calls: 0 }
      row.points += record.points
      row.calls += 1
      rows.set(id, row)
    })
    return Array.from(rows, ([id, row]) => ({ id, label: row.label, value: row.points || row.calls, detail: row.role || `${row.calls} 次调用` })).sort((left, right) => right.value - left.value)
  }, [filtered])

  const modelRows = useMemo(() => {
    const rows = new Map<string, { label: string; value: number }>()
    filtered.forEach((record) => {
      const key = record.modelKey === 'unknown' ? `unknown:${record.serviceType}` : record.modelKey
      const row = rows.get(key) || { label: modelLabel(record), value: 0 }
      row.value += record.points
      rows.set(key, row)
    })
    return Array.from(rows, ([id, row]) => ({ id, ...row })).sort((left, right) => right.value - left.value)
  }, [filtered])

  const accountModelRows = useMemo(() => buildAccountModelUsageRows(filtered), [filtered])

  const exportAccountModelUsage = () => {
    if (accountModelRows.length === 0) return
    const blob = new Blob([buildAccountModelUsageCsv(accountModelRows)], { type: 'text/csv;charset=utf-8' })
    const href = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = href
    anchor.download = `LanmiaoTV_账号模型积分_${startDate || '全部'}_${endDate || '全部'}.csv`
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(href)
  }

  const selectClass = 'h-9 min-w-0 rounded-[7px] border border-white/[.085] bg-[#08080c] px-2.5 text-[12px] text-white/72 outline-none focus:border-[rgba(255,255,255,.38)]'

  return (
    <div className="min-h-full space-y-3 bg-[#08080c] p-4 text-white">
      <header className="flex flex-wrap items-center justify-between gap-3 px-1">
        <div><h1 className="flex items-center gap-2 text-[17px] font-semibold"><AppIcon name="barChart" className="h-5 w-5 text-[var(--fos-primary-text)]" />用量报表</h1><p className="mt-1 text-[11px] text-white/36">按项目、作品、账号、服务与模型查看真实生成用量</p></div>
        <div className="flex items-center gap-2">
          <button type="button" className="inline-flex h-9 items-center gap-2 rounded-[7px] border border-[var(--fos-primary-border)] bg-[var(--fos-primary-soft)] px-3 text-[12px] text-white hover:bg-[rgba(110,123,255,.22)] disabled:cursor-not-allowed disabled:opacity-40" disabled={loading || accountModelRows.length === 0} onClick={exportAccountModelUsage}><AppIcon name="download" className="h-4 w-4" />导出表格</button>
          <button type="button" className="inline-flex h-9 items-center gap-2 rounded-[7px] border border-white/10 bg-white/[.035] px-3 text-[12px] text-white/62 hover:bg-white/[.07]" disabled={loading} onClick={() => setRefreshKey((key) => key + 1)}><AppIcon name="refresh" className={`h-4 w-4${loading ? ' animate-spin' : ''}`} />刷新</button>
        </div>
      </header>

      <section className="rounded-[12px] border border-white/[.075] bg-[var(--fos-bg-2)] p-3">
        <div className="grid gap-2 xl:grid-cols-[1fr_1fr_1fr_1fr_1fr_.8fr]">
          <label className="grid grid-cols-[38px_1fr] items-center gap-2 text-[11px] text-white/38"><span>项目</span><select className={selectClass} value={workId} onChange={(event) => setWorkId(event.target.value)}><option value="all">全部项目</option>{report?.options.works.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label className="grid grid-cols-[38px_1fr] items-center gap-2 text-[11px] text-white/38"><span>作品</span><select className={selectClass} value={projectId} onChange={(event) => setProjectId(event.target.value)}><option value="all">全部作品</option>{projectOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label className="grid grid-cols-[38px_1fr] items-center gap-2 text-[11px] text-white/38"><span>账号</span><select className={selectClass} value={accountId} onChange={(event) => setAccountId(event.target.value)}><option value="all">全部账号</option>{report?.options.accounts.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.role}</option>)}</select></label>
          <label className="grid grid-cols-[38px_1fr] items-center gap-2 text-[11px] text-white/38"><span>服务</span><select className={selectClass} value={serviceType} onChange={(event) => setServiceType(event.target.value)}><option value="all">全部服务</option>{report?.options.services.map((item) => <option key={item} value={item}>{serviceLabel(item)}</option>)}</select></label>
          <label className="grid grid-cols-[38px_1fr] items-center gap-2 text-[11px] text-white/38"><span>模型</span><select className={selectClass} value={modelKey} onChange={(event) => setModelKey(event.target.value)}><option value="all">全部模型</option>{report?.options.models.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label className="grid grid-cols-[38px_1fr] items-center gap-2 text-[11px] text-white/38"><span>状态</span><select className={selectClass} value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">全部状态</option><option value="success">成功</option><option value="failed">失败</option></select></label>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-white/[.055] pt-3">
          <span className="mr-1 text-[11px] text-white/38">时间</span>
          <input aria-label="报表开始日期" type="date" className={selectClass} value={startDate} onChange={(event) => { setRangePreset('custom'); setStartDate(event.target.value) }} />
          <span className="text-[11px] text-white/28">至</span>
          <input aria-label="报表结束日期" type="date" className={selectClass} value={endDate} onChange={(event) => { setRangePreset('custom'); setEndDate(event.target.value) }} />
          <div className="ml-1 flex flex-wrap gap-1">{([['today', '今日'], ['yesterday', '昨天'], ['7d', '近 7 天'], ['30d', '近 30 天'], ['month', '本月'], ['all', '不限']] as Array<[RangePreset, string]>).map(([value, label]) => <button type="button" key={value} className={`h-8 rounded-[6px] px-3 text-[11px] ${rangePreset === value ? 'bg-[linear-gradient(100deg,#3c8bff_0%,#6c5cff_52%,#a855f7_100%)] text-white' : 'text-white/42 hover:bg-white/[.05] hover:text-white/72'}`} onClick={() => choosePreset(value)}>{label}</button>)}</div>
          <span className="ml-auto text-[10px] text-white/28">{filtered.length} 条服务记录</span>
        </div>
      </section>

      {error ? <div className="rounded-[10px] border border-red-400/20 bg-red-500/[.08] px-4 py-3 text-[12px] text-red-200"><AppIcon name="alert" className="mr-2 inline h-4 w-4" />{error}</div> : null}

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {[
          { title: '积分消耗', value: number(points, 2), hint: '筛选范围内的实际/估算积分', color: '#fbbf24' },
          { title: '文本 Token', value: number(inputTokens + outputTokens), hint: `输入 ${number(inputTokens)} · 输出 ${number(outputTokens)}`, color: '#6e7bff' },
          { title: '生图（次）', value: number(imageCount), hint: '成功产出的图片数量', color: '#38bdf8' },
          { title: '生视频', value: `${number(videoCount)} 次`, hint: `${number(videoSeconds, 2)} 秒 · ${number(videoTokens)} tokens${failureCount ? ` · ${failureCount} 次失败` : ''}`, color: '#a78bfa' },
        ].map((item) => <article key={item.title} className="rounded-[12px] border border-white/[.075] bg-[var(--fos-bg-2)] p-4"><div className="flex items-center gap-2 text-[11px] text-white/42"><i className="h-7 w-7 rounded-[7px]" style={{ background: `${item.color}19`, boxShadow: `inset 0 0 0 1px ${item.color}28` }} />{item.title}</div><strong className="mt-3 block text-[24px] font-semibold tracking-tight text-white">{loading ? '—' : item.value}</strong><small className="mt-1 block text-[10px] text-white/28">{item.hint}</small></article>)}
      </section>

      <ReportCard title="消耗趋势" subtitle={`${dailyRows.length} 个活跃日期 · 累计积分`}><CumulativeLineChart rows={dailyRows} /></ReportCard>
      <ReportCard title="作品消耗分布" subtitle={`${projectRows.length} 个作品`}><HorizontalBars rows={projectRows} valueLabel={(value) => `${number(value, 2)} 积分`} /></ReportCard>

      <div className="grid gap-3 xl:grid-cols-2">
        <ReportCard title="成员消耗排行" subtitle={`${accountRows.length} 个账号`}><HorizontalBars rows={accountRows} valueLabel={(value) => `${number(value, 2)} 积分`} /></ReportCard>
        <ReportCard title="模型积分分布" subtitle="按积分消耗"><DonutChart rows={modelRows} unit="积分" valueLabel={(value) => number(value, 2)} /></ReportCard>
      </div>

      <ReportCard title="账号 × 模型积分消耗" subtitle={`${accountModelRows.length} 个账号模型组合 · 导出内容随当前筛选条件变化`}>
        {loading ? <div className="flex h-28 items-center justify-center gap-2 text-[12px] text-white/40"><AppIcon name="loader" className="h-4 w-4 animate-spin" />正在汇总账号模型用量…</div> : accountModelRows.length === 0 ? <EmptyChart text="当前筛选范围暂无账号模型用量" /> : <div className="overflow-x-auto"><div className="min-w-[1180px]"><div className="grid grid-cols-[1.05fr_1.25fr_.75fr_1.2fr_.65fr_.55fr_.72fr_.78fr_.9fr] gap-3 border-b border-white/[.06] px-2 py-2 text-[10px] font-medium text-white/34"><span>账号 / 岗位</span><span>模型 / 类型</span><span>调用</span><span>Token</span><span>生成单位</span><span>作品</span><span>积分消耗</span><span>人民币成本</span><span>最近使用</span></div>{accountModelRows.map((row) => <div key={row.id} className="grid grid-cols-[1.05fr_1.25fr_.75fr_1.2fr_.65fr_.55fr_.72fr_.78fr_.9fr] items-center gap-3 border-b border-white/[.045] px-2 py-3 text-[11px] last:border-0"><div className="min-w-0"><strong className="block truncate font-medium text-white/78">{row.accountName}</strong><small className="mt-0.5 block truncate text-white/32">{row.accountRole || '未设置岗位'}</small></div><div className="min-w-0"><span className="block truncate text-white/66">{row.modelName}</span><small className="mt-0.5 block text-white/30">{serviceLabel(row.serviceType)}</small></div><div className="text-white/58"><span>{number(row.calls)} 次</span><small className="mt-0.5 block text-white/30">成功 {number(row.successCalls)} · 失败 {number(row.failureCalls)}</small></div><div className="font-mono text-white/56"><span>{number(row.totalTokens)}</span><small className="mt-0.5 block text-white/28">In {number(row.inputTokens)} · Out {number(row.outputTokens)}</small></div><span className="font-mono text-white/52">{number(row.units, 2)}</span><span className="font-mono text-white/52">{number(row.projectCount)}</span><strong className="font-mono font-semibold text-[#efb64b]">{number(row.points, 2)}</strong><span className="font-mono text-white/48">¥{number(row.cost, 4)}</span><time className="text-[10px] text-white/34">{new Date(row.lastUsedAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</time></div>)}</div></div>}
      </ReportCard>

      <ReportCard title="服务明细" subtitle="仅展示产品名称，不暴露内部任务代码">
        {loading ? <div className="flex h-28 items-center justify-center gap-2 text-[12px] text-white/40"><AppIcon name="loader" className="h-4 w-4 animate-spin" />正在汇总用量…</div> : filtered.length === 0 ? <EmptyChart text="当前筛选范围暂无服务记录" /> : <div className="overflow-x-auto"><div className="min-w-[900px]"><div className="grid grid-cols-[1.35fr_1fr_1fr_1fr_.72fr_.8fr] gap-3 border-b border-white/[.06] px-2 py-2 text-[10px] font-medium text-white/34"><span>服务</span><span>作品 / 账号</span><span>模型</span><span>用量</span><span>状态</span><span>时间</span></div>{filtered.slice(0, 30).map((record) => {
          const tokenTotal = record.inputTokens + record.outputTokens
          const usage = record.serviceType === 'video'
            ? [record.units > 0 ? `${number(record.units, 2)} 秒` : '', tokenTotal > 0 ? `${number(tokenTotal)} tokens` : ''].filter(Boolean).join(' · ') || '1 次调用'
            : tokenTotal > 0
              ? `${number(tokenTotal)} tokens`
              : record.serviceType === 'image'
                ? `${number(Math.max(1, record.units), 2)} 张`
                : `${number(Math.max(1, record.units), 2)} 次`
          return <div key={record.id} className="grid grid-cols-[1.35fr_1fr_1fr_1fr_.72fr_.8fr] items-center gap-3 border-b border-white/[.045] px-2 py-3 text-[11px] last:border-0"><div><strong className="block font-medium text-white/76">{operationLabel(record.operation, record.serviceType)}</strong><small className="mt-0.5 block text-white/30">{serviceLabel(record.serviceType)}</small></div><div className="min-w-0"><span className="block truncate text-white/62">{record.projectName}</span><small className="mt-0.5 block truncate text-white/30">{record.accountName}{record.accountRole ? ` · ${record.accountRole}` : ''}</small></div><span className="truncate text-white/54">{modelLabel(record)}</span><div className="text-white/54">{usage}<small className="mt-0.5 block text-[#e6a838]">{number(record.points, 2)} 积分</small></div><span className={`w-fit rounded-full border px-2 py-1 text-[10px] ${record.status === 'success' ? 'border-emerald-400/20 bg-emerald-400/[.08] text-emerald-200' : 'border-red-400/20 bg-red-400/[.08] text-red-200'}`}>{record.status === 'success' ? '成功' : '失败'}</span><time className="text-[10px] text-white/34">{new Date(record.createdAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</time></div>
        })}</div></div>}
      </ReportCard>
    </div>
  )
}
