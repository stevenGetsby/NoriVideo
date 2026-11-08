import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { probeMediaDurationSeconds } from '@/lib/media/duration-probe'

function generateMp3(): Buffer {
  return execFileSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100',
    '-t', '7.49', '-c:a', 'libmp3lame', '-write_xing', '0',
    '-f', 'mp3', 'pipe:1',
  ], { maxBuffer: 2 * 1024 * 1024 })
}

describe('probeMediaDurationSeconds', () => {
  it('recovers the duration of a valid MP3 without format duration', async () => {
    const input = generateMp3()
    const rawDuration = execFileSync('ffprobe', [
      '-v', 'error', '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1', 'pipe:0',
    ], { input, encoding: 'utf8' }).trim()
    expect(rawDuration).toBe('N/A')

    const duration = await probeMediaDurationSeconds(input)
    expect(duration).not.toBeNull()
    expect(duration).toBeCloseTo(7.49, 1)
  }, 30_000)

  it('reads ordinary WAV duration without decoding', async () => {
    const input = execFileSync('ffmpeg', [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100',
      '-t', '2.5', '-f', 'wav', 'pipe:1',
    ], { maxBuffer: 2 * 1024 * 1024 })
    await expect(probeMediaDurationSeconds(input)).resolves.toBeCloseTo(2.5, 2)
  })

  it('still rejects invalid media', async () => {
    await expect(probeMediaDurationSeconds(Buffer.from('not audio'))).resolves.toBeNull()
  })
})
