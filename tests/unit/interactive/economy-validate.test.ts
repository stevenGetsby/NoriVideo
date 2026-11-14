import { describe, expect, it } from 'vitest'
import { countIssues, validateChapter, validateStory } from '@/lib/interactive/validate'
import type { StoryIssue, StoryShop, StoryVariable } from '@/lib/interactive/types'
import { beat, braveUnlock, ending, entry, flow, keyUnlock, mount, programOf, scene, shop, variables, vaultStory } from './economy-fixture'

const codes = (issues: { code: string }[]) => issues.map((item) => item.code)
const find = (issues: StoryIssue[], code: string) => issues.find((item) => item.code === code)
const UNLOCK_CODES = ['choice_all_locked', 'unlock_shop_missing', 'unlock_shop_no_effect']
const SHOP_CODES = ['shop_currency_invalid', 'shop_empty', 'shop_no_currency', 'shop_item_name', 'shop_item_no_effect']

const door = (options: unknown[]) => ({ options })
const push = { id: 'o_push', label: '硬闯' }
const locked = (id: string, label: string, unlock: unknown) => ({ id, label, unlock })

describe('the vault story', () => {
  it('has no errors and none of the economy warnings', () => {
    const issues = validateStory(vaultStory())
    expect(countIssues(issues).errors).toBe(0)
    expect(codes(issues).filter((code) => [...UNLOCK_CODES, ...SHOP_CODES, 'unknown_variable', 'variable_over_max'].includes(code))).toEqual([])
  })

  it('passes the shop through a chapter-level check without reporting shop-level problems', () => {
    const chapter = vaultStory().chapters[0]!
    const broken: StoryShop = { enabled: true, currencyVariableId: 'ghost', items: [] }
    expect(codes(validateChapter(chapter, variables, shop)).filter((code) => UNLOCK_CODES.includes(code))).toEqual([])
    expect(codes(validateChapter(chapter, variables, broken)).filter((code) => SHOP_CODES.includes(code))).toEqual([])
    expect(codes(validateChapter(chapter, variables, broken))).toContain('unlock_shop_missing')
  })
})

