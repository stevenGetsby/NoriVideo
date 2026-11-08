import { describe, expect, it } from 'vitest'
import { compileChapter, type CanvasEdgeLike, type CanvasNodeLike } from '@/lib/interactive/compile'
import {
  branchSequenceSegments,
  deriveStorySequence,
  ensureStorySequence,
  linearCutSegments,
  mainlineSceneIds,
  moveSequenceSegment,
  orderedChapters,
  orphanSequenceSegments,
  removedSequenceSegments,
  reorderSequenceSegments,
  resolveSequenceSegments,
  sequenceSegmentId,
  sequenceSegmentKey,
  sequenceStats,
  type WorkSequenceChapter,
} from '@/lib/interactive/sequence'
import type { StoryChapterMeta, StoryChapterGraph, StorySequence } from '@/lib/interactive/types'

const flow = (id: string, source: string, target: string, sourceHandle = 'output'): CanvasEdgeLike =>
  ({ id, source, target, sourceHandle, role: 'STORY_FLOW' })

const chapterANodes: CanvasNodeLike[] = [
  { id: 'a_in', type: 'story_entry', data: { title: '开场' } },
  { id: 'a_clip', type: 'video', data: { videoUrl: '/a1.mp4', posterUrl: '/a1.png' } },
  { id: 'a_s1', type: 'story_scene', data: { title: '  城头  ' } },
  {
    id: 'a_choice',
    type: 'story_choice',
    data: {
      title: '出城？',
      defaultOptionId: 'o_stay',
      options: [
        { id: 'o_fight', label: '出城' },
        { id: 'o_stay', label: '守城' },
      ],
    },
  },
  { id: 'a_s2', type: 'story_scene', data: { title: '冲阵' } },
  { id: 'a_s3', type: 'story_scene', data: { title: '守夜' } },
  { id: 'a_exit', type: 'story_exit', data: { title: '离开' } },
]

const chapterAEdges: CanvasEdgeLike[] = [
  flow('f1', 'a_in', 'a_s1'),
  { id: 'r1', source: 'a_clip', target: 'a_s1', role: 'REF' },
  flow('f2', 'a_s1', 'a_choice'),
  flow('f3', 'a_choice', 'a_s2', 'o_fight'),
  flow('f4', 'a_choice', 'a_s3', 'o_stay'),
  flow('f5', 'a_s3', 'a_exit'),
]

const chapterBNodes: CanvasNodeLike[] = [
  { id: 'b_in', type: 'story_entry', data: {} },
  {
    id: 'b_cond',
    type: 'story_condition',
    data: { title: '民心', branches: [{ id: 'br_win', label: '胜', match: 'all', conditions: [] }] },
  },
  { id: 'b_s4', type: 'story_scene', data: { title: '凯旋' } },
  { id: 'b_s5', type: 'story_scene', data: { title: '流亡' } },
  { id: 'b_end', type: 'story_ending', data: { title: '终', endingType: 'normal' } },
]

const chapterBEdges: CanvasEdgeLike[] = [
  flow('g1', 'b_in', 'b_cond'),
  flow('g2', 'b_cond', 'b_s4', 'br_win'),
  flow('g3', 'b_cond', 'b_s5', 'else'),
  flow('g4', 'b_s4', 'b_end'),
  flow('g5', 'b_s5', 'b_end'),
]

const compileA = () => compileChapter({ projectId: 'pa', title: '第一章' }, chapterANodes, chapterAEdges)
const compileB = () => compileChapter({ projectId: 'pb', title: '第二章' }, chapterBNodes, chapterBEdges)

const meta = (projectId: string, order: number): StoryChapterMeta =>
  ({ projectId, order, position: { x: order * 340, y: 0 }, status: 'drafting' })

const chapter = (projectId: string, graph: StoryChapterGraph): WorkSequenceChapter => ({
  projectId, name: graph.title, canvasId: `cv-${projectId}`, graph,
})

const overviewChapter = (graph: StoryChapterGraph, canvasId: string | null = `cv-${graph.projectId}`): WorkSequenceChapter => ({
  projectId: graph.projectId, name: graph.title, canvasId, graph,
})

