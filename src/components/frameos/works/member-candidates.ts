import { apiFetch } from '@/lib/api-fetch'
import { readApiErrorMessage } from '@/lib/api/read-error-message'
import { normalizeCandidate, type MemberCandidate } from './types'

type CandidateFetcher = (
  input: string,
  init?: RequestInit,
) => Promise<Response>

function positiveInteger(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback
}

function candidatePageUrl(path: string, keyword: string, page: number, pageSize: number) {
  const separator = path.indexOf('?')
  const pathname = separator >= 0 ? path.slice(0, separator) : path
  const params = new URLSearchParams(separator >= 0 ? path.slice(separator + 1) : '')
  if (keyword) params.set('keyword', keyword)
  else params.delete('keyword')
  params.set('page', String(page))
  params.set('pageSize', String(pageSize))
  params.delete('limit')
  return `${pathname}?${params.toString()}`
}

export function excludeExistingMemberCandidates(
  candidates: MemberCandidate[],
  existingMemberIds: readonly string[],
): MemberCandidate[] {
  if (existingMemberIds.length === 0) return candidates
  const excluded = new Set(existingMemberIds)
  return candidates.filter((candidate) => !excluded.has(candidate.id))
}

/** Load every page advertised by the candidate API so large workspaces are usable. */
export async function fetchAllMemberCandidates({
  path,
  keyword = '',
  pageSize = 100,
  signal,
  fetcher = apiFetch,
}: {
  path: string
  keyword?: string
  pageSize?: number
  signal?: AbortSignal
  fetcher?: CandidateFetcher
}): Promise<MemberCandidate[]> {
  const normalizedPageSize = Math.max(1, Math.min(100, Math.floor(pageSize)))
  const candidates = new Map<string, MemberCandidate>()
  let page = 1
  let totalPages = 1

  do {
    const response = await fetcher(
      candidatePageUrl(path, keyword.trim(), page, normalizedPageSize),
      { signal },
    )
    if (!response.ok) throw new Error(await readApiErrorMessage(response, '加载成员失败'))
    const payload = await response.json() as Record<string, unknown>
    const raw = Array.isArray(payload.candidates)
      ? payload.candidates
      : Array.isArray(payload.members)
        ? payload.members
        : Array.isArray(payload.users)
          ? payload.users
          : []
    for (const value of raw) {
      const candidate = normalizeCandidate(value)
      if (candidate) candidates.set(candidate.id, candidate)
    }
    const pagination = payload.pagination && typeof payload.pagination === 'object' && !Array.isArray(payload.pagination)
      ? payload.pagination as Record<string, unknown>
      : {}
    // Cap an invalid/malicious response while still supporting very large
    // workspaces (100,000 accounts at pageSize 100).
    totalPages = Math.min(1_000, positiveInteger(pagination.totalPages ?? pagination.total_pages, 1))
    page += 1
  } while (page <= totalPages)

  return Array.from(candidates.values())
}
