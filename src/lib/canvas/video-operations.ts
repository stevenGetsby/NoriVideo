import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const VIDEO_OPERATION_TIMEOUT_MS = 15 * 60 * 1_000
const MAX_OUTPUT_LOG = 16_000
const MAX_OUTPUT_EDGE = 4_096

export type CanvasVideoRegion = {
  x: number
  y: number
  width: number
  height: number
}

export type CanvasVideoInfo = {
  width: number
  height: number
  duration: number
  fps: number
}

export type CanvasVideoResult = CanvasVideoInfo & {
  body: Buffer
}

export type CanvasVideoOperationHooks = {
  /** Called periodically while ffmpeg is running. Throw to terminate the child process. */
  assertActive?: () => Promise<void>
  /** Receives normalized media progress in the inclusive 0..1 range. */
  onProgress?: (progress: number) => Promise<void> | void
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function even(value: number) {
  const rounded = Math.max(2, Math.round(value))
  return rounded % 2 === 0 ? rounded : rounded - 1
}

function parseRate(value: unknown) {
  if (typeof value !== 'string') return 0
  const [rawNumerator, rawDenominator = '1'] = value.split('/')
  const numerator = Number(rawNumerator)
  const denominator = Number(rawDenominator)
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return 0
  return numerator / denominator
}

export function normalizeCanvasVideoRegion(
  value: CanvasVideoRegion,
  mode: 'subtitle' | 'text' = 'subtitle',
): CanvasVideoRegion {
  const values = [value.x, value.y, value.width, value.height]
  if (values.some((item) => !finite(item))) throw new Error('去字幕区域格式无效')
  const x = Math.max(0, Math.min(0.98, value.x))
  const minimumY = mode === 'subtitle' ? 0.5 : 0
  const y = Math.max(minimumY, Math.min(0.98, value.y))
  const width = Math.max(0.02, Math.min(1 - x, value.width))
  const height = Math.max(0.02, Math.min(1 - y, value.height))
  if (width < 0.02 || height < 0.02) throw new Error('去字幕区域过小')
  return { x, y, width, height }
}

function run(binary: string, args: string[], options?: {
  timeoutMs?: number
  durationSeconds?: number
  hooks?: CanvasVideoOperationHooks
}) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    let progressBuffer = ''
    let settled = false
    let checkingActive = false
    let lastProgressAt = 0
    const timeoutMs = options?.timeoutMs ?? VIDEO_OPERATION_TIMEOUT_MS

    const cleanup = () => {
      clearTimeout(timer)
      if (activeTimer) clearInterval(activeTimer)
    }
    const fail = (error: unknown, kill = false) => {
      if (settled) return
      settled = true
      cleanup()
      if (kill && child.exitCode === null) child.kill('SIGKILL')
      reject(error instanceof Error ? error : new Error(String(error)))
    }
    const succeed = () => {
      if (settled) return
      settled = true
      cleanup()
      resolve(stderr)
    }
    const timer = setTimeout(() => {
      fail(new Error('视频处理超时，请缩短视频后重试'), true)
    }, timeoutMs)

    const activeTimer = options?.hooks?.assertActive
      ? setInterval(() => {
        if (checkingActive || settled) return
        checkingActive = true
        void options.hooks?.assertActive?.()
          .catch((error) => fail(error, true))
          .finally(() => { checkingActive = false })
      }, 1_500)
      : null

    child.stderr.on('data', (chunk: Buffer) => {
      const value = chunk.toString('utf8')
      stderr = `${stderr}${value}`.slice(-MAX_OUTPUT_LOG)
      if (!options?.hooks?.onProgress || !options.durationSeconds || options.durationSeconds <= 0) return

      progressBuffer = `${progressBuffer}${value}`.slice(-2_000)
      const matches = Array.from(progressBuffer.matchAll(/out_time_(?:us|ms)=(\d+)/g))
      const latest = matches.at(-1)?.[1]
      if (!latest) return
      const now = Date.now()
      if (now - lastProgressAt < 750) return
      lastProgressAt = now
      const elapsedSeconds = Number(latest) / 1_000_000
      const ratio = Math.max(0, Math.min(1, elapsedSeconds / options.durationSeconds))
      void Promise.resolve(options.hooks.onProgress(ratio)).catch(() => undefined)
    })
    child.once('error', (error) => {
      fail(error)
    })
    child.once('close', (code) => {
      if (code === 0) succeed()
      else fail(new Error(stderr.trim().split('\n').slice(-6).join('\n') || `视频处理失败（${code ?? 'unknown'}）`))
    })
  })
}