describe('work-level story sequence', () => {
  it('derives every scene, ordering the linear cut by chapter order and keeping branch scenes', () => {
    const sequence = deriveStorySequence([meta('pb', 0), meta('pa', 1)], [compileA(), compileB()])
    expect(sequence.segments.map((segment) => [segment.projectId, segment.sceneNodeId, segment.branch])).toEqual([
      ['pb', 'b_s4', false],
      ['pa', 'a_s1', false],
      ['pa', 'a_s3', false],
      ['pb', 'b_s5', true],
      ['pa', 'a_s2', true],
    ])
    expect(sequence.segments[0].id).toBe(sequenceSegmentId('pb', 'b_s4'))
    expect(sequence.segments[1].title).toBe('城头')
    expect(sequence.segments.every((segment) => segment.removed === false)).toBe(true)
  })

  it('uses the default choice option, the first condition branch and the declared entry as the canonical line', () => {
    const a = compileA()
    const b = compileB()
    expect(mainlineSceneIds(a)).toEqual(['a_s1', 'a_s3'])
    expect(mainlineSceneIds(b)).toEqual(['b_s4'])
    expect(mainlineSceneIds(b, 'missing-entry')).toEqual(['b_s4'])
    expect(mainlineSceneIds({ projectId: 'empty', title: '空', nodes: [], flows: [] })).toEqual([])
    expect(orderedChapters([meta('pb', 1), meta('pa', 0)], [compileB(), compileA()]).map((item) => item.projectId))
      .toEqual(['pa', 'pb'])
  })

  it('keeps a stored order, removal flags and recomputes branch status from the live graph', () => {
    const stored: StorySequence = {
      segments: [
        { id: 'kept-a3', projectId: 'pa', sceneNodeId: 'a_s3', title: '旧标题', branch: true, removed: false },
        { id: 'kept-a1', projectId: 'pa', sceneNodeId: 'a_s1', title: '', branch: false, removed: true },
        { id: 'kept-b4', projectId: 'pb', sceneNodeId: 'b_s4', title: '凯旋', branch: false, removed: false },
        { id: 'kept-b4', projectId: 'pb', sceneNodeId: 'b_s4', title: '重复', branch: false, removed: false },
      ],
    }
    const ensured = ensureStorySequence({ chapters: [meta('pa', 0), meta('pb', 1)] }, [compileA(), compileB()], stored)
    expect(ensured.segments.map((segment) => [segment.id, segment.projectId, segment.sceneNodeId, segment.branch, segment.removed])).toEqual([
      ['kept-a3', 'pa', 'a_s3', false, false],
      ['kept-a1', 'pa', 'a_s1', false, true],
      ['seg_pa_a_s2', 'pa', 'a_s2', true, false],
      ['kept-b4', 'pb', 'b_s4', false, false],
      ['seg_pb_b_s5', 'pb', 'b_s5', true, false],
    ])
    expect(ensured.segments[0].title).toBe('守夜')
    expect(ensured.segments[1].title).toBe('城头')
    expect(ensureStorySequence({ chapters: [] }, [], undefined)).toEqual({ segments: [] })
  })

  it('appends new scenes after the last segment of the same chapter without touching other chapters', () => {
    const stored: StorySequence = {
      segments: [
        { id: 's3', projectId: 'pa', sceneNodeId: 'a_s3', title: '', branch: false, removed: false },
        { id: 's1', projectId: 'pa', sceneNodeId: 'a_s1', title: '', branch: false, removed: false },
        { id: 's4', projectId: 'pb', sceneNodeId: 'b_s4', title: '', branch: false, removed: false },
      ],
    }
    const ensured = ensureStorySequence({ chapters: [meta('pa', 0), meta('pb', 1)] }, [compileA(), compileB()], stored)
    expect(ensured.segments.map((segment) => segment.sceneNodeId)).toEqual(['a_s3', 'a_s1', 'a_s2', 'b_s4', 'b_s5'])
  })

  it('resolves media, canvas targets and both orphan kinds', () => {
    const resolved = resolveSequenceSegments({
      segments: [
        { id: 'a1', projectId: 'pa', sceneNodeId: 'a_s1', title: '', branch: false, removed: false },
        { id: 'lost-project', projectId: 'gone', sceneNodeId: 'x', title: '', branch: false, removed: false },
        { id: 'lost-scene', projectId: 'pb', sceneNodeId: 'gone', title: '', branch: false, removed: false },
      ],
    }, [chapter('pa', compileA()), chapter('pb', compileB())])
    expect(resolved[0]).toMatchObject({
      chapterName: '第一章', canvasId: 'cv-pa', orphan: null, media: { kind: 'video', url: '/a1.mp4', posterUrl: '/a1.png' },
    })
    expect(resolved[1]).toMatchObject({ chapterName: '', canvasId: null, scene: null, media: null, orphan: 'project' })
    expect(resolved[2]).toMatchObject({ chapterName: '第二章', canvasId: 'cv-pb', scene: null, media: null, orphan: 'scene' })
    expect(sequenceSegmentKey('pa', 'a_s1')).toBe('pa:a_s1')
  })

  it('excludes branch, removed and orphan segments from the linear final cut', () => {
    const resolved = resolveSequenceSegments({
      segments: [
        { id: 'a1', projectId: 'pa', sceneNodeId: 'a_s1', title: '', branch: false, removed: false },
        { id: 'a2', projectId: 'pa', sceneNodeId: 'a_s2', title: '', branch: true, removed: false },
        { id: 'a3', projectId: 'pa', sceneNodeId: 'a_s3', title: '', branch: false, removed: true },
        { id: 'b4', projectId: 'pb', sceneNodeId: 'b_s4', title: '', branch: false, removed: false },
        { id: 'gone', projectId: 'gone', sceneNodeId: 'x', title: '', branch: false, removed: false },
        { id: 'b5', projectId: 'pb', sceneNodeId: 'b_s5', title: '', branch: true, removed: true },
      ],
    }, [chapter('pa', compileA()), chapter('pb', compileB())])
    expect(linearCutSegments(resolved).map((item) => item.segment.id)).toEqual(['a1', 'b4'])
    expect(branchSequenceSegments(resolved).map((item) => item.segment.id)).toEqual(['a2', 'gone', 'b5'])
    expect(removedSequenceSegments(resolved).map((item) => item.segment.id)).toEqual(['a3'])
    expect(orphanSequenceSegments(resolved).map((item) => item.segment.id)).toEqual(['gone'])
    expect(sequenceStats(resolved)).toEqual({ total: 6, linear: 3, cut: 2, branch: 2, removed: 1, orphaned: 1, ready: 1 })
  })

  it('reorders only the movable ids and moves a segment up or down', () => {
    const segments = deriveStorySequence([meta('pa', 0)], [compileA()]).segments
    const ids = segments.filter((segment) => !segment.branch).map((segment) => segment.id)
    const [first, second] = ids
    const reordered = reorderSequenceSegments(segments, [second, first])
    expect(reordered.map((segment) => segment.sceneNodeId)).toEqual(['a_s3', 'a_s1', 'a_s2'])
    expect(reorderSequenceSegments(segments, ['missing'])).toEqual(segments)
    expect(moveSequenceSegment(segments, first, 1, ids).map((segment) => segment.sceneNodeId)).toEqual(['a_s3', 'a_s1', 'a_s2'])
    expect(moveSequenceSegment(segments, second, 1, ids)).toEqual(segments)
    expect(moveSequenceSegment(segments, 'missing', -1, ids)).toEqual(segments)
  })

  it('maps snapshots without a sequence and keeps canvas drill-down targets', () => {
    expect(overviewChapter(compileA(), null).canvasId).toBeNull()
    expect(chapter('pa', compileA())).toMatchObject({ canvasId: 'cv-pa', name: '第一章' })
    const ensured = ensureStorySequence({ chapters: [meta('pa', 0)] }, [compileA()], undefined)
    expect(ensured.segments.filter((segment) => !segment.branch).map((segment) => segment.sceneNodeId)).toEqual(['a_s1', 'a_s3'])
  })
})
