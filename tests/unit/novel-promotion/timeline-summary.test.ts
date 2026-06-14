import { describe, expect, it } from 'vitest'
import { buildTimelineSummary } from '@/lib/novel-promotion/timeline-summary'

describe('timeline summary', () => {
  it('builds scheduled timeline rows and readiness queues from panels', () => {
    const summary = buildTimelineSummary({
      projectId: 'project-1',
      generatedAt: '2026-06-14T00:00:00.000Z',
      scope: 'episode',
      episodes: [{
        id: 'episode-1',
        episodeNumber: 1,
        name: '第1集',
        storyboards: [{
          id: 'storyboard-1',
          clipId: 'clip-1',
          panelCount: 2,
          clip: {
            id: 'clip-1',
            summary: '开场',
            start: 0,
            end: 6,
            duration: 6,
            shotCount: 2,
          },
          panels: [{
            id: 'panel-1',
            storyboardId: 'storyboard-1',
            panelIndex: 0,
            panelNumber: 1,
            characters: '角色A',
            location: '室内',
            props: null,
            duration: 2.5,
            imageUrl: '/image-1.png',
            videoUrl: '/video-1.mp4',
            lipSyncVideoUrl: null,
            description: '开门',
          }, {
            id: 'panel-2',
            storyboardId: 'storyboard-1',
            panelIndex: 1,
            panelNumber: 2,
            characters: null,
            location: null,
            props: null,
            duration: null,
            imageUrl: '/image-2.png',
            videoUrl: null,
            lipSyncVideoUrl: null,
            description: '回头',
          }],
        }],
      }],
    })

    expect(summary.schema).toBe('nori-video.timeline-summary.v1')
    expect(summary.scope).toBe('episode')
    expect(summary.totals).toMatchObject({
      episodes: 1,
      panels: 2,
      images: 2,
      videos: 1,
      readyShots: 1,
      missingRefs: 1,
      missingVideos: 1,
      missingDurations: 1,
      scheduledDurationSeconds: 5.5,
      confirmedDurationSeconds: 2.5,
    })

    const episode = summary.episodes[0]
    expect(episode.status).toBe('blocked')
    expect(episode.queues).toEqual({
      refs: ['panel-2'],
      images: [],
      videos: ['panel-2'],
      durations: ['panel-2'],
    })
    expect(episode.timeline.map((row) => ({
      id: row.id,
      timelineIndex: row.timelineIndex,
      startSeconds: row.startSeconds,
      endSeconds: row.endSeconds,
      durationSeconds: row.durationSeconds,
      durationSource: row.durationSource,
      status: row.status,
    }))).toEqual([{
      id: 'panel-1',
      timelineIndex: 1,
      startSeconds: 0,
      endSeconds: 2.5,
      durationSeconds: 2.5,
      durationSource: 'panel',
      status: 'ready',
    }, {
      id: 'panel-2',
      timelineIndex: 2,
      startSeconds: 2.5,
      endSeconds: 5.5,
      durationSeconds: 3,
      durationSource: 'default',
      status: 'needs_refs',
    }])
  })

  it('marks an empty episode without forcing delivery gaps', () => {
    const summary = buildTimelineSummary({
      projectId: 'project-1',
      scope: 'project',
      generatedAt: '2026-06-14T00:00:00.000Z',
      episodes: [{
        id: 'episode-empty',
        episodeNumber: 2,
        name: '空集',
        storyboards: [],
      }],
    })

    expect(summary.totals.panels).toBe(0)
    expect(summary.episodes[0]?.status).toBe('empty')
    expect(summary.episodes[0]?.queues).toEqual({
      refs: [],
      images: [],
      videos: [],
      durations: [],
    })
  })
})
