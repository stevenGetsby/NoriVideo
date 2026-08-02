import fs from 'node:fs'
import path from 'node:path'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { CanvasOperationTaskProgress } from '@/features/canvas/components/CanvasOperationTaskProgress'
import type { CanvasOperationTaskUpdate } from '@/features/canvas/operation-task-client'

beforeAll(() => vi.stubGlobal('React', React))
afterAll(() => vi.unstubAllGlobals())

function taskUpdate(
  overrides: Partial<CanvasOperationTaskUpdate['task']> = {},
): CanvasOperationTaskUpdate {
  return {
    task: {
      id: 'task-123456789',
      type: 'canvasImageSuperresolve',
      operation: 'superresolve',
      engineKey: 'local-sharp',
      modelKey: 'local-sharp',
      sourceNodeId: 'node-1',
      status: 'processing',
      progress: 42,
      stage: 'canvas_operation_process',
      stageLabel: null,
      progressDetails: null,
      attempt: 1,
      maxAttempts: 3,
      result: null,
      error: null,
      canCancel: true,
      canRetry: false,
      queuedAt: '2026-07-17T00:00:00.000Z',
      startedAt: '2026-07-17T00:00:01.000Z',
      finishedAt: null,
      updatedAt: '2026-07-17T00:00:02.000Z',
      ...overrides,
    },
    links: {
      status: '/tasks/task-123456789',
      cancel: '/tasks/task-123456789',
      retry: '/tasks/task-123456789/retry',
    },
  }
}

function render(update: CanvasOperationTaskUpdate, materialized = false) {
  return renderToStaticMarkup(React.createElement(CanvasOperationTaskProgress, {
    update,
    engineLabel: '本地超清',
    materialized,
    onCancel: vi.fn(),
    onRetry: vi.fn(),
    onRecover: vi.fn(),
  }))
}

describe('canvas asynchronous operation task UI', () => {
  it('announces live progress and exposes cancellation while processing', () => {
    const markup = render(taskUpdate())

    expect(markup).toContain('aria-live="polite"')
    expect(markup).toContain('aria-busy="true"')
    expect(markup).toContain('role="progressbar"')
    expect(markup).toContain('aria-valuenow="42"')
    expect(markup).toContain('正在处理画面')
    expect(markup).toContain('取消任务')
  })

  it('announces task errors and exposes retry without losing the failure detail', () => {
    const markup = render(taskUpdate({
      status: 'failed',
      canCancel: false,
      canRetry: true,
      error: { code: 'PROCESS_FAILED', message: '处理引擎暂时不可用', retryable: true },
    }))

    expect(markup).toContain('role="alert"')
    expect(markup).toContain('处理引擎暂时不可用')
    expect(markup).toContain('重试任务')
    expect(markup).not.toContain('取消任务')
  })

  it('reports completed tasks as 100 percent and offers result recovery', () => {
    const markup = render(taskUpdate({
      status: 'completed',
      progress: 76,
      canCancel: false,
      result: { results: [] },
    }))

    expect(markup).toContain('aria-valuenow="100"')
    expect(markup).toContain('aria-valuetext="处理完成，100%"')
    expect(markup).toContain('载入画布')
  })

  it('ships state, engine, responsive overflow, and reduced-motion styles', () => {
    const styles = fs.readFileSync(path.join(process.cwd(), 'src/features/canvas/canvas.css'), 'utf8')

    for (const selector of [
      '.nori-canvas-operation-engine {',
      '.nori-canvas-video-operation-engine {',
      '.nori-canvas-operation-task {',
      '.nori-canvas-operation-task.is-completed {',
      '.nori-canvas-operation-task.is-failed {',
      '.nori-canvas-operation-task.is-canceled {',
      '@media (prefers-reduced-motion: reduce)',
    ]) expect(styles).toContain(selector)

    expect(styles).toMatch(/\.nori-canvas-video-operation-dialog \{[^}]*overflow-y: auto;/)
    expect(styles).toContain('.nori-canvas-operation-task > footer button:focus-visible {')
  })
})
