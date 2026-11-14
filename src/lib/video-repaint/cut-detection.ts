import { spawn, type ChildProcess } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import type { ReadableStream as WebReadableStream } from 'node:stream/web'
import { pipeline } from 'node:stream/promises'

/**
 * Timing facts about an uploaded video that the video model cannot measure for itself: how long it really runs and
 * where the picture visibly cuts. Both come from ffmpeg and are best-effort. A missing ffmpeg, an odd container or a slow
 * scan only means the storyboard works without that aid; it never fails the 转绘.
 */

// `scene` is ffmpeg's frame-difference score from 0 to 1. Hard cuts of a drama land well above this; it errs towards
// reporting a few extra cuts, which the storyboard prompt already warns the model about.
const SCENE_THRESHOLD = 0.22
const SCAN_WIDTH = 320
const SCAN_THREADS = 2
const SCAN_TIMEOUT_MS = 90_000
const PROBE_TIMEOUT_MS = 20_000
// Scans decode the whole video; more than a couple at once would starve the rest of the server.
const MAX_CONCURRENT_SCANS = 2
// A score that fires on this many frames belongs to a strobing or noisy picture; its hints would mislead.
const MAX_RAW_CUTS = 20_000
const MIN_CUT_GAP_SECONDS = 0.4
const EDGE_MARGIN_SECONDS = 0.2
const MAX_CUTS = 1_500

export interface CutScan {
  /** `done`: the scan ran to the end. `skipped`: too many scans were running. `failed`: ffmpeg is missing, errored or timed out. */
  status: 'done' | 'skipped' | 'failed'
  /** Seconds at which the picture cuts, ascending, with duplicates and the very ends of the video removed. */
  cutTimes: number[]
}

export interface VideoTimingProbe {
  /** The real length of the video according to ffprobe; null when it cannot be read. Settles within seconds. */
  duration: Promise<number | null>
  /** Resolves when the scan is done, skipped or given up. Never rejects. */
  cuts: Promise<CutScan>
  /** Stops anything still running and deletes the temporary copy of the video. Safe to call more than once. */
  dispose: () => Promise<void>
}

type RawScan = { status: 'done'; times: number[] } | { status: 'skipped' | 'failed' }

interface ProcessOutcome {
  exitCode: number | null
  timedOut: boolean
  spawnFailed: boolean
}

let activeScans = 0

function extensionOf(fileName: string): string {
  const match = fileName.toLowerCase().match(/\.([a-z0-9]{1,8})$/)
  return match?.[1] || 'mp4'
}

/** Seconds from the `pts_time:` fields of ffmpeg's `showinfo` log lines. */
export function parseShowinfoTimes(output: string): number[] {
  const times: number[] = []
  for (const line of output.split(/\r?\n/)) {
    if (!line.includes('showinfo')) continue
    const match = line.match(/pts_time:\s*(-?\d+(?:\.\d+)?)/)
    if (!match) continue
    const seconds = Number(match[1])
    if (Number.isFinite(seconds)) times.push(seconds)
  }
  return times
}

/** Ascending cut times with near-duplicates (one dissolve scores on several frames) and the first and last instants dropped. */
export function tidyCutTimes(times: readonly number[], durationSeconds?: number | null): number[] {
  const sorted = times
    .filter((time) => Number.isFinite(time))
    .map((time) => Math.round(time * 1000) / 1000)
    .sort((left, right) => left - right)
  const hasDuration = typeof durationSeconds === 'number' && Number.isFinite(durationSeconds) && durationSeconds > 0
  const tidy: number[] = []
  for (const time of sorted) {
    if (time < EDGE_MARGIN_SECONDS) continue
    if (hasDuration && time > durationSeconds - EDGE_MARGIN_SECONDS) continue
    if (tidy.length > 0 && time - tidy[tidy.length - 1] < MIN_CUT_GAP_SECONDS) continue
    tidy.push(time)
    if (tidy.length >= MAX_CUTS) break
  }
  return tidy
}

function runProcess(
  command: string,
  args: string[],
  options: {
    timeoutMs: number
    children: Set<ChildProcess>
    onStdout?: (chunk: string) => void
    /** Returning `'kill'` stops the process (used when the output is clearly not worth waiting for). */
    onStderr?: (chunk: string) => 'kill' | void
  },
): Promise<ProcessOutcome> {
  return new Promise((resolve) => {
    let child: ChildProcess
    try {
      child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    } catch {
      resolve({ exitCode: null, timedOut: false, spawnFailed: true })
      return
    }
    options.children.add(child)
    let settled = false
    let timedOut = false
    const finish = (outcome: ProcessOutcome) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      options.children.delete(child)
      resolve(outcome)
    }
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, options.timeoutMs)
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => options.onStdout?.(chunk))
    child.stderr?.on('data', (chunk: string) => {
      if (options.onStderr?.(chunk) === 'kill') child.kill('SIGKILL')
    })
    child.once('error', () => finish({ exitCode: null, timedOut, spawnFailed: true }))
    child.once('close', (exitCode) => finish({ exitCode, timedOut, spawnFailed: false }))
  })
}

