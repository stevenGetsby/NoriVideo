export type ProjectCreationModeRoute = 'workflow' | 'canvas' | 'batch_workflow'

export function projectHref(projectId: string) {
  return `/projects?work_id=${encodeURIComponent(projectId)}`
}

export function projectLinkProps(projectId: string) {
  return { pathname: '/projects', query: { work_id: projectId } } as const
}

export function projectWorkbenchHref(projectId: string) {
  return `/workflow/${encodeURIComponent(projectId)}/workbench-premium2`
}

export function projectCanvasHref(projectId: string) {
  return `/workflow/${encodeURIComponent(projectId)}/workbench-premium2/canvas`
}

export function projectBatchWorkflowHref(projectId: string) {
  return `/workflow/${encodeURIComponent(projectId)}/batch`
}

export function projectEntryHref(
  projectId: string,
  creationMode?: string | null,
) {
  if (creationMode === 'canvas') return projectCanvasHref(projectId)
  if (creationMode === 'batch_workflow') return projectBatchWorkflowHref(projectId)
  return projectWorkbenchHref(projectId)
}
