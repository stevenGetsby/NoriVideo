import { describe, expect, it } from 'vitest'
import {
  buildStoryProgram,
  chapterMonogram,
  connectChapters,
  orderedChapters,
  readChapterConnection,
  withConfig,
  type StoryOverviewData,
} from '@/features/interactive/story-overview-model'
import type { StoryLink } from '@/lib/interactive/types'

const chapter = (projectId: string) => ({
  projectId,
  name: projectId,
  canvasId: `c-${projectId}`,
  nodeCount: 0,
  runningCount: 0,
  updatedAt: '2026-10-28T00:00:00.000Z',
  graph: { projectId, title: projectId, nodes: [], flows: [] },
})

const data: StoryOverviewData = {
  story: {
    workId: 'w1',
    name: '雨夜来电',
    aspectRatio: '9:16',
    resolution: '1080p',
    canManage: true,
    canCreateChapters: true,
    config: {
      version: 1,
      variables: [{ id: 'v1', name: '勇气', type: 'number', initial: 0 }],
      chapters: [
        { projectId: 'p2', order: 0, position: { x: 0, y: 0 }, status: 'drafting' },
        { projectId: 'p1', order: 1, position: { x: 340, y: 0 }, status: 'final' },
      ],
      links: [],
      start: { projectId: 'p2', entryNodeId: 'e1' },
    },
  },
  chapters: [chapter('p1'), chapter('p2')],
}

describe('story overview model', () => {
  it('skips the 第N章 prefix when picking a chapter monogram', () => {
    expect(chapterMonogram('第二章 · 旧公寓')).toBe('旧')
    expect(chapterMonogram('第 12 集：Neon')).toBe('N')
    expect(chapterMonogram('番外 · 天台')).toBe('番')
    expect(chapterMonogram('第三章')).toBe('第')
  })

  it('reads exit → entry wires from either drag direction', () => {
    const expected = { fromProjectId: 'p1', exitNodeId: 'x1', toProjectId: 'p2', toEntryNodeId: 'e2' }
    expect(readChapterConnection({ source: 'p1', sourceHandle: 'exit:x1', target: 'p2', targetHandle: 'entry:e2' })).toEqual(expected)
    expect(readChapterConnection({ source: 'p2', sourceHandle: 'entry:e2', target: 'p1', targetHandle: 'exit:x1' })).toEqual(expected)
    expect(readChapterConnection({ source: 'p1', sourceHandle: 'exit:x1', target: 'p2', targetHandle: 'exit:x2' })).toBeNull()
    expect(readChapterConnection({ source: 'p1', sourceHandle: null, target: 'p2', targetHandle: 'entry:e2' })).toBeNull()
  })

  it('gives every exit a single next chapter and ignores repeated wires', () => {
    const links: StoryLink[] = [
      { id: 'a', fromProjectId: 'p1', exitNodeId: 'x1', toProjectId: 'p2', toEntryNodeId: 'e1' },
      { id: 'b', fromProjectId: 'p1', exitNodeId: 'x2', toProjectId: 'p2', toEntryNodeId: 'e1' },
    ]
    const rewired = connectChapters(links, { fromProjectId: 'p1', exitNodeId: 'x1', toProjectId: 'p3', toEntryNodeId: 'e3' }, 'c')
    expect(rewired?.map((link) => [link.id, link.toProjectId])).toEqual([['b', 'p2'], ['c', 'p3']])
    expect(connectChapters(links, { fromProjectId: 'p1', exitNodeId: 'x1', toProjectId: 'p2', toEntryNodeId: 'e1' }, 'd')).toBeNull()
  })

  it('orders chapters by the stored map and builds the full-story program', () => {
    expect(orderedChapters(data).map(({ chapter: item }) => item.projectId)).toEqual(['p2', 'p1'])
    const program = buildStoryProgram(data)
    expect(program.start).toEqual({ projectId: 'p2', entryNodeId: 'e1' })
    expect(program.variables).toHaveLength(1)
    expect(program.chapters.map((item) => item.projectId)).toEqual(['p1', 'p2'])
    const moved = withConfig(data, { start: null })
    expect(moved.story.config.start).toBeNull()
    expect(moved.story.config.variables).toBe(data.story.config.variables)
  })
})
