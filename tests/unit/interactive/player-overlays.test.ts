import * as React from 'react'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { ChoicePanel } from '@/features/interactive/ChoicePanel'
import { InteractionOverlay } from '@/features/interactive/player/InteractionOverlay'
import { STORY_INTERACTION_DEFAULT_HINT } from '@/lib/interactive/interaction'
import type { StoryInteractionNode, StoryInteractionSpec } from '@/lib/interactive/types'

// The repo compiles TSX with the classic JSX runtime in Vitest; shared components
// rely on React being visible as a global, exactly like the other canvas UI tests.
beforeAll(() => vi.stubGlobal('React', React))
afterAll(() => vi.unstubAllGlobals())

const options = [
  { id: 'a', label: '冲出去', imageUrl: '/a.png' },
  { id: 'b', label: '躲起来', imageUrl: '/b.png' },
]

const renderPanel = (props: Record<string, unknown> = {}) => renderToStaticMarkup(createElement(ChoicePanel, {
  prompt: '怎么办？',
  options,
  panelStyle: 'both',
  layout: 'auto',
  orientation: 'portrait',
  ...props,
} as never))

const beat = (spec: StoryInteractionSpec, hint = '', durationSec = 3): StoryInteractionNode => ({
  id: 'beat',
  kind: 'interaction',
  title: '互动标题',
  spec,
  hint,
  durationSec,
  during: 'play',
  mountedOn: 'scene',
  startSec: 2,
  results: {},
})

const renderOverlay = (node: StoryInteractionNode, props: Record<string, unknown> = {}) => renderToStaticMarkup(createElement(InteractionOverlay, {
  node,
  orientation: 'portrait',
  startedAt: 0,
  onResult: () => {},
  ...props,
} as never))

describe('ChoicePanel layout contract', () => {
  it('resolves auto layout from the stage orientation: picture top on phones, picture left on wide screens', () => {
    expect(renderPanel({ orientation: 'portrait' })).toContain('data-layout="vertical"')
    expect(renderPanel({ orientation: 'landscape' })).toContain('data-layout="horizontal"')
  })

  it('honours a forced layout in either orientation', () => {
    expect(renderPanel({ layout: 'horizontal', orientation: 'portrait' })).toContain('data-layout="horizontal"')
    expect(renderPanel({ layout: 'vertical', orientation: 'landscape' })).toContain('data-layout="vertical"')
  })

  it('renders image cards only when the style asks for pictures, and keeps the preview non-interactive', () => {
    const both = renderPanel()
    expect(both.match(/<img/g)?.length).toBe(2)
    expect(both).toContain('冲出去')
    const textOnly = renderPanel({ panelStyle: 'text' })
    expect(textOnly).not.toContain('<img')
    expect(textOnly).toContain('冲出去')
    const imageOnly = renderPanel({ panelStyle: 'image' })
    expect(imageOnly).not.toContain('nori-choice-option-text')
    const preview = renderPanel({ preview: true })
    expect(preview).toContain('is-preview')
    expect(preview).toContain('disabled')
  })

  it('falls back to text for an image card whose picture is missing', () => {
    const html = renderPanel({ panelStyle: 'image', options: [{ id: 'a', label: '空选项', imageUrl: null }, { id: 'b', label: '有图', imageUrl: '/b.png' }] })
    expect(html).toContain('空选项')
    expect(html.match(/<img/g)?.length).toBe(1)
  })
})

describe('interaction overlay markup', () => {
  it('shows the fallback hint per interaction kind and a real-time countdown', () => {
    const cases: Array<[StoryInteractionSpec, keyof typeof STORY_INTERACTION_DEFAULT_HINT]> = [
      [{ type: 'tap', count: 10, buttonText: '', buttonImageUrl: null }, 'tap'],
      [{ type: 'swipe', direction: 'up', buttonText: '', buttonImageUrl: null }, 'swipe'],
      [{ type: 'timing', propImageUrl: null, speed: 1, perfectWidth: 10, normalWidth: 30 }, 'timing'],
      [{ type: 'hold', fillSec: 2, rangeMin: 80, rangeMax: 100, overchargeFails: false, buttonText: '', buttonImageUrl: null }, 'hold'],
    ]
    for (const [spec, kind] of cases) {
      const html = renderOverlay(beat(spec))
      expect(html).toContain(`data-kind="${spec.type}"`)
      expect(html).toContain(STORY_INTERACTION_DEFAULT_HINT[kind])
      expect(html).toContain('data-testid="interaction-countdown"')
    }
  })

  it('prefers the creator hint and renders the choice panel with its options', () => {
    const html = renderOverlay(beat({ type: 'tap', count: 10, buttonText: '开门', buttonImageUrl: null }, '快按住电梯门！'))
    expect(html).toContain('快按住电梯门！')
    expect(html).toContain('开门')
    expect(html).toContain('0 / 10')

    const choice = renderOverlay(beat({
      type: 'choice',
      prompt: '丧尸扑来',
      options: options.map((option) => ({ ...option, effects: [], when: 'now' as const, retry: false })),
      panelStyle: 'both',
      layout: 'auto',
      timeoutMode: 'default',
      defaultOptionId: null,
    }))
    expect(choice).toContain('data-kind="choice"')
    expect(choice).toContain('data-testid="choice-panel"')
    expect(choice).toContain('丧尸扑来')
    expect(choice).toContain('躲起来')
    expect(choice).toContain('data-testid="interaction-countdown"')
  })

  it('renders the timing zones at the configured widths and the hold success band', () => {
    const timing = renderOverlay(beat({ type: 'timing', propImageUrl: null, speed: 1, perfectWidth: 10, normalWidth: 30 }))
    expect(timing).toContain('width:30%')
    expect(timing).toContain('width:10%')
    expect(timing).toContain('data-testid="timing-pad"')

    const hold = renderOverlay(beat({ type: 'hold', fillSec: 2, rangeMin: 80, rangeMax: 100, overchargeFails: true, buttonText: '拉弓', buttonImageUrl: null }))
    expect(hold).toContain('bottom:80%')
    expect(hold).toContain('height:20%')
    expect(hold).toContain('拉弓')
  })
})
