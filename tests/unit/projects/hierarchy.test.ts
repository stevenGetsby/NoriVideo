import { describe, expect, it } from 'vitest'
import {
  createWorkInProjectHref,
  productionHierarchy,
  toProductionProject,
  toProductionWork,
} from '@/lib/projects/hierarchy'
import { normalizeWorksResponse } from '@/components/frameos/works/types'

const storedWork = {
  id: 'existing-production-unit',
  name: '第一部短剧',
  workId: 'existing-container',
  novelPromotionData: { episodeCount: 3, videoRatio: '9:16' },
  canManage: false,
}
const storedProject = {
  id: 'existing-container',
  name: '短剧项目',
  projectCount: 1,
  canCreateProjects: true,
  projects: [storedWork],
}

describe('business project -> work hierarchy with preserved storage IDs', () => {
  it('projects the parent as a project and the production unit as its work', () => {
    const project = toProductionProject(storedProject)
    expect(project).toMatchObject({
      id: 'existing-container', kind: 'project', workCount: 1, canCreateWorks: true,
      works: [{
        id: 'existing-production-unit', kind: 'work', projectId: 'existing-container',
        novelPromotionData: { episodeCount: 3 },
      }],
    })
    expect(project).not.toHaveProperty('projects')
    expect(project).not.toHaveProperty('projectCount')
    expect(project.works[0]).not.toHaveProperty('workId')
  })

  it('does not rewrite stored IDs, production configuration or access permissions', () => {
    const original = structuredClone(storedProject)
    const work = toProductionWork(storedWork)
    expect(work.id).toBe(storedWork.id)
    expect(work.projectId).toBe(storedProject.id)
    expect(work.novelPromotionData).toBe(storedWork.novelPromotionData)
    expect(work.canManage).toBe(false)
    expect(storedProject).toEqual(original)
  })

  it('uses the authoritative parent association when mapping nested records', () => {
    const result = toProductionProject({
      ...storedProject,
      projects: [{ ...storedWork, workId: 'stale-client-parent' }],
    })
    expect(result.works[0].projectId).toBe(storedProject.id)
  })

  it('frontends prefer the explicit hierarchy over stale legacy labels', () => {
    const hierarchy = productionHierarchy([storedProject])
    const parsed = normalizeWorksResponse({
      projectHierarchy: hierarchy,
      works: [{ id: 'outdated-record', name: '不得显示', projects: [] }],
      pagination: { total: 1, totalPages: 1 },
    })
    expect(parsed.works).toHaveLength(1)
    expect(parsed.works[0]).toMatchObject({
      id: storedProject.id, name: storedProject.name, projectCount: 1, canCreateProjects: true,
      projects: [{ id: storedWork.id, workId: storedProject.id, name: storedWork.name }],
    })
  })

  it('does not resurrect old projects when the canonical hierarchy is empty', () => {
    expect(normalizeWorksResponse({
      projectHierarchy: productionHierarchy([]),
      works: [storedProject],
      unassignedProjects: [storedWork],
    }).works).toEqual([])
  })

  it('retains legacy response compatibility without inventing new IDs or duplicating works', () => {
    const parsed = normalizeWorksResponse({ works: [storedProject] })
    expect(parsed.works[0].id).toBe(storedProject.id)
    expect(parsed.works[0].projects[0].id).toBe(storedWork.id)
    expect(parsed.works[0].projects[0].workId).toBe(storedProject.id)
  })

  it('preserves the parent association on recycled works', () => {
    const deletedAt = '2026-10-13T00:00:00Z'
    const work = toProductionWork({ ...storedWork, deletedAt })
    expect(work).toMatchObject({ id: storedWork.id, projectId: storedProject.id, deletedAt })
  })

  it('creates works in an explicitly selected project through an encoded deep link', () => {
    const href = createWorkInProjectHref('project&special=1')
    const url = new URL(href, 'http://localhost')
    expect(url.pathname).toBe('/projects')
    expect(url.searchParams.get('create_work')).toBe('1')
    expect(url.searchParams.get('parent_project_id')).toBe('project&special=1')
    expect(url.searchParams.has('create_project')).toBe(false)
  })
})
