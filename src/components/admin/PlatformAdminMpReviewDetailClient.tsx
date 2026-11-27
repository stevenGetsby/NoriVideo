'use client'

import { useEffect, useMemo, useState } from 'react'
import { Link } from '@/i18n/navigation'
import { ArrowLeft, Loader2, Play } from '@/components/ui/icons'
import { ViewportDialogLayer } from '@/components/frameos/ViewportDialogLayer'
import { AdminAlert, AdminEmpty, AdminSearch, PlatformAdminShell } from '@/components/admin/PlatformAdminShell'
import { apiFetch } from '@/lib/api-fetch'
import { readApiErrorMessage } from '@/lib/api/read-error-message'
import type { ReviewDetailPayload } from '@/lib/mp/review'
import { confirmAction, notify } from '@/lib/ui/feedback'
import { formatBeijing, formatDuration } from '@/features/mp-publish/format'
import './admin-mp.css'

const STATUS_LABELS: Record<string, string> = {
  building: '生成中',
  build_failed: '生成失败',
  reviewing: '审核中',
  rejected: '已驳回',
  approved: '已通过',
  live: '线上版本',
  retired: '历史版本',
}

const STATUS_TONES: Record<string, string> = {
  building: 'is-info',
  build_failed: 'is-bad',
  reviewing: 'is-warn',
  rejected: 'is-bad',
  approved: 'is-ok',
  live: 'is-ok',
  retired: '',
}

