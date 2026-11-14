import { describe, expect, it } from 'vitest'
import {
  advanceRun,
  applyEffects,
  beatTimeoutHandle,
  choiceTimeoutOption,
  initialVariables,
  isOptionOpen,
  optionState,
  permanentValues,
  purchaseShopItem,
  resolveBeat,
  shopItemViews,
  startRun,
  unlockMet,
  variableMax,
  visibleOptions,
} from '@/lib/interactive/engine'
import { readChoiceOptions, readOptionUnlock } from '@/lib/interactive/interaction'
import type { StoryChoiceOption, StoryOptionUnlock } from '@/lib/interactive/types'
import {
  beat, ending, entry, flow, keyUnlock, mount, programOf, scene, shop, variables, vaultStory,
} from './economy-fixture'

const unlock = (patch: Partial<StoryOptionUnlock> = {}): StoryOptionUnlock => ({
  mode: 'locked',
  match: 'all',
  conditions: [{ variableId: 'key', op: '>=', value: 1 }],
  shopItemId: null,
  ...patch,
})
const option = (id: string, withUnlock?: StoryOptionUnlock): StoryChoiceOption =>
  ({ id, label: id, effects: [], imageUrl: null, when: 'now', retry: false, ...(withUnlock ? { unlock: withUnlock } : {}) })

describe('value caps', () => {
  it('only a number value has an upper bound', () => {
    expect(variableMax(variables[0])).toBe(10)
    expect(variableMax(variables[1])).toBeNull()
    expect(variableMax({ id: 'flag', name: '开关', type: 'boolean', initial: false, max: 3 })).toBeNull()
  })

  it('pulls the starting value and trial presets down to the cap', () => {
    expect(initialVariables(variables).coin).toBe(3)
    expect(initialVariables(variables, { coin: 99 }).coin).toBe(10)
    expect(initialVariables(variables, { coin: -4 }).coin).toBe(-4)
  })

  it('stops effects from pushing a value past its cap, in both directions of use', () => {
    const start = initialVariables(variables)
    expect(applyEffects(start, [{ variableId: 'coin', op: 'add', value: 100 }], variables).coin).toBe(10)
    expect(applyEffects(start, [{ variableId: 'coin', op: 'set', value: 50 }], variables).coin).toBe(10)
    expect(applyEffects(start, [{ variableId: 'coin', op: 'add', value: -5 }], variables).coin).toBe(-2)
    expect(applyEffects(start, [{ variableId: 'key', op: 'add', value: 100 }], variables).key).toBe(100)
  })

  it('does not compare against the cap: a condition on a larger number simply fails', () => {
    const capped = unlock({ conditions: [{ variableId: 'coin', op: '>=', value: 50 }] })
    expect(unlockMet(capped, initialVariables(variables, { coin: 10 }), variables)).toBe(false)
  })
})

describe('permanent values', () => {
  it('keeps only the permanent variables between plays, with their start value as fallback', () => {
    expect(permanentValues(variables, { coin: 9, brave: 4, key: 2 })).toEqual({ brave: 4, seen: false, stars: 0 })
  })

  it('carries only permanent values into a new run and ignores everything else', () => {
    const program = vaultStory()
    const run = startRun(program, { mode: 'story', permanent: { brave: 2, seen: true, coin: 9, key: 5 } })
    expect(run.vars).toMatchObject({ brave: 2, seen: true, coin: 3, key: 0 })
  })

  it('lets a carried value beat the trial preset and still respects the cap', () => {
    const program = vaultStory()
    const run = startRun(program, { mode: 'story', preset: { brave: 1, stars: 1 }, permanent: { brave: 2, stars: 99 } })
    expect(run.vars).toMatchObject({ brave: 2, stars: 3 })
  })

  it('starts fresh when nothing was saved', () => {
    const run = startRun(vaultStory(), { mode: 'story' })
    expect(run.vars).toMatchObject({ brave: 0, seen: false, stars: 0 })
  })
})

