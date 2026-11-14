import { describe, expect, it } from 'vitest'
import {
  CANVAS_GLOBAL_STYLE_PROMPT_MAX_LENGTH,
  GLOBAL_STYLE_PROMPT_CLOSE,
  GLOBAL_STYLE_PROMPT_OPEN,
  VIDEO_PREFIX_PROMPT_CLOSE,
  VIDEO_PREFIX_PROMPT_OPEN,
  composeCanvasGlobalStylePrompt,
  composeCanvasVideoPrefixPrompt,
  extractCanvasGlobalStylePrompt,
  findCanvasGlobalStylePromptNode,
  findCanvasVideoPrefixPromptNode,
  normalizeCanvasGlobalStylePrompt,
  normalizeCanvasVideoPrefixPrompt,
  readCanvasGlobalStylePrompt,
  readCanvasVideoPrefixPrompt,
  stripCanvasGlobalStylePrompt,
  stripCanvasVideoPrefixPrompt,
} from '@/lib/canvas/global-style-prompt'

const prefixBlock = (prefix: string) => `${VIDEO_PREFIX_PROMPT_OPEN}\n${prefix}\n${VIDEO_PREFIX_PROMPT_CLOSE}`
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

  describe('video prefix prompt', () => {
    it('puts the prefix in front once and keeps the user original text intact', () => {
      const original = '雨夜车站，女孩回头看向镜头'
      const composed = composeCanvasVideoPrefixPrompt(original, '保持电影感，镜头缓慢推进')
      expect(composed).toBe(`${prefixBlock('保持电影感，镜头缓慢推进')}\n\n${original}`)
      expect(composeCanvasVideoPrefixPrompt(composed, '保持电影感，镜头缓慢推进')).toBe(composed)
      expect(composeCanvasVideoPrefixPrompt(composed, '改成手持纪实风')).toBe(`${prefixBlock('改成手持纪实风')}\n\n${original}`)
      expect(composeCanvasVideoPrefixPrompt('', '只有前置')).toBe(prefixBlock('只有前置'))
    })

    it('strips stacked prefix blocks, stray markers and empty values', () => {
      const original = '保留 [普通方括号] 的用户原文'
      const stacked = `${prefixBlock('旧前置')}\n\n${original}\n\n${prefixBlock('重复前置')}`
      expect(stripCanvasVideoPrefixPrompt(stacked)).toBe(original)
      expect(normalizeCanvasVideoPrefixPrompt('  [视频统一前置提示词]电影感[/视频统一前置提示词]  ')).toBe('电影感')
      expect(normalizeCanvasVideoPrefixPrompt(null)).toBe('')
      expect(normalizeCanvasVideoPrefixPrompt('风'.repeat(CANVAS_GLOBAL_STYLE_PROMPT_MAX_LENGTH + 9))).toHaveLength(CANVAS_GLOBAL_STYLE_PROMPT_MAX_LENGTH)
      expect(composeCanvasVideoPrefixPrompt(original, '   ')).toBe(original)
      expect(composeCanvasVideoPrefixPrompt(stacked, '')).toBe(original)
    })

    it('composes with the global style without either role disturbing the other', () => {
      const original = '镜头一'
      const styled = composeCanvasGlobalStylePrompt(original, '水彩绘本风')
      const full = composeCanvasVideoPrefixPrompt(styled, '电影感')
      expect(full).toBe(`${prefixBlock('电影感')}\n\n${original}\n\n${block('水彩绘本风')}`)
      expect(composeCanvasVideoPrefixPrompt(composeCanvasGlobalStylePrompt(full, '水彩绘本风'), '电影感')).toBe(full)
      expect(stripCanvasGlobalStylePrompt(full)).toBe(`${prefixBlock('电影感')}\n\n${original}`)
      expect(stripCanvasVideoPrefixPrompt(full)).toBe(`${original}\n\n${block('水彩绘本风')}`)
    })

    it('uses exactly one flagged, non-empty text node as the prefix source', () => {
      const nodes = [
        { id: 'text-1', type: 'text', data: { title: '前置', text: '电影感', videoPrefixPrompt: true } },
        { id: 'video-1', type: 'video', data: { text: '不应作为前置', videoPrefixPrompt: true } },
        { id: 'style-1', type: 'text', data: { text: '水彩', globalStylePrompt: true } },
      ]
      expect(findCanvasVideoPrefixPromptNode(nodes)?.id).toBe('text-1')
      expect(readCanvasVideoPrefixPrompt(nodes)).toBe('电影感')
      expect(readCanvasGlobalStylePrompt(nodes)).toBe('水彩')

      const duplicated = [...nodes, { id: 'text-2', type: 'text', data: { text: '另一个', videoPrefixPrompt: true } }]
      expect(findCanvasVideoPrefixPromptNode(duplicated)).toBeNull()
      expect(readCanvasVideoPrefixPrompt(duplicated)).toBe('')
      expect(findCanvasVideoPrefixPromptNode([{ id: 'empty', type: 'text', data: { text: ' ', videoPrefixPrompt: true } }])).toBeNull()
    })
  })
})
