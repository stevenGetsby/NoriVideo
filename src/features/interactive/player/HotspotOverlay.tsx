'use client'

import { useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type SyntheticEvent } from 'react'
import { hotspotAt, mediaContainBox, unrotateHotspotPoint } from '@/lib/interactive/hotspot'
import { interactionTimeoutHandle } from '@/lib/interactive/interaction'
import type { StoryInteractionNode } from '@/lib/interactive/types'
import { InteractionCountdown } from './InteractionCountdown'
import type { StageTurn } from './stage-orientation'

export function HotspotOverlay({ node, orientation, startedAt, durationSec = node.durationSec, turn = 0, className = '', onResult }: {
  node: StoryInteractionNode
  orientation: 'portrait' | 'landscape'
  startedAt: number
  durationSec?: number
  turn?: StageTurn
  className?: string
  onResult: (handle: string) => void
}) {
  if (node.spec.type !== 'hotspot') return null
  const spec = node.spec
  const layerRef = useRef<HTMLDivElement | null>(null)
  const doneRef = useRef(false)
  const [mediaSize, setMediaSize] = useState({ width: 0, height: 0 })
  const onMediaLoad = (event: SyntheticEvent<HTMLImageElement>) => setMediaSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })
  const onDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (doneRef.current) return
    event.preventDefault()
    const layer = layerRef.current
    if (!layer) return
    const rect = layer.getBoundingClientRect()
    const local = unrotateHotspotPoint(event.clientX - rect.left, event.clientY - rect.top, rect.width, rect.height, turn)
    const video = layer.parentElement?.querySelector('video')
    const mediaWidth = spec.frameImageUrl ? mediaSize.width : (video?.videoWidth || rect.width)
    const mediaHeight = spec.frameImageUrl ? mediaSize.height : (video?.videoHeight || rect.height)
    const stageWidth = turn === 1 ? rect.height : rect.width
    const stageHeight = turn === 1 ? rect.width : rect.height
    const handle = hotspotAt(spec.zones, mediaContainBox(stageWidth, stageHeight, mediaWidth, mediaHeight), local.x, local.y)
    if (!handle) return
    doneRef.current = true
    onResult(handle)
  }
  return (
    <div className={`nori-int-overlay is-hotspot is-${orientation} ${className}`} data-testid="interaction-overlay" data-kind="hotspot">
      <InteractionCountdown startedAt={startedAt} durationSec={durationSec} onTimeout={() => { if (!doneRef.current) { doneRef.current = true; onResult(interactionTimeoutHandle(spec)!) } }} />
      <div ref={layerRef} className={`nori-hotspot-layer${spec.showZones ? ' is-visible' : ''}`} data-testid="hotspot-layer" onPointerDown={onDown}>
        {spec.frameImageUrl ? <img className="nori-hotspot-frame" src={spec.frameImageUrl} alt="" onLoad={onMediaLoad} draggable={false} /> : null}
        <div className="nori-hotspot-zones" style={spec.frameImageUrl && mediaSize.width && mediaSize.height ? {
          left: `${mediaContainBox(100, 100, mediaSize.width, mediaSize.height)!.left}%`,
          top: `${mediaContainBox(100, 100, mediaSize.width, mediaSize.height)!.top}%`,
          width: `${mediaContainBox(100, 100, mediaSize.width, mediaSize.height)!.width}%`,
          height: `${mediaContainBox(100, 100, mediaSize.width, mediaSize.height)!.height}%`,
        } : undefined}>
          {spec.zones.map((zone) => <span key={zone.id} className="nori-hotspot-zone" style={{ left: `${zone.x * 100}%`, top: `${zone.y * 100}%`, width: `${zone.w * 100}%`, height: `${zone.h * 100}%` } as CSSProperties} aria-label={zone.label} />)}
        </div>
      </div>
    </div>
  )
}
