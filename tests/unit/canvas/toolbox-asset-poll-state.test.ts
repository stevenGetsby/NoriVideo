import { describe, expect, it } from 'vitest'
import {
  chunkCanvasToolboxAssetIds,
  isCanvasToolboxAssetMissingTerminal,
  resolveCanvasToolboxAssetPollState,
} from '@/features/canvas/toolbox-asset-poll-state'

describe('canvas toolbox asset polling state', () => {
  it('deduplicates and batches exact running asset ids instead of relying on newest history rows', () => {
    const ids = Array.from({ length: 205 }, (_, index) => `asset-${index}`)
    const batches = chunkCanvasToolboxAssetIds([...ids, 'asset-0', '', ' '.repeat(3)])

    expect(batches.map((batch) => batch.length)).toEqual([100, 100, 5])
    expect(batches.flat()).toEqual(ids)
    expect(chunkCanvasToolboxAssetIds(['a', 'b', 'c'], 2)).toEqual([['a', 'b'], ['c']])
  })

  it('keeps a retrying task running even when the previous asset attempt says failed', () => {
    expect(resolveCanvasToolboxAssetPollState({
      assetStatus: 'failed',
      hasResult: false,
      taskStatus: 'processing',
    })).toEqual({ ready: false, active: true, failed: false })
  })

  it('treats usable media as the strongest terminal truth', () => {
    expect(resolveCanvasToolboxAssetPollState({
      assetStatus: 'ready',
      hasResult: true,
      taskStatus: 'failed',
    })).toEqual({ ready: true, active: false, failed: false })
  })

  it('only fails after the task is terminal or no active task can recover the asset', () => {
    expect(resolveCanvasToolboxAssetPollState({ assetStatus: 'failed', hasResult: false, taskStatus: 'failed' }).failed).toBe(true)
    expect(resolveCanvasToolboxAssetPollState({ assetStatus: 'ready', hasResult: false, taskStatus: 'completed' }).failed).toBe(true)
    expect(resolveCanvasToolboxAssetPollState({ assetStatus: 'failed', hasResult: false, taskStatus: null }).failed).toBe(true)
  })

  it('does not invent a terminal failure when an exact asset read is temporarily empty', () => {
    expect(resolveCanvasToolboxAssetPollState({
      assetStatus: undefined,
      hasResult: false,
      taskStatus: undefined,
    })).toEqual({ ready: false, active: false, failed: false })
    expect(isCanvasToolboxAssetMissingTerminal(3, 4)).toBe(false)
    expect(isCanvasToolboxAssetMissingTerminal(4, 4)).toBe(true)
  })
})
