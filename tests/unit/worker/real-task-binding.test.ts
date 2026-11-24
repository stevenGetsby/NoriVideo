import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'
import realPayload from '../../fixtures/real-task-payload.json'

// Real production task d955b4b4-899d-4c80-84a7-dc699f431b1c: 13 reference
// images + 3 audios. This suite replays its exact payload through the worker
// and asserts every 图N binding points at the image actually submitted at
// position N — not just that the text looks right.

const prismaMock = vi.hoisted(() => ({
  frameosToolboxAsset: {
    findFirst: vi.fn(),
    update: vi.fn(async () => ({})),
  },
  frameosMaterial: {
    findFirst: vi.fn(async () => ({ id: 'material-image-1' })),
    findMany: vi.fn(async (): Promise<Array<{ id: string; type: string; metadata: unknown }>> => []),
  },
}))

const utilsMock = vi.hoisted(() => ({
  assertTaskActive: vi.fn(async () => undefined),
  resolveVideoSourceFromGeneration: vi.fn(async () => ({
    url: 'https://provider.example/out.mp4',
    actualVideoTokens: 64000,
    durationSeconds: 29,
    resolution: '720p',
    downloadHeaders: {},
  })),
  uploadVideoSourceToCos: vi.fn(async () => 'video/out.mp4'),
  toSignedUrlIfCos: vi.fn((value: string) => value),
}))

