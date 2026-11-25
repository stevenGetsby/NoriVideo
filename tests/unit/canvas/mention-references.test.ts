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
  planCanvasPromptMentions,
  resolveCanvasMentionNameOwners,
  shouldBindCanvasMentionReference,
} from '@/features/canvas/components/canvas-mention-references'
import { compileSeedanceMentionPrompt } from '@/lib/novel-promotion/seedance-prompt-assets'
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
      material('video-1', '环境视频', { type: 'video', url: 'video/synthetic-preview.mp4' }),
      material('unready', '生成中', { status: 'processing' }),
      material('audio-1', '不可选音频', { type: 'audio' }),
    ], ['image', 'video'])

    const poster = new URL(assets[0].imageUrl!, 'https://fixture.invalid')
    expect(poster.searchParams.get('key')).toBe('video/synthetic-preview.mp4')
    expect(poster.searchParams.get('poster')).toBe('480')

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

  it('keeps an explicitly picked voice @name even when a submitted image material carries the same library alias', () => {
    const referenceNodes = [
      node('target', 'video', '生成结果'),
      node('image-1', 'image', '沈娇-59集', { contentUrl: '/shen.webp', materialId: 'material-image' }),
      node('audio-1', 'audio', '沈娇', { audioUrl: '/shen.wav', materialId: 'material-audio' }),
    ]
    const assets = [
      ...buildCanvasMentionAssets(referenceNodes, 'target', ['image', 'audio'], new Set(['image-1', 'audio-1'])),
      ...buildCanvasLibraryMentionAssets([
        material('material-image', '沈娇', { metadata: { assetCategory: 'character' } }),
        material('material-audio', '沈娇', { type: 'audio', url: '/shen.wav' }),
      ], ['image', 'audio']),
    ]
    const prompt = '沈娇看着姐姐工作，用@沈娇的音色说话。'
    const referenceNodeIds = ['image-1', 'audio-1']
    const names = resolveCanvasMentionNameOwners(prompt, assets, referenceNodeIds, referenceNodes, [
      { nodeId: 'audio-1', name: '沈娇' },
    ])
    expect(names).toEqual({ 'audio-1': ['沈娇'] })

    const compiled = compileSeedanceMentionPrompt(prompt, [
      { type: 'image', index: 1, names: names['image-1'] || [], fallbackNames: ['沈娇-59集', '沈娇'], kind: 'character' },
      { type: 'audio', index: 1, names: names['audio-1'] || [], fallbackNames: ['沈娇'] },
    ], { mediaReferences: true })
    expect(compiled.prompt).toContain('图1（沈娇）看着姐姐工作')
    expect(compiled.prompt).toContain('用音频1的音色说话')
    expect(compiled.prompt).not.toContain('用图1（沈娇）的音色')
  })

  it('lets submitted editor names outrank library aliases even without a recorded selection', () => {
    const referenceNodes = [
      node('target', 'video', '生成结果'),
      node('image-1', 'image', '沈娇-59集', { contentUrl: '/shen.webp', materialId: 'material-image' }),
      node('audio-1', 'audio', '沈娇', { audioUrl: '/shen.wav', materialId: 'material-audio' }),
    ]
    const assets = [
      ...buildCanvasMentionAssets(referenceNodes, 'target', ['image', 'audio'], new Set(['image-1', 'audio-1'])),
      ...buildCanvasLibraryMentionAssets([
        material('material-image', '沈娇', { metadata: { assetCategory: 'character' } }),
      ], ['image']),
    ]
    const names = resolveCanvasMentionNameOwners('用@沈娇说话', assets, ['image-1', 'audio-1'], referenceNodes)
    expect(names).toEqual({ 'audio-1': ['沈娇'] })
  })

  it('falls back to image-first ownership for shared library aliases with no editor name or selection', () => {
    const referenceNodes = [
      node('target', 'video', '生成结果'),
      node('image-1', 'image', '沈娇-59集', { contentUrl: '/shen.webp', materialId: 'material-image' }),
      node('audio-1', 'audio', '沈娇音色', { audioUrl: '/shen.wav', materialId: 'material-audio' }),
    ]
    const assets = [
      ...buildCanvasMentionAssets(referenceNodes, 'target', ['image', 'audio'], new Set(['image-1', 'audio-1'])),
      ...buildCanvasLibraryMentionAssets([
        material('material-image', '沈娇', { metadata: { assetCategory: 'character' } }),
        material('material-audio', '沈娇', { type: 'audio', url: '/shen.wav' }),
      ], ['image', 'audio']),
    ]
    const names = resolveCanvasMentionNameOwners('@沈娇 出场', assets, ['image-1', 'audio-1'], referenceNodes)
    expect(names).toEqual({ 'image-1': ['沈娇'] })
  })

  it('normalizes material ids consistently between admission and the node reverse lookup', () => {
    const referenceNodes = [
      node('target', 'video', '生成结果'),
      node('image-1', 'image', '雨夜参考', { contentUrl: '/rain.webp', materialId: ' material-image ' }),
    ]
    const assets = [
      ...buildCanvasMentionAssets(referenceNodes, 'target', ['image'], new Set(['image-1'])),
      ...buildCanvasLibraryMentionAssets([
        material('material-image', '雨夜街巷', { metadata: { assetCategory: 'location' } }),
      ], ['image']),
    ]
    const names = resolveCanvasMentionNameOwners('@雨夜街巷 的场景', assets, ['image-1'], referenceNodes)
    expect(names).toEqual({ 'image-1': ['雨夜街巷'] })
  })

  it('drops recorded selections and library aliases whose reference was never submitted', () => {
    const referenceNodes = [
      node('target', 'video', '生成结果'),
      node('image-1', 'image', '沈娇-59集', { contentUrl: '/shen.webp', materialId: 'material-image' }),
      node('audio-1', 'audio', '沈娇', { audioUrl: '/shen.wav', materialId: 'material-audio' }),
    ]
    const assets = [
      ...buildCanvasMentionAssets(referenceNodes, 'target', ['image', 'audio'], new Set(['image-1', 'audio-1'])),
      ...buildCanvasLibraryMentionAssets([
        material('material-audio', '沈娇', { type: 'audio', url: '/shen.wav' }),
      ], ['audio']),
    ]
    const names = resolveCanvasMentionNameOwners('@沈娇 说话', assets, ['image-1'], referenceNodes, [
      { nodeId: 'audio-1', name: '沈娇' },
    ])
    expect(names).toEqual({})
  })

  it('keeps a recorded @name scannable after the material alias disappears from the menu', () => {
    const referenceNodes = [
      node('target', 'video', '生成结果'),
      node('image-1', 'image', '沈娇', { contentUrl: '/shen.webp', materialId: 'material-image' }),
      node('audio-1', 'audio', '沈娇音色·新版', { audioUrl: '/shen.wav', materialId: 'material-audio' }),
    ]
    const assets = buildCanvasMentionAssets(referenceNodes, 'target', ['image', 'audio'], new Set(['image-1', 'audio-1']))
    const prompt = '沈娇看着姐姐，用@沈娇的音色说话。'
    const names = resolveCanvasMentionNameOwners(prompt, assets, ['image-1', 'audio-1'], referenceNodes, [
      { nodeId: 'audio-1', name: '沈娇' },
    ])
    expect(names).toEqual({ 'audio-1': ['沈娇'] })

    const compiled = compileSeedanceMentionPrompt(prompt, [
      { type: 'image', index: 1, names: names['image-1'] || [], fallbackNames: ['沈娇'], kind: 'character' },
      { type: 'audio', index: 1, names: names['audio-1'] || [], fallbackNames: ['沈娇音色·新版'] },
    ], { mediaReferences: true })
    expect(compiled.prompt).toContain('图1（沈娇）看着姐姐')
    expect(compiled.prompt).toContain('用音频1的音色说话')
  })

  it('restores draft selections and still validates them against the current prompt and submitted references', () => {
    const referenceNodes = [
      node('target', 'video', '生成结果'),
      node('image-1', 'image', '沈娇', { contentUrl: '/shen.webp', materialId: 'material-image' }),
      node('audio-1', 'audio', '沈娇音色', { audioUrl: '/shen.wav', materialId: 'material-audio' }),
    ]
    const assets = buildCanvasMentionAssets(referenceNodes, 'target', ['image', 'audio'], new Set(['image-1', 'audio-1']))
    const persisted = [{ nodeId: 'audio-1', name: '沈娇' }]
    expect(resolveCanvasMentionNameOwners('用@沈娇说话', assets, ['image-1', 'audio-1'], referenceNodes, persisted))
      .toEqual({ 'audio-1': ['沈娇'] })
    expect(resolveCanvasMentionNameOwners('用沈娇音色说话', assets, ['image-1', 'audio-1'], referenceNodes, persisted))
      .toEqual({})
    expect(resolveCanvasMentionNameOwners('用@沈娇说话', assets, ['image-1'], referenceNodes, persisted))
      .toEqual({ 'image-1': ['沈娇'] })
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
    expect(source).toContain('replacePromptMention(liveValue, liveMention, caret, editorFocused ? selectionEnd : caret')
  })

  it('leaves paste to the browser instead of auto-tagging asset names', () => {
    expect(source).not.toContain('onPaste')
    expect(source).not.toContain('pastePromptAssets')
    expect(source).not.toContain('onPasteMatch')
  })

  it('records undoable mention inserts against the live value', () => {
    expect(source).toContain('undoPromptInsertion(event.currentTarget.value, record)')
    expect(source).toContain('redoPromptInsertion(event.currentTarget.value, record)')
  })
})

