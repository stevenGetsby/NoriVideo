import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { resolveAnalysisModel } from '@/lib/workers/handlers/resolve-analysis-model'
import { runVoiceMappingReview } from '@/lib/novel-promotion/voice-mapping-runtime'
import { buildSpeakerVoiceMapFromVoiceMapping } from '@/lib/novel-promotion/voice-mapping-binding'
import {
  parseSpeakerVoiceMap,
  stringifySpeakerVoiceMapPreservingPrivateEntries,
} from '@/lib/voice/provider-voice-binding'
import {
  buildVoiceMappingFrameOSMetadata,
  writeVoiceMappingFrameOSMetadataToSpeakerVoices,
} from '@/lib/novel-promotion/voice-mapping-metadata'

function readText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readBoolean(value: unknown): boolean {
  return value === true || value === 'true'
}

export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params
  const body = await request.json().catch(() => ({}))
  const episodeId = readText(body?.episodeId)
  const shouldApply = readBoolean(body?.apply)
  const shouldApplySpeakerVoices = readBoolean(body?.applySpeakerVoices)
  const shouldStoreMappingMetadata =
    readBoolean(body?.storeMappingMetadata) || shouldApply || shouldApplySpeakerVoices

  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  const novelData = await prisma.novelPromotionProject.findUnique({
    where: { projectId },
    include: {
      characters: true,
      episodes: {
        where: episodeId ? { id: episodeId } : undefined,
        orderBy: { episodeNumber: 'asc' },
        include: {
          voiceLines: {
            orderBy: { lineIndex: 'asc' },
          },
        },
      },
    },
  })
  if (!novelData) {
    throw new ApiError('NOT_FOUND')
  }
  if (episodeId && novelData.episodes.length === 0) {
    throw new ApiError('NOT_FOUND')
  }

  const voiceLibrary = await prisma.globalVoice.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: 'desc' },
  })
  const model = await resolveAnalysisModel({
    userId: session.user.id,
    inputModel: body?.model,
    projectAnalysisModel: novelData.analysisModel,
  })
  const result = await runVoiceMappingReview({
    userId: session.user.id,
    projectId,
    model,
    locale: request.nextUrl.searchParams.get('locale') === 'en' ? 'en' : 'zh',
    input: {
      characters: novelData.characters,
      episodes: novelData.episodes,
      voiceLibrary,
      extraDialogueSamples: Array.isArray(body?.dialogueSamples)
        ? body.dialogueSamples.filter((item: unknown) => item && typeof item === 'object') as Record<string, unknown>[]
        : [],
      extraVoiceLibrary: Array.isArray(body?.voiceLibrary)
        ? body.voiceLibrary.filter((item: unknown) => item && typeof item === 'object') as Record<string, unknown>[]
        : [],
    },
  })

  if (shouldApply) {
    for (const update of result.plan.updates) {
      await prisma.novelPromotionCharacter.update({
        where: { id: update.characterId },
        data: update.data,
      })
    }
  }
  const speakerVoicePlans: Array<{
    episodeId: string
    applied: boolean
    metadataStored: boolean
    speakerVoices: Record<string, unknown>
    skipped: unknown[]
  }> = []
  const voiceMappingMetadata = shouldStoreMappingMetadata
    ? buildVoiceMappingFrameOSMetadata({
      mapping: result.mapping,
      plan: result.plan,
      reasoning: result.reasoning,
    })
    : null
  if (shouldApplySpeakerVoices || shouldStoreMappingMetadata) {
    for (const episode of novelData.episodes) {
      const speakers = Array.from(new Set(
        (episode.voiceLines || [])
          .map((line) => readText(line.speaker))
          .filter(Boolean),
      ))
      const speakerPlan = shouldApplySpeakerVoices
        ? buildSpeakerVoiceMapFromVoiceMapping({
          mappings: result.mapping,
          speakers,
        })
        : { speakerVoices: {}, skipped: [] }
      const hasAppliedSpeakerVoices = shouldApplySpeakerVoices && Object.keys(speakerPlan.speakerVoices).length > 0
      let speakerVoicesToStore = episode.speakerVoices || null
      if (hasAppliedSpeakerVoices) {
        const existingSpeakerVoices = parseSpeakerVoiceMap(episode.speakerVoices)
        const nextSpeakerVoices = {
          ...existingSpeakerVoices,
          ...speakerPlan.speakerVoices,
        }
        speakerVoicesToStore = stringifySpeakerVoiceMapPreservingPrivateEntries(
          episode.speakerVoices,
          nextSpeakerVoices,
        )
      }
      if (voiceMappingMetadata) {
        speakerVoicesToStore = writeVoiceMappingFrameOSMetadataToSpeakerVoices(
          speakerVoicesToStore,
          voiceMappingMetadata,
        )
      }
      if (hasAppliedSpeakerVoices || voiceMappingMetadata) {
        await prisma.novelPromotionEpisode.update({
          where: { id: episode.id },
          data: {
            speakerVoices: speakerVoicesToStore,
          },
        })
      }
      speakerVoicePlans.push({
        episodeId: episode.id,
        applied: hasAppliedSpeakerVoices,
        metadataStored: Boolean(voiceMappingMetadata),
        speakerVoices: speakerPlan.speakerVoices,
        skipped: speakerPlan.skipped,
      })
    }
  }

  return NextResponse.json({
    success: true,
    model,
    applied: shouldApply,
    speakerVoicesApplied: shouldApplySpeakerVoices,
    mappingMetadataStored: shouldStoreMappingMetadata,
    mapping: result.mapping,
    plan: result.plan,
    speakerVoicePlans,
    promptPayload: result.promptPayload,
    reasoning: result.reasoning,
  })
})
