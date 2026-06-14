'use client'

import { useState } from 'react'
import { AppIcon } from '@/components/ui/icons'
import { demoCharacters, demoItems, demoEnvironments } from '../fosDemoData'
import type { FosProjectData, FosAsset } from '../useFosProject'
import { AssetTabs, AssetPlaceholder, AddAssetDialog, ImageZoom, type AssetTab } from './FosAssetShared'

const PAGE_META: Record<Exclude<AssetTab, 'timbre'>, { title: string; listTitle: string; bgTitle: string; promptTitle: string; mediaTitle: string }> = {
  characters: { title: '角色资产设定', listTitle: '角色列表', bgTitle: '角色背景', promptTitle: '角色提示词', mediaTitle: '形象设定图' },
  items: { title: '物品资产设定', listTitle: '物品列表', bgTitle: '物品背景', promptTitle: '物品提示词', mediaTitle: '物品设定图' },
  environments: { title: '环境资产设定', listTitle: '环境列表', bgTitle: '环境背景', promptTitle: '环境提示词', mediaTitle: '环境设定图' },
}

function useAssetList(data: FosProjectData, tab: Exclude<AssetTab, 'timbre'>): FosAsset[] {
  if (data.usingDemo) return tab === 'characters' ? demoCharacters : tab === 'items' ? demoItems : demoEnvironments
  return tab === 'characters' ? data.characters : tab === 'items' ? data.items : data.environments
}

