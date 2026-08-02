import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const EXTRACTION_TIMEOUT_MS = 60_000
const MAX_ERROR_LENGTH = 8_000

/**
 * Extract a clean, provider-friendly mono MP3 track from a generated video.
 * Keeping this server-side avoids browser codec and storage CORS differences.
 */
export async function extractVoiceAudioFromVideo(video: Buffer): Promise<Buffer> {
  if (video.length === 0) throw new Error('试镜视频内容为空，无法提取音轨。')

  const directory = await mkdtemp(path.join(tmpdir(), 'nori-character-audition-'))
  const inputPath = path.join(directory, 'audition.mp4')
  const outputPath = path.join(directory, 'voice.mp3')
  const ffmpeg = process.env.FFMPEG_PATH?.trim() || 'ffmpeg'

  try {
    await writeFile(inputPath, video)
    await new Promise<void>((resolve, reject) => {
      const child = spawn(ffmpeg, [
        '-hide_banner', '-loglevel', 'error', '-y',
        '-i', inputPath,
        '-map', '0:a:0',
        '-vn',
        '-ac', '1',
        '-ar', '48000',
        '-c:a', 'libmp3lame',
        '-b:a', '192k',
        outputPath,
      ], { stdio: ['ignore', 'ignore', 'pipe'] })
      let stderr = ''
      let settled = false
      const finish = (error?: Error) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (error) reject(error)
        else resolve()
      }
      const timer = setTimeout(() => {
        if (child.exitCode === null) child.kill('SIGKILL')
        finish(new Error('试镜视频音轨提取超时。'))
      }, EXTRACTION_TIMEOUT_MS)

      child.stderr.on('data', (chunk: Buffer) => {
        stderr = `${stderr}${chunk.toString('utf8')}`.slice(-MAX_ERROR_LENGTH)
      })
      child.once('error', (error) => finish(error))
      child.once('close', (code) => {
        if (code === 0) finish()
        else finish(new Error(stderr.trim() || '试镜视频没有可提取的声音轨道。'))
      })
    })

    const audio = await readFile(outputPath)
    if (audio.length < 1_024) throw new Error('试镜视频没有可提取的声音轨道。')
    return audio
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined)
  }
}
