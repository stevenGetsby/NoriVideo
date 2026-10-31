import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'

const prismaMock = vi.hoisted(() => ({
  frameosToolboxAsset: {
    findFirst: vi.fn(),
    update: vi.fn(async () => ({})),
  },
  frameosMaterial: {
    findFirst: vi.fn(),
  },
  novelPromotionCharacter: {
    findFirst: vi.fn(async () => ({ id: 'character-1' })),
  },
}))

const utilsMock = vi.hoisted(() => ({
  assertTaskActive: vi.fn(async () => undefined),
  resolveImageSourceFromGeneration: vi.fn(async () => 'https://provider.example/toolbox.png'),
  uploadImageSourceToCos: vi.fn(async () => 'images/toolbox-image.png'),
  toSignedUrlIfCos: vi.fn((value: string) => value),
  withLabelBar: vi.fn(async (value: unknown) => value),
  resolveVideoSourceFromGeneration: vi.fn(async () => ({
    url: 'https://provider.example/toolbox.mp4',
    actualVideoTokens: 64000,
    durationSeconds: 6.25,
    resolution: '480p',
    downloadHeaders: { Authorization: 'Bearer provider-token' },
  })),
  uploadVideoSourceToCos: vi.fn(async () => 'video/toolbox-video.mp4'),
}))

const materialMock = vi.hoisted(() => ({
  registerFrameosMaterial: vi.fn(async (input: Record<string, unknown>) => ({
    id: input.type === 'video' ? 'material-video-1' : 'material-image-1',
    ...input,
  })),
}))

const outboundMock = vi.hoisted(() => ({
  normalizeToPublicImageUrlForGeneration: vi.fn(async (value: string) => {
    const index = /(?:reference|ref|image)[-_]?(\d)/.exec(value)?.[1] || '1'
    return `https://public.example/reference-${index}.png`
  }),
  normalizeReferenceImagesForGeneration: vi.fn(async (values: string[]) => (
    values.map((_, index) => `https://public.example/reference-${index + 1}.png`)
  )),
  normalizeToOriginalMediaUrl: vi.fn(async (value: string) => `https://public.example/${value.split('/').pop()}`),
}))

const seedanceCharacterAssetMock = vi.hoisted(() => ({
  ensureSeedanceCharacterAsset: vi.fn(async () => ({
    assetId: 'private-character-1',
    assetUri: 'asset://private-character-1',
    appearanceId: 'appearance-1',
  })),
  ensureSeedanceToolboxReferenceAssets: vi.fn(async () => [
    'asset://private-toolbox-reference-1',
  ]),
}))

