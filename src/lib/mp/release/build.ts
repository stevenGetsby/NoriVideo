import { createHash, randomBytes } from 'crypto'
import { mkdir, rm } from 'fs/promises'
import os from 'os'
import path from 'path'
import type { Job } from 'bullmq'
import { Prisma } from '@prisma/client'
import sharp from 'sharp'
import { loadStoryForRelease } from '@/lib/interactive/service'
import type { StoryIssue, StoryProgram } from '@/lib/interactive/types'
import { createScopedLogger } from '@/lib/logging/core'
import { prisma } from '@/lib/prisma'
import { redis } from '@/lib/redis'
import { getObjectBuffer, uploadObject } from '@/lib/storage'
import { TaskTerminatedError } from '@/lib/task/errors'
import type { TaskJobData } from '@/lib/task/types'
import { reportTaskProgress } from '@/lib/workers/shared'
import { assertTaskActive, sleep } from '@/lib/workers/utils'
import { readListing } from '../listing'
import { assertNoRawMedia, collectMediaRefs, describePointer, rewriteMediaRefs } from './media-refs'
import { preflightRelease, programForRelease } from './preflight'
import { collectTexts } from './texts'
import { processImage, processVideo, withAigcExif } from './transcode'
import { buildTrailer } from './trailer'
import { MP_PIPELINE_VERSION, type ReleaseManifest, type ReleaseMediaEntry, type ReleaseMediaFiles, type ReleaseMeta } from './types'

const LOCK_KEY = 'mp:build:lock'
const LOCK_TTL_SEC = 900
const LOCK_RENEW_MS = 60_000
const QUEUE_RETRY_MS = 10_000
const QUEUE_TIMEOUT_MS = 30 * 60 * 1000
const FETCH_TIMEOUT_MS = 120_000
const MAX_SOURCE_BYTES = 1024 * 1024 * 1024
const HEARTBEAT_MS = 25_000

const RENEW_LUA = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('expire', KEYS[1], ARGV[2]) else return 0 end"
const RELEASE_LUA = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end"

class ReleaseBuildError extends Error {
  issues?: StoryIssue[]
  constructor(message: string, issues?: StoryIssue[]) {
    super(message)
    this.name = 'ReleaseBuildError'
    this.issues = issues
  }
}

const sha1Hex = (value: string) => createHash('sha1').update(value).digest('hex')
const sha256Hex = (value: string) => createHash('sha256').update(value).digest('hex')
const toJson = (value: unknown) => value as unknown as Prisma.InputJsonValue

function resolvePointer(program: StoryProgram, pointer: string): unknown {
  let current: unknown = program
  for (const segment of pointer.split('/').slice(1)) {
    if (!current || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[segment.replace(/~1/g, '/').replace(/~0/g, '~')]
  }
  return current
}

/** StoryMedia.url inherits its object's kind; every other media field is an image. */
function mediaKindAtPointer(program: StoryProgram, pointer: string): 'video' | 'image' {
  const segments = pointer.split('/').slice(1)
  const field = segments[segments.length - 1]
  if (field !== 'url') return 'image'
  const parent = resolvePointer(program, `/${segments.slice(0, -1).join('/')}`)
  return parent && typeof parent === 'object' && (parent as { kind?: unknown }).kind === 'video' ? 'video' : 'image'
}

async function downloadSource(raw: string, releaseId: string, mediaId: string): Promise<{ key: string; kind: 'video' | 'image' }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const response = await fetch(raw, { signal: controller.signal })
    if (!response.ok) throw new Error(`素材下载失败：HTTP ${response.status}`)
    const declared = Number(response.headers.get('content-length') ?? 0)
    if (declared > MAX_SOURCE_BYTES) throw new Error('素材超过 1GB')
    const chunks: Buffer[] = []
    let total = 0
    const reader = response.body?.getReader()
    if (!reader) throw new Error('素材下载失败：空响应')
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_SOURCE_BYTES) {
        controller.abort()
        throw new Error('素材超过 1GB')
      }
      chunks.push(Buffer.from(value))
    }
    const buffer = Buffer.concat(chunks)
    const contentType = response.headers.get('content-type') ?? ''
    const pathname = new URL(raw).pathname
    const extMatch = /\.([a-z0-9]{1,5})$/i.exec(pathname)
    const extByType: Record<string, string> = { 'video/mp4': 'mp4', 'video/webm': 'webm', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' }
    const ext = extMatch?.[1]?.toLowerCase() ?? extByType[contentType.split(';')[0].trim()] ?? 'bin'
    const kind = contentType.startsWith('video/') || /\.(mp4|mov|webm|m4v|avi|mkv)$/i.test(pathname) ? 'video' : 'image'
    const key = `mp/releases/${releaseId}/src/${mediaId}.${ext}`
    await uploadObject(buffer, key, undefined, contentType || undefined)
    return { key, kind }
  } finally {
    clearTimeout(timer)
  }
}

