'use client'

import { useState } from 'react'
import { AppIcon } from '@/components/ui/icons'

type FilterTab = 'all' | 'image' | 'video' | 'audio' | 'fav' | 'mine'

const FILTER_TABS: Array<{ key: FilterTab; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'image', label: '图片' },
  { key: 'video', label: '视频' },
  { key: 'audio', label: '音频' },
  { key: 'fav', label: '收藏' },
  { key: 'mine', label: '由我创建' },
]

interface CategoryNode {
  id: string
  label: string
  icon?: string
  children?: CategoryNode[]
}

const DEMO_CATEGORIES: CategoryNode[] = [
  {
    id: 'assets', label: '资产库', children: [],
  },
  { id: 'all-material', label: '全部素材' },
  { id: 'favorites', label: '我的收藏' },
  { id: 'proj-test', label: 'TEST' },
  { id: 'proj-deal', label: '$50,000 Deal with the Devil' },
]

const DEMO_ITEMS = [
  { id: '1', name: '角色 · 苏晚卿', type: '图片', owner: 'xuyizhao', source: '工作流' },
  { id: '2', name: '角色 · Dr. Carter', type: '图片', owner: 'xuyizhao', source: '工作流' },
  { id: '3', name: '物品 · 旧式棉袄', type: '图片', owner: 'xuyizhao', source: '工作流' },
  { id: '4', name: '环境 · 督军府正厅', type: '图片', owner: 'xuyizhao', source: '工作流' },
  { id: '5', name: '角色 · 苏晚卿(另一版)', type: '图片', owner: 'xuyizhao', source: '工作流' },
  { id: '6', name: '角色 · Emily', type: '图片', owner: 'xuyizhao', source: '工作流' },
]

function CategoryTree({ nodes, activeId, onSelect }: { nodes: CategoryNode[]; activeId: string; onSelect: (id: string) => void }) {
  return (
    <div className="space-y-0.5">
      {nodes.map((n) => (
        <div key={n.id}>
          <button onClick={() => onSelect(n.id)}
            className="flex w-full items-center gap-2 rounded-[8px] px-3 py-2 text-left text-[13px]"
            style={{
              background: activeId === n.id ? 'var(--fos-primary-soft)' : 'transparent',
              color: activeId === n.id ? '#6ea0ff' : 'var(--fos-text-2)',
              fontWeight: activeId === n.id ? 700 : 500,
            }}>
            <AppIcon name={n.children ? 'folderOpen' : 'folder'} className="h-4 w-4 shrink-0" />
            <span className="min-w-0 truncate">{n.label}</span>
          </button>
          {n.children && activeId === n.id ? (
            <div className="ml-4 mt-0.5 space-y-0.5">
              {n.children.map((c) => (
                <button key={c.id} onClick={() => onSelect(c.id)} className="flex w-full items-center gap-2 rounded-[8px] px-3 py-1.5 text-[12px] text-[var(--fos-text-3)]">
                  <span className="min-w-0 truncate">{c.label}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  )
}

function AssetCard({ name, type, owner, source }: { name: string; type: string; owner: string; source: string }) {
  return (
    <div className="overflow-hidden rounded-[10px] border border-[var(--fos-border-mid)] bg-[var(--fos-bg-2)] transition-colors hover:border-[var(--fos-border-strong)]">
      <div className="flex aspect-square items-center justify-center bg-[#111]">
        <AppIcon name="image" className="h-10 w-10 text-white/10" />
      </div>
      <div className="p-2.5">
        <div className="truncate text-[12px] font-bold text-white">{name}</div>
        <div className="mt-1 flex items-center gap-2 text-[11px] text-[var(--fos-text-4)]">
          <span className="rounded bg-[var(--fos-bg-4)] px-1.5 py-px font-bold">{type}</span>
          <span className="truncate"><AppIcon name="user" className="mr-0.5 inline h-3 w-3" />{owner}</span>
          <span>{source}</span>
        </div>
      </div>
    </div>
  )
}

export function FosMaterialLibrary() {
  const [category, setCategory] = useState('all-material')
  const [filter, setFilter] = useState<FilterTab>('all')
  const [gridMode, setGridMode] = useState(true)

  return (
    <div className="flex min-h-0 flex-1">
      {/* left sidebar */}
      <aside className="flex w-[220px] min-h-0 flex-col border-r border-[var(--fos-border-soft)] p-3 overflow-y-auto" style={{ flex: '0 0 220px' }}>
        <div className="mb-3 flex items-center gap-2">
          <button className="fos-back-btn" style={{ width: 28, height: 28 }}><AppIcon name="chevronLeft" className="h-3.5 w-3.5" /></button>
          <span className="text-[13px] font-bold text-[var(--fos-text-3)]">分类</span>
        </div>
        <CategoryTree nodes={DEMO_CATEGORIES} activeId={category} onSelect={setCategory} />
      </aside>

      {/* right content */}
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* filter bar */}
        <div className="flex flex-wrap items-center gap-3 border-b border-[var(--fos-border-soft)] px-5 py-3">
          <div className="flex items-center gap-1">
            {FILTER_TABS.map((t) => (
              <button key={t.key} onClick={() => setFilter(t.key)}
                className="rounded-full px-3 py-1.5 text-[12px] font-bold"
                style={{
                  background: filter === t.key ? 'var(--fos-primary)' : 'transparent',
                  color: filter === t.key ? '#fff' : 'var(--fos-text-2)',
                }}>
                {t.label}
              </button>
            ))}
          </div>
          <span className="mx-1 h-4 w-px bg-[var(--fos-border-mid)]" />
          <button className="text-[12px] text-[var(--fos-text-3)]">创建时间 <AppIcon name="chevronDown" className="inline h-3 w-3" /></button>
          <div className="ml-auto flex items-center gap-2">
            <button className="fos-btn fos-btn-primary fos-btn-sm">
              <AppIcon name="checkDot" className="h-3.5 w-3.5" />批量操作
            </button>
            <button className="fos-btn fos-btn-ghost fos-btn-sm">
              <AppIcon name="plus" className="h-3.5 w-3.5" />本地上传
            </button>
            <button onClick={() => setGridMode(true)} className="p-1" style={{ color: gridMode ? 'var(--fos-primary)' : 'var(--fos-text-4)' }}>
              <AppIcon name="folderCards" className="h-4 w-4" />
            </button>
            <button onClick={() => setGridMode(false)} className="p-1" style={{ color: !gridMode ? 'var(--fos-primary)' : 'var(--fos-text-4)' }}>
              <AppIcon name="barChart" className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* grid */}
        <div className="flex-1 overflow-y-auto p-5">
          <div className="grid gap-4" style={{ gridTemplateColumns: gridMode ? 'repeat(auto-fill, minmax(180px, 1fr))' : '1fr' }}>
            {DEMO_ITEMS.map((item) => (
              <AssetCard key={item.id} {...item} />
            ))}
          </div>
        </div>
      </main>
    </div>
  )
}
