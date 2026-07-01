'use client'

import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { AppIcon } from '@/components/ui/icons'

type AssetCategory = 'characters' | 'items' | 'environments'
type RoleTag = '主角' | '变体' | '配角' | '核心配角' | '核心道具' | '道具' | '室内空间' | '室外空间'

interface Asset {
  id: string
  name: string
  role: RoleTag
  category: AssetCategory
  project: string
  poses: number
}

const ASSETS: Asset[] = [
  { id: '1', name: 'Emily', role: '主角', category: 'characters', project: '$50,000 Deal with the Devil', poses: 4 },
  { id: '2', name: 'Dr. Carter', role: '主角', category: 'characters', project: '$50,000 Deal with the Devil', poses: 4 },
  { id: '3', name: 'Dr. Carter（手术造型）', role: '变体', category: 'characters', project: '$50,000 Deal with the Devil', poses: 4 },
  { id: '4', name: '苏晚卿', role: '主角', category: 'characters', project: 'TEST', poses: 4 },
  { id: '5', name: '苏晚卿（孤女逃亡时期）', role: '变体', category: 'characters', project: 'TEST', poses: 1 },
  { id: '6', name: '苏晚卿（陆府姨太时期）', role: '变体', category: 'characters', project: 'TEST', poses: 4 },
  { id: '7', name: '苏晚卿（督军夫人时期）', role: '变体', category: 'characters', project: 'TEST', poses: 4 },
  { id: '8', name: '苏晚卿（老年时期）', role: '变体', category: 'characters', project: 'TEST', poses: 4 },
  { id: '9', name: '陆承煜', role: '核心配角', category: 'characters', project: 'TEST', poses: 4 },
  { id: '10', name: '陈阿婆留的银簪', role: '核心道具', category: 'items', project: 'TEST', poses: 1 },
  { id: '11', name: '刻“陆”字玄铁令牌', role: '核心道具', category: 'items', project: 'TEST', poses: 1 },
  { id: '12', name: '羊脂玉镯', role: '道具', category: 'items', project: 'TEST', poses: 1 },
  { id: '13', name: '张秃子家破旧柴房', role: '室内空间', category: 'environments', project: 'TEST', poses: 1 },
  { id: '14', name: '城郊破旧土地庙', role: '室内空间', category: 'environments', project: 'TEST', poses: 1 },
  { id: '15', name: '督军府大门', role: '室外空间', category: 'environments', project: 'TEST', poses: 1 },
]

const ROLE_COLORS: Record<RoleTag, string> = {
  '主角': '#e0a23a', '变体': '#e0a23a', '配角': '#a855f7', '核心配角': '#a855f7',
  '核心道具': '#3b82f6', '道具': '#6b7280', '室内空间': '#10b981', '室外空间': '#10b981',
}

const CATEGORY_LABELS: Record<AssetCategory, string> = { characters: '角色', items: '物品', environments: '环境' }

function PosePlaceholder({ kind }: { kind: AssetCategory }) {
  return (
    <div className="flex h-full w-full items-center justify-center bg-gradient-to-b from-[#1a1a20] to-[#101014]">
      <AppIcon name={kind === 'characters' ? 'user' : kind === 'items' ? 'package' : 'imageLandscape'} className="h-7 w-7 text-white/12" />
    </div>
  )
}

