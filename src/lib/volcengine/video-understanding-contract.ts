import { isSpokenDialogueLine } from '@/lib/video-repaint/storyboard-text'

export const VIDEO_REPAINT_ANALYSIS_SCHEMA_VERSION = 'nori-video-repaint-analysis-v1'

export interface VideoRepaintAnalysisValidation {
  valid: boolean
  errors: string[]
  warnings: string[]
}

type JsonRecord = Record<string, unknown>

// The source script has to reach the end of the video, give or take a closing card or a fade-out.
const SCENE_COVERAGE_TOLERANCE_SECONDS = 5

function isRecord(value: unknown): value is JsonRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function extractFormattedEpisodeScript(input: unknown): string {
  if (!isRecord(input)) return ''
  const episode = isRecord(input.source_episode) ? input.source_episode : null
  if (!episode) return ''
  const formatted = asString(episode.formatted_text)
  if (!formatted) return ''

  // Models sometimes write only the actions into formatted_text while their dialogue beats are complete.
  // Prefer those verbatim beats over silently sending a dialogue-free source script to the text model.
  const dialogue = asArray(episode.scenes).filter(isRecord).flatMap((scene) =>
    asArray(scene.beats).filter(isRecord).filter((beat) =>
      ['dialogue', 'voiceover', 'inner_monologue'].includes(asString(beat.type)) && asString(beat.text),
    ),
  )
  if (!dialogue.length) return formatted
  // A completely dialogue-free formatted_text loses information even when the beats transcribed it correctly.
  // Rebuild only that case; partially incomplete formatting keeps the model's actual wording rather than rewriting it.
  const hasSpokenLine = formatted.split(/\r?\n/).some(isSpokenDialogueLine)
  if (hasSpokenLine) return formatted
  const rebuilt = buildEpisodeScriptFromScenes(input)
  return dialogue.every((beat) => rebuilt.includes(asString(beat.text))) ? rebuilt : formatted
}

/** `HH:MM:SS.mmm` as seconds; null for anything else. */
export function parseAnalysisTimecode(value: unknown): number | null {
  const match = asString(value).match(/^(\d+):(\d{2}):(\d{2}(?:\.\d{1,3})?)$/)
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  const seconds = Number(match[3])
  if (!Number.isFinite(hours) || minutes >= 60 || seconds >= 60) return null
  return hours * 3600 + minutes * 60 + seconds
}

