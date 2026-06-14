'use client'

import { useState } from 'react'
import { AppIcon } from '@/components/ui/icons'

type ToolTab = 'seedance' | 'image' | 'video' | 'music' | 'material' | 'text'

const TABS: Array<{ key: ToolTab; label: string; badge?: string }> = [
  { key: 'seedance', label: 'Seedance 2.0', badge: 'HOT' },
  { key: 'image', label: '图片生成' },
  { key: 'video', label: '视频生成' },
  { key: 'music', label: '音乐生成' },
  { key: 'material', label: '我的素材' },
  { key: 'text', label: '文本生成' },
]

const MODES = ['全能参考', '首尾帧', '版权IP']
const RATIOS = ['16:9', '9:16', '21:9']
const RESOLUTIONS = ['480p', '720p', '1080p']

function Dropdown({ label, value, options, required }: { label: string; value: string; options: string[]; required?: boolean }) {
  const [open, setOpen] = useState(false)
  const [val, setVal] = useState(value)
  return (
    <div>
      <div className="mb-2 text-[13px] font-medium text-white">{label}{required ? <span className="ml-0.5 text-[#ef4444]">*</span> : null}</div>
      <div className="relative">
        <button className="flex h-10 w-full items-center justify-between rounded-[8px] border border-[var(--fos-border-strong)] bg-[var(--fos-bg-1)] px-3 text-[13px] text-white" onClick={() => setOpen((v) => !v)} onBlur={() => setTimeout(() => setOpen(false), 150)}>
          <span>{val}</span><AppIcon name="chevronDown" className="h-3.5 w-3.5 text-[var(--fos-text-4)]" />
        </button>
        {open ? (
          <div className="fos-menu left-0 right-0 mt-1">
            {options.map((o) => <button key={o} className={`fos-menu-item${o === val ? ' active' : ''}`} onClick={() => { setVal(o); setOpen(false) }}>{o}</button>)}
          </div>
        ) : null}
      </div>
    </div>
  )
}

function UploadSlot({ label, subtitle }: { label: string; subtitle: string }) {
  return (
    <div className="mb-4">
      <div className="mb-2 flex items-baseline gap-2">
        <span className="text-[13px] font-medium text-white">{label}</span>
        <span className="text-[12px] text-[var(--fos-text-4)]">{subtitle}</span>
      </div>
      <button type="button" className="flex h-[72px] w-[72px] flex-col items-center justify-center gap-1 rounded-[8px] border border-dashed border-[var(--fos-border-strong)] text-[var(--fos-text-4)] hover:border-[var(--fos-primary-border)] hover:text-[var(--fos-text-2)]">
        <AppIcon name="plus" className="h-5 w-5" />
        <span className="text-[11px]">添加</span>
      </button>
    </div>
  )
}