function AssetCard({ asset, batch, checked, onToggle, onOpen }: { asset: Asset; batch: boolean; checked: boolean; onToggle: () => void; onOpen: () => void }) {
  const color = ROLE_COLORS[asset.role]
  return (
    <div className="overflow-hidden rounded-[12px] border border-[var(--fos-border-soft)] bg-[var(--fos-bg-2)] transition-colors hover:border-[var(--fos-border-mid)]">
      <div className="relative">
        {batch ? (
          <button onClick={onToggle} className="absolute left-2 top-2 z-10 flex h-6 w-6 items-center justify-center rounded-[6px] border-2"
            style={{ borderColor: checked ? 'var(--fos-primary)' : 'rgba(255,255,255,.5)', background: checked ? 'var(--fos-primary)' : 'rgba(0,0,0,.4)' }}>
            {checked ? <AppIcon name="check" className="h-3.5 w-3.5 text-white" /> : null}
          </button>
        ) : null}
        <button onClick={batch ? onToggle : onOpen} className="grid w-full" style={{ gridTemplateColumns: `1.3fr repeat(${Math.max(asset.poses - 1, 0)}, 1fr)`, aspectRatio: '16 / 7' }}>
          {Array.from({ length: asset.poses }).map((_, i) => (
            <div key={i} className="border-r border-black/30 last:border-r-0"><PosePlaceholder kind={asset.category} /></div>
          ))}
        </button>
      </div>
      <div className="flex items-center justify-between gap-2 px-3 py-2.5">
        <span className="min-w-0 truncate text-[13px] font-bold text-white">{asset.name}</span>
        <span className="flex-none rounded-md px-2 py-0.5 text-[11px] font-bold" style={{ background: `${color}26`, color }}>{asset.role}</span>
      </div>
    </div>
  )
}

function TreeRow({ icon, label, active, depth = 0, caret, onClick }: { icon?: string; label: string; active?: boolean; depth?: number; caret?: boolean; onClick?: () => void }) {
  return (
    <button onClick={onClick}
      className="flex w-full items-center gap-2 rounded-[8px] py-2 pr-3 text-left text-[13px]"
      style={{ paddingLeft: 12 + depth * 16, background: active ? 'var(--fos-primary-soft)' : 'transparent', color: active ? '#8fb0ff' : 'var(--fos-text-2)', fontWeight: active ? 700 : 500 }}>
      {caret ? <AppIcon name="chevronDown" className="h-3 w-3 shrink-0 text-[var(--fos-text-4)]" /> : <span className="w-3 shrink-0" />}
      {icon ? <AppIcon name={icon as never} className="h-4 w-4 shrink-0" /> : null}
      <span className="min-w-0 truncate">{label}</span>
    </button>
  )
}

