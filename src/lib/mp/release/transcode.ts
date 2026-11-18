import { spawn } from 'child_process'
import { mkdir, readFile } from 'fs/promises'
import path from 'path'
import sharp from 'sharp'
import { getObjectBuffer, getSignedObjectUrl, uploadObject } from '@/lib/storage'
import type { ReleaseMediaFiles } from './types'

const PROCESS_TIMEOUT_MS = 10 * 60 * 1000
export const AIGC_DESCRIPTION = 'AI 生成内容 · 万一'
const AIGC_EXIF = { IFD0: { ImageDescription: 'AIGC; lanmiaoai' } }

const ffmpegBin = () => process.env.FFMPEG_PATH?.trim() || 'ffmpeg'
const ffprobeBin = () => process.env.FFPROBE_PATH?.trim() || 'ffprobe'

function spawnLowPriority(bin: string, args: string[], captureStdout: boolean): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('nice', ['-n', '10', bin, ...args], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`${bin} timed out after ${PROCESS_TIMEOUT_MS}ms`))
    }, PROCESS_TIMEOUT_MS)
    child.stdout?.on('data', (chunk: Buffer) => { if (captureStdout) stdout += chunk.toString() })
    child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
    child.on('error', (error) => { clearTimeout(timer); reject(error) })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve(stdout)
      else reject(new Error(`${bin} exited with ${code}: ${stderr.slice(-800)}`))
    })
  })
}

export async function runFfmpeg(args: string[]): Promise<void> {
  await spawnLowPriority(ffmpegBin(), args, false)
}

export async function runFfprobeJson(args: string[]): Promise<unknown> {
  const stdout = await spawnLowPriority(ffprobeBin(), args, true)
  return JSON.parse(stdout)
}

export async function signedSourceUrl(key: string): Promise<string> {
  return getSignedObjectUrl(key, 3600)
}

export async function withAigcExif(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer).withMetadata({ exif: AIGC_EXIF }).toBuffer()
}

export interface ProbeResult { w: number; h: number; durationSec: number; hasAudio: boolean }

interface ProbeStream {
  codec_type?: string
  width?: number
  height?: number
  tags?: { rotate?: string }
  side_data_list?: { rotation?: number }[]
}

export async function probeVideo(key: string): Promise<ProbeResult> {
  const url = await signedSourceUrl(key)
  const raw = await runFfprobeJson(['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', url]) as {
    streams?: ProbeStream[]
    format?: { duration?: string }
  }
  const streams = raw.streams ?? []
  const video = streams.find((stream) => stream.codec_type === 'video')
  if (!video?.width || !video.height) throw new Error('源文件没有视频流')
  const rotation = Number(video.tags?.rotate ?? video.side_data_list?.find((side) => typeof side.rotation === 'number')?.rotation ?? 0)
  const sideways = Math.abs(rotation) === 90 || Math.abs(rotation) === 270
  const durationSec = Number(raw.format?.duration ?? 0)
  return {
    w: sideways ? video.height : video.width,
    h: sideways ? video.width : video.height,
    durationSec: Number.isFinite(durationSec) ? durationSec : 0,
    hasAudio: streams.some((stream) => stream.codec_type === 'audio'),
  }
}

const scaleFilter = (cap: number) => `scale='if(lt(iw,ih),min(${cap},iw),-2)':'if(lt(iw,ih),-2,min(${cap},ih))'`

function transcodeArgs(cap: number, crf: number, maxrate: string, bufsize: string, audioBitrate: string, input: string, output: string): string[] {
  return [
    '-i', input,
    '-map', '0:v:0', '-map', '0:a:0?',
    '-c:v', 'libx264', '-preset', 'veryfast', '-profile:v', 'high', '-level', '4.0', '-pix_fmt', 'yuv420p',
    '-crf', String(crf), '-maxrate', maxrate, '-bufsize', bufsize,
    '-vf', scaleFilter(cap),
    '-force_key_frames', 'expr:gte(t,n_forced*2)',
    '-c:a', 'aac', '-b:a', audioBitrate, '-ac', '2', '-ar', '44100',
    '-movflags', '+faststart',
    '-metadata', 'comment=AIGC',
    '-metadata', `description=${AIGC_DESCRIPTION}`,
    '-threads', '2',
    '-y', output,
  ]
}

