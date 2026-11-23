'use client'

/**
 * 设置（§11.5）：汇率 + 同步水位 + 立即刷新；底部「历史导入」折叠区（§12.6，P4）。
 * 导入默认只 dry-run；commit 需 errors 为空，有重叠要勾选确认；真实数据提交由用户拍板（§16 Q1）。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { AppIcon } from '@/components/ui/icons'
import { apiFetch } from '@/lib/api-fetch'
import { readApiErrorMessage } from '@/lib/api/read-error-message'
import { formatCny, formatMoney } from './ledger-format'
import type { ImportReport, LedgerPanelProps, LedgerSettingsView } from './ledger-types'

type CarryChoice = 'A' | 'B' | 'C'

function formatSyncTime(iso: string | null): string {
  if (!iso) return '—'
  const shifted = new Date(new Date(iso).getTime() + 8 * 3600 * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())} ${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`
}

export function LedgerSettingsPanel({ refreshToken, onStatus, onRefresh }: LedgerPanelProps) {
  const [settings, setSettings] = useState<LedgerSettingsView | null>(null)
  const [tokenRate, setTokenRate] = useState('')
  const [jimengRate, setJimengRate] = useState('')
  const [saving, setSaving] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const [importOpen, setImportOpen] = useState(false)
  const [fileName, setFileName] = useState('')
  const [payload, setPayload] = useState<unknown>(null)
  const [carry, setCarry] = useState<CarryChoice>('A')
  const [report, setReport] = useState<ImportReport | null>(null)
  const [ackOverlap, setAckOverlap] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState('')
  const [batchId, setBatchId] = useState('')
  const [rollbackInfo, setRollbackInfo] = useState('')
  const loadedRef = useRef(false)

  const load = useCallback(async () => {
    try {
      const response = await apiFetch('/api/admin/compute-ledger/settings', { cache: 'no-store' })
      if (!response.ok) throw new Error(await readApiErrorMessage(response, '获取设置失败'))
      const data = await response.json() as LedgerSettingsView
      setSettings(data)
      if (!loadedRef.current) {
        setTokenRate(String(data.tokenRateCnyPerMillion))
        setJimengRate(String(data.jimengCnyPerPoint))
        loadedRef.current = true
      }
      onStatus({ error: '' })
    } catch (cause) {
      onStatus({ error: cause instanceof Error ? cause.message : '获取设置失败' })
    }
  }, [onStatus])

  useEffect(() => { void load() }, [load, refreshToken])

  const save = async () => {
    setSaving(true)
    setError('')
    setMessage('')
    try {
      const response = await apiFetch('/api/admin/compute-ledger/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tokenRateCnyPerMillion: Number(tokenRate), jimengCnyPerPoint: Number(jimengRate) }),
      })
      if (!response.ok) throw new Error(await readApiErrorMessage(response, '保存失败'))
      const data = await response.json() as LedgerSettingsView
      setSettings(data)
      setMessage('已保存。修改汇率只影响之后新记的条目。')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const refreshNow = async () => {
    setSyncing(true)
    setError('')
    try {
      const response = await apiFetch('/api/admin/compute-ledger/sync?refresh=1', { method: 'POST' })
      if (!response.ok) throw new Error(await readApiErrorMessage(response, '刷新失败'))
      await load()
      onRefresh()
      setMessage('已触发平台数据刷新。')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '刷新失败')
    } finally {
      setSyncing(false)
    }
  }

  const onFile = async (file: File | undefined) => {
    if (!file) return
    setImportError('')
    setReport(null)
    setBatchId('')
    setRollbackInfo('')
    setFileName(file.name)
    try {
      const text = await file.text()
      setPayload(JSON.parse(text))
    } catch {
      setPayload(null)
      setImportError('文件不是合法 JSON。请先用转换器把 xlsx 转成 JSON。')
    }
  }

  const carryForward = carry === 'B' ? 'stated-total' : 'none'

  const dryRun = async () => {
    if (!payload) return
    setImporting(true)
    setImportError('')
    setRollbackInfo('')
    try {
      const response = await apiFetch('/api/admin/compute-ledger/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'dry-run', carryForward, payload }),
      })
      if (!response.ok) throw new Error(await readApiErrorMessage(response, 'dry-run 失败'))
      setReport(await response.json() as ImportReport)
      setAckOverlap(false)
    } catch (cause) {
      setImportError(cause instanceof Error ? cause.message : 'dry-run 失败')
    } finally {
      setImporting(false)
    }
  }

  const commit = async () => {
    if (!payload || !report) return
    setImporting(true)
    setImportError('')
    try {
      const response = await apiFetch('/api/admin/compute-ledger/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'commit', carryForward, acknowledgeOverlap: ackOverlap, expectedHash: report.reportHash, payload }),
      })
      if (!response.ok) throw new Error(await readApiErrorMessage(response, '导入失败'))
      const result = await response.json() as ImportReport
      setReport(result)
      setBatchId(result.batchId ?? '')
      onRefresh()
    } catch (cause) {
      setImportError(cause instanceof Error ? cause.message : '导入失败')
    } finally {
      setImporting(false)
    }
  }

  const rollback = async () => {
    if (!batchId) return
    setImporting(true)
    setImportError('')
    try {
      const response = await apiFetch('/api/admin/compute-ledger/import/rollback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batchId }),
      })
      if (!response.ok) throw new Error(await readApiErrorMessage(response, '撤销失败'))
      const result = await response.json() as { batchId: string; voided: number }
      setRollbackInfo(`已撤销本次导入，作废 ${result.voided} 条。`)
      setBatchId('')
      setReport(null)
      onRefresh()
    } catch (cause) {
      setImportError(cause instanceof Error ? cause.message : '撤销失败')
    } finally {
      setImporting(false)
    }
  }

  const canCommit = !!report && report.errors.length === 0 && carry !== 'C'
    && (report.overlaps.length === 0 || ackOverlap)

  return (
    <div className="grid gap-5">
      <section className="rounded-[12px] border border-white/[.07] bg-[rgb(var(--nori-bg-2))] p-5">
        <h2 className="text-[15px] font-bold text-white">汇率</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="grid gap-1.5">
            <span className="text-[12px] text-white/55">API token 单价（元 / 百万 token）</span>
            <input type="number" className="fos-input" value={tokenRate} step={0.000001} min={0} onChange={(event) => setTokenRate(event.target.value)} />
          </label>
          <label className="grid gap-1.5">
            <span className="text-[12px] text-white/55">即梦积分单价（元 / 积分）</span>
            <input type="number" className="fos-input" value={jimengRate} step={0.000001} min={0} onChange={(event) => setJimengRate(event.target.value)} />
          </label>
        </div>
        <p className="mt-3 text-[12px] leading-5 text-white/55">修改汇率只影响之后新记的条目，已记的条目保持当时的单价和金额不变。</p>
        <p className="mt-1 text-[11px] leading-5 text-white/40">平台快照只增不减；若平台里曾有被删除的错误流水，要纠正请记一条负数校准条目（直接填元，必须带备注），不要试图改小快照。</p>
        <div className="mt-4 flex items-center gap-3">
          <button type="button" className="fos-btn fos-btn-primary" disabled={saving} onClick={() => void save()}>{saving ? '保存中…' : '保存汇率'}</button>
          {message ? <span className="text-[12px] text-[var(--fos-success)]">{message}</span> : null}
          {error ? <span className="text-[12px] text-[var(--fos-danger-text)]">{error}</span> : null}
        </div>
      </section>

      <section className="rounded-[12px] border border-white/[.07] bg-[rgb(var(--nori-bg-2))] p-5">
        <h2 className="text-[15px] font-bold text-white">平台自动记账</h2>
        <p className="mt-2 text-[12px] text-white/60">同步到 <strong className="text-white">{settings?.syncedThroughDate ?? '—'}</strong> · 上次同步 {formatSyncTime(settings?.lastSyncAt ?? null)}（上海时间）</p>
        <button type="button" className="fos-btn mt-3" disabled={syncing} onClick={() => void refreshNow()}><AppIcon name="refresh" className="h-4 w-4" />{syncing ? '刷新中…' : '立即刷新平台数据'}</button>
      </section>

      <section className="rounded-[12px] border border-white/[.07] bg-[rgb(var(--nori-bg-2))] p-5">
        <button type="button" className="flex w-full items-center justify-between text-[15px] font-bold text-white" onClick={() => setImportOpen((current) => !current)}>
          <span>历史导入（xlsx → JSON）</span>
          <AppIcon name={importOpen ? 'chevronUp' : 'chevronDown'} className="h-4 w-4" />
        </button>
        {importOpen ? (
          <div className="mt-4 grid gap-4">
            <p className="text-[11px] leading-5 text-white/45">先用转换器把 xlsx 转成 JSON（见 scripts/ledger-xlsx-to-json.py），再选择文件。默认只 dry-run；真实数据提交前请核对附录 A 的验收数字。</p>
            <label className="grid gap-1.5">
              <span className="text-[12px] text-white/55">JSON 文件{fileName ? `：${fileName}` : ''}</span>
              <input type="file" accept=".json,application/json" className="fos-input" onChange={(event) => void onFile(event.target.files?.[0])} />
            </label>
            <div className="grid gap-1.5">
              <span className="text-[12px] text-white/55">期初结转方案</span>
              {([['A', 'A：不结转，只导入日报行'], ['B', 'B：按表格「项目算力总消耗」补齐期初差额'], ['C', 'C：暂不导入（仅查看）']] as Array<[CarryChoice, string]>).map(([value, label]) => (
                <label key={value} className="flex items-center gap-2 text-[12px] text-white/70">
                  <input type="radio" name="carry" checked={carry === value} onChange={() => { setCarry(value); setReport(null) }} />{label}
                </label>
              ))}
            </div>
            <div className="flex items-center gap-3">
              <button type="button" className="fos-btn" disabled={!payload || importing || carry === 'C'} onClick={() => void dryRun()}>{importing ? '处理中…' : '开始 dry-run'}</button>
            </div>
            {importError ? <div role="alert" className="rounded-[9px] border border-[var(--fos-danger)]/40 bg-[var(--fos-danger)]/10 px-3 py-2 text-[12px] text-[var(--fos-danger-text)]">{importError}</div> : null}
            {rollbackInfo ? <div className="rounded-[9px] border border-[var(--fos-success)]/40 bg-[var(--fos-success)]/10 px-3 py-2 text-[12px] text-white/80">{rollbackInfo}</div> : null}

            {report ? (
              <div className="grid gap-3 rounded-[9px] border border-white/[.07] bg-white/[.02] p-4">
                <div className="flex flex-wrap gap-x-5 gap-y-1 text-[12px] text-white/70">
                  <span>行数 <strong className="text-white">{report.summary.rows}</strong></span>
                  <span>空行 <strong className="text-white">{report.summary.emptyRows}</strong></span>
                  <span>将建条目 <strong className="text-white">{report.summary.entriesToCreate}</strong></span>
                  <span>已导入过 <strong className="text-white">{report.summary.alreadyImported}</strong></span>
                  <span>新建项目 <strong className="text-white">{report.summary.projectsNew}</strong></span>
                  <span>复用项目 <strong className="text-white">{report.summary.projectsMatched}</strong></span>
                  <span>关联作品 <strong className="text-white">{report.summary.projectsLinkedToWork}</strong></span>
                  <span>匹配提交人 <strong className="text-white">{report.summary.actorsMatched}</strong></span>
                  <span>未匹配 <strong className="text-white">{report.summary.actorsUnmatched}</strong></span>
                  <span>导入金额 <strong className="text-white">{formatCny(report.summary.importedCny)}</strong></span>
                  <span>期初结转 <strong className="text-white">{formatCny(report.summary.carryForwardCny)}</strong></span>
                </div>

                {report.errors.length > 0 ? (
                  <div className="rounded-[9px] border border-[var(--fos-danger)]/40 bg-[var(--fos-danger)]/10 px-3 py-2 text-[12px] text-[var(--fos-danger-text)]">
                    <strong>错误（{report.errors.length}，必须修复后才能导入）：</strong>
                    <ul className="mt-1 list-disc pl-5">{report.errors.slice(0, 50).map((item, index) => <li key={index}>第 {item.rowNo} 行：{item.reason}</li>)}</ul>
                  </div>
                ) : null}

                {report.warnings.length > 0 ? (
                  <div className="rounded-[9px] border border-[var(--fos-warning)]/40 bg-[var(--fos-warning)]/10 px-3 py-2 text-[12px] text-white/80">
                    <strong>提示（{report.warnings.length}）：</strong>
                    <ul className="mt-1 list-disc pl-5">{report.warnings.slice(0, 50).map((item, index) => <li key={index}>{item}</li>)}</ul>
                  </div>
                ) : null}

                {report.overlaps.length > 0 ? (
                  <div className="grid gap-1 text-[12px] text-white/75">
                    <strong className="text-white">与平台自动记账重叠（可能重复计算）：</strong>
                    {report.overlaps.map((item, index) => (
                      <span key={index}>{item.project}（{item.from} ~ {item.to}）：平台 {formatCny(item.platformCny)} · 导入 {formatCny(item.importedCny)}</span>
                    ))}
                    <label className="mt-1 flex items-center gap-2 text-white/80">
                      <input type="checkbox" checked={ackOverlap} onChange={(event) => setAckOverlap(event.target.checked)} />我已知晓重叠，仍然导入
                    </label>
                  </div>
                ) : null}

                <div className="overflow-x-auto">
                  <table className="w-full text-[12px] text-white/75">
                    <thead><tr className="text-left text-white/45"><th className="py-1 pr-3">项目</th><th className="py-1 pr-3">动作</th><th className="py-1 pr-3">关联作品</th><th className="py-1 pr-3 text-right">行数</th><th className="py-1 pr-3 text-right">导入金额</th><th className="py-1 pr-3 text-right">期初结转</th></tr></thead>
                    <tbody>
                      {report.projects.map((project) => (
                        <tr key={project.name} className="border-t border-white/[.05]">
                          <td className="py-1 pr-3">{project.name}</td>
                          <td className="py-1 pr-3">{project.action === 'create' ? '新建' : '复用'}</td>
                          <td className="py-1 pr-3">{project.linkedWork ? '是' : '否'}</td>
                          <td className="py-1 pr-3 text-right">{project.rows}</td>
                          <td className="py-1 pr-3 text-right">{formatMoney(project.importedCny)}</td>
                          <td className="py-1 pr-3 text-right">{formatMoney(project.carryForwardCny)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {report.actors.some((actor) => actor.matchedUserId == null) ? (
                  <div className="text-[12px] text-white/70">
                    <strong className="text-white">未匹配提交人（按名字记账）：</strong>
                    <span className="ml-2">{report.actors.filter((actor) => actor.matchedUserId == null).map((actor) => `${actor.name}（${actor.rows}）`).join('、')}</span>
                  </div>
                ) : null}

                {report.mode === 'commit' && batchId ? (
                  <div className="flex flex-wrap items-center gap-3 rounded-[9px] border border-[var(--fos-success)]/40 bg-[var(--fos-success)]/10 px-3 py-2 text-[12px] text-white/85">
                    <span>导入成功，批次 <strong className="text-white">{batchId}</strong></span>
                    <button type="button" className="fos-btn fos-btn-sm fos-btn-danger" disabled={importing} onClick={() => void rollback()}>撤销本次导入</button>
                  </div>
                ) : (
                  <div className="flex items-center gap-3">
                    <button type="button" className="fos-btn fos-btn-primary" disabled={!canCommit || importing} onClick={() => void commit()}>{importing ? '导入中…' : '确认导入'}</button>
                    {report.errors.length > 0 ? <span className="text-[12px] text-[var(--fos-danger-text)]">有错误，不能导入。</span> : null}
                    {carry === 'C' ? <span className="text-[12px] text-white/45">方案 C 不导入。</span> : null}
                  </div>
                )}
              </div>
            ) : null}
          </div>
        ) : null}
      </section>
    </div>
  )
}