async function probeFile(filePath: string): Promise<CanvasVideoInfo> {
  const ffprobe = process.env.FFPROBE_PATH?.trim() || 'ffprobe'
  const output: string[] = []
  await new Promise<void>((resolve, reject) => {
    const child = spawn(ffprobe, [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height,avg_frame_rate:format=duration',
      '-of', 'json',
      filePath,
    ], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error('读取视频信息超时'))
    }, 30_000)
    child.stdout.on('data', (chunk: Buffer) => output.push(chunk.toString('utf8')))
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })
    child.once('error', (error) => { clearTimeout(timer); reject(error) })
    child.once('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve()
      else reject(new Error(stderr.trim() || '无法读取视频信息'))
    })
  })
  const payload = JSON.parse(output.join('')) as {
    streams?: Array<{ width?: number; height?: number; avg_frame_rate?: string }>
    format?: { duration?: string }
  }
  const stream = payload.streams?.[0]
  const width = Number(stream?.width)
  const height = Number(stream?.height)
  const duration = Number(payload.format?.duration)
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 2 || height < 2) {
    throw new Error('视频尺寸无效')
  }
  return {
    width,
    height,
    duration: Number.isFinite(duration) ? duration : 0,
    fps: parseRate(stream?.avg_frame_rate),
  }
}

async function fileHasAudio(filePath: string) {
  const ffprobe = process.env.FFPROBE_PATH?.trim() || 'ffprobe'
  return await new Promise<boolean>((resolve, reject) => {
    const child = spawn(ffprobe, [
      '-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=index', '-of', 'csv=p=0', filePath,
    ], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('读取视频音轨超时')) }, 30_000)
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8') })
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })
    child.once('error', (error) => { clearTimeout(timer); reject(error) })
    child.once('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve(Boolean(stdout.trim()))
      else reject(new Error(stderr.trim() || '无法读取视频音轨'))
    })
  })
}

async function withVideoFiles<T>(input: Buffer, task: (inputPath: string, outputPath: string) => Promise<T>) {
  const directory = await mkdtemp(path.join(tmpdir(), 'nori-canvas-video-'))
  const inputPath = path.join(directory, 'input.mp4')
  const outputPath = path.join(directory, 'output.mp4')
  try {
    await writeFile(inputPath, input)
    const value = await task(inputPath, outputPath)
    return { value, output: await readFile(outputPath) }
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined)
  }
}

export type CanvasPlaylistRenderInput = {
  body: Buffer
  trimStartMs: number
  trimEndMs: number
}

/** Normalize every clip, fill missing audio with silence, then concatenate losslessly. */
export async function renderCanvasPlaylistVideo(
  clips: CanvasPlaylistRenderInput[],
  hooks?: CanvasVideoOperationHooks,
): Promise<CanvasVideoResult> {
  if (!clips.length) throw new Error('播放列表为空')
  const directory = await mkdtemp(path.join(tmpdir(), 'nori-canvas-playlist-'))
  const ffmpeg = process.env.FFMPEG_PATH?.trim() || 'ffmpeg'
  const normalizedPaths: string[] = []
  const totalSeconds = clips.reduce((sum, clip) => sum + Math.max(0, clip.trimEndMs - clip.trimStartMs) / 1_000, 0)
  try {
    for (let index = 0; index < clips.length; index += 1) {
      await hooks?.assertActive?.()
      const clip = clips[index]
      const durationSeconds = Math.max(0.034, (clip.trimEndMs - clip.trimStartMs) / 1_000)
      const inputPath = path.join(directory, `source-${index}.mp4`)
      const outputPath = path.join(directory, `clip-${String(index).padStart(4, '0')}.mp4`)
      await writeFile(inputPath, clip.body)
      const hasAudio = await fileHasAudio(inputPath)
      const baseArgs = [
        '-hide_banner', '-loglevel', 'error', '-y',
        '-ss', (clip.trimStartMs / 1_000).toFixed(3), '-t', durationSeconds.toFixed(3), '-i', inputPath,
      ]
      if (!hasAudio) baseArgs.push('-f', 'lavfi', '-t', durationSeconds.toFixed(3), '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000')
      baseArgs.push(
        '-map', '0:v:0', '-map', hasAudio ? '0:a:0' : '1:a:0',
        '-vf', 'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black,fps=30,format=yuv420p',
        '-c:v', 'libx264', '-preset', 'medium', '-crf', '18',
        '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
        '-shortest', '-movflags', '+faststart',
        '-progress', 'pipe:2', '-nostats', outputPath,
      )
      await run(ffmpeg, baseArgs, {
        durationSeconds,
        hooks: {
          assertActive: hooks?.assertActive,
          onProgress: hooks?.onProgress
            ? async (ratio) => await hooks.onProgress?.((index + ratio) / clips.length * 0.9)
            : undefined,
        },
      })
      normalizedPaths.push(outputPath)
    }

    const concatPath = path.join(directory, 'concat.txt')
    const outputPath = path.join(directory, 'output.mp4')
    await writeFile(concatPath, normalizedPaths.map((entry) => `file '${entry}'`).join('\n'))
    await run(ffmpeg, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'concat', '-safe', '0', '-i', concatPath,
      '-c', 'copy', '-movflags', '+faststart',
      '-progress', 'pipe:2', '-nostats', outputPath,
    ], {
      durationSeconds: totalSeconds,
      hooks: {
        assertActive: hooks?.assertActive,
        onProgress: hooks?.onProgress ? async (ratio) => await hooks.onProgress?.(0.9 + ratio * 0.1) : undefined,
      },
    })
    const [info, body] = await Promise.all([probeFile(outputPath), readFile(outputPath)])
    await hooks?.onProgress?.(1)
    return { ...info, body }
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined)
  }
}