function formatSeconds(value: number): string {
  const hours = Math.floor(value / 3600)
  const minutes = Math.floor((value % 3600) / 60)
  const seconds = value % 60
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${seconds.toFixed(3).padStart(6, '0')}`
}

/**
 * The script as plain text, put together from the scenes and beats. The model normally writes `formatted_text` itself;
 * this stands in when that field is missing or the reply was cut off before it.
 */
export function buildEpisodeScriptFromScenes(input: unknown): string {
  if (!isRecord(input)) return ''
  const episode = isRecord(input.source_episode) ? input.source_episode : null
  if (!episode) return ''
  const scenes = asArray(episode.scenes).filter(isRecord)
  if (!scenes.length) return ''

  const assets = isRecord(input.asset_candidates) ? input.asset_candidates : {}
  const names = new Map<string, string>()
  for (const character of asArray(assets.characters)) {
    if (!isRecord(character)) continue
    const ref = asString(character.asset_ref)
    if (ref) names.set(ref, asString(character.name_if_heard) || asString(asArray(character.aliases_heard)[0]) || ref)
  }
  const nameOf = (ref: unknown): string => names.get(asString(ref)) || asString(ref)

  const episodeNumber = typeof episode.episode_number === 'number' && Number.isInteger(episode.episode_number) && episode.episode_number > 0
    ? episode.episode_number
    : 1
  const lines = [`第${episodeNumber}集`]
  for (const scene of scenes) {
    const sceneNumber = asString(scene.scene_number)
    if (sceneNumber) lines.push(sceneNumber)
    const heading = isRecord(scene.heading) ? scene.heading : {}
    const place = [
      asString(heading.location),
      asString(heading.time_of_day),
      asString(heading.weather) || asString(heading.light_condition),
    ].filter(Boolean).join(' - ')
    if (place) lines.push(`场景：${place}`)
    const present = asArray(scene.character_refs).map(nameOf).filter(Boolean)
    if (present.length) lines.push(`人物：${present.join('、')}`)
    const lead = asString(scene.lead_shot_cue)
    if (lead) lines.push(lead)

    for (const beat of asArray(scene.beats)) {
      if (!isRecord(beat)) continue
      const text = asString(beat.text)
      if (!text) continue
      const type = asString(beat.type)
      const note = asString(beat.parenthetical)
      if (type === 'dialogue') lines.push(`${nameOf(beat.speaker_ref) || '未知'}${note ? `（${note}）` : ''}：${text}`)
      else if (type === 'voiceover') lines.push(`画外音：${text}`)
      else if (type === 'inner_monologue') lines.push(`（内心OS）：${text}`)
      else if (type === 'sound') lines.push(`（音效）${text}`)
      else lines.push(`△${text}`)
    }
  }
  return lines.join('\n')
}

function checkRequiredRecord(
  root: JsonRecord,
  field: string,
  errors: string[],
): JsonRecord {
  const value = root[field]
  if (isRecord(value)) return value
  errors.push(`${field} must be an object`)
  return {}
}

function checkRequiredArray(root: JsonRecord, field: string, errors: string[]): unknown[] {
  const value = root[field]
  if (Array.isArray(value)) return value
  errors.push(`${field} must be an array`)
  return []
}

/**
 * Checks the source script (场次, 人物, 对白) and the neutral adaptation contract. The shot-level 分镜 is a separate
 * document written by its own stage, so nothing here looks at it.
 */
export function validateVideoRepaintAnalysis(input: unknown): VideoRepaintAnalysisValidation {
  const errors: string[] = []
  const warnings: string[] = []
  if (!isRecord(input)) {
    return { valid: false, errors: ['analysis must be an object'], warnings }
  }

  if (input.schema_version !== VIDEO_REPAINT_ANALYSIS_SCHEMA_VERSION) {
    errors.push(`schema_version must be ${VIDEO_REPAINT_ANALYSIS_SCHEMA_VERSION}`)
  }
  if (input.analysis_mode !== 'script' && input.analysis_mode !== 'board') {
    errors.push('analysis_mode must be script or board')
  }

  checkRequiredRecord(input, 'series_metadata', errors)
  const episode = checkRequiredRecord(input, 'source_episode', errors)
  const assets = checkRequiredRecord(input, 'asset_candidates', errors)
  const adaptation = checkRequiredRecord(input, 'adaptation_contract', errors)
  checkRequiredRecord(input, 'quality_report', errors)

  const scenes = checkRequiredArray(episode, 'scenes', errors)
  checkRequiredArray(assets, 'characters', errors)
  checkRequiredArray(assets, 'locations', errors)
  checkRequiredArray(assets, 'props', errors)

  for (const field of [
    'story_invariants',
    'character_function_invariants',
    'relationship_invariants',
    'causal_chain',
    'hook_map',
    'localization_candidates',
    'do_not_localize',
    'cultural_risks',
  ]) {
    checkRequiredArray(adaptation, field, errors)
  }

  const formattedText = isRecord(input.source_episode)
    ? asString(input.source_episode.formatted_text) || extractFormattedEpisodeScript(input)
    : ''
  if (!formattedText) {
    warnings.push('source_episode.formatted_text is empty')
  } else {
    if (!/第\s*\d+\s*集/.test(formattedText)) warnings.push('formatted_text is missing episode header')
    if (!/\d+\s*-\s*\d+/.test(formattedText)) warnings.push('formatted_text is missing N-M scene number')
    if (!formattedText.includes('场景：')) warnings.push('formatted_text is missing scene heading')
    if (!formattedText.includes('人物：')) warnings.push('formatted_text is missing character line')
  }
  if (scenes.length === 0) warnings.push('source_episode.scenes is empty')

  const sceneIds = new Set<string>()
  const beatIds = new Set<string>()
  let lastSceneEnd: number | null = null
  for (let index = 0; index < scenes.length; index += 1) {
    const scene = scenes[index]
    if (!isRecord(scene)) {
      errors.push(`source_episode.scenes[${index}] must be an object`)
      continue
    }
    const sceneId = asString(scene.scene_id)
    if (!sceneId) errors.push(`source_episode.scenes[${index}].scene_id is required`)
    else if (sceneIds.has(sceneId)) errors.push(`duplicate scene_id: ${sceneId}`)
    else sceneIds.add(sceneId)

    const range = isRecord(scene.source_range) ? scene.source_range : {}
    const sceneEnd = parseAnalysisTimecode(range.end_time)
    if (sceneEnd !== null && (lastSceneEnd === null || sceneEnd > lastSceneEnd)) lastSceneEnd = sceneEnd

    const beats = checkRequiredArray(scene, 'beats', errors)
    for (let beatIndex = 0; beatIndex < beats.length; beatIndex += 1) {
      const beat = beats[beatIndex]
      if (!isRecord(beat)) {
        errors.push(`source_episode.scenes[${index}].beats[${beatIndex}] must be an object`)
        continue
      }
      const beatId = asString(beat.beat_id)
      if (!beatId) errors.push(`source_episode.scenes[${index}].beats[${beatIndex}].beat_id is required`)
      else if (beatIds.has(beatId)) errors.push(`duplicate beat_id: ${beatId}`)
      else beatIds.add(beatId)
    }
  }

  const duration = typeof episode.duration_seconds === 'number' && Number.isFinite(episode.duration_seconds)
    ? episode.duration_seconds
    : 0
  if (duration > 0 && lastSceneEnd !== null && lastSceneEnd < duration - SCENE_COVERAGE_TOLERANCE_SECONDS) {
    warnings.push(
      `source script stops at ${formatSeconds(lastSceneEnd)} but the video runs ${formatSeconds(duration)}; later scenes may be missing`,
    )
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  }
}
