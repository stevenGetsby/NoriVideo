import { prisma } from '@/lib/prisma'

export const EXPORT_PROJECT_SCOPE_ID = 'project'

export type ExportScope = {
  episodeId: string | null
  scopeId: string
}

export function readExportEpisodeId(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export async function resolveExportScope(params: {
  projectId: string
  episodeId?: unknown
}): Promise<ExportScope | null> {
  const episodeId = readExportEpisodeId(params.episodeId)
  if (!episodeId) {
    return {
      episodeId: null,
      scopeId: EXPORT_PROJECT_SCOPE_ID,
    }
  }

  const episode = await prisma.novelPromotionEpisode.findFirst({
    where: {
      id: episodeId,
      novelPromotionProject: { projectId: params.projectId },
    },
    select: { id: true },
  })

  if (!episode) return null

  return {
    episodeId: episode.id,
    scopeId: episode.id,
  }
}
