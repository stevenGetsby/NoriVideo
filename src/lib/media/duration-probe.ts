import { spawn } from 'node:child_process'

const MAX_PROBE_BYTES = 220 * 1024 * 1024
const PROBE_TIMEOUT_MS = 15_000

function runDurationProbe(command: string, args: string[], input: Buffer, readDuration: (output: string) => number | null): Promise<number | null> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let settled = false
    const finish = (value: number | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(value)
    }
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      finish(null)
    }, PROBE_TIMEOUT_MS)
    child.stdout.on('data', (chunk: Buffer) => { stdout = `${stdout}${chunk.toString('utf8')}`.slice(-4096) })
    child.once('error', () => finish(null))
    child.once('close', (code) => finish(code === 0 ? readDuration(stdout) : null))
    child.stdin.once('error', () => finish(null))
    child.stdin.end(input)
  })
}

function numericDuration(output: string): number | null {
  const duration = Number(output.trim())
  return Number.isFinite(duration) && duration >= 0 ? duration : null
}

function decodedDuration(output: string): number | null {
  if (!/(?:^|\n)progress=end(?:\n|$)/.test(output)) return null
  const value = output.split('\n').findLast((line) => line.startsWith('out_time_us='))?.slice('out_time_us='.length)
  return value ? numericDuration(String(Number(value) / 1_000_000)) : null
}

/** Some streamed MP3s omit container and stream durations; decoding recovers their exact end time. */
export async function probeMediaDurationSeconds(input: Buffer): Promise<number | null> {
  if (input.length === 0 || input.length > MAX_PROBE_BYTES) return null
  const ffprobe = process.env.FFPROBE_PATH?.trim() || 'ffprobe'
  const containerDuration = await runDurationProbe(ffprobe, [
    '-v', 'error',
    '-show_entries', 'format=duration:stream=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    'pipe:0',
  ], input, (output) => {
    for (const value of output.trim().split(/\r?\n/)) {
      const duration = numericDuration(value)
      if (duration !== null) return duration
    }
    return null
  })
  if (containerDuration !== null) return containerDuration
  const ffmpeg = process.env.FFMPEG_PATH?.trim() || 'ffmpeg'
  return await runDurationProbe(ffmpeg, [
    '-nostdin', '-v', 'error',
    '-i', 'pipe:0', '-map', '0',
    '-f', 'null', '-progress', 'pipe:1', '-nostats', '-',
  ], input, decodedDuration)
}
