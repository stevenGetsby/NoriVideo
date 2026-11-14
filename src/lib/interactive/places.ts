import { reachKey } from './achievements'
import type { StoryChapterGraph, StoryEndingType } from './types'

export type StoryPlaceKind = 'ending' | 'segment'

/** One spot of the story a viewer can reach: a segment (scene) or an ending. */
export interface StoryPlace {
  kind: StoryPlaceKind
  projectId: string
  nodeId: string
  /** `reachKey(projectId, nodeId)`, the key the viewer profile records. */
  key: string
  title: string
  chapterTitle: string
  endingType: StoryEndingType | null
  /** The title, prefixed with the chapter title when the story has several chapters. */
  label: string
}

export interface StoryPlaces {
  endings: StoryPlace[]
  segments: StoryPlace[]
}

export const STORY_UNNAMED_SEGMENT = '剧情片段'
export const STORY_UNNAMED_ENDING = '结局'
const UNKNOWN_PLACE: Record<StoryPlaceKind, string> = { ending: '未知结局', segment: '未知片段' }

/** Endings and segments of the given chapters, in chapter and node order. */
export function storyPlaces(chapters: readonly Pick<StoryChapterGraph, 'projectId' | 'title' | 'nodes'>[]): StoryPlaces {
  const several = chapters.length > 1
  const endings: StoryPlace[] = []
  const segments: StoryPlace[] = []
  for (const chapter of chapters) {
    const chapterTitle = chapter.title.trim()
    for (const node of chapter.nodes) {
      if (node.kind !== 'scene' && node.kind !== 'ending') continue
      const isEnding = node.kind === 'ending'
      const title = node.title.trim() || (isEnding ? STORY_UNNAMED_ENDING : STORY_UNNAMED_SEGMENT)
      const place: StoryPlace = {
        kind: isEnding ? 'ending' : 'segment',
        projectId: chapter.projectId,
        nodeId: node.id,
        key: reachKey(chapter.projectId, node.id),
        title,
        chapterTitle,
        endingType: node.kind === 'ending' ? node.endingType : null,
        label: several && chapterTitle ? `${chapterTitle} · ${title}` : title,
      }
      ;(isEnding ? endings : segments).push(place)
    }
  }
  return { endings, segments }
}

export function findPlace(places: StoryPlaces, kind: StoryPlaceKind, projectId: string, nodeId: string): StoryPlace | null {
  const list = kind === 'ending' ? places.endings : places.segments
  return list.find((place) => place.projectId === projectId && place.nodeId === nodeId) ?? null
}

/** A readable name for a place, or a neutral one when the place is not among the known chapters. */
export const placeLabel = (place: StoryPlace | null, kind: StoryPlaceKind): string => place?.label ?? UNKNOWN_PLACE[kind]
