import { beforeEach, describe, expect, it, vi } from 'vitest'

const utilsMock = vi.hoisted(() => ({
  toSignedUrlIfCos: vi.fn((value: string | null | undefined) => (
    value ? `signed:${value}` : null
  )),
}))

const mediaMock = vi.hoisted(() => ({
  resolveMediaRef: vi.fn(async (mediaId: unknown, legacyValue: unknown) => {
    if (typeof mediaId === 'string' && mediaId.trim()) {
      return { id: mediaId, url: `/m/${mediaId}` }
    }
    if (typeof legacyValue === 'string' && legacyValue.trim()) {
      return { id: `legacy-${legacyValue}`, url: legacyValue }
    }
    return null
  }),
  mediaUrlFromRef: vi.fn((ref: { url?: string } | null | undefined, fallback: string | null | undefined) => (
    ref?.url || fallback || null
  )),
}))

vi.mock('@/lib/workers/utils', () => utilsMock)
vi.mock('@/lib/media/service', () => mediaMock)

import { collectPanelReferenceImages } from '@/lib/workers/handlers/image-task-handler-shared'

describe('collectPanelReferenceImages', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('collects sketch, character, location, and prop references from Agent panel asset usage', async () => {
    const refs = await collectPanelReferenceImages({
      characters: [
        {
          name: 'Ava',
          appearances: [
            {
              appearanceIndex: 0,
              changeReason: 'initial',
              imageUrls: JSON.stringify(['images/ava-primary.png']),
              imageUrl: null,
              selectedIndex: 0,
            },
          ],
        },
        {
          name: 'Dr. Grayson',
          appearances: [
            {
              appearanceIndex: 0,
              changeReason: 'scrubs',
              imageUrls: JSON.stringify([]),
              imageUrl: null,
              imageMediaId: 'media-grayson',
              selectedIndex: 0,
            },
          ],
        },
      ],
      locations: [
        {
          name: 'Modern American Hospital',
          assetKind: 'location',
          images: [
            {
              imageIndex: 0,
              isSelected: true,
              imageUrl: 'images/hospital.png',
            },
          ],
        },
        {
          name: 'Moon Lamp',
          assetKind: 'prop',
          images: [
            {
              imageIndex: 0,
              isSelected: true,
              imageUrl: null,
              imageMediaId: 'media-moon-lamp',
            },
          ],
        },
      ],
    }, {
      sketchImageMediaId: 'media-panel-sketch',
      characters: JSON.stringify([
        { name: 'Ava', appearance: 'initial' },
        { name: 'Dr. Grayson', appearance: 'scrubs' },
      ]),
      location: 'Modern American Hospital',
      props: JSON.stringify([{ name: 'Moon Lamp' }]),
      description: 'Ava holds the Moon Lamp while Dr. Grayson watches.',
      videoPrompt: null,
      srtSegment: null,
    })

    expect(refs).toEqual([
      'signed:/m/media-panel-sketch',
      'signed:images/ava-primary.png',
      'signed:/m/media-grayson',
      'signed:images/hospital.png',
      'signed:/m/media-moon-lamp',
    ])
  })

  it('matches character aliases and visible prop names when explicit props are missing', async () => {
    const refs = await collectPanelReferenceImages({
      characters: [
        {
          name: '小兔子/兔兔',
          appearances: [
            {
              appearanceIndex: 0,
              changeReason: '初始形象',
              imageUrls: JSON.stringify(['images/bunny.png']),
              imageUrl: null,
              selectedIndex: 0,
            },
          ],
        },
      ],
      locations: [
        {
          name: '月亮灯',
          assetKind: 'prop',
          images: [
            {
              imageIndex: 0,
              isSelected: true,
              imageUrl: 'images/moon-lamp.png',
            },
          ],
        },
      ],
    }, {
      characters: JSON.stringify([{ name: '兔兔' }]),
      location: null,
      props: null,
      description: '兔兔举起月亮灯照亮森林小路。',
      videoPrompt: null,
      srtSegment: null,
    })

    expect(refs).toEqual([
      'signed:images/bunny.png',
      'signed:images/moon-lamp.png',
    ])
  })
})
