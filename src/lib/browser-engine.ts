export type EngineFlags = {
  zoomMode?: 'legacy'
  engineVersion?: string
}

export function detectEngineFlags(userAgent: string, hasCurrentCSSZoom: boolean): EngineFlags {
  const flags: EngineFlags = {}
  if (/Trident\/|MSIE /.test(userAgent)) {
    flags.engineVersion = '0'
    return flags
  }
  const match = /Chrome\/(\d+)/.exec(userAgent)
  if (!match) return flags
  const version = Number.parseInt(match[1], 10)
  if (version < 128) {
    flags.engineVersion = String(version)
    if (!hasCurrentCSSZoom) flags.zoomMode = 'legacy'
  }
  return flags
}
