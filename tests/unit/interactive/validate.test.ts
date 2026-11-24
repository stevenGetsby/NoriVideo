import { describe, expect, it } from 'vitest'
import { compileChapter, type CanvasEdgeLike, type CanvasNodeLike } from '@/lib/interactive/compile'
import { countIssues, validateChapter, validateStory } from '@/lib/interactive/validate'
import { buildProgram, chapterOneEdges, chapterOneNodes, variables } from './fixture'

const codes = (issues: { code: string }[]) => issues.map((item) => item.code)

describe('interactive story checks', () => {
  it('passes a complete story with only the expected warning', () => {
    const issues = validateStory(buildProgram())
    expect(countIssues(issues).errors).toBe(0)
    expect(codes(issues)).toEqual(['choice_no_picture', 'scene_no_media'])
  })

  it('flags chapter-level gaps', () => {
    const nodes = [
      ...chapterOneNodes.filter((node) => node.id !== 'a_exit'),
      { id: 'orphan', type: 'story_scene', data: { title: '孤岛' } },
      { id: 'cond', type: 'story_condition', data: { branches: [{ id: 'b1', label: '有勇', conditions: [{ variableId: 'ghost', op: '>', value: 1 }] }] } },
      { id: 'pick', type: 'story_choice', data: { title: '单选', timeoutSec: 5, options: [{ id: 'x', label: '', effects: [{ variableId: 'trust', op: 'add', value: 1 }] }] } },
    ]
    const edges = chapterOneEdges.filter((edge) => edge.id !== 'f5')
    const issues = validateChapter(compileChapter({ projectId: 'p1', title: '第一章' }, nodes, edges), variables)
    expect(codes(issues)).toEqual(expect.arrayContaining([
      'dead_end', 'branch_unlinked', 'else_unlinked', 'unknown_variable', 'option_unlinked',
      'effect_add_boolean', 'choice_single', 'option_label', 'choice_timeout_default', 'unreachable',
    ]))
    expect(issues[0].level).toBe('error')
    expect(issues.find((item) => item.code === 'dead_end')?.nodeId).toBe('a_s2')
  })

  it('flags missing entry, terminal and condition loops', () => {
    const chapter = compileChapter({ projectId: 'p9', title: '空章' }, [
      { id: 'c1', type: 'story_condition', data: {} },
      { id: 'c2', type: 'story_condition', data: {} },
    ], [
      { id: 'x1', source: 'c1', target: 'c2', sourceHandle: 'else', role: 'STORY_FLOW' },
      { id: 'x2', source: 'c2', target: 'c1', sourceHandle: 'else', role: 'STORY_FLOW' },
    ])
    expect(codes(validateChapter(chapter, variables))).toEqual(expect.arrayContaining(['no_entry', 'no_terminal', 'condition_loop', 'condition_empty']))
  })

  it('flags story-level wiring problems', () => {
    const program = buildProgram()
    program.links = [program.links[0], { id: 'dead', fromProjectId: 'p1', exitNodeId: 'gone', toProjectId: 'p2', toEntryNodeId: 'b_in' }]
    program.chapters.push(compileChapter({ projectId: 'p3', title: '番外' }, [
      { id: 'z_in', type: 'story_entry', data: {} },
      { id: 'z_end', type: 'story_ending', data: {} },
    ], [{ id: 'z1', source: 'z_in', target: 'z_end', sourceHandle: 'output', role: 'STORY_FLOW' }]))
    const issues = validateStory(program)
    expect(codes(issues)).toEqual(expect.arrayContaining(['link_invalid', 'exit_unlinked', 'entry_unlinked', 'chapter_unreachable']))
    expect(issues.find((item) => item.code === 'exit_unlinked')?.nodeId).toBe('a_exit_run')
  })

  it('flags chapter link cycles', () => {
    const program = buildProgram()
    program.links = [
      { id: 'l1', fromProjectId: 'p1', exitNodeId: 'a_exit', toProjectId: 'p2', toEntryNodeId: 'b_in' },
      { id: 'l2', fromProjectId: 'p2', exitNodeId: 'b_good', toProjectId: 'p1', toEntryNodeId: 'a_in' },
    ]
    const cycle = validateStory(program).find((item) => item.code === 'chapter_cycle')
    expect(cycle).toMatchObject({ level: 'error', projectId: 'p1' })
  })

  it('requires chapters, a valid start and at least one ending', () => {
    expect(codes(validateStory({ variables: [], chapters: [], links: [], start: null }))).toEqual(['no_chapters'])
    const program = buildProgram()
    program.start = { projectId: 'p1', entryNodeId: 'a_s1' }
    program.chapters[1] = compileChapter({ projectId: 'p2', title: '第二章' }, [], [])
    expect(codes(validateStory(program))).toEqual(expect.arrayContaining(['start_invalid', 'no_ending', 'link_invalid']))
  })
})

