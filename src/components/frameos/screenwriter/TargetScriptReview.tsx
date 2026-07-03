'use client'

import { useEffect, useState } from 'react'
import { AppIcon } from '@/components/ui/icons'
import type { TargetScriptEpisode } from './types'

export function TargetScriptReview({
  episodes,
  onSaveEpisode,
}: {
  episodes: TargetScriptEpisode[]
  onSaveEpisode?: (episode: TargetScriptEpisode, content: string) => Promise<void> | void
}) {
  const [selectedId, setSelectedId] = useState<string | null>(episodes[0]?.id ?? null)
  const selected = episodes.find((episode) => episode.id === selectedId) ?? episodes[0]
  const [draft, setDraft] = useState(selected?.content ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!episodes.length) {
      setSelectedId(null)
      setDraft('')
      return
    }
    const nextSelected = episodes.find((episode) => episode.id === selectedId) ?? episodes[0]
    if (nextSelected.id !== selectedId) {
      setSelectedId(nextSelected.id)
      setDraft(nextSelected.content)
    }
  }, [episodes, selectedId])

  function selectEpisode(episode: TargetScriptEpisode) {
    setSelectedId(episode.id)
    setDraft(episode.content)
    setError(null)
  }

  async function saveSelected() {
    if (!selected || !onSaveEpisode || saving) return
    setSaving(true)
    setError(null)
    try {
      await onSaveEpisode(selected, draft)
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存目标剧本失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="grid min-h-[620px] gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
      <aside className="rounded-[12px] border border-[var(--fos-border-soft)] bg-[var(--fos-bg-2)]">
        <div className="border-b border-[var(--fos-border-soft)] px-4 py-4 text-[15px] font-bold text-white">目标剧本</div>
        <div className="space-y-2 p-3">
          {episodes.map((episode) => (
            <button
              key={episode.id}
              type="button"
              onClick={() => selectEpisode(episode)}
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
            <button type="button" className="fos-btn fos-btn-primary" onClick={saveSelected} disabled={saving}>
              {saving ? '保存中' : '保存编辑'}
            </button>
            <button type="button" className="fos-btn">进入后续分镜</button>
          </div>
        </div>
        <div className="p-5">
          {error ? <div className="mb-3 text-[12px] text-[#ef4444]">{error}</div> : null}
          <textarea
            className="fos-textarea w-full font-mono"
            style={{ minHeight: 460 }}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
        </div>
      </main>
    </div>
  )
}
