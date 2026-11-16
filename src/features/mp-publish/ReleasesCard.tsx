'use client'

import { useState } from 'react'
import { ViewportDialogLayer } from '@/components/frameos/ViewportDialogLayer'
import { Loader2, X } from '@/components/ui/icons'
import { apiFetch } from '@/lib/api-fetch'
import type { ReleaseRow } from '@/lib/mp/publish'
import { notify } from '@/lib/ui/feedback'
import { storyErrorMessage } from '../interactive/story-api-error'
import { formatBeijing, formatDuration } from './format'

function GenerateDialog({ endpoint, onClose, onCreated }: { endpoint: string; onClose: () => void; onCreated: () => void }) {
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    setSubmitting(true)
    setError(null)
    try {
      const response = await apiFetch(`${endpoint}/releases`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({ note: note.trim() || undefined }),
      })
      if (!response.ok) throw new Error(await storyErrorMessage(response, '生成版本失败'))
      onCreated()
      onClose()
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '生成版本失败')
      setSubmitting(false)
    }
  }

  return (
    <ViewportDialogLayer>
      <div className="fos-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget && !submitting) onClose() }}>
        <form
          className="fos-dialog nori-ix nori-ix-dialog"
          role="dialog"
          aria-modal="true"
          aria-label="生成新版本"
          onSubmit={(event) => { event.preventDefault(); void submit() }}
        >
          <header className="fos-dialog-head">
            <div>
              <div className="fos-dialog-title">生成新版本</div>
            </div>
            <button type="button" className="fos-dialog-x" disabled={submitting} onClick={onClose} aria-label="关闭"><X /></button>
          </header>
          <div className="fos-dialog-body nori-ix-dialog-body">
            <label className="nori-ix-field">
              <span>版本说明（选填，审核人员可见）</span>
              <textarea className="fos-textarea" value={note} maxLength={200} rows={3} disabled={submitting} onChange={(event) => setNote(event.target.value)} />
            </label>
            <p className="nori-ix-note">生成需要几分钟，期间可以离开本页。</p>
            {error ? <p className="nori-ix-error" role="alert">{error}</p> : null}
          </div>
          <footer className="fos-dialog-foot">
            <button type="button" className="fos-btn fos-btn-ghost fos-btn-lg" disabled={submitting} onClick={onClose}>取消</button>
            <button type="submit" className="fos-btn fos-btn-primary fos-btn-lg" disabled={submitting}>{submitting ? '生成中…' : '开始生成'}</button>
          </footer>
        </form>
      </div>
    </ViewportDialogLayer>
  )
}

function StatusCell({ release, expanded, goingLive, onToggleIssues, onGoLive }: {
  release: ReleaseRow
  expanded: boolean
  goingLive: boolean
  onToggleIssues: () => void
  onGoLive: () => void
}) {
  if (release.status === 'building') return <span>生成中 {release.progress}%</span>
  if (release.status === 'build_failed') {
    return (
      <div className="nori-mp-status-stack">
        <span>生成失败</span>
        {release.failure ? <span className="nori-mp-failure">{release.failure}</span> : null}
        {release.issues?.length ? (
          <>
            <button type="button" className="nori-mp-link" onClick={onToggleIssues}>查看问题</button>
            {expanded ? (
              <ul className="nori-mp-issues">
                {release.issues.map((issue, index) => (
                  <li key={`${issue.code}:${issue.nodeId}:${index}`} className={`is-${issue.level}`}>
                    <span>{issue.level === 'error' ? '问题' : '提醒'}</span>
                    <p>{issue.message}</p>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        ) : null}
      </div>
    )
  }
  if (release.status === 'reviewing') return <span>审核中</span>
  if (release.status === 'rejected') {
    return (
      <div className="nori-mp-status-stack">
        <span>未通过</span>
        {release.reviewNote ? <span className="nori-mp-failure">驳回原因：{release.reviewNote}</span> : null}
      </div>
    )
  }
  if (release.status === 'approved') {
    return (
      <div className="nori-mp-status-stack">
        <span>已通过 · 待上线{release.scheduledAt ? ` · ${formatBeijing(release.scheduledAt)}` : ''}</span>
        <button type="button" className="fos-btn fos-btn-ghost" disabled={goingLive} onClick={onGoLive}>
          {goingLive ? <Loader2 className="nori-ix-spin" /> : null}立即上线
        </button>
      </div>
    )
  }
  if (release.status === 'live') return <span>线上版本</span>
  if (release.status === 'retired') return <span>历史版本</span>
  return <span>{release.status}</span>
}

export function ReleasesCard({ releases, errors, workId, onChanged }: {
  releases: ReleaseRow[]
  errors: number
  workId: string
  onChanged: () => void
}) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [goingLiveId, setGoingLiveId] = useState<string | null>(null)
  const endpoint = `/api/interactive/${encodeURIComponent(workId)}/publish`

  const goLive = async (releaseId: string) => {
    setGoingLiveId(releaseId)
    try {
      const response = await apiFetch(`${endpoint}/releases/${encodeURIComponent(releaseId)}/go-live`, { method: 'POST' })
      if (!response.ok) throw new Error(await storyErrorMessage(response, '上线失败'))
      notify('已上线', 'success')
      onChanged()
    } catch (error) {
      notify(error instanceof Error ? error.message : '上线失败')
    } finally {
      setGoingLiveId(null)
    }
  }

  return (
    <section className="nori-mp-card">
      <div className="nori-mp-card-head">
        <h2>版本</h2>
        <button
          type="button"
          className="fos-btn fos-btn-primary"
          disabled={errors > 0}
          title={errors > 0 ? '先修复所有错误' : undefined}
          onClick={() => setDialogOpen(true)}
        >
          生成新版本
        </button>
      </div>
      {releases.length === 0 ? <p className="nori-mp-placeholder">还没有版本</p> : (
        <table className="nori-mp-table">
          <thead>
            <tr><th>版本</th><th>状态</th><th>生成时间</th><th>时长</th><th>说明</th></tr>
          </thead>
          <tbody>
            {releases.map((release) => (
              <tr key={release.id}>
                <td>v{release.version}</td>
                <td>
                  <StatusCell
                    release={release}
                    expanded={expandedId === release.id}
                    goingLive={goingLiveId === release.id}
                    onToggleIssues={() => setExpandedId((current) => (current === release.id ? null : release.id))}
                    onGoLive={() => void goLive(release.id)}
                  />
                </td>
                <td>{formatBeijing(release.createdAt)}</td>
                <td>{formatDuration(release.totalDurationSec)}</td>
                <td>{release.note || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {dialogOpen ? <GenerateDialog endpoint={endpoint} onClose={() => setDialogOpen(false)} onCreated={onChanged} /> : null}
    </section>
  )
}
