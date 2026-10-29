import type { CSSProperties } from 'react'

const STAT_KEY_HUES: Record<string, string> = {
  total: '#6e7bff',
  bugs: '#f87171',
  quality: '#fbbf24',
  workflow: '#38bdf8',
  ideas: '#34d399',
  visual: '#38bdf8',
  audio: '#34d399',
  renders: '#a78bfa',
  running: '#fbbf24',
  failed: '#f87171',
  zhOverrides: '#38bdf8',
  enOverrides: '#a78bfa',
  variables: '#fbbf24',
  episodes: '#38bdf8',
  words: '#fbbf24',
  characters: '#f472b6',
  locations: '#34d399',
  projects: '#5b9dff',
  activeTasks: '#34d399',
  failedTasks: '#f87171',
  assets: '#fb923c',
  subaccounts: '#a78bfa',
  text: '#fbbf24',
  image: '#38bdf8',
  video: '#a78bfa',
}

export function statTileStyle(key: string): CSSProperties {
  return { '--hue': STAT_KEY_HUES[key] ?? '#6e7bff' } as CSSProperties
}
