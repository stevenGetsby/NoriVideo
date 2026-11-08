import { describe, expect, it } from 'vitest'
import { projectHref, projectLinkProps } from '@/lib/projects/navigation'

describe('project navigation helpers', () => {
  it('projectHref keeps legacy query-string form for callers that want a raw URL', () => {
    expect(projectHref('work-1')).toBe('/projects?work_id=work-1')
    expect(projectHref('a/b?c=d')).toBe('/projects?work_id=a%2Fb%3Fc%3Dd')
  })

  it('projectLinkProps splits pathname and query so next-intl Link does not double-encode', () => {
    expect(projectLinkProps('work-1')).toEqual({ pathname: '/projects', query: { work_id: 'work-1' } })
    // When this is passed to <Link href={...} /> next-intl builds `/zh/projects?work_id=work-1`,
    // not `/zh/projects%3Fwork_id%3Dwork-1` which would 404.
    expect(projectLinkProps('work-1').pathname).toBe('/projects')
    expect(projectLinkProps('work-1').query).toEqual({ work_id: 'work-1' })
  })
})
