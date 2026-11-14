import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { parseShowinfoTimes, startVideoTimingProbe, tidyCutTimes } from '@/lib/video-repaint/cut-detection'

const FFMPEG = process.env.FFMPEG_PATH?.trim() || 'ffmpeg'
const FFPROBE = process.env.FFPROBE_PATH?.trim() || 'ffprobe'
const hasFfmpeg = spawnSync(FFMPEG, ['-version']).status === 0 && spawnSync(FFPROBE, ['-version']).status === 0

function probeWorkspaces(): string[] {
  return readdirSync(tmpdir()).filter((name) => name.startsWith('nori-repaint-')).sort()
}

describe('parseShowinfoTimes', () => {
  it('reads pts_time from showinfo lines only', () => {
    const output = [
      '[Parsed_showinfo_2 @ 0x7f8b1c004a80] n:   0 pts:  37500 pts_time:1.5     pos:   123 fmt:yuv420p',
      '[Parsed_showinfo_2 @ 0x7f8b1c004a80] n:   1 pts:  75000 pts_time:3       pos:   456 fmt:yuv420p',
      '[Parsed_select_1 @ 0x7f8b1c004a00] pts_time:9.9 belongs to another filter',
      'frame=  113 fps=0.0 q=-0.0 Lsize=N/A time=00:00:04.52 bitrate=N/A',
      '[Parsed_showinfo_2 @ 0x7f8b1c004a80] n:   2 pts: -100 pts_time:-0.004 pos: 1 fmt:yuv420p',
      '[Parsed_showinfo_2 @ 0x7f8b1c004a80] n:   3 pts: 1 pts_time:abc',
    ].join('\n')

    expect(parseShowinfoTimes(output)).toEqual([1.5, 3, -0.004])
  })

  it('copes with Windows line endings and empty output', () => {
    expect(parseShowinfoTimes('[Parsed_showinfo_2 @ 0x1] n: 0 pts_time:2.25 pos: 1\r\n[Parsed_showinfo_2 @ 0x1] n: 1 pts_time:4 pos: 2\r\n'))
      .toEqual([2.25, 4])
    expect(parseShowinfoTimes('')).toEqual([])
  })
})

describe('tidyCutTimes', () => {
  it('sorts, rounds to milliseconds and drops near-duplicates from one dissolve', () => {
    expect(tidyCutTimes([3.0004, 1.5, 1.7, 1.5001, 5], 10)).toEqual([1.5, 3, 5])
  })

  it('drops the first and last instants of the video', () => {
    expect(tidyCutTimes([0.1, 0.5, 4.0, 4.45], 4.5)).toEqual([0.5, 4])
  })

  it('keeps late cuts when the duration is unknown', () => {
    expect(tidyCutTimes([0.5, 99.9])).toEqual([0.5, 99.9])
    expect(tidyCutTimes([0.5, 99.9], null)).toEqual([0.5, 99.9])
    expect(tidyCutTimes([0.5, 99.9], Number.NaN)).toEqual([0.5, 99.9])
  })

  it('ignores times that are not numbers', () => {
    expect(tidyCutTimes([Number.NaN, Number.POSITIVE_INFINITY, 2], 10)).toEqual([2])
  })

  it('caps the number of cuts', () => {
    const times = Array.from({ length: 2_000 }, (_, index) => 1 + index)

    expect(tidyCutTimes(times)).toHaveLength(1_500)
  })
})

