import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { MentionPromptEditor } from '@/components/frameos/materials/MentionPromptEditor'
import { findActiveMention, insertPromptMention } from '@/components/frameos/materials/mention-prompt'
import {
  buildCanvasMentionAssets,
  mergeCanvasReferenceNodeIds,
  shouldBindCanvasMentionReference,
} from '@/features/canvas/components/canvas-mention-references'
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

describe('canvas @mention references', () => {
  it('offers connected inputs and asset-library entities without enumerating generated canvas nodes', () => {
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
      { id: 'image-1', mediaType: 'image', name: '雨夜参考·图片' },
      { id: 'audio-1', mediaType: 'audio', name: '环境雷声' },
      { id: 'video-1', mediaType: 'video', name: '雨夜参考·视频' },
    ])
    expect(assets.find(({ id }) => id === 'image-1')).toMatchObject({ imageUrl: '/image.webp', description: '图片 · 已连接上游' })
    expect(assets[3]).toMatchObject({ imageUrl: '/poster.webp', description: '视频 · 资产库素材' })
    expect(assets[2]).toMatchObject({ imageUrl: null, description: '音频 · 资产库素材' })
    expect(assets.some(({ id }) => id === 'url-only' || id === 'unmarked')).toBe(false)
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

  it('puts connected upstream entities before unconnected asset-library nodes', () => {
    const assets = buildCanvasMentionAssets([
      node('canvas-audio', 'audio', '资产库音频', { audioUrl: '/canvas.wav', origin: 'upload' }),
      node('canvas-image', 'image', '资产库图片', { contentUrl: '/canvas.webp', origin: 'project' }),
      node('wired-audio', 'audio', '连线音频', { audioUrl: '/wired.wav' }),
      node('wired-image', 'image', '连线图片', { contentUrl: '/wired.webp' }),
    ], 'target', ['image', 'audio'], new Set(['wired-audio', 'wired-image']))

    expect(assets.map((asset) => asset.id)).toEqual(['wired-image', 'wired-audio', 'canvas-image', 'canvas-audio'])
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