describe('canvas prompt mention planning', () => {
  const canvasAssets = () => buildCanvasMentionAssets([
    node('target', 'video', '生成结果'),
    node('wired', 'image', '林夏', { contentUrl: '/wired.webp', materialId: 'material-wired' }),
    node('upstream', 'image', '雨夜街巷', { contentUrl: '/upstream.webp' }),
  ], 'target', ['image', 'video', 'audio'], new Set(['wired']), new Set(['upstream']))
  const libraryAssets = () => buildCanvasLibraryMentionAssets([
    material('lib-linxia', '林夏'),
    material('lib-voice', '林夏音色', { type: 'audio' }),
    material('lib-mask', '蒙面人'),
  ], ['image', 'video', 'audio'])
  const unbound = { nodeIds: new Set<string>(), materialIds: new Set<string>() }

  it('resolves a name to the wired node before a same-named library asset', () => {
    const plan = planCanvasPromptMentions(['@林夏 走进@雨夜街巷'], [...canvasAssets(), ...libraryAssets()], unbound)
    expect(plan.unknown).toEqual([])
    expect(plan.mentioned.map(({ asset, names }) => ({ id: asset.id, section: asset.section, names }))).toEqual([
      { id: 'wired', section: 'connected', names: ['林夏'] },
      { id: 'upstream', section: 'secondary', names: ['雨夜街巷'] },
    ])
  })

  it('lets an already-bound library reference win a name collision', () => {
    const plan = planCanvasPromptMentions(['@林夏'], [...canvasAssets(), ...libraryAssets()], {
      nodeIds: new Set(), materialIds: new Set(['lib-linxia']),
    })
    expect(plan.mentioned[0]?.asset).toMatchObject({ section: 'library', materialId: 'lib-linxia' })
  })

  it('groups repeated mentions per asset and reports every dangling @ across all texts', () => {
    const plan = planCanvasPromptMentions(
      ['@蒙面人 拔刀，@蒙面人 用@林夏音色 冷笑', '风格：@旧角色 @女主_萧令仪'],
      [...canvasAssets(), ...libraryAssets()],
      unbound,
    )
    expect(plan.mentioned.map(({ asset, names }) => [asset.materialId, names])).toEqual([
      ['lib-mask', ['蒙面人']],
      ['lib-voice', ['林夏音色']],
    ])
    expect(plan.unknown.map((item) => item.text)).toEqual(['旧角色', '女主_萧令仪'])
  })

  it('treats an unwired reference picked from the library as a direct input', () => {
    const assets = buildCanvasMentionAssets([
      node('target', 'video', '生成结果'),
      node('picked', 'image', '道具·银簪', { contentUrl: '/pin.webp', materialId: 'material-pin' }),
    ], 'target', ['image'], new Set(['picked']))
    const plan = planCanvasPromptMentions(['握紧@道具·银簪'], assets, { nodeIds: new Set(['picked']), materialIds: new Set() })
    expect(plan.unknown).toEqual([])
    expect(plan.mentioned[0]?.asset.id).toBe('picked')
  })
})

describe('mention highlight states', () => {
  it('marks bound, unbound and unknown mentions without changing any character', () => {
    const text = '@林夏 看着@蒙面人 和@旧角色。'
    const parts = splitPromptMentionParts(text, [{ name: '林夏' }, { name: '蒙面人' }], {
      boundNames: new Set(['林夏']),
      flagUnknown: true,
    })
    expect(parts.filter((part) => part.mention).map(({ text: value, state }) => [value, state])).toEqual([
      ['@林夏', 'bound'],
      ['@蒙面人', 'unbound'],
      ['@旧角色', 'unknown'],
    ])
    expect(parts.map((part) => part.text).join('')).toBe(text)
  })

  it('does not flag unknown mentions until the library has loaded', () => {
    const parts = splitPromptMentionParts('@旧角色 走路', [], { boundNames: new Set() })
    expect(parts).toEqual([{ text: '@旧角色 走路', mention: false }])
  })
})
