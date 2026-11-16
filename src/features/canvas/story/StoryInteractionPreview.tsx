'use client'

import type { ReactNode } from 'react'
import { useStore } from '@xyflow/react'
import { MediaImage } from '@/components/media/MediaImage'
import { Film } from '@/components/ui/icons'
import { resolveNodeMedia } from '@/lib/interactive/compile'
import { STORY_FLOW_ROLE, STORY_MOUNT_ROLE, type StoryInteractionSpec, type StoryMedia } from '@/lib/interactive/types'
import { toDisplayImageUrl, toVideoPosterUrl } from '@/lib/media/image-url'
import { notifyStoryCanvas } from './StoryCanvasContext'
import { beatTrackFractions, formatBeatSecond } from './story-beat-timeline'

const SWIPE_ARROW = { up: '↑', down: '↓', left: '←', right: '→' } as const

/** 海报一律走 480 宽缩略；预览里绝不放 <video>。 */
export function storyPicturePoster(media: StoryMedia): string | null {
  if (media.kind === 'video') return toVideoPosterUrl(media.url, 480) ?? toDisplayImageUrl(media.posterUrl)
  return toDisplayImageUrl(media.url)
}

export type StoryPictureSource = { edgeId: string; media: StoryMedia; title: string }

/** 这条卡自己的画面线（非剧情、非挂载入线），视频优先，与 compile 的取舍一致。 */
export function useStoryPictureSource(id: string): StoryPictureSource | null {
  const key = useStore((state) => {
    const candidates = state.edges
      .filter((edge) => edge.target === id && edge.data?.role !== STORY_FLOW_ROLE && edge.data?.role !== STORY_MOUNT_ROLE)
      .flatMap((edge) => {
        const source = state.nodeLookup.get(edge.source)
        if (!source) return []
        const media = resolveNodeMedia(
          id,
          {},
          [{ id: source.id, type: source.type ?? '', data: source.data }],
          [{ id: edge.id, source: edge.source, target: id, sourceHandle: edge.sourceHandle, role: typeof edge.data?.role === 'string' ? edge.data.role : null }],
          { sceneFields: false },
        )
        if (!media) return []
        const title = typeof source.data?.title === 'string' ? source.data.title.trim() : ''
        return [{ edgeId: edge.id, media, title }]
      })
    const picked = candidates.find((item) => item.media.kind === 'video') ?? candidates[0]
    return picked ? JSON.stringify(picked) : ''
  })
  return key ? JSON.parse(key) as StoryPictureSource : null
}

/** 「接已有节点」：toast 指路 + 画面口一次 1.5s 的脉冲高亮。 */
export function hintStoryPicturePort(nodeId: string) {
  notifyStoryCanvas('从这张卡顶部的「画面」口拖出一条线，接到视频或图片节点')
  const handle = document.querySelector(`.react-flow__node[data-id="${CSS.escape(nodeId)}"] .nori-story-handle.is-media`)
  if (!handle) return
  handle.classList.add('is-hinting')
  window.setTimeout(() => handle.classList.remove('is-hinting'), 1500)
}

export function StoryPictureCaption({ picture, readOnly, removeLabel, onRemove }: {
  picture: StoryPictureSource
  readOnly: boolean
  removeLabel: string
  onRemove: (edgeId: string, label: string) => void
}) {
  const { media, title } = picture
  return (
    <div className="nori-story-picture-row">
      <span className="nori-story-note">
        {media.kind === 'video' ? '视频画面' : '图片画面'} · 《{title || (media.kind === 'video' ? '视频' : '图片')}》
        {media.kind === 'video' && media.durationSec ? ` · ${formatBeatSecond(media.durationSec)} 秒` : ''}
      </span>
      <button type="button" className="nori-story-chip nodrag" disabled={readOnly} onClick={() => notifyStoryCanvas('从画面口拖出一条线接到新的视频或图片')}>更换</button>
      <button type="button" className="nori-story-chip nodrag" disabled={readOnly} onClick={() => onRemove(picture.edgeId, removeLabel)}>移除</button>
    </div>
  )
}

export function StoryPictureEmptyActions({ readOnly, onCreate, onHint }: { readOnly: boolean; onCreate: () => void; onHint: () => void }) {
  return (
    <div className="nori-story-picture-actions">
      <button type="button" className="nori-story-chip nodrag" disabled={readOnly} onClick={onCreate}>新建画面</button>
      <button type="button" className="nori-story-chip nodrag" disabled={readOnly} onClick={onHint}>接已有节点</button>
    </div>
  )
}

/** 卡片上的画面预览：海报 + 纯 CSS 玩法示意 + 限时角标；挂载时底部多一条互动窗口时间轴。 */
export function StoryInteractionPreview({ spec, orientation, posterUrl, mounted, startSec, durationSec, videoSec, title, emptyNote }: {
  spec: StoryInteractionSpec
  orientation: 'portrait' | 'landscape'
  posterUrl: string | null
  mounted: boolean
  startSec: number
  durationSec: number
  videoSec: number | null
  title: string
  emptyNote?: ReactNode
}) {
  const window = mounted ? beatTrackFractions(startSec, durationSec, videoSec) : null
  return (
    <div
      className={`nori-story-preview${posterUrl ? '' : ' is-empty'}`}
      style={{ aspectRatio: orientation === 'landscape' ? '16 / 9' : '9 / 16' }}
      data-testid="interaction-preview"
      aria-label={`${title}画面预览`}
    >
      {posterUrl ? <MediaImage src={posterUrl} alt="" fill sizes="260px" draggable={false} /> : (
        <div className="nori-story-preview-empty">
          <Film />
          {emptyNote}
        </div>
      )}
      <div className="nori-story-preview-overlay" aria-hidden="true">
        {spec.type === 'tap' ? <span className="nori-story-preview-tap">{spec.count} 次</span> : null}
        {spec.type === 'swipe' ? <span className="nori-story-preview-swipe">{SWIPE_ARROW[spec.direction]}</span> : null}
        {spec.type === 'timing' ? (
          <span className="nori-story-preview-timing">
            <span className="nori-story-preview-timing-zone" style={{ width: `${spec.perfectWidth}%` }} />
            <span className="nori-story-preview-timing-pointer" />
          </span>
        ) : null}
        {spec.type === 'hold' ? <span className="nori-story-preview-hold">蓄力</span> : null}
        {spec.type === 'hotspot' ? <span className="nori-story-preview-hotspot"><span /><span /><span /></span> : null}
        {spec.type === 'choice' ? (
          <span className="nori-story-preview-choice">
            {spec.options.slice(0, 3).map((option) => <span key={option.id}>{option.label.trim().slice(0, 6) || '选项'}</span>)}
          </span>
        ) : null}
      </div>
      {durationSec > 0 ? <span className="nori-story-preview-badge">限时 {formatBeatSecond(durationSec)}s</span> : null}
      {mounted ? (
        <span className="nori-story-preview-track" aria-hidden="true">
          {window && window.width > 0 ? <span className="nori-story-preview-window" style={{ left: `${window.left * 100}%`, width: `${window.width * 100}%` }} /> : null}
        </span>
      ) : null}
    </div>
  )
}
