import { describe, expect, it } from 'vitest'
import { buildProjectWorkflowBaseline, buildProjectWorkflowSummary } from '@/lib/projects/workflow-summary'

describe('project workflow summary', () => {
  it('builds a draft baseline for empty projects', () => {
    expect(buildProjectWorkflowSummary({
      stats: { episodes: 0, panels: 0, images: 0, videos: 0 },
    })).toMatchObject({
      source: 'workflow-stage-state',
      currentStage: 'config',
      status: 'draft',
      progress: 0,
      activeTaskCount: 0,
      activeStages: [],
    })
  })

  it('derives baseline stage from persisted production outputs', () => {
    expect(buildProjectWorkflowBaseline({ episodes: 1, panels: 0, videos: 0 })).toMatchObject({
      currentStage: 'script',
      status: 'ready',
    })
    expect(buildProjectWorkflowBaseline({ episodes: 1, panels: 8, images: 4, videos: 0 })).toMatchObject({
      currentStage: 'storyboard',
      status: 'ready',
    })
    expect(buildProjectWorkflowBaseline({ episodes: 1, panels: 8, images: 8, videos: 8 })).toMatchObject({
      currentStage: 'editor',
      status: 'ready',
    })
  })

  it('lets active workflow rows override the stats baseline', () => {
    const summary = buildProjectWorkflowSummary({
      stats: { episodes: 1, panels: 8, images: 8, videos: 0 },
      activeTaskCount: 2,
      stages: [
        {
          stageKey: 'script',
          status: 'completed',
          progress: 100,
          updatedAt: '2026-06-13T10:00:00.000Z',
        },
        {
          stageKey: 'videos',
          scopeId: 'episode-1',
          status: 'running',
          progress: 35,
          updatedAt: '2026-06-13T11:00:00.000Z',
        },
      ],
    })

    expect(summary).toMatchObject({
      currentStage: 'videos',
      status: 'running',
      activeTaskCount: 2,
      activeStages: ['videos'],
      progress: 60,
      updatedAt: '2026-06-13T11:00:00.000Z',
    })
  })

  it('surfaces blocked, review, stale, and approved stage groups', () => {
    const summary = buildProjectWorkflowSummary({
      stats: { episodes: 1, panels: 3, images: 3, videos: 0 },
      stages: [
        {
          stageKey: 'script',
          reviewState: 'confirmed',
          approvedAt: '2026-06-13T10:00:00.000Z',
          updatedAt: '2026-06-13T10:00:00.000Z',
        },
        {
          stageKey: 'storyboard',
          reviewState: 'review',
          updatedAt: '2026-06-13T10:10:00.000Z',
        },
        {
          stageKey: 'voice',
          status: 'stale',
          updatedAt: '2026-06-13T10:20:00.000Z',
        },
        {
          stageKey: 'editor',
          status: 'failed',
          progress: 40,
          blocker: 'missing videos',
          updatedAt: '2026-06-13T10:30:00.000Z',
        },
      ],
    })

    expect(summary).toMatchObject({
      currentStage: 'editor',
      status: 'blocked',
      progress: 40,
      blocker: 'missing videos',
      approvedStages: ['script'],
      reviewStages: ['storyboard'],
      staleStages: ['voice'],
      blockedStages: ['editor'],
    })
  })

  it('uses the latest legacy actor row for each scope and stage', () => {
    const summary = buildProjectWorkflowSummary({
      stats: { episodes: 1, panels: 4, images: 4, videos: 0 },
      stages: [
        {
          stageKey: 'storyboard', scopeId: 'episode-1', status: 'failed', progress: 20,
          blocker: 'stale member failure', updatedAt: '2026-11-08T09:00:00.000Z',
        },
        {
          stageKey: 'storyboard', scopeId: 'episode-1', status: 'approved', progress: 100,
          approvedAt: '2026-11-08T10:00:00.000Z', updatedAt: '2026-11-08T10:00:00.000Z',
        },
        {
          stageKey: 'storyboard', scopeId: 'episode-2', status: 'failed', progress: 30,
          blocker: 'current episode failure', updatedAt: '2026-11-08T10:30:00.000Z',
        },
      ],
    })

    expect(summary).toMatchObject({
      currentStage: 'storyboard',
      status: 'blocked',
      progress: 30,
      blocker: 'current episode failure',
      approvedStages: ['storyboard'],
      blockedStages: ['storyboard'],
    })
  })

  it('marks a project running when active tasks exist before stage rows arrive', () => {
    expect(buildProjectWorkflowSummary({
      stats: { episodes: 1, panels: 0, images: 0, videos: 0 },
      activeTaskCount: 1,
    })).toMatchObject({
      currentStage: 'script',
      status: 'running',
      activeTaskCount: 1,
    })
  })
})
