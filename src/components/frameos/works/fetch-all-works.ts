import { apiFetch } from '@/lib/api-fetch'
import { readApiErrorMessage } from '@/lib/api/read-error-message'
import { normalizeWorksResponse, type WorkPagination, type WorkSummary } from './types'

export async function fetchAllWorks({
  pageSize = 50,
  search = '',
  signal,
  fallbackErrorMessage = '加载作品失败',
}: {
  pageSize?: number
  search?: string
  signal?: AbortSignal
  fallbackErrorMessage?: string
} = {}): Promise<{ works: WorkSummary[]; pagination: WorkPagination }> {
  const normalizedPageSize = Math.max(1, Math.min(100, Math.floor(pageSize)))
  const worksById = new Map<string, WorkSummary>()
  let page = 1
  let total = 0
  let totalPages = 1

  do {
    const params = new URLSearchParams({ page: String(page), pageSize: String(normalizedPageSize) })
    if (search.trim()) params.set('search', search.trim())
    const response = await apiFetch(`/api/works?${params}`, { signal })
    if (!response.ok) throw new Error(await readApiErrorMessage(response, fallbackErrorMessage))

    const normalized = normalizeWorksResponse(await response.json())
    total = Math.max(total, normalized.pagination.total)
    totalPages = Math.max(totalPages, normalized.pagination.totalPages)
    for (const work of normalized.works) {
      const existing = worksById.get(work.id)
      if (!existing) {
        worksById.set(work.id, work)
        continue
      }
      const projectsById = new Map(existing.projects.map((project) => [project.id, project]))
      for (const project of work.projects) projectsById.set(project.id, project)
      worksById.set(work.id, {
        ...existing,
        ...work,
        projectCount: Math.max(existing.projectCount, work.projectCount, projectsById.size),
        projects: Array.from(projectsById.values()),
      })
    }
    page += 1
  } while (page <= totalPages)

  return {
    works: Array.from(worksById.values()),
    pagination: {
      page: 1,
      pageSize: normalizedPageSize,
      total,
      totalPages,
    },
  }
}
