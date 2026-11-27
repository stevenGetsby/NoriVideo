'use client'

import { useEffect, useMemo, useState } from 'react'
import { Link } from '@/i18n/navigation'
import { AppIcon } from '@/components/ui/icons'
import { AdminAlert, AdminEmpty, AdminLoading, AdminSearch, PlatformAdminShell } from '@/components/admin/PlatformAdminShell'
import { apiFetch } from '@/lib/api-fetch'
import { readApiErrorMessage } from '@/lib/api/read-error-message'
import type { ReviewListPayload, ReviewTab } from '@/lib/mp/review'
import { formatBeijing, formatDuration } from '@/features/mp-publish/format'
import './admin-mp.css'

export function PlatformAdminMpReviewClient() {
  const [tab, setTab] = useState<ReviewTab>('pending')
  const [query, setQuery] = useState('')
  const [data, setData] = useState<ReviewListPayload | null>(null)
  const [loadError, setLoadError] = useState('')
  const [loading, setLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setLoadError('')
    void (async () => {
      try {
        const response = await apiFetch(`/api/admin/mp/releases?status=${tab === 'done' ? 'done' : 'reviewing'}`, { cache: 'no-store' })
        if (!response.ok) throw new Error(await readApiErrorMessage(response, '读取审核列表失败'))
        const payload = await response.json() as ReviewListPayload
        if (cancelled) return
        setData(payload)
      } catch (error) {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : '读取审核列表失败')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [tab, reloadKey])

  const items = useMemo(() => {
    const raw = data?.items ?? []
    const normalized = query.trim().toLowerCase()
    if (!normalized) return raw
    return raw.filter((item) =>
      (item.title || '').toLowerCase().includes(normalized)
      || (item.creatorName || '').toLowerCase().includes(normalized)
      || (item.submitterName || '').toLowerCase().includes(normalized))
  }, [data, query])

  return (
    <PlatformAdminShell
      active="mp-review"
      eyebrow="平台管理"
      title="内容审核"
      description="小程序作品版本审核，先到先审。"
      actions={(
        <button type="button" className="fos-btn fos-btn-ghost" disabled={loading} onClick={() => setReloadKey((key) => key + 1)}>
          <AppIcon name="refresh" className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          刷新列表
        </button>
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="nori-mp-review-tabs mb-0" role="tablist" aria-label="审核列表">
          <button type="button" role="tab" aria-selected={tab === 'pending'} className={`nori-mp-review-tab${tab === 'pending' ? ' is-active' : ''}`} onClick={() => setTab('pending')}>
            待审核（{data?.pendingCount ?? 0}）
          </button>
          <button type="button" role="tab" aria-selected={tab === 'done'} className={`nori-mp-review-tab${tab === 'done' ? ' is-active' : ''}`} onClick={() => setTab('done')}>
            已处理
          </button>
        </div>
        <AdminSearch value={query} onChange={setQuery} placeholder="搜索作品名、署名或提交人" />
      </div>
      {loadError ? (
        <AdminAlert tone="error" action={<button type="button" onClick={() => setReloadKey((key) => key + 1)}>重试</button>}>{loadError}</AdminAlert>
      ) : loading && !data ? (
        <AdminLoading label="正在读取审核队列…" />
      ) : items.length === 0 ? (
        <AdminEmpty icon="clipboardCheck" description={query ? '可尝试清空搜索关键词' : undefined}>
          {query ? '没有匹配的审核版本' : tab === 'pending' ? '暂无待审核版本' : '暂无已处理版本'}
        </AdminEmpty>
      ) : (
        <div className="nori-admin-panel">
          <div className="nori-admin-table-wrap">
            <table className="nori-admin-table">
              <thead>
                <tr>
                  <th>作品名</th>
                  <th>版本号</th>
                  <th>出品署名</th>
                  <th>提交人</th>
                  <th>提交时间</th>
                  <th>时长</th>
                  <th>素材数</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td><Link href={`/admin/mp-review/${encodeURIComponent(item.id)}`} className="nori-mp-review-title-link">{item.title || '—'}</Link></td>
                    <td><span className="nori-admin-pill">v{item.version}</span></td>
                    <td>{item.creatorName || '—'}</td>
                    <td>{item.submitterName || '—'}</td>
                    <td className="nori-admin-muted">{formatBeijing(item.createdAt)}</td>
                    <td>{formatDuration(item.totalDurationSec)}</td>
                    <td>{item.mediaCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </PlatformAdminShell>
  )
}