const storageMock = vi.hoisted(() => ({
  getObjectBuffer: vi.fn(async () => Buffer.from('video')),
  generateUniqueKey: vi.fn(() => 'voice/custom/project-1/character-1/audition.mp3'),
  uploadObject: vi.fn(async () => 'voice/custom/project-1/character-1/audition.mp3'),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/workers/utils', () => utilsMock)
vi.mock('@/lib/workers/shared', () => ({ reportTaskProgress: vi.fn(async () => undefined) }))
vi.mock('@/lib/frameos/material-service', () => materialMock)
vi.mock('@/lib/media/outbound-image', () => outboundMock)
vi.mock('@/lib/media/service', () => ({
  resolveMediaRef: vi.fn(async () => null),
  mediaUrlFromRef: vi.fn(() => null),
  resolveMediaRefFromLegacyValue: vi.fn(async () => null),
}))
vi.mock('@/lib/novel-promotion/seedance-character-asset', () => seedanceCharacterAssetMock)
vi.mock('@/lib/storage', () => storageMock)
vi.mock('@/lib/canvas/video-operations', () => ({
  enhanceCanvasVideo: vi.fn(async () => ({
    body: Buffer.from('enhanced-video'),
    width: 1280,
    height: 720,
    duration: 6.25,
    fps: 24,
  })),
}))
vi.mock('@/lib/media/video-audio', () => ({
  extractVoiceAudioFromVideo: vi.fn(async () => Buffer.from('audio')),
}))

import { handleToolboxImageTask } from '@/lib/workers/handlers/toolbox-image-task-handler'
import { handleToolboxVideoTask } from '@/lib/workers/handlers/toolbox-video-task-handler'
import { enhanceCanvasVideo } from '@/lib/canvas/video-operations'

function buildJob(type: TaskJobData['type'], payload: Record<string, unknown>): Job<TaskJobData> {
  return {
    data: {
      taskId: `task-${type}`,
      type,
      locale: 'zh',
      projectId: 'project-1',
      targetType: 'FrameosToolboxAsset',
      targetId: `asset-${type}`,
      payload: { ownerName: '资产师甲', ...payload },
      userId: 'user-1',
    },
  } as unknown as Job<TaskJobData>
}

describe('toolbox task handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.frameosToolboxAsset.findFirst.mockImplementation(async ({ where }: { where: { id: string; type: string } }) => ({
      id: where.id,
      type: where.type,
    }))
    prismaMock.frameosMaterial.findFirst.mockResolvedValue({ id: 'material-image-1' })
  })

  it('generates an image, registers it as a named toolbox material, and persists the link', async () => {
    const job = buildJob(TASK_TYPE.TOOLBOX_IMAGE, {
      title: '雨夜街巷',
      prompt: 'cinematic rainy alley',
      imageModel: 'image-provider::model-1',
      assetCategory: 'location',
      referenceImages: ['images/reference-a.png'],
      aspectRatio: '9:16',
      resolution: '2K',
      quality: 'high',
    })

    const result = await handleToolboxImageTask(job)

    expect(result).toEqual({
      assetId: 'asset-toolbox_image',
      materialId: 'material-image-1',
      imageUrl: 'images/toolbox-image.png',
    })
    expect(utilsMock.resolveImageSourceFromGeneration).toHaveBeenCalledWith(job, expect.objectContaining({
      modelId: 'image-provider::model-1',
      prompt: 'cinematic rainy alley',
      options: {
        referenceImages: ['images/reference-a.png'],
        aspectRatio: '9:16',
        resolution: '2K',
        quality: 'high',
      },
    }))
    expect(materialMock.registerFrameosMaterial).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      projectId: 'project-1',
      ownerName: '资产师甲',
      title: '雨夜街巷',
      type: 'image',
      source: 'toolbox',
      storageKey: 'images/toolbox-image.png',
      metadata: expect.objectContaining({ assetCategory: 'location' }),
    }))
    expect(prismaMock.frameosMaterial.findFirst).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        storageKey: 'images/toolbox-image.png',
        deletedAt: null,
      },
      orderBy: { createdAt: 'desc' },
    })
    expect(prismaMock.frameosToolboxAsset.update).toHaveBeenLastCalledWith({
      where: { id: 'asset-toolbox_image' },
      data: {
        status: 'ready',
        resultUrl: 'images/toolbox-image.png',
        materialId: 'material-image-1',
        errorMessage: null,
      },
    })
  })

  it('passes an image-edit mask independently from the single source image', async () => {
    const job = buildJob(TASK_TYPE.TOOLBOX_IMAGE, {
      title: '局部重绘结果',
      prompt: '只替换蒙版覆盖的窗户区域',
      imageModel: 'openai-compatible:oa-1::gpt-image-1',
      processType: 'image_edit',
      editMode: 'inpaint',
      referenceImages: ['images/source.png'],
      maskImage: 'images/source-mask.png',
      maskMaterialId: 'material-mask-1',
    })

    await handleToolboxImageTask(job)

    expect(utilsMock.resolveImageSourceFromGeneration).toHaveBeenCalledWith(job, expect.objectContaining({
      modelId: 'openai-compatible:oa-1::gpt-image-1',
      prompt: '只替换蒙版覆盖的窗户区域',
      options: expect.objectContaining({
        referenceImages: ['images/source.png'],
        editMode: 'inpaint',
        maskImage: 'images/source-mask.png',
      }),
    }))

    const generationCall = utilsMock.resolveImageSourceFromGeneration.mock.calls[0] as unknown as [
      unknown,
      { options?: { referenceImages?: string[]; maskImage?: string } },
    ] | undefined
    const generationOptions = generationCall?.[1].options
    expect(generationOptions?.referenceImages).toEqual(['images/source.png'])
    expect(generationOptions?.referenceImages).not.toContain('images/source-mask.png')
    expect(generationOptions?.maskImage).toBe('images/source-mask.png')
    expect(materialMock.registerFrameosMaterial).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({
        processType: 'image_edit',
        maskMaterialId: 'material-mask-1',
      }),
    }))
  })

  it('compiles @ material mentions and submits first/last frames in their selected order', async () => {
    const job = buildJob(TASK_TYPE.TOOLBOX_VIDEO, {
      title: '雨夜推镜',
      prompt: '@苏晚卿 从门边跑向 @柴房',
      videoModel: 'ark::doubao-seedance-2-0',
      assetCategory: 'shot',
      inputMode: 'firstlastframe',
      referenceImages: ['images/start.png', 'images/end.png'],
      referenceMaterialIds: ['material-start', 'material-end'],
      referenceMaterials: [
        { materialId: 'material-start', role: 'FIRST_FRAME' },
        { materialId: 'material-end', role: 'LAST_FRAME' },
      ],
      referenceImageRoles: ['FIRST_FRAME', 'LAST_FRAME'],
      referenceNames: ['苏晚卿', '柴房'],
      duration: 5,
      fps: 24,
      resolution: '1080p',
      aspectRatio: '9:16',
      generateAudio: true,
    })

    const result = await handleToolboxVideoTask(job)

    expect(utilsMock.resolveVideoSourceFromGeneration).toHaveBeenCalledWith(job, {
      userId: 'user-1',
      modelId: 'ark::doubao-seedance-2-0',
      imageUrl: 'https://public.example/reference-1.png',
      options: expect.objectContaining({
        prompt: '图片1中的苏晚卿 从门边跑向 图片2中的柴房',
        lastFrameImageUrl: 'https://public.example/reference-2.png',
        duration: 5,
        fps: 24,
        resolution: '1080p',
        aspectRatio: '9:16',
        generateAudio: true,
        generationMode: 'firstlastframe',
      }),
    })
    expect(utilsMock.uploadVideoSourceToCos).toHaveBeenCalledWith(
      'https://provider.example/toolbox.mp4',
      'toolbox-video',
      'asset-toolbox_video',
      { Authorization: 'Bearer provider-token' },
    )
    expect(materialMock.registerFrameosMaterial).toHaveBeenCalledWith(expect.objectContaining({
      ownerName: '资产师甲',
      title: '雨夜推镜',
      type: 'video',
      source: 'toolbox',
      storageKey: 'video/toolbox-video.mp4',
      metadata: expect.objectContaining({
        assetCategory: 'shot',
        referenceNames: ['苏晚卿', '柴房'],
      }),
    }))
    expect(result).toEqual({
      assetId: 'asset-toolbox_video',
      materialId: 'material-video-1',
      videoUrl: 'video/toolbox-video.mp4',
      actualVideoTokens: 64000,
      durationSeconds: 6.25,
      resolution: '480p',
    })
  })

  it('upscales after generation while retaining the billed model resolution', async () => {
    const job = buildJob(TASK_TYPE.TOOLBOX_VIDEO, {
      title: '自动超分镜头',
      prompt: '雨夜推镜',
      videoModel: 'kuaizi::doubao-seedance-2-5-260628',
      resolution: '480p',
      superresolveTarget: '720p',
    })
    storageMock.uploadObject.mockResolvedValueOnce('toolbox-video-superresolved/user-1/task-toolbox_video.mp4')

    const result = await handleToolboxVideoTask(job)

    expect(utilsMock.resolveVideoSourceFromGeneration).toHaveBeenCalledWith(job, expect.objectContaining({
      options: expect.objectContaining({ resolution: '480p' }),
    }))
    expect(enhanceCanvasVideo).toHaveBeenCalledWith(Buffer.from('video'), { target: '720p' }, expect.any(Object))
    expect(storageMock.uploadObject).toHaveBeenCalledWith(
      Buffer.from('enhanced-video'),
      'toolbox-video-superresolved/user-1/task-toolbox_video.mp4',
      1,
      'video/mp4',
    )
    expect(result).toMatchObject({
      videoUrl: 'toolbox-video-superresolved/user-1/task-toolbox_video.mp4',
      resolution: '480p',
      outputResolution: '720p',
      width: 1280,
      height: 720,
    })
    expect(materialMock.registerFrameosMaterial).toHaveBeenCalledWith(expect.objectContaining({
      storageKey: 'toolbox-video-superresolved/user-1/task-toolbox_video.mp4',
      metadata: expect.objectContaining({ resolution: '480p', outputResolution: '720p' }),
    }))
  })

  it('passes normalized image, video, and audio references to all-reference video generation', async () => {
    const job = buildJob(TASK_TYPE.TOOLBOX_VIDEO, {
      title: '全能参考镜头',
      prompt: '@苏晚卿 模仿 @奔跑动作 穿过雨夜，保留 @雨声',
      videoModel: 'hfsy::doubao-seedance-2-0',
      inputMode: 'text',
      referenceImages: ['images/su.png'],
      referenceVideos: ['video/run.mp4'],
      referenceAudios: ['voice/rain.wav'],
      referenceNames: ['奔跑动作', '雨声', '苏晚卿'],
      referenceImageNames: ['苏晚卿'],
      referenceVideoNames: ['奔跑动作'],
      referenceAudioNames: ['雨声'],
      duration: 6,
      resolution: '1080p',
      aspectRatio: '9:16',
    })

    await handleToolboxVideoTask(job)

    expect(outboundMock.normalizeToOriginalMediaUrl).toHaveBeenNthCalledWith(1, 'video/run.mp4')
    expect(outboundMock.normalizeToOriginalMediaUrl).toHaveBeenNthCalledWith(2, 'voice/rain.wav')
    expect(utilsMock.resolveVideoSourceFromGeneration).toHaveBeenCalledWith(job, {
      userId: 'user-1',
      modelId: 'hfsy::doubao-seedance-2-0',
      imageUrl: '',
      options: {
        prompt: '图片1中的苏晚卿 模仿 @奔跑动作 穿过雨夜，保留 @雨声',
        referenceImages: ['https://public.example/reference-1.png'],
        videos: ['https://public.example/run.mp4'],
        audios: ['https://public.example/rain.wav'],
        duration: 6,
        resolution: '1080p',
        aspectRatio: '9:16',
        generationMode: 'normal',
      },
    })
    expect(materialMock.registerFrameosMaterial).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({
        referenceNames: ['奔跑动作', '雨声', '苏晚卿'],
        referenceImageNames: ['苏晚卿'],
        referenceVideoNames: ['奔跑动作'],
        referenceAudioNames: ['雨声'],
      }),
    }))
  })

  it('registers a character audition image with CreateAsset and submits its private asset URI', async () => {
    prismaMock.frameosToolboxAsset.findFirst.mockResolvedValueOnce({
      id: 'asset-toolbox_video',
      type: 'video',
      bizType: 'character_audition',
      params: { characterId: 'character-1' },
    })
    const job = buildJob(TASK_TYPE.TOOLBOX_VIDEO, {
      title: '苏晚卿 · Seedance 试镜',
      prompt: '@苏晚卿 用克制而坚定的声音说出台词。',
      videoModel: 'nori::seedance2.0',
      inputMode: 'reference',
      referenceImages: ['images/real-person.png'],
      referenceImageNames: ['苏晚卿'],
      duration: 5,
      resolution: '720p',
      generateAudio: true,
    })

    const result = await handleToolboxVideoTask(job)

    expect(seedanceCharacterAssetMock.ensureSeedanceCharacterAsset).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      projectId: 'project-1',
      characterId: 'character-1',
    }))
    expect(outboundMock.normalizeReferenceImagesForGeneration).not.toHaveBeenCalled()
    expect(utilsMock.resolveVideoSourceFromGeneration).toHaveBeenCalledWith(job, expect.objectContaining({
      modelId: 'nori::seedance2.0',
      imageUrl: '',
      options: expect.objectContaining({
        referenceImages: ['asset://private-character-1'],
        generateAudio: true,
      }),
    }))
    expect(result).toMatchObject({
      videoUrl: 'video/toolbox-video.mp4',
      audioUrl: 'voice/custom/project-1/character-1/audition.mp3',
    })
  })

  it('propagates a privacy rejection instead of retrying with legacy CreateAsset references', async () => {
    utilsMock.resolveVideoSourceFromGeneration.mockRejectedValueOnce(new Error(
      'InputImageSensitiveContentDetected.PrivacyInformation',
    ))
    const job = buildJob(TASK_TYPE.TOOLBOX_VIDEO, {
      title: '真人参考视频',
      prompt: '@演员 面向镜头自然说话',
      videoModel: 'nori::seedance2.0',
      inputMode: 'image',
      referenceImages: ['images/real-person.png'],
      referenceImageNames: ['演员'],
      referenceMaterialIds: ['material-real-person'],
      duration: 8,
      resolution: '720p',
      generateAudio: true,
    })

    await expect(handleToolboxVideoTask(job)).rejects.toThrow(
      'InputImageSensitiveContentDetected.PrivacyInformation',
    )

    expect(seedanceCharacterAssetMock.ensureSeedanceToolboxReferenceAssets).not.toHaveBeenCalled()
    expect(utilsMock.resolveVideoSourceFromGeneration).toHaveBeenCalledTimes(1)
    expect(prismaMock.frameosToolboxAsset.update).toHaveBeenLastCalledWith({
      where: { id: 'asset-toolbox_video' },
      data: {
        status: 'failed',
        errorMessage: 'InputImageSensitiveContentDetected.PrivacyInformation',
      },
    })
  })

  it('marks a video asset failed when a first/last-frame input is incomplete', async () => {
    outboundMock.normalizeReferenceImagesForGeneration.mockResolvedValueOnce([
      'https://public.example/reference-1.png',
    ])
    const job = buildJob(TASK_TYPE.TOOLBOX_VIDEO, {
      prompt: 'camera pushes forward',
      videoModel: 'ark::doubao-seedance-2-0',
      inputMode: 'firstlastframe',
      referenceImages: ['images/start.png'],
      referenceMaterialIds: ['material-start', 'material-end'],
      referenceMaterials: [
        { materialId: 'material-start', role: 'FIRST_FRAME' },
        { materialId: 'material-end', role: 'LAST_FRAME' },
      ],
      referenceImageRoles: ['FIRST_FRAME', 'LAST_FRAME'],
      referenceNames: ['起始画面'],
    })

    await expect(handleToolboxVideoTask(job)).rejects.toThrow('First/last frame mode requires two images')
    expect(prismaMock.frameosToolboxAsset.update).toHaveBeenLastCalledWith({
      where: { id: 'asset-toolbox_video' },
      data: {
        status: 'failed',
        errorMessage: 'First/last frame mode requires two images',
      },
    })
    expect(materialMock.registerFrameosMaterial).not.toHaveBeenCalled()
  })
})
