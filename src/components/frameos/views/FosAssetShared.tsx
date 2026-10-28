'use client'

import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from '@/i18n/navigation'
import { AppIcon } from '@/components/ui/icons'
import { apiFetch } from '@/lib/api-fetch'
import { readApiErrorMessage } from '@/lib/api/read-error-message'
import { useDismissableDialog } from '@/components/ui/useDismissableDialog'

export type AssetTab = 'characters' | 'items' | 'environments' | 'timbre'

const TABS: Array<[AssetTab, string]> = [
  ['characters', '角色'], ['items', '物品'], ['environments', '环境'], ['timbre', '音色'],
]

export function AssetTabs({ projectId, active }: { projectId: string; active: AssetTab }) {
  const base = `/workflow/${projectId}/workbench-premium2/assets`
  return (
    <div className="mb-4 flex flex-wrap gap-2">
      {TABS.map(([tab, label]) => (
        <Link key={tab} href={{ pathname: `${base}/${tab}` }}
          className="h-8 rounded-lg px-3 text-[13px] font-bold leading-8"
          style={{
            background: tab === active ? 'rgba(255,255,255,.16)' : 'var(--fos-bg-3)',
            color: tab === active ? '#fff' : 'var(--fos-text-3)',
          }}>
          {label}
        </Link>
      ))}
    </div>
  )
}

/** White-background asset image placeholder (real images replaced by NoriVideo placeholders) */
export function AssetPlaceholder({ kind }: { kind: AssetTab }) {
  if (kind === 'items') {
    return (
      <div className="flex h-full w-full items-center justify-center bg-[#f4f4f4]">
        <div className="relative h-20 w-44 rotate-[-8deg] rounded-full bg-[#d9d9d9] shadow-[0_12px_36px_rgba(0,0,0,.18)]" />
      </div>
    )
  }
  if (kind === 'environments') {
    return (
      <div className="grid h-full w-full grid-cols-2 bg-[#1a1a1a]">
        <div className="relative overflow-hidden bg-[#242424]">
          <div className="absolute inset-x-0 top-0 h-10 bg-[#323232]" />
          <div className="absolute bottom-0 inset-x-0 h-12 bg-[#373737]" />
          <div className="absolute right-10 top-12 h-24 w-20 rounded-full bg-[#ffffff]/30 blur-2xl" />
        </div>
        <div className="bg-[linear-gradient(135deg,#282828,#0f0d0b_70%)] p-5"><div className="h-full rounded-sm border border-[#535353]/40 bg-[#1a1a1a]/70" /></div>
      </div>
    )
  }
  return (
    <div className="grid h-full w-full grid-cols-[1.3fr_.9fr_.9fr_.9fr] items-end gap-3 bg-white px-6 pt-6">
      <div className="h-40 w-40 self-center rounded-full bg-[#e7e7e7]" />
      {[1, 2, 3].map((i) => <div key={i} className="h-44 rounded-t-full bg-[#f2f2f2]" />)}
    </div>
  )
}

const ADD_LABELS: Record<AssetTab, { title: string; nameLabel: string; bgLabel: string }> = {
  characters: { title: '新增角色', nameLabel: '角色名称', bgLabel: '角色背景' },
  items: { title: '新增物品', nameLabel: '物品名称', bgLabel: '物品背景' },
  environments: { title: '新增环境', nameLabel: '环境名称', bgLabel: '环境背景' },
  timbre: { title: '新增角色', nameLabel: '角色名称', bgLabel: '角色背景' },
}

