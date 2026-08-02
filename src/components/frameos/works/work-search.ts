import type { WorkSummary } from './types'

function includesQuery(value: string | null | undefined, query: string) {
  return Boolean(value?.toLocaleLowerCase().includes(query))
}

/**
 * Keep the browser-side projection aligned with the /api/works search
 * contract. The API matches work names plus project names/descriptions; this
 * second pass only trims projects inside a matched work.
 */
export function filterWorksByQuery(works: WorkSummary[], value: string): WorkSummary[] {
  const query = value.trim().toLocaleLowerCase()
  if (!query) return works
  return works.flatMap((work) => {
    if (includesQuery(work.name, query)) return [work]
    const projects = work.projects.filter((project) => (
      includesQuery(project.name, query)
      || includesQuery(project.description, query)
    ))
    return projects.length ? [{ ...work, projects }] : []
  })
}
