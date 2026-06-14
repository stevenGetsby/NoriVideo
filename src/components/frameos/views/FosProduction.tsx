'use client'

import { useState } from 'react'
import { Link } from '@/i18n/navigation'
import { AppIcon } from '@/components/ui/icons'
import { demoEpisodes } from '../fosDemoData'
import type { FosProjectData } from '../useFosProject'
import { ExportDeliveryDialog } from '../ExportDeliveryDialog'

const TICKS = ['00:00', '00:05', '00:10', '00:15', '00:20', '00:25', '00:30', '00:35', '00:40', '00:45']

export function FosProductionEpisodes({ data }: { data: FosProjectData }) {
  const episodes = data.usingDemo ? demoEpisodes : data.episodes
  const base = `/workflow/${data.projectId}/workbench-premium2`
  return (
    <div className="fos-scroll">
      <section className="px-6 py-6">
        <h2 className="mb-1 text-[16px] font-bold text-white">制作剪辑 · 选择分集</h2>
        <p className="mb-5 text-[13px] text-[var(--fos-text-3)]">选择一集进入时间线组装，或查看其分镜。</p>
        <div className="overflow-hidden rounded-[10px] border border-[var(--fos-border-mid)]">
          <div className="grid bg-[var(--fos-bg-3)] px-5 py-3 text-[12px] font-bold text-[var(--fos-text-3)]" style={{ gridTemplateColumns: '64px 1fr 140px 220px' }}>
            <div>序号</div><div>标题</div><div>状态</div><div>操作</div>
          </div>
          {episodes.map((ep, i) => (
            <div key={ep.id} className="grid items-center border-t border-[var(--fos-border-soft)] px-5 py-3.5 text-[13px]" style={{ gridTemplateColumns: '64px 1fr 140px 220px' }}>
              <div className="font-bold text-[#4f85ff]">E{ep.episodeNumber}</div>
              <div className="truncate pr-4 font-bold text-white">{ep.name}</div>
              <div>{i === 0 ? <span className="fos-status failed">分镜失败</span> : <span className="fos-status idle">待制作</span>}</div>
              <div className="flex gap-2">
                <Link href={{ pathname: `${base}/production/timeline` }} className="fos-btn fos-btn-soft fos-btn-sm">进入时间线</Link>
                <Link href={{ pathname: `${base}/storyboard` }} className="fos-btn fos-btn-ghost fos-btn-sm">查看分镜</Link>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

function Track({ label, tone, clips }: { label: string; tone: 'scene' | 'shot' | 'bgm'; clips: Array<[string, number]> }) {
  const color = { scene: '#5bd08f', shot: '#5c83ff', bgm: '#f1b84c' }[tone]
  const bg = { scene: 'rgba(91,208,143,.12)', shot: 'rgba(92,131,255,.14)', bgm: 'rgba(241,184,76,.14)' }[tone]
  return (
    <div className="grid border-t border-[var(--fos-border-soft)]" style={{ gridTemplateColumns: '72px 1fr' }}>
      <div className="flex items-center gap-2 border-r border-[var(--fos-border-soft)] px-3 py-3 text-[12px] font-bold text-[var(--fos-text-3)]">
        <span className="h-5 w-1 rounded-full" style={{ background: color }} />{label}
      </div>
      <div className="relative min-h-14 px-3 py-2.5">
        <div className="absolute inset-x-3 top-1/2 h-px bg-[var(--fos-border-mid)]" />
        <div className="relative flex gap-2">
          {clips.map(([title, w]) => (
            <div key={title} className="flex h-9 items-center rounded-md border px-3 text-[11px] font-bold" style={{ width: w, borderColor: color, background: bg, color }}>{title}</div>
          ))}
        </div>
      </div>
    </div>
  )
}

export function FosProductionTimeline({ data }: { data: FosProjectData }) {
  const episodes = data.usingDemo ? demoEpisodes : data.episodes
  const [showExport, setShowExport] = useState(false)
  const [epOpen, setEpOpen] = useState(false)
  const [ep, setEp] = useState(episodes[0]?.episodeNumber ?? 1)
  const [playing, setPlaying] = useState(false)

  return (
    <div className="fos-scroll">
      <section className="px-6 py-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-[16px] font-bold text-white">时间线 · 组装预览</h2>
          <button className="fos-btn fos-btn-ghost" onClick={() => setShowExport(true)}>导出交付</button>
        </div>

        <div className="grid gap-5" style={{ gridTemplateColumns: '1fr 300px' }}>
          <div className="overflow-hidden rounded-[10px] border border-[var(--fos-border-mid)] bg-black">
            <div className="flex items-center justify-center text-[var(--fos-text-4)]" style={{ height: 320 }}>
              <div className="text-center"><AppIcon name="video" className="mx-auto mb-2 h-12 w-12" /><div className="text-[13px]">00:00 / 00:00</div></div>
            </div>
            <div className="flex items-center justify-center gap-3 border-t border-[var(--fos-border-soft)] bg-[var(--fos-bg-2)] py-3">
              <button className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--fos-bg-4)] text-white"><AppIcon name="chevronLeft" className="h-4 w-4" /></button>
              <button className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--fos-primary)] text-white" onClick={() => setPlaying((v) => !v)}>
                <AppIcon name={playing ? 'pause' : 'play'} className="h-5 w-5" />
              </button>
              <button className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--fos-bg-4)] text-white"><AppIcon name="chevronRight" className="h-4 w-4" /></button>
            </div>
          </div>
          <div className="space-y-3">
            <div>
              <div className="mb-2 text-[13px] font-bold text-[var(--fos-text-3)]">剧集</div>
              <div className="relative">
                <button className="fos-btn fos-btn-ghost w-full justify-between" onClick={() => setEpOpen((v) => !v)} onBlur={() => setTimeout(() => setEpOpen(false), 150)}>
                  <span>E{ep} {episodes.find((e) => e.episodeNumber === ep)?.name}</span><AppIcon name="chevronDown" className="h-4 w-4" />
                </button>
                {epOpen ? (
                  <div className="fos-menu left-0 right-0 mt-1 max-h-60 overflow-y-auto">
                    {episodes.map((e) => <button key={e.id} className={`fos-menu-item${e.episodeNumber === ep ? ' active' : ''}`} onClick={() => { setEp(e.episodeNumber); setEpOpen(false) }}>E{e.episodeNumber} {e.name}</button>)}
                  </div>
                ) : null}
              </div>
            </div>
            <button className="fos-btn fos-btn-primary w-full" disabled title="后端生成操作，演示已禁用">一键生成</button>
          </div>
        </div>

        <div className="mt-5 overflow-hidden rounded-[10px] border border-[var(--fos-border-mid)]">
          <div className="grid border-b border-[var(--fos-border-soft)] bg-[var(--fos-bg-3)]" style={{ gridTemplateColumns: '72px 1fr' }}>
            <div />
            <div className="flex justify-between px-3 py-2 text-[11px] text-[var(--fos-text-4)]">{TICKS.map((t) => <span key={t}>{t}</span>)}</div>
          </div>
          <Track label="场景" tone="scene" clips={[['S01 柴房', 180], ['S02 土地庙', 120]]} />
          <Track label="分镜" tone="shot" clips={[['镜1', 90], ['镜2', 90], ['镜3', 110]]} />
          <Track label="BGM" tone="bgm" clips={[['紧张配乐', 300]]} />
        </div>
      </section>
      {showExport ? <ExportDeliveryDialog episodeCount={episodes.length} onClose={() => setShowExport(false)} /> : null}
    </div>
  )
}