export function FosAssetLibrary() {
  const [category, setCategory] = useState<AssetCategory>('characters')
  const params = useSearchParams()
  const [batch, setBatch] = useState(params?.get('batch') === '1')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [lightbox, setLightbox] = useState<Asset | null>(() => {
    const id = params?.get('lightbox')
    return id ? ASSETS.find((a) => a.id === id) ?? null : null
  })
  const [projOpen, setProjOpen] = useState(false)

  const displayed = ASSETS.filter((a) => a.category === category)

  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })

  return (
    <div className="flex min-h-0 flex-1">
      <aside className="flex w-[230px] min-h-0 flex-none flex-col overflow-y-auto border-r border-[var(--fos-border-soft)] p-3">
        <div className="mb-1 px-2 text-[12px] font-bold text-[var(--fos-text-4)]">分类</div>
        <TreeRow icon="folderOpen" label="资产库" caret />
        {(['characters', 'items', 'environments'] as AssetCategory[]).map((c) => (
          <TreeRow key={c} icon={c === 'characters' ? 'user' : c === 'items' ? 'package' : 'imageLandscape'}
            label={CATEGORY_LABELS[c]} depth={1} active={category === c} onClick={() => setCategory(c)} />
        ))}
        <TreeRow icon="folderCards" label="全部素材" />
        <TreeRow icon="bookmark" label="我的收藏" />
        <TreeRow icon="folder" label="TEST" caret />
        <TreeRow icon="folder" label="$50,000 Deal with the Devil" caret />
      </aside>

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex items-center gap-3 border-b border-[var(--fos-border-soft)] px-5 py-3">
          <button className="flex h-9 items-center gap-2 rounded-[8px] border border-[var(--fos-border-strong)] bg-[var(--fos-bg-1)] px-3 text-[13px]">
            <span className="flex items-center gap-1 rounded bg-[var(--fos-fill-mid)] px-1.5 py-0.5 text-[12px] text-white">主角 <AppIcon name="close" className="h-3 w-3" /></span>
            <span className="text-[var(--fos-text-3)]">+1</span>
            <AppIcon name="chevronDown" className="h-3.5 w-3.5 text-[var(--fos-text-4)]" />
          </button>
          <div className="relative">
            <button onClick={() => setProjOpen((v) => !v)} onBlur={() => setTimeout(() => setProjOpen(false), 150)}
              className="flex h-9 w-[180px] items-center justify-between rounded-[8px] border border-[var(--fos-border-strong)] bg-[var(--fos-bg-1)] px-3 text-[13px] text-white">
              全部项目 <AppIcon name="chevronDown" className="h-3.5 w-3.5 text-[var(--fos-text-4)]" />
            </button>
            {projOpen ? (
              <div className="fos-menu left-0 mt-1 w-[180px]">
                <button className="fos-menu-item active">全部项目</button>
                <button className="fos-menu-item">TEST</button>
                <button className="fos-menu-item">$50,000 Deal with the Devil</button>
              </div>
            ) : null}
          </div>
          <div className="ml-auto">
            <button onClick={() => { setBatch((v) => !v); setSelected(new Set()) }} className="fos-btn fos-btn-primary fos-btn-sm">
              <AppIcon name="checkDot" className="h-3.5 w-3.5" />批量操作
            </button>
          </div>
        </div>

        {batch ? (
          <div className="flex items-center gap-3 border-b border-[var(--fos-border-soft)] bg-[var(--fos-primary-soft)] px-5 py-2.5">
            <span className="flex items-center gap-1 text-[13px] font-bold text-white"><span className="h-3 w-1 rounded bg-[var(--fos-primary)]" />已选 <span className="text-[var(--fos-primary)]">{selected.size}</span> 项</span>
            <div className="ml-auto flex items-center gap-2">
              <button className="fos-btn fos-btn-ghost fos-btn-sm" disabled={selected.size === 0}><AppIcon name="download" className="h-3.5 w-3.5" />下载</button>
              <button onClick={() => { setBatch(false); setSelected(new Set()) }} className="fos-btn fos-btn-ghost fos-btn-sm"><AppIcon name="close" className="h-3.5 w-3.5" />退出</button>
            </div>
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
            {displayed.map((a) => (
              <AssetCard key={a.id} asset={a} batch={batch} checked={selected.has(a.id)} onToggle={() => toggle(a.id)} onOpen={() => setLightbox(a)} />
            ))}
          </div>
        </div>
      </main>

      {lightbox ? <AssetLightbox asset={lightbox} onClose={() => setLightbox(null)} /> : null}
    </div>
  )
}

function AssetLightbox({ asset, onClose }: { asset: Asset; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-black/92" onClick={onClose}>
      <div className="relative flex items-center justify-center gap-6 py-3 text-white/80">
        <button className="hover:text-white"><AppIcon name="searchPlus" className="h-5 w-5" /></button>
        <button className="hover:text-white"><AppIcon name="search" className="h-5 w-5" /></button>
        <button className="hover:text-white"><AppIcon name="refresh" className="h-5 w-5" /></button>
        <button className="hover:text-white"><AppIcon name="download" className="h-5 w-5" /></button>
        <button onClick={onClose} className="absolute right-5 top-2 flex h-9 w-9 items-center justify-center rounded-full bg-white/10 hover:bg-white/20"><AppIcon name="close" className="h-5 w-5" /></button>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center px-10 pb-4" onClick={(e) => e.stopPropagation()}>
        <div className="grid h-full max-h-[70vh] w-full max-w-[1100px] overflow-hidden rounded-[8px]" style={{ gridTemplateColumns: `1.3fr repeat(${Math.max(asset.poses - 1, 0)}, 1fr)` }}>
          {Array.from({ length: asset.poses }).map((_, i) => (
            <div key={i} className="border-r border-white/5 last:border-r-0"><PosePlaceholder kind={asset.category} /></div>
          ))}
        </div>
      </div>
      <div className="flex items-center justify-center gap-2 pb-4" onClick={(e) => e.stopPropagation()}>
        {ASSETS.filter((a) => a.category === asset.category).slice(0, 8).map((a) => (
          <div key={a.id} className="h-12 w-12 overflow-hidden rounded-md border" style={{ borderColor: a.id === asset.id ? 'var(--fos-primary)' : 'transparent' }}><PosePlaceholder kind={a.category} /></div>
        ))}
      </div>
    </div>
  )
}
