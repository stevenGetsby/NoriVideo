import { hotspotAt, mediaContainBox, type StoryHotspotZone } from '../../runtime/story-runtime'

/**
 * 舞台坐标 → 热区 handle。舞台 rect 由 wx.createSelectorQuery 量出，宽高取 manifest，
 * 经 mediaContainBox 算 letterbox/pillarbox 偏移后交给 hotspotAt（与 Web HotspotOverlay 同式）。
 */
export function hotspotHandleAt(
  zones: readonly StoryHotspotZone[],
  stageW: number,
  stageH: number,
  mediaW: number,
  mediaH: number,
  x: number,
  y: number,
): string | null {
  return hotspotAt(zones, mediaContainBox(stageW, stageH, mediaW, mediaH), x, y)
}