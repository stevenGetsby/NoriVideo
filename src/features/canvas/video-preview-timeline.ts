import type { CanvasVideoKeyframe } from './types'

export const PREVIEW_FPS = 30
const COMMON_FPS = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60, 120]
const MAX_KEYFRAMES = 200

export function safePreviewFps(fps: unknown) {
  const value = Number(fps)
  return Number.isFinite(value) && value >= 1 && value <= 240 ? value : PREVIEW_FPS
}

function safeTime(time: number) {
  return Number.isFinite(time) && time > 0 ? time : 0
}

export function previewFrameIndex(time: number, fps = PREVIEW_FPS) {
  return Math.floor(safeTime(time) * safePreviewFps(fps) + 1e-6)
}

export function previewFrameCount(duration: number, fps = PREVIEW_FPS) {
  return Math.max(0, Math.round(safeTime(duration) * safePreviewFps(fps)))
}

export function previewFrameStart(frame: number, fps = PREVIEW_FPS) {
  return Math.round(Math.max(0, frame) / safePreviewFps(fps) * 10000) / 10000
}

// Seeking exactly onto a frame boundary can land on the previous frame after timebase rounding.
export function previewSeekTime(time: number, fps = PREVIEW_FPS) {
  return previewFrameStart(previewFrameIndex(time + 1e-4, fps), fps) + Math.min(0.001, 0.2 / safePreviewFps(fps))
}

export function previewLastFrameTime(duration: number, fps = PREVIEW_FPS) {
  return previewFrameStart(Math.max(0, previewFrameCount(duration, fps) - 1), fps)
}

