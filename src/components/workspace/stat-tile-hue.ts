import type { CSSProperties } from 'react'

const STAT_KEY_HUES: Record<string, [string, string]> = {
  total: ['#6e7bff', 'var(--fos-primary)'],
  bugs: ['#f87171', 'var(--fos-danger-text)'],
  quality: ['#fbbf24', 'var(--fos-warning)'],
  workflow: ['#38bdf8', 'var(--fos-info)'],
  ideas: ['#34d399', 'var(--fos-success)'],
  visual: ['#38bdf8', 'var(--fos-info)'],
  audio: ['#34d399', 'var(--fos-success)'],
  renders: ['#a78bfa', 'var(--fos-hue-video)'],
  running: ['#fbbf24', 'var(--fos-warning)'],
  failed: ['#f87171', 'var(--fos-danger-text)'],
  zhOverrides: ['#38bdf8', 'var(--fos-info)'],
  enOverrides: ['#a78bfa', 'var(--fos-hue-video)'],
  variables: ['#fbbf24', 'var(--fos-warning)'],
  episodes: ['#38bdf8', 'var(--fos-info)'],
  words: ['#fbbf24', 'var(--fos-warning)'],
  characters: ['#f472b6', 'var(--fos-hue-canvas)'],
  locations: ['#34d399', 'var(--fos-success)'],
  projects: ['#5b9dff', 'var(--fos-hue-project)'],
  activeTasks: ['#34d399', 'var(--fos-success)'],
  failedTasks: ['#f87171', 'var(--fos-danger-text)'],
  assets: ['#fb923c', 'var(--fos-hue-asset)'],
  subaccounts: ['#a78bfa', 'var(--fos-hue-video)'],
  text: ['#fbbf24', 'var(--fos-warning)'],
  image: ['#38bdf8', 'var(--fos-info)'],
  video: ['#a78bfa', 'var(--fos-hue-video)'],
}

export function statTileStyle(key: string): CSSProperties {
  const [dark, light] = STAT_KEY_HUES[key] ?? ['#6e7bff', 'var(--fos-primary)']
  return { '--hue': 'var(--nori-stat-hue)', '--hue-dark': dark, '--hue-light': light } as CSSProperties
}