// Identity mapping keeps the original file name in the submitted URL so the
// test can trace 图N -> submitted URL -> original asset file.
const outboundMock = vi.hoisted(() => ({
  normalizeToPublicImageUrlForGeneration: vi.fn(async (value: string) => `https://cdn.example/${value}`),
  normalizeReferenceImagesForGeneration: vi.fn(async (values: string[]) => values.map((value) => `https://cdn.example/${value}`)),
  normalizeToOriginalMediaUrl: vi.fn(async (value: string) => `https://cdn.example/${value}`),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/workers/utils', () => utilsMock)
vi.mock('@/lib/workers/shared', () => ({ reportTaskProgress: vi.fn(async () => undefined) }))
vi.mock('@/lib/frameos/material-service', () => ({
  registerFrameosMaterial: vi.fn(async (input: Record<string, unknown>) => ({ id: 'material-video-1', ...input })),
}))
vi.mock('@/lib/media/outbound-image', () => outboundMock)
vi.mock('@/lib/media/service', () => ({
  resolveMediaRef: vi.fn(async () => null),
  mediaUrlFromRef: vi.fn(() => null),
  resolveMediaRefFromLegacyValue: vi.fn(async () => null),
}))
vi.mock('@/lib/novel-promotion/seedance-character-asset', () => ({
  ensureSeedanceCharacterAsset: vi.fn(),
  ensureSeedanceToolboxReferenceAssets: vi.fn(),
}))
vi.mock('@/lib/storage', () => ({
  getObjectBuffer: vi.fn(async () => Buffer.from('video')),
  generateUniqueKey: vi.fn(() => 'video/out.mp4'),
  uploadObject: vi.fn(async () => 'video/out.mp4'),
}))
vi.mock('@/lib/canvas/video-operations', () => ({ enhanceCanvasVideo: vi.fn() }))
vi.mock('@/lib/media/video-audio', () => ({ extractVoiceAudioFromVideo: vi.fn() }))

import { handleToolboxVideoTask } from '@/lib/workers/handlers/toolbox-video-task-handler'

function buildJob(payload: Record<string, unknown>): Job<TaskJobData> {
  return {
    data: {
      taskId: 'task-real-replay',
      type: TASK_TYPE.TOOLBOX_VIDEO,
      locale: 'zh',
      projectId: 'project-1',
      targetType: 'FrameosToolboxAsset',
      targetId: 'asset-video-1',
      payload,
      userId: 'user-1',
    },
  } as unknown as Job<TaskJobData>
}

function submittedOptions() {
  const call = utilsMock.resolveVideoSourceFromGeneration.mock.calls.at(-1) as unknown[] | undefined
  if (!call) throw new Error('generation was never invoked')
  return (call[1] as { options: { prompt: string; referenceImages?: string[]; audios?: string[] } }).options
}

describe('real production task: asset binding integrity', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.frameosToolboxAsset.findFirst.mockImplementation(async ({ where }: { where: { id: string; type: string } }) => ({
      id: where.id,
      type: where.type,
    }))
    prismaMock.frameosMaterial.findMany.mockResolvedValue([])
  })

  it('binds every 图N in the real payload to the image actually submitted at position N', async () => {
    await handleToolboxVideoTask(buildJob({ ...realPayload }))
    const options = submittedOptions()
    const images = options.referenceImages || []
    const payloadImages = realPayload.referenceImages as string[]
    const names = realPayload.referenceImageNames as string[]

    // Submission keeps payload order 1:1 (no dedup needed: all files unique).
    expect(images).toEqual(payloadImages.map((file) => `https://cdn.example/${file}`))

    // Declaration line: 图N（@图片N）是资产名 for every mentioned asset, and the
    // named asset must be the payload image at position N.
    const declaration = options.prompt.split('\n')[0]
    const declPattern = /图(\d+)（@图片\1）是资产([^，]+?)，后文出现 图\1（\2） 时必须始终指代该资产/gu
    const declared = new Map<number, string>()
    let match: RegExpExecArray | null
    while ((match = declPattern.exec(declaration)) !== null) {
      const number = Number(match[1])
      const declaredName = match[2]
      expect(declaredName).toBe(names[number - 1])
      expect(images[number - 1]).toBe(`https://cdn.example/${payloadImages[number - 1]}`)
      declared.set(number, declaredName)
    }
    // The real prompt mentions 12 of the 13 images (男学生C is never named).
    expect(declared.size).toBe(12)
    expect(declared.has(10)).toBe(false)

    // Body: every written 图N（名） must agree with the declaration AND with
    // the image file submitted at that position (parenthetical may keep the
    // editor suffix ·图片, so compare against the stripped asset name).
    const body = options.prompt.slice(declaration.length + 1)
    const bodyPattern = /图(\d+)（([^（）]*)）/gu
    let bodyBindings = 0
    while ((match = bodyPattern.exec(body)) !== null) {
      const number = Number(match[1])
      const written = match[2].replace(/·图片$/u, '')
      expect(declared.get(number)).toBe(written)
      expect(names[number - 1]).toBe(written)
      bodyBindings += 1
    }
    expect(bodyBindings).toBeGreaterThan(50)

    // Audio declarations follow the submitted audio order, suffix stripped.
    const audioNames = realPayload.referenceAudioNames as string[]
    const audioFiles = realPayload.referenceAudios as string[]
    expect(options.audios).toEqual(audioFiles.map((file) => `https://cdn.example/${file}`))
    audioNames.forEach((name, index) => {
      expect(declaration).toContain(`音频${index + 1}是${name}的声音`)
    })

    // Dialogue lines stay literal: the English lines quoted in 镜头07/10.
    expect(body).toContain('"The Trial of the Eclipse begins now!"')
    expect(body).toContain('"The lunar eclipse..."')
    expect(options.prompt).not.toContain('@@')
    expect(options.prompt).not.toMatch(/是资产[^，\n]*·图片/u)
    expect(options.prompt).not.toMatch(/是[^，\n]*·音频的声音/u)
  })

  it('keeps numbering aligned when the same image file is attached twice', async () => {
    const payloadImages = realPayload.referenceImages as string[]
    const names = realPayload.referenceImageNames as string[]
    const mentionNames = realPayload.referenceImageMentionNames as string[][]
    // Attach 米娅 a second time at the tail under a distinct editor label.
    const job = buildJob({
      ...realPayload,
      prompt: '@米娅·图片2 回头看@米娅·图片，@丹尼尔·图片 站在远处',
      referenceImages: [...payloadImages, payloadImages[0]],
      referenceImageNames: [...names, names[0]],
      referenceImageMentionNames: [...mentionNames, ['米娅·图片2']],
      referenceImageRoles: [...(realPayload.referenceImageRoles as string[]), 'REF'],
      referenceMaterials: [
        ...(realPayload.referenceMaterials as Array<{ materialId: string; role: string }>),
        { materialId: 'material-mia-duplicate', role: 'REF' },
      ],
    })
    await handleToolboxVideoTask(job)
    const options = submittedOptions()
    const images = options.referenceImages || []

    // The duplicate collapses to one submitted file, but both editor labels
    // keep pointing at that same file through 图1.
    expect(images).toHaveLength(13)
    expect(images[0]).toBe(`https://cdn.example/${payloadImages[0]}`)
    const declaration = options.prompt.split('\n')[0]
    expect(declaration).toContain('图1（@图片1）是资产米娅')
    const body = options.prompt.slice(declaration.length + 1)
    expect(body).toBe('图1（米娅·图片2） 回头看图1（米娅·图片），图2（丹尼尔·图片） 站在远处')
  })

  it('aborts instead of shifting every later binding when an image cannot be read', async () => {
    outboundMock.normalizeToPublicImageUrlForGeneration.mockImplementation(async (value: string) => {
      if (value.endsWith('5m653f.jpg')) throw new Error('COS object missing')
      return `https://cdn.example/${value}`
    })
    const job = buildJob({ ...realPayload })
    await expect(handleToolboxVideoTask(job)).rejects.toThrow('已停止生成以免图片编号错位')
    expect(utilsMock.resolveVideoSourceFromGeneration).not.toHaveBeenCalled()
    expect(prismaMock.frameosToolboxAsset.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'failed' }),
    }))
  })
})
