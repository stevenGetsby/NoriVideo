import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireProjectAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { getProjectModelConfig, extractModelKey } from '@/lib/config-service'
import { createArtifact } from '@/lib/run-runtime/service'
import {
  executeAssetExtraction,
  type AssetExtractionEpisodeInput,
} from '@/lib/novel-promotion/asset-extraction'

export const runtime = 'nodejs'

type RequestBody = {
  episodes?: unknown
  model?: unknown
  runId?: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readEpisodeNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(1, Math.floor(value))
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseInt(value, 10)
    if (Number.isFinite(parsed)) return Math.max(1, parsed)
  }
  return 0
}

function normalizeRequestEpisodes(value: unknown): AssetExtractionEpisodeInput[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item): AssetExtractionEpisodeInput | null => {
      if (!isRecord(item)) return null
      const episodeNumber = readEpisodeNumber(item.episodeNumber)
      const title = readString(item.title) || (episodeNumber ? `第${episodeNumber}集` : '')
      const sourceText = readString(item.sourceText)
      if (!episodeNumber || !sourceText) return null
      return {
        episodeNumber,
        title,
        sourceText,
      }
    })
    .filter((item): item is AssetExtractionEpisodeInput => !!item)
}

async function loadProjectEpisodes(novelPromotionProjectId: string): Promise<AssetExtractionEpisodeInput[]> {
  const episodes = await prisma.novelPromotionEpisode.findMany({
    where: { novelPromotionProjectId },
    orderBy: { episodeNumber: 'asc' },
    select: {
      episodeNumber: true,
      name: true,
      description: true,
      novelText: true,
    },
  })

  return episodes
    .map((episode) => {
      const sourceText = readString(episode.novelText) || readString(episode.description)
      if (!sourceText) return null
      return {
        episodeNumber: episode.episodeNumber,
        title: episode.name || `第${episode.episodeNumber}集`,
        sourceText,
      }
    })
    .filter((item): item is AssetExtractionEpisodeInput => !!item)
}

async function assertRunWritable(params: {
  runId: string
  projectId: string
  userId: string
}) {
  const run = await prisma.graphRun.findUnique({
    where: { id: params.runId },
    select: {
      id: true,
      projectId: true,
      userId: true,
    },
  })
  if (!run || run.projectId !== params.projectId || run.userId !== params.userId) {
    throw new ApiError('NOT_FOUND')
  }
}

export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params
  const authResult = await requireProjectAuth(projectId)
  if (isErrorResponse(authResult)) return authResult
  const { session, novelData } = authResult

  const body = await request.json().catch(() => ({})) as RequestBody
  const requestEpisodes = normalizeRequestEpisodes(body.episodes)
  const episodes = requestEpisodes.length > 0
    ? requestEpisodes
    : await loadProjectEpisodes(novelData.id)
  if (episodes.length === 0) {
    throw new ApiError('INVALID_PARAMS')
  }

  const config = await getProjectModelConfig(projectId, session.user.id)
  const requestedModel = readString(body.model)
  const model = extractModelKey(requestedModel) || config.analysisModel
  if (!model) {
    throw new ApiError('INVALID_PARAMS')
  }

  const result = await executeAssetExtraction({
    userId: session.user.id,
    projectId,
    model,
    episodes,
  })

  const runId = readString(body.runId)
  let artifact: { id: string; runId: string } | null = null
  if (runId) {
    await assertRunWritable({
      runId,
      projectId,
      userId: session.user.id,
    })
    const saved = await createArtifact({
      runId,
      stepKey: 'asset_extraction',
      artifactType: 'asset_extraction.package',
      refId: projectId,
      payload: result.package as unknown as Record<string, unknown>,
    })
    artifact = {
      id: saved.id,
      runId: saved.runId,
    }
  }

  return NextResponse.json({
    package: result.package,
    artifact,
    usage: result.usage,
  })
})
