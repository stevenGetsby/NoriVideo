import {
  ensureStorySequence,
  resolveSequenceSegments,
  sequenceStats,
  linearCutSegments,
  branchSequenceSegments,
  removedSequenceSegments,
  orphanSequenceSegments,
  type ResolvedSequenceSegment,
  type SequenceStats,
  type WorkSequenceChapter,
} from '@/lib/interactive/sequence'
import type { StorySequence } from '@/lib/interactive/types'
import type { StoryOverviewData } from './story-overview-model'

export function workChapters(data: StoryOverviewData): WorkSequenceChapter[] {
  return data.chapters.map((chapter) => ({
    projectId: chapter.projectId,
    name: chapter.name,
    canvasId: chapter.canvasId,
    graph: chapter.graph,
  }))
}

/** Server responses already carry a sequence; this also upgrades older snapshots and fixtures. */
export function ensuredWorkSequence(data: StoryOverviewData): StorySequence {
  return ensureStorySequence(data.story.config, data.chapters.map((chapter) => chapter.graph), data.story.config.sequence)
}

export function resolvedWorkSegments(data: StoryOverviewData): ResolvedSequenceSegment[] {
  return resolveSequenceSegments(ensuredWorkSequence(data), workChapters(data))
}

export type WorkSequenceGroups = {
  items: ResolvedSequenceSegment[]
  cut: ResolvedSequenceSegment[]
  branch: ResolvedSequenceSegment[]
  removed: ResolvedSequenceSegment[]
  orphans: ResolvedSequenceSegment[]
  stats: SequenceStats
}

export function workSequenceGroups(data: StoryOverviewData): WorkSequenceGroups {
  const items = resolvedWorkSegments(data)
  return {
    items,
    cut: linearCutSegments(items),
    branch: branchSequenceSegments(items).filter((item) => item.segment.branch && item.orphan === null),
    removed: removedSequenceSegments(items),
    orphans: orphanSequenceSegments(items),
    stats: sequenceStats(items),
  }
}

export function withWorkSequence(data: StoryOverviewData, sequence: StorySequence): StoryOverviewData {
  return { ...data, story: { ...data.story, config: { ...data.story.config, sequence } } }
}
