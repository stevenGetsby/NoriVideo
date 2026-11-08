import { describe, expect, it } from 'vitest'
import { compileChapter, type CanvasEdgeLike, type CanvasNodeLike } from '@/lib/interactive/compile'
import { normalizeStoryConfig } from '@/lib/interactive/config'
import {
  SCENE_TEXT_MAX,
  clampSceneText,
  fitSceneTextRows,
  normalizeSceneText,
  sceneTextLength,
  sceneTextMetrics,
} from '@/lib/interactive/scene-text'
import { ensureStorySequence } from '@/lib/interactive/sequence'

const textNodes: CanvasNodeLike[] = [
  { id: 'in', type: 'story_entry', data: { title: '开场' } },
  {
    id: 's1',
    type: 'story_scene',
    data: { title: '城头', lines: '甲\r\n乙', effects: [{ variableId: 'hp', op: 'add', value: 1 }] },
  },
  {
    id: 'choice',
    type: 'story_choice',
    data: {
      title: '出城？',
      defaultOptionId: 'o_main',
      options: [
        { id: 'o_main', label: '迎战' },
        { id: 'o_branch', label: '绕行' },
      ],
    },
  },
  { id: 's3', type: 'story_scene', data: { title: '主线段', lines: '主线' } },
  { id: 's2', type: 'story_scene', data: { title: '支线段', lines: '支线' } },
  { id: 'out', type: 'story_exit', data: { title: '离开' } },
]

const flow = (id: string, source: string, target: string, sourceHandle = 'output'): CanvasEdgeLike =>
  ({ id, source, target, sourceHandle, role: 'STORY_FLOW' })

const textEdges: CanvasEdgeLike[] = [
  flow('f1', 'in', 's1'),
  flow('f2', 's1', 'choice'),
  flow('f3', 'choice', 's3', 'o_main'),
  flow('f4', 'choice', 's2', 'o_branch'),
  flow('f5', 's3', 'out'),
]

const compileTextChapter = () => compileChapter({ projectId: 'p1', title: '第一章' }, textNodes, textEdges)

describe('scene text normalization', () => {
  it('normalises line endings and strips NUL while preserving spaces, tabs and emoji', () => {
    expect(normalizeSceneText('a\r\nb\rc')).toBe('a\nb\nc')
    expect(normalizeSceneText(`a${String.fromCharCode(0)} b`)).toBe('a b')
    expect(normalizeSceneText('  空格\t制表😀  ')).toBe('  空格\t制表😀  ')
    expect(normalizeSceneText(undefined)).toBe('')
    expect(normalizeSceneText(null)).toBe('')
    expect(normalizeSceneText(123)).toBe('')
    expect(normalizeSceneText({ lines: '不是字符串' })).toBe('')
  })

  it('counts Unicode code points so emoji are one character', () => {
    expect(sceneTextLength('abc')).toBe(3)
    expect(sceneTextLength('😀')).toBe(1)
    expect(sceneTextLength('甲😀')).toBe(2)
  })
})

