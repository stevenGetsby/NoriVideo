import { coverMonogram } from '@/lib/ui/generative-cover'
import type {
  InteractiveStoryConfig,
  StoryAspectRatio,
  StoryChapterGraph,
  StoryChapterStatus,
  StoryLink,
  StoryProgram,
  StoryResolution,
} from '@/lib/interactive/types'

export type OverviewChapter = {
  projectId: string
  name: string
  canvasId: string | null
  nodeCount: number
  runningCount: number
  updatedAt: string
  graph: StoryChapterGraph
}

export type OverviewStory = {
  workId: string
  name: string
  aspectRatio: StoryAspectRatio
  resolution: StoryResolution
  canManage: boolean
  canCreateChapters: boolean
  config: InteractiveStoryConfig
}

export type StoryOverviewData = { story: OverviewStory; chapters: OverviewChapter[] }

export const CHAPTER_STATUS_LABEL: Record<StoryChapterStatus, string> = {
  drafting: '草稿中',
  generating: '生成中',
  review: '待审',
  final: '定稿',
}

const CHAPTER_PREFIX = /^第\s*[0-9零一二三四五六七八九十百千两]+\s*[章集幕回话]\s*[·・:：|｜\-—\s]*/

export function chapterMonogram(name: string): string {
  return coverMonogram(name.trim().replace(CHAPTER_PREFIX, '') || name)
}

export const ENTRY_HANDLE_PREFIX = 'entry:'
export const EXIT_HANDLE_PREFIX = 'exit:'

export function buildStoryProgram(data: StoryOverviewData): StoryProgram {
  const { config } = data.story
  return { variables: config.variables, chapters: data.chapters.map((chapter) => chapter.graph), links: config.links, start: config.start }
}

/** Ordered chapters joined with their stored map metadata. */
export function orderedChapters(data: StoryOverviewData) {
  const byId = new Map(data.chapters.map((chapter) => [chapter.projectId, chapter]))
  return data.story.config.chapters.flatMap((meta) => {
    const chapter = byId.get(meta.projectId)
    return chapter ? [{ meta, chapter }] : []
  })
}

export type ChapterConnection = { source: string | null; sourceHandle?: string | null; target: string | null; targetHandle?: string | null }

/** Turns a map wire into an exit → entry link, accepting drags that start on either end. */
export function readChapterConnection(connection: ChapterConnection): Omit<StoryLink, 'id'> | null {
  const ends = [
    { node: connection.source, handle: connection.sourceHandle ?? '' },
    { node: connection.target, handle: connection.targetHandle ?? '' },
  ]
  const exit = ends.find((end) => end.handle.startsWith(EXIT_HANDLE_PREFIX))
  const entry = ends.find((end) => end.handle.startsWith(ENTRY_HANDLE_PREFIX))
  if (!exit?.node || !entry?.node) return null
  return {
    fromProjectId: exit.node,
    exitNodeId: exit.handle.slice(EXIT_HANDLE_PREFIX.length),
    toProjectId: entry.node,
    toEntryNodeId: entry.handle.slice(ENTRY_HANDLE_PREFIX.length),
  }
}

/** Each exit leads to exactly one entry, so a new wire replaces the exit's previous link. */
export function connectChapters(links: StoryLink[], link: Omit<StoryLink, 'id'>, id: string): StoryLink[] | null {
  const sameExit = (item: StoryLink) => item.fromProjectId === link.fromProjectId && item.exitNodeId === link.exitNodeId
  const existing = links.find(sameExit)
  if (existing && existing.toProjectId === link.toProjectId && existing.toEntryNodeId === link.toEntryNodeId) return null
  return [...links.filter((item) => !sameExit(item)), { id, ...link }]
}

export function withConfig(data: StoryOverviewData, patch: Partial<InteractiveStoryConfig>): StoryOverviewData {
  return { ...data, story: { ...data.story, config: { ...data.story.config, ...patch } } }
}
