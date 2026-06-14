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

    expect(config.analysisModel).toBe('llm::analysis')
    expect(config.characterModel).toBe('image::character')
    expect(config.locationModel).toBe('image::location')
    expect(config.storyboardModel).toBe('image::storyboard')
    expect(config.editModel).toBe('image::edit')
    expect(config.videoModel).toBe('video::default')
    expect(config.audioModel).toBe('audio::default')
  })

  it('keeps explicit project model overrides ahead of user defaults', async () => {
    prismaMock.novelPromotionProject.findUnique.mockResolvedValue({
      analysisModel: 'project-llm::analysis',
      characterModel: 'project-image::character',
      locationModel: null,
      storyboardModel: 'project-image::storyboard',
      editModel: null,
      videoModel: 'project-video::model',
      audioModel: null,
      videoRatio: '9:16',
      artStyle: null,
      artStylePrompt: null,
      capabilityOverrides: null,
    })
    prismaMock.userPreference.findUnique.mockResolvedValue({
      analysisModel: 'user-llm::analysis',
      characterModel: 'user-image::character',
      locationModel: 'user-image::location',
      storyboardModel: 'user-image::storyboard',
      editModel: 'user-image::edit',
      videoModel: 'user-video::model',
      audioModel: 'user-audio::model',
      capabilityDefaults: null,
    })

    const { getProjectModelConfig } = await import('@/lib/config-service')
    const config = await getProjectModelConfig('project-1', 'user-1')

    expect(config.analysisModel).toBe('project-llm::analysis')
    expect(config.characterModel).toBe('project-image::character')
    expect(config.locationModel).toBe('user-image::location')
    expect(config.storyboardModel).toBe('project-image::storyboard')
    expect(config.editModel).toBe('user-image::edit')
    expect(config.videoModel).toBe('project-video::model')
    expect(config.audioModel).toBe('user-audio::model')
  })

  it('uses Lumina GPT-5.5 as the final analysis fallback', async () => {
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
      expect.objectContaining({ analysisModel: 'lumina::gpt-5.5' }),
    )
    await expect(getUserModelConfig('user-1')).resolves.toEqual(
      expect.objectContaining({ analysisModel: 'lumina::gpt-5.5' }),
    )
  })
})