export interface ProcessVideoOptions { releaseId: string; mediaId: string; tmpDir: string }
export interface ProcessedVideo { files: ReleaseMediaFiles; w: number; h: number; durationSec: number; hasAudio: boolean; bytes: number }

export async function processVideo(key: string, options: ProcessVideoOptions): Promise<ProcessedVideo> {
  const { releaseId, mediaId, tmpDir } = options
  const probe = await probeVideo(key)
  const url = await signedSourceUrl(key)
  const dir = path.join(tmpDir, mediaId)
  await mkdir(dir, { recursive: true })
  const out = (name: string) => path.join(dir, name)
  const prefix = `mp/releases/${releaseId}/m/${mediaId}`
  const files: ReleaseMediaFiles = {}
  let bytes = 0

  const upload = async (name: string, contentType: string, buffer: Buffer) => {
    const storageKey = `${prefix}/${name}`
    await uploadObject(buffer, storageKey, undefined, contentType)
    bytes += buffer.length
    return storageKey
  }

  await runFfmpeg(transcodeArgs(720, 23, '2500k', '5000k', '128k', url, out('720.mp4')))
  files.v720 = await upload('720.mp4', 'video/mp4', await readFile(out('720.mp4')))
  await runFfmpeg(transcodeArgs(480, 26, '1000k', '2000k', '96k', url, out('480.mp4')))
  files.v480 = await upload('480.mp4', 'video/mp4', await readFile(out('480.mp4')))

  const frameArgs = (seek: string[]) => [...seek, '-i', url, '-frames:v', '1', '-vf', scaleFilter(720), '-q:v', '3']
  await runFfmpeg([...frameArgs(['-ss', String(Math.min(0.5, probe.durationSec / 2))]), '-y', out('poster.jpg')])
  files.poster = await upload('poster.jpg', 'image/jpeg', await withAigcExif(await readFile(out('poster.jpg'))))

  try {
    await runFfmpeg([...frameArgs(['-sseof', '-0.15']), '-y', out('last.jpg')])
  } catch {
    await runFfmpeg([...frameArgs(['-ss', String(Math.max(0, probe.durationSec - 0.2))]), '-y', out('last.jpg')])
  }
  files.last = await upload('last.jpg', 'image/jpeg', await withAigcExif(await readFile(out('last.jpg'))))

  await runFfmpeg(['-i', url, '-vf', `fps=16/${Math.max(probe.durationSec, 16)},scale=240:-2,tile=4x4`, '-frames:v', '1', '-q:v', '5', '-y', out('sheet.jpg')])
  files.sheet = await upload('sheet.jpg', 'image/jpeg', await withAigcExif(await readFile(out('sheet.jpg'))))

  return { files, w: probe.w, h: probe.h, durationSec: probe.durationSec, hasAudio: probe.hasAudio, bytes }
}

export interface ProcessImageOptions { releaseId: string; mediaId: string }
export interface ProcessedImage { files: ReleaseMediaFiles; w: number; h: number; bytes: number }

export async function processImage(key: string, options: ProcessImageOptions): Promise<ProcessedImage> {
  const source = await getObjectBuffer(key)
  const hasAlpha = (await sharp(source).metadata()).hasAlpha === true
  const pipeline = sharp(source).rotate().resize({ width: 1440, height: 1440, fit: 'inside', withoutEnlargement: true }).withMetadata({ exif: AIGC_EXIF })
  const { data, info } = await (hasAlpha ? pipeline.png({ compressionLevel: 9 }) : pipeline.jpeg({ quality: 82, mozjpeg: true })).toBuffer({ resolveWithObject: true })
  const name = hasAlpha ? 'img.png' : 'img.jpg'
  const storageKey = `mp/releases/${options.releaseId}/m/${options.mediaId}/${name}`
  await uploadObject(data, storageKey, undefined, hasAlpha ? 'image/png' : 'image/jpeg')
  return { files: { img: storageKey }, w: info.width, h: info.height, bytes: data.length }
}
