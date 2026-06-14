import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  novelPromotionEpisode: {
    findFirst: vi.fn(),
  },
  exportQueueRecord: {
    count: vi.fn(),
  },
  exportHistoryRecord: {
    count: vi.fn(),
  },
  task: {
    findMany: vi.fn(),
  },
}))

vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}))

import {
  hasRebuildImpact,
  readEpisodeRebuildImpact,
  summarizeRebuildImpact,
} from '@/lib/novel-promotion/rebuild-impact'

describe('rebuild impact summary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('counts downstream artifacts from persisted episode data', () => {
    const counts = summarizeRebuildImpact({
      storyboards: [
        {
          panels: [
            {
              imageUrl: 'https://cdn.test/image.png',
              imageMediaId: null,
              videoUrl: null,
              videoMediaId: null,
              lipSyncVideoUrl: null,
              lipSyncVideoMediaId: null,
            },
            {
              imageUrl: null,
              imageMediaId: null,
              videoUrl: 'https://cdn.test/video.mp4',
              videoMediaId: null,
              lipSyncVideoUrl: null,
              lipSyncVideoMediaId: null,
            },
            {
              imageUrl: null,
              imageMediaId: 'media-image',
              videoUrl: null,
              videoMediaId: null,
              lipSyncVideoUrl: 'https://cdn.test/lip.mp4',
              lipSyncVideoMediaId: null,
            },
          ],
        },
      ],
      voiceLines: [
        { audioUrl: null, audioMediaId: null },
        { audioUrl: 'https://cdn.test/voice.mp3', audioMediaId: null },
      ],
      editorProject: { id: 'editor-1' },
    }, {
      exportQueueCount: 2,
      exportHistoryCount: 1,
      activeTaskCount: 3,
    })

    expect(counts).toEqual({
      storyboardCount: 1,
      panelCount: 3,
      imageCount: 2,
      videoCount: 2,
      voiceLineCount: 2,
      voiceAudioCount: 1,
      editorProjectCount: 1,
      exportQueueCount: 2,
      exportHistoryCount: 1,
      activeTaskCount: 3,
    })
    expect(hasRebuildImpact(counts)).toBe(true)
  })

  it('returns no impact for an empty persisted episode', () => {
    const counts = summarizeRebuildImpact({
      storyboards: [],
      voiceLines: [],
      editorProject: null,
    })

    expect(hasRebuildImpact(counts)).toBe(false)
  })

  it('filters internal agent tasks out of rebuild active task counts', async () => {
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValue({
      id: 'episode-1',
      storyboards: [],
      voiceLines: [],
      editorProject: null,
    })
    prismaMock.exportQueueRecord.count.mockResolvedValue(0)
    prismaMock.exportHistoryRecord.count.mockResolvedValue(0)
    prismaMock.task.findMany.mockResolvedValue([
      {
        type: 'video_panel',
        targetType: 'panel',
        errorMessage: null,
      },
      {
        type: 'background_text',
        targetType: 'super_agent_stage',
        errorMessage: null,
      },
      {
        type: 'super_agent_execute',
        targetType: 'project',
        errorMessage: null,
      },
    ])

    const impact = await readEpisodeRebuildImpact({
      userId: 'user-1',
      projectId: 'project-1',
      episodeId: 'episode-1',
    })

    expect(impact?.counts.activeTaskCount).toBe(1)
    expect(prismaMock.task.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        status: { in: ['queued', 'processing'] },
      }),
      select: {
        type: true,
        targetType: true,
        errorMessage: true,
      },
    }))
  })
})
