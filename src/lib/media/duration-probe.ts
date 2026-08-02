import { spawn } from 'node:child_process'

const MAX_PROBE_BYTES = 220 * 1024 * 1024

/** Read container duration without decoding the media stream. */
export async function probeMediaDurationSeconds(input: Buffer): Promise<number | null> {
  if (input.length === 0 || input.length > MAX_PROBE_BYTES) return null
  const ffprobe = process.env.FFPROBE_PATH?.trim() || 'ffprobe'
  return await new Promise<number | null>((resolve) => {
    const child = spawn(ffprobe, [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      'pipe:0',
    ], { stdio: ['pipe', 'pipe', 'pipe'] })
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
    }, 15_000)
    child.stdout.on('data', (chunk: Buffer) => { stdout = `${stdout}${chunk.toString('utf8')}`.slice(-256) })
    child.once('error', () => finish(null))
    child.once('close', (code) => {
      if (code !== 0) { finish(null); return }
      const duration = Number(stdout.trim())
      finish(Number.isFinite(duration) && duration >= 0 ? duration : null)
    })
    child.stdin.once('error', () => finish(null))
    child.stdin.end(input)
  })
}
