import * as React from 'react'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { MentionPromptEditor } from '@/components/frameos/materials/MentionPromptEditor'
import {
  findActiveMention,
  insertPromptMention,
  isPromptCompositionKey,
  matchPromptAssetNames,
  pastePromptAssets,
  redoPromptInsertion,
  replacePromptMention,
  splitPromptMentionParts,
  undoPromptInsertion,
} from '@/components/frameos/materials/mention-prompt'
import {
  buildCanvasLibraryMentionAssets,
  buildCanvasMentionAssets,
  collectCanvasSecondaryNodeIds,
  mergeCanvasReferenceNodeIds,
  shouldBindCanvasMentionReference,
} from '@/features/canvas/components/canvas-mention-references'
import type { FrameosMaterialItem } from '@/components/frameos/materials/contracts'
import type { CanvasFlowNode } from '@/features/canvas/editor-types'

beforeAll(() => vi.stubGlobal('React', React))
afterAll(() => vi.unstubAllGlobals())

function node(id: string, type: string, title: string, data: Record<string, unknown> = {}): CanvasFlowNode {
  return {
    id,
    type,
    position: { x: 0, y: 0 },
    data: { title, ...data },
  }
}

function material(id: string, title: string, input: Partial<FrameosMaterialItem> = {}): FrameosMaterialItem {
  return {
    id, projectId: 'project-1', projectName: '我的项目', ownerName: null,
    title, type: 'image', source: 'upload', status: 'ready', isFavorited: false,
    resultUrl: `/${id}.webp`, storageKey: null, url: `/${id}.webp`,
    createdAt: '2026-01-01', updatedAt: '2026-01-01', ...input,
  }
}

