'use client'

/**
 * 管理员算力账本外壳（§11.1）：标题 + TeamManagementTabs + 分段控件 + 横幅。
 * 只做状态与拼装：tab 写进 URL ?tab=；面板自取数并通过 onStatus 汇报同步状态驱动横幅与自动重取。
 */
import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api-fetch'
import { FosShell } from './FosShell'
import { TeamManagementTabs } from './TeamManagementTabs'
import { LedgerOverviewTable } from './compute-ledger/LedgerOverviewTable'
import { LedgerReportTable } from './compute-ledger/LedgerReportTable'
import { LedgerEntriesPanel } from './compute-ledger/LedgerEntriesPanel'
import { LedgerSettingsPanel } from './compute-ledger/LedgerSettingsPanel'
import { useLedgerSync } from './compute-ledger/use-ledger-sync'
import type { LedgerStatus, OverviewResponse, ReportView } from './compute-ledger/ledger-types'

type Tab = 'overview' | 'day' | 'week' | 'tri' | 'entries' | 'settings'
const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'overview', label: '算力表' },
  { key: 'day', label: '日报' },
  { key: 'week', label: '周' },
  { key: 'tri', label: '三日' },
  { key: 'entries', label: '手填记录' },
  { key: 'settings', label: '设置' },
]

function readTab(): Tab {
  if (typeof window === 'undefined') return 'overview'
  const value = new URLSearchParams(window.location.search).get('tab')
  return TABS.some((tab) => tab.key === value) ? (value as Tab) : 'overview'
}

export function FosComputeLedgerClient() {
  const [tab, setTab] = useState<Tab>(readTab)
  const [status, setStatus] = useState<LedgerStatus>({})
  const [refreshToken, setRefreshToken] = useState(0)

  const onStatus = useCallback((partial: LedgerStatus) => setStatus((current) => ({ ...current, ...partial })), [])
  const onRefresh = useCallback(() => setRefreshToken((current) => current + 1), [])
  const { exhausted } = useLedgerSync(status.complete, onRefresh)

  const switchTab = (next: Tab) => {
    setTab(next)
    setStatus((current) => ({ ...current, error: '' }))
    window.history.replaceState(null, '', `?tab=${next}`)
  }

  useEffect(() => {
    if (status.billingMode !== undefined) return
    let cancelled = false
    void (async () => {
      try {
        const response = await apiFetch('/api/admin/compute-ledger/overview', { cache: 'no-store' })
        if (!response.ok) return
        const data = await response.json() as OverviewResponse
        if (!cancelled) setStatus((current) => ({ ...current, billingMode: data.sync.billingMode, complete: data.sync.complete, syncedThroughDate: data.sync.syncedThroughDate }))
      } catch {
        /* 横幅种子失败时由面板错误条兜底 */
      }
    })()
    return () => { cancelled = true }
  }, [status.billingMode, refreshToken])

  const panelProps = { refreshToken, onStatus, onRefresh }
  const billingWarning = status.billingMode !== undefined && status.billingMode !== 'ENFORCE'
  const syncing = status.complete === false

  return (
    <FosShell activeKey="accounts">
      <div className="fos-scroll">
        <section className="mx-auto w-full max-w-[1280px] px-8 py-7" data-testid="compute-ledger">
          <div className="mb-6">
            <h1 className="text-[24px] font-bold text-white">团队管理</h1>
            <p className="mt-1 text-[12px] text-white/40">算力账本：平台自动记录的花费 + 手填的外部花费，按上海时间自然日计算，仅管理员可见。</p>
          </div>

          <TeamManagementTabs active="ledger" />

          <div className="mb-5 mt-4 fos-seg" role="group" aria-label="账本视图">
            {TABS.map((item) => (
              <button key={item.key} type="button" className={`fos-seg-opt${tab === item.key ? ' active' : ''}`} aria-pressed={tab === item.key} onClick={() => switchTab(item.key)}>{item.label}</button>
            ))}
          </div>

          {billingWarning ? (
            <div role="status" className="fos-ledger-banner mb-4 border-[var(--fos-warning)]/40 bg-[var(--fos-warning)]/10 text-white/85">
              当前环境的计费模式是 <strong>{status.billingMode}</strong>，平台不会写入消耗流水，算力账本里「平台自动」一栏不会有数据；手填记录不受影响。
            </div>
          ) : syncing ? (
            <div role="status" className="fos-ledger-banner mb-4 border-white/15 bg-white/[.05] text-white/80">
              {exhausted ? '数据较多，请稍后点「立即刷新」继续。' : `正在补齐历史数据（已到 ${status.syncedThroughDate ?? '—'}）…`}
            </div>
          ) : status.error ? (
            <div role="alert" className="fos-ledger-banner mb-4 border-[var(--fos-danger)]/40 bg-[var(--fos-danger)]/10 text-white/85">
              <span>{status.error}</span>
              <button type="button" className="underline" onClick={onRefresh}>重试</button>
            </div>
          ) : null}

          {tab === 'overview' ? <LedgerOverviewTable {...panelProps} />
            : tab === 'day' || tab === 'week' || tab === 'tri' ? <LedgerReportTable view={tab as ReportView} {...panelProps} />
            : tab === 'entries' ? <LedgerEntriesPanel {...panelProps} />
            : <LedgerSettingsPanel {...panelProps} />}
        </section>
      </div>
    </FosShell>
  )
}
