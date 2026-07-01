'use client'

import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
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

interface MaterialItem {
  id: string
  name: string
  kind: '视频' | '图片' | '音频'
  duration?: string
  owner: string
  source: string
  format: string
  size: string
  created: string
  project: string
}

const DEMO_ITEMS: MaterialItem[] = [
  { id: '1', name: '苏晚卿·柴房惊惧', kind: '视频', duration: '15.07s', owner: 'xuyizhao', source: '工作流', format: 'MP4', size: '1.9 MB', created: '2026年6月15日 17:12:17', project: 'TEST' },
  { id: '2', name: '苏晚卿·雨夜祈祷', kind: '视频', duration: '14.09s', owner: 'xuyizhao', source: '工作流', format: 'MP4', size: '1.8 MB', created: '2026年6月15日 17:10:02', project: 'TEST' },
  { id: '3', name: '苏晚卿·庙中奔逃', kind: '视频', duration: '15.07s', owner: 'xuyizhao', source: '工作流', format: 'MP4', size: '2.0 MB', created: '2026年6月15日 17:08:44', project: 'TEST' },
  { id: '4', name: '苏晚卿·暗巷潜行', kind: '视频', duration: '15.07s', owner: 'xuyizhao', source: '工作流', format: 'MP4', size: '1.9 MB', created: '2026年6月15日 17:05:31', project: 'TEST' },
  { id: '5', name: '银簪·刺击特写', kind: '视频', duration: '15.09s', owner: 'xuyizhao', source: '工作流', format: 'MP4', size: '2.1 MB', created: '2026年6月15日 17:02:10', project: 'TEST' },
  { id: '6', name: '张秃子·受伤怒视', kind: '视频', duration: '8.08s', owner: 'xuyizhao', source: '工作流', format: 'MP4', size: '1.1 MB', created: '2026年6月15日 16:58:23', project: 'TEST' },
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

function MaterialCard({ item, onOpen }: { item: MaterialItem; onOpen: () => void }) {
  return (
    <button onClick={onOpen} className="overflow-hidden rounded-[10px] border border-[var(--fos-border-soft)] bg-[var(--fos-bg-2)] text-left transition-colors hover:border-[var(--fos-border-mid)]">
      <div className="relative flex aspect-[4/3] items-center justify-center bg-gradient-to-b from-[#181820] to-[#0e0e12]">
        <AppIcon name={item.kind === '音频' ? 'audioWave' : item.kind === '图片' ? 'image' : 'video'} className="h-9 w-9 text-white/12" />
        <span className="absolute bottom-2 left-2 rounded bg-black/65 px-1.5 py-0.5 text-[10px] font-bold text-white">{item.kind}</span>
        {item.duration ? <span className="absolute bottom-2 right-2 rounded bg-black/65 px-1.5 py-0.5 text-[10px] font-bold text-white">{item.duration}</span> : null}
      </div>
      <div className="flex items-center justify-between gap-2 px-3 py-2.5">
        <span className="flex min-w-0 items-center gap-1 text-[12px] text-[var(--fos-text-3)]"><AppIcon name="user" className="h-3 w-3 shrink-0" /><span className="truncate">{item.owner}</span></span>
        <span className="flex-none rounded bg-[var(--fos-fill-mid)] px-1.5 py-0.5 text-[11px] text-[var(--fos-text-3)]">{item.source}</span>
      </div>
    </button>
  )
}

function MaterialDetailDrawer({ item, onClose }: { item: MaterialItem; onClose: () => void }) {
  const rows: Array<[string, string]> = [
    ['归属项目', item.project], ['文件格式', item.format], ['时长', item.duration ?? '-'],
    ['文件大小', item.size], ['创建者', item.owner], ['创建时间', item.created],
  ]
  return (
    <div className="fixed inset-0 z-[60] flex justify-end bg-black/40" onClick={onClose}>
      <div className="flex h-full w-[440px] flex-col bg-[var(--fos-bg-2)] shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4">
          <h3 className="text-[16px] font-bold text-white">素材详情</h3>
          <button onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--fos-text-4)] hover:bg-[var(--fos-fill-mid)] hover:text-white"><AppIcon name="close" className="h-4 w-4" /></button>
        </div>
        <div className="px-5">
          <div className="relative flex aspect-video items-center justify-center overflow-hidden rounded-[10px] bg-gradient-to-b from-[#181820] to-[#0e0e12]">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-black/50 text-white"><AppIcon name="playCircle" className="h-7 w-7" /></span>
          </div>
        </div>
        <div className="mt-6 px-5">
          <div className="mb-3 flex items-center gap-2"><span className="h-3.5 w-1 rounded bg-[var(--fos-primary)]" /><span className="text-[14px] font-bold text-white">文件信息</span></div>
          <div className="divide-y divide-[var(--fos-border-soft)] rounded-[10px] border border-[var(--fos-border-soft)]">
            {rows.map(([k, v]) => (
              <div key={k} className="flex items-center justify-between px-4 py-3 text-[13px]">
                <span className="text-[var(--fos-text-3)]">{k}</span>
                <span className="font-bold text-white">{v}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export function FosMaterialLibrary() {
  const [category, setCategory] = useState('all-material')
  const [filter, setFilter] = useState<FilterTab>('all')
  const [gridMode, setGridMode] = useState(true)
  const params = useSearchParams()
  const [detail, setDetail] = useState<MaterialItem | null>(() => {
    const id = params?.get('detail')
    return id ? DEMO_ITEMS.find((m) => m.id === id) ?? null : null
  })

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
                className="rounded-[8px] px-3 py-1.5 text-[12px] font-bold"
                style={{
                  background: filter === t.key ? 'var(--fos-primary)' : 'transparent',
                  color: filter === t.key ? '#fff' : 'var(--fos-text-2)',
                }}>
                {t.label}
              </button>
            ))}
          </div>
          <span className="mx-1 h-4 w-px bg-[var(--fos-border-mid)]" />
          <button className="flex items-center gap-1 text-[12px] text-[var(--fos-text-3)]">创建时间 <AppIcon name="chevronDown" className="h-3 w-3" /></button>
          <div className="ml-auto flex items-center gap-2">
            <div className="flex items-center rounded-[8px] border border-[var(--fos-border-strong)] p-0.5">
              <button onClick={() => setGridMode(true)} className="flex h-7 w-7 items-center justify-center rounded-[6px]" style={{ background: gridMode ? 'var(--fos-primary)' : 'transparent', color: gridMode ? '#fff' : 'var(--fos-text-4)' }}>
                <AppIcon name="folderCards" className="h-4 w-4" />
              </button>
              <button onClick={() => setGridMode(false)} className="flex h-7 w-7 items-center justify-center rounded-[6px]" style={{ background: !gridMode ? 'var(--fos-primary)' : 'transparent', color: !gridMode ? '#fff' : 'var(--fos-text-4)' }}>
                <AppIcon name="receipt" className="h-4 w-4" />
              </button>
            </div>
            <button className="fos-btn fos-btn-primary fos-btn-sm">
              <AppIcon name="checkDot" className="h-3.5 w-3.5" />批量操作
            </button>
          </div>
        </div>

        {/* upload row */}
        <div className="border-b border-[var(--fos-border-soft)] px-5 py-2.5">
          <button className="fos-btn fos-btn-primary fos-btn-sm">
            <AppIcon name="plus" className="h-3.5 w-3.5" />本地上传
          </button>
        </div>

        {/* grid */}
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <div className="grid gap-4" style={{ gridTemplateColumns: gridMode ? 'repeat(3, minmax(0, 1fr))' : '1fr' }}>
            {DEMO_ITEMS.map((item) => (
              <MaterialCard key={item.id} item={item} onOpen={() => setDetail(item)} />
            ))}
          </div>
        </div>
      </main>

      {detail ? <MaterialDetailDrawer item={detail} onClose={() => setDetail(null)} /> : null}
    </div>
  )
}
