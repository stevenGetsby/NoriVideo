'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { AdminAlert, AdminEmpty, PlatformAdminShell } from '@/components/admin/PlatformAdminShell'
import { ViewportDialogLayer } from '@/components/frameos/ViewportDialogLayer'
import { apiFetch } from '@/lib/api-fetch'
import { readApiErrorMessage } from '@/lib/api/read-error-message'
import { confirmAction, notify } from '@/lib/ui/feedback'
import { formatBeijing } from '@/features/mp-publish/format'
import type { OpsChannelRow, OpsReportRow, OpsSlotRow, OpsTopicRow, OpsWorkRow } from '@/lib/mp/ops'
import './admin-mp.css'

type OpsTab = 'slots' | 'topics' | 'channels' | 'works' | 'reports'

const TABS: Array<{ key: OpsTab; label: string }> = [
  { key: 'slots', label: '推荐位' },
  { key: 'topics', label: '专题' },
  { key: 'channels', label: '渠道码' },
  { key: 'works', label: '作品管理' },
  { key: 'reports', label: '举报' },
]

const PLACEMENT_LABEL: Record<string, string> = { home_hero: '首页大图', home_pick: '编辑精选' }
const WORK_STATUS_LABEL: Record<string, string> = { draft: '未上架', scheduled: '待上线', live: '已上线', offline: '已下架', banned: '已封禁' }
const TOPIC_STATUS_LABEL: Record<string, string> = { draft: '草稿', live: '已上线', ended: '已结束' }

function useOpsList<T>(url: string) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    void (async () => {
      try {
        const response = await apiFetch(url, { cache: 'no-store' })
        if (!response.ok) throw new Error(await readApiErrorMessage(response, '加载失败'))
        const payload = await response.json() as T
        if (!cancelled) setData(payload)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : '加载失败')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [url, reloadKey])
  return { data, error, loading, reload: () => setReloadKey((key) => key + 1) }
}

