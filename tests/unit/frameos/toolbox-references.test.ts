import { describe, expect, it } from 'vitest'
import {
  appendToolboxReference,
  appendToolboxTypedReference,
} from '@/components/frameos/views/toolbox-references'

describe('toolbox reference selection', () => {
  it('keeps accepting distinct image, video, and audio references until the mode limit', () => {
    const image = { id: 'image-1', type: 'image' }
    const video = { id: 'video-1', type: 'video' }
    const audio = { id: 'audio-1', type: 'audio' }

    const first = appendToolboxReference([], image, 15)
    const second = appendToolboxReference(first, video, 15)
    const third = appendToolboxReference(second, audio, 15)

    expect(third).toEqual([image, video, audio])
  })

  it('deduplicates only the selected material instead of blocking every later selection', () => {
    const current = [{ id: 'image-1' }, { id: 'audio-1' }]

    expect(appendToolboxReference(current, { id: 'audio-1' }, 15)).toBe(current)
    expect(appendToolboxReference(current, { id: 'video-1' }, 15)).toEqual([
      { id: 'image-1' },
      { id: 'audio-1' },
      { id: 'video-1' },
    ])
  })

  it('does not exceed the active generation mode reference limit', () => {
    const current = [{ id: 'first-frame' }, { id: 'last-frame' }]
    expect(appendToolboxReference(current, { id: 'extra-frame' }, 2)).toBe(current)
  })

  it('enforces independent Seedance image, video and audio limits', () => {
    const current = [
      { id: 'image-1', type: 'image' },
      { id: 'video-1', type: 'video' },
      { id: 'video-2', type: 'video' },
      { id: 'video-3', type: 'video' },
    ]

    expect(appendToolboxTypedReference(current, { id: 'video-4', type: 'video' }, 'video', 3)).toBe(current)
    expect(appendToolboxTypedReference(current, { id: 'audio-1', type: 'audio' }, 'audio', 3)).toEqual([
      ...current,
      { id: 'audio-1', type: 'audio' },
    ])
    expect(appendToolboxTypedReference(current, { id: 'wrong', type: 'image' }, 'audio', 3)).toBe(current)
  })
})
