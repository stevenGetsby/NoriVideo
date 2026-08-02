import { describe, expect, it } from 'vitest'
import {
  normalizeVideoReviewAnnotations,
  resolveVideoReviewDurationMs,
  validateVideoReviewAnnotationsAgainstSnapshot,
  type VideoReviewSubmissionSnapshot,
} from '@/lib/collaboration/video-review'
import { formatVideoReviewTimecode } from '@/components/frameos/assignments-view-model'

describe('video review annotations', () => {
  it('normalizes and orders valid time ranges', () => {
    expect(normalizeVideoReviewAnnotations([
      { panelId: 'panel-b', startMs: 8_400, endMs: 10_000, note: '  第二处问题  ' },
      { panelId: 'panel-a', startMs: 1_200, endMs: 3_600, note: '第一处问题' },
    ])).toEqual([
      { panelId: 'panel-a', startMs: 1_200, endMs: 3_600, note: '第一处问题' },
      { panelId: 'panel-b', startMs: 8_400, endMs: 10_000, note: '第二处问题' },
    ])
  })

  it('rejects empty notes and reversed ranges', () => {
    expect(() => normalizeVideoReviewAnnotations([{ startMs: 2_000, endMs: 1_000, note: '错误区间' }])).toThrow('结束时间必须晚于开始时间')
    expect(() => normalizeVideoReviewAnnotations([{ startMs: 1_000, endMs: 2_000, note: '   ' }])).toThrow('请填写第 1 条时段标注')
  })

  it('formats review timecodes with tenths of a second', () => {
    expect(formatVideoReviewTimecode(0)).toBe('00:00.0')
    expect(formatVideoReviewTimecode(65_987)).toBe('01:05.9')
  })

  it('prefers actual media metadata and otherwise uses a five-second default', () => {
    expect(resolveVideoReviewDurationMs(6_240, 8)).toBe(6_240)
    expect(resolveVideoReviewDurationMs(null, 7.5)).toBe(7_500)
    expect(resolveVideoReviewDurationMs(null, null)).toBe(5_000)
  })

  it('keeps Segment annotations inside the submitted snapshot range', () => {
    const snapshot: VideoReviewSubmissionSnapshot = {
      version: 1,
      capturedAt: '2026-07-21T00:00:00.000Z',
      episodeId: 'episode-1',
      episodeName: '第一集',
      episodeOutputUrl: null,
      durationMs: 10_000,
      totalPanelCount: 2,
      readyPanelCount: 2,
      segments: [{
        panelId: 'panel-2', storyboardId: 'storyboard-1', sequence: 2,
        sceneLabel: 'S01', segmentLabel: 'Segment 02', label: 'S01 · Segment 02',
        description: null, sourceText: null, videoPrompt: null, location: null,
        shotType: null, cameraMove: null, characters: [], props: [], imageUrl: null,
        videoUrl: 'two.mp4', startMs: 5_000, endMs: 10_000, durationMs: 5_000,
      }],
    }

    expect(() => validateVideoReviewAnnotationsAgainstSnapshot([
      { panelId: 'panel-2', startMs: 5_500, endMs: 7_000, note: '修改' },
    ], snapshot)).not.toThrow()
    expect(() => validateVideoReviewAnnotationsAgainstSnapshot([
      { panelId: 'panel-2', startMs: 4_900, endMs: 7_000, note: '越界' },
    ], snapshot)).toThrow('时间范围超出了 S01 · Segment 02')
    expect(() => validateVideoReviewAnnotationsAgainstSnapshot([
      { panelId: 'panel-missing', startMs: 1_000, endMs: 2_000, note: '不存在' },
    ], snapshot)).toThrow('不在本次提交中')
  })
})
