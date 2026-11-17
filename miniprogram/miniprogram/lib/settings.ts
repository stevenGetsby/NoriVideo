import { wxStorage } from './storage'

export type Quality = 'auto' | '480' | '720'

export interface Settings {
  quality: Quality
  autoplayOnCellular: boolean
}

const KEY = 'mp.settings'

export function getSettings(): Settings {
  const raw = wxStorage.getItem(KEY)
  if (!raw) return { quality: 'auto', autoplayOnCellular: false }
  try {
    const parsed = JSON.parse(raw) as Partial<Settings>
    return {
      quality: parsed.quality === '480' || parsed.quality === '720' ? parsed.quality : 'auto',
      autoplayOnCellular: parsed.autoplayOnCellular === true,
    }
  } catch {
    return { quality: 'auto', autoplayOnCellular: false }
  }
}

export function setSettings(patch: Partial<Settings>): Settings {
  const next = { ...getSettings(), ...patch }
  wxStorage.setItem(KEY, JSON.stringify(next))
  return next
}
