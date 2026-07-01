'use client'

import { useState } from 'react'
import { AppIcon } from '@/components/ui/icons'
import { demoCharacters, demoItems, demoEnvironments } from '../fosDemoData'
import type { FosProjectData } from '../useFosProject'
import { AssetPlaceholder, ImageZoom, type AssetTab } from './FosAssetShared'

const SHOTS = [
  { id: 'SHOT-001', scene: 'S01', title: '柴房惊醒', status: '视频失败', duration: '4s' },
  { id: 'SHOT-002', scene: 'S01', title: '张秃子逼近', status: '待生成', duration: '4s' },
  { id: 'SHOT-003', scene: 'S02', title: '雨夜奔逃', status: '待生成', duration: '4s' },
]
const CENTER_TABS = ['生成历史', '导入', '视频增强', '字幕擦除']
const MODELS = ['Seedance 2.0', 'Seedance 2.0 Fast']
const RESOLUTIONS = ['480p', '720p', '1080p']
const DURATIONS = ['4s', '5s', '6s', '8s', '10s', '12s', '15s']

function Dropdown({ label, value, options }: { label: string; value: string; options: string[] }) {
  const [open, setOpen] = useState(false)
  const [val, setVal] = useState(value)
  return (
    <div className="relative">
      <div className="mb-1 text-[12px] font-bold text-[var(--fos-text-4)]">{label}</div>
      <button className="fos-btn fos-btn-ghost w-full justify-between fos-btn-sm" onClick={() => setOpen((v) => !v)} onBlur={() => setTimeout(() => setOpen(false), 150)}>
        <span>{val}</span><AppIcon name="chevronDown" className="h-3.5 w-3.5" />
      </button>
      {open ? (
        <div className="fos-menu left-0 right-0 mt-1">
          {options.map((o) => <button key={o} className={`fos-menu-item${o === val ? ' active' : ''}`} onClick={() => { setVal(o); setOpen(false) }}>{o}</button>)}
        </div>
      ) : null}
    </div>
  )
}

function ReferencePicker({ kind, onClose }: { kind: AssetTab; onClose: () => void }) {
  const list = kind === 'items' ? demoItems : kind === 'environments' ? demoEnvironments : demoCharacters
  const [query, setQuery] = useState('')
  const [zoom, setZoom] = useState(false)
  const filtered = list.filter((a) => a.name.includes(query))
  return (
    <div className="fos-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="fos-dialog" style={{ maxWidth: 640 }}>
        <div className="fos-dialog-head">
          <div className="fos-dialog-title">选择参考资产</div>
          <button type="button" className="fos-dialog-x" onClick={onClose}><AppIcon name="close" className="h-4 w-4" /></button>
        </div>
        <div className="fos-dialog-body">
          <div className="relative mb-4">
            <AppIcon name="search" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--fos-text-4)]" />
            <input className="fos-input" style={{ paddingLeft: 36 }} placeholder="搜索资产名称…" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            {filtered.map((a) => (
              <button key={a.id} className="overflow-hidden rounded-[10px] border border-[var(--fos-border-mid)] text-left hover:border-[var(--fos-primary)]" onClick={() => setZoom(true)}>
                <div className="aspect-[16/9]"><AssetPlaceholder kind={kind} /></div>
                <div className="truncate px-2 py-1.5 text-[12px] font-bold text-white">{a.name}</div>
              </button>
            ))}
          </div>
        </div>
      </div>
      {zoom ? <ImageZoom onClose={() => setZoom(false)}><AssetPlaceholder kind={kind} /></ImageZoom> : null}
    </div>
  )
}

