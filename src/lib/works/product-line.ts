export type WorkProductLine = 'canvas' | 'story'
export type ProjectCreationMode = 'workflow' | 'canvas' | 'batch_workflow'

export const WORK_PRODUCT_LINES: readonly WorkProductLine[] = ['canvas', 'story']
export const PROJECT_CREATION_MODES: readonly ProjectCreationMode[] = ['workflow', 'canvas', 'batch_workflow']

export function isWorkProductLine(value: unknown): value is WorkProductLine {
  return value === 'canvas' || value === 'story'
}

export function isProjectCreationMode(value: unknown): value is ProjectCreationMode {
  return value === 'workflow' || value === 'canvas' || value === 'batch_workflow'
}
