import { resolveTargetAudiencePrompt } from '@/lib/projects/creation-config'

type ContextSource = Record<string, unknown> | null | undefined

type ProductionContextInput = {
  project?: ContextSource
  novelProject?: ContextSource
  episode?: ContextSource
  payload?: ContextSource
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function readText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readNumberText(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

function readField(sources: ContextSource[], keys: string[]): string {
  for (const source of sources) {
    const record = asRecord(source)
    if (!record) continue
    for (const key of keys) {
      const text = readText(record[key]) || readNumberText(record[key])
      if (text) return text
    }
  }
  return ''
}

function readNestedPayloadContext(payload: ContextSource): Record<string, unknown> | null {
  const record = asRecord(payload)
  if (!record) return null
  return asRecord(record.productionContext)
    || asRecord(record.projectProductionContext)
    || asRecord(record.projectContext)
}

export function buildFrameosProductionContext(input: ProductionContextInput): string {
  const payloadContext = readNestedPayloadContext(input.payload)
  const sources: ContextSource[] = [
    payloadContext,
    input.payload,
    input.novelProject,
    input.episode,
    input.project,
  ]
  const targetAudience = readField(sources, ['targetAudience', 'target_audience'])

  const rows = [
    ['project_name', readField(sources, ['project_name', 'projectName', 'name'])],
    ['project_level', readField(sources, ['projectLevel', 'project_level'])],
    ['project_style', readField(sources, ['projectStyle', 'project_style'])],
    ['target_audience', targetAudience],
    ['target_audience_context', targetAudience ? resolveTargetAudiencePrompt(targetAudience) : ''],
    ['genre', readField(sources, ['genre_name', 'genreName', 'genre'])],
    ['language', readField(sources, ['language', 'locale'])],
    ['aspect_ratio', readField(sources, ['videoRatio', 'aspect_ratio', 'aspectRatio'])],
    ['resolution', readField(sources, ['videoResolution', 'resolution'])],
    ['visual_category', readField(sources, ['visual_category_name', 'visualCategoryName', 'visual_category', 'visualCategory'])],
    ['art_style', readField(sources, ['art_style', 'artStyle'])],
    ['art_style_prompt', readField(sources, ['artStylePrompt', 'art_style_prompt', 'visualStylePrompt'])],
    ['budget_level', readField(sources, ['budget_level_name', 'budgetLevelName', 'budget_level', 'budgetLevel'])],
    ['episode_duration_seconds', readField(sources, ['targetEpisodeDurationSeconds', 'episode_duration', 'episodeDuration', 'durationSeconds'])],
    ['script_kilo', readField(sources, ['script_kilo', 'scriptKilo'])],
  ].filter((row): row is [string, string] => Boolean(row[1]))

  if (rows.length === 0) {
    return 'No explicit project production context provided. Infer production choices only from source text and asset libraries.'
  }

  return rows.map(([key, value]) => `${key}: ${value}`).join('\n')
}
