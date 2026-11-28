import { describe, expect, it, vi } from 'vitest'
import {
  decideCanvasAction,
  decideCanvasSyncConflict,
  describeSkippedCanvasShots,
  isLegacyCanvasSyncConflict,
} from '@/components/batch-workflow/canvas-sync-logic'
import {
  buildVideoGenerationBody,
  deriveVideoShotOverrides,
  getRegenerateAllCostConfirmation,
} from '@/components/batch-workflow/video-generation-logic'
import type { BatchItemDTO, StoryboardArtifact } from '@/lib/batch-workflow/types'

function makeVideoItem(ready: boolean): Pick<BatchItemDTO, 'stageOutputs'> {
  return {
    stageOutputs: {
      storyboard: { shots: [{ shotId: 's1' }, { shotId: 's2' }] },
      video_gen: {
        shots: [{
          shotId: 's1',
          takes: [{ status: ready ? 'ready' : 'failed' }],
        }],
      },
    },
  } as unknown as Pick<BatchItemDTO, 'stageOutputs'>
}

function makeStoryboard(): StoryboardArtifact {
  return {
    shots: [{
      shotId: 's1', durationSec: 6, videoPrompt: '新提示词', inputMode: 'image',
    }],
  } as StoryboardArtifact
}

describe('video generation contract', () => {
  it('adds regenerateAll only for a confirmed full reroll with ready takes', () => {
    const confirmation = getRegenerateAllCostConfirmation(makeVideoItem(true))
    expect(confirmation).toContain('全部 2 个镜头')
    expect(confirmation).toContain('重新消耗')
    expect(buildVideoGenerationBody(makeVideoItem(true), { forceRerun: true })).toEqual({
      action: 'generate',
      regenerateAll: true,
      forceRerun: true,
    })
  })

  it('does not issue a request when the full-reroll confirmation is cancelled', async () => {
    const fetcher = vi.fn()
    const confirm = vi.fn().mockResolvedValue(false)
    const item = makeVideoItem(true)
    const confirmation = getRegenerateAllCostConfirmation(item)
    if (confirmation && await confirm(confirmation)) {
      await fetcher(buildVideoGenerationBody(item, { forceRerun: true }))
    }
    expect(confirm).toHaveBeenCalledOnce()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('uses explicit shotIds and overrides for a single-shot reroll, never regenerateAll', () => {
    const updatedStoryboard = makeStoryboard()
    const body = buildVideoGenerationBody(makeVideoItem(true), {
      shotIds: ['s1'],
      forceRerun: true,
      shotOverrides: deriveVideoShotOverrides(updatedStoryboard, ['s1']),
    })
    expect(body).toEqual({
      action: 'generate',
      shotIds: ['s1'],
      forceRerun: true,
      shotOverrides: { s1: { durationSeconds: 6, prompt: '新提示词', inputMode: 'image' } },
    })
    expect(body).not.toHaveProperty('regenerateAll')
  })

  it('keeps first generation free of regenerateAll and cost confirmation', () => {
    expect(getRegenerateAllCostConfirmation(makeVideoItem(false))).toBeNull()
    expect(buildVideoGenerationBody(makeVideoItem(false), {})).toEqual({ action: 'generate' })
    expect(buildVideoGenerationBody(makeVideoItem(false), { forceRerun: true })).toEqual({
      action: 'generate',
      forceRerun: true,
    })
  })
})

describe('canvas synchronization decisions', () => {
  it('opens an up-to-date canvas without another mutation', () => {
    expect(decideCanvasAction({ hasCanvas: true, checkStatus: 200, stale: false })).toBe('open')
  })

  it('offers sync only when check reports stale content', () => {
    expect(decideCanvasAction({ hasCanvas: true, checkStatus: 200, stale: true })).toBe('offerSync')
  })

  it('creates when check reports that no canvas exists', () => {
    expect(decideCanvasAction({ hasCanvas: true, checkStatus: 404 })).toBe('create')
    expect(decideCanvasAction({ hasCanvas: false })).toBe('create')
  })

  it('allows direct open when check fails, and offers new after legacy sync 409', () => {
    expect(decideCanvasAction({ hasCanvas: true, checkStatus: 500 })).toBe('open')
    expect(decideCanvasSyncConflict(409)).toBe('offerNew')
    expect(decideCanvasSyncConflict(422)).toBe('throw')
    const legacy = Object.assign(new Error('legacy'), { name: 'WorkflowMutationError', code: 'CONFLICT' })
    expect(isLegacyCanvasSyncConflict(legacy)).toBe(true)
    expect(isLegacyCanvasSyncConflict(new Error('other'))).toBe(false)
  })

  it('describes skipped unfinished shots only when needed', () => {
    expect(describeSkippedCanvasShots(3)).toBe('3 个镜头尚未生成完成，已跳过。')
    expect(describeSkippedCanvasShots(0)).toBeNull()
  })
})
