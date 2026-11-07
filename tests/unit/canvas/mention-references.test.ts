import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { MentionPromptEditor } from '@/components/frameos/materials/MentionPromptEditor'
import { findActiveMention, insertPromptMention } from '@/components/frameos/materials/mention-prompt'
import {
  buildCanvasLibraryMentionAssets,
  buildCanvasMentionAssets,
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
})