describe('startVideoTimingProbe without ffmpeg', () => {
  const saved = { ffmpeg: process.env.FFMPEG_PATH, ffprobe: process.env.FFPROBE_PATH }

  afterEach(() => {
    if (saved.ffmpeg === undefined) delete process.env.FFMPEG_PATH
    else process.env.FFMPEG_PATH = saved.ffmpeg
    if (saved.ffprobe === undefined) delete process.env.FFPROBE_PATH
    else process.env.FFPROBE_PATH = saved.ffprobe
  })

  it('reports nothing instead of failing when the tools are missing', async () => {
    process.env.FFMPEG_PATH = path.join(tmpdir(), 'no-such-dir', 'ffmpeg')
    process.env.FFPROBE_PATH = path.join(tmpdir(), 'no-such-dir', 'ffprobe')
    const before = probeWorkspaces()

    const probe = startVideoTimingProbe(new File([new Uint8Array(2_048)], 'clip.mp4', { type: 'video/mp4' }))

    expect(await probe.duration).toBeNull()
    expect(await probe.cuts).toEqual({ status: 'failed', cutTimes: [] })
    await probe.dispose()
    await probe.dispose()
    expect(probeWorkspaces()).toEqual(before)
  })

  it('gives up at once when the request was already cancelled', async () => {
    const before = probeWorkspaces()

    const probe = startVideoTimingProbe(
      new File([new Uint8Array(2_048)], 'clip.mp4', { type: 'video/mp4' }),
      { signal: AbortSignal.abort() },
    )

    expect(await probe.duration).toBeNull()
    expect(await probe.cuts).toEqual({ status: 'failed', cutTimes: [] })
    await probe.dispose()
    expect(probeWorkspaces()).toEqual(before)
  })
})

describe.skipIf(!hasFfmpeg)('startVideoTimingProbe with ffmpeg', () => {
  let directory = ''
  let threeShots: Uint8Array<ArrayBuffer>
  let oneShot: Uint8Array<ArrayBuffer>

  function render(name: string, colours: string[]): Uint8Array<ArrayBuffer> {
    const file = path.join(directory, name)
    const inputs = colours.flatMap((colour) => ['-f', 'lavfi', '-i', `color=c=${colour}:s=160x120:r=25:d=1.5`])
    const filter = `${colours.map((_, index) => `[${index}:v]`).join('')}concat=n=${colours.length}:v=1:a=0[v]`
    const result = spawnSync(FFMPEG, [
      '-y', '-hide_banner', '-loglevel', 'error',
      ...inputs,
      '-filter_complex', filter,
      '-map', '[v]', '-c:v', 'mpeg4', '-q:v', '3', '-pix_fmt', 'yuv420p',
      file,
    ])
    if (result.status !== 0) throw new Error(`ffmpeg could not render the fixture: ${result.stderr?.toString()}`)
    return new Uint8Array(readFileSync(file))
  }

  beforeAll(() => {
    directory = mkdtempSync(path.join(tmpdir(), 'nori-cut-fixture-'))
    threeShots = render('three-shots.mp4', ['red', 'blue', 'green'])
    oneShot = render('one-shot.mp4', ['red'])
    return () => rmSync(directory, { recursive: true, force: true })
  }, 60_000)

  it('measures the real duration and finds the cuts between colour blocks', async () => {
    const before = probeWorkspaces()
    const probe = startVideoTimingProbe(new File([threeShots], 'three-shots.mp4', { type: 'video/mp4' }))

    const duration = await probe.duration
    const cuts = await probe.cuts

    expect(duration).not.toBeNull()
    expect(duration as number).toBeGreaterThan(4.3)
    expect(duration as number).toBeLessThan(4.7)
    expect(cuts.status).toBe('done')
    expect(cuts.cutTimes).toHaveLength(2)
    expect(Math.abs(cuts.cutTimes[0] - 1.5)).toBeLessThan(0.15)
    expect(Math.abs(cuts.cutTimes[1] - 3)).toBeLessThan(0.15)

    await probe.dispose()
    // The temporary copy of the upload is gone once the probe is disposed.
    expect(probeWorkspaces()).toEqual(before)
  }, 60_000)

  it('finds no cut in a single continuous shot', async () => {
    const probe = startVideoTimingProbe(new File([oneShot], 'one-shot.mp4', { type: 'video/mp4' }))

    expect(await probe.duration).not.toBeNull()
    expect(await probe.cuts).toEqual({ status: 'done', cutTimes: [] })
    await probe.dispose()
  }, 60_000)

  it('falls back to mp4 when the upload has an unusable extension', async () => {
    const probe = startVideoTimingProbe(new File([threeShots], 'clip.weird-extension-name', { type: 'video/mp4' }))

    expect((await probe.cuts).status).toBe('done')
    await probe.dispose()
  }, 60_000)
})
