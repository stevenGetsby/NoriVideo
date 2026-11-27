import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import path from 'node:path'
import sharp from 'sharp'
import * as storage from '@/lib/storage'

export const VIDEO_POSTER_WIDTHS = [480, 960] as const
export type VideoPosterWidth = typeof VIDEO_POSTER_WIDTHS[number]

const MAX_RESOLVED_CACHE = 20_000
const inFlight = new Map<string, Promise<string>>()
const resolvedCache = new Map<string, string>()
const failed = new Map<string, number>()
const FAILED_TTL_MS = 10 * 60_000
let activeFrames = 0
const queue: Array<() => void> = []

function readResolvedCache(cacheKey: string): string | undefined {
  const cached = resolvedCache.get(cacheKey)
  if (cached === undefined) return undefined
  resolvedCache.delete(cacheKey)
  resolvedCache.set(cacheKey, cached)
  return cached
}

function writeResolvedCache(cacheKey: string, value: string): void {
  resolvedCache.delete(cacheKey)
  resolvedCache.set(cacheKey, value)
  if (resolvedCache.size > MAX_RESOLVED_CACHE) {
    const oldest = resolvedCache.keys().next().value
    if (oldest !== undefined) resolvedCache.delete(oldest)
  }
}

async function posterExists(posterKey: string): Promise<boolean> {
  if (typeof storage.objectExists === 'function') {
    return await storage.objectExists(posterKey)
  }
  await storage.getObjectBuffer(posterKey)
  return true
}

export function normalizeVideoPosterWidth(value: string | null): VideoPosterWidth {
  return Number(value) === 960 ? 960 : 480
}

export function videoPosterKey(key: string, width: VideoPosterWidth): string {
  const digest = createHash('sha256').update(key).digest('hex')
  return `images/posters/${digest.slice(0, 2)}/${digest.slice(2)}/w${width}.webp`
}

async function withFrameSlot<T>(work: () => Promise<T>): Promise<T> {
  if (activeFrames >= 2) await new Promise<void>((resolve) => queue.push(resolve))
  activeFrames += 1
  try {
    return await work()
  } finally {
    activeFrames -= 1
    queue.shift()?.()
  }
}

function extractFrame(sourceUrl: string, width: VideoPosterWidth, offset: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.FFMPEG_PATH?.trim() || 'ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-ss', String(offset), '-i', sourceUrl,
      '-frames:v', '1', '-vf', `scale=${width}:-2`, '-f', 'image2pipe', '-vcodec', 'png', 'pipe:1',
    ], { stdio: ['ignore', 'pipe', 'pipe'] })
    const chunks: Buffer[] = []
    let stderr = ''
    let settled = false
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      const body = Buffer.concat(chunks)
      if (error) reject(error)
      else if (body.length) resolve(body)
      else reject(new Error(stderr.trim() || '视频没有可提取的封面帧。'))
    }
    const timer = setTimeout(() => {
      if (child.exitCode === null) child.kill('SIGKILL')
      finish(new Error('视频封面生成超时。'))
    }, 20_000)
    timer.unref()
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => { stderr = `${stderr}${chunk.toString('utf8')}`.slice(-8_000) })
    child.once('error', (error) => finish(error))
    child.once('close', (code) => finish(code === 0 && chunks.length ? undefined : new Error('视频封面帧提取失败。')))
  })
}

function localSourcePath(key: string): string {
  const root = path.resolve(process.cwd(), process.env.UPLOAD_DIR || './data/uploads')
  const resolved = path.resolve(root, key)
  if (resolved !== root && !resolved.startsWith(root + path.sep)) throw new Error('视频源文件不存在。')
  return resolved
}

async function createVideoPoster(key: string, width: VideoPosterWidth): Promise<string> {
  const posterKey = videoPosterKey(key, width)
  try {
    if (await posterExists(posterKey)) return posterKey
  } catch {
    // A missing derivative is expected; generate it below.
  }
  const sourceUrl = storage.getStorageProvider().kind === 'local'
    ? localSourcePath(key)
    : await storage.getSignedObjectUrl(key, 600)
  const png = await withFrameSlot(async () => {
    try {
      return await extractFrame(sourceUrl, width, 0.5)
    } catch (error) {
      if (error instanceof Error && error.message === '视频封面生成超时。') throw error
      return await extractFrame(sourceUrl, width, 0)
    }
  })
  const body = await sharp(png).webp({ quality: 80 }).toBuffer()
  return await storage.uploadObject(body, posterKey, 1, 'image/webp')
}

export function ensureVideoPoster(key: string, width: VideoPosterWidth): Promise<string> {
  const cacheKey = `${key}\0${width}`
  const cached = readResolvedCache(cacheKey)
  if (cached) return Promise.resolve(cached)
  if ((failed.get(cacheKey) || 0) > Date.now()) return Promise.reject(new Error('视频封面暂时无法生成。'))
  const existing = inFlight.get(cacheKey)
  if (existing) return existing
  const pending = createVideoPoster(key, width).then((resolvedKey) => {
    writeResolvedCache(cacheKey, resolvedKey)
    return resolvedKey
  }).catch((error: unknown) => {
    const now = Date.now()
    for (const [entry, expiry] of failed) if (expiry <= now) failed.delete(entry)
    failed.set(cacheKey, now + FAILED_TTL_MS)
    throw error
  }).finally(() => inFlight.delete(cacheKey))
  inFlight.set(cacheKey, pending)
  return pending
}