describe('canvas @mention references', () => {
  it('offers only actual connected inputs without enumerating unconnected canvas library entities', () => {
    const assets = buildCanvasMentionAssets([
      node('target', 'video', '生成结果'),
      node('image-1', 'image', '雨夜参考', { contentUrl: '/image.webp', materialId: 'material-image', origin: 'project' }),
      node('video-1', 'video', '雨夜参考', { posterUrl: '/poster.webp', materialId: 'material-video', origin: 'upload' }),
      node('audio-1', 'audio', '环境雷声', { audioUrl: '/thunder.wav', materialId: 'material-audio', origin: 'project' }),
      node('wired-generated', 'image', '连线生成图', { contentUrl: '/wired.webp', origin: 'generate' }),
      node('url-only', 'image', '未连线生成图', { contentUrl: '/orphan.webp', origin: 'generate' }),
      node('unmarked', 'image', '未标记来源', { contentUrl: '/legacy.webp' }),
      node('group-1', 'group', '镜头组'),
    ], 'target', ['image', 'video', 'audio'], new Set(['image-1', 'wired-generated']))

    expect(assets.map(({ id, mediaType, name }) => ({ id, mediaType, name }))).toEqual([
      { id: 'wired-generated', mediaType: 'image', name: '连线生成图' },
      { id: 'image-1', mediaType: 'image', name: '雨夜参考' },
    ])
    expect(assets[0]).toMatchObject({ imageUrl: '/wired.webp', section: 'connected', description: '图片 · 已连接节点 · 将自动建立引用' })
    expect(assets[1]).toMatchObject({ imageUrl: '/image.webp', section: 'connected', description: '图片 · 已连接节点' })
    expect(assets.some(({ id }) => ['url-only', 'unmarked', 'video-1', 'audio-1'].includes(id))).toBe(false)
  })

  it('builds the personal library with favorites and asset categories independent of canvas nodes', () => {
    const assets = buildCanvasLibraryMentionAssets([
      material('character-1', '林夏', { isFavorited: true, metadata: { assetCategory: 'character' } }),
      material('location-1', '雨夜街巷', { metadata: { assetCategory: 'location' } }),
      material('video-1', '环境视频', { type: 'video' }),
      material('unready', '生成中', { status: 'processing' }),
      material('audio-1', '不可选音频', { type: 'audio' }),
    ], ['image', 'video'])

    expect(assets.map(({ id, category, section }) => ({ id, category, section }))).toEqual([
      { id: 'library:other:video-1', category: 'other', section: 'library' },
      { id: 'library:favorites:character-1', category: 'favorites', section: 'library' },
      { id: 'library:character:character-1', category: 'character', section: 'library' },
      { id: 'library:location:location-1', category: 'location', section: 'library' },
    ])
    expect(assets.find(({ materialId }) => materialId === 'character-1')?.material).toMatchObject({ id: 'character-1', title: '林夏' })
    expect(assets.find(({ category }) => category === 'character')?.description).toContain('角色 · 图片')
    expect(assets.some(({ materialId }) => materialId === 'unready' || materialId === 'audio-1')).toBe(false)
  })

  it('adds a mentioned entity id without dropping or reordering wired references', () => {
    const connected = ['wired-image', 'wired-audio']
    expect(mergeCanvasReferenceNodeIds(connected, 'canvas-video')).toEqual([
      'wired-image',
      'wired-audio',
      'canvas-video',
    ])
    expect(mergeCanvasReferenceNodeIds(connected, 'wired-image')).toBe(connected)
    expect(shouldBindCanvasMentionReference('video')).toBe(true)
    expect(shouldBindCanvasMentionReference('image')).toBe(true)
    expect(shouldBindCanvasMentionReference('audio')).toBe(false)
  })

  it('does not use unconnected library nodes as connected assets', () => {
    const assets = buildCanvasMentionAssets([
      node('canvas-audio', 'audio', '资产库音频', { audioUrl: '/canvas.wav', origin: 'upload' }),
      node('canvas-image', 'image', '资产库图片', { contentUrl: '/canvas.webp', origin: 'project' }),
      node('wired-audio', 'audio', '连线音频', { audioUrl: '/wired.wav' }),
      node('wired-image', 'image', '连线图片', { contentUrl: '/wired.webp' }),
    ], 'target', ['image', 'audio'], new Set(['wired-audio', 'wired-image']))

    expect(assets.map((asset) => asset.id)).toEqual(['wired-image', 'wired-audio'])
  })

  it('replaces only the active query and preserves ordinary prompt text', () => {
    const value = '开场描述 @雨 之后的普通文本保持不变。'
    const cursor = value.indexOf(' 之后')
    const mention = findActiveMention(value, cursor)
    expect(mention).toEqual({ query: '雨', start: 5 })
    expect(insertPromptMention(value, mention!, cursor, '雨夜街巷')).toEqual({
      value: '开场描述 @雨夜街巷 之后的普通文本保持不变。',
      cursor: 10,
    })
  })

  it('renders bound asset names as mention tokens while retaining plain text', () => {
    const markup = renderToStaticMarkup(React.createElement(MentionPromptEditor, {
      value: '普通文字 @参考图，随后听见 @环境雷声。',
      assets: [
        { id: 'image-1', name: '参考图', mediaType: 'image' },
        { id: 'audio-1', name: '环境雷声', mediaType: 'audio' },
      ],
      onChange: vi.fn(),
      hint: null,
    }))

    expect(markup).toContain('<mark class="mention-prompt-highlight__asset">@参考图</mark>')
    expect(markup).toContain('<mark class="mention-prompt-highlight__asset">@环境雷声</mark>')
    expect(markup).toContain('普通文字 ')
    expect(markup).toContain('随后听见 ')
  })

  it('collects exactly one extra upstream hop while excluding self, direct inputs and cycles', () => {
    const edges = [
      { source: 'direct-a', target: 'target' },
      { source: 'second-b', target: 'direct-a' },
      { source: 'third-c', target: 'second-b' },
      { source: 'second-d', target: 'direct-a' },
      { source: 'target', target: 'third-c' },
      { source: 'target', target: 'target' },
      { source: 'direct-a', target: 'target' },
    ]
    const secondary = collectCanvasSecondaryNodeIds(edges, 'target', ['direct-a'])
    expect(secondary).toEqual(['second-b', 'second-d'])
    expect(secondary).not.toContain('target')
    expect(secondary).not.toContain('direct-a')
    expect(secondary).not.toContain('third-c')
    expect(collectCanvasSecondaryNodeIds(edges, 'target', ['direct-a'], 3)).toEqual(['second-b', 'second-d'])
  })

  it('labels direct and secondary inputs without duplicating a direct node that is also two hops away', () => {
    const assets = buildCanvasMentionAssets([
      node('target', 'video', '生成结果'),
      node('direct', 'image', '直接输入', { contentUrl: '/direct.webp', materialId: 'material-direct' }),
      node('second', 'image', '二级输入', { contentUrl: '/second.webp', materialId: 'material-second' }),
      node('third', 'image', '三级输入', { contentUrl: '/third.webp', materialId: 'material-third' }),
    ], 'target', ['image'], new Set(['direct']), new Set(['direct', 'second', 'target']))

    expect(assets.map(({ id, section, description }) => ({ id, section, description }))).toEqual([
      { id: 'second', section: 'secondary', description: '图片 · 二级连接节点' },
      { id: 'direct', section: 'connected', description: '图片 · 已连接节点' },
    ])
  })

  it('prefixes pasted asset names longest-first while skipping existing mentions and preserving text', () => {
    const assets = [{ name: '张三' }, { name: '张三丰' }, { name: '雨夜街巷' }]
    expect(matchPromptAssetNames('张三丰走进 @雨夜街巷，张三跟上', assets)).toEqual({
      value: '@张三丰走进 @雨夜街巷，@张三跟上',
      matched: ['张三丰', '张三'],
    })
    expect(matchPromptAssetNames('普通文字没有任何素材名', assets)).toEqual({
      value: '普通文字没有任何素材名',
      matched: [],
    })
    expect(matchPromptAssetNames('', assets)).toEqual({ value: '', matched: [] })
  })

  it('escapes regex characters, enforces ASCII word boundaries and deduplicates names case-insensitively', () => {
    expect(matchPromptAssetNames('A+B 与 AAAB 和 a.b', [{ name: 'A+B' }, { name: 'a.b' }])).toEqual({
      value: '@A+B 与 AAAB 和 @a.b',
      matched: ['A+B', 'a.b'],
    })
    const duplicated = matchPromptAssetNames('LANMIAO 与 lanmiao', [{ name: 'LanMiao' }, { name: 'lanmiao' }])
    expect(duplicated).toEqual({
      value: '@LANMIAO 与 @lanmiao',
      matched: ['LanMiao'],
    })
    expect(matchPromptAssetNames('张三', [{ name: '   ' }, { name: '@张三' }])).toEqual({
      value: '@张三',
      matched: ['张三'],
    })
  })
})