describe('option unlock rules', () => {
  it('reads an unlock only when it has at least one condition', () => {
    expect(readOptionUnlock(undefined)).toBeNull()
    expect(readOptionUnlock({ mode: 'locked', conditions: [] })).toBeNull()
    expect(readOptionUnlock({ mode: 'locked', conditions: [{ op: '>=', value: 1 }] })).toBeNull()
    expect(readOptionUnlock({ mode: 'locked', conditions: [{ variableId: 'k', op: '??', value: 1 }] })?.conditions).toEqual([{ variableId: 'k', op: '==', value: 1 }])
    expect(readOptionUnlock({ conditions: [{ variableId: 'key', op: '>=', value: 1 }] })).toEqual({
      mode: 'hidden',
      match: 'all',
      conditions: [{ variableId: 'key', op: '>=', value: 1 }],
      shopItemId: null,
    })
    expect(readOptionUnlock({ mode: 'locked', match: 'any', shopItemId: 'key_item', conditions: [{ variableId: 'key', op: '>=', value: 1 }] })).toMatchObject({
      mode: 'locked',
      match: 'any',
      shopItemId: 'key_item',
    })
  })

  it('leaves old options exactly as they were when no unlock is set', () => {
    const [plain, locked] = readChoiceOptions([
      { id: 'a', label: '旧选项', effects: [], imageUrl: null, when: 'now', retry: false },
      { id: 'b', label: '新选项', unlock: keyUnlock('locked') },
    ])
    expect(plain).toStrictEqual({ id: 'a', label: '旧选项', effects: [], imageUrl: null, when: 'now', retry: false })
    expect(locked.unlock).toMatchObject({ mode: 'locked', shopItemId: 'key_item' })
  })

  it('decides open, locked or hidden by the unlock mode', () => {
    const none = initialVariables(variables)
    const withKey = initialVariables(variables, { key: 1 })
    expect(optionState(option('a'), none, variables)).toBe('open')
    expect(optionState(option('a', unlock({ mode: 'locked' })), none, variables)).toBe('locked')
    expect(optionState(option('a', unlock({ mode: 'hidden' })), none, variables)).toBe('hidden')
    expect(optionState(option('a', unlock({ mode: 'locked' })), withKey, variables)).toBe('open')
    expect(optionState(option('a', unlock({ mode: 'hidden' })), withKey, variables)).toBe('open')
  })

  it('opens on all or any of the conditions', () => {
    const conditions = [{ variableId: 'key', op: '>=' as const, value: 1 }, { variableId: 'brave', op: '>=' as const, value: 2 }]
    const onlyKey = initialVariables(variables, { key: 1 })
    expect(unlockMet(unlock({ match: 'all', conditions }), onlyKey, variables)).toBe(false)
    expect(unlockMet(unlock({ match: 'any', conditions }), onlyKey, variables)).toBe(true)
    expect(unlockMet(unlock({ match: 'all', conditions }), initialVariables(variables, { key: 1, brave: 2 }), variables)).toBe(true)
  })

  it('leaves hidden options out, keeps locked ones as cards that link to their shop item', () => {
    const options = [option('a'), option('b', unlock({ mode: 'locked', shopItemId: 'key_item' })), option('c', unlock({ mode: 'hidden' }))]
    const views = visibleOptions(options, initialVariables(variables), variables)
    expect(views.map((view) => [view.option.id, view.locked, view.shopItemId])).toEqual([['a', false, null], ['b', true, 'key_item']])
    const opened = visibleOptions(options, initialVariables(variables, { key: 1 }), variables)
    expect(opened.map((view) => [view.option.id, view.locked, view.shopItemId])).toEqual([['a', false, null], ['b', false, null], ['c', false, null]])
  })

  it('never traps the viewer: when every option is closed the first one opens', () => {
    const options = [option('a', unlock({ mode: 'hidden' })), option('b', unlock({ mode: 'locked', shopItemId: 'key_item' }))]
    const views = visibleOptions(options, initialVariables(variables), variables)
    expect(views.map((view) => [view.option.id, view.locked])).toEqual([['a', false], ['b', true]])
    expect(isOptionOpen(options, 'a', initialVariables(variables), variables)).toBe(true)
    expect(isOptionOpen(options, 'b', initialVariables(variables), variables)).toBe(false)
    expect(visibleOptions([], initialVariables(variables), variables)).toEqual([])
  })
})