function firstVideoPosterKey(program: StoryProgram, manifest: ReleaseManifest, idByRaw: Map<string, string>): string | null {
  for (const chapter of program.chapters) {
    for (const node of chapter.nodes) {
      if (node.kind !== 'scene' || node.media?.kind !== 'video' || !node.media.posterUrl) continue
      const entry = manifest.media[idByRaw.get(node.media.posterUrl) ?? '']
      if (entry?.files.img) return entry.files.img
    }
  }
  return null
}

const escapeXml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function placeholderCover(title: string, width: number, height: number): Buffer {
  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#1c2733"/><text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle" font-family="sans-serif" font-size="${Math.round(width / 12)}" fill="#e8eef4">${escapeXml(title.slice(0, 20))}</text></svg>`
  return Buffer.from(svg)
}

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const rn = r / 255; const gn = g / 255; const bn = b / 255
  const max = Math.max(rn, gn, bn); const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  if (max === min) return { h: 0, s: 0, l }
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6
  else if (max === gn) h = ((bn - rn) / d + 2) / 6
  else h = ((rn - gn) / d + 4) / 6
  return { h, s, l }
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) {
    const v = Math.round(l * 255)
    return [v, v, v]
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const hue = (t: number) => {
    let tn = t
    if (tn < 0) tn += 1
    if (tn > 1) tn -= 1
    if (tn < 1 / 6) return p + (q - p) * 6 * tn
    if (tn < 1 / 2) return q
    if (tn < 2 / 3) return p + (q - p) * (2 / 3 - tn) * 6
    return p
  }
  return [Math.round(hue(h + 1 / 3) * 255), Math.round(hue(h) * 255), Math.round(hue(h - 1 / 3) * 255)]
}

async function accentColorOf(coverBuffer: Buffer): Promise<string> {
  const { dominant } = await sharp(coverBuffer).stats()
  const hsl = rgbToHsl(dominant.r, dominant.g, dominant.b)
  const [r, g, b] = hslToRgb(hsl.h, hsl.s, Math.min(0.55, Math.max(0.35, hsl.l)))
  return `#${[r, g, b].map((value) => value.toString(16).padStart(2, '0')).join('')}`
}

async function acquireBuildLock(onWait: () => Promise<void>): Promise<string> {
  const token = randomBytes(16).toString('hex')
  const startedAt = Date.now()
  for (;;) {
    const acquired = await redis.set(LOCK_KEY, token, 'EX', LOCK_TTL_SEC, 'NX')
    if (acquired === 'OK') return token
    if (Date.now() - startedAt > QUEUE_TIMEOUT_MS) throw new ReleaseBuildError('生成排队超时，请稍后重试')
    await onWait()
    await sleep(QUEUE_RETRY_MS)
  }
}

