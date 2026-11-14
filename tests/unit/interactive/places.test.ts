import { describe, expect, it } from 'vitest'
import { findPlace, placeLabel, storyPlaces } from '@/lib/interactive/places'
import { compileChapter } from '@/lib/interactive/compile'
import { ending, entry, flow, scene } from './economy-fixture'
import { storyEdges, storyNodes } from './p3-fixture'

const chapter = compileChapter({ projectId: 'p', title: '第一章' }, storyNodes, storyEdges)

describe('storyPlaces', () => {
  it('lists the segments and endings of one chapter in node order, without chapter prefixes', () => {
    const { segments, endings } = storyPlaces([chapter])
    expect(segments.map((place) => [place.nodeId, place.label, place.kind])).toEqual([
      ['s1', 's1', 'segment'],
      ['s2', 's2', 'segment'],
    ])
    expect(endings.map((place) => [place.nodeId, place.endingType, place.key])).toEqual([
      ['goodend', 'good', 'p:goodend'],
      ['badend', 'bad', 'p:badend'],
    ])
    expect(segments[0]).toMatchObject({ projectId: 'p', chapterTitle: '第一章', endingType: null, key: 'p:s1' })
  })

  it('prefixes the chapter title once the story has several chapters', () => {
    const second = compileChapter(
      { projectId: 'q', title: '第二章' },
      [entry, scene('x1'), ending('end2', 'normal')],
      [flow('g1', 'in', 'x1'), flow('g2', 'x1', 'end2')],
    )
    const { segments, endings } = storyPlaces([chapter, second])
    expect(segments.map((place) => place.label)).toEqual(['第一章 · s1', '第一章 · s2', '第二章 · x1'])
    expect(endings.map((place) => place.label)).toEqual(['第一章 · goodend', '第一章 · badend', '第二章 · end2'])
    expect(findPlace({ segments, endings }, 'ending', 'q', 'end2')?.endingType).toBe('normal')
  })

  it('names untitled nodes and skips every other node kind', () => {
    const blank = {
      projectId: 'p',
      title: '  ',
      nodes: [
        { kind: 'entry', id: 'in', title: '' },
        { kind: 'scene', id: 's1', title: '  ', lines: '', media: null, effects: [], beats: [] },
        { kind: 'ending', id: 'e1', title: '', endingType: 'good', description: '' },
      ],
      flows: [],
    } satisfies Parameters<typeof storyPlaces>[0][number] & { flows: unknown[] }
    const { segments, endings } = storyPlaces([blank])
    expect(segments.map((place) => place.label)).toEqual(['剧情片段'])
    expect(endings.map((place) => place.label)).toEqual(['结局'])
    expect(storyPlaces([])).toEqual({ endings: [], segments: [] })
  })

  it('finds a place only by kind, chapter and node, and names an unknown one neutrally', () => {
    const places = storyPlaces([chapter])
    expect(findPlace(places, 'ending', 'p', 'goodend')?.label).toBe('goodend')
    expect(findPlace(places, 'segment', 'p', 'goodend')).toBeNull()
    expect(findPlace(places, 'ending', 'other', 'goodend')).toBeNull()
    expect(placeLabel(findPlace(places, 'ending', 'p', 'gone'), 'ending')).toBe('未知结局')
    expect(placeLabel(null, 'segment')).toBe('未知片段')
    expect(placeLabel(findPlace(places, 'segment', 'p', 's1'), 'segment')).toBe('s1')
  })
})
