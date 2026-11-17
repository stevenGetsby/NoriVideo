'use client'

import { useCallback, useEffect, useState } from 'react'
import { FosShell } from '@/components/frameos/FosShell'
import { AlertTriangle, Loader2, RefreshCw } from '@/components/ui/icons'
import { apiFetch } from '@/lib/api-fetch'
import type { MpWorkDraft } from '@/lib/mp/listing'
import type { PublishOverview } from '@/lib/mp/publish'
import { confirmAction, notify } from '@/lib/ui/feedback'
import { StoryLayerNav } from '../interactive/StoryLayerNav'
import { storyErrorMessage } from '../interactive/story-api-error'
import { ChannelsCard } from './ChannelsCard'
import { formatBeijing } from './format'
import { ListingCard, ScheduleCard, formFromListing, type ListingForm } from './ListingCards'
import { PreflightCard } from './PreflightCard'
import { ReleasesCard } from './ReleasesCard'
import { StatsCard } from './StatsCard'
import '../interactive/interactive.css'
import './mp-publish.css'

export function PublishClient({ workId, workName }: { workId: string; workName: string }) {
  const [data, setData] = useState<PublishOverview | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [form, setForm] = useState<ListingForm | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [rechecking, setRechecking] = useState(false)
  const [statusBusy, setStatusBusy] = useState(false)
  const endpoint = `/api/interactive/${encodeURIComponent(workId)}/publish`

  const load = useCallback(async (silent = false) => {
    if (!silent) setRechecking(true)
    try {
      const response = await apiFetch(endpoint)
      if (!response.ok) throw new Error(await storyErrorMessage(response, '加载发布信息失败'))
      const payload = await response.json() as PublishOverview
      setData(payload)
      setLoadError(null)
      setForm((current) => current ?? formFromListing(payload.listing, workName))
    } catch (error) {
      if (!silent) setLoadError(error instanceof Error ? error.message : '加载发布信息失败')
    } finally {
      if (!silent) setRechecking(false)
    }
  }, [endpoint, workName])

  useEffect(() => { void load() }, [load])

  const building = data?.releases.some((release) => release.status === 'building') ?? false
  useEffect(() => {
    if (!building) return
    const timer = setInterval(() => { void load(true) }, 3000)
    return () => clearInterval(timer)
  }, [building, load])

  const save = async () => {
    if (!form || saving) return
    setSaving(true)
    setFieldErrors({})
    try {
      const response = await apiFetch(`${endpoint}/listing`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, scheduledAt: form.scheduleMode === 'at' ? form.scheduledAt : null }),
      })
      if (!response.ok) {
        if (response.status === 400) {
          const payload = await response.json().catch(() => null) as { error?: { details?: { fields?: Record<string, string> } } } | null
          const fields = payload?.error?.details?.fields
          if (fields && Object.keys(fields).length > 0) {
            setFieldErrors(fields)
            notify('请检查标红的字段')
            return
          }
        }
        notify(await storyErrorMessage(response, '保存失败'))
        return
      }
      const payload = await response.json() as { listing: MpWorkDraft }
      setData((current) => (current ? { ...current, listing: payload.listing } : current))
      setForm(formFromListing(payload.listing, workName))
      notify('已保存，下次生成版本时生效', 'success')
    } catch {
      notify('保存失败：服务暂时不可用，请稍后重试')
    } finally {
      setSaving(false)
    }
  }

  const changeStatus = async (action: 'offline' | 'online') => {
    if (statusBusy) return
    if (action === 'offline') {
      const confirmed = await confirmAction({
        message: '下架后观众将无法看到和游玩这部作品，已有存档会保留。',
        confirmLabel: '下架',
        cancelLabel: '取消',
        danger: true,
      })
      if (!confirmed) return
    }
    setStatusBusy(true)
    try {
      const response = await apiFetch(`${endpoint}/${action}`, { method: 'POST' })
      if (!response.ok) throw new Error(await storyErrorMessage(response, action === 'offline' ? '下架失败' : '重新上线失败'))
      notify(action === 'offline' ? '已下架' : '已重新上线', 'success')
      await load(true)
    } catch (error) {
      notify(error instanceof Error ? error.message : '操作失败')
    } finally {
      setStatusBusy(false)
    }
  }

  if (!data) {
    return (
      <FosShell activeKey="interactive">
        <div className="nori-ix nori-mp-publish is-loading">
          {loadError ? (
            <div className="nori-mp-empty">
              <AlertTriangle />
              <p>{loadError}</p>
              <button type="button" className="fos-btn fos-btn-ghost" onClick={() => void load()}><RefreshCw />重试</button>
            </div>
          ) : <Loader2 className="nori-ix-spin" aria-label="加载中" />}
        </div>
      </FosShell>
    )
  }

  const listing = data.listing
  const status = listing?.status ?? 'draft'
  const capsule = status === 'scheduled' && listing?.scheduledAt
    ? `待上线 · ${formatBeijing(listing.scheduledAt)}`
    : status === 'live' ? '已上线'
      : status === 'offline' ? '已下架'
        : status === 'banned' ? '已被平台下架'
          : '未上架'

  return (
    <FosShell activeKey="interactive" titlebarTitle={workName}>
      <div className="nori-ix nori-mp-publish">
        <header className="nori-mp-head">
          <div>
            <h1>发布到小程序</h1>
            {status === 'banned' && listing?.bannedReason ? <p className="nori-mp-banned-reason">原因：{listing.bannedReason}</p> : null}
          </div>
          <div className="nori-mp-head-side">
            <span className={`nori-mp-capsule is-${status}`}>{capsule}</span>
            {status === 'live' ? (
              <button type="button" className="fos-btn fos-btn-ghost" disabled={statusBusy} onClick={() => void changeStatus('offline')}>下架</button>
            ) : null}
            {status === 'offline' ? (
              <button type="button" className="fos-btn fos-btn-ghost" disabled={statusBusy} onClick={() => void changeStatus('online')}>重新上线</button>
            ) : null}
          </div>
        </header>
        <StoryLayerNav workId={workId} active="story" />
        {loadError ? <div className="nori-ix-banner" role="alert">{loadError}</div> : null}
        <div className="nori-mp-body">
          {form ? (
            <ListingCard workId={workId} form={form} fieldErrors={fieldErrors} saving={saving} onChange={setForm} onSave={() => void save()} />
          ) : null}
          <PreflightCard preflight={data.preflight} chapters={data.chapters} workId={workId} rechecking={rechecking} onRecheck={() => void load()} />
          <ReleasesCard releases={data.releases} errors={data.preflight.errors} workId={workId} onChanged={() => void load(true)} />
          {form && listing?.firstLiveAt == null ? <ScheduleCard form={form} fieldErrors={fieldErrors} onChange={setForm} /> : null}
          <ChannelsCard workId={workId} />
          <StatsCard workId={workId} />
        </div>
      </div>
    </FosShell>
  )
}
