import { apiFetch } from '@/lib/api-fetch'
import { readApiErrorMessage } from '@/lib/api/read-error-message'

export async function fetchAllProjectOptions(signal?: AbortSignal) {
  const projects = new Map<string, { id: string; name: string; workId: string; workName: string | null }>()
  let totalPages = 1
  for (let page = 1; page <= totalPages; page++) {
    signal?.throwIfAborted()
    const response = await apiFetch(`/api/projects?page=${page}&pageSize=100`, { cache: 'no-store', signal })
    if (!response.ok) throw new Error(await readApiErrorMessage(response, '加载作品失败'))
    const payload = await response.json() as {
      works?: Array<{ id: string; name: string; workId?: string | null; projectId?: string | null; workName?: string | null }>
      projects?: Array<{ id: string; name: string; workId?: string | null; projectId?: string | null; workName?: string | null }>
      pagination?: { totalPages?: number }
    }
    const advertisedPages = payload.pagination?.totalPages ?? 1
    if (!Number.isSafeInteger(advertisedPages) || advertisedPages < 0) {
      throw new Error('作品列表分页信息无效，请刷新后重试。')
    }
    totalPages = Math.max(1, advertisedPages)
    const options = Array.isArray(payload.works) ? payload.works
      : Array.isArray(payload.projects) ? payload.projects : []
    for (const project of options) {
      const workId = project.workId || project.projectId
      if (!workId) throw new Error(`作品「${project.name}」缺少所属项目，请刷新后重试。`)
      projects.set(project.id, { id: project.id, name: project.name, workId, workName: project.workName?.trim() || null })
    }
  }
  return [...projects.values()]
}
