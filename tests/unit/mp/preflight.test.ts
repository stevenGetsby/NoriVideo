import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { StoryIssue } from '@/lib/interactive/types'

vi.mock('@/lib/storage', () => ({
  extractStorageKey: (input: string | null | undefined) => {
    if (!input) return null
    if (input.startsWith('/api/files/')) return decodeURIComponent(input.slice('/api/files/'.length))
    if (!input.startsWith('http') && !input.startsWith('/')) return input
    try {
      return new URL(input).pathname.replace(/^\/+/, '') || null
    } catch {
      return null
    }
  },
}))

const loadStoryMock = vi.hoisted(() => vi.fn())
const prismaMock = vi.hoisted(() => ({
  mpWork: { findUnique: vi.fn() },
  storyRelease: { findFirst: vi.fn() },
}))

vi.mock('@/lib/interactive/service', () => ({ loadStoryForRelease: loadStoryMock }))
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

import { preflightRelease, type ReleaseStoryData } from '@/lib/mp/release/preflight'

const SYNOPSIS = '这是一个足够长的详细介绍内容'

function listingRow(overrides: Record<string, unknown> = {}) {
  return {
    title: '雨夜',
    tagline: '一句话勾住观众',
    synopsis: SYNOPSIS,
    tags: ['悬疑'],
    creatorName: '蓝喵工作室',
    coverKey: 'images/cover.jpg',
    ...overrides,
  }
}

function storyData(): ReleaseStoryData {
  return {
    story: {
      workId: 'w1',
      name: '雨夜',
      aspectRatio: '9:16',
      resolution: '1080p',
      config: {
        version: 1,
        variables: [],
        chapters: [{ projectId: 'p1', order: 0, position: { x: 0, y: 0 }, status: 'final' }],
        links: [],
        start: { projectId: 'p1', entryNodeId: 'e1' },
        sequence: { segments: [] },
      },
    },
    chapters: [{
      projectId: 'p1',
      name: '雨夜',
      canvasId: 'cv1',
      nodeCount: 3,
      runningCount: 0,
      updatedAt: '2026-11-16T00:00:00.000Z',
      graph: {
        projectId: 'p1',
        title: '雨夜',
        nodes: [
          { id: 'e1', kind: 'entry', title: '入口' },
          {
            id: 's1', kind: 'scene', title: '巷口', lines: '雨夜。', effects: [], beats: [],
            media: { kind: 'video', url: 'videos/a.mp4', posterUrl: 'images/a-poster.jpg', durationSec: 10 },
          },
          { id: 'end1', kind: 'ending', title: '结局', endingType: 'good', description: '雨停了。' },
        ],
        flows: [
          { id: 'f1', from: 'e1', handle: 'next', to: 's1' },
          { id: 'f2', from: 's1', handle: 'next', to: 'end1' },
        ],
      },
    }],
  }
}

type MutableScene = Extract<ReleaseStoryData['chapters'][0]['graph']['nodes'][0], { kind: 'scene' }>
const sceneOf = (data: ReleaseStoryData) => data.chapters[0].graph.nodes[1] as MutableScene

const codes = (issues: StoryIssue[]) => issues.map((item) => item.code)
const issueOf = (issues: StoryIssue[], code: string) => issues.find((item) => item.code === code)

beforeEach(() => {
  vi.clearAllMocks()
  loadStoryMock.mockResolvedValue(storyData())
  prismaMock.mpWork.findUnique.mockResolvedValue(listingRow())
  prismaMock.storyRelease.findFirst.mockResolvedValue(null)
})

