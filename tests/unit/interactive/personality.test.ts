import { describe, expect, it } from 'vitest'
import { compileChapter, readEndingData, type CanvasEdgeLike, type CanvasNodeLike } from '@/lib/interactive/compile'
import { advanceRun, choiceTimeoutOption, resolveBeat, startRun, type StoryRun } from '@/lib/interactive/engine'
import { readChoiceOptions } from '@/lib/interactive/interaction'
import {
  STORY_PERSONALITY_DEFAULTS,
  STORY_PERSONALITY_TYPES,
  personalityOutcome,
  personalityResultFor,
  personalityView,
  readPersonalityTags,
  tallyPersonality,
  type StoryPersonalityCounts,
} from '@/lib/interactive/personality'
import { STORY_PERSONALITY_TAGS, STORY_TIMEOUT_HANDLE, type StoryPersonalityTag, type StoryProgram } from '@/lib/interactive/types'
import { beat, ending, entry, flow, mount, scene } from './economy-fixture'
import { choiceNode, option, personalityOn, storyProgram } from './p3-fixture'

const programOf = (nodes: CanvasNodeLike[], edges: CanvasEdgeLike[]): StoryProgram => ({
  variables: [],
  chapters: [compileChapter({ projectId: 'p', title: '章' }, nodes, edges)],
  links: [],
  start: { projectId: 'p', entryNodeId: 'in' },
})

function stopId(run: StoryRun): string {
  return run.stop.kind === 'halt' ? `halt:${run.stop.reason}` : run.stop.node.id
}

describe('personality letters', () => {
  it('keeps known letters once each and one per pair, first one winning', () => {
    expect(readPersonalityTags(undefined)).toEqual([])
    expect(readPersonalityTags('E')).toEqual([])
    expect(readPersonalityTags(['E', 'Z', 3, null, 'S', 'E'])).toEqual(['E', 'S'])
    expect(readPersonalityTags(['E', 'I', 'S'])).toEqual(['E', 'S'])
    expect(readPersonalityTags(['I', 'E', 'N', 'S', 'P', 'J'])).toEqual(['I', 'N', 'P'])
    expect(readPersonalityTags(['e'])).toEqual([])
  })

  it('adds one point per letter without touching the previous counts', () => {
    const before: StoryPersonalityCounts = { E: 1 }
    const after = tallyPersonality(before, ['E', 'N'])
    expect(after).toEqual({ E: 2, N: 1 })
    expect(before).toEqual({ E: 1 })
    expect(tallyPersonality(undefined, ['T'])).toEqual({ T: 1 })
  })

  it('returns the very same counts when an option scores nothing', () => {
    const counts: StoryPersonalityCounts = { E: 1 }
    expect(tallyPersonality(counts, undefined)).toBe(counts)
    expect(tallyPersonality(counts, [])).toBe(counts)
    expect(tallyPersonality(undefined, [])).toBeUndefined()
  })
})

describe('personality outcome', () => {
  it('has no outcome until something scored', () => {
    expect(personalityOutcome(undefined)).toBeNull()
    expect(personalityOutcome({})).toBeNull()
    expect(personalityOutcome({ E: 0, I: 0 })).toBeNull()
  })

  it('takes the higher letter of each pair and gives ties to the left one', () => {
    const outcome = personalityOutcome({ E: 1, I: 3, S: 2, N: 2, F: 1 })
    expect(outcome?.type).toBe('ISFJ')
    expect(outcome?.axes.map((axis) => [axis.left, axis.right, axis.leftCount, axis.rightCount, axis.pick])).toEqual([
      ['E', 'I', 1, 3, 'I'],
      ['S', 'N', 2, 2, 'S'],
      ['T', 'F', 0, 1, 'F'],
      ['J', 'P', 0, 0, 'J'],
    ])
  })

  it('lets a lone letter on the right side win its pair', () => {
    expect(personalityOutcome({ P: 1 })?.type).toBe('ESTP')
  })

  it('spells all sixteen types from one letter per pair', () => {
    expect(new Set(STORY_PERSONALITY_TYPES).size).toBe(16)
    for (const type of STORY_PERSONALITY_TYPES) {
      const counts: StoryPersonalityCounts = {}
      for (const letter of type.split('')) counts[letter as StoryPersonalityTag] = 2
      // The other letter of each pair stays at 0, so the type is exactly the scored letters.
      expect(personalityOutcome(counts)?.type).toBe(type)
    }
  })

  it('knows a built-in name and line for each of the sixteen types', () => {
    for (const type of STORY_PERSONALITY_TYPES) {
      expect(STORY_PERSONALITY_DEFAULTS[type].name.length).toBeGreaterThan(0)
      expect(STORY_PERSONALITY_DEFAULTS[type].description.length).toBeGreaterThan(0)
    }
  })
})

