'use client'

import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from '@/i18n/navigation'
import { AppIcon } from '@/components/ui/icons'

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
            background: tab === active ? 'var(--fos-primary)' : 'var(--fos-bg-3)',
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
        <div className="relative h-20 w-44 rotate-[-8deg] rounded-full bg-gradient-to-r from-[#cfcfcf] via-[#f6f6f6] to-[#a9a9a9] shadow-[0_12px_36px_rgba(0,0,0,.18)]" />
      </div>
    )
  }
  if (kind === 'environments') {
    return (
      <div className="grid h-full w-full grid-cols-2 bg-[#1d1915]">
        <div className="relative overflow-hidden bg-[#2a231d]">
          <div className="absolute inset-x-0 top-0 h-10 bg-[#3a3028]" />
          <div className="absolute bottom-0 inset-x-0 h-12 bg-[#443424]" />
          <div className="absolute right-10 top-12 h-24 w-20 rounded-full bg-[#d58f3a]/30 blur-2xl" />
        </div>
        <div className="bg-[linear-gradient(135deg,#342515,#0f0d0b_70%)] p-5"><div className="h-full rounded-sm border border-[#6a4d2d]/40 bg-[#211812]/70" /></div>
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

export function AddAssetDialog({ kind, onClose }: { kind: AssetTab; onClose: () => void }) {
  const labels = ADD_LABELS[kind]
  const [name, setName] = useState('')
  const [type, setType] = useState('')
  const [background, setBackground] = useState('')
  const [episodesOpen, setEpisodesOpen] = useState(false)
  const submit = (e: FormEvent) => { e.preventDefault(); onClose() }
  return (
    <div className="fos-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <form className="fos-dialog" style={{ maxWidth: 520 }} onSubmit={submit}>
        <div className="fos-dialog-head">
          <div className="fos-dialog-title">{labels.title}</div>
          <button type="button" className="fos-dialog-x" onClick={onClose}><AppIcon name="close" className="h-4 w-4" /></button>
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
              <option value="main">主角</option>
              <option value="support">核心配角</option>
              <option value="minor">配角</option>
            </select>
          </div>
          <div>
            <div className="mb-1.5 text-[13px] font-semibold text-white">出场集</div>
            <button type="button" className="fos-btn fos-btn-ghost w-full justify-between" onClick={() => setEpisodesOpen((v) => !v)}>
              <span>选择出场集</span><AppIcon name="chevronDown" className="h-4 w-4" />
            </button>
            {episodesOpen ? (
              <div className="mt-2 flex flex-wrap gap-1.5 rounded-[10px] border border-[var(--fos-border-mid)] bg-[var(--fos-bg-1)] p-3">
                {Array.from({ length: 30 }, (_, i) => i + 1).map((n) => (
                  <button key={n} type="button" className="h-7 w-9 rounded-md bg-[var(--fos-bg-3)] text-[11px] font-bold text-[var(--fos-text-3)] hover:bg-[var(--fos-primary-soft)]">E{n}</button>
                ))}
              </div>
            ) : null}
          </div>
          <div>
            <div className="mb-1.5 text-[13px] font-semibold text-white">{labels.bgLabel}</div>
            <textarea className="fos-textarea" style={{ minHeight: 90 }} value={background} onChange={(e) => setBackground(e.target.value)} placeholder={`请输入${labels.bgLabel}`} />
          </div>
        </div>
        <div className="fos-dialog-foot">
          <button type="button" className="fos-btn fos-btn-ghost" onClick={onClose}>取消</button>
          <button type="submit" className="fos-btn fos-btn-primary" disabled={!name.trim()}>确定</button>
        </div>
      </form>
    </div>
  )
}

export function ImageZoom({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fos-overlay" onMouseDown={onClose}>
      <div className="relative max-h-[90vh] max-w-[90vw] overflow-hidden rounded-[12px] border border-[var(--fos-border-mid)]" style={{ width: 720, aspectRatio: '16/9' }} onMouseDown={(e) => e.stopPropagation()}>
        {children}
        <button type="button" className="fos-dialog-x absolute right-2 top-2 bg-black/50" onClick={onClose}><AppIcon name="close" className="h-4 w-4" /></button>
      </div>
    </div>
  )
}