describe('mention detection while deleting Chinese prompt text', () => {
  const assets = [{ name: '张三' }, { name: '张三丰' }, { name: '雨夜街巷' }]

  it('only reports a mention when the caret is still inside the @token', () => {
    const value = '开头 @雨夜街巷，后续文字'
    expect(findActiveMention(value, value.indexOf('巷'))).toEqual({ query: '雨夜街', start: 3 })
    expect(findActiveMention(value, value.indexOf('，') + 2)).toBeNull()
    expect(findActiveMention('开头 @雨\n下一行', 4)).toEqual({ query: '', start: 3 })
    expect(findActiveMention('开头 @雨\n下一行', 7)).toBeNull()
  })

  it('uses the latest @ signature when text is retyped', () => {
    expect(findActiveMention('@张三@李', 6)).toEqual({ query: '李', start: 3 })
    expect(findActiveMention('普通文本@', 5)).toEqual({ query: '', start: 4 })
    expect(findActiveMention('abc@x', 2)).toBeNull()
  })

  it('clamps an out-of-range caret instead of running past the text', () => {
    expect(findActiveMention('@雨', 99)).toEqual({ query: '雨', start: 0 })
    expect(findActiveMention('@雨', -5)).toBeNull()
    expect(findActiveMention('@雨', Number.NaN)).toEqual({ query: '雨', start: 0 })
  })

  it('replaces a whole bound token when the caret sits inside it after a deletion', () => {
    const value = '开头 @张三丰 结尾'
    const caret = value.indexOf('三') + 1 // between 三 and 丰
    const mention = findActiveMention(value, caret)
    expect(mention).toEqual({ query: '张三', start: 3 })
    expect(replacePromptMention(value, mention, caret, caret, '张三丰', assets)).toEqual({
      value: '开头 @张三丰 结尾',
      cursor: 7,
    })
  })

  it('does not duplicate the tail when the token is partially deleted and retyped', () => {
    // 删掉“三”后输入法/键盘重新输入“三”，此时 caret 在 token 内。
    const partial = '开头 @张丰 结尾'
    const caret = partial.indexOf('张') + 1
    const mention = findActiveMention(partial, caret)
    expect(replacePromptMention(partial, mention, caret, caret, '张三丰', assets)).toEqual({
      value: '开头 @张三丰 结尾',
      cursor: 7,
    })
  })

  it('absorbs a partially deleted Latin token so retyping cannot duplicate it', () => {
    // 删掉 John 中的 o 后得到 @Jhn，caret 在 J 后面；选择 John 必须整体替换。
    const value = '@Jhn'
    const caret = 2
    const mention = findActiveMention(value, caret)
    expect(replacePromptMention(value, mention, caret, caret, 'John', [{ name: 'John' }])).toEqual({
      value: '@John ',
      cursor: 6,
    })
  })

  it('keeps ordinary trailing text that cannot be part of the chosen name', () => {
    const value = '@大山'
    const caret = 1
    const mention = findActiveMention(value, caret)
    expect(replacePromptMention(value, mention, caret, caret, '张三丰', assets)).toEqual({
      value: '@张三丰 大山',
      cursor: 5,
    })
  })

  it('replaces the selected range and keeps punctuation intact', () => {
    const value = '开头 @旧素材，结尾'
    const start = value.indexOf('@')
    const selectionEnd = value.indexOf('，')
    expect(replacePromptMention(value, { query: '旧素材', start }, start, selectionEnd, '雨夜街巷', assets)).toEqual({
      value: '开头 @雨夜街巷，结尾',
      cursor: 8,
    })
  })

  it('adds a separating space only when the following character is not punctuation or whitespace', () => {
    expect(replacePromptMention('@雨', { query: '雨', start: 0 }, 2, 2, '雨夜街巷', assets)).toEqual({
      value: '@雨夜街巷 ',
      cursor: 6,
    })
    expect(replacePromptMention('@雨，后续', { query: '雨', start: 0 }, 2, 2, '雨夜街巷', assets)).toEqual({
      value: '@雨夜街巷，后续',
      cursor: 5,
    })
    expect(replacePromptMention('@雨。', { query: '雨', start: 0 }, 2, 2, '雨夜街巷', assets)?.value)
      .toBe('@雨夜街巷。')
    expect(replacePromptMention('@雨', { query: '雨', start: 0 }, 2, 2, '雨夜街巷', [])?.value)
      .toBe('@雨夜街巷 ')
  })

  it('refuses stale mention positions that no longer point at @', () => {
    expect(replacePromptMention('已经被替换的文字', { query: '雨', start: 0 }, 3, 3, '雨夜街巷', assets)).toBeNull()
    expect(replacePromptMention('@雨', { query: '雨', start: 0 }, 2, 2, '   ', assets)).toBeNull()
    expect(replacePromptMention('@雨', null, 2, 2, '雨夜街巷', assets)).toBeNull()
  })

  it('replaces a complete mention even when the caret was moved into the middle', () => {
    const value = '前面 @张三丰 和 @雨夜街巷'
    const secondStart = value.lastIndexOf('@')
    const caret = secondStart + 2
    expect(replacePromptMention(value, findActiveMention(value, caret), caret, caret, '张三', assets)).toEqual({
      value: '前面 @张三丰 和 @张三 ',
      cursor: 14,
    })
  })
})

