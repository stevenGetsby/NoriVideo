'use client'

import { useState } from 'react'
import { AppIcon } from '@/components/ui/icons'

type AssetCategory = 'characters' | 'items' | 'environments' | 'all'

const CATEGORIES: Array<{ key: AssetCategory; label: string }> = [
  { key: 'all', label: '全部资产' },
  { key: 'characters', label: '角色' },
  { key: 'items', label: '物品' },
  { key: 'environments', label: '环境' },
]

const DEMO_ASSETS: Array<{ id: string; name: string; role: string; category: AssetCategory; project: string }> = [
  { id: '1', name: '苏晚卿', role: '主角', category: 'characters', project: 'TEST' },
  { id: '2', name: '张秃子', role: '受体', category: 'characters', project: 'TEST' },
  { id: '3', name: '王妈', role: '配角', category: 'characters', project: 'TEST' },
  { id: '4', name: '旧式棉袄', role: '道具', category: 'items', project: 'TEST' },
  { id: '5', name: '毒药瓶', role: '道具', category: 'items', project: 'TEST' },
  { id: '6', name: '督军府正厅', role: '场景', category: 'environments', project: 'TEST' },
  { id: '7', name: '城郊土地庙', role: '场景', category: 'environments', project: 'TEST' },
  { id: '8', name: '破旧柴房', role: '场景', category: 'environments', project: 'TEST' },
  { id: '9', name: 'Dr. Carter', role: '主角', category: 'characters', project: '$50,000 Deal' },
  { id: '10', name: 'Emily', role: '配角', category: 'characters', project: '$50,000 Deal' },
]

const ROLE_COLORS: Record<string, string> = {
  '主角': '#3b82f6',
  '受体': '#f59e0b',
  '配角': '#a855f7',
  '道具': '#6b7280',
  '场景': '#10b981',
}

function AssetCard({ name, role, project }: { name: string; role: string; project: string }) {
  const color = ROLE_COLORS[role] ?? '#6b7280'
  return (
    <div className="overflow-hidden rounded-[10px] border border-[var(--fos-border-mid)] bg-[var(--fos-bg-2)] transition-colors hover:border-[var(--fos-border-strong)]">
      <div className="relative flex aspect-square items-center justify-center bg-[#111]">
        <AppIcon name="user" className="h-10 w-10 text-white/10" />
        <span className="absolute right-2 top-2 rounded-md px-1.5 py-0.5 text-[10px] font-bold text-white" style={{ background: color }}>{role}</span>
      </div>
      <div className="p-2.5">
        <div className="truncate text-[13px] font-bold text-white">{name}</div>
        <div className="mt-0.5 truncate text-[11px] text-[var(--fos-text-4)]">{project}</div>
      </div>
    </div>
  )
}

export function FosAssetLibrary() {
  const [category, setCategory] = useState<AssetCategory>('all')
  const [project, setProject] = useState('all')
  const [projOpen, setProjOpen] = useState(false)

  const filtered = category === 'all' ? DEMO_ASSETS : DEMO_ASSETS.filter((a) => a.category === category)
  const displayed = project === 'all' ? filtered : filtered.filter((a) => a.project === project)

  return (
    <div className="flex min-h-0 flex-1">
      {/* left category sidebar */}
      <aside className="flex w-[200px] min-h-0 flex-col border-r border-[var(--fos-border-soft)] p-3 overflow-y-auto" style={{ flex: '0 0 200px' }}>
        <h2 className="mb-3 px-2 text-[13px] font-bold text-[var(--fos-text-3)]">资产库</h2>
        <div className="space-y-0.5">
          {CATEGORIES.map((c) => (
            <button key={c.key} onClick={() => setCategory(c.key)}
              className="flex w-full items-center gap-2 rounded-[8px] px-3 py-2 text-left text-[13px]"
              style={{
                background: category === c.key ? 'var(--fos-primary-soft)' : 'transparent',
                color: category === c.key ? '#6ea0ff' : 'var(--fos-text-2)',
                fontWeight: category === c.key ? 700 : 500,
              }}>
              <AppIcon name={c.key === 'all' ? 'folderOpen' : c.key === 'characters' ? 'user' : c.key === 'items' ? 'package' : 'imageLandscape'} className="h-4 w-4 shrink-0" />
              <span>{c.label}</span>
            </button>
          ))}
        </div>
        <div className="mt-4 border-t border-[var(--fos-border-soft)] pt-3">
          <h3 className="mb-2 px-2 text-[12px] font-bold text-[var(--fos-text-4)]">项目</h3>
          <button onClick={() => { setProject('all'); setCategory('all') }}
            className="flex w-full items-center gap-2 rounded-[8px] px-3 py-1.5 text-[12px]"
            style={{ color: project === 'all' ? '#6ea0ff' : 'var(--fos-text-3)', fontWeight: project === 'all' ? 700 : 400 }}>
            全部项目
          </button>
          <button onClick={() => setProject('TEST')}
            className="flex w-full items-center gap-2 rounded-[8px] px-3 py-1.5 text-[12px]"
            style={{ color: project === 'TEST' ? '#6ea0ff' : 'var(--fos-text-3)', fontWeight: project === 'TEST' ? 700 : 400 }}>
            TEST
          </button>
          <button onClick={() => setProject('$50,000 Deal')}
            className="flex w-full items-center gap-2 rounded-[8px] px-3 py-1.5 text-[12px]"
            style={{ color: project === '$50,000 Deal' ? '#6ea0ff' : 'var(--fos-text-3)', fontWeight: project === '$50,000 Deal' ? 700 : 400 }}>
            $50,000 Deal
          </button>
        </div>
      </aside>

      {/* right content */}
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* filter bar */}
        <div className="flex flex-wrap items-center gap-3 border-b border-[var(--fos-border-soft)] px-5 py-3">
          <div className="flex items-center gap-1">
            {CATEGORIES.map((c) => (
              <button key={c.key} onClick={() => setCategory(c.key)}
                className="rounded-full px-3 py-1.5 text-[12px] font-bold"
                style={{
                  background: category === c.key ? 'var(--fos-primary)' : 'transparent',
                  color: category === c.key ? '#fff' : 'var(--fos-text-2)',
                }}>
                {c.label}
              </button>
            ))}
          </div>
          <span className="mx-1 h-4 w-px bg-[var(--fos-border-mid)]" />
          <div className="relative">
            <button className="text-[12px] text-[var(--fos-text-3)]" onClick={() => setProjOpen((v) => !v)} onBlur={() => setTimeout(() => setProjOpen(false), 150)}>
              全部项目 <AppIcon name="chevronDown" className="inline h-3 w-3" />
            </button>
            {projOpen ? (
              <div className="fos-menu left-0 mt-1">
                <button className="fos-menu-item" onClick={() => { setProject('all'); setProjOpen(false) }}>全部项目</button>
                <button className="fos-menu-item" onClick={() => { setProject('TEST'); setProjOpen(false) }}>TEST</button>
              </div>
            ) : null}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button className="fos-btn fos-btn-primary fos-btn-sm">
              <AppIcon name="checkDot" className="h-3.5 w-3.5" />批量操作
            </button>
          </div>
        </div>

        {/* grid */}
        <div className="flex-1 overflow-y-auto p-5">
          <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }}>
            {displayed.map((asset) => (
              <AssetCard key={asset.id} name={asset.name} role={asset.role} project={asset.project} />
            ))}
          </div>
          {displayed.length === 0 ? (
            <div className="mt-20 text-center text-[13px] text-[var(--fos-text-4)]">暂无资产</div>
          ) : null}
        </div>
      </main>
    </div>
  )
}
