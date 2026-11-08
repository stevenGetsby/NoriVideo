import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  extractCanvasVideoAudio,
  normalizeCanvasAudioExtractRange,
  normalizeCanvasVideoRegion,
} from '@/lib/canvas/video-operations'

describe('canvas video operations', () => {
  it('keeps subtitle erase selections in the lower half of the frame', () => {
    expect(normalizeCanvasVideoRegion({ x: 0.1, y: 0.2, width: 0.7, height: 0.3 }, 'subtitle')).toEqual({
      x: 0.1,
      y: 0.5,
      width: 0.7,
      height: 0.3,
    })
  })

  it('allows full-frame text erasing and clamps the selection', () => {
    expect(normalizeCanvasVideoRegion({ x: -1, y: 0.1, width: 4, height: 4 }, 'text')).toEqual({
      x: 0,
      y: 0.1,
      width: 1,
      height: 0.9,
    })
  })

  it('rejects non-finite coordinates', () => {
    expect(() => normalizeCanvasVideoRegion({ x: Number.NaN, y: 0.5, width: 0.5, height: 0.2 })).toThrow('去字幕区域格式无效')
  })
})

describe('canvas audio extraction range', () => {
  it('returns the selected duration and clamps an end beyond the source', () => {
    expect(normalizeCanvasAudioExtractRange({ startMs: 500, endMs: 2_500 })).toEqual({
      startMs: 500,
      endMs: 2_500,
      durationSeconds: 2,
    })
    expect(normalizeCanvasAudioExtractRange({ startMs: 0, endMs: 9_000 }, 2)).toEqual({
      startMs: 0,
      endMs: 2_000,
      durationSeconds: 2,
    })
  })

  it('rejects inverted, negative, non-finite, out-of-range and too-short selections', () => {
    expect(() => normalizeCanvasAudioExtractRange({ startMs: 2_000, endMs: 1_000 })).toThrow('区间无效')
    expect(() => normalizeCanvasAudioExtractRange({ startMs: -1, endMs: 1_000 })).toThrow('区间无效')
    expect(() => normalizeCanvasAudioExtractRange({ startMs: Number.NaN, endMs: 1_000 })).toThrow('区间无效')
    expect(() => normalizeCanvasAudioExtractRange({ startMs: 2_000, endMs: 3_000 }, 2)).toThrow('起点超出视频时长')
    expect(() => normalizeCanvasAudioExtractRange({ startMs: 1_000, endMs: 1_050 })).toThrow('至少选择 0.1 秒')
  })
})

const ffmpegAvailable = spawnSync('ffmpeg', ['-version']).status === 0
  && spawnSync('ffprobe', ['-version']).status === 0
const directories: string[] = []

async function fixtureDirectory() {
  const directory = await mkdtemp(path.join(tmpdir(), 'nori-audio-test-'))
  directories.push(directory)
  return directory
}

function ffmpeg(args: string[]) {
  const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8' })
  if (result.status !== 0) throw new Error(result.stderr || 'ffmpeg fixture failed')
}

function ffprobe(filePath: string) {
  const result = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type:format=duration', '-of', 'json', filePath], { encoding: 'utf8' })
  if (result.status !== 0) throw new Error(result.stderr || 'ffprobe failed')
  return JSON.parse(result.stdout) as {
    streams?: Array<{ codec_type?: string }>
    format?: { duration?: string }
  }
}

afterAll(async () => {
  await Promise.all(directories.map((directory) => rm(directory, { recursive: true, force: true }).catch(() => undefined)))
})

describe.skipIf(!ffmpegAvailable)('real ffmpeg audio extraction', () => {
  it('extracts the selected timeline range as a playable MP3 with a clamped duration', async () => {
    const directory = await fixtureDirectory()
    const sourcePath = path.join(directory, 'source.mp4')
    ffmpeg([
      '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=24:duration=3',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', sourcePath,
    ])
    const source = await readFile(sourcePath)

    const result = await extractCanvasVideoAudio(source, { startMs: 500, endMs: 9_000 })
    expect(result.body.byteLength).toBeGreaterThan(1_000)
    expect(result.duration).toBeGreaterThan(2.1)
    expect(result.duration).toBeLessThan(2.7)

    const outputPath = path.join(directory, 'result.mp3')
    await writeFile(outputPath, result.body)
    const probed = ffprobe(outputPath)
    expect(probed.streams?.some((stream) => stream.codec_type === 'audio')).toBe(true)
    expect(Number(probed.format?.duration)).toBeGreaterThan(2.1)
  }, 30_000)

  it('rejects a video without an audio track instead of returning silent bytes', async () => {
    const directory = await fixtureDirectory()
    const sourcePath = path.join(directory, 'silent.mp4')
    ffmpeg(['-f', 'lavfi', '-i', 'testsrc=size=160x120:rate=12:duration=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', sourcePath])

    await expect(extractCanvasVideoAudio(await readFile(sourcePath), { startMs: 0, endMs: 500 }))
      .rejects.toThrow('源视频没有音轨')
  }, 30_000)

  it('rejects an audio-only file because timeline extraction requires a video stream', async () => {
    const directory = await fixtureDirectory()
    const sourcePath = path.join(directory, 'source.mp3')
    ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', sourcePath])

    await expect(extractCanvasVideoAudio(await readFile(sourcePath), { startMs: 0, endMs: 500 }))
      .rejects.toThrow('不包含视频画面')
  }, 30_000)

  it('rejects an inverted selection after probing the source', async () => {
    const directory = await fixtureDirectory()
    const sourcePath = path.join(directory, 'source.mp4')
    ffmpeg([
      '-f', 'lavfi', '-i', 'testsrc=size=160x120:rate=12:duration=1',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', sourcePath,
    ])

    await expect(extractCanvasVideoAudio(await readFile(sourcePath), { startMs: 700, endMs: 300 }))
      .rejects.toThrow('区间无效')
  }, 30_000)
})