describe('picture checks', () => {
  const entry: CanvasNodeLike = { id: 'in', type: 'story_entry', data: {} }
  const exit: CanvasNodeLike = { id: 'out', type: 'story_ending', data: {} }
  const video: CanvasNodeLike = { id: 'v', type: 'video', data: { videoUrl: '/v.mp4', posterUrl: '/v.png' } }
  const image: CanvasNodeLike = { id: 'img', type: 'image', data: { imageUrl: '/i.png' } }
  const tap: CanvasNodeLike = { id: 'i', type: 'story_interaction', data: { title: '快点', interaction: 'tap', count: 5, durationSec: 3 } }
  const choice: CanvasNodeLike = {
    id: 'c',
    type: 'story_choice',
    data: { title: '抉择', timeoutSec: 5, defaultOptionId: 'o1', options: [{ id: 'o1', label: '走' }, { id: 'o2', label: '留' }] },
  }
  const hotspot: CanvasNodeLike = {
    id: 'i',
    type: 'story_interaction',
    data: { title: '找线索', interaction: 'hotspot', frameImageUrl: '/frame.png', durationSec: 6, zones: [{ id: 'z1', label: '线索', x: 0.4, y: 0.4, w: 0.2, h: 0.2 }] },
  }
  const flow = (id: string, source: string, target: string, sourceHandle = 'output'): CanvasEdgeLike =>
    ({ id, source, target, sourceHandle, role: 'STORY_FLOW' })
  const media = (id: string, source: string, target: string): CanvasEdgeLike =>
    ({ id, source, target, sourceHandle: 'output', role: 'REF' })
  const mount = (id: string, source: string, target: string): CanvasEdgeLike =>
    ({ id, source, target, sourceHandle: 'output', role: 'STORY_MOUNT' })
  const issuesOf = (nodes: CanvasNodeLike[], edges: CanvasEdgeLike[]) =>
    validateChapter(compileChapter({ projectId: 'p1', title: '第一章' }, nodes, edges), variables)
  const pictureCodes = (nodes: CanvasNodeLike[], edges: CanvasEdgeLike[]) =>
    codes(issuesOf(nodes, edges)).filter((code) => ['interaction_no_picture', 'choice_no_picture', 'hotspot_picture_and_frame'].includes(code))

  it('warns when a standalone interaction has no picture', () => {
    const issues = issuesOf([entry, tap, exit], [flow('f1', 'in', 'i'), flow('f2', 'i', 'out')])
    expect(issues.find((item) => item.code === 'interaction_no_picture')).toMatchObject({ level: 'warning', nodeId: 'i', projectId: 'p1' })
  })

  it('stays quiet once a video or image is wired to the interaction', () => {
    expect(pictureCodes([entry, tap, video, exit], [flow('f1', 'in', 'i'), flow('f2', 'i', 'out'), media('m1', 'v', 'i')])).toEqual([])
    expect(pictureCodes([entry, tap, image, exit], [flow('f1', 'in', 'i'), flow('f2', 'i', 'out'), media('m1', 'img', 'i')])).toEqual([])
  })

  it('does not warn for an interaction mounted on a scene with its own video', () => {
    const scene: CanvasNodeLike = { id: 's', type: 'story_scene', data: { title: '片段', videoUrl: '/s.mp4' } }
    expect(pictureCodes(
      [entry, scene, tap, exit],
      [flow('f1', 'in', 's'), flow('f2', 's', 'out'), mount('m1', 's', 'i')],
    )).toEqual([])
  })

  it('warns when a choice has no backdrop and stays quiet with one', () => {
    const edges = [flow('f1', 'in', 'c'), flow('f2', 'c', 'out', 'o1'), flow('f3', 'c', 'out', 'o2')]
    const issues = issuesOf([entry, choice, exit], edges)
    expect(issues.find((item) => item.code === 'choice_no_picture')).toMatchObject({ level: 'warning', nodeId: 'c', projectId: 'p1' })
    expect(pictureCodes([entry, choice, image, exit], [...edges, media('m1', 'img', 'c')])).toEqual([])
  })

  it('only flags hotspot frame+picture together when both exist', () => {
    const edges = [flow('f1', 'in', 'i'), flow('f2', 'i', 'out', 'z1'), flow('f3', 'i', 'out', 'timeout')]
    expect(pictureCodes([entry, hotspot, exit], edges)).not.toContain('hotspot_picture_and_frame')
    const issues = issuesOf([entry, hotspot, video, exit], [...edges, media('m1', 'v', 'i')])
    expect(issues.find((item) => item.code === 'hotspot_picture_and_frame')).toMatchObject({ level: 'warning', nodeId: 'i', projectId: 'p1' })
    expect(codes(issues)).not.toContain('interaction_no_picture')
  })
  it('flags an exit wired to two different scenes, since trial play only follows one', () => {
    const nodes = [
      { id: 'in', type: 'story_entry', data: {} },
      { id: 's1', type: 'story_scene', data: { title: '起点' } },
      { id: 's2', type: 'story_scene', data: { title: '甲' } },
      { id: 's3', type: 'story_scene', data: { title: '乙' } },
      { id: 'end', type: 'story_ending', data: {} },
    ]
    const flow = (id: string, source: string, target: string) => ({ id, source, target, sourceHandle: 'output', role: 'STORY_FLOW' })
    const edges = [flow('e0', 'in', 's1'), flow('e1', 's1', 's2'), flow('e2', 's1', 's3'), flow('e3', 's2', 'end'), flow('e4', 's3', 'end')]
    const issues = validateChapter(compileChapter({ projectId: 'p1', title: '第一章' }, nodes, edges), variables)
    const fanout = issues.filter((item) => item.code === 'flow_fanout')
    expect(fanout).toHaveLength(1)
    expect(fanout[0]).toMatchObject({ level: 'error', nodeId: 's1' })

    const single = validateChapter(compileChapter({ projectId: 'p1', title: '第一章' }, nodes, edges.filter((edge) => edge.id !== 'e2')), variables)
    expect(codes(single)).not.toContain('flow_fanout')
  })
})