export function AddAssetDialog({
  projectId,
  kind,
  episodeNumbers,
  onCreated,
  onClose,
}: {
  projectId: string
  kind: Exclude<AssetTab, 'timbre'>
  episodeNumbers: number[]
  onCreated?: (assetId: string | null) => void
  onClose: () => void
}) {
  const labels = ADD_LABELS[kind]
  const [name, setName] = useState('')
  const [type, setType] = useState('')
  const [background, setBackground] = useState('')
  const [episodesOpen, setEpisodesOpen] = useState(false)
  const [selectedEpisodes, setSelectedEpisodes] = useState<Set<number>>(() => new Set())
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { requestClose, onBackdropMouseDown } = useDismissableDialog({ onClose, busy: submitting, dirty: Boolean(name.trim() || background.trim()) })

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim() || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const description = background.trim() || `${name.trim()} 的${kind === 'characters' ? '角色' : kind === 'items' ? '物品' : '环境'}设定`
      const response = kind === 'characters'
        ? await apiFetch(`/api/novel-promotion/${projectId}/character`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: name.trim(),
              description,
              introduction: background.trim() || null,
              role: type || 'supporting',
              coverageEpisodes: Array.from(selectedEpisodes).sort((a, b) => a - b),
            }),
          })
        : await apiFetch(`/api/novel-promotion/${projectId}/location`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: name.trim(),
              description,
              summary: background.trim() || null,
              assetKind: kind === 'items' ? 'prop' : 'location',
              itemType: kind === 'items' ? type || null : null,
              coverageEpisodes: Array.from(selectedEpisodes).sort((a, b) => a - b),
            }),
          })
      if (!response.ok) throw new Error(await readApiErrorMessage(response, `新增${kind === 'characters' ? '角色' : kind === 'items' ? '物品' : '环境'}失败`))
      const payload = await response.json() as {
        character?: { id?: string }
        location?: { id?: string }
      }
      onCreated?.(payload.character?.id || payload.location?.id || null)
      onClose()
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '新增资产失败')
    } finally {
      setSubmitting(false)
    }
  }

  const typeOptions = kind === 'characters'
    ? [['lead', '主角'], ['core_supporting', '核心配角'], ['supporting', '配角']]
    : kind === 'items'
      ? [['personal', '随身物品'], ['plot', '剧情道具'], ['environmental', '环境物件']]
      : [['interior', '室内'], ['exterior', '室外'], ['mixed', '内外景']]
  return (
    <div className="fos-overlay" onMouseDown={onBackdropMouseDown}>
      <form className="fos-dialog" style={{ maxWidth: 520 }} onSubmit={submit} role="dialog" aria-modal="true" aria-label={labels.title}>
        <div className="fos-dialog-head">
          <div className="fos-dialog-title">{labels.title}</div>
          <button type="button" className="fos-dialog-x" aria-label="关闭" disabled={submitting} onClick={() => void requestClose()}><AppIcon name="close" className="h-4 w-4" /></button>
        </div>
        <div className="fos-dialog-body" style={{ display: 'grid', gap: 14 }}>
          <div>
            <div className="mb-1.5 text-[13px] font-semibold text-white">{labels.nameLabel}</div>
            <input className="fos-input" value={name} onChange={(e) => setName(e.target.value)} placeholder={`请输入${labels.nameLabel}`} autoFocus />
          </div>
          <div>
            <div className="mb-1.5 text-[13px] font-semibold text-white">类型</div>
            <select className="fos-input" value={type} onChange={(e) => setType(e.target.value)}>
              <option value="">请选择类型</option>
              {typeOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </div>
          <div>
            <div className="mb-1.5 text-[13px] font-semibold text-white">出场集</div>
            <button type="button" className="fos-btn fos-btn-ghost w-full justify-between" onClick={() => setEpisodesOpen((v) => !v)}>
              <span>{selectedEpisodes.size ? `已选 ${selectedEpisodes.size} 集：${[...selectedEpisodes].sort((a, b) => a - b).map((n) => `E${n}`).join('、')}` : '选择出场集（可选）'}</span><AppIcon name="chevronDown" className={`h-4 w-4 transition-transform${episodesOpen ? ' rotate-180' : ''}`} />
            </button>
            {episodesOpen ? (
              <div className="mt-2 flex flex-wrap gap-1.5 rounded-[10px] border border-[var(--fos-border-mid)] bg-[var(--fos-bg-1)] p-3">
                {episodeNumbers.map((n) => (
                  <button
                    key={n}
                    type="button"
                    aria-pressed={selectedEpisodes.has(n)}
                    className="h-7 w-9 rounded-md text-[11px] font-bold"
                    style={{
                      background: selectedEpisodes.has(n) ? 'rgba(255,255,255,.16)' : 'var(--fos-bg-3)',
                      color: selectedEpisodes.has(n) ? '#fff' : 'var(--fos-text-3)',
                    }}
                    onClick={() => setSelectedEpisodes((current) => {
                      const next = new Set(current)
                      if (next.has(n)) next.delete(n)
                      else next.add(n)
                      return next
                    })}
                  >E{n}</button>
                ))}
                {episodeNumbers.length === 0 ? <span className="text-[11px] text-[var(--fos-text-4)]">作品暂无分集，可稍后补充出场集。</span> : null}
              </div>
            ) : null}
          </div>
          <div>
            <div className="mb-1.5 text-[13px] font-semibold text-white">{labels.bgLabel}</div>
            <textarea className="fos-textarea" style={{ minHeight: 90 }} value={background} onChange={(e) => setBackground(e.target.value)} placeholder={`请输入${labels.bgLabel}`} />
          </div>
          {error ? <div role="alert" className="rounded-lg border border-[rgba(229,72,77,.3)] bg-[rgba(229,72,77,.1)] px-3 py-2 text-[12px] text-[#ff8589]">{error}</div> : null}
        </div>
        <div className="fos-dialog-foot">
          <button type="button" className="fos-btn fos-btn-ghost" onClick={() => void requestClose()} disabled={submitting}>取消</button>
          <button type="submit" className="fos-btn fos-btn-primary" disabled={!name.trim() || submitting}>{submitting ? '创建中…' : '确定'}</button>
        </div>
      </form>
    </div>
  )
}

