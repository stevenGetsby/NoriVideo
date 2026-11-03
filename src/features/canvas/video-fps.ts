import { snapPreviewFps } from './video-preview-timeline'

const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl'])
const HEAD_BYTES = 256 * 1024
const MAX_MOOV_BYTES = 16 * 1024 * 1024

type Box = { type: string; start: number; header: number; size: number }

function readBox(view: DataView, offset: number, limit: number): Box | null {
  if (offset + 8 > limit) return null
  let size = view.getUint32(offset)
  const type = String.fromCharCode(view.getUint8(offset + 4), view.getUint8(offset + 5), view.getUint8(offset + 6), view.getUint8(offset + 7))
  let header = 8
  if (size === 1) {
    if (offset + 16 > limit) return null
    size = Number(view.getBigUint64(offset + 8))
    header = 16
  } else if (size === 0) size = limit - offset
  return size >= header ? { type, start: offset, header, size } : null
}

function children(view: DataView, start: number, end: number) {
  const boxes: Box[] = []
  for (let offset = start; offset < end;) {
    const box = readBox(view, offset, end)
    if (!box) break
    boxes.push(box)
    offset += box.size
  }
  return boxes
}

function videoTrackRate(view: DataView, trak: Box) {
  let handler = ''
  let timescale = 0
  let delta = 0
  const visit = (box: Box) => {
    const body = box.start + box.header
    const end = Math.min(view.byteLength, box.start + box.size)
    if (CONTAINERS.has(box.type)) children(view, body, end).forEach(visit)
    else if (box.type === 'hdlr' && body + 12 <= end) handler = String.fromCharCode(...new Uint8Array(view.buffer, view.byteOffset + body + 8, 4))
    else if (box.type === 'mdhd' && body + 24 <= end) timescale = view.getUint8(body) === 1 ? view.getUint32(body + 20) : view.getUint32(body + 12)
    else if (box.type === 'stts' && body + 8 <= end) {
      const count = view.getUint32(body + 4)
      let most = 0
      for (let index = 0; index < count && body + 16 + index * 8 <= end; index += 1) {
        const samples = view.getUint32(body + 8 + index * 8)
        if (samples > most) { most = samples; delta = view.getUint32(body + 12 + index * 8) }
      }
    }
  }
  visit(trak)
  return handler === 'vide' && timescale > 0 && delta > 0 ? timescale / delta : null
}

/** Reads the dominant sample duration of the first video track from an MP4/MOV `moov` box. */
export function parseMp4FrameRate(moov: Uint8Array) {
  const view = new DataView(moov.buffer, moov.byteOffset, moov.byteLength)
  const root = readBox(view, 0, moov.byteLength)
  if (!root || root.type !== 'moov') return null
  for (const trak of children(view, root.header, Math.min(moov.byteLength, root.size)).filter((box) => box.type === 'trak')) {
    const rate = videoTrackRate(view, trak)
    if (rate && rate >= 1 && rate <= 240) return snapPreviewFps(Array(8).fill(1 / rate)) ?? Math.round(rate * 1000) / 1000
  }
  return null
}

async function fetchBytes(src: string, start: number, length: number, signal: AbortSignal) {
  const response = await fetch(src, { headers: { Range: `bytes=${start}-${start + length - 1}` }, signal })
  if (!response.ok || !response.body) throw new Error('range unavailable')
  // A server that ignores Range streams the whole file from byte 0; stop once the window is read.
  const skip = response.status === 206 ? 0 : start
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let received = 0
  while (received < skip + length) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    received += value.length
  }
  void reader.cancel().catch(() => {})
  const bytes = new Uint8Array(received)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
  return bytes.subarray(skip, skip + length)
}

/** Walks top-level boxes with range requests so a trailing `moov` is found without downloading `mdat`. */
export async function readMp4FrameRate(src: string, signal: AbortSignal) {
  let offset = 0
  let chunk = await fetchBytes(src, 0, HEAD_BYTES, signal)
  let chunkStart = 0
  for (let step = 0; step < 12; step += 1) {
    let local = offset - chunkStart
    if (local < 0 || local + 16 > chunk.length) {
      chunk = await fetchBytes(src, offset, 64 * 1024, signal)
      chunkStart = offset
      local = 0
    }
    const view = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength)
    const box = readBox(view, local, chunk.length)
    if (!box) return null
    if (box.type === 'moov') {
      if (box.size > MAX_MOOV_BYTES) return null
      const moov = local + box.size <= chunk.length ? chunk.subarray(local, local + box.size) : await fetchBytes(src, offset, box.size, signal)
      return parseMp4FrameRate(moov)
    }
    offset += box.size
  }
  return null
}

type FrameCallbackVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (callback: (now: number, metadata: { mediaTime: number }) => void) => number
}

/** Plays a muted hidden copy briefly and reads presentation timestamps; for containers other than MP4. */
function measurePlaybackFps(src: string, timeoutMs: number) {
  return new Promise<number | null>((resolve) => {
    const video = document.createElement('video') as FrameCallbackVideo
    if (typeof video.requestVideoFrameCallback !== 'function') {
      resolve(null)
      return
    }
    const times: number[] = []
    let finished = false
    const finish = () => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      video.pause()
      video.removeAttribute('src')
      video.load()
      video.remove()
      const sorted = [...new Set(times)].sort((a, b) => a - b)
      resolve(snapPreviewFps(sorted.slice(1).map((time, index) => time - sorted[index])))
    }
    const timer = setTimeout(finish, timeoutMs)
    const onFrame = (_now: number, metadata: { mediaTime: number }) => {
      times.push(metadata.mediaTime)
      if (times.length >= 16) finish()
      else video.requestVideoFrameCallback?.(onFrame)
    }
    video.muted = true
    video.playsInline = true
    video.preload = 'auto'
    video.setAttribute('aria-hidden', 'true')
    Object.assign(video.style, { position: 'fixed', left: '0', bottom: '0', width: '2px', height: '2px', opacity: '0.01', pointerEvents: 'none' })
    video.addEventListener('ended', finish, { once: true })
    video.addEventListener('error', finish, { once: true })
    video.src = src
    document.body.appendChild(video)
    video.requestVideoFrameCallback(onFrame)
    void video.play().catch(finish)
  })
}

export async function detectVideoFps(src: string, signal: AbortSignal, timeoutMs = 2600) {
  const fromContainer = await readMp4FrameRate(src, signal).catch(() => null)
  if (fromContainer || signal.aborted) return fromContainer
  return measurePlaybackFps(src, timeoutMs)
}