export async function handleStoryReleaseBuildTask(job: Job<TaskJobData>) {
  const payload = (job.data.payload && typeof job.data.payload === 'object' ? job.data.payload : {}) as Record<string, unknown>
  const releaseId = typeof payload.releaseId === 'string' ? payload.releaseId : ''
  if (!releaseId) throw new Error('releaseId is required for story release build task')

  const release = await prisma.storyRelease.findUnique({ where: { id: releaseId } })
  if (!release || release.status !== 'building') return { releaseId, skipped: true }
  const workId = release.workId

  const logger = createScopedLogger({ module: 'mp-release', taskId: job.data.taskId, projectId: job.data.projectId })
  const tmpDir = path.join(os.tmpdir(), 'mp-build', releaseId)
  let lockToken: string | null = null
  let renewTimer: ReturnType<typeof setInterval> | null = null
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null
  let currentProgress = 0

  const report = async (progress: number, stage: string, message: string) => {
    currentProgress = progress
    await reportTaskProgress(job, progress, { stage, message })
  }

  try {
    lockToken = await acquireBuildLock(async () => {
      await reportTaskProgress(job, 0, { stage: 'mp_release_queued', message: '排队中，等待其他版本生成完成' })
      await assertTaskActive(job, 'mp_release_queued')
    })
    const token = lockToken
    renewTimer = setInterval(() => {
      void redis.eval(RENEW_LUA, 1, LOCK_KEY, token, String(LOCK_TTL_SEC)).catch(() => undefined)
    }, LOCK_RENEW_MS)
    heartbeatTimer = setInterval(() => {
      void reportTaskProgress(job, currentProgress, { stage: 'mp_release_media', message: '素材处理中' }).catch(() => undefined)
    }, HEARTBEAT_MS)
    await mkdir(tmpDir, { recursive: true })

    await report(2, 'mp_release_load', '读取作品内容')
    await assertTaskActive(job, 'mp_release_load')
    const data = await loadStoryForRelease(workId)
    const program = programForRelease(data)

    const preflight = await preflightRelease(workId, releaseId)
    if (preflight.errors > 0) throw new ReleaseBuildError('发布前检查未通过', preflight.issues)
    const issues: StoryIssue[] = preflight.issues.filter((item) => item.level === 'warning')

    const refs = collectMediaRefs(program)
    const pointersByRaw = new Map<string, string[]>()
    const uniqueRefs: { raw: string; key: string; pointer: string }[] = []
    for (const ref of refs) {
      const pointers = pointersByRaw.get(ref.raw)
      if (pointers) pointers.push(ref.pointer)
      else {
        pointersByRaw.set(ref.raw, [ref.pointer])
        uniqueRefs.push(ref)
      }
    }
    const idByRaw = new Map<string, string>()
    for (const ref of uniqueRefs) idByRaw.set(ref.raw, sha1Hex(ref.key || ref.raw).slice(0, 16))

    const prior = await prisma.storyRelease.findMany({
      where: { workId, pipelineVersion: MP_PIPELINE_VERSION, manifest: { not: Prisma.DbNull } },
      select: { manifest: true },
    })
    const reusableBySource = new Map<string, ReleaseMediaEntry>()
    const reusableById = new Map<string, ReleaseMediaEntry>()
    for (const row of prior) {
      const manifest = row.manifest as unknown as ReleaseManifest | null
      for (const entry of Object.values(manifest?.media ?? {})) {
        if (entry.source) reusableBySource.set(entry.source, entry)
        reusableById.set(entry.id, entry)
      }
    }

    const manifest: ReleaseManifest = { pipelineVersion: MP_PIPELINE_VERSION, media: {} }
    const pending = uniqueRefs.filter((ref) => {
      const mediaId = idByRaw.get(ref.raw)!
      const reused = ref.key ? reusableBySource.get(ref.key) : reusableById.get(mediaId)
      if (reused) {
        manifest.media[mediaId] = { ...reused, id: mediaId, refs: pointersByRaw.get(ref.raw)! }
        return false
      }
      return true
    })

    for (const [index, ref] of pending.entries()) {
      await report(Math.round(5 + (80 * index) / Math.max(pending.length, 1)), 'mp_release_media', `处理素材 ${index + 1}/${pending.length}`)
      await assertTaskActive(job, 'mp_release_media')
      const mediaId = idByRaw.get(ref.raw)!
      try {
        let key = ref.key
        let kind = mediaKindAtPointer(program, ref.pointer)
        if (!key) {
          const downloaded = await downloadSource(ref.raw, releaseId, mediaId)
          key = downloaded.key
          kind = downloaded.kind
        }
        const processed: { files: ReleaseMediaFiles; w: number; h: number; bytes: number; durationSec?: number; hasAudio?: boolean } = kind === 'video'
          ? await processVideo(key, { releaseId, mediaId, tmpDir })
          : await processImage(key, { releaseId, mediaId })
        manifest.media[mediaId] = {
          id: mediaId,
          kind,
          source: key,
          w: processed.w,
          h: processed.h,
          ...(processed.durationSec !== undefined ? { durationSec: processed.durationSec } : {}),
          ...(processed.hasAudio !== undefined ? { hasAudio: processed.hasAudio } : {}),
          bytes: processed.bytes,
          files: processed.files,
          refs: pointersByRaw.get(ref.raw)!,
        }
      } catch (error) {
        logger.error({ action: 'mp.release.media_failed', message: `素材处理失败：${ref.pointer}`, error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : undefined })
        throw new ReleaseBuildError(`素材处理失败：${describePointer(program, ref.pointer)}`)
      }
    }

    await report(86, 'mp_release_listing', '生成上架素材')
    await assertTaskActive(job, 'mp_release_listing')
    const listing = await readListing(workId)
    if (!listing) throw new ReleaseBuildError('上架信息不存在，请先保存上架信息')
    const coverSourceKey = listing.coverKey ?? firstVideoPosterKey(program, manifest, idByRaw)
      ?? Object.values(manifest.media).find((entry) => entry.kind === 'image')?.files.img
      ?? null
    const coverInput = coverSourceKey ? await getObjectBuffer(coverSourceKey) : placeholderCover(listing.title, 720, 960)
    const coverBuffer = await sharp(coverInput).resize(720, 960, { fit: 'cover', position: 'attention' }).jpeg({ quality: 85 }).toBuffer()
    const coverKey = `mp/releases/${releaseId}/cover.jpg`
    await uploadObject(await withAigcExif(coverBuffer), coverKey, undefined, 'image/jpeg')

    const shareSourceKey = listing.shareCoverKey ?? coverSourceKey
    const shareInput = shareSourceKey ? await getObjectBuffer(shareSourceKey) : placeholderCover(listing.title, 1000, 800)
    const shareBase = await sharp(shareInput).resize(1000, 800, { fit: 'cover' }).jpeg({ quality: 85 }).toBuffer()
    const shareMark = Buffer.from('<svg width="1000" height="800" xmlns="http://www.w3.org/2000/svg"><text x="980" y="780" text-anchor="end" font-family="sans-serif" font-size="20" fill="#ffffff" fill-opacity="0.7">AI 生成</text></svg>')
    const shareBuffer = await sharp(shareBase).composite([{ input: shareMark, top: 0, left: 0 }]).jpeg({ quality: 85 }).toBuffer()
    const shareCoverKey = `mp/releases/${releaseId}/share.jpg`
    await uploadObject(await withAigcExif(shareBuffer), shareCoverKey, undefined, 'image/jpeg')
    const accentColor = await accentColorOf(coverBuffer)

    let trailer: string | null = null
    let trailerPoster: string | null = null
    if (listing.trailerEnabled) {
      try {
        const result = await buildTrailer(program, manifest, { releaseId, tmpDir, aspectRatio: data.story.aspectRatio, idByRaw })
        trailer = result?.trailer ?? null
        trailerPoster = result?.trailerPoster ?? null
      } catch (error) {
        logger.warn({ action: 'mp.release.trailer_failed', message: '预告片生成失败，已跳过', error: error instanceof Error ? { name: error.name, message: error.message } : undefined })
        issues.push({ level: 'warning', code: 'mp_trailer', message: '预告片生成失败，已跳过', projectId: null, nodeId: null })
      }
    }

    const rewritten = rewriteMediaRefs(program, idByRaw)
    const violations = assertNoRawMedia(rewritten)
    if (violations.length) throw new ReleaseBuildError(`存在未处理的素材：${describePointer(program, violations[0])}`)

    const orderByProject = new Map(data.story.config.chapters.map((chapter) => [chapter.projectId, chapter.order]))
    const chapterDuration = new Map<string, number>()
    let segmentCount = 0
    const endings: ReleaseMeta['endings'] = []
    for (const chapter of data.chapters) {
      let durationSec = 0
      for (const node of chapter.graph.nodes) {
        if (node.kind === 'scene') {
          segmentCount += 1
          if (node.media?.kind === 'video' && node.media.url) {
            durationSec += manifest.media[idByRaw.get(node.media.url) ?? '']?.durationSec ?? 0
          }
        }
        if (node.kind === 'ending') {
          endings.push({ projectId: chapter.projectId, nodeId: node.id, title: node.title, endingType: node.endingType, chapterOrder: orderByProject.get(chapter.projectId) ?? 0 })
        }
      }
      chapterDuration.set(chapter.projectId, durationSec)
    }
    const meta: ReleaseMeta = {
      title: listing.title,
      tagline: listing.tagline,
      synopsis: listing.synopsis,
      tags: listing.tags,
      creatorName: listing.creatorName,
      accentColor,
      cover: coverKey,
      shareCover: shareCoverKey,
      trailer,
      trailerPoster,
      chapters: data.chapters
        .map((chapter, index) => ({ projectId: chapter.projectId, order: orderByProject.get(chapter.projectId) ?? index, title: chapter.name, durationSec: Math.round(chapterDuration.get(chapter.projectId) ?? 0) }))
        .sort((a, b) => a.order - b.order),
      endings,
      achievements: (rewritten.achievements ?? []).map((achievement) => ({ id: achievement.id, name: achievement.name, description: achievement.description, icon: achievement.icon })),
      segmentCount,
      texts: collectTexts(program),
    }

    await report(92, 'mp_release_program', '写入版本文件')
    await assertTaskActive(job, 'mp_release_program')
    const body = JSON.stringify({ v: 1, releaseId, aspectRatio: data.story.aspectRatio, program: rewritten })
    const programHash = sha256Hex(body)
    const programKey = `mp/releases/${releaseId}/program.json`
    await uploadObject(Buffer.from(body), programKey, undefined, 'application/json')

    const totalDurationSec = Math.round(Object.values(manifest.media).reduce((sum, entry) => sum + (entry.kind === 'video' ? entry.durationSec ?? 0 : 0), 0))
    const sizeBytes = Object.values(manifest.media).reduce((sum, entry) => sum + entry.bytes, 0) + Buffer.byteLength(body)
    await prisma.storyRelease.update({
      where: { id: releaseId },
      data: {
        status: 'reviewing',
        progress: 100,
        program: toJson(rewritten),
        manifest: toJson(manifest),
        meta: toJson(meta),
        issues: toJson(issues),
        failure: null,
        chapterCount: data.chapters.length,
        endingCount: endings.length,
        totalDurationSec,
        sizeBytes: BigInt(sizeBytes),
        programKey,
        programHash,
      },
    })
    logger.info({ action: 'mp.release.built', message: '版本生成完成', details: { releaseId, mediaCount: Object.keys(manifest.media).length, sizeBytes } })
    return { releaseId, status: 'reviewing' }
  } catch (error) {
    const failure = error instanceof ReleaseBuildError
      ? error.message
      : error instanceof TaskTerminatedError
        ? '生成已取消'
        : '版本生成失败，请稍后重试'
    logger.error({ action: 'mp.release.build_failed', message: failure, details: { releaseId }, error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : undefined })
    await prisma.storyRelease.update({
      where: { id: releaseId },
      data: {
        status: 'build_failed',
        failure: failure.slice(0, 500),
        ...(error instanceof ReleaseBuildError && error.issues ? { issues: toJson(error.issues) } : {}),
      },
    }).catch(() => undefined)
    throw error
  } finally {
    if (renewTimer) clearInterval(renewTimer)
    if (heartbeatTimer) clearInterval(heartbeatTimer)
    if (lockToken) await redis.eval(RELEASE_LUA, 1, LOCK_KEY, lockToken).catch(() => undefined)
    await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined)
  }
}