function PromptExpand({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState('')
  return (
    <div className="fos-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="fos-dialog" style={{ maxWidth: 680 }}>
        <div className="fos-dialog-head"><div className="fos-dialog-title">编辑正文提示词</div><button className="fos-dialog-x" onClick={onClose}><AppIcon name="close" className="h-4 w-4" /></button></div>
        <div className="fos-dialog-body"><textarea className="fos-textarea" style={{ minHeight: 280 }} value={text} onChange={(e) => setText(e.target.value)} placeholder="输入镜头视频提示词…" autoFocus /></div>
        <div className="fos-dialog-foot"><button className="fos-btn fos-btn-primary" onClick={onClose}>完成</button></div>
      </div>
    </div>
  )
}

export function FosProductionShot({ data }: { data: FosProjectData }) {
  const [activeShot, setActiveShot] = useState(SHOTS[0].id)
  const [centerTab, setCenterTab] = useState(CENTER_TABS[0])
  const [picker, setPicker] = useState<AssetTab | null>(null)
  const [promptOpen, setPromptOpen] = useState(false)
  const shot = SHOTS.find((s) => s.id === activeShot) ?? SHOTS[0]

  return (
    <div className="grid min-h-0 flex-1" style={{ gridTemplateColumns: '300px 1fr 360px' }}>
      <aside className="flex min-h-0 flex-col border-r border-[var(--fos-border-soft)] p-3">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[14px] font-bold text-white">场景镜头列表</h2>
          <span className="fos-pill" style={{ height: 22 }}>3 镜</span>
        </div>
        <div className="space-y-2.5 overflow-y-auto">
          {SHOTS.map((s) => {
            const isActive = s.id === activeShot
            return (
              <button key={s.id} onClick={() => setActiveShot(s.id)} className="w-full rounded-[10px] border p-3 text-left"
                style={{ borderColor: isActive ? 'var(--fos-primary)' : 'var(--fos-border-mid)', background: isActive ? 'var(--fos-primary-soft)' : 'var(--fos-bg-2)' }}>
                <div className="flex items-center justify-between">
                  <span className="text-[12px] font-bold text-[#8fa9ff]">{s.scene} · {s.id}</span>
                  <span className={s.status === '视频失败' ? 'text-[12px] font-bold text-[#ff7777]' : 'text-[12px] font-bold text-[var(--fos-text-4)]'}>{s.status}</span>
                </div>
                <div className="mt-1.5 text-[13px] font-bold text-white">{s.title}</div>
                <div className="mt-1 text-[11px] text-[var(--fos-text-4)]">{s.duration}</div>
              </button>
            )
          })}
        </div>
      </aside>

      <main className="min-w-0 overflow-y-auto border-r border-[var(--fos-border-soft)] p-5">
        <div className="mb-4 flex items-center justify-between">
          <div><h2 className="text-[16px] font-bold text-white">{shot.scene} · {shot.title}</h2><p className="mt-1 text-[12px] text-[var(--fos-text-4)]">{shot.id} · 当前视频失败时必须先重新生成。</p></div>
          <div className="flex gap-2"><button className="fos-btn fos-btn-ghost fos-btn-sm">复用参数</button><button className="fos-btn fos-btn-ghost fos-btn-sm">申诉</button></div>
        </div>
        <div className="mb-4 flex aspect-[9/16] max-h-[440px] items-center justify-center rounded-[12px] border border-[var(--fos-border-mid)] bg-black text-[var(--fos-text-4)]">
          <div className="text-center"><AppIcon name="video" className="mx-auto mb-2 h-14 w-14" /><div className="text-[14px] font-bold">当前镜头暂无可用视频</div><div className="mt-1 text-[12px]">失败后可查看生成历史、复用参数或重新生成。</div></div>
        </div>
        <div className="flex gap-5 border-b border-[var(--fos-border-soft)]">
          {CENTER_TABS.map((t) => (
            <button key={t} onClick={() => setCenterTab(t)} className="relative h-9 text-[13px] font-bold" style={{ color: centerTab === t ? 'var(--fos-primary)' : 'var(--fos-text-2)' }}>
              {t}{centerTab === t ? <span className="absolute inset-x-0 -bottom-px h-0.5 bg-[var(--fos-primary)]" /> : null}
            </button>
          ))}
        </div>
        <div className="py-4 text-[13px] text-[var(--fos-text-3)]">{centerTab}：暂无记录。</div>
      </main>

      <aside className="min-h-0 overflow-y-auto p-4">
        <h3 className="mb-3 text-[14px] font-bold text-white">选择参考资产</h3>
        <p className="mb-3 text-[12px] text-[var(--fos-text-4)]">分镜参考素材配额：参考图 0/9 · 参考视频 0/3 · 参考音频 0/3</p>
        <div className="space-y-2">
          {(['characters', 'items', 'environments'] as const).map((k) => (
            <div key={k} className="flex items-center justify-between rounded-[10px] border border-[var(--fos-border-mid)] bg-[var(--fos-bg-2)] px-3 py-2.5">
              <span className="text-[13px] font-bold text-white">{k === 'characters' ? '角色' : k === 'items' ? '物品' : '环境'}</span>
              <button className="fos-btn fos-btn-soft fos-btn-sm" onClick={() => setPicker(k)}><AppIcon name="plus" className="h-3.5 w-3.5" />添加</button>
            </div>
          ))}
          <button className="fos-btn fos-btn-ghost w-full">参考前一镜视频</button>
          <button className="fos-btn fos-btn-ghost w-full">添加额外参考素材</button>
        </div>

        <h3 className="mb-3 mt-5 text-[14px] font-bold text-white">◎ 输出参数</h3>
        <div className="grid grid-cols-3 gap-2">
          <Dropdown label="视频模型" value="Seedance 2.0" options={MODELS} />
          <Dropdown label="分辨率" value="480p" options={RESOLUTIONS} />
          <Dropdown label="视频秒数" value="4s" options={DURATIONS} />
        </div>

        <div className="mt-4 flex items-center justify-between"><span className="text-[13px] font-bold text-white">◈ 视频提示词</span><button className="text-[12px] font-bold text-[#8fa9ff]" onClick={() => setPromptOpen(true)}>展开编辑</button></div>
        <textarea className="fos-textarea mt-2" style={{ minHeight: 80 }} placeholder="输入镜头视频提示词…" />
        <div className="mt-3 flex items-center justify-between"><span className="text-[13px] font-bold text-white">◈ 画风描述</span><button className="fos-btn fos-btn-ghost fos-btn-sm">优化提示词</button></div>
        <textarea className="fos-textarea mt-2" style={{ minHeight: 64 }} placeholder="画风描述…" />
        <label className="mt-3 flex items-center gap-2 text-[12px] text-[var(--fos-text-3)]"><input type="checkbox" className="accent-[var(--fos-primary)]" />使用参考配额内的额外素材</label>
        <button className="fos-btn fos-btn-primary mt-4 w-full" disabled title="后端生成操作，演示已禁用">生成视频</button>
      </aside>

      {picker ? <ReferencePicker kind={picker} onClose={() => setPicker(null)} /> : null}
      {promptOpen ? <PromptExpand onClose={() => setPromptOpen(false)} /> : null}
    </div>
  )
}
