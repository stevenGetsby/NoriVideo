'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { MediaImage } from '@/components/media/MediaImage'
import { ArrowRight, Clapperboard, RotateCcw, X } from '@/components/ui/icons'
import type { ResolvedSequenceSegment } from '@/lib/interactive/sequence'
import type { StoryAspectRatio } from '@/lib/interactive/types'
import { toDisplayImageUrl } from '@/lib/media/image-url'

const display = (url: string | null | undefined) => (url ? toDisplayImageUrl(url) || url : null)
const IMAGE_HOLD_MS = 3_200

/**
 * Plays the linear cut in order from already-generated media. It never stitches
 * files, starts renders or exports anything, so previewing stays free.
 */
export function SequencePreview({ items, title, aspectRatio, onClose }: {
  items: ResolvedSequenceSegment[]
  title: string
  aspectRatio: StoryAspectRatio
  onClose: () => void
}) {
  const [index, setIndex] = useState(0)
  const current = items[Math.min(index, Math.max(0, items.length - 1))]
  const finished = index >= items.length
  const orientation = aspectRatio === '9:16' ? 'portrait' : 'landscape'
  const next = useCallback(() => setIndex((value) => Math.min(value + 1, items.length)), [items.length])
  const restart = useCallback(() => setIndex(0), [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    if (finished || current?.media?.kind !== 'image') return
    const timer = window.setTimeout(next, IMAGE_HOLD_MS)
    return () => window.clearTimeout(timer)
  }, [current, finished, next])

  const media = current?.media ?? null
  const poster = useMemo(() => display(media?.posterUrl ?? (media?.kind === 'image' ? media.url : null)), [media])

  return createPortal(
    <div
      className="nori-player nori-seq-preview"
      role="dialog"
      aria-modal="true"
      aria-label={`线性成片预览：${title}`}
      data-testid="sequence-preview"
      onKeyDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <header className="nori-player-head">
        <div>
          <span className="nori-player-mode">线性成片预览</span>
          <strong>{title}</strong>
          <span className="nori-player-format">仅按顺序播放现有素材 · 不拼接、不导出</span>
        </div>
        <div>
          <button type="button" onClick={restart}><RotateCcw />重新预览</button>
          <button type="button" className="is-icon" aria-label="关闭预览" onClick={onClose}><X /></button>
        </div>
      </header>
      <div className="nori-player-body">
        <div className="nori-player-stage-wrap">
          <div className={`nori-player-stage is-${orientation}`} data-testid="sequence-preview-stage">
            {finished ? (
              <div className="nori-player-card">
                <Clapperboard />
                <strong>预览结束</strong>
                <p>共 {items.length} 段线性片段。分支片段未加入成片。</p>
                <button type="button" onClick={restart}><RotateCcw />再看一遍</button>
              </div>
            ) : media?.kind === 'video' ? (
              <video
                key={`${current?.segment.id}:${media.url}`}
                className="nori-player-media"
                src={display(media.url) ?? undefined}
                poster={poster ?? undefined}
                autoPlay
                controls
                playsInline
                onEnded={next}
                data-testid="sequence-preview-video"
              />
            ) : media?.kind === 'image' ? (
              <div className="nori-player-media">
                <MediaImage src={display(media.url) || ''} alt="" fill sizes="80vw" draggable={false} />
              </div>
            ) : (
              <div className="nori-player-placeholder">
                <strong>{current?.segment.title || '未命名作品片段'}</strong>
                <span>这一段还没有生成视频或图片素材，可在制作画布中补充。</span>
              </div>
            )}
            {!finished && current ? (
              <div className="nori-seq-caption">
                <span>{String(index + 1).padStart(2, '0')} / {String(items.length).padStart(2, '0')}</span>
                <div><strong>{current.segment.title || '未命名作品片段'}</strong><small>{current.chapterName || '章节已删除'}</small></div>
                <button type="button" onClick={next}>{media ? '下一段' : '跳过'}<ArrowRight /></button>
              </div>
            ) : null}
          </div>
        </div>
        <aside className="nori-player-side nori-seq-side">
          <section>
            <h3>线性片段</h3>
            <ol className="nori-seq-list">
              {items.map((item, itemIndex) => (
                <li key={item.segment.id}>
                  <button
                    type="button"
                    className={itemIndex === index ? 'is-on' : ''}
                    aria-label={`播放第 ${itemIndex + 1} 段 ${item.segment.title || '未命名作品片段'}`}
                    onClick={() => setIndex(itemIndex)}
                  >
                    <span>{String(itemIndex + 1).padStart(2, '0')}</span>
                    <strong>{item.segment.title || '未命名作品片段'}</strong>
                    <em>{item.media ? (item.media.kind === 'video' ? '视频' : '图片') : '待生成'}</em>
                  </button>
                </li>
              ))}
            </ol>
          </section>
          <p className="nori-seq-note">分支片段只在剧情试玩中出现，不会混入线性成片。</p>
        </aside>
      </div>
    </div>,
    document.body,
  )
}
