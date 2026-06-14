import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  workflowStageState: {
    findMany: vi.fn(),
    upsert: vi.fn(),
    updateMany: vi.fn(),
  },
  $transaction: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}))
import {
  buildWorkflowStageReviewEffectiveStates,
  resolveDownstreamWorkflowStageKeys,
  resolveWorkflowStageStatusFromReviewState,
} from '@/lib/workspace/workflow-stage-review-store'

describe('workflow stage review store helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('maps review states to persisted stage statuses', () => {
    expect(resolveWorkflowStageStatusFromReviewState('confirmed')).toBe('approved')
    expect(resolveWorkflowStageStatusFromReviewState('review')).toBe('pending_review')
  })

  it('resolves downstream stages in FrameOS workflow order', () => {
    expect(resolveDownstreamWorkflowStageKeys('script')).toEqual(['storyboard', 'videos', 'voice', 'editor'])
    expect(resolveDownstreamWorkflowStageKeys('editor')).toEqual([])
    expect(resolveDownstreamWorkflowStageKeys('unknown')).toEqual([])
  })

  it('marks downstream stages for review when an approved upstream stage is revoked', () => {
    expect(buildWorkflowStageReviewEffectiveStates({
      previousStates: {
        script: 'confirmed',
        storyboard: 'confirmed',
        videos: 'confirmed',
      },
      nextStates: {
        script: 'review',
        storyboard: 'confirmed',
        videos: 'confirmed',
      },
    })).toEqual({
      states: {
        script: 'review',
        storyboard: 'review',
        videos: 'review',
        voice: 'review',
        editor: 'review',
      },
      staleStages: ['storyboard', 'videos', 'voice', 'editor'],
    })
  })

  it('surfaces database read failures instead of falling back to runtime files', async () => {
    prismaMock.workflowStageState.findMany.mockRejectedValue(new Error('database offline'))
    const { readWorkflowStageReviewWithMeta } = await import('@/lib/workspace/workflow-stage-review-store')

    await expect(readWorkflowStageReviewWithMeta({
      userId: 'user-1',
      projectId: 'project-1',
      episodeId: 'episode-1',
    })).rejects.toThrow('database offline')
  })

  it('surfaces database write failures instead of falling back to runtime files', async () => {
    prismaMock.$transaction.mockRejectedValue(new Error('database offline'))
    const { writeWorkflowStageReview } = await import('@/lib/workspace/workflow-stage-review-store')

    await expect(writeWorkflowStageReview({
      userId: 'user-1',
      projectId: 'project-1',
      episodeId: 'episode-1',
      states: { script: 'confirmed' },
    })).rejects.toThrow('database offline')
  })
})
