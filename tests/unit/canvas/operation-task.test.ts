import { describe, expect, it } from 'vitest'
import {
  buildCanvasOperationDedupeKey,
  listCanvasOperationEngines,
  parseCanvasAsyncOperationInput,
  parseCanvasOperationTaskPayload,
  serializeCanvasOperationTask,
  type CanvasOperationTaskPayload,
} from '@/lib/canvas/operation-task'

describe('canvas asynchronous operation contract', () => {
  it('publishes local defaults without pretending regular generation models are processing engines', () => {
    const engines = listCanvasOperationEngines()
    expect(engines).toEqual(expect.arrayContaining([
      expect.objectContaining({ operation: 'superresolve', engineKey: 'local-sharp', modelKey: 'local-sharp', isDefault: true }),
      expect.objectContaining({ operation: 'video_superresolve', engineKey: 'local-ffmpeg', modelKey: 'local-ffmpeg', isDefault: true }),
      expect.objectContaining({ operation: 'subtitle_erase', engineKey: 'local-ffmpeg', modelKey: 'local-ffmpeg', isDefault: true }),
    ]))

    expect(parseCanvasAsyncOperationInput({ operation: 'superresolve', scale: 2 })).toEqual({
      operation: 'superresolve',
      engineKey: 'local-sharp',
      modelKey: 'local-sharp',
      parameters: { scale: 2 },
    })
    expect(() => parseCanvasAsyncOperationInput({
      operation: 'superresolve',
      scale: 2,
      modelKey: 'ark::seedream',
    })).toThrow('不支持')
  })

  it('normalizes video parameters and creates stable dedupe keys', () => {
    const parsed = parseCanvasAsyncOperationInput({
      operation: 'subtitle_erase',
      modelKey: 'local-ffmpeg',
      mode: 'subtitle',
      region: { x: 0.1, y: 0.2, width: 0.7, height: 0.25 },
    })
    expect(parsed.parameters).toEqual({
      mode: 'subtitle',
      region: { x: 0.1, y: 0.5, width: 0.7, height: 0.25 },
    })

    const payload: CanvasOperationTaskPayload = {
      canvasId: 'canvas-1',
      sourceNodeId: 'node-1',
      sourceStorageKey: 'video/source.mp4',
      sourceTitle: '源视频',
      operation: parsed.operation,
      engineKey: parsed.engineKey,
      modelKey: parsed.modelKey,
      parameters: parsed.parameters,
      retryOf: null,
    }
    expect(parseCanvasOperationTaskPayload(payload)).toEqual(payload)
    expect(buildCanvasOperationDedupeKey(payload)).toBe(buildCanvasOperationDedupeKey({ ...payload }))
  })

  it('serializes progress, failure reason and allowed actions without exposing source storage keys', () => {
    const payload: CanvasOperationTaskPayload = {
      canvasId: 'canvas-1',
      sourceNodeId: 'node-1',
      sourceStorageKey: 'private/source.jpg',
      sourceTitle: '源图',
      operation: 'superresolve',
      engineKey: 'local-sharp',
      modelKey: 'local-sharp',
      parameters: { scale: 2 },
    }
    const serialized = serializeCanvasOperationTask({
      id: 'task-1',
      type: 'canvas_image_operation',
      status: 'failed',
      progress: 32,
      attempt: 1,
      maxAttempts: 1,
      payload: { ...payload, stage: 'canvas_operation_process' },
      result: null,
      errorCode: 'INTERNAL_ERROR',
      errorMessage: 'sharp failed',
      queuedAt: new Date('2026-07-17T00:00:00.000Z'),
      startedAt: new Date('2026-07-17T00:00:01.000Z'),
      finishedAt: new Date('2026-07-17T00:00:02.000Z'),
      updatedAt: new Date('2026-07-17T00:00:02.000Z'),
    })
    expect(serialized).toMatchObject({
      id: 'task-1',
      operation: 'superresolve',
      engineKey: 'local-sharp',
      progress: 32,
      stage: 'canvas_operation_process',
      canCancel: false,
      canRetry: true,
      error: { code: 'INTERNAL_ERROR', message: 'sharp failed' },
    })
    expect(serialized).not.toHaveProperty('sourceStorageKey')
  })
})