describe('mention paste matching against a live selection', () => {
  const assets = [{ name: '张三' }, { name: '张三丰' }, { name: '雨夜街巷' }]

  it('auto-prefixes every known name and reports them once', () => {
    expect(pastePromptAssets('开头：', 3, 3, '张三丰走进雨夜街巷，张三跟上', assets)).toEqual({
      value: '开头：@张三丰走进@雨夜街巷，@张三跟上',
      cursor: 20,
      matched: ['张三丰', '雨夜街巷', '张三'],
    })
  })

  it('does not double the @ when the user already typed one', () => {
    expect(pastePromptAssets('开头 @', 4, 4, '雨夜街巷', assets)).toEqual({
      value: '开头 @雨夜街巷',
      cursor: 8,
      matched: ['雨夜街巷'],
    })
  })

  it('replaces the selected text instead of inserting beside it', () => {
    expect(pastePromptAssets('开头 XXX 结尾', 3, 6, '张三', assets)).toEqual({
      value: '开头 @张三 结尾',
      cursor: 6,
      matched: ['张三'],
    })
  })

  it('preserves newlines between matched names', () => {
    expect(pastePromptAssets('', 0, 0, '张三\n李四', [{ name: '张三' }])?.value).toBe('@张三\n李四')
  })

  it('returns null for empty, unmatched or selection-free ordinary text', () => {
    expect(pastePromptAssets('abc', 3, 3, '', assets)).toBeNull()
    expect(pastePromptAssets('abc', 3, 3, '普通文字', assets)).toBeNull()
    expect(pastePromptAssets('abc', 3, 3, '张三', [])).toBeNull()
  })

  it('clamps a selection that extends beyond the current value', () => {
    expect(pastePromptAssets('开头', 99, 120, '张三', assets)).toEqual({
      value: '开头@张三',
      cursor: 5,
      matched: ['张三'],
    })
  })
})