describe('option unlock checks', () => {
  it('errors when every option of a choice is gated, because a viewer could be left with nothing to pick', () => {
    const issues = validateStory(vaultStory({ door: door([locked('o_push', '硬闯', keyUnlock('locked')), locked('o_open', '开门', keyUnlock('hidden', null))]) }))
    const found = find(issues, 'choice_all_locked')
    expect(found).toMatchObject({ level: 'error', nodeId: 'door' })
    expect(found?.message).toContain('大门')
    expect(issues[0]!.level).toBe('error')
  })

  it('accepts a choice with one always-open option next to gated ones', () => {
    const issues = validateStory(vaultStory())
    expect(codes(issues)).not.toContain('choice_all_locked')
  })

  it('does not treat an option list with no options as all-locked', () => {
    const issues = validateStory(vaultStory({ door: door([]) }))
    expect(codes(issues)).toContain('choice_empty')
    expect(codes(issues)).not.toContain('choice_all_locked')
  })

  it('errors on unlock conditions that read a variable which no longer exists', () => {
    const ghost = { mode: 'hidden', match: 'all', conditions: [{ variableId: 'ghost', op: '>=', value: 1 }], shopItemId: null }
    const issues = validateStory(vaultStory({ door: door([push, locked('o_peek', '偷看', ghost)]) }))
    const found = find(issues, 'unknown_variable')
    expect(found).toMatchObject({ level: 'error', nodeId: 'door' })
    expect(found?.message).toContain('偷看')
  })

  it('warns when a locked option points at a shop item that is gone, a shop that is off, or no shop at all', () => {
    const gone = vaultStory({ door: door([push, locked('o_open', '开门', keyUnlock('locked', 'no_such_item'))]) })
    expect(find(validateStory(gone), 'unlock_shop_missing')).toMatchObject({ level: 'warning', nodeId: 'door' })
    const off = vaultStory({ shop: { ...shop, enabled: false } })
    expect(find(validateStory(off), 'unlock_shop_missing')).toMatchObject({ level: 'warning', nodeId: 'door' })
    const none = vaultStory({ shop: undefined })
    expect(find(validateStory(none), 'unlock_shop_missing')).toMatchObject({ level: 'warning', nodeId: 'door' })
    expect(countIssues(validateStory(none)).errors).toBe(0)
  })

  it('warns when the linked item would not change a variable the unlock actually reads', () => {
    const healer = vaultStory({ door: door([push, locked('o_open', '开门', keyUnlock('locked', 'heal'))]) })
    const found = find(validateStory(healer), 'unlock_shop_no_effect')
    expect(found).toMatchObject({ level: 'warning', nodeId: 'door' })
    expect(found?.message).toContain('急救包')
    const tonic = { mode: 'locked', match: 'any', conditions: [{ variableId: 'key', op: '>=', value: 1 }, { variableId: 'brave', op: '>=', value: 1 }], shopItemId: 'tonic' }
    expect(codes(validateStory(vaultStory({ door: door([push, locked('o_open', '开门', tonic)]) })))).not.toContain('unlock_shop_no_effect')
  })

  it('only checks the shop link of options that show as locked, not hidden ones', () => {
    const hiddenWithLink = { ...braveUnlock, shopItemId: 'no_such_item' }
    const issues = validateStory(vaultStory({ door: door([push, locked('o_peek', '偷看', hiddenWithLink)]) }))
    expect(codes(issues)).not.toContain('unlock_shop_missing')
    expect(codes(issues)).not.toContain('unlock_shop_no_effect')
  })

  it('applies the same checks to the options of a mounted choice interaction', () => {
    const build = (options: unknown[], extraShop: StoryShop | undefined = shop) => programOf(
      [
        entry,
        scene('hall', { videoDurationSec: 10 }),
        beat('pick', { interaction: 'choice', startSec: 2, durationSec: 3, options }),
        ending('end'),
        ending('other'),
      ],
      [flow('f1', 'in', 'hall'), flow('f2', 'hall', 'end'), mount('m1', 'hall', 'pick'), flow('f3', 'pick', 'other', 'a')],
      { shop: extraShop },
    )
    const allLocked = validateStory(build([locked('a', '甲', keyUnlock('hidden', null)), locked('b', '乙', keyUnlock('locked'))]))
    expect(find(allLocked, 'choice_all_locked')).toMatchObject({ level: 'error', nodeId: 'pick' })
    expect(find(allLocked, 'choice_all_locked')?.message).toContain('互动')

    const missing = validateStory(build([{ id: 'a', label: '甲' }, locked('b', '乙', keyUnlock('locked', 'no_such_item'))]))
    expect(find(missing, 'unlock_shop_missing')).toMatchObject({ level: 'warning', nodeId: 'pick' })

    const unknown = validateStory(build([{ id: 'a', label: '甲' }, locked('b', '乙', { mode: 'hidden', match: 'all', conditions: [{ variableId: 'ghost', op: '>=', value: 1 }], shopItemId: null })]))
    expect(find(unknown, 'unknown_variable')).toMatchObject({ level: 'error', nodeId: 'pick' })

    const fine = validateStory(build([{ id: 'a', label: '甲' }, locked('b', '乙', keyUnlock('locked'))]))
    expect(codes(fine).filter((code) => [...UNLOCK_CODES, 'unknown_variable'].includes(code))).toEqual([])
  })
})

describe('number cap checks', () => {
  const withVariables = (list: StoryVariable[]) => ({ ...vaultStory(), variables: list })

  it('warns when a number starts above its own cap', () => {
    const issues = validateStory(withVariables([{ id: 'coin', name: '金币', type: 'number', initial: 20, max: 10 }, ...variables.slice(1)]))
    const found = find(issues, 'variable_over_max')
    expect(found).toMatchObject({ level: 'warning', projectId: null, nodeId: null })
    expect(found?.message).toContain('金币')
  })

  it('stays quiet at the cap, below it, without one, and for switches', () => {
    expect(codes(validateStory(withVariables([{ id: 'coin', name: '金币', type: 'number', initial: 10, max: 10 }, ...variables.slice(1)])))).not.toContain('variable_over_max')
    expect(codes(validateStory(withVariables(variables)))).not.toContain('variable_over_max')
    expect(codes(validateStory(withVariables([{ id: 'coin', name: '金币', type: 'number', initial: 99 }, ...variables.slice(1)])))).not.toContain('variable_over_max')
  })
})

