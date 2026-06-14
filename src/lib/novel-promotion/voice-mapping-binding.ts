export type FrameOSVoiceSource = 'library_match' | 'unmatched' | 'custom_upload'

export type FrameOSVoiceMappingCandidate = {
  rank?: number
  voice_id?: string
  voice_name?: string
  reason?: string
  is_selected?: boolean
  reference_audio_id?: string | null
}

export type FrameOSVoiceMappingEntry = {
  character?: string
  character_id?: string
  role_type?: string
  voice_source?: string
  voice_raw_file?: string
  candidates?: FrameOSVoiceMappingCandidate[]
}

export type CharacterVoiceMappingTarget = {
  id: string
  name: string
  aliases?: string[] | string | null
}

export type CharacterVoiceUpdateData = {
  voiceId: string | null
  voiceType: 'qwen-designed' | 'uploaded' | null
  customVoiceUrl: string | null
  customVoiceMediaId: string | null
}

export type CharacterVoiceMappingUpdate = {
  characterId: string
  characterName: string
  source: Exclude<FrameOSVoiceSource, 'unmatched'>
  data: CharacterVoiceUpdateData
}

export type CharacterVoiceMappingSkipped = {
  character: string
  characterId: string
  reason: 'invalid_entry' | 'character_not_found' | 'unmatched' | 'missing_voice_id' | 'missing_voice_raw_file'
}

export type CharacterVoiceMappingPlan = {
  updates: CharacterVoiceMappingUpdate[]
  skipped: CharacterVoiceMappingSkipped[]
}

export type VoiceMappingSpeakerVoiceSkipped = {
  speaker: string
  characterId: string
  reason: 'invalid_entry' | 'speaker_not_in_scope' | 'unmatched' | 'missing_voice_id' | 'missing_voice_raw_file'
}

export type VoiceMappingSpeakerVoicePlan = {
  speakerVoices: Record<string, {
    provider: 'fal'
    voiceType: string
    audioUrl: string
  } | {
    provider: 'bailian'
    voiceType: string
    voiceId: string
  }>
  skipped: VoiceMappingSpeakerVoiceSkipped[]
}

function readText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readMappingEntries(value: unknown): FrameOSVoiceMappingEntry[] {
  let raw: unknown[] = []
  if (Array.isArray(value)) {
    raw = value
  } else if (value && typeof value === 'object') {
    const voiceMapping = (value as Record<string, unknown>).voice_mapping
    if (Array.isArray(voiceMapping)) {
      raw = voiceMapping
    }
  }

  return raw.filter((item): item is FrameOSVoiceMappingEntry => !!item && typeof item === 'object' && !Array.isArray(item))
}

function readAliases(value: CharacterVoiceMappingTarget['aliases']): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => readText(item)).filter(Boolean)
  }
  if (typeof value !== 'string') return []
  const text = value.trim()
  if (!text) return []
  try {
    const parsed = JSON.parse(text)
    if (Array.isArray(parsed)) {
      return parsed.map((item) => readText(item)).filter(Boolean)
    }
  } catch {
    // Fall through to slash-separated legacy aliases.
  }
  return text.split('/').map((item) => item.trim()).filter(Boolean)
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase()
}

function resolveVoiceSource(value: unknown): FrameOSVoiceSource | null {
  const source = readText(value)
  if (source === 'library_match' || source === 'unmatched' || source === 'custom_upload') return source
  return null
}

function resolveTarget(
  entry: FrameOSVoiceMappingEntry,
  targets: CharacterVoiceMappingTarget[],
): CharacterVoiceMappingTarget | null {
  const characterId = readText(entry.character_id)
  if (characterId) {
    const byId = targets.find((target) => target.id === characterId)
    if (byId) return byId
  }

  const characterName = readText(entry.character)
  if (!characterName) return null
  const key = normalizeKey(characterName)
  return targets.find((target) => {
    if (normalizeKey(target.name) === key) return true
    return readAliases(target.aliases).some((alias) => normalizeKey(alias) === key)
  }) || null
}