describe('programmatic mention insertion history', () => {
  const record = { before: '@雨', after: '@雨夜街巷 ', cursorBefore: 2, cursorAfter: 6 }

  it('undoes and redoes only while the text still matches the recorded state', () => {
    expect(undoPromptInsertion('@雨夜街巷 ', record)).toEqual({ value: '@雨', cursor: 2 })
    expect(redoPromptInsertion('@雨', record)).toEqual({ value: '@雨夜街巷 ', cursor: 6 })
    expect(undoPromptInsertion('@雨夜街巷 用户又改了', record)).toBeNull()
    expect(redoPromptInsertion('@雨夜街巷 ', record)).toBeNull()
    expect(undoPromptInsertion('@雨', null)).toBeNull()
    expect(redoPromptInsertion('@雨', null)).toBeNull()
  })

  it('ignores IME-owned keys but not ordinary Enter/Tab navigation', () => {
    expect(isPromptCompositionKey({ nativeEvent: { isComposing: true } })).toBe(true)
    expect(isPromptCompositionKey({ nativeEvent: { keyCode: 229 } })).toBe(true)
    expect(isPromptCompositionKey({ keyCode: 229 })).toBe(true)
    expect(isPromptCompositionKey({ nativeEvent: { isComposing: false, keyCode: 13 } })).toBe(false)
    expect(isPromptCompositionKey({})).toBe(false)
  })

  it('splits mentions longest-first without changing any character', () => {
    const parts = splitPromptMentionParts('张三丰和@张三，以及 @A+B。', [
      { name: '张三' },
      { name: '张三丰' },
      { name: 'a+b' },
    ])
    expect(parts).toEqual([
      { text: '张三丰和', mention: false },
      { text: '@张三', mention: true },
      { text: '，以及 ', mention: false },
      { text: '@A+B', mention: true },
      { text: '。', mention: false },
    ])
    expect(parts.map((part) => part.text).join('')).toBe('张三丰和@张三，以及 @A+B。')
    expect(splitPromptMentionParts('', [{ name: '张三' }])).toEqual([])
    expect(splitPromptMentionParts('普通文字', [])).toEqual([{ text: '普通文字', mention: false }])
  })
})

describe('editor wiring contracts', () => {
  const source = readFileSync(
    path.join(process.cwd(), 'src/components/frameos/materials/MentionPromptEditor.tsx'),
    'utf8',
  )

  it('never hijacks Enter/Tab/arrow keys while the IME is composing', () => {
    const keyDown = source.slice(source.indexOf('onKeyDown={(event) => {'))
    expect(keyDown).toContain('if (isPromptCompositionKey(event)) return')
    expect(source).toContain('onCompositionStart={() => {')
    expect(source).toContain('onCompositionEnd={(event) => {')
  })

  it('resolves mention insertion against the live textarea value and selection', () => {
    expect(source).toContain('const liveValue = textarea.value')
    expect(source).toContain('findActiveMention(liveValue, selectionStart) ?? mention')
    expect(source).toContain('replacePromptMention(liveValue, liveMention, selectionStart, selectionEnd')
  })

  it('routes paste through the live selection helper and records undoable inserts', () => {
    expect(source).toContain('pastePromptAssets(liveValue, selectionStart, selectionEnd, pastedText, assets)')
    expect(source).toContain('undoPromptInsertion(event.currentTarget.value, record)')
    expect(source).toContain('redoPromptInsertion(event.currentTarget.value, record)')
  })
})
