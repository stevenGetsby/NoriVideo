import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Job } from 'bullmq'
import type { TaskJobData } from '@/lib/task/types'

const prismaMock = vi.hoisted(() => ({
  novelPromotionVoiceLine: { findUnique: vi.fn(), update: vi.fn() },
  novelPromotionProject: { findUnique: vi.fn() },
  novelPromotionEpisode: { findUnique: vi.fn() },
}))
const resolveModelSelectionMock = vi.hoisted(() => vi.fn())
const generateAudioMock = vi.hoisted(() => vi.fn())
const getExistingExternalIdMock = vi.hoisted(() => vi.fn())
const waitExternalResultMock = vi.hoisted(() => vi.fn())
const persistAudioMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/api-config', () => ({
  getProviderKey: (provider: string) => provider,
  resolveModelSelectionOrSingle: resolveModelSelectionMock,
}))
vi.mock('@/lib/generator-api', () => ({ generateAudio: generateAudioMock }))
vi.mock('@/lib/workers/utils', () => ({
  getTaskExistingExternalId: getExistingExternalIdMock,
  waitExternalResult: waitExternalResultMock,
}))
vi.mock('@/lib/storage', () => ({
  getSignedUrl: (key: string) => `signed://${key}`,
}))
vi.mock('@/lib/audio/persist', () => ({ persistGeneratedAudio: persistAudioMock }))

import { generateVoiceLine } from '@/lib/voice/generate-voice-line'

const job = { data: { taskId: 'task-1' } } as Job<TaskJobData>
const params = {
  projectId: 'project-1', episodeId: 'episode-1', lineId: 'line-1',
  userId: 'user-1', audioModel: 'kuaizi::speech-2.8-hd', job,
}

describe('generate voice line with Kuaizi', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.novelPromotionVoiceLine.findUnique.mockResolvedValue({
      id: 'line-1', episodeId: 'episode-1', speaker: 'Narrator', content: '你好，世界',
      emotionPrompt: null, emotionStrength: null,
    })
    prismaMock.novelPromotionProject.findUnique.mockResolvedValue({ characters: [] })
    prismaMock.novelPromotionEpisode.findUnique.mockResolvedValue({
      speakerVoices: JSON.stringify({ Narrator: {
        provider: 'kuaizi', voiceType: 'kuaizi', voiceId: 'kz-voice-1',
      } }),
    })
    resolveModelSelectionMock.mockResolvedValue({
      provider: 'kuaizi', modelId: 'speech-2.8-hd', modelKey: 'kuaizi::speech-2.8-hd',
    })
    getExistingExternalIdMock.mockResolvedValue(null)
    generateAudioMock.mockResolvedValue({ success: true, externalId: 'KUAIZI:AUDIO:task-1' })
    waitExternalResultMock.mockResolvedValue({
      url: 'https://media.example/audio.wav', downloadHeaders: { Authorization: 'download-token' },
    })
    persistAudioMock.mockResolvedValue({ storageKey: 'voice/generated.wav', durationSeconds: 1.234 })
  })

  it('submits a MiniMax voice ID, polls and persists the real duration', async () => {
    await expect(generateVoiceLine(params)).resolves.toEqual({
      lineId: 'line-1', audioUrl: 'signed://voice/generated.wav',
      storageKey: 'voice/generated.wav', audioDuration: 1234,
    })
    expect(generateAudioMock).toHaveBeenCalledWith('user-1', 'kuaizi::speech-2.8-hd', '你好，世界', { voice: 'kz-voice-1' })
    expect(waitExternalResultMock).toHaveBeenCalledWith(job, 'KUAIZI:AUDIO:task-1', 'user-1', { progressStart: 25, progressEnd: 88 })
    expect(persistAudioMock).toHaveBeenCalledWith({
      source: 'https://media.example/audio.wav', projectId: 'project-1',
      downloadHeaders: { Authorization: 'download-token' },
    })
    expect(prismaMock.novelPromotionVoiceLine.update).toHaveBeenCalledWith({
      where: { id: 'line-1' }, data: { audioUrl: 'voice/generated.wav', audioDuration: 1234 },
    })
  })

  it('resumes an existing external task without submitting another generation', async () => {
    getExistingExternalIdMock.mockResolvedValue('KUAIZI:AUDIO:existing')
    await generateVoiceLine(params)
    expect(generateAudioMock).not.toHaveBeenCalled()
    expect(waitExternalResultMock).toHaveBeenCalledWith(job, 'KUAIZI:AUDIO:existing', 'user-1', expect.any(Object))
  })

  it('uses an explicit Kuaizi reference audio for Seed Audio', async () => {
    resolveModelSelectionMock.mockResolvedValue({ provider: 'kuaizi', modelId: 'seed-audio', modelKey: 'kuaizi::seed-audio' })
    prismaMock.novelPromotionEpisode.findUnique.mockResolvedValue({ speakerVoices: JSON.stringify({ Narrator: {
      provider: 'kuaizi', voiceType: 'uploaded', audioUrl: 'voice/reference.wav',
    } }) })
    await generateVoiceLine({ ...params, audioModel: 'kuaizi::seed-audio' })
    expect(generateAudioMock).toHaveBeenCalledWith('user-1', 'kuaizi::seed-audio', '你好，世界', { voice: 'voice/reference.wav' })
  })

  it('does not reuse a legacy Bailian voice ID for MiniMax', async () => {
    prismaMock.novelPromotionEpisode.findUnique.mockResolvedValue({ speakerVoices: JSON.stringify({ Narrator: {
      provider: 'bailian', voiceType: 'qwen-designed', voiceId: 'legacy-bailian',
    } }) })
    await expect(generateVoiceLine(params)).rejects.toThrow('请先为该发言人绑定 Kuaizi 音色 ID')
    expect(generateAudioMock).not.toHaveBeenCalled()
  })

  it('rejects unsupported audio providers before submission', async () => {
    resolveModelSelectionMock.mockResolvedValue({ provider: 'bailian', modelId: 'legacy', modelKey: 'bailian::legacy' })
    await expect(generateVoiceLine(params)).rejects.toThrow('AUDIO_PROVIDER_UNSUPPORTED')
    expect(generateAudioMock).not.toHaveBeenCalled()
  })
})