describe('preflightRelease', () => {
  it('passes a clean story with a complete listing', async () => {
    const result = await preflightRelease('w1')
    expect(loadStoryMock).toHaveBeenCalledWith('w1')
    expect(result.issues).toEqual([])
    expect(result.errors).toBe(0)
    expect(result.warnings).toBe(0)
  })

  it('sorts errors before warnings and counts them', async () => {
    prismaMock.mpWork.findUnique.mockResolvedValue(listingRow({ title: '', coverKey: null }))
    const result = await preflightRelease('w1')
    expect(result.errors).toBe(1)
    expect(result.warnings).toBe(1)
    expect(result.issues[0].level).toBe('error')
    expect(result.issues[1].level).toBe('warning')
  })

  it('keeps engine validateStory errors', async () => {
    const data = storyData()
    data.chapters[0].graph.flows = []
    loadStoryMock.mockResolvedValue(data)
    const result = await preflightRelease('w1')
    expect(result.errors).toBeGreaterThan(0)
    expect(codes(result.issues)).toContain('dead_end')
  })

  describe('listing fields', () => {
    it('flags a missing or overlong title verbatim', async () => {
      for (const title of ['', '超'.repeat(21)]) {
        prismaMock.mpWork.findUnique.mockResolvedValue(listingRow({ title }))
        const result = await preflightRelease('w1')
        expect(issueOf(result.issues, 'mp_listing_title')).toEqual({
          level: 'error', code: 'mp_listing_title', message: '请填写作品名（20 字以内）', projectId: null, nodeId: null,
        })
      }
    })

    it('accepts a 20-codepoint title', async () => {
      prismaMock.mpWork.findUnique.mockResolvedValue(listingRow({ title: '雨'.repeat(20) }))
      const result = await preflightRelease('w1')
      expect(codes(result.issues)).not.toContain('mp_listing_title')
    })

    it('flags a missing or overlong tagline verbatim', async () => {
      for (const tagline of ['', '简'.repeat(31)]) {
        prismaMock.mpWork.findUnique.mockResolvedValue(listingRow({ tagline }))
        const result = await preflightRelease('w1')
        expect(issueOf(result.issues, 'mp_listing_tagline')).toEqual({
          level: 'error', code: 'mp_listing_tagline', message: '请填写一句话简介（30 字以内）', projectId: null, nodeId: null,
        })
      }
      prismaMock.mpWork.findUnique.mockResolvedValue(listingRow({ tagline: '简'.repeat(30) }))
      expect(codes((await preflightRelease('w1')).issues)).not.toContain('mp_listing_tagline')
    })

    it('flags a synopsis outside 10–300 codepoints verbatim', async () => {
      for (const synopsis of ['短'.repeat(9), '长'.repeat(301)]) {
        prismaMock.mpWork.findUnique.mockResolvedValue(listingRow({ synopsis }))
        const result = await preflightRelease('w1')
        expect(issueOf(result.issues, 'mp_listing_synopsis')).toEqual({
          level: 'error', code: 'mp_listing_synopsis', message: '详细介绍需要 10–300 字', projectId: null, nodeId: null,
        })
      }
      for (const synopsis of ['短'.repeat(10), '长'.repeat(300)]) {
        prismaMock.mpWork.findUnique.mockResolvedValue(listingRow({ synopsis }))
        expect(codes((await preflightRelease('w1')).issues)).not.toContain('mp_listing_synopsis')
      }
    })

    it('flags 0, 4 or unknown tags verbatim and accepts 1–3 MP_TAGS', async () => {
      for (const tags of [[], ['悬疑', '恋爱', '奇幻', '科幻'], ['不存在的标签']]) {
        prismaMock.mpWork.findUnique.mockResolvedValue(listingRow({ tags }))
        const result = await preflightRelease('w1')
        expect(issueOf(result.issues, 'mp_listing_tags')).toEqual({
          level: 'error', code: 'mp_listing_tags', message: '请选择 1–3 个题材标签', projectId: null, nodeId: null,
        })
      }
      prismaMock.mpWork.findUnique.mockResolvedValue(listingRow({ tags: ['悬疑', '恋爱', '奇幻'] }))
      expect(codes((await preflightRelease('w1')).issues)).not.toContain('mp_listing_tags')
    })

    it('flags a missing or overlong creatorName verbatim', async () => {
      for (const creatorName of ['', '名'.repeat(13)]) {
        prismaMock.mpWork.findUnique.mockResolvedValue(listingRow({ creatorName }))
        const result = await preflightRelease('w1')
        expect(issueOf(result.issues, 'mp_listing_creatorName')).toEqual({
          level: 'error', code: 'mp_listing_creatorName', message: '请填写出品署名（12 字以内）', projectId: null, nodeId: null,
        })
      }
      prismaMock.mpWork.findUnique.mockResolvedValue(listingRow({ creatorName: '名'.repeat(12) }))
      expect(codes((await preflightRelease('w1')).issues)).not.toContain('mp_listing_creatorName')
    })

    it('reports all five listing errors when no MpWork row exists', async () => {
      prismaMock.mpWork.findUnique.mockResolvedValue(null)
      const result = await preflightRelease('w1')
      expect(codes(result.issues)).toEqual(expect.arrayContaining([
        'mp_listing_title', 'mp_listing_tagline', 'mp_listing_synopsis', 'mp_listing_tags', 'mp_listing_creatorName',
      ]))
    })
  })

  it('flags zero endings verbatim', async () => {
    const data = storyData()
    data.chapters[0].graph.nodes[2] = { id: 'end1', kind: 'exit', title: '出口' }
    loadStoryMock.mockResolvedValue(data)
    const result = await preflightRelease('w1')
    expect(issueOf(result.issues, 'mp_no_endings')).toEqual({
      level: 'error', code: 'mp_no_endings', message: '至少需要一个结局', projectId: null, nodeId: null,
    })
  })

  it('accepts a story with an ending', async () => {
    expect(codes((await preflightRelease('w1')).issues)).not.toContain('mp_no_endings')
  })

  it('flags running generation tasks per chapter verbatim', async () => {
    const data = storyData()
    data.chapters[0].runningCount = 2
    loadStoryMock.mockResolvedValue(data)
    const result = await preflightRelease('w1')
    expect(issueOf(result.issues, 'mp_running')).toEqual({
      level: 'error', code: 'mp_running', message: '还有 2 个生成任务未完成，完成后再发布', projectId: 'p1', nodeId: null,
    })
  })

  it('accepts chapters with no running tasks', async () => {
    expect(codes((await preflightRelease('w1')).issues)).not.toContain('mp_running')
  })

  it('flags more than 500 unique media verbatim', async () => {
    const data = storyData()
    data.story.config.achievements = Array.from({ length: 499 }, (_, index) => ({
      id: `ach${index}`,
      name: `成就${index}`,
      description: '描述',
      icon: `images/icon-${index}.png`,
      condition: { type: 'all_endings' },
      reward: { title: '', frameUrl: null },
    }))
    loadStoryMock.mockResolvedValue(data)
    const result = await preflightRelease('w1')
    expect(issueOf(result.issues, 'mp_media_limit')).toEqual({
      level: 'error', code: 'mp_media_limit', message: '素材超过 500 个，请拆分作品', projectId: null, nodeId: null,
    })
  })

  it('accepts exactly 500 unique media', async () => {
    const data = storyData()
    data.story.config.achievements = Array.from({ length: 498 }, (_, index) => ({
      id: `ach${index}`,
      name: `成就${index}`,
      description: '描述',
      icon: `images/icon-${index}.png`,
      condition: { type: 'all_endings' },
      reward: { title: '', frameUrl: null },
    }))
    loadStoryMock.mockResolvedValue(data)
    expect(codes((await preflightRelease('w1')).issues)).not.toContain('mp_media_limit')
  })

  it('flags total video duration over 4 hours verbatim', async () => {
    const data = storyData()
    sceneOf(data).media = { kind: 'video', url: 'videos/a.mp4', posterUrl: 'images/a-poster.jpg', durationSec: 4 * 3600 + 1 }
    loadStoryMock.mockResolvedValue(data)
    const result = await preflightRelease('w1')
    expect(issueOf(result.issues, 'mp_duration_limit')).toEqual({
      level: 'error', code: 'mp_duration_limit', message: '视频总时长超过 4 小时', projectId: null, nodeId: null,
    })
  })

  it('accepts exactly 4 hours of video', async () => {
    const data = storyData()
    sceneOf(data).media = { kind: 'video', url: 'videos/a.mp4', posterUrl: 'images/a-poster.jpg', durationSec: 4 * 3600 }
    loadStoryMock.mockResolvedValue(data)
    expect(codes((await preflightRelease('w1')).issues)).not.toContain('mp_duration_limit')
  })

  it('warns about a scene without media verbatim', async () => {
    const data = storyData()
    sceneOf(data).media = null
    loadStoryMock.mockResolvedValue(data)
    const result = await preflightRelease('w1')
    expect(issueOf(result.issues, 'mp_scene_no_media')).toEqual({
      level: 'warning', code: 'mp_scene_no_media', message: '「巷口」没有画面，观众只会看到文字', projectId: 'p1', nodeId: 's1',
    })
  })

  it('does not warn when every scene has media', async () => {
    expect(codes((await preflightRelease('w1')).issues)).not.toContain('mp_scene_no_media')
  })

  it('warns about an unknown video duration verbatim', async () => {
    const data = storyData()
    sceneOf(data).media = { kind: 'video', url: 'videos/a.mp4', posterUrl: 'images/a-poster.jpg' }
    loadStoryMock.mockResolvedValue(data)
    const result = await preflightRelease('w1')
    expect(issueOf(result.issues, 'mp_video_duration_unknown')).toEqual({
      level: 'warning', code: 'mp_video_duration_unknown', message: '「巷口」的视频时长未知，生成版本时会自动检测', projectId: 'p1', nodeId: 's1',
    })
  })

  it('does not warn when the video duration is known', async () => {
    expect(codes((await preflightRelease('w1')).issues)).not.toContain('mp_video_duration_unknown')
  })

  it('warns about a missing cover verbatim', async () => {
    prismaMock.mpWork.findUnique.mockResolvedValue(listingRow({ coverKey: null }))
    const result = await preflightRelease('w1')
    expect(issueOf(result.issues, 'mp_no_cover')).toEqual({
      level: 'warning', code: 'mp_no_cover', message: '未上传竖版封面，将使用开场画面', projectId: null, nodeId: null,
    })
  })

  it('does not warn when a cover is uploaded', async () => {
    expect(codes((await preflightRelease('w1')).issues)).not.toContain('mp_no_cover')
  })

  it('flags an in-progress release verbatim', async () => {
    prismaMock.storyRelease.findFirst.mockResolvedValue({ id: 'r0' })
    const result = await preflightRelease('w1')
    expect(prismaMock.storyRelease.findFirst).toHaveBeenCalledWith({
      where: { workId: 'w1', status: { in: ['building', 'reviewing'] } },
      select: { id: true },
    })
    expect(issueOf(result.issues, 'mp_release_in_progress')).toEqual({
      level: 'error', code: 'mp_release_in_progress', message: '已有一个版本在生成或审核中', projectId: null, nodeId: null,
    })
  })

  it('accepts works without an in-progress release', async () => {
    expect(codes((await preflightRelease('w1')).issues)).not.toContain('mp_release_in_progress')
  })
})