export function AddCharacterVariantDialog({
  projectId,
  characterId,
  characterName,
  episodeNumbers,
  onCreated,
  onClose,
}: {
  projectId: string
  characterId: string
  characterName: string
  episodeNumbers: number[]
  onCreated?: () => void
  onClose: () => void
}) {
  const [label, setLabel] = useState('')
  const [description, setDescription] = useState('')
  const [selectedEpisodes, setSelectedEpisodes] = useState<Set<number>>(() => new Set())
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { requestClose, onBackdropMouseDown } = useDismissableDialog({ onClose, busy: submitting, dirty: Boolean(label.trim() || description.trim()) })

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!label.trim() || !description.trim() || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const response = await apiFetch(`/api/novel-promotion/${projectId}/character/appearance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          characterId,
          changeReason: label.trim(),
          description: description.trim(),
          coverageEpisodes: Array.from(selectedEpisodes).sort((a, b) => a - b),
        }),
      })
      if (!response.ok) throw new Error(await readApiErrorMessage(response, '新增角色变体失败'))
      onCreated?.()
      onClose()
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '新增角色变体失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fos-overlay" onMouseDown={onBackdropMouseDown}>
      <form className="fos-dialog" style={{ maxWidth: 540 }} onSubmit={submit} role="dialog" aria-modal="true" aria-label="新增角色变体">
        <div className="fos-dialog-head">
          <div><div className="fos-dialog-title">新增角色变体</div><div className="mt-1 text-[11px] text-[var(--fos-text-4)]">{characterName} · 只描述相对主形象发生的变化</div></div>
          <button type="button" className="fos-dialog-x" aria-label="关闭" disabled={submitting} onClick={() => void requestClose()}><AppIcon name="close" className="h-4 w-4" /></button>
        </div>
        <div className="fos-dialog-body grid gap-4">
          <label><span className="mb-1.5 block text-[13px] font-semibold text-white">变体名称</span><input className="fos-input" autoFocus value={label} onChange={(event) => setLabel(event.target.value)} placeholder="例如：雨夜逃亡、受伤后、宴会礼服" /></label>
          <div><span className="mb-1.5 block text-[13px] font-semibold text-white">对应分集</span><div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto rounded-[10px] border border-[var(--fos-border-mid)] bg-[var(--fos-bg-1)] p-3">{episodeNumbers.map((episodeNumber) => <button key={episodeNumber} type="button" aria-pressed={selectedEpisodes.has(episodeNumber)} className="h-7 w-10 rounded-md text-[11px] font-bold" style={{ background: selectedEpisodes.has(episodeNumber) ? 'rgba(255,255,255,.16)' : 'var(--fos-bg-3)', color: selectedEpisodes.has(episodeNumber) ? '#fff' : 'var(--fos-text-3)' }} onClick={() => setSelectedEpisodes((current) => { const next = new Set(current); if (next.has(episodeNumber)) next.delete(episodeNumber); else next.add(episodeNumber); return next })}>E{episodeNumber}</button>)}</div></div>
          <label><span className="mb-1.5 block text-[13px] font-semibold text-white">形象变化与生图提示词</span><textarea className="fos-textarea" style={{ minHeight: 150 }} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="例如：保持脸型、五官和体型不变；服装被暴雨浸湿，发丝贴脸，右手掌有擦伤……" /></label>
          {error ? <div role="alert" className="rounded-lg border border-[rgba(229,72,77,.3)] bg-[rgba(229,72,77,.1)] px-3 py-2 text-[12px] text-[#ff8589]">{error}</div> : null}
        </div>
        <div className="fos-dialog-foot"><button type="button" className="fos-btn fos-btn-ghost" disabled={submitting} onClick={() => void requestClose()}>取消</button><button type="submit" className="fos-btn fos-btn-primary" disabled={!label.trim() || !description.trim() || submitting}>{submitting ? '创建中…' : '添加变体'}</button></div>
      </form>
    </div>
  )
}

export function ImageZoom({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  useDismissableDialog({ onClose })
  return (
    <div className="fos-overlay" role="dialog" aria-modal="true" aria-label="查看大图" onMouseDown={onClose}>
      <div className="relative max-h-[90vh] max-w-[90vw] overflow-hidden rounded-[12px] border border-[var(--fos-border-mid)]" style={{ width: 720, aspectRatio: '16/9' }} onMouseDown={(e) => e.stopPropagation()}>
        {children}
        <button type="button" className="fos-dialog-x absolute right-2 top-2 bg-black/50" aria-label="关闭大图" onClick={onClose}><AppIcon name="close" className="h-4 w-4" /></button>
      </div>
    </div>
  )
}
