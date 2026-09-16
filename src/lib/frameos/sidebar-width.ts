export const FOS_SIDEBAR_WIDTH_STORAGE_KEY = 'nori.fos.sidebarWidth'
export const FOS_SIDEBAR_WIDTH_DEFAULT = 220
export const FOS_SIDEBAR_WIDTH_MIN = 176
export const FOS_SIDEBAR_WIDTH_MAX = 420

export function clampSidebarWidth(value: number): number {
  if (!Number.isFinite(value)) return FOS_SIDEBAR_WIDTH_DEFAULT
  return Math.min(FOS_SIDEBAR_WIDTH_MAX, Math.max(FOS_SIDEBAR_WIDTH_MIN, Math.round(value)))
}

export function readStoredSidebarWidth(): number {
  if (typeof window === 'undefined') return FOS_SIDEBAR_WIDTH_DEFAULT
  try {
    return clampSidebarWidth(Number.parseFloat(window.localStorage.getItem(FOS_SIDEBAR_WIDTH_STORAGE_KEY) || ''))
  } catch {
    return FOS_SIDEBAR_WIDTH_DEFAULT
  }
}

export function writeStoredSidebarWidth(width: number) {
  try {
    window.localStorage.setItem(FOS_SIDEBAR_WIDTH_STORAGE_KEY, String(clampSidebarWidth(width)))
  } catch {
    // Storage can be unavailable in private/restricted browser contexts.
  }
}

export function readInterfaceScale(element: Element): number {
  if (element instanceof HTMLElement && element.offsetWidth > 0) {
    const measured = element.getBoundingClientRect().width / element.offsetWidth
    if (Number.isFinite(measured) && measured > 0) return measured
  }
  const raw = getComputedStyle(element).getPropertyValue('--nori-interface-scale').trim()
  const parsed = Number.parseFloat(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1
}

export function nextSidebarWidth(
  startWidth: number,
  startClientX: number,
  clientX: number,
  scale: number,
): number {
  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1
  return clampSidebarWidth(startWidth + (clientX - startClientX) / safeScale)
}