function SeedancePanel() {
  const [mode, setMode] = useState('全能参考')
  const [prompt, setPrompt] = useState('')
  const [duration, setDuration] = useState('4')

  return (
    <div className="grid min-h-0 flex-1" style={{ gridTemplateColumns: '300px 1fr' }}>
      {/* left param panel */}
      <aside className="min-h-0 overflow-y-auto border-r border-[var(--fos-border-soft)] p-5">
        <Dropdown label="模型" value="Seedance 2.0" options={['Seedance 2.0', 'Seedance 2.0 Fast']} />

        <div className="mt-4">
          <div className="mb-2 text-[13px] font-medium text-white">模式</div>
          <div className="fos-seg w-full">
            {MODES.map((m) => (
              <button key={m} className={`fos-seg-opt flex-1${mode === m ? ' active' : ''}`} onClick={() => setMode(m)}>{m}</button>
            ))}
          </div>
        </div>

        <div className="mt-4">
          <div className="mb-2 flex items-center gap-2">
            <span className="text-[13px] font-medium text-white">提示词<span className="ml-0.5 text-[#ef4444]">*</span></span>
            <button className="rounded-md border border-[var(--fos-primary-border)] bg-[var(--fos-primary-soft)] px-2 py-0.5 text-[11px] font-bold text-[#6ea0ff]">优化</button>
            <label className="ml-auto flex items-center gap-1.5 text-[12px] text-[var(--fos-text-4)]">
              <input type="checkbox" className="accent-[var(--fos-primary)]" />显示原始文件名
            </label>
          </div>
          <textarea className="fos-textarea" style={{ minHeight: 140 }} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="请输入提示词，@ 引用参考素材..." />
        </div>

        <UploadSlot label="参考图片" subtitle="最多9张 · 至少1个图片或视频" />
        <UploadSlot label="参考视频" subtitle="最多3个 · 单个≥2s · 总长≤15s" />
        <UploadSlot label="参考音频" subtitle="最多3个 · 单个≥2s · 总长≤15s" />

        <div className="mt-4 grid grid-cols-3 gap-2">
          <div>
            <div className="mb-2 text-[13px] font-medium text-white">视频比例</div>
            <div className="fos-seg w-full flex-col" style={{ flexDirection: 'row' }}>
              {RATIOS.map((r) => <button key={r} className={`fos-seg-opt flex-1${r === '16:9' ? ' active' : ''}`}>{r}</button>)}
            </div>
          </div>
        </div>

        <div className="mt-4">
          <Dropdown label="分辨率" value="480p" options={RESOLUTIONS} required />
        </div>

        <div className="mt-4">
          <div className="mb-2 text-[13px] font-medium text-white">视频时长(4-15秒)<span className="ml-0.5 text-[#ef4444]">*</span></div>
          <div className="flex items-center gap-3">
            <input type="range" min="4" max="15" value={duration} onChange={(e) => setDuration(e.target.value)} className="flex-1 accent-[var(--fos-primary)]" />
            <span className="w-8 text-right text-[13px] font-bold text-white">{duration}s</span>
          </div>
        </div>

        <label className="mt-4 flex items-center gap-2 text-[13px] text-[var(--fos-text-2)]">
          <input type="checkbox" className="accent-[var(--fos-primary)]" />有声视频
        </label>

        <button className="fos-btn fos-btn-primary mt-5 w-full fos-btn-lg" disabled title="按量计费，演示已禁用">
          生成视频 <span className="ml-2 text-[#ffd27a]">495</span>
        </button>
      </aside>

      {/* right preview + history */}
      <main className="flex min-h-0 flex-1 flex-col overflow-y-auto p-6">
        <div className="flex flex-1 items-center justify-center rounded-[12px] border border-[var(--fos-border-mid)] bg-[var(--fos-bg-2)]" style={{ minHeight: 400 }}>
          <div className="text-center text-[var(--fos-text-4)]">
            <AppIcon name="imageLandscape" className="mx-auto mb-3 h-16 w-16" />
            <div className="text-[14px]">设置参数后点击生成</div>
          </div>
        </div>
        <div className="mt-6 flex items-center gap-4">
          <span className="text-[14px] font-bold text-white">生成历史</span>
          <label className="flex items-center gap-2 text-[13px] text-[var(--fos-text-3)]">
            展示失败记录
            <span className="relative inline-flex h-5 w-9 items-center rounded-full bg-[var(--fos-bg-4)]">
              <span className="inline-block h-4 w-4 rounded-full bg-[var(--fos-text-4)] transition-transform" style={{ transform: 'translateX(2px)' }} />
            </span>
          </label>
        </div>
        <div className="mt-3 text-center text-[13px] text-[var(--fos-text-4)]">暂无历史</div>
      </main>
    </div>
  )
}

function PlaceholderTab({ label }: { label: string }) {
  return (
    <div className="flex flex-1 items-center justify-center text-[14px] text-[var(--fos-text-4)]">
      {label} — 暂未开放
    </div>
  )
}

export function FosToolbox({ projectName = 'TEST' }: { projectName?: string }) {
  const [tab, setTab] = useState<ToolTab>('seedance')
  const [projOpen, setProjOpen] = useState(false)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* toolbox header bar */}
      <div className="flex items-center gap-4 border-b border-[var(--fos-border-soft)] px-6 py-3">
        <button className="fos-back-btn"><AppIcon name="chevronLeft" className="h-4 w-4" /></button>
        <h1 className="text-[16px] font-bold text-white">工具箱</h1>
        <span className="text-[13px] text-[var(--fos-text-3)]">归属项目</span>
        <div className="relative">
          <button className="fos-btn fos-btn-ghost" onClick={() => setProjOpen((v) => !v)} onBlur={() => setTimeout(() => setProjOpen(false), 150)}>
            {projectName} <AppIcon name="chevronDown" className="h-3.5 w-3.5" />
          </button>
          {projOpen ? (
            <div className="fos-menu left-0 mt-1">
              <button className="fos-menu-item active">{projectName}</button>
            </div>
          ) : null}
        </div>
      </div>

      {/* tab bar */}
      <div className="flex items-center gap-1 border-b border-[var(--fos-border-soft)] px-6">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className="relative flex items-center gap-1.5 px-4 py-3 text-[13px] font-bold"
            style={{ color: tab === t.key ? 'var(--fos-primary)' : 'var(--fos-text-2)' }}>
            {t.label}
            {t.badge ? <span className="rounded bg-[#7c3aed] px-1 py-px text-[9px] font-bold text-white">{t.badge}</span> : null}
            {tab === t.key ? <span className="absolute inset-x-4 -bottom-px h-0.5 bg-[var(--fos-primary)]" /> : null}
          </button>
        ))}
      </div>

      {/* tab content */}
      {tab === 'seedance' ? <SeedancePanel /> : <PlaceholderTab label={TABS.find((t) => t.key === tab)?.label ?? ''} />}
    </div>
  )
}
