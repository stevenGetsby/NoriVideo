/**
 * Business hierarchy: project -> work -> episode / canvas / asset / task.
 *
 * Historic storage has inverse names: Prisma.Work is the parent project;
 * Prisma.Project is the production work. Keeping those IDs and foreign keys
 * preserves existing accounts, tasks, media, ledgers, links and recycle items.
 * New consumers use this explicit domain projection, not the legacy names.
 */
export const PRODUCTION_HIERARCHY_VERSION = 2 as const

export function createWorkInProjectHref(projectId: string) {
  return `/projects?create_work=1&parent_project_id=${encodeURIComponent(projectId)}`
}

export type LegacyProductionWork = {
  id: string
  name: string
  workId?: string | null
  work?: unknown
}

export function toProductionWork<T extends LegacyProductionWork>(
  stored: T,
  parentProjectId = stored.workId,
) {
  const { workId: legacyParentId, work: legacyParentRelation, ...work } = stored
  void legacyParentId
  void legacyParentRelation
  return {
    ...work,
    kind: 'work' as const,
    projectId: parentProjectId || null,
  }
}

type LegacyParentProject<Work extends LegacyProductionWork> = {
  id: string
  name: string
  projects: readonly Work[]
  projectCount?: number
  canCreateProjects?: boolean
  canMoveProjects?: boolean
  canManage?: boolean
}

export function toProductionProject<
  Work extends LegacyProductionWork,
  Project extends LegacyParentProject<Work>,
>(stored: Project) {
  const {
    projects: storedWorks,
    projectCount,
    canCreateProjects,
    canMoveProjects,
    ...project
  } = stored
  return {
    ...project,
    kind: 'project' as const,
    workCount: projectCount ?? storedWorks.length,
    canCreateWorks: Boolean(canCreateProjects),
    canMoveWorks: Boolean(canMoveProjects ?? stored.canManage),
    works: storedWorks.map((work) => toProductionWork(work, stored.id)),
  }
}

export function productionHierarchy<
  Work extends LegacyProductionWork,
  Project extends LegacyParentProject<Work>,
>(projects: readonly Project[]) {
  return {
    version: PRODUCTION_HIERARCHY_VERSION,
    projects: projects.map((project) => toProductionProject(project)),
  }
}