describe('personality result cards', () => {
  it('shows what the creator wrote, and the built-in copy for an empty entry', () => {
    const mine = { enabled: true, results: { ENFP: { name: '热情家', description: '一路热情。', imageUrl: '/e.png' } } }
    expect(personalityResultFor(mine, 'ENFP')).toEqual({ name: '热情家', description: '一路热情。', imageUrl: '/e.png' })
    expect(personalityResultFor(mine, 'ISTJ')).toEqual({ ...STORY_PERSONALITY_DEFAULTS.ISTJ, imageUrl: null })
    expect(personalityResultFor(undefined, 'INTJ')).toEqual({ ...STORY_PERSONALITY_DEFAULTS.INTJ, imageUrl: null })
    const blank = { enabled: true, results: { ENFP: { name: '  ', description: '', imageUrl: null } } }
    expect(personalityResultFor(blank, 'ENFP').name).toBe(STORY_PERSONALITY_DEFAULTS.ENFP.name)
  })

  it('keeps the creator\'s own name even when they wrote no line, instead of mixing in the default line', () => {
    const named = { enabled: true, results: { ENFP: { name: '热情家', description: '', imageUrl: null } } }
    expect(personalityResultFor(named, 'ENFP')).toEqual({ name: '热情家', description: '', imageUrl: null })
  })

  it('has no card while the test is off or nothing scored', () => {
    expect(personalityView(undefined, { E: 1 })).toBeNull()
    expect(personalityView({ enabled: false, results: {} }, { E: 1 })).toBeNull()
    expect(personalityView(personalityOn, undefined)).toBeNull()
    expect(personalityView(personalityOn, {})).toBeNull()
  })

  it('joins the outcome with the result card', () => {
    const builtIn = personalityView(personalityOn, { E: 2, N: 1, F: 1, J: 1 })
    expect(builtIn).toMatchObject({ type: 'ENFJ', name: STORY_PERSONALITY_DEFAULTS.ENFJ.name, imageUrl: null })
    const written = personalityView(personalityOn, { E: 1, N: 1, F: 1, P: 1 })
    expect(written).toMatchObject({ type: 'ENFP', name: '热情家', description: '一路热情。', imageUrl: '/enfp.png' })
    expect(written?.axes).toHaveLength(4)
  })
})

describe('reading tags and the ending switch from the canvas', () => {
  it('only writes tags that were set, and cleans them', () => {
    const [plain, tagged] = readChoiceOptions([{ id: 'a', label: '甲' }, { id: 'b', label: '乙', tags: ['I', 'E', 'Q', 'N'] }])
    expect('tags' in plain).toBe(false)
    expect(tagged.tags).toEqual(['I', 'N'])
    expect('tags' in readChoiceOptions([{ id: 'a', tags: [] }])[0]).toBe(false)
    expect(readChoiceOptions([{ id: 'a', tags: 'E' }])[0].tags).toBeUndefined()
  })

  it('writes showPersonality on an ending only when the creator ticked it', () => {
    expect(readEndingData({ endingType: 'good', showPersonality: true })).toMatchObject({ showPersonality: true })
    expect('showPersonality' in readEndingData({ endingType: 'good' })).toBe(false)
    expect('showPersonality' in readEndingData({ endingType: 'good', showPersonality: 'yes' })).toBe(false)
  })

  it('knows every letter the editor can offer', () => {
    expect([...STORY_PERSONALITY_TAGS].sort().join('')).toBe('EFIJNPST')
  })
})

