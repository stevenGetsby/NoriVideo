import { describe, expect, it, vi } from 'vitest'
import {
  aspectRatioClassFromValue,
  buildStage1Payload,
  clampDurationSec,
  diffS2Scenes,
  durationOptions,
  findNavigableShotIndex,
  findNextPlayableShotIndex,
  isAssetChipBound,
  isVersionSelectable,
  normalizeDurationBounds,
  runSaveOperation,
  trySave,
} from '@/components/batch-workflow/stages/_helpers'
import type {
  OriginalScriptArtifact,
  OriginalScriptBeat,
  RewrittenScriptScene,
  VideoGenShotEntry,
} from '@/lib/batch-workflow/types'

const beat = (beatIndex: number, dialogue = '原对白'): OriginalScriptBeat => ({
  beatIndex, sceneHeading: `节拍${beatIndex}`, visualAction: '画面', dialogue,
})

const scene = (sceneIndex: number, sourceBeatId?: string): RewrittenScriptScene => ({
  sceneIndex, sourceBeatId, location: '地点', beat: '推进', visualAction: '画面', dialogue: '台词', durationSec: 5,
})

const shot = (id: string, status: 'ready' | 'queued' | 'processing' | 'failed' | 'pending'): VideoGenShotEntry => ({
  shotId: id, shotIndex: 1, title: id, durationSec: 5, prompt: '提示词', referencedAssetIds: [], selectedTakeIndex: 0,
  takes: [{
    takeIndex: 1, prompt: '提示词', modelKey: 'model', inputMode: 'text', aspectRatio: '16:9',
    resolution: '720p', durationSec: 5, generateAudio: false, status, submittedAt: '2026-01-01',
    videoUrl: status === 'ready' ? `https://example.com/${id}.mp4` : null,
  }],
})

describe('stage view save contract', () => {
  it('keeps dirty and exposes the real rejection message', async () => {
    const callback = vi.fn(async () => { throw new Error('服务器已有更新') })
    expect(await trySave(callback, { draft: true })).toEqual({ ok: false, error: '服务器已有更新' })
    expect(await runSaveOperation(callback)).toEqual({ dirty: true, error: '服务器已有更新' })
  })

  it('clears dirty only after a resolved legacy or Promise callback', async () => {
    expect(await runSaveOperation(() => undefined)).toEqual({ dirty: false, error: null })
    expect(await trySave(() => undefined, null)).toEqual({ ok: true })
  })
})

describe('S1 immutable original text', () => {
  const original: OriginalScriptArtifact = {
    sourceMode: 'pasted_script', title: '原稿', summary: '梗概', estimatedDurationSec: 5,
    characters: [], locations: [], props: [], beats: [beat(1)], fullScriptText: '用户粘贴的原始剧本，必须逐字保留',
  }

  it('writes editedScriptText for beat edits without rebuilding the original', () => {
    const draft = { ...original, beats: [{ ...beat(1, '改后'), timecode: '00:01–00:04', voiceover: '旁白' }] }
    const saved = buildStage1Payload(draft, original)
    expect(saved.fullScriptText).toBe(original.fullScriptText)
    expect(saved.editedScriptText).toContain('00:01–00:04')
    expect(saved.editedScriptText).toContain('对白：改后')
    expect(saved.editedScriptText).toContain('旁白：旁白')
  })

  it('does not mark an untouched draft as edited', () => {
    const saved = buildStage1Payload({ ...original, beats: [...original.beats] }, original)
    expect(saved.editedScriptText).toBeUndefined()
    expect(saved.fullScriptText).toBe(original.fullScriptText)
  })
})

describe('S2 ID-based scene diff', () => {
  it('counts added and removed scenes independently of array positions', () => {
    const scenes = [scene(1, '2'), scene(2, '99'), scene(3)]
    expect(diffS2Scenes(scenes, [beat(1), beat(2), beat(3)])).toEqual({
      added: 1, removed: 2, unaligned: 2, aligned: 1,
    })
  })
})

describe('asset selection and chip matching', () => {
  it('uses asset ratio and only exposes ready/reused versions', () => {
    expect(aspectRatioClassFromValue('9:16')).toBe('is-portrait')
    expect(aspectRatioClassFromValue('16:9')).toBe('is-landscape')
    expect(['ready', 'reused'].every((s) => isVersionSelectable(s as 'ready'))).toBe(true)
    expect(['queued', 'processing', 'pending', 'failed'].some((s) => isVersionSelectable(s as 'failed'))).toBe(false)
  })

  it('uses one ID-or-name predicate for both legacy and current chips', () => {
    expect(isAssetChipBound({ referencedAssetIds: [], referencedAssetNames: ['林晚'] }, { id: 'a1', name: '林晚' })).toBe(true)
    expect(isAssetChipBound({ referencedAssetIds: ['a1'], referencedAssetNames: [] }, { id: 'a1', name: '林晚' })).toBe(true)
    expect(isAssetChipBound({ referencedAssetIds: [], referencedAssetNames: ['别人'] }, { id: 'a1', name: '林晚' })).toBe(false)
  })
})

describe('model duration and playable shot navigation', () => {
  it('prefers current model capabilities over stale artifact bounds', () => {
    const range = normalizeDurationBounds({ min: 4, max: 8 }, { min: 2, max: 30 })
    expect(range).toEqual({ min: 4, max: 8 })
    expect(clampDurationSec(30, range)).toBe(8)
    expect(durationOptions(range, 30)).toEqual([4, 5, 6, 8])
  })

  it('skips unavailable shots and disables out-of-range manual navigation', () => {
    const shots = [shot('ready', 'ready'), shot('queued', 'queued'), shot('failed', 'failed'), shot('last', 'ready')]
    const url = (take: VideoGenShotEntry['takes'][number] | null) => take?.videoUrl || null
    expect(findNextPlayableShotIndex(shots, 0, url)).toBe(3)
    expect(findNavigableShotIndex(shots, 0, 1, url)).toBe(3)
    expect(findNavigableShotIndex(shots, 3, 1, url)).toBe(-1)
    expect(findNavigableShotIndex(shots, 0, -1, url)).toBe(-1)
  })
})
