export const PROJECT_CHANGED_EVENT = 'nori:project-changed'

export function notifyProjectChanged(projectId: string) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(PROJECT_CHANGED_EVENT, { detail: { projectId } }))
}
