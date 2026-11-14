import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { isFreshStory, isFreshStoryChapter } from '@/lib/interactive/validate'
import type { StoryChapterGraph, StorySceneNode } from '@/lib/interactive/types'

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8')
}

const entry = { id: 'entry', title: '开场', kind: 'entry' as const }
const scene: StorySceneNode = { id: 'scene', title: '场景', kind: 'scene', lines: '', media: null, effects: [], beats: [] }

function chapter(
  nodes: StoryChapterGraph['nodes'],
  flows: StoryChapterGraph['flows'] = [],
): Pick<StoryChapterGraph, 'nodes' | 'flows'> {
  return { nodes, flows }
}

describe('fresh story chapters use the neutral next-step state', () => {
  it('treats an untouched chapter and story as fresh, and any content as real', () => {
    expect(isFreshStoryChapter(chapter([entry]))).toBe(true)
    expect(isFreshStoryChapter(chapter([entry, { ...entry, id: 'entry-2' }]))).toBe(true)

    expect(isFreshStoryChapter(chapter([entry, scene]))).toBe(false)
    expect(isFreshStoryChapter(chapter([entry], [{ id: 'flow', from: 'entry', handle: 'output', to: 'entry-2' }]))).toBe(false)

    expect(isFreshStory([])).toBe(false)
    expect(isFreshStory([chapter([entry]), chapter([entry])])).toBe(true)
    expect(isFreshStory([chapter([entry]), chapter([entry, scene])])).toBe(false)
  })

  it('keeps the overview and canvas bar neutral until the user adds content or trials the story', () => {
    const side = readSource('src/features/interactive/StoryOverviewSide.tsx')
    const overlay = readSource('src/features/canvas/story/StoryCanvasOverlay.tsx')
    const styles = readSource('src/features/interactive/interactive.css')
    const canvasStyles = readSource('src/features/canvas/story/story-canvas.css')

    expect(side).toContain('isFreshStory(chapterGraphs)')
    expect(side).toContain("nextSteps ? 'is-next'")
    expect(side).toContain('className="nori-ix-next"')
    expect(styles).toContain('.nori-ix-checks-summary.is-next')

    expect(overlay).toContain('isFreshStoryChapter(chapter) && !trialled')
    expect(overlay).toContain('setTrialled(true)')
    expect(overlay).toContain("nextSteps ? 'is-next'")
    expect(overlay).toContain('className="nori-story-next"')
    expect(canvasStyles).toContain('.nori-story-bar button.is-next')
  })
})

describe('story headers use the generated cover placeholder', () => {
  it('renders the overview cover with the same generated palette as work covers', () => {
    const overview = readSource('src/features/interactive/StoryOverview.tsx')
    const css = readSource('src/features/interactive/interactive.css')

    expect(overview).toContain("import { coverMonogram, generativeCoverStyle } from '@/lib/ui/generative-cover'")
    expect(overview).toContain('className="nori-ix-ov-cover nori-gen-cover"')
    expect(overview).toContain('style={generativeCoverStyle(story.workId)')
    expect(overview).toContain('<b>{coverMonogram(story.name)}</b>')

    expect(css).toContain('.nori-gen-cover {')
    expect(css).toContain('radial-gradient(ellipse at var(--cover-x1')
    expect(css).toContain('.nori-gen-cover::before')
    expect(css).toContain('mask-image: linear-gradient(125deg')
  })
})
