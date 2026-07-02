'use client'

import { useState } from 'react'
import { AppIcon } from '@/components/ui/icons'
import type { TargetScriptEpisode } from './types'

export function TargetScriptReview({ episodes }: { episodes: TargetScriptEpisode[] }) {
  const [selectedId, setSelectedId] = useState(episodes[0]?.id ?? null)
  const selected = episodes.find((episode) => episode.id === selectedId) ?? episodes[0]

  return (
    <div className="grid min-h-[620px] gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
      <aside className="rounded-[12px] border border-[var(--fos-border-soft)] bg-[var(--fos-bg-2)]">
        <div className="border-b border-[var(--fos-border-soft)] px-4 py-4 text-[15px] font-bold text-white">目标剧本</div>
        <div className="space-y-2 p-3">
          {episodes.map((episode) => (
            <button
              key={episode.id}
              type="button"
              onClick={() => setSelectedId(episode.id)}
              className="w-full rounded-[8px] px-3 py-3 text-left"
              style={{ background: episode.id === selected?.id ? 'rgba(59,110,242,.15)' : 'transparent' }}
            >
              <div className="text-[13px] font-bold text-white">EP{String(episode.episodeNumber).padStart(2, '0')} · {episode.title}</div>
              <div className="mt-1 text-[12px] text-[var(--fos-text-4)]">{episode.wordCount} 字 · 已完成</div>
            </button>
          ))}
        </div>
      </aside>
      <main className="rounded-[12px] border border-[var(--fos-border-soft)] bg-[var(--fos-bg-2)]">
        <div className="flex items-center justify-between border-b border-[var(--fos-border-soft)] px-5 py-4">
          <div>
            <div className="text-[15px] font-bold text-white">{selected?.title ?? '目标剧本'}</div>
            <div className="mt-1 text-[12px] text-[var(--fos-text-4)]">源剧本对照 / 目标设定引用 / 对齐片段引用</div>
          </div>
          <div className="flex gap-2">
            <button type="button" className="fos-btn">
              <AppIcon name="refresh" className="h-4 w-4" />
              重新生成单集
            </button>
            <button type="button" className="fos-btn fos-btn-primary">保存编辑</button>
            <button type="button" className="fos-btn">进入后续分镜</button>
          </div>
        </div>
        <div className="p-5">
          <textarea
            className="fos-textarea w-full font-mono"
            style={{ minHeight: 460 }}
            defaultValue={selected?.content ?? ''}
          />
        </div>
      </main>
    </div>
  )
}
