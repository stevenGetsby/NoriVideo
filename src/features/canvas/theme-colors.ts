import type { NoriResolvedTheme } from '@/lib/theme/useNoriTheme'

export function canvasThemeColors(theme: NoriResolvedTheme) {
  return theme === 'light' ? {
    background: 'rgba(91,103,245,.18)',
    edge: '#9aa0c4',
    minimapMask: 'rgba(245,246,250,.7)',
    minimapMaskStroke: '#5b67f5',
    minimapStroke: '#5b67f5',
  } : {
    background: 'rgba(163,172,255,.12)',
    edge: 'rgba(163,172,255,.4)',
    minimapMask: 'rgba(4,6,10,.58)',
    minimapMaskStroke: 'rgba(126,159,255,.92)',
    minimapStroke: 'rgba(255,255,255,.2)',
  }
}
