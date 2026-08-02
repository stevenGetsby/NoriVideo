import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

export const FRAMEOS_SCRIPT_STATUSES = ['draft', 'available', 'archived'] as const
export type FrameosScriptStatus = typeof FRAMEOS_SCRIPT_STATUSES[number]

export interface FrameosWriterEpisode {
  id: string
  title: string
  body: string
}

interface FrameosVideoRepaintSections {
  version: 1
  kind: 'video-repaint'
  episodes: FrameosWriterEpisode[]
  sourceScript: string
  sourceStoryboard: string
  adaptationBrief: string
  adaptationContract?: unknown
  resultMode: 'llm' | 'source_copy'
  model: string
  sourceFileName: string
}

type StoredFrameosScript = {
  id: string
  title: string
  content: string
  status: string
  sections: unknown
  createdAt: Date
  updatedAt: Date
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readEpisodes(value: unknown, fallback: string, scriptId: string): FrameosWriterEpisode[] {
  if (!isRecord(value) || !Array.isArray(value.episodes)) {
    return [{ id: `${scriptId}-ep-1`, title: '第 1 集', body: fallback }]
  }
  const episodes = value.episodes.flatMap((item, index) => {
    if (!isRecord(item)) return []
    return [{
      id: cleanText(item.id) || `${scriptId}-ep-${index + 1}`,
      title: cleanText(item.title) || `第 ${index + 1} 集`,
      body: typeof item.body === 'string' ? item.body : '',
    }]
  })
  return episodes.length ? episodes : [{ id: `${scriptId}-ep-1`, title: '第 1 集', body: fallback }]
}

export function normalizeFrameosScriptStatus(value: unknown): FrameosScriptStatus {
  return FRAMEOS_SCRIPT_STATUSES.includes(value as FrameosScriptStatus)
    ? value as FrameosScriptStatus
    : 'draft'
}

export function toWriterScript(script: StoredFrameosScript) {
  const sections = isRecord(script.sections) ? script.sections : null
  const sourceFileName = cleanText(sections?.sourceFileName)
  return {
    id: script.id,
    title: script.title,
    type: '视频转绘',
    status: normalizeFrameosScriptStatus(script.status),
    createdAt: script.createdAt.toISOString(),
    updatedAt: script.updatedAt.toISOString(),
    episodes: readEpisodes(sections, script.content, script.id),
    ...(sourceFileName ? { lineage: sourceFileName } : {}),
  }
}

export function buildVideoRepaintSections(input: {
  scriptId: string
  targetScript: string
  sourceScript: string
  sourceStoryboard?: string
  adaptationBrief?: string
  adaptationContract?: unknown
  resultMode: 'llm' | 'source_copy'
  model?: string
  sourceFileName?: string
  episodeTitle?: string
}): FrameosVideoRepaintSections {
  return {
    version: 1,
    kind: 'video-repaint',
    episodes: [{
      id: `${input.scriptId}-ep-1`,
      title: cleanText(input.episodeTitle) || '第 1 集',
      body: input.targetScript,
    }],
    sourceScript: input.sourceScript,
    sourceStoryboard: input.sourceStoryboard || '',
    adaptationBrief: input.adaptationBrief || '',
    adaptationContract: input.adaptationContract,
    resultMode: input.resultMode,
    model: input.model || '',
    sourceFileName: input.sourceFileName || '',
  }
}

export async function listFrameosScriptsForAccount(actorUserId: string) {
  const scripts = await prisma.frameosScript.findMany({
    where: { userId: actorUserId },
    orderBy: { updatedAt: 'desc' },
  })
  return scripts.map(toWriterScript)
}

export function toPrismaSections(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}