describe('shop checks', () => {
  const issuesOfShop = (next: StoryShop) => validateStory(vaultStory({ shop: next }))
  const item = (extra: Partial<StoryShop['items'][number]> = {}): StoryShop['items'][number] =>
    ({ id: 'i', name: '补品', icon: null, description: '', price: 1, limit: 0, effects: [{ variableId: 'brave', op: 'add', value: 1 }], ...extra })

  it('says nothing about a shop that is switched off, however broken', () => {
    const issues = issuesOfShop({ enabled: false, currencyVariableId: 'ghost', items: [item({ name: ' ', effects: [{ variableId: 'ghost', op: 'add', value: 1 }] })] })
    expect(codes(issues).filter((code) => [...SHOP_CODES, 'effect_add_boolean'].includes(code))).toEqual([])
    expect(issues.filter((entry) => entry.message.startsWith('商品「') || entry.message.startsWith('商城'))).toEqual([])
  })

  it('errors when the payment variable is gone or is not a number', () => {
    const gone = issuesOfShop({ ...shop, currencyVariableId: 'ghost' })
    expect(find(gone, 'shop_currency_invalid')).toMatchObject({ level: 'error', projectId: null, nodeId: null })
    const boolean = issuesOfShop({ ...shop, currencyVariableId: 'seen' })
    expect(find(boolean, 'shop_currency_invalid')).toMatchObject({ level: 'error' })
    expect(codes(issuesOfShop(shop))).not.toContain('shop_currency_invalid')
  })

  it('warns about an enabled shop with nothing on its shelves', () => {
    expect(find(issuesOfShop({ ...shop, items: [] }), 'shop_empty')).toMatchObject({ level: 'warning' })
    expect(codes(issuesOfShop(shop))).not.toContain('shop_empty')
  })

  it('warns that priced items are only simulated when no payment variable is chosen', () => {
    const priced = issuesOfShop({ ...shop, currencyVariableId: null })
    expect(find(priced, 'shop_no_currency')).toMatchObject({ level: 'warning' })
    expect(countIssues(priced).errors).toBe(0)
    const free = issuesOfShop({ enabled: true, currencyVariableId: null, items: [item({ price: 0 })] })
    expect(codes(free)).not.toContain('shop_no_currency')
    expect(codes(issuesOfShop(shop))).not.toContain('shop_no_currency')
  })

  it('warns about items with no name or no effect', () => {
    const issues = issuesOfShop({ ...shop, items: [item({ id: 'a', name: '   ' }), item({ id: 'b', name: '空壳', effects: [] })] })
    expect(find(issues, 'shop_item_name')).toMatchObject({ level: 'warning' })
    const noEffect = find(issues, 'shop_item_no_effect')
    expect(noEffect).toMatchObject({ level: 'warning' })
    expect(noEffect?.message).toContain('空壳')
    expect(issues.filter((entry) => entry.code === 'shop_item_no_effect')).toHaveLength(1)
  })

  it('errors when an item changes a variable that is gone, or adds to a switch', () => {
    const issues = issuesOfShop({
      ...shop,
      items: [
        item({ id: 'a', name: '幽灵货', effects: [{ variableId: 'ghost', op: 'add', value: 1 }] }),
        item({ id: 'b', name: '加开关', effects: [{ variableId: 'seen', op: 'add', value: 1 }] }),
        item({ id: 'c', name: '设开关', effects: [{ variableId: 'seen', op: 'set', value: true }] }),
      ],
    })
    expect(find(issues, 'unknown_variable')).toMatchObject({ level: 'error' })
    expect(find(issues, 'unknown_variable')?.message).toContain('幽灵货')
    expect(find(issues, 'effect_add_boolean')?.message).toContain('加开关')
    expect(issues.filter((entry) => entry.code === 'effect_add_boolean')).toHaveLength(1)
  })

  it('lists errors before warnings', () => {
    const issues = issuesOfShop({ enabled: true, currencyVariableId: 'ghost', items: [] })
    expect(issues.map((entry) => entry.level)).toEqual([...issues.map((entry) => entry.level)].sort((a, b) => (a === b ? 0 : a === 'error' ? -1 : 1)))
    expect(codes(issues)).toEqual(expect.arrayContaining(['shop_currency_invalid', 'shop_empty']))
  })
})
