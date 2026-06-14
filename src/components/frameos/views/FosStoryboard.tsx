'use client'

import { useState } from 'react'
import { AppIcon } from '@/components/ui/icons'
import { demoEpisodes } from '../fosDemoData'
import type { FosProjectData } from '../useFosProject'

const FAILED = new Set([1, 2, 3])
const MODEL_OPTIONS = ['Auto', 'CO', 'OG', 'GM', 'DeepSeek', 'Qwen', 'Kimi', 'Seed']
const SCENES: Array<[string, string]> = [['S01', '张秃子家破旧柴房'], ['S02', '城郊破旧土地庙']]

function ModelMenu() {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <button className="fos-btn fos-btn-ghost fos-btn-sm" onClick={() => setOpen((v) => !v)} onBlur={() => setTimeout(() => setOpen(false), 150)}>
        Auto <AppIcon name="chevronDown" className="h-3 w-3" />
      </button>
      {open ? (
        <div className="fos-menu right-0 mt-1">
          {MODEL_OPTIONS.map((m, i) => <button key={m} className={`fos-menu-item${i === 0 ? ' active' : ''}`}>{m}</button>)}
        </div>
      ) : null}
    </div>
  )
}

export function FosStoryboard({ data }: { data: FosProjectData }) {
  const episodes = data.usingDemo ? demoEpisodes : data.episodes
  const [expanded, setExpanded] = useState(false)
  const [activeEp, setActiveEp] = useState(episodes[0]?.episodeNumber ?? 1)
  const [billingHelp, setBillingHelp] = useState(false)
  const visible = expanded ? episodes : episodes.slice(0, 10)

  return (
    <div className="fos-scroll">
      <section className="p-6">
        {/* episode tabs */}
        <div className="mb-6 flex flex-wrap items-center gap-2">
          <span className="shrink-0 text-[13px] font-bold text-[var(--fos-text-3)]">分集：</span>
          {visible.map((ep) => {
            const isFailed = FAILED.has(ep.episodeNumber)
            const isActive = ep.episodeNumber === activeEp
            return (
              <button key={ep.id} onClick={() => setActiveEp(ep.episodeNumber)}
                className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[12px] font-bold"
                style={{
                  border: isActive ? '1px solid var(--fos-primary)' : '1px solid transparent',
                  background: isActive ? 'var(--fos-primary-soft)' : isFailed ? 'rgba(239,68,68,.12)' : 'var(--fos-bg-3)',
                  color: isActive ? '#ff6a6a' : isFailed ? '#ff5f5f' : 'var(--fos-text-2)',
                }}>
                E{ep.episodeNumber} {ep.name}
                {isFailed ? <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-[#ff5f5f] px-1 text-[10px] text-white">!</span> : null}
              </button>
            )
          })}
          {!expanded ? (
            <button className="h-8 shrink-0 rounded-full border border-[var(--fos-primary-border)] bg-[var(--fos-primary-soft)] px-3.5 text-[12px] font-bold text-[#6ea0ff]" onClick={() => setExpanded(true)}>
              展开全部 {episodes.length} 集
            </button>
          ) : null}
        </div>

        {/* failed banner */}
        <div className="mb-6 flex items-start gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#55201f] text-[18px] font-bold text-[#ff6969]">!</div>
          <div>
            <h2 className="text-[16px] font-bold text-[#4f85ff]">第 {activeEp} 集 · 分镜生成失败</h2>
            <p className="mt-1 text-[13px] text-[var(--fos-text-3)]">部分步骤或场景生成失败，请在下方失败场景行点击重试；也可切换其他已完成的集预览。</p>
          </div>
        </div>

        {/* 2-step pipeline */}
        <div className="mb-6 fos-card p-5">
          <div className="grid items-center gap-5" style={{ gridTemplateColumns: '1fr 100px 1fr' }}>
            <div className="rounded-[10px] border border-[#2c7f58] bg-[#13231b] p-4"><div className="text-[14px] font-bold text-white">片段切分</div><div className="mt-1 text-[13px] text-[var(--fos-text-3)]">已完成</div></div>
            <div className="h-px bg-[var(--fos-border-strong)]" />
            <div className="rounded-[10px] border border-[#833b3b] bg-[#2b1717] p-4"><div className="text-[14px] font-bold text-white">按场景编排镜头</div><div className="mt-1 text-[13px] text-[#ff7777]">失败</div></div>
          </div>
        </div>

        {/* scene progress table */}
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h3 className="text-[16px] font-bold text-white">场景并行进度</h3>
            <p className="mt-1 text-[13px] text-[var(--fos-text-3)]">每个场景并行推进：场景分析 → 镜头编排 → 结果质检。</p>
          </div>
          <span className="rounded-[10px] border border-[var(--fos-primary-border)] bg-[var(--fos-primary-soft)] px-3 py-1.5 text-[13px] font-bold text-[#6ea0ff]">0/2 场景完成</span>
        </div>
        <div className="overflow-hidden rounded-[10px] border border-[var(--fos-border-mid)]">
          <div className="grid bg-[var(--fos-bg-3)] px-5 py-3 text-[12px] font-bold text-[var(--fos-text-3)]" style={{ gridTemplateColumns: '64px 200px 1fr 1fr 1fr 220px' }}>
            <div>场景</div><div>场景名称</div><div>场景分析</div><div>镜头编排</div><div>结果质检</div><div />
          </div>
          {SCENES.map(([code, name]) => (
            <div key={code} className="grid items-center border-t border-[var(--fos-border-soft)] px-5 py-4 text-[13px] font-bold" style={{ gridTemplateColumns: '64px 200px 1fr 1fr 1fr 220px' }}>
              <div className="text-[#4f85ff]">{code}</div>
              <div className="truncate pr-4 text-white">{name}</div>
              <div className="text-[#5bd08f]">✓ 已完成</div>
              <div className="text-[#ff6767]">! 失败</div>
              <div className="text-[#ff6767]">! 失败</div>
              <div className="flex items-center gap-2">
                <ModelMenu />
                <div className="relative">
                  <button className="fos-btn fos-btn-danger fos-btn-sm" disabled title="按量计费的后端重试，演示已禁用"
                    onMouseEnter={() => setBillingHelp(true)} onMouseLeave={() => setBillingHelp(false)}>
                    重试 <AppIcon name="info" className="h-3 w-3" /> 按量计费
                  </button>
                  {billingHelp ? (
                    <div className="fos-menu right-0 mt-1 w-56 p-3 text-[12px] leading-6 text-[var(--fos-text-2)]">按量计费：按实际生成的镜头数量从金币/积分扣费，失败不扣费。</div>
                  ) : null}
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-4 flex gap-5 text-[12px] font-bold text-[var(--fos-text-3)]">
          <span className="text-[#5bd08f]">● 已完成</span><span className="text-[#4f85ff]">● 进行中</span><span>● 等待中</span><span className="text-[#ff6767]">● 失败</span>
        </div>
        <div className="mt-8 text-center text-[13px] text-[var(--fos-text-4)]">可切换其他已完成的集预览；本集生成完毕将自动刷新。</div>
      </section>
    </div>
  )
}
