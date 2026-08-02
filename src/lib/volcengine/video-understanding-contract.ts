export const VIDEO_REPAINT_ANALYSIS_SCHEMA_VERSION = 'nori-video-repaint-analysis-v1'

export interface VideoRepaintAnalysisValidation {
  valid: boolean
  errors: string[]
  warnings: string[]
}

type JsonRecord = Record<string, unknown>

const TIMELINE_GAP_TOLERANCE_SECONDS = 0.25

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
  return episode ? asString(episode.formatted_text) : ''
}

function timecodeSeconds(value: unknown): number | null {
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

function collectAssetRefs(value: unknown): Set<string> {
  return new Set(asArray(value).map((item) => isRecord(item) ? asString(item.asset_ref) : '').filter(Boolean))
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
  const storyboard = checkRequiredRecord(input, 'source_storyboard', errors)
  const adaptation = checkRequiredRecord(input, 'adaptation_contract', errors)
  checkRequiredRecord(input, 'quality_report', errors)

  const scenes = checkRequiredArray(episode, 'scenes', errors)
  const shots = checkRequiredArray(storyboard, 'shots', errors)
  checkRequiredArray(storyboard, 'excluded_ranges', errors)
  const characters = checkRequiredArray(assets, 'characters', errors)
  const locations = checkRequiredArray(assets, 'locations', errors)
  const props = checkRequiredArray(assets, 'props', errors)

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

  const formattedText = extractFormattedEpisodeScript(input)
  if (!formattedText) {
    warnings.push('source_episode.formatted_text is empty')
  } else {
    if (!/第\s*\d+\s*集/.test(formattedText)) warnings.push('formatted_text is missing episode header')
    if (!/\d+\s*-\s*\d+/.test(formattedText)) warnings.push('formatted_text is missing N-M scene number')
    if (!formattedText.includes('场景：')) warnings.push('formatted_text is missing scene heading')
    if (!formattedText.includes('人物：')) warnings.push('formatted_text is missing character line')
  }
  if (scenes.length === 0) warnings.push('source_episode.scenes is empty')
  if (shots.length === 0) warnings.push('source_storyboard.shots is empty')

  const sceneIds = new Set<string>()
  const beatIds = new Set<string>()
  for (let index = 0; index < scenes.length; index += 1) {
    const rawScene = scenes[index]
    if (!isRecord(rawScene)) {
      errors.push(`source_episode.scenes[${index}] must be an object`)
      continue
    }
    const scene = rawScene
    const sceneId = asString(scene.scene_id)
    if (!sceneId) errors.push(`source_episode.scenes[${index}].scene_id is required`)
    else if (sceneIds.has(sceneId)) errors.push(`duplicate scene_id: ${sceneId}`)
    else sceneIds.add(sceneId)

    const beats = checkRequiredArray(scene, 'beats', errors)
    for (let beatIndex = 0; beatIndex < beats.length; beatIndex += 1) {
      const rawBeat = beats[beatIndex]
      if (!isRecord(rawBeat)) {
        errors.push(`source_episode.scenes[${index}].beats[${beatIndex}] must be an object`)
        continue
      }
      const beat = rawBeat
      const beatId = asString(beat.beat_id)
      if (!beatId) errors.push(`source_episode.scenes[${index}].beats[${beatIndex}].beat_id is required`)
      else if (beatIds.has(beatId)) errors.push(`duplicate beat_id: ${beatId}`)
      else beatIds.add(beatId)
    }
  }

  const assetRefs = new Set([
    ...collectAssetRefs(characters),
    ...collectAssetRefs(locations),
    ...collectAssetRefs(props),
  ])
  const panelIds = new Set<string>()
  const timelineRanges: Array<{ start: number; end: number; label: string }> = []
  for (let index = 0; index < shots.length; index += 1) {
    const rawShot = shots[index]
    if (!isRecord(rawShot)) {
      errors.push(`source_storyboard.shots[${index}] must be an object`)
      continue
    }
    const shot = rawShot
    const panelId = asString(shot.panel_id)
    if (!panelId) errors.push(`source_storyboard.shots[${index}].panel_id is required`)
    else if (panelIds.has(panelId)) errors.push(`duplicate panel_id: ${panelId}`)
    else panelIds.add(panelId)

    const anchor = isRecord(shot.source_anchor) ? shot.source_anchor : {}
    const start = timecodeSeconds(anchor.start_time)
    const end = timecodeSeconds(anchor.end_time)
    if (start !== null && end !== null && end > start) {
      timelineRanges.push({ start, end, label: panelId || `shot ${index + 1}` })
    }

    const sceneId = asString(shot.scene_id)
    if (sceneId && !sceneIds.has(sceneId)) warnings.push(`${panelId || `shot ${index + 1}`} references unknown scene_id ${sceneId}`)
    for (const beatIdRaw of asArray(shot.source_beat_ids)) {
      const beatId = asString(beatIdRaw)
      if (beatId && !beatIds.has(beatId)) warnings.push(`${panelId || `shot ${index + 1}`} references unknown beat_id ${beatId}`)
    }

    const refs = isRecord(shot.referenced_assets) ? shot.referenced_assets : {}
    const referenced = [
      ...asArray(refs.characters),
      refs.location,
      ...asArray(refs.props),
    ].map(asString).filter(Boolean)
    for (const assetRef of referenced) {
      if (!assetRefs.has(assetRef)) warnings.push(`${panelId || `shot ${index + 1}`} references unknown asset ${assetRef}`)
    }
  }
  const excludedRanges = asArray(storyboard.excluded_ranges)
  for (let index = 0; index < excludedRanges.length; index += 1) {
    const rawRange = excludedRanges[index]
    const range: JsonRecord = isRecord(rawRange) ? rawRange : {}
    const start = timecodeSeconds(range.start_time)
    const end = timecodeSeconds(range.end_time)
    if (start !== null && end !== null && end > start) {
      timelineRanges.push({ start, end, label: `excluded range ${index + 1}` })
    }
  }

  timelineRanges.sort((left, right) => left.start - right.start || left.end - right.end)
  let coveredUntil = timelineRanges[0]?.end
  let previousLabel = timelineRanges[0]?.label
  for (let index = 1; index < timelineRanges.length && coveredUntil !== undefined; index += 1) {
    const current = timelineRanges[index]
    if (!current) continue
    const gap = current.start - coveredUntil
    if (gap > TIMELINE_GAP_TOLERANCE_SECONDS) {
      warnings.push(
        `source timeline has uncovered gap ${formatSeconds(coveredUntil)}-${formatSeconds(current.start)} (${gap.toFixed(3)}s) between ${previousLabel} and ${current.label}`,
      )
    }
    if (current.end > coveredUntil) {
      coveredUntil = current.end
      previousLabel = current.label
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  }
}
