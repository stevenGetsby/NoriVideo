import type { Prisma } from '@prisma/client'

export function buildWorkSearchWhere(search: string): Prisma.WorkWhereInput | null {
  const normalized = search.trim()
  if (!normalized) return null
  return {
    OR: [
      { name: { contains: normalized } },
      { projects: { some: { OR: [
        { name: { contains: normalized } },
        { description: { contains: normalized } },
      ] } } },
    ],
  }
}

export function buildMemberCandidateExclusionWhere(input: {
  actorId: string
  creatorId?: string | null
  workId?: string | null
  projectId?: string | null
}): Prisma.UserWhereInput {
  const excludedIds = Array.from(new Set([input.actorId, input.creatorId]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)))
  return {
    ...(excludedIds.length > 0 ? { id: { notIn: excludedIds } } : {}),
    ...(input.workId ? { workMemberships: { none: { workId: input.workId } } } : {}),
    ...(input.projectId ? { projectMemberships: { none: { projectId: input.projectId } } } : {}),
  }
}