export function PlatformAdminMpReviewDetailClient({ releaseId }: { releaseId: string }) {
  const [data, setData] = useState<ReviewDetailPayload | null>(null)
  const [loadError, setLoadError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const [busy, setBusy] = useState(false)
  const [rejectOpen, setRejectOpen] = useState(false)
  const [rejectNote, setRejectNote] = useState('')
  const [textQuery, setTextQuery] = useState('')
  const [playingId, setPlayingId] = useState<string | null>(null)

  const base = `/api/admin/mp/releases/${encodeURIComponent(releaseId)}`

  useEffect(() => {
    let cancelled = false
    setLoadError('')
    void (async () => {
      try {
        const response = await apiFetch(base, { cache: 'no-store' })
        if (!response.ok) throw new Error(await readApiErrorMessage(response, '读取版本详情失败'))
        const payload = await response.json() as ReviewDetailPayload
        if (!cancelled) setData(payload)
      } catch (error) {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : '读取版本详情失败')
      }
    })()
    return () => { cancelled = true }
  }, [base, reloadKey])

  const texts = useMemo(() => data?.meta?.texts ?? [], [data])
  const filteredTexts = useMemo(() => {
    const query = textQuery.trim().toLowerCase()
    if (!query) return texts
    return texts.filter((item) => item.where.toLowerCase().includes(query) || item.text.toLowerCase().includes(query))
  }, [texts, textQuery])

  const approve = async () => {
    if (!await confirmAction({ message: '通过后将按创作者的上线设置上线。', confirmLabel: '通过', cancelLabel: '取消' })) return
    setBusy(true)
    try {
      const response = await apiFetch(`${base}/approve`, { method: 'POST' })
      if (!response.ok) throw new Error(await readApiErrorMessage(response, '通过失败'))
      notify('已通过', 'success')
      setReloadKey((key) => key + 1)
    } catch (error) {
      notify(error instanceof Error ? error.message : '通过失败')
    } finally {
      setBusy(false)
    }
  }

  const rejectLength = [...rejectNote.trim()].length
  const canReject = rejectLength >= 5 && rejectLength <= 200 && !busy

  const reject = async () => {
    if (!canReject) return
    setBusy(true)
    try {
      const response = await apiFetch(`${base}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: rejectNote.trim() }),
      })
      if (!response.ok) throw new Error(await readApiErrorMessage(response, '驳回失败'))
      notify('已驳回', 'success')
      setRejectOpen(false)
      setRejectNote('')
      setReloadKey((key) => key + 1)
    } catch (error) {
      notify(error instanceof Error ? error.message : '驳回失败')
    } finally {
      setBusy(false)
    }
  }

  const meta = data?.meta ?? null
  const release = data?.release ?? null
  const warnings = (release?.issues ?? []).filter((issue) => issue.level === 'warning')
  const chapterTitle = (projectId: string | null) => meta?.chapters.find((chapter) => chapter.projectId === projectId)?.title ?? null

  return (
    <PlatformAdminShell
      active="mp-review"
      eyebrow="平台管理"
      title={meta && release ? `${meta.title} · v${release.version}` : '版本详情'}
      description={data ? `${meta?.creatorName || '—'} · 提交人 ${data.submitterName || '—'} · ${formatBeijing(data.release.createdAt)}` : '加载中…'}
      actions={<Link href="/admin/mp-review" className="fos-btn fos-btn-ghost"><ArrowLeft />返回列表</Link>}
    >
      {loadError ? (
        <AdminAlert tone="error" action={<button type="button" onClick={() => setReloadKey((key) => key + 1)}>重试</button>}>{loadError}</AdminAlert>
      ) : !data || !release ? (
        <AdminEmpty>加载中…</AdminEmpty>
      ) : (
        <div className="nori-mp-review-detail">
          <div className="nori-mp-review-status-bar">
            <span className={`nori-admin-pill ${STATUS_TONES[release.status] ?? ''}`}>
              <i />{STATUS_LABELS[release.status] ?? release.status}
            </span>
            {release.status === 'rejected' && release.reviewNote ? (
              <p className="nori-mp-review-status">驳回原因：{release.reviewNote}</p>
            ) : null}
            {release.note ? <p className="nori-mp-review-note">版本说明：{release.note}</p> : null}
          </div>
          {!meta ? (
            <AdminEmpty>版本尚未生成完成</AdminEmpty>
          ) : (
            <>
              <section className="nori-admin-panel">
                <div className="nori-admin-panel-head"><h2>上架信息预览</h2></div>
                <div className="nori-admin-panel-body nori-mp-review-listing">
                  <div className="nori-mp-review-covers">
                    <figure>
                      {data.coverUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={data.coverUrl} alt="竖版封面" />
                      ) : <span className="nori-mp-review-missing">无封面</span>}
                      <figcaption>竖版封面</figcaption>
                    </figure>
                    <figure className="is-share">
                      {data.shareCoverUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={data.shareCoverUrl} alt="分享封面" />
                      ) : <span className="nori-mp-review-missing">无封面</span>}
                      <figcaption>分享封面</figcaption>
                    </figure>
                  </div>
                  <dl className="nori-mp-review-meta">
                    <div><dt>作品名</dt><dd>{meta.title}</dd></div>
                    <div><dt>一句话简介</dt><dd>{meta.tagline || '—'}</dd></div>
                    <div><dt>详细介绍</dt><dd className="is-synopsis">{meta.synopsis || '—'}</dd></div>
                    <div><dt>标签</dt><dd>{meta.tags.length ? meta.tags.join('、') : '—'}</dd></div>
                    <div><dt>主题色</dt><dd><span className="nori-mp-review-accent" style={{ background: meta.accentColor }} aria-hidden="true" />{meta.accentColor}</dd></div>
                  </dl>
                  <div className="nori-mp-review-trailer">
                    <span>预告片</span>
                    {data.trailerUrl ? (
                      <video controls preload="metadata" poster={data.trailerPosterUrl ?? undefined} src={data.trailerUrl} />
                    ) : <p className="nori-admin-muted">无预告片</p>}
                  </div>
                </div>
              </section>

              <section className="nori-admin-panel">
                <div className="nori-admin-panel-head">
                  <h2>文本</h2>
                  <AdminSearch value={textQuery} onChange={setTextQuery} placeholder="搜索文本" />
                </div>
                <div className="nori-admin-panel-body">
                  {filteredTexts.length === 0 ? (
                    <p className="nori-admin-muted">{texts.length === 0 ? '无文本' : '没有匹配的文本'}</p>
                  ) : (
                    <ul className="nori-mp-review-texts">
                      {filteredTexts.map((item, index) => (
                        <li key={`${item.where}-${index}`}><span>{item.where}</span><p>{item.text}</p></li>
                      ))}
                    </ul>
                  )}
                </div>
              </section>

              <section className="nori-admin-panel">
                <div className="nori-admin-panel-head"><h2>视频</h2></div>
                <div className="nori-admin-panel-body">
                  {data.videos.length === 0 ? (
                    <p className="nori-admin-muted">无视频</p>
                  ) : (
                    <div className="nori-mp-review-grid">
                      {data.videos.map((video) => (
                        <div key={video.id} className="nori-mp-review-tile">
                          {playingId === video.id && video.playUrl ? (
                            <video controls autoPlay src={video.playUrl} className="nori-mp-review-player" />
                          ) : (
                            <button type="button" className="nori-mp-review-sheet" disabled={!video.playUrl} onClick={() => setPlayingId(video.id)} aria-label={`播放 ${video.where.join('、') || video.id}`}>
                              {video.sheetUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={video.sheetUrl} alt="" />
                              ) : <span className="nori-mp-review-missing">无联系表</span>}
                              {video.playUrl ? <span className="nori-mp-review-play"><Play /></span> : null}
                            </button>
                          )}
                          <div className="nori-mp-review-tile-meta">
                            <span>{formatDuration(video.durationSec)}</span>
                            <p>{video.where.join('、') || '—'}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </section>

              <section className="nori-admin-panel">
                <div className="nori-admin-panel-head"><h2>图片</h2></div>
                <div className="nori-admin-panel-body">
                  {data.images.length === 0 ? (
                    <p className="nori-admin-muted">无图片</p>
                  ) : (
                    <div className="nori-mp-review-grid">
                      {data.images.map((image) => (
                        <div key={image.id} className="nori-mp-review-tile">
                          {image.url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img className="nori-mp-review-image" src={image.url} alt={image.where.join('、') || image.id} />
                          ) : <span className="nori-mp-review-missing">无图片</span>}
                          <div className="nori-mp-review-tile-meta"><p>{image.where.join('、') || '—'}</p></div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </section>

              <section className="nori-admin-panel">
                <div className="nori-admin-panel-head"><h2>检查结果</h2></div>
                <div className="nori-admin-panel-body">
                  {warnings.length === 0 ? (
                    <p className="nori-admin-muted">无警告</p>
                  ) : (
                    <ul className="nori-mp-review-texts">
                      {warnings.map((issue, index) => (
                        <li key={`${issue.code}-${index}`}><span>提醒</span><p>{chapterTitle(issue.projectId) ? `${chapterTitle(issue.projectId)} · ` : ''}{issue.message}</p></li>
                      ))}
                    </ul>
                  )}
                </div>
              </section>

              <p className="nori-mp-review-points">审核要点：政治敏感、色情低俗、暴力血腥、侵权（明星脸、知名 IP、未授权音乐）、未成年人不宜、诱导分享或诱导关注的文案。</p>
            </>
          )}
          {release.status === 'reviewing' ? (
            <div className="nori-mp-review-bar">
              <button type="button" className="fos-btn fos-btn-ghost" disabled={busy} onClick={() => setRejectOpen(true)}>驳回</button>
              <button type="button" className="fos-btn fos-btn-primary" disabled={busy} onClick={() => void approve()}>
                {busy ? <Loader2 className="nori-mp-spin" /> : null}通过
              </button>
            </div>
          ) : null}
        </div>
      )}
      {rejectOpen ? (
        <ViewportDialogLayer>
          <div className="fos-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setRejectOpen(false) }}>
            <section role="dialog" aria-modal="true" aria-label="驳回原因（创作者可见）" className="fos-dialog nori-mp-review-dialog">
              <div className="fos-dialog-head"><h2>驳回原因（创作者可见）</h2></div>
              <div className="fos-dialog-body">
                <textarea className="fos-textarea" rows={4} maxLength={200} value={rejectNote} disabled={busy} placeholder="5–200 字" onChange={(event) => setRejectNote(event.target.value)} />
                <small className="nori-mp-review-count">{rejectLength}/200</small>
              </div>
              <div className="fos-dialog-foot">
                <button type="button" className="fos-btn fos-btn-ghost" disabled={busy} onClick={() => setRejectOpen(false)}>取消</button>
                <button type="button" className="fos-btn fos-btn-primary" disabled={!canReject} onClick={() => void reject()}>
                  {busy ? <Loader2 className="nori-mp-spin" /> : null}驳回
                </button>
              </div>
            </section>
          </div>
        </ViewportDialogLayer>
      ) : null}
    </PlatformAdminShell>
  )
}
