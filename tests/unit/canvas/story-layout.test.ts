import { describe, expect, it } from 'vitest'
import { layoutStoryChapter, nearestFreeSpot, revealOffset, roomAbove, storyDropBox, STORY_NEW_NODE_SIZES } from '@/features/canvas/story/story-layout'
import { newStoryNodeSize } from '@/features/canvas/story/useStoryCanvasActions'

const box = (x: number, y: number, width = 300, height = 200) => ({ x, y, width, height })

describe('nearestFreeSpot', () => {
  it('keeps the requested spot when it is clear', () => {
    expect(nearestFreeSpot(box(0, 0), [box(400, 0)])).toEqual({ x: 0, y: 0 })
  })

  it('slides to the closest clear row in the same column instead of covering a card', () => {
    expect(nearestFreeSpot(box(0, 30), [box(0, 0)])).toEqual({ x: 0, y: 232 })
    expect(nearestFreeSpot(box(0, -150), [box(0, 0)])).toEqual({ x: 0, y: -232 })
    expect(nearestFreeSpot(box(0, 30), [box(0, 0), box(0, 232)])).toEqual({ x: 0, y: -232 })
  })

  it('only searches upward when asked, for pictures placed above their scene', () => {
    expect(nearestFreeSpot(box(0, 30), [box(0, 0)], { upward: true })).toEqual({ x: 0, y: -232 })
  })

  it('puts a copy below its original when above and below are equally close', () => {
    expect(nearestFreeSpot(box(0, 0), [box(0, 0)])).toEqual({ x: 0, y: 232 })
  })
})

describe('roomAbove', () => {
  const scene = { id: 's', ...box(0, 400, 300, 330) }
  const picture = box(0, 128, 300, 200)

  it('leaves the canvas alone when the space above the scene is clear', () => {
    expect(roomAbove(scene, picture, [scene, { id: 'n', ...box(500, 0, 300, 330) }])).toEqual({ shift: 0, moved: [] })
  })

  it('pushes the scene and the cards stacked below it down instead of sending the picture far away', () => {
    const cards = [{ id: 'a', ...box(0, 0, 300, 330) }, scene, { id: 'b', ...box(0, 800, 300, 330) }, { id: 'n', ...box(500, 400, 300, 330) }]
    expect(roomAbove(scene, picture, cards)).toEqual({ shift: 234, moved: ['s', 'b'] })
  })
})

describe('storyDropBox', () => {
  const size = { width: 300, height: 330 }
  it('puts the side that the wire connects to on the drop point', () => {
    expect(storyDropBox('forward', { x: 600, y: 100 }, size)).toEqual({ box: { x: 600, y: 78, ...size }, upward: false })
    expect(storyDropBox('backward', { x: 600, y: 100 }, size)).toEqual({ box: { x: 300, y: 78, ...size }, upward: false })
    expect(storyDropBox('media', { x: 600, y: 100 }, size)).toEqual({ box: { x: 450, y: 100, ...size }, upward: false })
    expect(storyDropBox('media-pick', { x: 600, y: 100 }, size)).toEqual({ box: { x: 450, y: -230, ...size }, upward: true })
  })
})

describe('revealOffset', () => {
  const pane = { width: 1200, height: 800 }
  it('does not pan when the new card is already visible', () => {
    expect(revealOffset(box(200, 200), { x: 0, y: 0, zoom: 1 }, pane)).toEqual({ x: 0, y: 0 })
  })

  it('pans just enough to bring an off-screen card inside the margins', () => {
    expect(revealOffset(box(1000, 200), { x: 0, y: 0, zoom: 1 }, pane)).toEqual({ x: -172, y: 0 })
    expect(revealOffset(box(200, 650), { x: 0, y: 0, zoom: 1 }, pane)).toEqual({ x: 0, y: -146 })
    expect(revealOffset(box(-100, 200), { x: 0, y: 0, zoom: 0.5 }, pane)).toEqual({ x: 122, y: 0 })
  })
})

describe('layoutStoryChapter', () => {
  const sized = (id: string, type: string, x: number, y: number, data: Record<string, unknown> = {}, width = 300, height = 200) => ({ id, type, data, position: { x, y }, width, height })
  const flow = (source: string, target: string, sourceHandle = 'output') => ({ source, target, sourceHandle, data: { role: 'STORY_FLOW' } })
  const options = [{ id: 'o1', label: 'A', effects: [] }, { id: 'o2', label: 'B', effects: [] }]

  it('lays the story out left to right with options stacked in order and pictures above their scene', () => {
    const nodes = [
      sized('s3', 'story_scene', 50, 900),
      sized('e', 'story_entry', 0, 0, {}, 240, 100),
      sized('c', 'story_choice', 700, 400, { options }),
      sized('s2', 'story_scene', 40, 600),
      sized('s1', 'story_scene', 900, 20),
      sized('v', 'video', 2000, 2000, {}, 300, 160),
      sized('note', 'text', -500, -500),
    ]
    const edges = [flow('e', 's1'), flow('s1', 'c'), flow('c', 's3', 'o2'), flow('c', 's2', 'o1'), { source: 'v', target: 's1', sourceHandle: 'output', data: {} }]
    const positions = layoutStoryChapter(nodes, edges)
    const at = (id: string) => positions.get(id)!
    expect(at('e').x).toBeLessThan(at('s1').x)
    expect(at('s1').x).toBeLessThan(at('c').x)
    expect(at('s2').x).toBe(at('s3').x)
    expect(at('s2').y).toBeLessThan(at('s3').y)
    expect(at('s3').y - at('s2').y).toBeGreaterThanOrEqual(200)
    expect(at('v')).toEqual({ x: at('s1').x, y: at('s1').y - 160 - 56 })
    expect(at('c').y).toBe(at('s1').y)
    expect(positions.has('note')).toBe(false)
  })

  it('survives loops and leaves canvases without story nodes alone', () => {
    const nodes = [sized('e', 'story_entry', 0, 0), sized('a', 'story_scene', 400, 0), sized('b', 'story_scene', 800, 0)]
    const positions = layoutStoryChapter(nodes, [flow('e', 'a'), flow('a', 'b'), flow('b', 'a')])
    expect(positions.get('a')!.x).toBeLessThan(positions.get('b')!.x)
    expect(layoutStoryChapter([sized('t', 'text', 0, 0)], []).size).toBe(0)
  })
})

describe('new story card sizes', () => {
  it('uses the measured story card sizes and falls back for other nodes', () => {
    expect(newStoryNodeSize('story_scene')).toEqual(STORY_NEW_NODE_SIZES.story_scene)
    expect(newStoryNodeSize('unknown-type')).toEqual({ width: 300, height: 200 })
  })
})
