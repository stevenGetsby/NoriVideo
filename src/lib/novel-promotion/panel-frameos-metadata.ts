export const PANEL_FRAMEOS_METADATA_KEY = '_frameosPanelMetadata'

export type JsonRecord = Record<string, unknown>

export interface PanelFrameOSMetadata {
  panel_id?: string
  panel_number?: number
  source_text?: string
  source_anchor?: unknown
  referenced_assets?: unknown
  visual_prompt?: string
  visual_style?: string
  visual_style_description?: string
  continuity_notes?: string
  voice_refs?: unknown
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  if (!trimmed) return null
  try {
    return JSON.parse(trimmed)
  } catch {
    return trimmed
  }
}

function parseActingNotesRecord(actingNotes: unknown): JsonRecord {
  const parsed = parseMaybeJson(actingNotes)
  if (isRecord(parsed)) return { ...parsed }
  if (Array.isArray(parsed)) return { characters: parsed }
  return {}
}

function readText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export function buildPanelFrameOSMetadata(input: {
  panel_id?: unknown
  panel_number?: unknown
  source_text?: unknown
  source_anchor?: unknown
  referenced_assets?: unknown
  visual_prompt?: unknown
  visual_style?: unknown
  visual_style_description?: unknown
  continuity_notes?: unknown
  voice_refs?: unknown
}): PanelFrameOSMetadata | null {
  const metadata: PanelFrameOSMetadata = {}

  const panelId = readText(input.panel_id)
  if (panelId) metadata.panel_id = panelId
  const panelNumber = readNumber(input.panel_number)
  if (panelNumber !== undefined) metadata.panel_number = panelNumber

  const sourceText = readText(input.source_text)
  if (sourceText) metadata.source_text = sourceText
  if (input.source_anchor !== undefined && input.source_anchor !== null) metadata.source_anchor = input.source_anchor
  if (input.referenced_assets !== undefined && input.referenced_assets !== null) metadata.referenced_assets = input.referenced_assets

  const visualPrompt = readText(input.visual_prompt)
  if (visualPrompt) metadata.visual_prompt = visualPrompt
  const visualStyle = readText(input.visual_style)
  if (visualStyle) metadata.visual_style = visualStyle
  const visualStyleDescription = readText(input.visual_style_description)
  if (visualStyleDescription) metadata.visual_style_description = visualStyleDescription
  const continuityNotes = readText(input.continuity_notes)
  if (continuityNotes) metadata.continuity_notes = continuityNotes
  if (input.voice_refs !== undefined && input.voice_refs !== null) metadata.voice_refs = input.voice_refs

  return Object.keys(metadata).length > 0 ? metadata : null
}

export function readPanelFrameOSMetadataFromActingNotes(actingNotes: unknown): PanelFrameOSMetadata | null {
  const record = parseActingNotesRecord(actingNotes)
  const raw = record[PANEL_FRAMEOS_METADATA_KEY]
  return isRecord(raw) ? (raw as PanelFrameOSMetadata) : null
}

export function writePanelFrameOSMetadataToActingNotes(
  actingNotes: unknown,
  metadata: PanelFrameOSMetadata | null,
): string | null {
  const record = parseActingNotesRecord(actingNotes)
  if (metadata && Object.keys(metadata).length > 0) {
    record[PANEL_FRAMEOS_METADATA_KEY] = metadata
  } else {
    delete record[PANEL_FRAMEOS_METADATA_KEY]
  }
  return Object.keys(record).length > 0 ? JSON.stringify(record) : null
}

export function readActingNotesContinuityText(actingNotes: unknown): string {
  const parsed = parseMaybeJson(actingNotes)
  const rows = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed.characters)
      ? parsed.characters
      : []
  return rows
    .map((item) => {
      if (!isRecord(item)) return ''
      const name = readText(item.name) || ''
      const acting = readText(item.acting) || readText(item.expression) || ''
      return [name, acting].filter(Boolean).join(': ')
    })
    .filter(Boolean)
    .join('\n')
}
