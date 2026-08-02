export type CreateProjectLevel = 'Nori1.0'
export type CreateProjectStyle = 'live-action' | 'anime-3d' | 'anime-2.5d' | 'anime-2d' | 'anime'
export type CreateProjectType = 'story' | 'narration'
export type CreateProjectMaterialType = 'script' | 'novel-outline'
export type CreateProjectDurationMode = 'per-episode' | 'per-1000-chars'

export interface CreateProjectLevelVariant {
  showCollaboration: boolean
  showProjectType: boolean
  showStyleReferences: boolean
  allowEpisodeRange: boolean
  durationModes: readonly CreateProjectDurationMode[]
  projectStyles: readonly CreateProjectStyle[]
  materialTypes: readonly CreateProjectMaterialType[]
}

export const CREATE_PROJECT_LEVEL_VARIANTS: Readonly<Record<CreateProjectLevel, CreateProjectLevelVariant>> = {
  'Nori1.0': {
    showCollaboration: true,
    showProjectType: false,
    showStyleReferences: true,
    allowEpisodeRange: true,
    durationModes: ['per-episode', 'per-1000-chars'],
    projectStyles: ['live-action', 'anime-3d', 'anime-2.5d', 'anime-2d'],
    materialTypes: ['script'],
  },
}

export function durationBounds(
  _level: CreateProjectLevel,
  mode: CreateProjectDurationMode,
): { minimum: number; maximum: number } {
  return mode === 'per-episode'
    ? { minimum: 10, maximum: 3600 }
    : { minimum: 1, maximum: 600 }
}

export function styleForLevel(
  level: CreateProjectLevel,
  current: CreateProjectStyle,
): CreateProjectStyle {
  const styles = CREATE_PROJECT_LEVEL_VARIANTS[level].projectStyles
  if (styles.includes(current)) return current
  if (current === 'anime') return 'anime-2d'
  return 'live-action'
}

export function validTargetEpisodeCount(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 100
}
