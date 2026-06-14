export const EPISODE_FRAMEOS_METADATA_KEY = '_frameosEpisodeMetadata'

export type EpisodeFrameOSMetadata = {
  episode_id?: string
  episode_number?: number
  status?: string
  content_kilo?: number
  estimatedWords?: number
  source_anchor?: unknown
  info_points?: unknown
  reasoning?: unknown
  scenes?: unknown
  analysis?: unknown
  validation?: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseJsonRecord(value: unknown): Record<string, unknown> {
  if (!value) return {}
  if (isRecord(value)) return { ...value }
  if (typeof value !== 'string') return {}
  try {
    const parsed = JSON.parse(value) as unknown
    return isRecord(parsed) ? { ...parsed } : {}
  } catch {
    return {}
  }
}

function readText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export function buildEpisodeFrameOSMetadata(input: {
  episode_id?: unknown
  episode_number?: unknown
  status?: unknown
  content_kilo?: unknown
  estimatedWords?: unknown
  source_anchor?: unknown
  info_points?: unknown
  reasoning?: unknown
  scenes?: unknown
  analysis?: unknown
  validation?: unknown
}): EpisodeFrameOSMetadata | null {
  const metadata: EpisodeFrameOSMetadata = {}

  const episodeId = readText(input.episode_id)
  if (episodeId) metadata.episode_id = episodeId
  const episodeNumber = readNumber(input.episode_number)
  if (episodeNumber !== undefined) metadata.episode_number = episodeNumber
  const status = readText(input.status)
  if (status) metadata.status = status
  const contentKilo = readNumber(input.content_kilo)
  if (contentKilo !== undefined) metadata.content_kilo = contentKilo
  const estimatedWords = readNumber(input.estimatedWords)
  if (estimatedWords !== undefined) metadata.estimatedWords = estimatedWords

  if (input.source_anchor !== undefined && input.source_anchor !== null) metadata.source_anchor = input.source_anchor
  if (input.info_points !== undefined && input.info_points !== null) metadata.info_points = input.info_points
  if (input.reasoning !== undefined && input.reasoning !== null) metadata.reasoning = input.reasoning
  if (input.scenes !== undefined && input.scenes !== null) metadata.scenes = input.scenes
  if (input.analysis !== undefined && input.analysis !== null) metadata.analysis = input.analysis
  if (input.validation !== undefined && input.validation !== null) metadata.validation = input.validation

  return Object.keys(metadata).length > 0 ? metadata : null
}

export function readEpisodeFrameOSMetadataFromSpeakerVoices(speakerVoices: unknown): EpisodeFrameOSMetadata | null {
  const record = parseJsonRecord(speakerVoices)
  const raw = record[EPISODE_FRAMEOS_METADATA_KEY]
  return isRecord(raw) ? (raw as EpisodeFrameOSMetadata) : null
}

export function writeEpisodeFrameOSMetadataToSpeakerVoices(
  speakerVoices: unknown,
  metadata: EpisodeFrameOSMetadata | null,
): string | null {
  const record = parseJsonRecord(speakerVoices)
  if (metadata && Object.keys(metadata).length > 0) {
    record[EPISODE_FRAMEOS_METADATA_KEY] = metadata
  } else {
    delete record[EPISODE_FRAMEOS_METADATA_KEY]
  }
  return Object.keys(record).length > 0 ? JSON.stringify(record) : null
}