describe('scoring while the story is played', () => {
  it('adds up the letters of every option picked, across stops', () => {
    const program = programOf(
      [
        entry,
        scene('s1'),
        choiceNode('first', [option('x', '甲', ['E', 'N']), option('y', '乙', ['I', 'S'])]),
        choiceNode('second', [option('z', '丙', ['E', 'T']), option('w', '丁', ['I', 'F'])]),
        ending('end'),
      ],
      [flow('1', 'in', 's1'), flow('2', 's1', 'first'), flow('3', 'first', 'second', 'x'), flow('4', 'first', 'second', 'y'), flow('5', 'second', 'end', 'z'), flow('6', 'second', 'end', 'w')],
    )
    let run = startRun(program, { mode: 'story' })
    expect(run.personality).toBeUndefined()
    run = advanceRun(program, run)
    expect(stopId(run)).toBe('first')
    run = advanceRun(program, run, 'x')
    expect(run.personality).toEqual({ E: 1, N: 1 })
    expect(stopId(run)).toBe('second')
    run = advanceRun(program, run, 'z')
    expect(run.personality).toEqual({ E: 2, N: 1, T: 1 })
    expect(stopId(run)).toBe('end')
  })

  it('scores nothing for an option without letters and leaves the run without a tally', () => {
    const program = storyProgram()
    const atPick = advanceRun(program, startRun(program, { mode: 'story' }))
    const left = advanceRun(program, atPick, 'c')
    expect(stopId(left)).toBe('badend')
    expect('personality' in left).toBe(false)
  })

  it('does not score a locked option nobody could pick', () => {
    const lock = { mode: 'locked', match: 'all', conditions: [{ variableId: 'coin', op: '>=', value: 5 }], shopItemId: null }
    const program = programOf(
      [entry, choiceNode('pick', [option('a', '甲', ['E'], { unlock: lock }), option('b', '乙')]), ending('end')],
      [flow('1', 'in', 'pick'), flow('2', 'pick', 'end', 'a'), flow('3', 'pick', 'end', 'b')],
    )
    const withCoin: StoryProgram = { ...program, variables: [{ id: 'coin', name: '金币', type: 'number', initial: 0 }] }
    const run = startRun(withCoin, { mode: 'story' })
    const blocked = advanceRun(withCoin, run, 'a')
    expect(blocked).toBe(run)
    expect(blocked.personality).toBeUndefined()
  })

  it('counts the default a countdown lands on, not an exit taken on timeout', () => {
    const timed = (extra: Record<string, unknown>) => programOf(
      [entry, choiceNode('pick', [option('a', '甲', ['E']), option('b', '乙', ['I'])], { timeoutSec: 3, ...extra }), ending('end'), ending('late')],
      [flow('1', 'in', 'pick'), flow('2', 'pick', 'end', 'a'), flow('3', 'pick', 'end', 'b'), flow('4', 'pick', 'late', STORY_TIMEOUT_HANDLE)],
    )
    const byDefault = timed({ defaultOptionId: 'b' })
    const run = startRun(byDefault, { mode: 'story' })
    const pickNode = run.stop.kind === 'choice' ? run.stop.node : null
    expect(pickNode && choiceTimeoutOption(pickNode)).toBe('b')
    expect(advanceRun(byDefault, run, 'b').personality).toEqual({ I: 1 })

    const byExit = timed({ timeoutMode: 'exit' })
    const exitRun = startRun(byExit, { mode: 'story' })
    const left = advanceRun(byExit, exitRun, STORY_TIMEOUT_HANDLE)
    expect(stopId(left)).toBe('late')
    expect('personality' in left).toBe(false)
  })
})

describe('scoring a choice mounted on a segment', () => {
  const build = (extra: Record<string, unknown> = {}) => {
    const nodes: CanvasNodeLike[] = [
      entry,
      scene('m', { videoDurationSec: 10 }),
      beat('mb', {
        interaction: 'choice',
        startSec: 2,
        durationSec: 3,
        options: [
          option('o1', '一', ['E'], extra),
          option('o2', '二', ['I']),
          option('o3', '三', ['N'], { retry: true }),
        ],
      }),
      ending('cutEnd'),
      ending('normalEnd'),
    ]
    const edges: CanvasEdgeLike[] = [
      flow('1', 'in', 'm'),
      mount('2', 'm', 'mb'),
      flow('3', 'mb', 'cutEnd', 'o1'),
      flow('4', 'm', 'normalEnd'),
    ]
    return programOf(nodes, edges)
  }

  it('scores a pick that leaves the picture running, and carries it to the next stop', () => {
    const program = build()
    const run = startRun(program, { mode: 'story' })
    const outcome = resolveBeat(program, run, 'mb', 'o2')
    expect(outcome.kind).toBe('continue')
    expect(outcome.run.personality).toEqual({ I: 1 })
    expect(stopId(advanceRun(program, outcome.run))).toBe('normalEnd')
    expect(advanceRun(program, outcome.run).personality).toEqual({ I: 1 })
  })

  it('scores a pick that cuts at once', () => {
    const program = build()
    const outcome = resolveBeat(program, startRun(program, { mode: 'story' }), 'mb', 'o1')
    expect(outcome.kind).toBe('cut')
    expect(stopId(outcome.run)).toBe('cutEnd')
    expect(outcome.run.personality).toEqual({ E: 1 })
  })

  it('scores a pick that waits for the segment to end, and keeps the score when the cut finally happens', () => {
    const program = build({ when: 'after' })
    const outcome = resolveBeat(program, startRun(program, { mode: 'story' }), 'mb', 'o1')
    expect(outcome.kind).toBe('defer')
    expect(outcome.run.personality).toEqual({ E: 1 })
    const after = advanceRun(program, outcome.run)
    expect(stopId(after)).toBe('cutEnd')
    expect(after.personality).toEqual({ E: 1 })
  })

  it('does not score a pick that sends the viewer back to retry', () => {
    const program = build()
    const outcome = resolveBeat(program, startRun(program, { mode: 'story' }), 'mb', 'o3')
    expect(outcome.kind).toBe('retry')
    expect(outcome.run.personality).toBeUndefined()
  })
})
