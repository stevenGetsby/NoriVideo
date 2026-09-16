import { describe, expect, it } from 'vitest'
import {
  FOS_SIDEBAR_WIDTH_DEFAULT,
  FOS_SIDEBAR_WIDTH_MAX,
  FOS_SIDEBAR_WIDTH_MIN,
  FOS_SIDEBAR_WIDTH_STORAGE_KEY,
  clampSidebarWidth,
  nextSidebarWidth,
  readStoredSidebarWidth,
  writeStoredSidebarWidth,
} from '@/lib/frameos/sidebar-width'

function withMemoryStorage(run: (storage: { getItem: (key: string) => string | null }) => void) {
  const data = new Map<string, string>()
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value)
    },
    removeItem: (key: string) => {
      data.delete(key)
    },
  }
  const previous = (globalThis as { window?: unknown }).window
  ;(globalThis as { window: { localStorage: typeof storage } }).window = { localStorage: storage }
  try {
    run(storage)
  } finally {
    if (previous === undefined) delete (globalThis as { window?: unknown }).window
    else (globalThis as { window: unknown }).window = previous
  }
}

describe('sidebar width helpers', () => {
  it('clamps to the visible navigator range', () => {
    expect(clampSidebarWidth(Number.NaN)).toBe(FOS_SIDEBAR_WIDTH_DEFAULT)
    expect(clampSidebarWidth(80)).toBe(FOS_SIDEBAR_WIDTH_MIN)
    expect(clampSidebarWidth(900)).toBe(FOS_SIDEBAR_WIDTH_MAX)
    expect(clampSidebarWidth(251.6)).toBe(252)
  })

  it('converts pointer travel through the interface scale', () => {
    expect(nextSidebarWidth(220, 100, 160, 1.2)).toBe(270)
    expect(nextSidebarWidth(220, 100, 40, 1)).toBe(176)
    expect(nextSidebarWidth(220, 100, 800, 0)).toBe(FOS_SIDEBAR_WIDTH_MAX)
  })

  it('round-trips the remembered width', () => {
    withMemoryStorage((storage) => {
      writeStoredSidebarWidth(304)
      expect(storage.getItem(FOS_SIDEBAR_WIDTH_STORAGE_KEY)).toBe('304')
      expect(readStoredSidebarWidth()).toBe(304)

      writeStoredSidebarWidth(12)
      expect(readStoredSidebarWidth()).toBe(FOS_SIDEBAR_WIDTH_MIN)
    })
  })
})

