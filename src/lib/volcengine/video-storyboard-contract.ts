import type { VideoRepaintAnalysisValidation } from './video-understanding-contract'

export const VIDEO_SOURCE_STORYBOARD_SCHEMA_VERSION = 'nori-source-storyboard-v1'

type JsonRecord = Record<string, unknown>

function isRecord(value: unknown): value is JsonRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function asRecord(value: unknown): JsonRecord {
  return isRecord(value) ? value : {}
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
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

function collectAssetRefs(sourceAnalysis: unknown): Set<string> {
  const source = asRecord(sourceAnalysis)
  const assets = asRecord(source.asset_candidates)
  return new Set(
    ['characters', 'locations', 'props']
      .flatMap((field) => asArray(assets[field]))
      .map((value) => asString(asRecord(value).asset_ref))
      .filter(Boolean),
  )
}

export function validateSourceStoryboard(
  input: unknown,
  options?: { sourceAnalysis?: unknown; durationSeconds?: number },
): VideoRepaintAnalysisValidation {
  const errors: string[] = []
  const warnings: string[] = []
  if (!isRecord(input)) return { valid: false, errors: ['storyboard must be an object'], warnings }

  if (input.schema_version !== VIDEO_SOURCE_STORYBOARD_SCHEMA_VERSION) {
    errors.push(`schema_version must be ${VIDEO_SOURCE_STORYBOARD_SCHEMA_VERSION}`)
  }
  const shots = asArray(input.shots)
  const excludedRanges = asArray(input.excluded_ranges)
  if (!Array.isArray(input.shots)) errors.push('shots must be an array')
  if (!Array.isArray(input.excluded_ranges)) errors.push('excluded_ranges must be an array')
  if (!isRecord(input.quality_report)) errors.push('quality_report must be an object')
  if (!shots.length) errors.push('shots must not be empty')

  const knownAssets = collectAssetRefs(options?.sourceAnalysis)
  const panelIds = new Set<string>()
  const ranges: Array<{ start: number; end: number; label: string }> = []
  shots.forEach((value, index) => {
    const shot = asRecord(value)
    const panelId = asString(shot.panel_id)
    if (!panelId) errors.push(`shots[${index}].panel_id is required`)
    else if (panelIds.has(panelId)) errors.push(`duplicate panel_id: ${panelId}`)
    else panelIds.add(panelId)

    const anchor = asRecord(shot.source_anchor)
    const start = timecodeSeconds(anchor.start_time)
    const end = timecodeSeconds(anchor.end_time)
    if (start === null || end === null || end <= start) {
      errors.push(`${panelId || `shot ${index + 1}`} has invalid source_anchor`)
    } else {
      ranges.push({ start, end, label: panelId || `shot ${index + 1}` })
    }

    const refs = asRecord(shot.referenced_assets)
    const referencedAssets = [
      ...asArray(refs.characters),
      refs.location,
      ...asArray(refs.props),
    ].map(asString).filter(Boolean)
    for (const assetRef of referencedAssets) {
      if (knownAssets.size && !knownAssets.has(assetRef)) {
        warnings.push(`${panelId || `shot ${index + 1}`} references unknown asset ${assetRef}`)
      }
    }
  })

  excludedRanges.forEach((value, index) => {
    const range = asRecord(value)
    const start = timecodeSeconds(range.start_time)
    const end = timecodeSeconds(range.end_time)
    if (start === null || end === null || end <= start) {
      errors.push(`excluded_ranges[${index}] has invalid time range`)
    } else {
      ranges.push({ start, end, label: `excluded range ${index + 1}` })
    }
  })

  ranges.sort((left, right) => left.start - right.start || left.end - right.end)
  let coveredUntil = 0
  let previousLabel = 'video start'
  for (const range of ranges) {
    const gap = range.start - coveredUntil
    if (gap > 0.25) {
      const message = `source timeline has uncovered gap ${formatSeconds(coveredUntil)}-${formatSeconds(range.start)} (${gap.toFixed(3)}s) between ${previousLabel} and ${range.label}`
      if (gap > 1) errors.push(message)
      else warnings.push(message)
    }
    if (range.start < coveredUntil - 0.25) {
      warnings.push(`${range.label} overlaps previous coverage by ${(coveredUntil - range.start).toFixed(3)}s`)
    }
    if (range.end > coveredUntil) {
      coveredUntil = range.end
      previousLabel = range.label
    }
  }
  const duration = options?.durationSeconds
  if (typeof duration === 'number' && Number.isFinite(duration) && duration > coveredUntil + 0.25) {
    const gap = duration - coveredUntil
    const message = `source timeline ends at ${formatSeconds(coveredUntil)} with ${gap.toFixed(3)}s uncovered`
    if (gap > 1) errors.push(message)
    else warnings.push(message)
  }

  return { valid: errors.length === 0, errors, warnings }
}