async function probeDuration(filePath: string, children: Set<ChildProcess>): Promise<number | null> {
  let stdout = ''
  const outcome = await runProcess(process.env.FFPROBE_PATH?.trim() || 'ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    filePath,
  ], {
    timeoutMs: PROBE_TIMEOUT_MS,
    children,
    onStdout: (chunk) => { stdout = `${stdout}${chunk}`.slice(-1_024) },
  })
  if (outcome.exitCode !== 0) return null
  const seconds = Number(stdout.trim().split(/\r?\n/)[0])
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null
}

async function scanCuts(filePath: string, children: Set<ChildProcess>): Promise<number[] | null> {
  let pending = ''
  const times: number[] = []
  let noisy = false
  const collect = (text: string) => {
    for (const time of parseShowinfoTimes(text)) {
      if (times.length >= MAX_RAW_CUTS) {
        noisy = true
        return
      }
      times.push(time)
    }
  }
  const outcome = await runProcess(process.env.FFMPEG_PATH?.trim() || 'ffmpeg', [
    '-nostdin', '-hide_banner', '-nostats',
    '-threads', String(SCAN_THREADS),
    '-i', filePath,
    '-an', '-sn',
    '-vf', `scale=${SCAN_WIDTH}:-2,select='gt(scene,${SCENE_THRESHOLD})',showinfo`,
    '-f', 'null', '-',
  ], {
    timeoutMs: SCAN_TIMEOUT_MS,
    children,
    onStderr: (chunk) => {
      if (noisy) return 'kill'
      pending += chunk
      const lines = pending.split(/\r?\n|\r/)
      pending = lines.pop() ?? ''
      collect(lines.join('\n'))
      return noisy ? 'kill' : undefined
    },
  })
  if (outcome.exitCode !== 0 || outcome.timedOut || noisy) return null
  collect(pending)
  return noisy ? null : times
}

/**
 * Copies the upload to a temporary file and, while the video model is still working on its own copy, reads the real
 * duration and scans for cuts. `duration` is wanted first (it sets the frame-sampling rate), `cuts` later.
 */
export function startVideoTimingProbe(file: File, options: { signal?: AbortSignal } = {}): VideoTimingProbe {
  const children = new Set<ChildProcess>()
  const abort = new AbortController()
  const stop = () => {
    abort.abort()
    children.forEach((child) => child.kill('SIGKILL'))
  }
  if (options.signal?.aborted) stop()
  else options.signal?.addEventListener('abort', stop, { once: true })

  const workspace = (async (): Promise<{ directory: string; filePath: string } | null> => {
    let directory: string
    try {
      directory = await mkdtemp(path.join(tmpdir(), 'nori-repaint-'))
    } catch {
      return null
    }
    const filePath = path.join(directory, `source.${extensionOf(file.name)}`)
    try {
      await pipeline(
        Readable.fromWeb(file.stream() as unknown as WebReadableStream<Uint8Array>),
        createWriteStream(filePath),
        { signal: abort.signal },
      )
    } catch {
      await rm(directory, { recursive: true, force: true }).catch(() => undefined)
      return null
    }
    return { directory, filePath }
  })()

  const duration = workspace.then(async (ready) => {
    if (!ready || abort.signal.aborted) return null
    return await probeDuration(ready.filePath, children)
  })

  const scan = workspace.then(async (ready): Promise<RawScan> => {
    if (!ready || abort.signal.aborted) return { status: 'failed' }
    if (activeScans >= MAX_CONCURRENT_SCANS) return { status: 'skipped' }
    activeScans += 1
    try {
      const times = await scanCuts(ready.filePath, children)
      return times ? { status: 'done', times } : { status: 'failed' }
    } finally {
      activeScans -= 1
    }
  })

  const cuts = Promise.all([duration, scan]).then(([length, scanned]): CutScan => (
    scanned.status === 'done'
      ? { status: 'done', cutTimes: tidyCutTimes(scanned.times, length) }
      : { status: scanned.status, cutTimes: [] }
  )).catch((): CutScan => ({ status: 'failed', cutTimes: [] }))

  let disposal: Promise<void> | null = null
  const dispose = () => {
    disposal ??= (async () => {
      options.signal?.removeEventListener('abort', stop)
      stop()
      const ready = await workspace.catch(() => null)
      await Promise.allSettled([duration, scan])
      if (ready) await rm(ready.directory, { recursive: true, force: true }).catch(() => undefined)
    })()
    return disposal
  }

  return { duration: duration.catch(() => null), cuts, dispose }
}
