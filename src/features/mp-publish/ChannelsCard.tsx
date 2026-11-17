'use client'

import { useCallback, useEffect, useState } from 'react'
import { ViewportDialogLayer } from '@/components/frameos/ViewportDialogLayer'
import { X } from '@/components/ui/icons'
import { apiFetch } from '@/lib/api-fetch'
import type { ChannelRow, ChannelsOverview } from '@/lib/mp/channels'
import { notify } from '@/lib/ui/feedback'
import { storyErrorMessage } from '../interactive/story-api-error'

function CreateDialog({ endpoint, onClose, onCreated }: { endpoint: string; onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    setSubmitting(true)
    setError(null)
    try {
      const response = await apiFetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      })
      if (!response.ok) throw new Error(await storyErrorMessage(response, '创建渠道失败'))
      onCreated()
      onClose()
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '创建渠道失败')
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
          aria-label="新建渠道"
          onSubmit={(event) => { event.preventDefault(); void submit() }}
        >
          <header className="fos-dialog-head">
            <div>
              <div className="fos-dialog-title">新建渠道</div>
            </div>
            <button type="button" className="fos-dialog-x" disabled={submitting} onClick={onClose} aria-label="关闭"><X /></button>
          </header>
          <div className="fos-dialog-body nori-ix-dialog-body">
            <label className="nori-ix-field">
              <span>渠道名称</span>
              <input className="fos-input" value={name} maxLength={20} placeholder="例如：公众号推文 11 月" disabled={submitting} onChange={(event) => setName(event.target.value)} />
            </label>
            {error ? <p className="nori-ix-error" role="alert">{error}</p> : null}
          </div>
          <footer className="fos-dialog-foot">
            <button type="button" className="fos-btn fos-btn-ghost fos-btn-lg" disabled={submitting} onClick={onClose}>取消</button>
            <button type="submit" className="fos-btn fos-btn-primary fos-btn-lg" disabled={submitting || !name.trim()}>{submitting ? '创建中…' : '创建'}</button>
          </footer>
        </form>
      </div>
    </ViewportDialogLayer>
  )
}

export function ChannelsCard({ workId }: { workId: string }) {
  const [data, setData] = useState<ChannelsOverview | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const endpoint = `/api/interactive/${encodeURIComponent(workId)}/publish/channels`

  const load = useCallback(async () => {
    try {
      const response = await apiFetch(endpoint)
      if (!response.ok) throw new Error(await storyErrorMessage(response, '加载推广渠道失败'))
      setData(await response.json() as ChannelsOverview)
    } catch (error) {
      notify(error instanceof Error ? error.message : '加载推广渠道失败')
    }
  }, [endpoint])

  useEffect(() => { void load() }, [load])

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      notify('已复制', 'success')
    } catch {
      notify('复制失败')
    }
  }

  const copyUrlLink = async (channel: ChannelRow) => {
    setBusyId(channel.id)
    try {
      const response = await apiFetch(`${endpoint}/${encodeURIComponent(channel.id)}/url-link`, { method: 'POST' })
      if (!response.ok) throw new Error(await storyErrorMessage(response, '复制外链失败'))
      const payload = await response.json() as { urlLink: string }
      await copy(payload.urlLink)
      await load()
    } catch (error) {
      notify(error instanceof Error ? error.message : '复制外链失败')
    } finally {
      setBusyId(null)
    }
  }

  const archive = async (channel: ChannelRow) => {
    setBusyId(channel.id)
    try {
      const response = await apiFetch(`${endpoint}/${encodeURIComponent(channel.id)}/archive`, { method: 'POST' })
      if (!response.ok) throw new Error(await storyErrorMessage(response, '归档失败'))
      notify('已归档', 'success')
      await load()
    } catch (error) {
      notify(error instanceof Error ? error.message : '归档失败')
    } finally {
      setBusyId(null)
    }
  }

  if (!data) {
    return <section className="nori-mp-card"><h2>推广</h2><p className="nori-mp-placeholder">加载中…</p></section>
  }
  if (!data.available) {
    return <section className="nori-mp-card"><h2>推广</h2><p className="nori-mp-placeholder">作品上线后可以生成推广渠道</p></section>
  }

  return (
    <section className="nori-mp-card">
      <div className="nori-mp-card-head">
        <h2>推广</h2>
        <button type="button" className="fos-btn fos-btn-primary" onClick={() => setDialogOpen(true)}>新建渠道</button>
      </div>
      {data.channels.length === 0 ? <p className="nori-mp-placeholder">还没有渠道</p> : (
        <table className="nori-mp-table">
          <thead>
            <tr>
              <th>渠道</th>
              <th>小程序码</th>
              <th>小程序路径</th>
              {data.urlLinkEnabled ? <th>外链</th> : null}
              <th>新用户（30 天）</th>
              <th>游玩人数（30 天）</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {data.channels.map((channel) => (
              <tr key={channel.id}>
                <td>{channel.name}</td>
                <td>
                  {channel.wxacodeUrl
                    ? <a className="fos-btn fos-btn-ghost" href={channel.wxacodeUrl} target="_blank" rel="noreferrer" download>下载</a>
                    : '—'}
                </td>
                <td><button type="button" className="fos-btn fos-btn-ghost" onClick={() => void copy(channel.path)}>复制</button></td>
                {data.urlLinkEnabled ? (
                  <td><button type="button" className="fos-btn fos-btn-ghost" disabled={busyId === channel.id} onClick={() => void copyUrlLink(channel)}>复制</button></td>
                ) : null}
                <td>{channel.newUsers30d}</td>
                <td>{channel.players30d}</td>
                <td><button type="button" className="fos-btn fos-btn-ghost" disabled={busyId === channel.id} onClick={() => void archive(channel)}>归档</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="nori-mp-placeholder">小程序路径可以用在公众号文章、视频号和社群的小程序卡片里；外链可以放在短信和网页里，有效期 30 天，复制时会自动续期。</p>
      {dialogOpen ? <CreateDialog endpoint={endpoint} onClose={() => setDialogOpen(false)} onCreated={() => void load()} /> : null}
    </section>
  )
}
