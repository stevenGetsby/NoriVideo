import { ApiError } from '@/lib/api-errors'
import { prisma } from '@/lib/prisma'

export type WorkflowScope = {
  episodeId: string | null
  scopeId: string
}

export function readWorkflowEpisodeId(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export async function resolveWorkflowScope(params: {
  projectId: string
  episodeId?: unknown
}): Promise<WorkflowScope> {
  const episodeId = readWorkflowEpisodeId(params.episodeId)
  if (!episodeId) {
    return {
      episodeId: null,
      scopeId: 'project',
    }
  }

  const episode = await prisma.novelPromotionEpisode.findFirst({
    where: {
      id: episodeId,
      novelPromotionProject: {
        projectId: params.projectId,
      },
    },
    select: { id: true },
  })

  if (!episode) {
    throw new ApiError('NOT_FOUND')
  }

  return {
    episodeId,
    scopeId: episode.id,
  }
}
