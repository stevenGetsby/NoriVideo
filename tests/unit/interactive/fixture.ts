import { compileChapter, type CanvasEdgeLike, type CanvasNodeLike } from '@/lib/interactive/compile'
import type { StoryProgram, StoryVariable } from '@/lib/interactive/types'

export const variables: StoryVariable[] = [
  { id: 'courage', name: '勇气', type: 'number', initial: 0 },
  { id: 'trust', name: '信任', type: 'boolean', initial: false },
]

const flow = (id: string, source: string, target: string, sourceHandle = 'output'): CanvasEdgeLike =>
  ({ id, source, target, sourceHandle, role: 'STORY_FLOW' })

export const chapterOneNodes: CanvasNodeLike[] = [
  { id: 'a_in', type: 'story_entry', data: { title: '开场' } },
  { id: 'clip', type: 'video', data: { videoUrl: '/a.mp4', posterUrl: '/a.png' } },
  { id: 'a_s1', type: 'story_scene', data: { title: '城头', lines: '敌军压境。', effects: [{ variableId: 'courage', op: 'add', value: 1 }] } },
  {
    id: 'a_c',
    type: 'story_choice',
    data: {
      title: '出城？',
      timeoutSec: 8,
      defaultOptionId: 'o_run',
      options: [
        { id: 'o_fight', label: '出城迎战', effects: [{ variableId: 'trust', op: 'set', value: true }] },
        { id: 'o_run', label: '弃城而走', effects: [{ variableId: 'courage', op: 'add', value: -5 }] },
      ],
    },
  },
  { id: 'a_s2', type: 'story_scene', data: { title: '冲阵' } },
  { id: 'a_exit', type: 'story_exit', data: { title: '迎战' } },
  { id: 'a_exit_run', type: 'story_exit', data: { title: '撤退' } },
]

export const chapterOneEdges: CanvasEdgeLike[] = [
  flow('f1', 'a_in', 'a_s1'),
  { id: 'r1', source: 'clip', target: 'a_s1', sourceHandle: 'output', role: 'REF' },
  flow('f2', 'a_s1', 'a_c'),
  flow('f3', 'a_c', 'a_s2', 'o_fight'),
  flow('f4', 'a_c', 'a_exit_run', 'o_run'),
  flow('f5', 'a_s2', 'a_exit'),
]

export const chapterTwoNodes: CanvasNodeLike[] = [
  { id: 'b_in', type: 'story_entry', data: { title: '凯旋' } },
  { id: 'b_in2', type: 'story_entry', data: { title: '流亡' } },
  {
    id: 'b_cond',
    type: 'story_condition',
    data: {
      title: '民心',
      branches: [{
        id: 'br_hero',
        label: '英雄',
        match: 'all',
        conditions: [{ variableId: 'courage', op: '>=', value: 1 }, { variableId: 'trust', op: '==', value: true }],
      }],
    },
  },
  { id: 'b_good', type: 'story_ending', data: { title: '万民拥戴', endingType: 'good' } },
  { id: 'b_bad', type: 'story_ending', data: { title: '孤城落日', endingType: 'bad' } },
]

export const chapterTwoEdges: CanvasEdgeLike[] = [
  flow('g1', 'b_in', 'b_cond'),
  flow('g2', 'b_in2', 'b_cond'),
  flow('g3', 'b_cond', 'b_good', 'br_hero'),
  flow('g4', 'b_cond', 'b_bad', 'else'),
]

export function buildProgram(): StoryProgram {
  return {
    variables,
    chapters: [
      compileChapter({ projectId: 'p1', title: '第一章' }, chapterOneNodes, chapterOneEdges),
      compileChapter({ projectId: 'p2', title: '第二章' }, chapterTwoNodes, chapterTwoEdges),
    ],
    links: [
      { id: 'l1', fromProjectId: 'p1', exitNodeId: 'a_exit', toProjectId: 'p2', toEntryNodeId: 'b_in' },
      { id: 'l2', fromProjectId: 'p1', exitNodeId: 'a_exit_run', toProjectId: 'p2', toEntryNodeId: 'b_in2' },
    ],
    start: { projectId: 'p1', entryNodeId: 'a_in' },
  }
}
