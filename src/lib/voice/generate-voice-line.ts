import { prisma } from '@/lib/prisma'
import { getProviderKey, resolveModelSelectionOrSingle } from '@/lib/api-config'
import { getSignedUrl } from '@/lib/storage'
import { generateAudio } from '@/lib/generator-api'
import { getTaskExistingExternalId, waitExternalResult } from '@/lib/workers/utils'
import type { Job } from 'bullmq'
import type { TaskJobData } from '@/lib/task/types'
import { getKuaiziModelDefinition } from '@/lib/providers/kuaizi/catalog'
import { persistGeneratedAudio } from '@/lib/audio/persist'
import {
  parseSpeakerVoiceMap,
  resolveVoiceBindingForProvider,
  type CharacterVoiceFields,
  type SpeakerVoiceMap,
} from '@/lib/voice/provider-voice-binding'

type CheckCancelled = () => Promise<void>
type CharacterVoiceProfile = CharacterVoiceFields & { name: string }

function matchCharacterBySpeaker(
  speaker: string,
  characters: CharacterVoiceProfile[],
) {
  const exactMatch = characters.find((character) => character.name === speaker)
  if (exactMatch) return exactMatch
  return characters.find((character) => character.name.includes(speaker) || speaker.includes(character.name))
}

export async function generateVoiceLine(params: {
  projectId: string
  episodeId?: string | null
  lineId: string
  userId: string
  audioModel?: string
  job: Job<TaskJobData>
  checkCancelled?: CheckCancelled
}) {
  const checkCancelled = params.checkCancelled

  const line = await prisma.novelPromotionVoiceLine.findUnique({
    where: { id: params.lineId },
    select: {
      id: true,
      episodeId: true,
      speaker: true,
      content: true,
      emotionPrompt: true,
      emotionStrength: true,
    },
  })
  if (!line) {
    throw new Error('Voice line not found')
  }

  const episodeId = params.episodeId || line.episodeId
  if (!episodeId) {
    throw new Error('episodeId is required')
  }

  const [projectData, episode] = await Promise.all([
    prisma.novelPromotionProject.findUnique({
      where: { projectId: params.projectId },
      include: { characters: true },
    }),
    prisma.novelPromotionEpisode.findUnique({
      where: { id: episodeId },
      select: { speakerVoices: true },
    }),
  ])

  if (!projectData) {
    throw new Error('Novel promotion project not found')
  }

  const speakerVoices: SpeakerVoiceMap = parseSpeakerVoiceMap(episode?.speakerVoices)

  const character = matchCharacterBySpeaker(line.speaker, projectData.characters || [])
  const speakerVoice = speakerVoices[line.speaker]

  const text = (line.content || '').trim()
  if (!text) {
    throw new Error('Voice line text is empty')
  }

  const audioSelection = await resolveModelSelectionOrSingle(params.userId, params.audioModel, 'audio')
  const providerKey = getProviderKey(audioSelection.provider).toLowerCase()
  if (providerKey !== 'kuaizi') {
    throw new Error(`AUDIO_PROVIDER_UNSUPPORTED: ${audioSelection.provider}`)
  }
  const model = getKuaiziModelDefinition(audioSelection.modelId, 'audio')
  const voiceBinding = resolveVoiceBindingForProvider({
    providerKey,
    modelId: model.modelId,
    character,
    speakerVoice,
  })
  if (!voiceBinding || voiceBinding.provider !== 'kuaizi') {
    throw new Error(model.family === 'minimax-tts'
      ? '请先为该发言人绑定 Kuaizi 音色 ID'
      : '请先为该发言人上传参考音频')
  }

  const existingExternalId = await getTaskExistingExternalId(params.job.data.taskId)
  const source = existingExternalId || await (async () => {
    const generated = await generateAudio(params.userId, audioSelection.modelKey, text, {
      ...(voiceBinding.voiceId ? { voice: voiceBinding.voiceId } : {}),
      ...(voiceBinding.referenceAudioUrl ? { voice: voiceBinding.referenceAudioUrl } : {}),
    })
    if (!generated.success || !generated.externalId) {
      throw new Error(generated.error || 'Kuaizi 音频服务没有返回可轮询的任务。')
    }
    return generated.externalId
  })()
  const polled = await waitExternalResult(params.job, source, params.userId, {
    progressStart: 25,
    progressEnd: 88,
  })
  const persisted = await persistGeneratedAudio({
    source: polled.url,
    projectId: params.projectId,
    downloadHeaders: polled.downloadHeaders,
  })
  const audioDuration = persisted.durationSeconds === null ? null : Math.round(persisted.durationSeconds * 1000)

  await checkCancelled?.()

  await prisma.novelPromotionVoiceLine.update({
    where: { id: line.id },
    data: {
      audioUrl: persisted.storageKey,
      audioDuration,
    },
  })

  const signedUrl = getSignedUrl(persisted.storageKey, 7200)
  return {
    lineId: line.id,
    audioUrl: signedUrl,
    storageKey: persisted.storageKey,
    audioDuration,
  }
}

export function estimateVoiceLineMaxSeconds(content: string | null | undefined) {
  const chars = typeof content === 'string' ? content.length : 0
  return Math.max(5, Math.ceil(chars / 2))
}
