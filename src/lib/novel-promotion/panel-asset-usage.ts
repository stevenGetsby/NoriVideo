export const PANEL_ASSET_USAGE_CONFIRMATION_KEY = '_assetUsageConfirmation'

export interface PanelCharacterAssetRef {
  name: string
  appearance?: string
  slot?: string
}

export interface PanelAssetUsage {
  characters: PanelCharacterAssetRef[]
  locations: string[]
  props: string[]
}

export interface PanelAssetUsageConfirmation {
  confirmed: boolean
  confirmedAt: string | null
}

type JsonRecord = Record<string, unknown>

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  if (!trimmed) return null
  const parsed = parseJson(trimmed)
  return parsed === null ? trimmed : parsed
}

function normalizeName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function splitNames(value: string): string[] {
  return value
    .split(/[,，、\n]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

export function parseAssetNames(value: unknown): string[] {
  const parsed = parseMaybeJson(value)
  if (Array.isArray(parsed)) {
    return Array.from(new Set(parsed.flatMap((item) => {
      if (typeof item === 'string') return splitNames(item)
      if (isRecord(item)) {
        const name = normalizeName(item.name) ?? normalizeName(item.title) ?? normalizeName(item.label)
        return name ? [name] : []
      }
      return []
    })))
  }
  if (typeof parsed === 'string') return Array.from(new Set(splitNames(parsed)))
  if (isRecord(parsed)) {
    const name = normalizeName(parsed.name) ?? normalizeName(parsed.title) ?? normalizeName(parsed.label)
    return name ? [name] : []
  }
  return []
}

export function parsePanelCharacterRefs(value: unknown): PanelCharacterAssetRef[] {
  const parsed = parseMaybeJson(value)
  if (!Array.isArray(parsed)) {
    return parseAssetNames(parsed).map((name) => ({ name }))
  }

  const seen = new Set<string>()
  const characters: PanelCharacterAssetRef[] = []
  for (const item of parsed) {
    if (typeof item === 'string') {
      for (const name of splitNames(item)) {
        const key = `${name}:`
        if (!seen.has(key)) {
          seen.add(key)
          characters.push({ name })
        }
      }
      continue
    }
    if (!isRecord(item)) continue
    const name = normalizeName(item.name)
    if (!name) continue
    const appearance = normalizeName(item.appearance) ?? undefined
    const slot = normalizeName(item.slot) ?? undefined
    const key = `${name}:${appearance ?? ''}:${slot ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    characters.push({ name, appearance, slot })
  }
  return characters
}

export function getPanelAssetUsage(input: {
  characters?: unknown
  location?: unknown
  props?: unknown
}): PanelAssetUsage {
  return {
    characters: parsePanelCharacterRefs(input.characters),
    locations: parseAssetNames(input.location),
    props: parseAssetNames(input.props),
  }
}

function parseActingNotesRecord(actingNotes: unknown): JsonRecord | null {
  const parsed = parseMaybeJson(actingNotes)
  if (isRecord(parsed)) return parsed
  if (Array.isArray(parsed)) return { characters: parsed }
  return null
}

export function readPanelAssetUsageConfirmation(actingNotes: unknown): PanelAssetUsageConfirmation {
  const record = parseActingNotesRecord(actingNotes)
  const raw = record?.[PANEL_ASSET_USAGE_CONFIRMATION_KEY]
  if (!isRecord(raw) || raw.confirmed !== true) {
    return { confirmed: false, confirmedAt: null }
  }
  return {
    confirmed: true,
    confirmedAt: typeof raw.confirmedAt === 'string' ? raw.confirmedAt : null,
  }
}

export function writePanelAssetUsageConfirmation(actingNotes: unknown, confirmed: boolean): string | null {
  const record = parseActingNotesRecord(actingNotes) ?? {}
  if (!confirmed) {
    const rest = { ...record }
    delete rest[PANEL_ASSET_USAGE_CONFIRMATION_KEY]
    return Object.keys(rest).length > 0 ? JSON.stringify(rest) : null
  }
  return JSON.stringify({
    ...record,
    [PANEL_ASSET_USAGE_CONFIRMATION_KEY]: {
      confirmed: true,
      confirmedAt: new Date().toISOString(),
    },
  })
}

export function clearPanelAssetUsageConfirmation(actingNotes: unknown): string | null {
  return writePanelAssetUsageConfirmation(actingNotes, false)
}
