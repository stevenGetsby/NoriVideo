import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSignedUrl } from '@/lib/storage'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { resolveStorageKeyFromMediaValue } from '@/lib/media/service'
import {
  parseSpeakerVoiceMap,
  stringifySpeakerVoiceMapPreservingPrivateEntries,
  type SpeakerVoiceMap,
} from '@/lib/voice/provider-voice-binding'

function readTrimmedString(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const value = input.trim()
  return value.length > 0 ? value : null
}

function signUrlIfNeeded(url: string): string {
  if (url.startsWith('http')) return url
  return getSignedUrl(url, 7200)
}

async function getProjectEpisode(projectId: string, episodeId: string) {
  const projectData = await prisma.novelPromotionProject.findUnique({
    where: { projectId },
    select: { id: true },
  })
  if (!projectData) {
    throw new ApiError('NOT_FOUND')
  }

  const episode = await prisma.novelPromotionEpisode.findFirst({
    where: { id: episodeId, novelPromotionProjectId: projectData.id },
  })
  if (!episode) {
    throw new ApiError('NOT_FOUND')
  }

  return episode
}

/**
 * GET /api/novel-promotion/[projectId]/speaker-voice?episodeId=xxx
 * 获取剧集的发言人音色配置
 */
export const GET = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) => {
  const { projectId } = await context.params
  const { searchParams } = new URL(request.url)
  const episodeId = searchParams.get('episodeId')

  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  if (!episodeId) {
    throw new ApiError('INVALID_PARAMS')
  }

  const episode = await getProjectEpisode(projectId, episodeId)

  const storedSpeakerVoices = parseSpeakerVoiceMap(episode.speakerVoices)
  const speakerVoices: SpeakerVoiceMap = {}

  for (const [speaker, voice] of Object.entries(storedSpeakerVoices)) {
    if (voice.provider === 'fal') {
      speakerVoices[speaker] = {
        provider: 'fal',
        voiceType: voice.voiceType,
        audioUrl: signUrlIfNeeded(voice.audioUrl),
      }
      continue
    }

    if (voice.provider === 'kuaizi') {
      const audioUrl = voice.audioUrl ? signUrlIfNeeded(voice.audioUrl) : undefined
      const previewAudioUrl = voice.previewAudioUrl ? signUrlIfNeeded(voice.previewAudioUrl) : undefined
      speakerVoices[speaker] = {
        provider: 'kuaizi',
        voiceType: voice.voiceType,
        ...(voice.voiceId ? { voiceId: voice.voiceId } : {}),
        ...(audioUrl ? { audioUrl } : {}),
        ...(previewAudioUrl ? { previewAudioUrl } : {}),
      }
      continue
    }

    const previewAudioUrl = voice.previewAudioUrl ? signUrlIfNeeded(voice.previewAudioUrl) : undefined
    speakerVoices[speaker] = {
      provider: 'bailian',
      voiceType: voice.voiceType,
      voiceId: voice.voiceId,
      ...(previewAudioUrl ? { previewAudioUrl } : {}),
    }
  }

  return NextResponse.json({ speakerVoices })
})

/**
 * PATCH /api/novel-promotion/[projectId]/speaker-voice
 * 为指定发言人直接设置音色（写入 episode.speakerVoices JSON）
 * 用于不在资产库中的角色在配音阶段内联绑定音色
 */
export const PATCH = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) => {
  const { projectId } = await context.params

  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const body = await request.json().catch(() => null)
  const episodeId = readTrimmedString(body?.episodeId) ?? ''
  const speaker = readTrimmedString(body?.speaker) ?? ''
  const voiceType = readTrimmedString(body?.voiceType) ?? 'uploaded'
  const provider = readTrimmedString(body?.provider)?.toLowerCase()
  if (provider !== 'kuaizi') {
    throw new ApiError('INVALID_PARAMS')
  }
  const audioUrl = readTrimmedString(body?.audioUrl)
  const previewAudioUrl = readTrimmedString(body?.previewAudioUrl)
  const voiceId = readTrimmedString(body?.voiceId)

  if (!episodeId || !speaker || (!voiceId && !audioUrl)) {
    throw new ApiError('INVALID_PARAMS')
  }

  const episode = await getProjectEpisode(projectId, episodeId)
  const speakerVoices = parseSpeakerVoiceMap(episode.speakerVoices)
  const resolvedAudioKey = audioUrl ? await resolveStorageKeyFromMediaValue(audioUrl) : null
  const previewCandidate = previewAudioUrl || audioUrl
  const resolvedPreviewKey = previewCandidate ? await resolveStorageKeyFromMediaValue(previewCandidate) : null

  speakerVoices[speaker] = {
    provider: 'kuaizi',
    voiceType,
    ...(voiceId ? { voiceId } : {}),
    ...(audioUrl ? { audioUrl: resolvedAudioKey || audioUrl } : {}),
    ...(previewCandidate ? { previewAudioUrl: resolvedPreviewKey || previewCandidate } : {}),
  }

  await prisma.novelPromotionEpisode.update({
    where: { id: episodeId },
    data: { speakerVoices: stringifySpeakerVoiceMapPreservingPrivateEntries(episode.speakerVoices, speakerVoices) },
  })

  return NextResponse.json({ success: true })
})
