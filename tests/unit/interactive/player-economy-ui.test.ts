import * as React from 'react'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { ChoicePanel } from '@/features/interactive/ChoicePanel'
import { PlayerHud } from '@/features/interactive/PlayerHud'
import { ShopSheet } from '@/features/interactive/ShopSheet'
import { lockedOptionPress } from '@/features/interactive/player/locked-choice'
import { isPlayerClockPaused, pausePlayerClock, playerNow, resumePlayerClock } from '@/features/interactive/player/player-clock'
import { initialVariables, purchaseShopItem, startRun } from '@/lib/interactive/engine'
import type { StoryChoiceOption, StoryOptionUnlock, StoryProgram, StoryVariable } from '@/lib/interactive/types'
import { keyUnlock, shop, variables, vaultStory } from './economy-fixture'

// The repo compiles TSX with the classic JSX runtime in Vitest; shared components
// rely on React being visible as a global, exactly like the other canvas UI tests.
beforeAll(() => vi.stubGlobal('React', React))
afterAll(() => vi.unstubAllGlobals())

const option = (id: string, label: string, locked = false) => ({ id, label, imageUrl: null, locked })

const renderChoice = (props: Record<string, unknown> = {}) => renderToStaticMarkup(createElement(ChoicePanel, {
  prompt: '怎么办？',
  options: [option('a', '硬闯'), option('b', '开门', true)],
  panelStyle: 'text',
  layout: 'auto',
  orientation: 'portrait',
  onChoose: () => {},
  onLockedPress: () => {},
  ...props,
} as never))

const buttonTag = (html: string, optionId: string) => html.match(new RegExp(`<button[^>]*data-option-id="${optionId}"[^>]*>`))?.[0] ?? ''

const withHud = (patch: Record<string, Partial<StoryVariable>>, extra: { shop?: StoryProgram['shop'] } = {}) => {
  const program = vaultStory(extra)
  return { ...program, variables: program.variables.map((variable) => (patch[variable.id] ? { ...variable, ...patch[variable.id] } : variable)) }
}

const renderHud = (program: StoryProgram, preset?: Record<string, number | boolean>) => renderToStaticMarkup(createElement(PlayerHud, {
  program,
  run: startRun(program, { mode: 'story', ...(preset ? { preset } : {}) }),
  orientation: 'portrait',
  onOpenShop: () => {},
} as never))

const sheetRun = (program: StoryProgram, preset?: Record<string, number | boolean>) => startRun(program, { mode: 'story', ...(preset ? { preset } : {}) })

const renderShop = (program: StoryProgram, run: ReturnType<typeof sheetRun>, props: Record<string, unknown> = {}) => renderToStaticMarkup(createElement(ShopSheet, {
  program,
  run,
  orientation: 'portrait',
  onPurchase: () => {},
  onClose: () => {},
  ...props,
} as never))

describe('locked choice cards', () => {
  it('marks a locked card without the native disabled attribute so it still receives the tap', () => {
    const html = renderChoice()
    const locked = buttonTag(html, 'b')
    expect(locked).toContain('is-locked')
    expect(locked).toContain('data-locked="true"')
    expect(locked).toContain('aria-disabled="true"')
    expect(locked).not.toContain('disabled=""')
    expect(html).toContain('nori-choice-option-lock')
    const open = buttonTag(html, 'a')
    expect(open).not.toContain('data-locked')
    expect(open).not.toContain('disabled=""')
  })

  it('keeps the editor preview non-interactive', () => {
    const html = renderChoice({ preview: true, onChoose: undefined, onLockedPress: undefined })
    expect(html).toContain('is-preview')
    expect(buttonTag(html, 'a')).toContain('disabled')
  })

  it('never advances a locked card, sending the viewer to its shop item or to the unlock hint', () => {
    const door: StoryChoiceOption[] = [
      { id: 'push', label: '硬闯', effects: [], imageUrl: null, when: 'now', retry: false },
      { id: 'open', label: '开门', effects: [], imageUrl: null, when: 'now', retry: false, unlock: keyUnlock('locked') as StoryOptionUnlock },
      { id: 'wait', label: '等待', effects: [], imageUrl: null, when: 'now', retry: false, unlock: { ...keyUnlock('locked'), shopItemId: null } as StoryOptionUnlock },
    ]
    const vars = initialVariables(variables)
    expect(lockedOptionPress(door, 'push', vars, variables)).toEqual({ kind: 'none' })
    expect(lockedOptionPress(door, 'open', vars, variables)).toEqual({ kind: 'shop', itemId: 'key_item' })
    expect(lockedOptionPress(door, 'wait', vars, variables)).toEqual({ kind: 'hint' })
    expect(lockedOptionPress(door, 'open', initialVariables(variables, { key: 1 }), variables)).toEqual({ kind: 'none' })
    expect(lockedOptionPress(door, 'missing', vars, variables)).toEqual({ kind: 'none' })
  })
})

