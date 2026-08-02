import { probeMediaDurationSeconds } from '@/lib/media/duration-probe'
import { generateUniqueKey, toFetchableUrl, uploadObject } from '@/lib/storage'

const MAX_AUDIO_BYTES = 200 * 1024 * 1024

function audioExtension(contentType: string) {
  const normalized = contentType.toLowerCase()
  if (normalized.includes('mpeg') || normalized.includes('mp3')) return 'mp3'
  if (normalized.includes('ogg')) return 'ogg'
  if (normalized.includes('webm')) return 'webm'
  if (normalized.includes('mp4') || normalized.includes('m4a')) return 'm4a'
  if (normalized.includes('flac')) return 'flac'
  return 'wav'
}

export async function persistGeneratedAudio(params: {
  source: string
  projectId: string
  downloadHeaders?: Record<string, string>
}) {
  let contentType = 'audio/wav'
  let body: Buffer
  if (params.source.startsWith('data:')) {
    const match = params.source.match(/^data:([^;,]+)?(;base64)?,([\s\S]*)$/)
    if (!match) throw new Error('AUDIO_RESULT_DATA_URL_INVALID')
    contentType = match[1] || contentType
    body = match[2] ? Buffer.from(match[3], 'base64') : Buffer.from(decodeURIComponent(match[3]))
  } else {
    const response = await fetch(toFetchableUrl(params.source), {
      cache: 'no-store',
      headers: params.downloadHeaders,
    })
    if (!response.ok) throw new Error(`AUDIO_RESULT_DOWNLOAD_FAILED(${response.status})`)
    contentType = response.headers.get('content-type')?.split(';')[0]?.trim() || contentType
    const declaredLength = Number(response.headers.get('content-length'))
    if (Number.isFinite(declaredLength) && declaredLength > MAX_AUDIO_BYTES) throw new Error('AUDIO_RESULT_TOO_LARGE')
    body = Buffer.from(await response.arrayBuffer())
  }
  if (body.length === 0) throw new Error('AUDIO_RESULT_EMPTY')
  if (body.length > MAX_AUDIO_BYTES) throw new Error('AUDIO_RESULT_TOO_LARGE')
  const key = generateUniqueKey(`toolbox-audio/${params.projectId}`, audioExtension(contentType))
  const durationSeconds = await probeMediaDurationSeconds(body)
  return {
    storageKey: await uploadObject(body, key, 3, contentType),
    durationSeconds,
  }
}

