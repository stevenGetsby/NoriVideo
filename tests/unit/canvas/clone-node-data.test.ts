import { describe, expect, it } from 'vitest'
import { cloneCanvasNodeDataForNewNode } from '@/features/canvas/clone-node-data'

describe('canvas node duplication execution state', () => {
  it('clears a running media execution while keeping reusable configuration and remapping references', () => {
    const cloned = cloneCanvasNodeDataForNewNode({
      title: '生成中图片',
      prompt: '电影感雨夜',
      generation: {
        modelKey: 'nori::nori-image',
        assetId: 'asset-original',
        taskId: 'task-original',
        referenceNodeIds: ['inside', 'outside'],
      },
      generationTask: { kind: 'storyboard_plan', taskId: 'task-plan' },
      progress: 46,
      errorMessage: '旧错误',
      __server: {
        status: 'RUNNING',
        taskId: 'task-original',
        runId: 'run-original',
        mediaObjectId: null,
        parentNodeId: 'inside',
      },
    }, (id) => id === 'inside' ? 'inside-copy' : undefined)

    expect(cloned.generation).toMatchObject({
      modelKey: 'nori::nori-image',
      referenceNodeIds: ['inside-copy', 'outside'],
    })
    expect(cloned.generation).not.toHaveProperty('assetId')
    expect(cloned.generation).not.toHaveProperty('taskId')
    expect(cloned.generationTask).toBeNull()
    expect(cloned).toMatchObject({
      progress: 0,
      errorMessage: null,
      __server: { status: 'IDLE', taskId: null, runId: null, parentNodeId: 'inside-copy' },
    })
  })

  it('keeps completed content and history without making the clone poll the old task', () => {
    const cloned = cloneCanvasNodeDataForNewNode({
      text: '已经生成完成的正文',
      history: [{
        id: 'history-1',
        taskId: 'task-old',
        status: 'ready',
        createdAt: '2026-07-18T00:00:00.000Z',
      }],
      generation: { modelKey: 'nori::nori-gpt', taskId: 'task-old' },
      generationTask: { kind: 'text', taskId: 'task-old', completed: true },
      __server: { status: 'SUCCEEDED', taskId: 'task-old', runId: null, mediaObjectId: null, parentNodeId: null },
    }, () => undefined)

    expect(cloned.text).toBe('已经生成完成的正文')
    expect(cloned.history).toHaveLength(1)
    expect(cloned.generationTask).toBeNull()
    expect(cloned.generation).not.toHaveProperty('taskId')
    expect(cloned).toMatchObject({ progress: 100, __server: { status: 'SUCCEEDED', taskId: null } })
  })
  it('drops uncopied graph references on cross-canvas paste without touching story globals', () => {
    const cloned = cloneCanvasNodeDataForNewNode({
      title: '跨章片段',
      generation: {
        referenceNodeIds: ['copied', 'source-only'],
        pausedReferenceNodeIds: ['source-only'],
        referenceSummary: [{ id: 'source-only', title: '旧画面', type: 'image' }],
        referenceMentionNames: { 'source-only': ['旧画面'] },
        referenceMentionSelections: [{ nodeId: 'source-only', name: '旧画面' }],
      },
      effects: [{ variableId: 'story-global-variable', op: 'add', value: 1 }],
      videoEdit: {
        sourceKind: 'node', sourceNodeId: 'source-only',
        references: [{ id: 'source-only', title: '旧视频', type: 'video' }],
      },
      playlistItems: [{ id: 'item', sourceNodeId: 'source-only', title: '旧片段', sourceInMs: 0 }],
    }, (id) => id === 'copied' ? 'copied-new' : undefined, false)

    expect(cloned.generation).toMatchObject({ referenceNodeIds: ['copied-new'], pausedReferenceNodeIds: [], referenceSummary: [], referenceMentionNames: {}, referenceMentionSelections: [] })
    expect(cloned.videoEdit).toMatchObject({ sourceKind: 'none', sourceNodeId: null, references: [] })
    expect(cloned.playlistItems?.[0].sourceNodeId).toBeNull()
    expect(cloned.effects).toEqual([{ variableId: 'story-global-variable', op: 'add', value: 1 }])
  })

  it('preserves text annotations when copying a node', () => {
    const cloned = cloneCanvasNodeDataForNewNode({ text: '重点', textMarks: [{ start: 0, end: 2, bold: true, highlight: 'yellow' }] }, () => undefined)
    expect(cloned.textMarks).toEqual([{ start: 0, end: 2, bold: true, highlight: 'yellow' }])
  })
})