describe('locked options in a story', () => {
  it('refuses a locked or hidden option and accepts it once the condition holds', () => {
    const program = vaultStory()
    const choice = advanceRun(program, startRun(program, { mode: 'story' }))
    expect(choice.stop.kind).toBe('choice')
    expect(advanceRun(program, choice, 'o_open')).toBe(choice)
    expect(advanceRun(program, choice, 'o_peek')).toBe(choice)
    const wired = advanceRun(program, advanceRun(program, startRun(program, { mode: 'story', preset: { key: 1 } })), 'o_open')
    expect(wired.stop.kind).toBe('scene')
    expect(wired.stop.kind === 'scene' && wired.stop.node.id).toBe('vault')
  })

  it('takes the timed-out default only when it can be picked, else the first open option', () => {
    const program = vaultStory({ door: { timeoutSec: 5, defaultOptionId: 'o_open' } })
    const choice = advanceRun(program, startRun(program, { mode: 'story' }))
    if (choice.stop.kind !== 'choice') throw new Error('expected the door choice')
    const { node } = choice.stop
    expect(choiceTimeoutOption(node)).toBe('o_open')
    expect(choiceTimeoutOption(node, choice.vars, program.variables)).toBe('o_push')
    const withKey = initialVariables(variables, { key: 1 })
    expect(choiceTimeoutOption(node, withKey, program.variables)).toBe('o_open')
    expect(choiceTimeoutOption({ ...node, timeoutMode: 'exit' }, choice.vars, program.variables)).toBe('timeout')
  })

  it('applies the same rules to a mounted choice interaction', () => {
    const nodes = [
      entry,
      scene('lift', { videoDurationSec: 20 }),
      beat('pick', {
        interaction: 'choice',
        startSec: 5,
        durationSec: 3,
        defaultOptionId: 'b',
        options: [
          { id: 'a', label: '救人' },
          { id: 'b', label: '破门', unlock: keyUnlock('locked'), effects: [{ variableId: 'brave', op: 'add', value: 1 }] },
        ],
      }),
      ending('saved'),
      ending('broke', 'hidden'),
    ]
    const edges = [flow('f1', 'in', 'lift'), mount('m1', 'lift', 'pick'), flow('f2', 'pick', 'saved', 'a'), flow('f3', 'pick', 'broke', 'b')]
    const program = programOf(nodes, edges)
    const run = startRun(program, { mode: 'story' })
    const beatNode = run.stop.kind === 'scene' ? run.stop.node.beats[0] : null
    if (!beatNode) throw new Error('expected a mounted beat')

    const refused = resolveBeat(program, run, 'pick', 'b')
    expect(refused.kind).toBe('continue')
    expect(refused.run).toBe(run)
    expect(refused.run.vars.brave).toBe(0)
    expect(beatTimeoutHandle(beatNode.spec, run.vars, program.variables)).toBe('a')

    const keyed = startRun(program, { mode: 'story', preset: { key: 1 } })
    expect(beatTimeoutHandle(beatNode.spec, keyed.vars, program.variables)).toBe('b')
    const cut = resolveBeat(program, keyed, 'pick', 'b')
    expect(cut.kind).toBe('cut')
    expect(cut.run.vars.brave).toBe(1)
    expect(cut.run.stop.kind === 'ending' && cut.run.stop.node.title).toBe('broke')
  })

  it('applies the same rules to a standalone choice interaction in the flow', () => {
    const nodes = [
      entry,
      beat('pick', {
        interaction: 'choice',
        durationSec: 5,
        options: [{ id: 'a', label: '稳妥' }, { id: 'b', label: '冒险', unlock: keyUnlock('hidden') }],
      }),
      ending('safe'),
      ending('risk', 'hidden'),
    ]
    const edges = [flow('f1', 'in', 'pick'), flow('f2', 'pick', 'safe', 'a'), flow('f3', 'pick', 'risk', 'b')]
    const program = programOf(nodes, edges)
    const run = startRun(program, { mode: 'story' })
    expect(run.stop.kind).toBe('interaction')
    expect(advanceRun(program, run, 'b')).toBe(run)
    expect(advanceRun(program, startRun(program, { mode: 'story', preset: { key: 2 } }), 'b').stop.kind).toBe('ending')
  })
})

