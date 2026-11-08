export function projectHref(projectId: string) {
  return `/projects?work_id=${encodeURIComponent(projectId)}`
}