export async function eraseCanvasVideoRegion(
  input: Buffer,
  regionInput: CanvasVideoRegion,
  mode: 'subtitle' | 'text' = 'subtitle',
  hooks?: CanvasVideoOperationHooks,
): Promise<CanvasVideoResult> {
  const region = normalizeCanvasVideoRegion(regionInput, mode)
  const ffmpeg = process.env.FFMPEG_PATH?.trim() || 'ffmpeg'
  const processed = await withVideoFiles(input, async (inputPath, outputPath) => {
    const source = await probeFile(inputPath)
    const x = Math.min(source.width - 2, even(source.width * region.x))
    const y = Math.min(source.height - 2, even(source.height * region.y))
    const width = Math.max(2, Math.min(source.width - x, even(source.width * region.width)))
    const height = Math.max(2, Math.min(source.height - y, even(source.height * region.height)))
    await run(ffmpeg, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-i', inputPath,
      '-vf', `delogo=x=${x}:y=${y}:w=${width}:h=${height}:show=0`,
      '-map', '0:v:0', '-map', '0:a?',
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '192k',
      '-movflags', '+faststart',
      '-progress', 'pipe:2', '-nostats',
      outputPath,
    ], { durationSeconds: source.duration, hooks })
    return await probeFile(outputPath)
  })
  return { ...processed.value, body: processed.output }
}

export async function enhanceCanvasVideo(
  input: Buffer,
  options: { target: '2x' | '720p' | '1080p' | '2k' | '4k'; interpolate?: boolean },
  hooks?: CanvasVideoOperationHooks,
): Promise<CanvasVideoResult> {
  const ffmpeg = process.env.FFMPEG_PATH?.trim() || 'ffmpeg'
  const processed = await withVideoFiles(input, async (inputPath, outputPath) => {
    const source = await probeFile(inputPath)
    const targetHeights = { '720p': 720, '1080p': 1080, '2k': 1_440, '4k': 2_160 } as const
    const requestedHeight = options.target === '2x'
      ? source.height * 2
      : targetHeights[options.target]
    const scale = Math.min(
      Math.max(1, requestedHeight / source.height),
      MAX_OUTPUT_EDGE / source.width,
      MAX_OUTPUT_EDGE / source.height,
    )
    if (scale <= 1.001 && !options.interpolate) throw new Error('源视频已达到所选清晰度')
    const width = even(source.width * Math.max(1, scale))
    const height = even(source.height * Math.max(1, scale))
    const filters = [
      `scale=${width}:${height}:flags=lanczos`,
      'unsharp=5:5:0.65:5:5:0.0',
    ]
    if (options.interpolate) {
      filters.push('minterpolate=fps=60:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1')
    }
    await run(ffmpeg, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-i', inputPath,
      '-vf', filters.join(','),
      '-map', '0:v:0', '-map', '0:a?',
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '17', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '192k',
      '-movflags', '+faststart',
      '-progress', 'pipe:2', '-nostats',
      outputPath,
    ], { durationSeconds: source.duration, hooks })
    return await probeFile(outputPath)
  })
  return { ...processed.value, body: processed.output }
}
