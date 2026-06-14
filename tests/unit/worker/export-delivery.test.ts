import { describe, expect, it } from 'vitest'
import { resolveTaskIntent } from '@/lib/task/intent'
import { getTaskTypeLabel } from '@/lib/task/progress-message'
import { TASK_TYPE } from '@/lib/task/types'
import { isAiTaskType, workflowTypeFromTaskType } from '@/lib/run-runtime/workflow'
import {
  buildJianyingDraftPackageEntries,
  type ExportDeliveryOutput,
} from '@/lib/novel-promotion/export-delivery'

describe('export delivery task registration', () => {
  it('registers export delivery as a backend build task outside AI runs', () => {
    expect(resolveTaskIntent(TASK_TYPE.EXPORT_DELIVERY)).toBe('build')
    expect(getTaskTypeLabel(TASK_TYPE.EXPORT_DELIVERY)).toBe('progress.taskType.exportDelivery')
    expect(isAiTaskType(TASK_TYPE.EXPORT_DELIVERY)).toBe(false)
    expect(workflowTypeFromTaskType(TASK_TYPE.EXPORT_DELIVERY)).toBe(TASK_TYPE.EXPORT_DELIVERY)
  })

  it('builds a Jianying-oriented draft package structure', () => {
    const output: ExportDeliveryOutput = {
      cardId: 'jianying-draft',
      title: 'Editing Draft',
      fileName: 'demo_jianying_draft.zip',
      stats: {
        clips: 1,
        panels: 1,
        images: 1,
        videos: 1,
        voices: 1,
      },
      manifest: {
        schema: 'nori-video.export-delivery.v1',
        generatedAt: '2026-06-14T00:00:00.000Z',
        project: { id: 'project-1', name: 'Demo' },
        episode: { id: 'episode-1', name: 'EP1' },
        panels: [{
          id: 'panel-1',
          panelIndex: 0,
          panelNumber: 1,
          imageUrl: 'https://example.test/panel.png',
          videoUrl: 'https://example.test/panel.mp4',
          srtSegment: 'hello',
        }],
        voiceLines: [{
          id: 'voice-1',
          lineIndex: 1,
          speaker: 'Narrator',
          audioUrl: 'https://example.test/voice.mp3',
        }],
        jianyingDraft: {
          schema: 'nori-video.jianying-draft.v1',
          generatedAt: '2026-06-14T00:00:00.000Z',
          timeline: [{
            id: 'panel-1',
            order: 1,
            panelIndex: 0,
            panelNumber: 1,
            startMs: 0,
            durationMs: 3000,
            sourceVideoUrl: 'https://example.test/panel.mp4',
            sourceImageUrl: 'https://example.test/panel.png',
            subtitle: 'hello',
          }],
        },
      },
    }

    const entries = buildJianyingDraftPackageEntries(output)
    expect(entries.map((entry) => entry.name)).toEqual([
      'draft_content.json',
      'draft_meta_info.json',
      'manifest.json',
      'materials/video.json',
      'materials/image.json',
      'materials/audio.json',
      'README.md',
    ])

    const draftContent = JSON.parse(entries[0].buffer.toString('utf8')) as Record<string, unknown>
    expect(draftContent.schema).toBe('nori-video.jianying-draft-package.v1')
    expect(draftContent.durationMs).toBe(3000)
    expect(draftContent.tracks).toMatchObject({
      mainVideo: [{
        id: 'panel-1',
        sourceVideoUrl: 'https://example.test/panel.mp4',
        sourceImageUrl: 'https://example.test/panel.png',
      }],
      subtitles: [{
        text: 'hello',
      }],
    })

    const meta = JSON.parse(entries[1].buffer.toString('utf8')) as Record<string, unknown>
    expect(meta.compatibility).toMatchObject({ officialJianyingImport: false })
    const videoRefs = JSON.parse(entries[3].buffer.toString('utf8')) as Array<Record<string, unknown>>
    expect(videoRefs).toEqual([{
      id: 'panel-1',
      panelIndex: 0,
      sourceUrl: 'https://example.test/panel.mp4',
    }])
  })
})
