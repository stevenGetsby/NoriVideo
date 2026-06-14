export const VOICE_MAPPING_FRAMEOS_METADATA_KEY = '_frameosVoiceMappingMetadata'

export type VoiceMappingFrameOSMetadata = {
  status?: string
  voice_mapping?: unknown
  auditions?: unknown
  plan?: unknown
  reasoning?: string
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

export function buildVoiceMappingFrameOSMetadata(input: {
  mapping: unknown
  plan?: unknown
  reasoning?: unknown
}): VoiceMappingFrameOSMetadata | null {
  const mapping = isRecord(input.mapping) ? input.mapping : {}
  const metadata: VoiceMappingFrameOSMetadata = {}
  const status = readText(mapping.status)
  const reasoning = readText(input.reasoning)

  if (status) metadata.status = status
  if (mapping.voice_mapping !== undefined) metadata.voice_mapping = mapping.voice_mapping
  if (mapping.auditions !== undefined) metadata.auditions = mapping.auditions
  if (input.plan !== undefined && input.plan !== null) metadata.plan = input.plan
  if (reasoning) metadata.reasoning = reasoning

  return Object.keys(metadata).length > 0 ? metadata : null
}

export function readVoiceMappingFrameOSMetadataFromSpeakerVoices(
  speakerVoices: unknown,
): VoiceMappingFrameOSMetadata | null {
  const record = parseJsonRecord(speakerVoices)
  const raw = record[VOICE_MAPPING_FRAMEOS_METADATA_KEY]
  return isRecord(raw) ? raw as VoiceMappingFrameOSMetadata : null
}

export function writeVoiceMappingFrameOSMetadataToSpeakerVoices(
  speakerVoices: unknown,
  metadata: VoiceMappingFrameOSMetadata | null,
): string | null {
  const record = parseJsonRecord(speakerVoices)
  if (metadata && Object.keys(metadata).length > 0) {
    record[VOICE_MAPPING_FRAMEOS_METADATA_KEY] = metadata
  } else {
    delete record[VOICE_MAPPING_FRAMEOS_METADATA_KEY]
  }
  return Object.keys(record).length > 0 ? JSON.stringify(record) : null
}

