import { readFile } from 'fs/promises'
import path from 'path'
import { advanceRun, startRun } from '@/lib/interactive/engine'
import type { StoryProgram } from '@/lib/interactive/types'
import { uploadObject } from '@/lib/storage'
import { AIGC_DESCRIPTION, runFfmpeg, signedSourceUrl, withAigcExif } from './transcode'
import type { ReleaseManifest } from './types'

export interface TrailerOptions {
  releaseId: string
  tmpDir: string
  aspectRatio: string
  idByRaw: Map<string, string>
}

interface TrailerClip { key: string; durationSec: number; hasAudio: boolean }

const TRAILER_SEC = 15
const MAX_STEPS = 12

function collectOpeningClips(program: StoryProgram, manifest: ReleaseManifest, idByRaw: Map<string, string>): TrailerClip[] {
  const clips: TrailerClip[] = []
  let total = 0
  let run = startRun(program, { mode: 'story' })
  for (let step = 0; step < MAX_STEPS; step += 1) {
    const stop = run.stop
    if (stop.kind === 'scene') {
      const media = stop.node.media
      if (media?.kind === 'video' && media.url) {
        const entry = manifest.media[idByRaw.get(media.url) ?? '']
        if (entry?.files.v720) {
          const durationSec = entry.durationSec ?? 0
          clips.push({ key: entry.files.v720, durationSec, hasAudio: entry.hasAudio === true })
          total += durationSec
          if (total >= TRAILER_SEC) break
        }
      }
      run = advanceRun(program, run)
    } else if (stop.kind === 'choice') {
      const first = stop.node.options[0]
      if (!first) break
      run = advanceRun(program, run, first.id)
    } else {
      break
    }
  }
  return clips
}

/** Up to 15s of the opening path, re-encoded with a 1s fade-out; null when under 3s of video. */
export async function buildTrailer(
  program: StoryProgram,
  manifest: ReleaseManifest,
  options: TrailerOptions,
): Promise<{ trailer: string; trailerPoster: string } | null> {
  const clips = collectOpeningClips(program, manifest, options.idByRaw)
  const total = clips.reduce((sum, clip) => sum + clip.durationSec, 0)
  if (total < 3) return null

  const landscape = options.aspectRatio === '16:9'
  const width = landscape ? 1280 : 720
  const height = landscape ? 720 : 1280
  const fadeStart = Math.max(0, Math.min(TRAILER_SEC, total) - 1)

  const inputs: string[] = []
  const filters: string[] = []
  const concatPairs: string[] = []
  let inputCount = 0
  for (const [index, clip] of clips.entries()) {
    const videoIndex = inputCount
    inputCount += 1
    inputs.push('-i', await signedSourceUrl(clip.key))
    let audioIndex = videoIndex
    if (!clip.hasAudio) {
      audioIndex = inputCount
      inputCount += 1
      inputs.push('-f', 'lavfi', '-t', String(Math.max(clip.durationSec, 1)), '-i', 'anullsrc=r=44100:cl=stereo')
    }
    filters.push(`[${videoIndex}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p[v${index}]`)
    filters.push(`[${audioIndex}:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo[a${index}]`)
    concatPairs.push(`[v${index}][a${index}]`)
  }
  filters.push(`${concatPairs.join('')}concat=n=${clips.length}:v=1:a=1[vc][ac]`)
  filters.push(`[vc]fade=t=out:st=${fadeStart}:d=1[vout]`)
  filters.push(`[ac]afade=t=out:st=${fadeStart}:d=1[aout]`)

  const trailerPath = path.join(options.tmpDir, 'trailer.mp4')
  const posterPath = path.join(options.tmpDir, 'trailer_poster.jpg')
  await runFfmpeg([
    ...inputs,
    '-filter_complex', filters.join(';'),
    '-map', '[vout]', '-map', '[aout]',
    '-t', String(TRAILER_SEC),
    '-c:v', 'libx264', '-preset', 'veryfast', '-profile:v', 'high', '-level', '4.0', '-pix_fmt', 'yuv420p',
    '-crf', '23', '-maxrate', '2500k', '-bufsize', '5000k',
    '-c:a', 'aac', '-b:a', '128k', '-ac', '2', '-ar', '44100',
    '-movflags', '+faststart',
    '-metadata', 'comment=AIGC',
    '-metadata', `description=${AIGC_DESCRIPTION}`,
    '-threads', '2',
    '-y', trailerPath,
  ])
  await runFfmpeg(['-ss', '0', '-i', trailerPath, '-frames:v', '1', '-q:v', '3', '-y', posterPath])

  const trailerKey = `mp/releases/${options.releaseId}/trailer.mp4`
  const posterKey = `mp/releases/${options.releaseId}/trailer_poster.jpg`
  await uploadObject(await readFile(trailerPath), trailerKey, undefined, 'video/mp4')
  await uploadObject(await withAigcExif(await readFile(posterPath)), posterKey, undefined, 'image/jpeg')
  return { trailer: trailerKey, trailerPoster: posterKey }
}
