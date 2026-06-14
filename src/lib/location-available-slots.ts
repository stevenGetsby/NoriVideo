import {
  ASSET_FRAMEOS_METADATA_KEY,
  type AssetFrameOSMetadata,
} from '@/lib/novel-promotion/asset-frameos-metadata'

export type LocationAvailableSlot = string
export type LocationSlotLocale = 'zh' | 'en'

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function normalizeLocationAvailableSlots(value: unknown): LocationAvailableSlot[] {
  const source = isRecord(value) && Array.isArray(value.slots) ? value.slots : value
  if (!Array.isArray(source)) return []
  const seen = new Set<string>()
  const slots: LocationAvailableSlot[] = []

  for (const item of source) {
    const normalized = normalizeText(item)
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    slots.push(normalized)
  }

  return slots
}

function parseAvailableSlotsDocument(raw: string | null | undefined): unknown {
  if (!raw) return []
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return []
  }
}

export function parseLocationAvailableSlots(raw: string | null | undefined): LocationAvailableSlot[] {
  return normalizeLocationAvailableSlots(parseAvailableSlotsDocument(raw))
}

export function stringifyLocationAvailableSlots(slots: LocationAvailableSlot[]): string {
  return JSON.stringify(normalizeLocationAvailableSlots(slots))
}

export function readFrameOSAssetMetadataFromAvailableSlots(raw: string | null | undefined): AssetFrameOSMetadata | null {
  const parsed = parseAvailableSlotsDocument(raw)
  if (!isRecord(parsed)) return null
  const metadata = parsed[ASSET_FRAMEOS_METADATA_KEY]
  return isRecord(metadata) ? (metadata as AssetFrameOSMetadata) : null
}

export function stringifyLocationAvailableSlotsWithFrameOSMetadata(
  slots: LocationAvailableSlot[],
  metadata: AssetFrameOSMetadata | null,
): string {
  const normalizedSlots = normalizeLocationAvailableSlots(slots)
  if (!metadata) return JSON.stringify(normalizedSlots)
  return JSON.stringify({
    slots: normalizedSlots,
    [ASSET_FRAMEOS_METADATA_KEY]: metadata,
  })
}

export function formatLocationAvailableSlotsText(
  slots: LocationAvailableSlot[],
  locale: LocationSlotLocale = 'zh',
): string {
  const normalized = normalizeLocationAvailableSlots(slots)
  if (normalized.length === 0) return ''
  const lines = normalized.map((slot) => `- ${slot}`)
  const header = locale === 'en' ? 'Available character slots:' : '可站位置：'
  return `${header}\n${lines.join('\n')}`
}