export function previewTimecode(time: number, fps = PREVIEW_FPS) {
  const rate = safePreviewFps(fps)
  const value = safeTime(time)
  const seconds = Math.floor(value + 1e-6)
  const frame = Math.min(Math.round(rate) - 1, Math.max(0, Math.floor((value - seconds) * rate + 1e-6)))
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}:${pad(frame)}`
}

export function previewClock(time: number) {
  const seconds = Math.floor(safeTime(time) + 1e-6)
  const pad = (part: number) => String(part).padStart(2, '0')
  const clock = `${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}`
  return seconds >= 3600 ? `${pad(Math.floor(seconds / 3600))}:${clock}` : clock
}

export function adjacentPreviewKeyframe(time: number, keyframes: number[], duration: number, direction: -1 | 1, fps = PREVIEW_FPS) {
  const current = previewFrameIndex(time, fps)
  const frames = keyframes.map((mark) => Math.round(mark * safePreviewFps(fps))).sort((a, b) => a - b)
  if (direction < 0) return previewFrameStart([...frames].reverse().find((frame) => frame < current) ?? 0, fps)
  const last = Math.max(0, previewFrameCount(duration, fps) - 1)
  return previewFrameStart(Math.min(last, frames.find((frame) => frame > current) ?? last), fps)
}

const MINOR_DIVISIONS: Record<number, number> = { 1: 5, 2: 4, 5: 5, 10: 5, 15: 3, 30: 6, 60: 6, 120: 4, 300: 5, 600: 6, 1800: 6 }

export type PreviewRulerTick = { time: number; major: boolean; label?: string }

export function previewRulerTicks(duration: number, pxPerSecond: number, fps = PREVIEW_FPS): PreviewRulerTick[] {
  if (!(duration > 0) || !(pxPerSecond > 0)) return []
  const base = Math.round(safePreviewFps(fps))
  // Only steps that divide the frame rate keep every whole second on a labelled tick.
  const frameSteps = [1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 30].filter((frames) => frames < base && base % frames === 0).map((frames) => frames / base)
  const candidates = [...frameSteps, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800]
  const major = candidates.find((step) => step * pxPerSecond >= 72) ?? candidates[candidates.length - 1]
  let divisions = major < 1 ? Math.min(5, Math.max(1, Math.round(major * base))) : MINOR_DIVISIONS[major] || 5
  if (major / divisions * pxPerSecond < 7) divisions = 1
  const minor = major / divisions
  const count = Math.floor(duration / minor + 1e-6)
  const stride = count > 4000 ? divisions : 1
  const ticks: PreviewRulerTick[] = []
  for (let index = 0; index <= count; index += stride) {
    const time = index * minor
    ticks.push(index % divisions === 0 ? { time, major: true, label: previewRulerLabel(time, base) } : { time, major: false })
  }
  return ticks
}

function previewRulerLabel(time: number, fps: number) {
  const whole = Math.floor(time + 1e-6)
  const frame = Math.round((time - whole) * fps)
  return frame === 0 || frame === fps ? previewClock(Math.round(time)) : `${frame}f`
}

export type PreviewFilmTile = { left: number; width: number; time: number }

export function previewFilmstripTiles(duration: number, trackWidth: number, tileWidth: number): PreviewFilmTile[] {
  if (!(duration > 0) || !(trackWidth > 0) || !(tileWidth > 0)) return []
  const size = Math.max(tileWidth, trackWidth / 2000)
  const count = Math.ceil(trackWidth / size - 1e-6)
  return Array.from({ length: count }, (_, index) => {
    const left = index * size
    const width = Math.min(size, trackWidth - left)
    return { left, width, time: Math.min(duration, (left + width / 2) / trackWidth * duration) }
  })
}

export function snapPreviewTime(time: number, targets: number[], tolerance: number) {
  let best = time
  let distance = tolerance
  for (const target of targets) {
    const gap = Math.abs(target - time)
    if (gap <= distance) {
      best = target
      distance = gap
    }
  }
  return best
}

export function previewMaxZoom(duration: number, width: number, fps = PREVIEW_FPS) {
  if (!(duration > 0) || !(width > 0)) return 4
  return Math.max(4, Math.min(400, duration * safePreviewFps(fps) * 18 / width))
}

export function previewZoomFromSlider(position: number, maxZoom: number) {
  return Math.pow(Math.max(1, maxZoom), Math.max(0, Math.min(100, position)) / 100)
}

export function previewSliderFromZoom(zoom: number, maxZoom: number) {
  return maxZoom <= 1 ? 0 : Math.max(0, Math.min(100, Math.log(Math.max(1, zoom)) / Math.log(maxZoom) * 100))
}

export function previewAudioPeaks(buffer: AudioBuffer, count: number) {
  if (count <= 0) return []
  const channel = buffer.getChannelData(0)
  const bucket = Math.max(1, Math.floor(channel.length / count))
  const stride = Math.max(1, Math.floor(bucket / 120))
  return Array.from({ length: count }, (_, index) => {
    let peak = 0
    const start = index * bucket
    const end = Math.min(channel.length, start + bucket)
    for (let cursor = start; cursor < end; cursor += stride) peak = Math.max(peak, Math.abs(channel[cursor] || 0))
    return Math.max(0.08, Math.min(1, peak * 1.7))
  })
}

export function previewAudioIsSilent(peaks: number[]) {
  return peaks.every((peak) => peak <= 0.081)
}

export function snapPreviewFps(deltas: number[]) {
  const usable = deltas.filter((delta) => Number.isFinite(delta) && delta > 0.003 && delta < 0.2).sort((a, b) => a - b)
  if (usable.length < 4) return null
  const lower = usable.slice(0, Math.max(2, Math.ceil(usable.length / 2)))
  const raw = 1 / lower[Math.floor(lower.length / 2)]
  const common = COMMON_FPS.reduce((best, value) => Math.abs(value - raw) < Math.abs(best - raw) ? value : best)
  return Math.abs(common - raw) / common <= 0.04 ? common : Math.round(raw * 100) / 100
}

// Mixes mean luma change with a 16-bin histogram distance so camera motion inside a shot scores
// lower than a hard cut between two different shots.
export function previewFrameDifference(a: ArrayLike<number>, b: ArrayLike<number>) {
  const length = Math.min(a.length, b.length) - (Math.min(a.length, b.length) % 4)
  if (length <= 0) return 0
  const pixels = length / 4
  const left = new Array<number>(16).fill(0)
  const right = new Array<number>(16).fill(0)
  let change = 0
  for (let index = 0; index < length; index += 4) {
    const lumaA = a[index] * 0.299 + a[index + 1] * 0.587 + a[index + 2] * 0.114
    const lumaB = b[index] * 0.299 + b[index + 1] * 0.587 + b[index + 2] * 0.114
    change += Math.abs(lumaA - lumaB)
    left[Math.min(15, Math.floor(lumaA / 16))]++
    right[Math.min(15, Math.floor(lumaB / 16))]++
  }
  const histogram = left.reduce((sum, value, index) => sum + Math.abs(value - right[index]), 0) / (2 * pixels)
  return Math.min(1, change / pixels / 255 * 0.5 + histogram * 0.5)
}

export function detectPreviewShotBoundaries(samples: Array<{ time: number; difference: number }>, minGap = 0.6) {
  if (samples.length < 2) return []
  const values = samples.map((sample) => sample.difference).sort((a, b) => a - b)
  const median = values[Math.floor(values.length / 2)]
  const deviations = values.map((value) => Math.abs(value - median)).sort((a, b) => a - b)
  const spread = deviations[Math.floor(deviations.length / 2)] * 1.4826
  const threshold = Math.max(0.14, median + spread * 6, median * 2.5)
  const candidates = samples.filter((sample, index) => sample.difference >= threshold
    && sample.difference >= (samples[index - 1]?.difference ?? 0)
    && sample.difference >= (samples[index + 1]?.difference ?? 0))
  const accepted: number[] = []
  for (const candidate of [...candidates].sort((a, b) => b.difference - a.difference)) {
    if (accepted.every((time) => Math.abs(time - candidate.time) >= minGap)) accepted.push(candidate.time)
  }
  return accepted.sort((a, b) => a - b)
}

export function normalizePreviewKeyframes(value: unknown): CanvasVideoKeyframe[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<number>()
  const result: CanvasVideoKeyframe[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const entry = item as Partial<CanvasVideoKeyframe>
    const time = Number(entry.time)
    if (!Number.isFinite(time) || time < 0) continue
    const key = Math.round(time * 1000)
    if (seen.has(key)) continue
    seen.add(key)
    result.push({ id: typeof entry.id === 'string' && entry.id ? entry.id : `kf-${key}`, time: Math.round(time * 10000) / 10000, kind: entry.kind === 'shot' ? 'shot' : 'manual' })
  }
  return result.sort((a, b) => a.time - b.time).slice(0, MAX_KEYFRAMES)
}

export function mergePreviewKeyframes(current: CanvasVideoKeyframe[], times: number[], kind: CanvasVideoKeyframe['kind'], fps = PREVIEW_FPS, createId: () => string = () => crypto.randomUUID()) {
  const frames = new Set(current.map((keyframe) => previewFrameIndex(keyframe.time + 1e-4, fps)))
  const added: CanvasVideoKeyframe[] = []
  for (const time of times) {
    const frame = previewFrameIndex(time + 1e-4, fps)
    if (frames.has(frame)) continue
    frames.add(frame)
    added.push({ id: createId(), time: previewFrameStart(frame, fps), kind })
  }
  return { keyframes: normalizePreviewKeyframes([...current, ...added]), added: added.length }
}
