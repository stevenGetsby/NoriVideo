'use client'

import { MediaImage } from '@/components/media/MediaImage'
import { toDisplayImageUrl } from '@/lib/media/image-url'

/**
 * The viewer's avatar: a generic face, with the equipped frame drawn around it when there is one.
 * The frame is a picture; the title text is rendered next to it by the caller.
 */
export function PlayerAvatar({ frameUrl, className }: { frameUrl?: string | null; className?: string }) {
  const frame = frameUrl ? toDisplayImageUrl(frameUrl) || frameUrl : null
  return (
    <span className={`nori-avatar${className ? ` ${className}` : ''}`} data-testid="player-avatar" data-frame-url={frameUrl ?? ''}>
      <span className="nori-avatar-face" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="8.4" r="3.6" />
          <path d="M4.6 20.4c.7-3.7 3.6-5.8 7.4-5.8s6.7 2.1 7.4 5.8" />
        </svg>
      </span>
      {frame ? <MediaImage src={frame} alt="" className="nori-avatar-frame" draggable={false} /> : null}
    </span>
  )
}