function HistoryPanel() {
  const rows: Array<[string, string, string, string]> = [
    ['16:21', 'character_image', '已完成', '主图 · 16:9 · 480p'],
    ['16:18', 'character_image', '生成失败', '余额不足，未扣费'],
    ['16:06', '导入素材', '已完成', '来自素材库 · 已选用'],
  ]
  return (
    <div className="fos-card overflow-hidden">
      <div className="flex items-center justify-between border-b border-[var(--fos-border-soft)] px-4 py-2.5">
        <h4 className="text-[13px] font-bold text-white">生图历史</h4>
        <button className="text-[12px] font-bold text-[#8fa9ff]">展示失败记录</button>
      </div>
      <div className="divide-y divide-[var(--fos-border-soft)]">
        {rows.map(([time, model, status, note]) => (
          <div key={`${time}-${status}`} className="grid items-center gap-3 px-4 py-2.5 text-[12px]" style={{ gridTemplateColumns: '48px 1fr 64px' }}>
            <div className="text-[var(--fos-text-4)]">{time}</div>
            <div className="min-w-0"><div className="truncate font-bold text-[var(--fos-text-2)]">{model}</div><div className="truncate text-[var(--fos-text-4)]">{note}</div></div>
            <div className={status === '生成失败' ? 'text-right font-bold text-[#ff7777]' : 'text-right font-bold text-[#5bd08f]'}>{status}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function FosAssetSetting({ data, tab }: { data: FosProjectData; tab: Exclude<AssetTab, 'timbre'> }) {
  const meta = PAGE_META[tab]
  const list = useAssetList(data, tab)
  const [activeId, setActiveId] = useState(list[0]?.id ?? '')
  const [showAdd, setShowAdd] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [zoom, setZoom] = useState(false)
  const active = list.find((a) => a.id === activeId) ?? list[0]
  const count = list.length

  return (
    <div className="grid min-h-0 flex-1" style={{ gridTemplateColumns: '240px 1fr' }}>
      <aside className="flex min-h-0 flex-col border-r border-[var(--fos-border-soft)]">
        <div className="flex-none p-3">
          <AssetTabs projectId={data.projectId} active={tab} />
          <div className="flex items-center justify-between">
            <h2 className="text-[14px] font-bold text-white">{meta.listTitle}</h2>
            <div className="flex items-center gap-2">
              <button className="text-[12px] font-bold text-[#4f85ff]" onClick={() => setShowAdd(true)}>+新增</button>
              <span className="fos-pill" style={{ height: 22 }}>{count}/{count}</span>
            </div>
          </div>
        </div>
        <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-3 pb-4">
          {list.map((a) => {
            const isActive = a.id === active?.id
            return (
              <button key={a.id} onClick={() => setActiveId(a.id)}
                className="w-full rounded-[10px] px-3 py-2.5 text-left"
                style={{ border: isActive ? '1px solid var(--fos-primary)' : '1px solid transparent', background: isActive ? 'var(--fos-primary-soft)' : 'transparent' }}>
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-[13px] font-bold text-white">{a.name}</span>
                  <AppIcon name="check" className="h-4 w-4 shrink-0 text-[#5bd08f]" />
                </div>
                <div className="mt-0.5 text-[12px] text-[var(--fos-text-4)]">{a.type}</div>
              </button>
            )
          })}
        </div>
      </aside>

      <article className="min-h-0 overflow-y-auto p-6 pb-20">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-[16px] font-bold text-white">
            {active?.name}
            <span className="rounded-md bg-[rgba(59,130,246,.18)] px-2.5 py-1 text-[12px] text-[#6ea0ff]">{active?.type}</span>
          </h2>
          <div className="flex flex-wrap gap-2">
            <button className="fos-btn fos-btn-ghost fos-btn-sm">补充提取</button>
            <button className="fos-btn fos-btn-ghost fos-btn-sm">重新提取</button>
            <button className="fos-btn fos-btn-primary fos-btn-sm" title="按量计费，演示已禁用" disabled>一键生成主图和变体图</button>
          </div>
        </div>

        <div className="grid gap-6" style={{ gridTemplateColumns: '0.9fr 1.1fr' }}>
          <section className="space-y-4">
            <div>
              <h3 className="mb-2 text-[13px] font-bold text-[var(--fos-text-3)]">{meta.bgTitle}</h3>
              <p className="text-[13px] leading-7 text-[var(--fos-text-2)]">{active?.description ?? '暂无背景描述。'}</p>
            </div>
            <div>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-[13px] font-bold text-[var(--fos-text-3)]">{meta.promptTitle}</h3>
                <button className="fos-btn fos-btn-ghost fos-btn-sm">保存描述</button>
              </div>
              <textarea className="fos-textarea" style={{ minHeight: 260 }} defaultValue={active?.prompt ?? ''} placeholder="提示词" />
            </div>
            <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
              <button className="fos-btn fos-btn-soft fos-btn-sm">出场集</button>
              <button className="fos-btn fos-btn-ghost fos-btn-sm">全部选中</button>
              <button className="fos-btn fos-btn-ghost fos-btn-sm">全部清除</button>
            </div>
          </section>

          <section>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-[14px] font-bold text-white">{meta.mediaTitle}</h3>
              <button className="fos-btn fos-btn-ghost fos-btn-sm" onClick={() => setShowHistory((v) => !v)}>
                <AppIcon name="clock" className="h-3.5 w-3.5" />生图历史
              </button>
            </div>
            <div className="relative overflow-hidden rounded-[10px] border border-[var(--fos-border-mid)]">
              <div className="aspect-[16/9]"><AssetPlaceholder kind={tab} /></div>
              <button onClick={() => setZoom(true)} className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-md bg-black/50 text-white/80 hover:bg-black/70" title="放大查看">
                <AppIcon name="search" className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button className="fos-btn fos-btn-primary fos-btn-sm" disabled title="按量计费，演示已禁用">生成</button>
              {['重新生成', 'AI 修改图片', '导入素材'].map((t) => <button key={t} className="fos-btn fos-btn-ghost fos-btn-sm">{t}</button>)}
            </div>
            {showHistory ? <div className="mt-3"><HistoryPanel /></div> : null}
          </section>
        </div>
      </article>

      <div className="fos-bottom-bar" style={{ gridColumn: '1 / -1' }}>
        <button className="fos-btn fos-btn-ghost">取消</button>
        <button className="fos-btn fos-btn-soft">取消确认</button>
      </div>

      {showAdd ? <AddAssetDialog kind={tab} onClose={() => setShowAdd(false)} /> : null}
      {zoom ? <ImageZoom onClose={() => setZoom(false)}><AssetPlaceholder kind={tab} /></ImageZoom> : null}
    </div>
  )
}