describe('shop', () => {
  it('shows nothing until the shop is switched on', () => {
    const run = startRun(vaultStory(), { mode: 'story' })
    expect(shopItemViews(vaultStory({ shop: undefined }), run)).toEqual([])
    expect(shopItemViews(vaultStory({ shop: { ...shop, enabled: false } }), run)).toEqual([])
    expect(purchaseShopItem(vaultStory({ shop: { ...shop, enabled: false } }), run, 'key_item')).toMatchObject({ ok: false, reason: 'no_shop' })
  })

  it('marks what the viewer owns, what is sold out and what they can pay for', () => {
    const program = vaultStory()
    const rich = startRun(program, { mode: 'story', preset: { coin: 6 } })
    expect(shopItemViews(program, rich).map((view) => [view.item.id, view.owned, view.soldOut, view.affordable])).toEqual([
      ['key_item', 0, false, true],
      ['tonic', 0, false, true],
      ['heal', 0, false, true],
    ])
    const poor = startRun(program, { mode: 'story', preset: { coin: 4 } })
    expect(shopItemViews(program, poor).find((view) => view.item.id === 'key_item')?.affordable).toBe(false)
  })

  it('pays in the currency value and gives the item values', () => {
    const program = vaultStory()
    const run = startRun(program, { mode: 'story', preset: { coin: 8 } })
    const result = purchaseShopItem(program, run, 'key_item')
    expect(result.ok).toBe(true)
    expect(result.run.vars).toMatchObject({ coin: 3, key: 1 })
    expect(result.run.purchases).toEqual({ key_item: 1 })
    expect(result.run.stop).toBe(run.stop)
    expect(run.vars.coin).toBe(8)
    expect(run.purchases).toBeUndefined()
  })

  it('sells a limited item once and an unlimited one as often as the viewer can pay', () => {
    const program = vaultStory()
    let run = startRun(program, { mode: 'story', preset: { coin: 9 } })
    const first = purchaseShopItem(program, run, 'key_item')
    expect(first.ok).toBe(true)
    run = first.run
    expect(shopItemViews(program, run).find((view) => view.item.id === 'key_item')?.soldOut).toBe(true)
    expect(purchaseShopItem(program, run, 'key_item')).toMatchObject({ ok: false, reason: 'sold_out', run })
    for (let index = 0; index < 4; index += 1) {
      const next = purchaseShopItem(program, run, 'tonic')
      expect(next.ok).toBe(true)
      run = next.run
    }
    expect(run.vars).toMatchObject({ coin: 0, brave: 4 })
    expect(run.purchases).toEqual({ key_item: 1, tonic: 4 })
    expect(purchaseShopItem(program, run, 'tonic')).toMatchObject({ ok: false, reason: 'cannot_afford', run })
  })

  it('refuses unknown items and unaffordable ones without changing the run', () => {
    const program = vaultStory()
    const run = startRun(program, { mode: 'story' })
    expect(purchaseShopItem(program, run, 'ghost')).toMatchObject({ ok: false, reason: 'unknown_item', run })
    const refused = purchaseShopItem(program, run, 'key_item')
    expect(refused).toMatchObject({ ok: false, reason: 'cannot_afford' })
    expect(refused.run).toBe(run)
  })

  it('is a free simulation when no currency value is chosen, but still gives the item values', () => {
    const program = vaultStory({ shop: { ...shop, currencyVariableId: null } })
    const run = startRun(program, { mode: 'story', preset: { coin: 0 } })
    expect(shopItemViews(program, run).every((view) => view.affordable)).toBe(true)
    const result = purchaseShopItem(program, run, 'key_item')
    expect(result.ok).toBe(true)
    expect(result.run.vars).toMatchObject({ coin: 0, key: 1 })
  })

  it('falls back to a free simulation when the currency value no longer exists or is not a number', () => {
    const run = startRun(vaultStory(), { mode: 'story', preset: { coin: 0 } })
    expect(purchaseShopItem(vaultStory({ shop: { ...shop, currencyVariableId: 'ghost' } }), run, 'key_item')).toMatchObject({ ok: true })
    expect(purchaseShopItem(vaultStory({ shop: { ...shop, currencyVariableId: 'seen' } }), run, 'key_item')).toMatchObject({ ok: true })
  })

  it('does not pay for a free item and never pushes a gained value past its cap', () => {
    const free = { ...shop, items: [{ ...shop.items[2], price: 0 }] }
    const program = vaultStory({ shop: free })
    const run = startRun(program, { mode: 'story', preset: { coin: 2 } })
    const result = purchaseShopItem(program, run, 'heal')
    expect(result.run.vars).toMatchObject({ coin: 2, hp: 5 })
  })

  it('keeps the purchase record while the story moves on, and a hidden ending can be reached', () => {
    const program = vaultStory()
    let run = advanceRun(program, startRun(program, { mode: 'story', preset: { coin: 8 } }))
    expect(run.stop.kind).toBe('choice')

    const locked = visibleOptions(run.stop.kind === 'choice' ? run.stop.node.options : [], run.vars, program.variables)
    expect(locked.map((view) => [view.option.id, view.locked, view.shopItemId])).toEqual([['o_push', false, null], ['o_open', true, 'key_item']])
    expect(advanceRun(program, run, 'o_open')).toBe(run)

    const bought = purchaseShopItem(program, run, 'key_item')
    expect(bought.ok).toBe(true)
    run = bought.run
    expect(run.stop.kind).toBe('choice')
    expect(advanceRun(program, run, 'o_open')).not.toBe(run)

    run = advanceRun(program, run, 'o_open')
    expect(run.stop.kind === 'scene' && run.stop.node.id).toBe('vault')
    expect(run.purchases).toEqual({ key_item: 1 })
    run = advanceRun(program, run)
    expect(run.stop.kind === 'ending' && run.stop.node.endingType).toBe('hidden')
    expect(run.purchases).toEqual({ key_item: 1 })
    expect(run.vars).toMatchObject({ coin: 3, key: 1 })
  })

  it('keeps purchases across a mounted result, whether it cuts at once or waits for the segment to end', () => {
    const nodes = [
      entry,
      scene('lift', { videoDurationSec: 30 }),
      beat('tap', { interaction: 'tap', startSec: 20, durationSec: 3, count: 5, results: { success: { when: 'after' }, fail: { when: 'now' } } }),
      scene('after'),
      ending('done'),
      ending('late', 'bad'),
    ]
    const edges = [flow('f1', 'in', 'lift'), mount('m1', 'lift', 'tap'), flow('f2', 'tap', 'after', 'success'), flow('f3', 'tap', 'late', 'fail'), flow('f4', 'after', 'done')]
    const program = programOf(nodes, edges)
    const run = purchaseShopItem(program, startRun(program, { mode: 'story', preset: { coin: 8 } }), 'key_item').run

    const cut = resolveBeat(program, run, 'tap', 'fail')
    expect(cut.kind).toBe('cut')
    expect(cut.run.purchases).toEqual({ key_item: 1 })

    const deferred = resolveBeat(program, run, 'tap', 'success')
    expect(deferred.kind).toBe('defer')
    expect(deferred.run.purchases).toEqual({ key_item: 1 })
    const landed = advanceRun(program, deferred.run)
    expect(landed.stop.kind === 'scene' && landed.stop.node.id).toBe('after')
    expect(landed.purchases).toEqual({ key_item: 1 })
  })
})

