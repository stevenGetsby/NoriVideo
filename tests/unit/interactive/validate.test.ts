import { describe, expect, it } from 'vitest'
import { compileChapter } from '@/lib/interactive/compile'
import { countIssues, validateChapter, validateStory } from '@/lib/interactive/validate'
import { buildProgram, chapterOneEdges, chapterOneNodes, variables } from './fixture'

const codes = (issues: { code: string }[]) => issues.map((item) => item.code)

describe('interactive story checks', () => {
  it('passes a complete story with only the expected warning', () => {
    const issues = validateStory(buildProgram())
    expect(countIssues(issues).errors).toBe(0)
    expect(codes(issues)).toEqual(['scene_no_media'])
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

  it('requires chapters, a valid start and at least one ending', () => {
    expect(codes(validateStory({ variables: [], chapters: [], links: [], start: null }))).toEqual(['no_chapters'])
    const program = buildProgram()
    program.start = { projectId: 'p1', entryNodeId: 'a_s1' }
    program.chapters[1] = compileChapter({ projectId: 'p2', title: '第二章' }, [], [])
    expect(codes(validateStory(program))).toEqual(expect.arrayContaining(['start_invalid', 'no_ending', 'link_invalid']))
  })
})
