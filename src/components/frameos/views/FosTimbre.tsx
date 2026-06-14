'use client'

import { useState } from 'react'
import { AppIcon } from '@/components/ui/icons'
import { demoCharacters } from '../fosDemoData'
import type { FosProjectData } from '../useFosProject'
import { AssetTabs, AssetPlaceholder } from './FosAssetShared'

type TimbreTab = 'seedance' | 'library' | 'local'

const AUDITION_PROMPT = '图片作为角色形象参考基准；镜头：正脸机位、中近景特写；声线表现：贴合人物本身声线特质；台词："放开我！我娘卖我不算数，就算死我也不伺候你！"；音量：音量适中；无BGM，无背景音，无音效，画面中无其他人；台词必须严格按照原文语言朗读。'

const CANDIDATES: Array<[string, string, string]> = [
  ['克制叙事女声 A', '相似度 87%', '年轻、克制、紧张台词稳定'],
  ['民国主角女声 B', '相似度 82%', '声线更柔，情绪起伏更明显'],
  ['低声独白女声 C', '相似度 79%', '适合旁白式内心独白'],
]

export function FosTimbre({ data }: { data: FosProjectData }) {
  const characters = data.usingDemo ? demoCharacters : data.characters
  const [activeId, setActiveId] = useState(characters[0]?.id ?? '')
  const [tab, setTab] = useState<TimbreTab>('seedance')
  const active = characters.find((c) => c.id === activeId) ?? characters[0]
  const total = characters.length

  return (
    <div className="grid min-h-0 flex-1" style={{ gridTemplateColumns: '280px 1fr 280px' }}>
      <aside className="flex min-h-0 flex-col border-r border-[var(--fos-border-soft)]">
        <div className="flex-none p-3">
          <AssetTabs projectId={data.projectId} active="timbre" />
          <div className="flex items-center justify-between">
            <h2 className="text-[14px] font-bold text-white">角色列表</h2>
            <span className="fos-pill" style={{ height: 22 }}>0/{total}</span>
          </div>
        </div>
        <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-3">
          {characters.map((c) => {
            const isActive = c.id === active?.id
            return (
              <button key={c.id} onClick={() => setActiveId(c.id)}
                className="w-full rounded-[10px] px-3 py-2.5 text-left"
                style={{ border: isActive ? '1px solid var(--fos-primary)' : '1px solid transparent', background: isActive ? 'var(--fos-primary-soft)' : 'transparent' }}>
                <div className="text-[13px] font-bold text-white">{c.name}</div>
                <div className="mt-0.5 text-[12px] text-[var(--fos-text-4)]">{c.type}</div>
              </button>
            )
          })}
        </div>
        <div className="flex-none border-t border-[var(--fos-border-soft)] p-3">
          <button className="fos-btn fos-btn-primary w-full" disabled title="一键试镜为后端/付费操作，演示已禁用">一键试镜</button>
        </div>
      </aside>

      <article className="min-h-0 overflow-y-auto p-6">
        <h2 className="text-[16px] font-bold text-white">{active?.name} · 音色设置</h2>
        <p className="mt-2 text-[13px] text-[var(--fos-text-2)]">如需为角色固定音色，可用以下三种方式进行设置；不设置音色也不影响后续使用角色生成视频。</p>

        <div className="mt-5 flex items-center gap-6 border-b border-[var(--fos-border-soft)]">
          {([['seedance', 'Seedance 试镜'], ['library', '音色库选择'], ['local', '本地上传']] as const).map(([key, label]) => (
            <button key={key} onClick={() => setTab(key)} className="relative h-10 text-[13px] font-bold"
              style={{ color: tab === key ? 'var(--fos-primary)' : 'var(--fos-text-2)' }}>
              {label}
              {tab === key ? <span className="absolute inset-x-0 -bottom-px h-0.5 bg-[var(--fos-primary)]" /> : null}
            </button>
          ))}
          <button className="ml-auto fos-btn fos-btn-ghost fos-btn-sm"><AppIcon name="info" className="h-3.5 w-3.5" />seedance 试镜说明</button>
        </div>

        {tab === 'seedance' ? (
          <section className="mt-5">
            <h3 className="mb-3 text-[14px] font-bold text-[var(--fos-text-2)]">从 SD2 视频中提取音色</h3>
            <div className="grid gap-5" style={{ gridTemplateColumns: '200px 1fr' }}>
              <div>
                <div className="mb-2 text-[13px] font-bold text-[var(--fos-text-3)]">角色设定图</div>
                <div className="overflow-hidden rounded-lg border border-[var(--fos-border-mid)]"><div className="aspect-[16/9]"><AssetPlaceholder kind="characters" /></div></div>
                <button className="fos-btn fos-btn-ghost fos-btn-sm mt-2">放大查看</button>
              </div>
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[13px] font-bold text-[var(--fos-text-3)]">试镜提示词</span>
                  <span className="text-[11px] text-[var(--fos-text-4)]">video 180 + audio 60</span>
                </div>
                <textarea className="fos-textarea" style={{ minHeight: 130 }} defaultValue={AUDITION_PROMPT} />
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <button className="fos-btn fos-btn-primary" disabled title="按量计费，余额不足，演示已禁用">
                    从 SD2 视频中提取音色 <span className="ml-2 text-[#ffd27a]">240</span> <span className="ml-1 text-[11px] text-[#ff9b9b]">余额不足</span>
                  </button>
                  <span className="text-[12px] text-[#ff7777]">当前可用金币为 -683，提交前需要充值或更换费用来源。</span>
                </div>
              </div>
            </div>
            <div className="mt-6 fos-card p-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-[14px] font-bold text-white">候选音色（3 个推荐）</h3>
                <button className="text-[12px] font-bold text-[#8fa9ff]">查看更多</button>
              </div>
              <div className="space-y-2.5">
                {CANDIDATES.map(([name, score, note]) => (
                  <div key={name} className="flex items-center justify-between gap-4 rounded-[10px] border border-[var(--fos-border-mid)] bg-[var(--fos-bg-1)] p-3">
                    <div><div className="text-[13px] font-bold text-white">{name}</div><div className="mt-0.5 text-[12px] text-[var(--fos-text-4)]">{score} · {note}</div></div>
                    <div className="flex gap-2"><button className="fos-btn fos-btn-ghost fos-btn-sm">试听</button><button className="fos-btn fos-btn-soft fos-btn-sm">选用</button></div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        ) : null}

        {tab === 'library' ? (
          <section className="mt-5 fos-card p-4 text-[13px] leading-7 text-[var(--fos-text-2)]">
            从平台音色库选择预置音色绑定到当前角色。可按性别、年龄、情绪筛选并试听。
          </section>
        ) : null}

        {tab === 'local' ? (
          <section className="mt-5">
            <div className="fos-dropzone" style={{ minHeight: 110 }}>
              <AppIcon name="upload" className="h-7 w-7" />
              <div className="text-[13px] font-semibold text-[var(--fos-text-2)]">导入参考音频</div>
              <div className="text-[11px]">支持 mp3 / wav，建议 10s 以上清晰人声</div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <button className="fos-btn fos-btn-ghost">试听音色</button>
              <button className="fos-btn fos-btn-ghost">使用该音色</button>
            </div>
          </section>
        ) : null}
      </article>

      <aside className="min-h-0 overflow-y-auto border-l border-[var(--fos-border-soft)] p-5">
        <h3 className="mb-3 text-[14px] font-bold text-white">角色画像</h3>
        <div className="overflow-hidden rounded-lg border border-[var(--fos-border-mid)]"><div className="aspect-[16/9]"><AssetPlaceholder kind="characters" /></div></div>
        <h3 className="mb-2 mt-5 text-[14px] font-bold text-white">角色信息</h3>
        <div className="text-[12px] font-bold text-[var(--fos-text-4)]">角色类型</div>
        <div className="mb-3 text-[13px] font-bold text-white">{active?.type}</div>
        <div className="text-[12px] font-bold text-[var(--fos-text-4)]">角色背景</div>
        <p className="mt-1 text-[13px] leading-7 text-[var(--fos-text-2)]">{active?.description ?? '暂无背景描述。'}</p>
      </aside>
    </div>
  )
}
