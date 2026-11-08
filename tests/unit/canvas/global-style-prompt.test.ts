import { describe, expect, it } from 'vitest'
import {
  CANVAS_GLOBAL_STYLE_PROMPT_MAX_LENGTH,
  GLOBAL_STYLE_PROMPT_CLOSE,
  GLOBAL_STYLE_PROMPT_OPEN,
  composeCanvasGlobalStylePrompt,
  extractCanvasGlobalStylePrompt,
  findCanvasGlobalStylePromptNode,
  normalizeCanvasGlobalStylePrompt,
  readCanvasGlobalStylePrompt,
  stripCanvasGlobalStylePrompt,
} from '@/lib/canvas/global-style-prompt'

const block = (style: string) => `${GLOBAL_STYLE_PROMPT_OPEN}\n${style}\n${GLOBAL_STYLE_PROMPT_CLOSE}`

describe('canvas global style prompt', () => {
  it('appends the style once and keeps the user original text intact', () => {
    const original = '雨夜车站，女孩回头看向镜头'
    const composed = composeCanvasGlobalStylePrompt(original, '水彩绘本风，柔和自然光')
    expect(composed).toBe(`${original}\n\n${block('水彩绘本风，柔和自然光')}`)
    expect(composeCanvasGlobalStylePrompt(composed, '水彩绘本风，柔和自然光')).toBe(composed)
    expect(composeCanvasGlobalStylePrompt(composed, '赛博霓虹风')).toBe(`${original}\n\n${block('赛博霓虹风')}`)
  })

  it('removes every previously injected block without touching ordinary text', () => {
    const original = '保留 [普通方括号] 的用户原文'
    const stacked = `${original}\n\n${block('旧风格')}\n\n中间用户补充\n\n${block('重复风格')}`
    expect(stripCanvasGlobalStylePrompt(stacked)).toBe(`${original}\n\n中间用户补充`)
    expect(extractCanvasGlobalStylePrompt(stacked)).toBe('重复风格')
    expect(extractCanvasGlobalStylePrompt(original)).toBe('')
  })

  it('normalizes stray markers, empty values and overlength input', () => {
    expect(normalizeCanvasGlobalStylePrompt('  [画布全局风格]水彩[/画布全局风格]  ')).toBe('水彩')
    expect(normalizeCanvasGlobalStylePrompt('   ')).toBe('')
    expect(normalizeCanvasGlobalStylePrompt(null)).toBe('')
    const long = '风'.repeat(CANVAS_GLOBAL_STYLE_PROMPT_MAX_LENGTH + 50)
    expect(normalizeCanvasGlobalStylePrompt(long)).toHaveLength(CANVAS_GLOBAL_STYLE_PROMPT_MAX_LENGTH)
    expect(composeCanvasGlobalStylePrompt('', '')).toBe('')
    expect(composeCanvasGlobalStylePrompt(undefined, '   ')).toBe('')
  })

  it('uses exactly one flagged, non-empty text node as the canvas style source', () => {
    const nodes = [
      { id: 'text-1', type: 'text', data: { title: '统一画风', text: '水彩绘本风', globalStylePrompt: true } },
      { id: 'image-1', type: 'image', data: { text: '不应作为风格', globalStylePrompt: true } },
      { id: 'text-empty', type: 'text', data: { text: '   ', globalStylePrompt: false } },
    ]
    expect(findCanvasGlobalStylePromptNode(nodes)?.id).toBe('text-1')
    expect(readCanvasGlobalStylePrompt(nodes)).toBe('水彩绘本风')

    const duplicated = [...nodes, { id: 'text-2', type: 'text', data: { text: '另一个风格', globalStylePrompt: true } }]
    expect(findCanvasGlobalStylePromptNode(duplicated)).toBeNull()
    expect(readCanvasGlobalStylePrompt(duplicated)).toBe('')

    expect(findCanvasGlobalStylePromptNode([
      { id: 'empty-flag', type: 'text', data: { text: '', globalStylePrompt: true } },
    ])).toBeNull()
  })
})
