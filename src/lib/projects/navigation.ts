export function projectHref(projectId: string) {
  return `/projects?work_id=${encodeURIComponent(projectId)}`
}

export function projectLinkProps(projectId: string) {
  return { pathname: '/projects', query: { work_id: projectId } } as const
}
