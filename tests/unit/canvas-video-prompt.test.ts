import { describe, expect, it } from 'vitest'
import { resolveVideoVersionPrompt } from '@/features/canvas/video-prompt'

describe('video version prompt resolution', () => {
  it('uses the latest history prompt matching the current video while ignoring signed URLs', () => {
    const resolved = resolveVideoVersionPrompt({
      videoUrl: 'https://cdn.example.com/shot.mp4?signature=current',
      prompt: '节点提示词',
      history: [
        { id: 'old', url: 'https://cdn.example.com/shot.mp4?signature=old', prompt: '第一版', createdAt: '2026-11-14T00:00:00.000Z', status: 'ready' },
        { id: 'other', url: 'https://cdn.example.com/other.mp4', prompt: '其他视频', createdAt: '2026-11-15T00:00:00.000Z', status: 'ready' },
        { id: 'new', url: 'https://cdn.example.com/shot.mp4', prompt: '第二版', modelKey: 'video-model', parameters: { duration: 6, aspectRatio: '16:9' }, createdAt: '2026-11-15T01:00:00.000Z', status: 'ready' },
      ],
    })
    expect(resolved).toEqual({ prompt: '第二版', source: 'history', modelKey: 'video-model', parameters: { duration: 6, aspectRatio: '16:9' } })
  })

  it('falls back to source metadata only when no matching history has a prompt', () => {
    expect(resolveVideoVersionPrompt({ contentUrl: '/video.mp4', prompt: '节点', sourceMetadata: { prompt: '导入素材提示词' }, history: [{ id: 'h', url: '/other.mp4', prompt: '其他', createdAt: '2026-01-01T00:00:00.000Z', status: 'ready' }] })).toEqual({ prompt: '导入素材提示词', source: 'metadata' })
  })

  it('uses the node prompt when version history and metadata are unavailable', () => {
    expect(resolveVideoVersionPrompt({ prompt: '节点提示词' })).toEqual({ prompt: '节点提示词', source: 'node' })
  })

  it('reports missing prompts explicitly', () => {
    expect(resolveVideoVersionPrompt({ prompt: '  ', sourceMetadata: { prompt: 42 } })).toEqual({ prompt: '', source: 'none' })
  })
})