export function selectVoiceMappingCandidate(
  entry: FrameOSVoiceMappingEntry,
): FrameOSVoiceMappingCandidate | null {
  const candidates = Array.isArray(entry.candidates)
    ? entry.candidates.filter((item): item is FrameOSVoiceMappingCandidate => !!item && typeof item === 'object')
    : []
  if (candidates.length === 0) return null

  const selected = candidates.find((candidate) => candidate.is_selected === true && readText(candidate.voice_id))
  if (selected) return selected

  const ranked = candidates
    .filter((candidate) => readText(candidate.voice_id))
    .sort((left, right) => {
      const leftRank = typeof left.rank === 'number' && Number.isFinite(left.rank) ? left.rank : Number.MAX_SAFE_INTEGER
      const rightRank = typeof right.rank === 'number' && Number.isFinite(right.rank) ? right.rank : Number.MAX_SAFE_INTEGER
      return leftRank - rightRank
    })
  return ranked[0] || null
}

export function buildCharacterVoiceMappingUpdates(params: {
  mappings: unknown
  characters: CharacterVoiceMappingTarget[]
}): CharacterVoiceMappingPlan {
  const updates: CharacterVoiceMappingUpdate[] = []
  const skipped: CharacterVoiceMappingSkipped[] = []
  const entries = readMappingEntries(params.mappings)

  for (const entry of entries) {
    const character = readText(entry.character)
    const characterId = readText(entry.character_id)
    const source = resolveVoiceSource(entry.voice_source)
    if (!source || (!character && !characterId)) {
      skipped.push({ character, characterId, reason: 'invalid_entry' })
      continue
    }

    const target = resolveTarget(entry, params.characters)
    if (!target) {
      skipped.push({ character, characterId, reason: 'character_not_found' })
      continue
    }

    if (source === 'unmatched') {
      skipped.push({ character: character || target.name, characterId, reason: 'unmatched' })
      continue
    }

    if (source === 'custom_upload') {
      const voiceRawFile = readText(entry.voice_raw_file)
      if (!voiceRawFile) {
        skipped.push({ character: character || target.name, characterId, reason: 'missing_voice_raw_file' })
        continue
      }
      updates.push({
        characterId: target.id,
        characterName: target.name,
        source,
        data: {
          voiceId: null,
          voiceType: 'uploaded',
          customVoiceUrl: voiceRawFile,
          customVoiceMediaId: null,
        },
      })
      continue
    }

    const candidate = selectVoiceMappingCandidate(entry)
    const voiceId = readText(candidate?.voice_id)
    if (!voiceId) {
      skipped.push({ character: character || target.name, characterId, reason: 'missing_voice_id' })
      continue
    }
    updates.push({
      characterId: target.id,
      characterName: target.name,
      source,
      data: {
        voiceId,
        voiceType: 'qwen-designed',
        customVoiceUrl: null,
        customVoiceMediaId: null,
      },
    })
  }

  return { updates, skipped }
}

export function buildSpeakerVoiceMapFromVoiceMapping(params: {
  mappings: unknown
  speakers?: string[]
}): VoiceMappingSpeakerVoicePlan {
  const speakerVoices: VoiceMappingSpeakerVoicePlan['speakerVoices'] = {}
  const skipped: VoiceMappingSpeakerVoiceSkipped[] = []
  const entries = readMappingEntries(params.mappings)
  const speakerSet = params.speakers
    ? new Set(params.speakers.map((speaker) => normalizeKey(speaker)).filter(Boolean))
    : null

  for (const entry of entries) {
    const speaker = readText(entry.character)
    const characterId = readText(entry.character_id)
    const source = resolveVoiceSource(entry.voice_source)
    if (!source || !speaker) {
      skipped.push({ speaker, characterId, reason: 'invalid_entry' })
      continue
    }
    if (speakerSet && !speakerSet.has(normalizeKey(speaker))) {
      skipped.push({ speaker, characterId, reason: 'speaker_not_in_scope' })
      continue
    }
    if (source === 'unmatched') {
      skipped.push({ speaker, characterId, reason: 'unmatched' })
      continue
    }
    if (source === 'custom_upload') {
      const voiceRawFile = readText(entry.voice_raw_file)
      if (!voiceRawFile) {
        skipped.push({ speaker, characterId, reason: 'missing_voice_raw_file' })
        continue
      }
      speakerVoices[speaker] = {
        provider: 'fal',
        voiceType: 'uploaded',
        audioUrl: voiceRawFile,
      }
      continue
    }

    const candidate = selectVoiceMappingCandidate(entry)
    const voiceId = readText(candidate?.voice_id)
    if (!voiceId) {
      skipped.push({ speaker, characterId, reason: 'missing_voice_id' })
      continue
    }
    speakerVoices[speaker] = {
      provider: 'bailian',
      voiceType: 'qwen-designed',
      voiceId,
    }
  }

  return { speakerVoices, skipped }
}
