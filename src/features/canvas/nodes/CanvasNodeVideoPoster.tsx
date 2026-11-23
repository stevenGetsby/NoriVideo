import { useState } from 'react'
import { Clapperboard, Play } from '@/components/ui/icons'
import { CanvasPosterImage } from './CanvasPreviewImage'

export function CanvasNodeVideoPoster({ posterUrl, onPlay }: { posterUrl: string | null; onPlay: () => void }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const failed = !!posterUrl && failedUrl === posterUrl
  return (
    <div className="nori-canvas-video-poster nori-force-dark">
      {posterUrl && !failed ? <CanvasPosterImage src={posterUrl} alt="" loading="lazy" decoding="async" onError={() => setFailedUrl(posterUrl)} /> : <Clapperboard className="nori-canvas-video-poster-placeholder" />}
      <button type="button" className="nodrag nori-canvas-video-poster-play" aria-label="播放视频" data-testid="canvas-video-play" onClick={onPlay}>
        <Play />
      </button>
    </div>
  )
}
