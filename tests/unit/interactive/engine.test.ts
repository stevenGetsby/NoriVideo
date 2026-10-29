import { describe, expect, it } from 'vitest'
import { advanceRun, applyEffects, choiceTimeoutOption, initialVariables, isRunFinished, pickConditionHandle, startRun } from '@/lib/interactive/engine'
import type { StoryConditionNode } from '@/lib/interactive/types'
import { buildProgram, variables } from './fixture'

describe('interactive story engine', () => {
  it('plays the whole story across chapters and lands on the good ending', () => {
    const program = buildProgram()
    let run = startRun(program, { mode: 'story' })
    expect(run.stop.kind).toBe('scene')
    expect(run.vars).toEqual({ courage: 1, trust: false })
    if (run.stop.kind === 'scene') expect(run.stop.node.media).toEqual({ kind: 'video', url: '/a.mp4', posterUrl: '/a.png' })

    run = advanceRun(program, run)
    expect(run.stop.kind).toBe('choice')
    run = advanceRun(program, run, 'o_fight')
    expect(run.vars.trust).toBe(true)
    expect(run.stop.kind).toBe('scene')
    run = advanceRun(program, run)

    expect(run.stop.kind).toBe('ending')
    if (run.stop.kind === 'ending') expect(run.stop.node.title).toBe('万民拥戴')
    expect(run.stop.kind === 'ending' && run.stop.projectId).toBe('p2')
    expect(run.trail.map((step) => step.nodeId)).toEqual(['a_in', 'a_s1', 'a_c', 'a_s2', 'a_exit', 'b_in', 'b_cond', 'b_good'])
    expect(run.trail.find((step) => step.nodeId === 'a_c')?.choice).toBe('出城迎战')
    expect(run.trail.find((step) => step.nodeId === 'b_cond')?.choice).toBe('英雄')
    expect(isRunFinished(run)).toBe(true)
  })

  it('routes the other choice through the else branch to the bad ending', () => {
    const program = buildProgram()
    let run = advanceRun(program, startRun(program, { mode: 'story' }))
    run = advanceRun(program, run, 'o_run')
    expect(run.vars.courage).toBe(-4)
    expect(run.stop.kind === 'ending' && run.stop.node.endingType).toBe('bad')
  })

  it('stops at the exit in single-chapter mode instead of following links', () => {
    const program = buildProgram()
    let run = startRun(program, { mode: 'chapter', projectId: 'p1' })
    run = advanceRun(program, advanceRun(program, run), 'o_run')
    expect(run.stop.kind).toBe('exit')
    expect(run.stop.kind === 'exit' && run.stop.node.title).toBe('撤退')
  })

  it('honours preset variables for a chapter trial', () => {
    const program = buildProgram()
    const run = startRun(program, { mode: 'chapter', projectId: 'p2', entryNodeId: 'b_in2', preset: { courage: 3, trust: true } })
    expect(run.stop.kind === 'ending' && run.stop.node.endingType).toBe('good')
  })

  it('ignores unknown options and halts at dead ends and unlinked exits', () => {
    const program = buildProgram()
    const choice = advanceRun(program, startRun(program, { mode: 'story' }))
    expect(advanceRun(program, choice, 'nope')).toBe(choice)

    program.links = program.links.filter((link) => link.id !== 'l2')
    const stuck = advanceRun(program, choice, 'o_run')
    expect(stuck.stop).toMatchObject({ kind: 'halt', reason: 'unlinked_exit', nodeId: 'a_exit_run' })

    program.chapters[0].flows = program.chapters[0].flows.filter((flow) => flow.id !== 'f3')
    expect(advanceRun(program, choice, 'o_fight').stop).toMatchObject({ kind: 'halt', reason: 'dead_end' })
  })

  it('reports a missing start and a condition loop', () => {
    const program = buildProgram()
    expect(startRun({ ...program, start: null }, { mode: 'story' }).stop).toMatchObject({ kind: 'halt', reason: 'no_start' })
    const chapter = program.chapters[1]
    chapter.flows = [...chapter.flows.filter((flow) => flow.handle !== 'else'), { id: 'loop', from: 'b_cond', handle: 'else', to: 'b_cond' }]
    expect(startRun(program, { mode: 'chapter', projectId: 'p2' }).stop).toMatchObject({ kind: 'halt', reason: 'loop' })
  })

  it('coerces effects to the variable type and skips unknown variables', () => {
    const vars = initialVariables(variables, { courage: 2 })
    expect(applyEffects(vars, [
      { variableId: 'courage', op: 'add', value: 3 },
      { variableId: 'trust', op: 'set', value: 1 },
      { variableId: 'trust', op: 'add', value: 1 },
      { variableId: 'ghost', op: 'set', value: 9 },
    ], variables)).toEqual({ courage: 5, trust: true })
  })

  it('supports any-match branches and falls back to else', () => {
    const node: StoryConditionNode = {
      id: 'c', kind: 'condition', title: '判断',
      branches: [
        { id: 'empty', label: '', match: 'all', conditions: [] },
        { id: 'either', label: '', match: 'any', conditions: [{ variableId: 'courage', op: '>', value: 9 }, { variableId: 'trust', op: '!=', value: false }] },
      ],
    }
    expect(pickConditionHandle(node, { courage: 0, trust: true }, variables)).toBe('either')
    expect(pickConditionHandle(node, { courage: 0, trust: false }, variables)).toBe('else')
  })

  it('times out to the default option, else the first one', () => {
    const program = buildProgram()
    const run = advanceRun(program, startRun(program, { mode: 'story' }))
    if (run.stop.kind !== 'choice') throw new Error('expected choice')
    expect(choiceTimeoutOption(run.stop.node)).toBe('o_run')
    expect(choiceTimeoutOption({ ...run.stop.node, defaultOptionId: null })).toBe('o_fight')
  })
})