describe('hidden plot by value', () => {
  it('splits the story on a value with the existing condition node and keeps working with caps', () => {
    const nodes = [
      entry,
      scene('hall'),
      { id: 'split', type: 'story_condition', data: { title: '胆量', branches: [{ id: 'br', label: '勇者', match: 'all', conditions: [{ variableId: 'brave', op: '>=', value: 2 }] }] } },
      ending('hero', 'hidden'),
      ending('common', 'normal'),
    ]
    const edges = [flow('f1', 'in', 'hall'), flow('f2', 'hall', 'split'), flow('f3', 'split', 'hero', 'br'), flow('f4', 'split', 'common', 'else')]
    const program = programOf(nodes, edges)
    const timid = advanceRun(program, startRun(program, { mode: 'story' }))
    expect(timid.stop.kind === 'ending' && timid.stop.node.title).toBe('common')
    const brave = advanceRun(program, startRun(program, { mode: 'story', permanent: { brave: 2 } }))
    expect(brave.stop.kind === 'ending' && brave.stop.node.title).toBe('hero')
  })

  it('keeps a hidden option away from the viewer until the value is reached, then lets them pick it', () => {
    const program = vaultStory()
    const timid = advanceRun(program, startRun(program, { mode: 'story' }))
    const ids = (run: typeof timid) => (run.stop.kind === 'choice'
      ? visibleOptions(run.stop.node.options, run.vars, program.variables).map((view) => view.option.id)
      : [])
    expect(ids(timid)).not.toContain('o_peek')

    const brave = advanceRun(program, startRun(program, { mode: 'story', permanent: { brave: 3 } }))
    expect(ids(brave)).toContain('o_peek')
    const peeked = advanceRun(program, brave, 'o_peek')
    expect(peeked.stop.kind === 'ending' && peeked.stop.node.title).toBe('peeked')
  })
})
