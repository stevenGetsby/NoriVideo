import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseMp4FrameRate, readMp4FrameRate } from '@/features/canvas/video-fps'

function u32(value: number) {
  return [value >>> 24, (value >>> 16) & 255, (value >>> 8) & 255, value & 255]
}

function box(type: string, ...payload: number[][]) {
  const body = payload.flat()
  return [...u32(body.length + 8), ...[...type].map((char) => char.charCodeAt(0)), ...body]
}

function track(handler: string, timescale: number, entries: Array<[number, number]>, version = 0) {
  const mdhd = version === 1
    ? box('mdhd', [1, 0, 0, 0], Array(16).fill(0), u32(timescale), Array(8).fill(0), [0, 0, 0, 0])
    : box('mdhd', [0, 0, 0, 0], Array(8).fill(0), u32(timescale), u32(0), [0, 0, 0, 0])
  const hdlr = box('hdlr', [0, 0, 0, 0], u32(0), [...handler].map((char) => char.charCodeAt(0)), Array(12).fill(0))
  const stts = box('stts', [0, 0, 0, 0], u32(entries.length), ...entries.map(([count, delta]) => [...u32(count), ...u32(delta)]))
  return box('trak', box('mdia', mdhd, hdlr, box('minf', box('stbl', stts))))
}

describe('mp4 frame rate', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('reads the dominant sample duration of the video track and skips audio tracks', () => {
    const moov = Uint8Array.from(box('moov', track('soun', 44100, [[90, 1024]]), track('vide', 12800, [[1, 1024], [49, 512]])))
    expect(parseMp4FrameRate(moov)).toBe(25)
    expect(parseMp4FrameRate(Uint8Array.from(box('moov', track('vide', 30000, [[120, 1001]], 1))))).toBe(29.97)
    expect(parseMp4FrameRate(Uint8Array.from(box('moov', track('vide', 90000, [[40, 6000]]))))).toBe(15)
    expect(parseMp4FrameRate(Uint8Array.from(box('moov', track('soun', 48000, [[10, 1024]]))))).toBeNull()
    expect(parseMp4FrameRate(Uint8Array.from(box('free', [0, 0, 0, 0])))).toBeNull()
  })

  it('follows box sizes with range requests to find a trailing moov', async () => {
    const file = Uint8Array.from([...box('ftyp', Array(16).fill(0)), ...box('mdat', Array(400_000).fill(7)), ...box('moov', track('vide', 24000, [[48, 1001]]))])
    const ranges: string[] = []
    vi.stubGlobal('fetch', async (_src: string, init: RequestInit) => {
      const range = String((init.headers as Record<string, string>).Range)
      ranges.push(range)
      const [, start, end] = range.match(/bytes=(\d+)-(\d+)/)!.map(Number)
      return new Response(file.slice(start, Math.min(file.length, end + 1)), { status: 206 })
    })
    await expect(readMp4FrameRate('blob:video', new AbortController().signal)).resolves.toBe(23.976)
    expect(ranges[0]).toBe('bytes=0-262143')
    expect(ranges.length).toBe(2)
  })
})
