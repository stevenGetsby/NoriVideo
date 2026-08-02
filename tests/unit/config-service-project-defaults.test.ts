import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  novelPromotionProject: {
    findUnique: vi.fn(),
  },
  userPreference: {
    findUnique: vi.fn(),
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

describe('config-service project model defaults', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('falls back to user default models for every project model field', async () => {
    prismaMock.novelPromotionProject.findUnique.mockResolvedValue({
      analysisModel: null,
      characterModel: null,
      locationModel: null,
      storyboardModel: null,
      editModel: null,
      videoModel: null,
      audioModel: null,
      videoRatio: null,
      artStyle: null,
      artStylePrompt: null,
      capabilityOverrides: null,
    })
    prismaMock.userPreference.findUnique.mockResolvedValue({
      analysisModel: 'llm::analysis',
      characterModel: 'image::character',
      locationModel: 'image::location',
      storyboardModel: 'image::storyboard',
      editModel: 'image::edit',
      videoModel: 'video::default',
      audioModel: 'audio::default',
      capabilityDefaults: null,
    })

    const { getProjectModelConfig } = await import('@/lib/config-service')
    const config = await getProjectModelConfig('project-1', 'user-1')

    expect(config.analysisModel).toBe('nori::nori-gpt')
    expect(config.characterModel).toBe('nori::nori-image')
    expect(config.locationModel).toBe('nori::nori-image')
    expect(config.storyboardModel).toBe('nori::nori-image')
    expect(config.editModel).toBe('nori::nori-image')
    expect(config.videoModel).toBe('nori::seedance2.0')
    expect(config.audioModel).toBe('audio::default')
  })

  it('keeps explicit project model overrides ahead of user defaults', async () => {
    prismaMock.novelPromotionProject.findUnique.mockResolvedValue({
      analysisModel: 'nori::nori-deepseek',
      characterModel: 'nori::nori-image-pro',
      locationModel: null,
      storyboardModel: 'nori::nori-image',
      editModel: null,
      videoModel: 'project-video::model',
      audioModel: null,
      videoRatio: '9:16',
      artStyle: null,
      artStylePrompt: null,
      capabilityOverrides: null,
    })
    prismaMock.userPreference.findUnique.mockResolvedValue({
      analysisModel: 'nori::nori-gpt',
      characterModel: 'nori::nori-image',
      locationModel: 'nori::nori-image-pro',
      storyboardModel: 'nori::nori-image-pro',
      editModel: 'nori::nori-image-pro',
      videoModel: 'nori::seedance2.0',
      audioModel: 'user-audio::model',
      capabilityDefaults: null,
    })

    const { getProjectModelConfig } = await import('@/lib/config-service')
    const config = await getProjectModelConfig('project-1', 'user-1')

    expect(config.analysisModel).toBe('nori::nori-deepseek')
    expect(config.characterModel).toBe('nori::nori-image-pro')
    expect(config.locationModel).toBe('nori::nori-image-pro')
    expect(config.storyboardModel).toBe('nori::nori-image')
    expect(config.editModel).toBe('nori::nori-image-pro')
    expect(config.videoModel).toBe('nori::seedance2.0')
    expect(config.audioModel).toBe('user-audio::model')
  })

  it('uses stable Nori business models as final fallbacks', async () => {
    prismaMock.novelPromotionProject.findUnique.mockResolvedValue({
      analysisModel: null,
      characterModel: null,
      locationModel: null,
      storyboardModel: null,
      editModel: null,
      videoModel: null,
      audioModel: null,
      videoRatio: null,
      artStyle: null,
      artStylePrompt: null,
      capabilityOverrides: null,
    })
    prismaMock.userPreference.findUnique.mockResolvedValue({
      analysisModel: null,
      characterModel: null,
      locationModel: null,
      storyboardModel: null,
      editModel: null,
      videoModel: null,
      audioModel: null,
      capabilityDefaults: null,
    })

    const { getProjectModelConfig, getUserModelConfig } = await import('@/lib/config-service')

    await expect(getProjectModelConfig('project-1', 'user-1')).resolves.toEqual(
      expect.objectContaining({ analysisModel: 'nori::nori-gpt', videoModel: 'nori::seedance2.0' }),
    )
    await expect(getUserModelConfig('user-1')).resolves.toEqual(
      expect.objectContaining({ analysisModel: 'nori::nori-gpt', videoModel: 'nori::seedance2.0' }),
    )
  })
})
