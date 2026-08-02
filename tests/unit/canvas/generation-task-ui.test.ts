import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { parseCanvasGenerationTaskUpdate } from '@/features/canvas/generation-task-client'
import { resolveCanvasRegenerationMode } from '@/features/canvas/types'

describe('canvas persistent generation task UI helpers', () => {
  it('accepts the scoped task status envelope used by refresh polling', () => {
    const update = parseCanvasGenerationTaskUpdate({
      task: {
        id: 'task-1',
        type: 'canvas_text_generation',
        kind: 'text',
        nodeId: 'node-1',
        status: 'processing',
        progress: 42,
      },
      links: {
        status: '/status',
        cancel: '/status',
        retry: '/status/retry',
      },
    })

    expect(update).toMatchObject({
      task: { id: 'task-1', nodeId: 'node-1', status: 'processing', progress: 42 },
      links: { retry: '/status/retry' },
    })
  })

  it('retries a failed planning node as a storyboard plan rather than one plain image', () => {
    expect(resolveCanvasRegenerationMode({
      processType: 'storyboard',
      generation: { count: 6 },
      generationTask: { kind: 'storyboard_plan', taskId: 'task-plan' },
    })).toEqual({ count: 6, storyboard: true })

    expect(resolveCanvasRegenerationMode({
      processType: 'storyboard',
      generation: { count: 1 },
      generationTask: null,
    })).toEqual({ count: 1, storyboard: false })
  })

  it('exposes cancel and original-task retry actions on persistent generation nodes', () => {
    const graph = fs.readFileSync(path.join(process.cwd(), 'src/features/canvas/CanvasGraph.tsx'), 'utf8')
    const node = fs.readFileSync(path.join(process.cwd(), 'src/features/canvas/nodes/CreativeNode.tsx'), 'utf8')
    const client = fs.readFileSync(path.join(process.cwd(), 'src/features/canvas/generation-task-client.ts'), 'utf8')

    expect(node).toContain("editor.runNodeAction(id, 'cancel_generation')")
    expect(node).toContain("data.generationTask?.taskId ? 'retry_generation_task' : 'regenerate'")
    expect(graph).toContain("action === 'cancel_generation'")
    expect(graph).toContain("action === 'retry_generation_task'")
    expect(graph).toContain("retryOf: previousTask.taskId")
    expect(client).toContain("method: 'DELETE'")
    expect(client).toContain('/retry`')
  })

  it('surfaces bounded polling errors while retaining a recoverable running task', () => {
    const graph = fs.readFileSync(path.join(process.cwd(), 'src/features/canvas/CanvasGraph.tsx'), 'utf8')
    const node = fs.readFileSync(path.join(process.cwd(), 'src/features/canvas/nodes/CreativeNode.tsx'), 'utf8')
    expect(graph).toContain('CANVAS_POLL_FAILURE_LIMIT = 4')
    expect(graph).toContain('连续 ${CANVAS_POLL_FAILURE_LIMIT} 次无法读取生成任务状态')
    expect(graph).toContain('连续 ${CANVAS_POLL_FAILURE_LIMIT} 次无法读取生成状态')
    expect(graph).toContain('pollErrorMessage: pollFailure')
    expect(graph).toContain('pollErrorMessage: message')
    expect(node).toContain('状态读取异常，正在重试')
  })

  it('keeps toolbox media polling display-only because workers own terminal persistence', () => {
    const graph = fs.readFileSync(path.join(process.cwd(), 'src/features/canvas/CanvasGraph.tsx'), 'utf8')
    const start = graph.indexOf('if (!runningSignature) return')
    const end = graph.indexOf('const keydown = (event: KeyboardEvent)', start)
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    const mediaPolling = graph.slice(start, end)
    expect(mediaPolling).not.toContain('markChanged(')
    expect(mediaPolling).toContain('Polling is intentionally display')
  })
})