describe('value HUD', () => {
  it('shows one chip per 显示在右上角 value with icon, value, cap and tooltip name', () => {
    const html = renderHud(vaultStory(), { coin: 3 })
    expect(html).toContain('data-testid="player-hud"')
    expect(html).toContain('data-testid="hud-variable-coin"')
    expect(html).toContain('🪙')
    expect(html).toContain('title="金币"')
    expect(html).toContain('/10')
    expect(html).toContain('nori-hud-value">3<')
    expect(html).toContain('data-hud-variable="coin"')
  })

  it('shows the name as visible text when a value has no icon', () => {
    const program = withHud({ coin: { showInHud: false }, hp: { showInHud: true } })
    const html = renderHud(program)
    expect(html).toContain('data-testid="hud-variable-hp"')
    expect(html).toContain('nori-hud-name">生命<')
    expect(html).not.toContain('hud-variable-coin')
    expect(html).not.toContain('/10')
  })

  it('dims a switch that is off and never renders a boolean cap', () => {
    const program = withHud({ seen: { showInHud: true, max: 5 } })
    const html = renderHud(program, { seen: false })
    expect(html).toContain('data-testid="hud-variable-seen"')
    expect(html).toContain('is-off')
    expect(html).toContain('data-off="true"')
    expect(html).toContain('nori-hud-value">否<')
    expect(html).not.toContain('/5')
  })

  it('offers the shop button only when the shop is enabled, and stays out of old works', () => {
    expect(renderHud(vaultStory())).toContain('data-testid="hud-shop"')
    expect(renderHud(vaultStory({ shop: { ...shop, enabled: false } }))).not.toContain('data-testid="hud-shop"')
    expect(renderHud(vaultStory({ shop: undefined }))).toContain('data-testid="player-hud"')
    const bare = withHud({ coin: { showInHud: false } }, { shop: undefined })
    expect(renderHud(bare)).toBe('')
  })
})

describe('shop sheet', () => {
  it('lists items with prices, currency and a focus sent by a locked card', () => {
    const program = vaultStory()
    const html = renderShop(program, sheetRun(program, { coin: 8 }), { focusItemId: 'key_item' })
    expect(html).toContain('data-testid="shop-item-key_item"')
    expect(html).toContain('data-focused="true"')
    expect(html).toContain('🔑')
    expect(html).toContain('能打开金库门')
    expect(html).toContain('售价 5')
    expect(html).toContain('金币')
    expect(html).toContain('data-testid="shop-balance"')
    const buy = html.match(/<button[^>]*data-testid="shop-buy-key_item"[^>]*>/)?.[0] ?? ''
    expect(buy).not.toContain('disabled')
    expect(html).toContain('>购买<')
  })

  it('disables the buy button with 余额不足 when the currency is short', () => {
    const program = vaultStory()
    const html = renderShop(program, sheetRun(program, { coin: 3 }))
    const buy = html.match(/<button[^>]*data-testid="shop-buy-key_item"[^>]*>/)?.[0] ?? ''
    expect(buy).toContain('disabled')
    expect(buy).toContain('余额不足')
  })

  it('shows what the viewer already owns and marks a limited item sold out', () => {
    const program = vaultStory()
    const bought = purchaseShopItem(program, sheetRun(program, { coin: 9 }), 'key_item')
    if (!bought.ok) throw new Error('expected the purchase to go through')
    const html = renderShop(program, bought.run)
    expect(html).toContain('已拥有 ×1')
    expect(html).toContain('已售罄')
    const buy = html.match(/<button[^>]*data-testid="shop-buy-key_item"[^>]*>/)?.[0] ?? ''
    expect(buy).toContain('disabled')
  })

  it('explains that buying is a free simulation when no currency is set', () => {
    const program = vaultStory({ shop: { ...shop, currencyVariableId: null } })
    const html = renderShop(program, sheetRun(program))
    expect(html).toContain('未设置付款数值：购买只是模拟，不扣除数值')
    expect(html).not.toContain('data-testid="shop-balance"')
    const buy = html.match(/<button[^>]*data-testid="shop-buy-key_item"[^>]*>/)?.[0] ?? ''
    expect(buy).not.toContain('disabled')
  })

  it('shows the failure message inline and an empty state for an empty shop', () => {
    const program = vaultStory({ shop: { ...shop, items: [] } })
    const html = renderShop(program, sheetRun(program), { error: '余额不足，买不起这件商品' })
    expect(html).toContain('data-testid="shop-error"')
    expect(html).toContain('余额不足，买不起这件商品')
    expect(html).toContain('商城还没有商品')
  })
})

describe('player clock pause', () => {
  it('freezes every timer while the shop is open and resumes from the same instant', async () => {
    const start = playerNow()
    pausePlayerClock()
    try {
      expect(isPlayerClockPaused()).toBe(true)
      const frozen = playerNow()
      await new Promise((resolve) => setTimeout(resolve, 30))
      expect(playerNow()).toBe(frozen)
      expect(frozen - start).toBeLessThan(200)
    } finally {
      resumePlayerClock()
    }
    expect(isPlayerClockPaused()).toBe(false)
    const resumed = playerNow()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(playerNow()).toBeGreaterThan(resumed)
  })

  it('only resumes once the last nested pause ends', async () => {
    pausePlayerClock()
    pausePlayerClock()
    try {
      const frozen = playerNow()
      await new Promise((resolve) => setTimeout(resolve, 15))
      resumePlayerClock()
      expect(isPlayerClockPaused()).toBe(true)
      expect(playerNow()).toBe(frozen)
    } finally {
      resumePlayerClock()
    }
    expect(isPlayerClockPaused()).toBe(false)
  })
})
