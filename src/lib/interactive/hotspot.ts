import type { StoryHotspotZone } from './types'

export interface MediaContainBox { left: number; top: number; width: number; height: number }

/** The rendered rectangle of object-fit: contain, including any letterbox offsets. */
export function mediaContainBox(containerWidth: number, containerHeight: number, mediaWidth: number, mediaHeight: number): MediaContainBox | null {
  if (containerWidth <= 0 || containerHeight <= 0 || mediaWidth <= 0 || mediaHeight <= 0) return null
  const scale = Math.min(containerWidth / mediaWidth, containerHeight / mediaHeight)
  const width = mediaWidth * scale
  const height = mediaHeight * scale
  return { left: (containerWidth - width) / 2, top: (containerHeight - height) / 2, width, height }
}

/** Later zones are on top. Coordinates are local to the unrotated media element. */
export function hotspotAt(zones: readonly StoryHotspotZone[], box: MediaContainBox | null, x: number, y: number): string | null {
  if (!box || x < box.left || y < box.top || x > box.left + box.width || y > box.top + box.height) return null
  const nx = (x - box.left) / box.width
  const ny = (y - box.top) / box.height
  return [...zones].reverse().find((zone) => nx >= zone.x && ny >= zone.y && nx <= zone.x + zone.w && ny <= zone.y + zone.h)?.id ?? null
}

/** Translates a pointer in a clockwise-rotated stage back to the media's own coordinate system. */
export function unrotateHotspotPoint(x: number, y: number, stageWidth: number, stageHeight: number, turn: 0 | 1 | 2 | 3): { x: number; y: number } {
  if (turn === 1) return { x: y, y: stageWidth - x }
  if (turn === 2) return { x: stageWidth - x, y: stageHeight - y }
  if (turn === 3) return { x: stageHeight - y, y: x }
  return { x, y }
}

export type HotspotDragHandle = 'move' | 'nw' | 'ne' | 'sw' | 'se'

/** A pointer delta in normalized preview coordinates, clamped to a visible rectangle. */
export function dragHotspotZone(zone: StoryHotspotZone, dx: number, dy: number, handle: HotspotDragHandle): StoryHotspotZone {
  const clamp = (value: number) => Math.max(0, Math.min(1, value))
  if (handle === 'move') return { ...zone, x: clamp(Math.min(1 - zone.w, zone.x + dx)), y: clamp(Math.min(1 - zone.h, zone.y + dy)) }
  const left = handle === 'nw' || handle === 'sw' ? clamp(Math.min(zone.x + zone.w - 0.02, zone.x + dx)) : zone.x
  const top = handle === 'nw' || handle === 'ne' ? clamp(Math.min(zone.y + zone.h - 0.02, zone.y + dy)) : zone.y
  const right = handle === 'ne' || handle === 'se' ? clamp(Math.max(zone.x + 0.02, zone.x + zone.w + dx)) : zone.x + zone.w
  const bottom = handle === 'sw' || handle === 'se' ? clamp(Math.max(zone.y + 0.02, zone.y + zone.h + dy)) : zone.y + zone.h
  const round = (value: number) => Math.round(value * 1000000) / 1000000
  return { ...zone, x: round(left), y: round(top), w: round(right - left), h: round(bottom - top) }
}

export const hotspotZonesOverlap = (a: StoryHotspotZone, b: StoryHotspotZone) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
