import { describe, expect, it } from 'vitest'
import { createFlowNode } from '@/features/canvas/editor-types'
import {
  formatComparisonTitle,
  nextComparisonIndex,
  readComparisonIndex,
  restoreComparisonTitle,
  stripComparisonTitleSuffix,
} from '@/features/canvas/comparison-title'
import { createVideoComparisonDraft } from '@/features/canvas/video-comparison'

describe('comparison title helpers', () => {
  it('strips every stacked legacy suffix but keeps unrelated suffixes', () => {
    expect(stripComparisonTitleSuffix('视频节点 · 对照 · 对照 · 对照 · 对照')).toBe('视频节点')
    expect(stripComparisonTitleSuffix('视频节点 · 对照')).toBe('视频节点')
    expect(stripComparisonTitleSuffix('镜头一 · 对照 2')).toBe('镜头一')
    expect(stripComparisonTitleSuffix('图片 · 改图')).toBe('图片 · 改图')
    expect(stripComparisonTitleSuffix('节点 · 720全景')).toBe('节点 · 720全景')
    expect(stripComparisonTitleSuffix('对照')).toBe('对照')
  })

  it('reads only positive integers as a comparison index', () => {
    expect(readComparisonIndex(2)).toBe(2)
    expect(readComparisonIndex(0)).toBe(0)
    expect(readComparisonIndex(-1)).toBe(0)
    expect(readComparisonIndex(1.5)).toBe(0)
    expect(readComparisonIndex('3')).toBe(0)
    expect(readComparisonIndex(undefined)).toBe(0)
  })

  it('derives the next index from the structured field, falling back to legacy suffix count', () => {
    expect(nextComparisonIndex({ title: '视频节点', comparisonIndex: 2 })).toBe(3)
    expect(nextComparisonIndex({ title: '视频节点 · 对照 · 对照 · 对照' })).toBe(4)
    expect(nextComparisonIndex({ title: '视频节点 · 对照 · 对照', comparisonIndex: 7 })).toBe(8)
    expect(nextComparisonIndex({ title: '视频节点' })).toBe(1)
    expect(nextComparisonIndex({})).toBe(1)
  })

  it('continues numbering from a material title that already carries a numbered suffix', () => {
    expect(nextComparisonIndex({ title: '镜头一 · 对照 3' })).toBe(4)
    expect(nextComparisonIndex({ title: '镜头一 · 对照 3 · 对照 2' })).toBe(4)
    expect(nextComparisonIndex({ title: '镜头一 · 对照 12', comparisonIndex: 2 })).toBe(3)
  })

  it('restores structured metadata from re-imported material titles', () => {
    expect(restoreComparisonTitle({ title: '镜头一 · 对照 3' })).toEqual({ title: '镜头一', comparisonIndex: 3 })
    expect(restoreComparisonTitle({ title: '镜头一 · 对照 3 · 对照 2' })).toEqual({ title: '镜头一', comparisonIndex: 3 })
    expect(restoreComparisonTitle({ title: '视频节点 · 对照 · 对照' })).toEqual({ title: '视频节点', comparisonIndex: 2 })
    expect(restoreComparisonTitle({ title: '镜头一', comparisonIndex: 5 })).toEqual({ title: '镜头一', comparisonIndex: 5 })
    expect(restoreComparisonTitle({ title: '镜头一 · 对照 3', comparisonIndex: 5 })).toEqual({ title: '镜头一 · 对照 3', comparisonIndex: 5 })
    expect(restoreComparisonTitle({ title: '镜头一' })).toEqual({ title: '镜头一', comparisonIndex: 0 })
    expect(restoreComparisonTitle({ title: '镜头一 · 对照 0' })).toEqual({ title: '镜头一 · 对照 0', comparisonIndex: 0 })
    expect(restoreComparisonTitle({ title: '镜头一 · 对照 · 终版' })).toEqual({ title: '镜头一 · 对照 · 终版', comparisonIndex: 0 })
    expect(restoreComparisonTitle({ title: '' })).toEqual({ title: '', comparisonIndex: 0 })
  })

  it('formats a single numbered suffix from the base title', () => {
    expect(formatComparisonTitle('视频节点', 1)).toBe('视频节点 · 对照 1')
    expect(formatComparisonTitle(undefined, 2)).toBe('视频节点 · 对照 2')
    expect(formatComparisonTitle('镜头一', 0)).toBe('镜头一')
    expect(formatComparisonTitle('镜头一', undefined)).toBe('镜头一')
  })
})

describe('video comparison draft title', () => {
  const buildDraft = (sourceData: Record<string, unknown>) => {
    const source = createFlowNode('video', { x: 0, y: 0 })
    source.data = {
      ...source.data,
      videoUrl: 'https://example.com/previous.mp4',
      contentUrl: 'https://example.com/previous.mp4',
      ...sourceData,
    }
    return createVideoComparisonDraft({
      source,
      edges: [],
      prompt: '下一镜头',
      generation: { modelKey: 'nori::norivideo2.5' },
      referenceNodeIds: [],
      createId: (() => { let index = 0; return () => `draft-${++index}` })(),
    })
  }

  it('stores the base title and a structured index instead of appending suffixes', () => {
    const first = buildDraft({ title: '视频节点' })
    expect(first.node.data.title).toBe('视频节点')
    expect(first.node.data.comparisonIndex).toBe(1)

    const second = buildDraft({ title: first.node.data.title, comparisonIndex: first.node.data.comparisonIndex })
    expect(second.node.data.title).toBe('视频节点')
    expect(second.node.data.comparisonIndex).toBe(2)

    const third = buildDraft({ title: second.node.data.title, comparisonIndex: second.node.data.comparisonIndex })
    expect(third.node.data.title).toBe('视频节点')
    expect(third.node.data.comparisonIndex).toBe(3)
    expect(formatComparisonTitle(third.node.data.title, third.node.data.comparisonIndex)).toBe('视频节点 · 对照 3')
  })

  it('normalizes legacy stacked titles without migrating stored data', () => {
    const draft = buildDraft({ title: '视频节点 · 对照 · 对照 · 对照 · 对照' })
    expect(draft.node.data.title).toBe('视频节点')
    expect(draft.node.data.comparisonIndex).toBe(5)
    expect(formatComparisonTitle(draft.node.data.title, draft.node.data.comparisonIndex)).toBe('视频节点 · 对照 5')
  })

  it('keeps a user-renamed base title intact', () => {
    const draft = buildDraft({ title: '镜头一 · 终版' })
    expect(draft.node.data.title).toBe('镜头一 · 终版')
    expect(draft.node.data.comparisonIndex).toBe(1)
    expect(formatComparisonTitle(draft.node.data.title, draft.node.data.comparisonIndex)).toBe('镜头一 · 终版 · 对照 1')
  })

  it('starts a new sequence from a literal title after renaming', () => {
    const draft = buildDraft({ title: '镜头一 · 对照 9', comparisonIndex: 0 })
    expect(draft.node.data).toMatchObject({ title: '镜头一 · 对照 9', comparisonIndex: 1 })
  })

  it('continues numbering from a re-imported take instead of stacking a second suffix', () => {
    const draft = buildDraft({ title: '镜头一 · 对照 3' })
    expect(draft.node.data.title).toBe('镜头一')
    expect(draft.node.data.comparisonIndex).toBe(4)
    expect(formatComparisonTitle(draft.node.data.title, draft.node.data.comparisonIndex)).toBe('镜头一 · 对照 4')
  })
})