async function sendJson(url: string, body?: unknown, method = 'POST'): Promise<Response> {
  const response = await apiFetch(url, body === undefined
    ? { method }
    : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (!response.ok) throw new Error(await readApiErrorMessage(response, '操作失败'))
  return response
}

async function uploadImage(file: File): Promise<string> {
  const form = new FormData()
  form.append('file', file)
  const response = await apiFetch('/api/admin/mp/uploads', { method: 'POST', body: form })
  if (!response.ok) throw new Error(await readApiErrorMessage(response, '上传失败'))
  const payload = await response.json() as { key: string }
  return payload.key
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback
}

function formatWindow(startsAt: string | null, endsAt: string | null): string {
  if (!startsAt && !endsAt) return '长期'
  return `${startsAt ? formatBeijing(startsAt) : '不限'} 至 ${endsAt ? formatBeijing(endsAt) : '不限'}`
}

function toLocalInput(iso: string | null): string {
  if (!iso) return ''
  const at = new Date(iso)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`
}

function ListGuard({ error, loading, hasData, onRetry, children }: { error: string; loading: boolean; hasData: boolean; onRetry: () => void; children: ReactNode }) {
  if (error) return <AdminAlert tone="error" action={<button type="button" onClick={onRetry}>重试</button>}>{error}</AdminAlert>
  if (loading && !hasData) return <AdminEmpty>加载中…</AdminEmpty>
  return <>{children}</>
}

function OpsDialog({ label, busy, onClose, foot, children }: { label: string; busy: boolean; onClose: () => void; foot: ReactNode; children: ReactNode }) {
  return (
    <ViewportDialogLayer>
      <div className="fos-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose() }}>
        <section role="dialog" aria-modal="true" aria-label={label} className="fos-dialog nori-mp-review-dialog nori-mp-ops-dialog">
          <div className="fos-dialog-head"><h2>{label}</h2></div>
          <div className="fos-dialog-body">{children}</div>
          <div className="fos-dialog-foot">{foot}</div>
        </section>
      </div>
    </ViewportDialogLayer>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div className="nori-mp-ops-field"><span>{label}</span>{children}</div>
}

function ImageField({ label, imageKey, busy, onUploaded }: { label: string; imageKey: string; busy: boolean; onUploaded: (key: string) => void }) {
  const [uploading, setUploading] = useState(false)
  return (
    <Field label={label}>
      <input
        type="file"
        accept="image/*"
        className="fos-input"
        disabled={busy || uploading}
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (!file) return
          setUploading(true)
          void uploadImage(file)
            .then(onUploaded)
            .catch((err) => notify(errorMessage(err, '上传失败')))
            .finally(() => setUploading(false))
        }}
      />
      {uploading ? <small className="nori-mp-ops-hint">上传中…</small> : imageKey ? <small className="nori-mp-ops-hint">已上传</small> : null}
    </Field>
  )
}

function WorkSearch({ exclude, disabled, onPick }: { exclude?: string[]; disabled?: boolean; onPick: (work: OpsWorkRow) => void }) {
  const [q, setQ] = useState('')
  const [items, setItems] = useState<OpsWorkRow[]>([])
  const excludeKey = (exclude ?? []).join(',')
  useEffect(() => {
    let cancelled = false
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const response = await apiFetch(`/api/admin/mp/works?q=${encodeURIComponent(q)}`, { cache: 'no-store' })
          if (!response.ok) return
          const payload = await response.json() as { items: OpsWorkRow[] }
          if (cancelled) return
          const excluded = new Set(excludeKey ? excludeKey.split(',') : [])
          setItems(payload.items
            .filter((work) => (work.status === 'live' || work.status === 'scheduled') && !excluded.has(work.id))
            .slice(0, 8))
        } catch { /* 搜索失败不打断表单 */ }
      })()
    }, 250)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [q, excludeKey])
  return (
    <div className="nori-mp-ops-search">
      <input className="fos-input" value={q} disabled={disabled} placeholder="搜索作品名或 slug" onChange={(event) => setQ(event.target.value)} />
      {items.length ? (
        <ul className="nori-mp-ops-picks">
          {items.map((work) => (
            <li key={work.id}>
              <button type="button" disabled={disabled} onClick={() => { onPick(work); setQ(''); setItems([]) }}>
                {work.title}<span>{WORK_STATUS_LABEL[work.status] ?? work.status}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

function TopicSelect({ value, disabled, onChange }: { value: string; disabled?: boolean; onChange: (id: string) => void }) {
  const [items, setItems] = useState<OpsTopicRow[]>([])
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const response = await apiFetch('/api/admin/mp/topics', { cache: 'no-store' })
        if (!response.ok) return
        const payload = await response.json() as { items: OpsTopicRow[] }
        if (!cancelled) setItems(payload.items)
      } catch { /* 列表失败时保留空选项 */ }
    })()
    return () => { cancelled = true }
  }, [])
  return (
    <select className="fos-input" value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
      <option value="">选择专题</option>
      {items.map((topic) => <option key={topic.id} value={topic.id}>{topic.title}</option>)}
    </select>
  )
}

function TimeFields({ startsAt, endsAt, disabled, onChange }: { startsAt: string; endsAt: string; disabled: boolean; onChange: (startsAt: string, endsAt: string) => void }) {
  return (
    <>
      <Field label="开始时间（可选）">
        <input type="datetime-local" className="fos-input" value={startsAt} disabled={disabled} onChange={(event) => onChange(event.target.value, endsAt)} />
      </Field>
      <Field label="结束时间（可选）">
        <input type="datetime-local" className="fos-input" value={endsAt} disabled={disabled} onChange={(event) => onChange(startsAt, event.target.value)} />
      </Field>
    </>
  )
}

// ---------- 推荐位 ----------

function SlotDialog({ slot, onClose, onSaved }: { slot: OpsSlotRow | null; onClose: () => void; onSaved: () => void }) {
  const [placement, setPlacement] = useState(slot?.placement ?? 'home_hero')
  const [targetKind, setTargetKind] = useState<'work' | 'topic'>(slot?.topicId ? 'topic' : 'work')
  const [mpWorkId, setMpWorkId] = useState(slot?.mpWorkId ?? '')
  const [workTitle, setWorkTitle] = useState(slot?.mpWorkId ? slot.targetTitle : '')
  const [topicId, setTopicId] = useState(slot?.topicId ?? '')
  const [title, setTitle] = useState(slot?.title ?? '')
  const [subtitle, setSubtitle] = useState(slot?.subtitle ?? '')
  const [imageKey, setImageKey] = useState(slot?.imageKey ?? '')
  const [startsAt, setStartsAt] = useState(toLocalInput(slot?.startsAt ?? null))
  const [endsAt, setEndsAt] = useState(toLocalInput(slot?.endsAt ?? null))
  const [enabled, setEnabled] = useState(slot?.enabled ?? true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const canSave = (targetKind === 'work' ? Boolean(mpWorkId) : Boolean(topicId)) && !busy

  const save = async () => {
    setBusy(true)
    setError('')
    try {
      const body = {
        placement,
        mpWorkId: targetKind === 'work' ? mpWorkId : null,
        topicId: targetKind === 'topic' ? topicId : null,
        title: title || null,
        subtitle: subtitle || null,
        imageKey: imageKey || null,
        startsAt: startsAt || null,
        endsAt: endsAt || null,
        enabled,
      }
      if (slot) await sendJson(`/api/admin/mp/slots/${slot.id}`, body, 'PATCH')
      else await sendJson('/api/admin/mp/slots', body)
      notify('已保存', 'success')
      onSaved()
      onClose()
    } catch (err) {
      setError(errorMessage(err, '保存失败'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <OpsDialog
      label={slot ? '编辑推荐位' : '新建推荐位'}
      busy={busy}
      onClose={onClose}
      foot={(
        <>
          <button type="button" className="fos-btn fos-btn-ghost" disabled={busy} onClick={onClose}>取消</button>
          <button type="button" className="fos-btn fos-btn-primary fos-btn-lg" disabled={!canSave} onClick={() => void save()}>保存</button>
        </>
      )}
    >
      <Field label="位置">
        <select className="fos-input" value={placement} disabled={busy} onChange={(event) => setPlacement(event.target.value)}>
          <option value="home_hero">首页大图</option>
          <option value="home_pick">编辑精选</option>
        </select>
      </Field>
      <Field label="目标">
        <select className="fos-input" value={targetKind} disabled={busy} onChange={(event) => setTargetKind(event.target.value as 'work' | 'topic')}>
          <option value="work">作品</option>
          <option value="topic">专题</option>
        </select>
      </Field>
      {targetKind === 'work' ? (
        <Field label="选择作品（已上线或待上线）">
          {mpWorkId ? <p className="nori-mp-ops-hint">已选：{workTitle}</p> : null}
          <WorkSearch disabled={busy} onPick={(work) => { setMpWorkId(work.id); setWorkTitle(work.title) }} />
        </Field>
      ) : (
        <Field label="选择专题">
          <TopicSelect value={topicId} disabled={busy} onChange={setTopicId} />
        </Field>
      )}
      <Field label="标题（可选，默认用目标标题）">
        <input className="fos-input" value={title} maxLength={30} disabled={busy} onChange={(event) => setTitle(event.target.value)} />
      </Field>
      <Field label="副标题（可选）">
        <input className="fos-input" value={subtitle} maxLength={40} disabled={busy} onChange={(event) => setSubtitle(event.target.value)} />
      </Field>
      <ImageField label="图片（可选，默认用目标封面）" imageKey={imageKey} busy={busy} onUploaded={setImageKey} />
      <TimeFields startsAt={startsAt} endsAt={endsAt} disabled={busy} onChange={(nextStart, nextEnd) => { setStartsAt(nextStart); setEndsAt(nextEnd) }} />
      <label className="nori-mp-ops-check">
        <input type="checkbox" checked={enabled} disabled={busy} onChange={(event) => setEnabled(event.target.checked)} />启用
      </label>
      {error ? <p className="nori-mp-ops-error">{error}</p> : null}
    </OpsDialog>
  )
}

function SlotsTab() {
  const { data, error, loading, reload } = useOpsList<{ items: OpsSlotRow[] }>('/api/admin/mp/slots')
  const [filter, setFilter] = useState('all')
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<OpsSlotRow | null>(null)
  const [busyId, setBusyId] = useState('')
  const all = data?.items ?? []
  const items = all.filter((row) => filter === 'all' || row.placement === filter)

  const move = async (row: OpsSlotRow, direction: 'up' | 'down') => {
    setBusyId(row.id)
    try {
      await sendJson(`/api/admin/mp/slots/${row.id}`, { move: direction }, 'PATCH')
      reload()
    } catch (err) {
      notify(errorMessage(err, '操作失败'))
    } finally {
      setBusyId('')
    }
  }

  const remove = async (row: OpsSlotRow) => {
    if (!await confirmAction({ message: '删除后不可恢复。', confirmLabel: '删除', cancelLabel: '取消' })) return
    setBusyId(row.id)
    try {
      await sendJson(`/api/admin/mp/slots/${row.id}`, undefined, 'DELETE')
      notify('已删除', 'success')
      reload()
    } catch (err) {
      notify(errorMessage(err, '删除失败'))
    } finally {
      setBusyId('')
    }
  }

  return (
    <ListGuard error={error} loading={loading} hasData={Boolean(data)} onRetry={reload}>
      <div className="nori-mp-ops-toolbar">
        <select className="fos-input" value={filter} onChange={(event) => setFilter(event.target.value)}>
          <option value="all">全部位置</option>
          <option value="home_hero">首页大图</option>
          <option value="home_pick">编辑精选</option>
        </select>
        <button type="button" className="fos-btn fos-btn-primary" onClick={() => setCreating(true)}>新建推荐位</button>
      </div>
      {items.length === 0 ? (
        <AdminEmpty>还没有推荐位</AdminEmpty>
      ) : (
        <div className="nori-admin-panel">
          <div className="nori-admin-table-wrap">
            <table className="nori-admin-table">
              <thead>
                <tr><th>位置</th><th>目标</th><th>标题</th><th>排序</th><th>生效时间</th><th>状态</th><th>操作</th></tr>
              </thead>
              <tbody>
                {items.map((row) => {
                  const siblings = all.filter((item) => item.placement === row.placement)
                  const index = siblings.findIndex((item) => item.id === row.id)
                  return (
                    <tr key={row.id}>
                      <td>{PLACEMENT_LABEL[row.placement] ?? row.placement}</td>
                      <td>{row.targetTitle}</td>
                      <td>{row.title || '—'}</td>
                      <td>
                        <div className="nori-mp-ops-row-actions">
                          <button type="button" className="fos-btn fos-btn-ghost" disabled={busyId === row.id || index <= 0} onClick={() => void move(row, 'up')}>↑</button>
                          <button type="button" className="fos-btn fos-btn-ghost" disabled={busyId === row.id || index >= siblings.length - 1} onClick={() => void move(row, 'down')}>↓</button>
                        </div>
                      </td>
                      <td>{formatWindow(row.startsAt, row.endsAt)}</td>
                      <td>{row.enabled ? '启用' : '停用'}</td>
                      <td>
                        <div className="nori-mp-ops-row-actions">
                          <button type="button" className="fos-btn fos-btn-ghost" disabled={busyId === row.id} onClick={() => setEditing(row)}>编辑</button>
                          <button type="button" className="fos-btn fos-btn-ghost" disabled={busyId === row.id} onClick={() => void remove(row)}>删除</button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {creating ? <SlotDialog slot={null} onClose={() => setCreating(false)} onSaved={reload} /> : null}
      {editing ? <SlotDialog slot={editing} onClose={() => setEditing(null)} onSaved={reload} /> : null}
    </ListGuard>
  )
}

// ---------- 专题 ----------

function TopicDialog({ topic, onClose, onSaved }: { topic: OpsTopicRow | null; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState(topic?.title ?? '')
  const [subtitle, setSubtitle] = useState(topic?.subtitle ?? '')
  const [description, setDescription] = useState(topic?.description ?? '')
  const [coverKey, setCoverKey] = useState(topic?.coverKey ?? '')
  const [works, setWorks] = useState<Array<{ id: string; title: string }>>(topic?.works ?? [])
  const [status, setStatus] = useState(topic?.status ?? 'draft')
  const [startsAt, setStartsAt] = useState(toLocalInput(topic?.startsAt ?? null))
  const [endsAt, setEndsAt] = useState(toLocalInput(topic?.endsAt ?? null))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const canSave = Boolean(title.trim()) && Boolean(description.trim()) && works.length >= 2 && works.length <= 30 && !busy

  const moveWork = (index: number, direction: -1 | 1) => {
    const target = index + direction
    if (target < 0 || target >= works.length) return
    const next = [...works]
    const [item] = next.splice(index, 1)
    next.splice(target, 0, item)
    setWorks(next)
  }

  const save = async () => {
    setBusy(true)
    setError('')
    try {
      const body = {
        title, subtitle, description,
        coverKey: coverKey || null,
        mpWorkIds: works.map((work) => work.id),
        status,
        startsAt: startsAt || null,
        endsAt: endsAt || null,
      }
      if (topic) await sendJson(`/api/admin/mp/topics/${topic.id}`, body, 'PATCH')
      else await sendJson('/api/admin/mp/topics', body)
      notify('已保存', 'success')
      onSaved()
      onClose()
    } catch (err) {
      setError(errorMessage(err, '保存失败'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <OpsDialog
      label={topic ? '编辑专题' : '新建专题'}
      busy={busy}
      onClose={onClose}
      foot={(
        <>
          <button type="button" className="fos-btn fos-btn-ghost" disabled={busy} onClick={onClose}>取消</button>
          <button type="button" className="fos-btn fos-btn-primary fos-btn-lg" disabled={!canSave} onClick={() => void save()}>保存</button>
        </>
      )}
    >
      <Field label="标题">
        <input className="fos-input" value={title} maxLength={30} disabled={busy} onChange={(event) => setTitle(event.target.value)} />
      </Field>
      <Field label="副标题（可选）">
        <input className="fos-input" value={subtitle} maxLength={60} disabled={busy} onChange={(event) => setSubtitle(event.target.value)} />
      </Field>
      <Field label="介绍">
        <textarea className="fos-textarea" rows={4} value={description} disabled={busy} onChange={(event) => setDescription(event.target.value)} />
      </Field>
      <ImageField label="封面（可选，16:9）" imageKey={coverKey} busy={busy} onUploaded={setCoverKey} />
      <Field label={`作品列表（2–30 部，已选 ${works.length}）`}>
        <WorkSearch exclude={works.map((work) => work.id)} disabled={busy || works.length >= 30} onPick={(work) => setWorks((prev) => [...prev, { id: work.id, title: work.title }])} />
        {works.length ? (
          <ul className="nori-mp-ops-works">
            {works.map((work, index) => (
              <li key={work.id}>
                <span>{index + 1}. {work.title}</span>
                <div className="nori-mp-ops-row-actions">
                  <button type="button" className="fos-btn fos-btn-ghost" disabled={busy || index === 0} onClick={() => moveWork(index, -1)}>↑</button>
                  <button type="button" className="fos-btn fos-btn-ghost" disabled={busy || index === works.length - 1} onClick={() => moveWork(index, 1)}>↓</button>
                  <button type="button" className="fos-btn fos-btn-ghost" disabled={busy} onClick={() => setWorks((prev) => prev.filter((item) => item.id !== work.id))}>移除</button>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </Field>
      <Field label="状态">
        <select className="fos-input" value={status} disabled={busy} onChange={(event) => setStatus(event.target.value)}>
          <option value="draft">草稿</option>
          <option value="live">已上线</option>
          <option value="ended">已结束</option>
        </select>
      </Field>
      <TimeFields startsAt={startsAt} endsAt={endsAt} disabled={busy} onChange={(nextStart, nextEnd) => { setStartsAt(nextStart); setEndsAt(nextEnd) }} />
      {error ? <p className="nori-mp-ops-error">{error}</p> : null}
    </OpsDialog>
  )
}

function TopicsTab() {
  const { data, error, loading, reload } = useOpsList<{ items: OpsTopicRow[] }>('/api/admin/mp/topics')
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<OpsTopicRow | null>(null)
  const [busyId, setBusyId] = useState('')
  const items = data?.items ?? []

  const remove = async (row: OpsTopicRow) => {
    if (!await confirmAction({ message: '删除后不可恢复。', confirmLabel: '删除', cancelLabel: '取消' })) return
    setBusyId(row.id)
    try {
      await sendJson(`/api/admin/mp/topics/${row.id}`, undefined, 'DELETE')
      notify('已删除', 'success')
      reload()
    } catch (err) {
      notify(errorMessage(err, '删除失败'))
    } finally {
      setBusyId('')
    }
  }

  return (
    <ListGuard error={error} loading={loading} hasData={Boolean(data)} onRetry={reload}>
      <div className="nori-mp-ops-toolbar">
        <button type="button" className="fos-btn fos-btn-primary" onClick={() => setCreating(true)}>新建专题</button>
      </div>
      {items.length === 0 ? (
        <AdminEmpty>还没有专题</AdminEmpty>
      ) : (
        <div className="nori-admin-panel">
          <div className="nori-admin-table-wrap">
            <table className="nori-admin-table">
              <thead>
                <tr><th>标题</th><th>作品数</th><th>状态</th><th>生效时间</th><th>创建时间</th><th>操作</th></tr>
              </thead>
              <tbody>
                {items.map((row) => (
                  <tr key={row.id}>
                    <td>{row.title}</td>
                    <td>{row.works.length}</td>
                    <td>{TOPIC_STATUS_LABEL[row.status] ?? row.status}</td>
                    <td>{formatWindow(row.startsAt, row.endsAt)}</td>
                    <td>{formatBeijing(row.createdAt)}</td>
                    <td>
                      <div className="nori-mp-ops-row-actions">
                        <button type="button" className="fos-btn fos-btn-ghost" disabled={busyId === row.id} onClick={() => setEditing(row)}>编辑</button>
                        <button type="button" className="fos-btn fos-btn-ghost" disabled={busyId === row.id} onClick={() => void remove(row)}>删除</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {creating ? <TopicDialog topic={null} onClose={() => setCreating(false)} onSaved={reload} /> : null}
      {editing ? <TopicDialog topic={editing} onClose={() => setEditing(null)} onSaved={reload} /> : null}
    </ListGuard>
  )
}

// ---------- 渠道码 ----------

function ChannelDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState('')
  const [targetKind, setTargetKind] = useState<'home' | 'work' | 'topic'>('home')
  const [mpWorkId, setMpWorkId] = useState('')
  const [workTitle, setWorkTitle] = useState('')
  const [topicId, setTopicId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const canSave = Boolean(name.trim()) && (targetKind === 'home' || (targetKind === 'work' ? Boolean(mpWorkId) : Boolean(topicId))) && !busy

  const save = async () => {
    setBusy(true)
    setError('')
    try {
      await sendJson('/api/admin/mp/channels', {
        name,
        mpWorkId: targetKind === 'work' ? mpWorkId : null,
        topicId: targetKind === 'topic' ? topicId : null,
      })
      notify('已创建', 'success')
      onSaved()
      onClose()
    } catch (err) {
      setError(errorMessage(err, '创建失败'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <OpsDialog
      label="新建渠道"
      busy={busy}
      onClose={onClose}
      foot={(
        <>
          <button type="button" className="fos-btn fos-btn-ghost" disabled={busy} onClick={onClose}>取消</button>
          <button type="button" className="fos-btn fos-btn-primary fos-btn-lg" disabled={!canSave} onClick={() => void save()}>创建</button>
        </>
      )}
    >
      <Field label="渠道名称">
        <input className="fos-input" value={name} maxLength={20} disabled={busy} placeholder="例如：公众号推文 11 月" onChange={(event) => setName(event.target.value)} />
      </Field>
      <Field label="落地页">
        <select className="fos-input" value={targetKind} disabled={busy} onChange={(event) => setTargetKind(event.target.value as 'home' | 'work' | 'topic')}>
          <option value="home">首页</option>
          <option value="work">作品</option>
          <option value="topic">专题</option>
        </select>
      </Field>
      {targetKind === 'work' ? (
        <Field label="选择作品（已上线或待上线）">
          {mpWorkId ? <p className="nori-mp-ops-hint">已选：{workTitle}</p> : null}
          <WorkSearch disabled={busy} onPick={(work) => { setMpWorkId(work.id); setWorkTitle(work.title) }} />
        </Field>
      ) : null}
      {targetKind === 'topic' ? (
        <Field label="选择专题">
          <TopicSelect value={topicId} disabled={busy} onChange={setTopicId} />
        </Field>
      ) : null}
      {error ? <p className="nori-mp-ops-error">{error}</p> : null}
    </OpsDialog>
  )
}

function ChannelsTab() {
  const { data, error, loading, reload } = useOpsList<{ urlLinkEnabled: boolean; channels: OpsChannelRow[] }>('/api/admin/mp/channels')
  const [creating, setCreating] = useState(false)
  const [busyId, setBusyId] = useState('')
  const channels = data?.channels ?? []

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      notify('已复制', 'success')
    } catch {
      notify('复制失败')
    }
  }

  const copyLink = async (row: OpsChannelRow) => {
    setBusyId(row.id)
    try {
      const response = await sendJson(`/api/admin/mp/channels/${row.id}/url-link`)
      const payload = await response.json() as { urlLink: string }
      await navigator.clipboard.writeText(payload.urlLink)
      notify('已复制', 'success')
      reload()
    } catch (err) {
      notify(errorMessage(err, '复制失败'))
    } finally {
      setBusyId('')
    }
  }

  const archive = async (row: OpsChannelRow) => {
    if (!await confirmAction({ message: '归档后不再出现在列表里，已生成的码仍然可以打开作品。', confirmLabel: '归档', cancelLabel: '取消' })) return
    setBusyId(row.id)
    try {
      await sendJson(`/api/admin/mp/channels/${row.id}/archive`)
      notify('已归档', 'success')
      reload()
    } catch (err) {
      notify(errorMessage(err, '归档失败'))
    } finally {
      setBusyId('')
    }
  }

  return (
    <ListGuard error={error} loading={loading} hasData={Boolean(data)} onRetry={reload}>
      <div className="nori-mp-ops-toolbar">
        <button type="button" className="fos-btn fos-btn-primary" onClick={() => setCreating(true)}>新建渠道</button>
      </div>
      {channels.length === 0 ? (
        <AdminEmpty>还没有渠道</AdminEmpty>
      ) : (
        <div className="nori-admin-panel">
          <div className="nori-admin-table-wrap">
            <table className="nori-admin-table">
              <thead>
                <tr>
                  <th>渠道</th><th>目标</th><th>小程序码</th><th>小程序路径</th>
                  {data?.urlLinkEnabled ? <th>外链</th> : null}
                  <th>新用户（30 天）</th><th>游玩人数（30 天）</th><th>操作</th>
                </tr>
              </thead>
              <tbody>
                {channels.map((row) => (
                  <tr key={row.id}>
                    <td>{row.name}</td>
                    <td>{row.target}</td>
                    <td>{row.wxacodeUrl ? <a className="fos-btn fos-btn-ghost" href={row.wxacodeUrl} target="_blank" rel="noreferrer" download>下载</a> : '—'}</td>
                    <td><button type="button" className="fos-btn fos-btn-ghost" disabled={busyId === row.id} onClick={() => void copyText(row.path)}>复制</button></td>
                    {data?.urlLinkEnabled ? (
                      <td><button type="button" className="fos-btn fos-btn-ghost" disabled={busyId === row.id} onClick={() => void copyLink(row)}>复制</button></td>
                    ) : null}
                    <td>{row.newUsers30d}</td>
                    <td>{row.players30d}</td>
                    <td><button type="button" className="fos-btn fos-btn-ghost" disabled={busyId === row.id} onClick={() => void archive(row)}>归档</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {creating ? <ChannelDialog onClose={() => setCreating(false)} onSaved={reload} /> : null}
    </ListGuard>
  )
}

// ---------- 作品管理 ----------

function BanDialog({ work, onClose, onSaved }: { work: OpsWorkRow; onClose: () => void; onSaved: () => void }) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const length = [...reason.trim()].length
  const canSave = length >= 2 && length <= 200 && !busy

  const ban = async () => {
    setBusy(true)
    setError('')
    try {
      await sendJson(`/api/admin/mp/works/${work.id}/ban`, { reason })
      notify('已封禁', 'success')
      onSaved()
      onClose()
    } catch (err) {
      setError(errorMessage(err, '封禁失败'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <OpsDialog
      label={`封禁「${work.title}」`}
      busy={busy}
      onClose={onClose}
      foot={(
        <>
          <button type="button" className="fos-btn fos-btn-ghost" disabled={busy} onClick={onClose}>取消</button>
          <button type="button" className="fos-btn fos-btn-primary fos-btn-lg" disabled={!canSave} onClick={() => void ban()}>封禁</button>
        </>
      )}
    >
      <Field label="封禁原因（创作者可见）">
        <textarea className="fos-textarea" rows={4} maxLength={200} value={reason} disabled={busy} placeholder="2–200 字" onChange={(event) => setReason(event.target.value)} />
        <small className="nori-mp-review-count">{length}/200</small>
      </Field>
      {error ? <p className="nori-mp-ops-error">{error}</p> : null}
    </OpsDialog>
  )
}

function WorksTab() {
  const [status, setStatus] = useState('')
  const [qInput, setQInput] = useState('')
  const [q, setQ] = useState('')
  useEffect(() => {
    const timer = setTimeout(() => setQ(qInput), 250)
    return () => clearTimeout(timer)
  }, [qInput])
  const { data, error, loading, reload } = useOpsList<{ items: OpsWorkRow[] }>(`/api/admin/mp/works?status=${encodeURIComponent(status)}&q=${encodeURIComponent(q)}`)
  const [banning, setBanning] = useState<OpsWorkRow | null>(null)
  const [busyId, setBusyId] = useState('')
  const items = data?.items ?? []

  const unban = async (row: OpsWorkRow) => {
    if (!await confirmAction({ message: '解封后作品回到已下架状态。', confirmLabel: '解封', cancelLabel: '取消' })) return
    setBusyId(row.id)
    try {
      await sendJson(`/api/admin/mp/works/${row.id}/unban`)
      notify('已解封', 'success')
      reload()
    } catch (err) {
      notify(errorMessage(err, '解封失败'))
    } finally {
      setBusyId('')
    }
  }

  return (
    <ListGuard error={error} loading={loading} hasData={Boolean(data)} onRetry={reload}>
      <div className="nori-mp-ops-toolbar">
        <select className="fos-input" value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="">全部状态</option>
          <option value="draft">未上架</option>
          <option value="scheduled">待上线</option>
          <option value="live">已上线</option>
          <option value="offline">已下架</option>
          <option value="banned">已封禁</option>
        </select>
        <input className="fos-input" value={qInput} placeholder="搜索作品名或 slug" onChange={(event) => setQInput(event.target.value)} />
      </div>
      {items.length === 0 ? (
        <AdminEmpty>没有符合条件的作品</AdminEmpty>
      ) : (
        <div className="nori-admin-panel">
          <div className="nori-admin-table-wrap">
            <table className="nori-admin-table">
              <thead>
                <tr><th>作品名</th><th>状态</th><th>线上版本</th><th>玩家数</th><th>评分</th><th>操作</th></tr>
              </thead>
              <tbody>
                {items.map((row) => (
                  <tr key={row.id}>
                    <td>{row.title}</td>
                    <td>{WORK_STATUS_LABEL[row.status] ?? row.status}</td>
                    <td>{row.liveVersion != null ? `v${row.liveVersion}` : '—'}</td>
                    <td>{row.playerCount}</td>
                    <td>{row.ratingCount > 0 ? row.ratingScore.toFixed(1) : '—'}</td>
                    <td>
                      {row.status === 'banned' ? (
                        <button type="button" className="fos-btn fos-btn-ghost" disabled={busyId === row.id} onClick={() => void unban(row)}>解封</button>
                      ) : (
                        <button type="button" className="fos-btn fos-btn-ghost" disabled={busyId === row.id} onClick={() => setBanning(row)}>封禁</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {banning ? <BanDialog work={banning} onClose={() => setBanning(null)} onSaved={reload} /> : null}
    </ListGuard>
  )
}

// ---------- 举报 ----------

function ReportsTab() {
  const { data, error, loading, reload } = useOpsList<{ items: OpsReportRow[] }>('/api/admin/mp/reports')
  const [busyId, setBusyId] = useState('')
  const items = data?.items ?? []

  const handle = async (row: OpsReportRow, status: 'resolved' | 'dismissed') => {
    setBusyId(row.id)
    try {
      await sendJson(`/api/admin/mp/reports/${row.id}`, { status }, 'PATCH')
      notify(status === 'resolved' ? '已处理' : '已忽略', 'success')
      reload()
    } catch (err) {
      notify(errorMessage(err, '操作失败'))
    } finally {
      setBusyId('')
    }
  }

  return (
    <ListGuard error={error} loading={loading} hasData={Boolean(data)} onRetry={reload}>
      {items.length === 0 ? (
        <AdminEmpty>暂无待处理举报</AdminEmpty>
      ) : (
        <div className="nori-admin-panel">
          <div className="nori-admin-table-wrap">
            <table className="nori-admin-table">
              <thead>
                <tr><th>作品</th><th>理由</th><th>描述</th><th>时间</th><th>操作</th></tr>
              </thead>
              <tbody>
                {items.map((row) => (
                  <tr key={row.id}>
                    <td>
                      {row.workTitle}
                      {row.workReportCount >= 5 ? <span className="nori-mp-ops-dot" title={`该作品累计 ${row.workReportCount} 条举报`} /> : null}
                    </td>
                    <td>{row.reasonLabel}</td>
                    <td>{row.detail || '—'}</td>
                    <td>{formatBeijing(row.createdAt)}</td>
                    <td>
                      <div className="nori-mp-ops-row-actions">
                        <button type="button" className="fos-btn fos-btn-ghost" disabled={busyId === row.id} onClick={() => void handle(row, 'resolved')}>已处理</button>
                        <button type="button" className="fos-btn fos-btn-ghost" disabled={busyId === row.id} onClick={() => void handle(row, 'dismissed')}>忽略</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </ListGuard>
  )
}

export function PlatformAdminMpOpsClient() {
  const [tab, setTab] = useState<OpsTab>('slots')
  return (
    <PlatformAdminShell active="mp-ops" eyebrow="平台管理" title="内容运营" description="推荐位、专题、渠道、举报">
      <div className="nori-mp-review-tabs" role="tablist" aria-label="内容运营">
        {TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={tab === item.key}
            className={`nori-mp-review-tab${tab === item.key ? ' is-active' : ''}`}
            onClick={() => setTab(item.key)}
          >
            {item.label}
          </button>
        ))}
      </div>
      {tab === 'slots' ? <SlotsTab /> : null}
      {tab === 'topics' ? <TopicsTab /> : null}
      {tab === 'channels' ? <ChannelsTab /> : null}
      {tab === 'works' ? <WorksTab /> : null}
      {tab === 'reports' ? <ReportsTab /> : null}
    </PlatformAdminShell>
  )
}
