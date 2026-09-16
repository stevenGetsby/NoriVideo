/** Provider-reported output facts. Never copy credentials/download headers here. */
export interface VideoResultMetadata {
  actualVideoTokens?: number
  durationSeconds?: number
  resolution?: string
  aspectRatio?: string
  frames?: number
  fps?: number
  generateAudio?: boolean
  seed?: number
  lastFrameUrl?: string
}

export function pickVideoResultMetadata(value: VideoResultMetadata): VideoResultMetadata {
  const result: VideoResultMetadata = {}
  for (const key of ['actualVideoTokens', 'durationSeconds', 'frames', 'fps', 'seed'] as const) {
    const number = value[key]
    if (typeof number === 'number' && Number.isFinite(number)
      && (key === 'seed' || (key === 'actualVideoTokens' ? number >= 0 : number > 0))) {
      result[key] = number
    }
  }
  for (const key of ['resolution', 'aspectRatio', 'lastFrameUrl'] as const) {
    if (typeof value[key] === 'string' && value[key]?.trim()) result[key] = value[key]?.trim()
  }
  if (typeof value.generateAudio === 'boolean') result.generateAudio = value.generateAudio
  return result
}