describe('scene text boundaries', () => {
  it('keeps text exactly at the limit unchanged', () => {
    const text = '甲'.repeat(SCENE_TEXT_MAX)
    expect(clampSceneText(text)).toBe(text)
    expect(sceneTextMetrics(text)).toMatchObject({ chars: SCENE_TEXT_MAX, remaining: 0, isFull: true, isEmpty: false })
  })

  it('cuts past the limit at a code-point boundary instead of splitting an emoji', () => {
    const text = 'a'.repeat(SCENE_TEXT_MAX - 1) + '😀' + '尾'
    const clamped = clampSceneText(text)
    expect(sceneTextLength(clamped)).toBe(SCENE_TEXT_MAX)
    expect(clamped.endsWith('😀')).toBe(true)
    expect(clamped.endsWith('尾')).toBe(false)
  })

  it('handles zero, fractional, negative and non-finite limits deterministically', () => {
    expect(clampSceneText('abc', 0)).toBe('')
    expect(clampSceneText('abc', 2)).toBe('ab')
    expect(clampSceneText('abc', 10.9)).toBe('abc')
    expect(clampSceneText('abc', Number.NaN)).toBe('abc')
    expect(clampSceneText('abc', -4)).toBe('abc')
    expect(clampSceneText('abc', Number.POSITIVE_INFINITY)).toBe('abc')
  })

  it('reports empty, partial and full metrics with normalised text', () => {
    expect(sceneTextMetrics('')).toEqual({
      text: '', chars: 0, lines: 0, max: SCENE_TEXT_MAX, remaining: SCENE_TEXT_MAX, isFull: false, isEmpty: true,
    })
    expect(sceneTextMetrics('甲\r\n乙')).toMatchObject({ text: '甲\n乙', chars: 3, lines: 2, remaining: SCENE_TEXT_MAX - 3 })
    expect(sceneTextMetrics('x'.repeat(SCENE_TEXT_MAX + 30), SCENE_TEXT_MAX)).toMatchObject({
      chars: SCENE_TEXT_MAX, max: SCENE_TEXT_MAX, remaining: 0, isFull: true,
    })
  })
})

describe('scene textarea rows', () => {
  it('never shrinks below the minimum, grows with explicit lines, and caps at the maximum', () => {
    expect(fitSceneTextRows('')).toBe(3)
    expect(fitSceneTextRows('一行')).toBe(3)
    expect(fitSceneTextRows('a\nb\nc\nd')).toBe(4)
    expect(fitSceneTextRows('甲'.repeat(26 * 4), { wrapAt: 26 })).toBe(4)
    expect(fitSceneTextRows('甲'.repeat(26 * 30), { wrapAt: 26, maxRows: 10 })).toBe(10)
    expect(fitSceneTextRows('a\nb\nc\nd', { minRows: 1, maxRows: 2 })).toBe(2)
  })

  it('falls back cleanly for invalid options and normalised CRLF input', () => {
    expect(fitSceneTextRows('a\r\nb', { minRows: 0, maxRows: 0, wrapAt: 0 })).toBe(3)
    expect(fitSceneTextRows('a\r\nb\r\nc', { minRows: 1, maxRows: 10 })).toBe(3)
  })
})

describe('scene text in the compiled story', () => {
  it('normalises legacy text while preserving scene effects and node identity', () => {
    const chapter = compileTextChapter()
    const scene = chapter.nodes.find((node) => node.id === 's1')
    expect(scene).toMatchObject({
      id: 's1',
      kind: 'scene',
      title: '城头',
      lines: '甲\n乙',
      effects: [{ variableId: 'hp', op: 'add', value: 1 }],
      media: null,
    })
    expect(chapter.flows.map((item) => [item.from, item.handle, item.to])).toEqual([
      ['in', 'output', 's1'],
      ['s1', 'output', 'choice'],
      ['choice', 'o_main', 's3'],
      ['choice', 'o_branch', 's2'],
      ['s3', 'output', 'out'],
    ])
  })

  it('keeps old configs without a sequence working and derives branch scenes from the choice', () => {
    const config = normalizeStoryConfig({
      chapters: [{ projectId: 'p1', order: 0 }],
      links: [],
      start: { projectId: 'p1', entryNodeId: 'in' },
    })
    expect(config.sequence).toBeUndefined()

    const chapter = compileTextChapter()
    const sequence = ensureStorySequence(config, [chapter])
    expect(sequence.segments.map((segment) => [segment.projectId, segment.sceneNodeId, segment.branch])).toEqual([
      ['p1', 's1', false],
      ['p1', 's3', false],
      ['p1', 's2', true],
    ])

    // Editing the words must not reshuffle the work sequence or branch flags.
    const edited = {
      ...chapter,
      nodes: chapter.nodes.map((node) => (node.id === 's1' ? { ...node, lines: clampSceneText('新的\r\n台词') } : node)),
    }
    expect(ensureStorySequence(config, [edited])).toEqual(sequence)
  })
})
