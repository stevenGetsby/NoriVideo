export type WorkProductLine = 'canvas' | 'story'
export type ProjectCreationMode = 'workflow' | 'canvas'

export const WORK_PRODUCT_LINES: readonly WorkProductLine[] = ['canvas', 'story']
export const PROJECT_CREATION_MODES: readonly ProjectCreationMode[] = ['workflow', 'canvas']

export function isWorkProductLine(value: unknown): value is WorkProductLine {
  return value === 'canvas' || value === 'story'
}

export function isProjectCreationMode(value: unknown): value is ProjectCreationMode {
  return value === 'workflow' || value === 'canvas'
}
