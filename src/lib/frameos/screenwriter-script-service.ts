import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import {
  REPAINT_DOCUMENTS_LAYOUT,
  REPAINT_OUTLINE_TITLE,
  REPAINT_SCRIPT_TITLE,
  REPAINT_STORYBOARD_TITLE,
  repaintOutlineDocId,
  repaintScriptDocId,
  repaintStoryboardDocId,
} from '@/lib/video-repaint/contract'

export const FRAMEOS_SCRIPT_STATUSES = ['draft', 'available', 'archived'] as const
export type FrameosScriptStatus = typeof FRAMEOS_SCRIPT_STATUSES[number]

export interface FrameosWriterEpisode {
  id: string
  title: string
  body: string
}

/** Version 2 keeps each generated document separately; 分镜 may be empty because it is optional. */
interface FrameosVideoRepaintSections {
  version: 2
  kind: 'video-repaint'
  layout: typeof REPAINT_DOCUMENTS_LAYOUT
  episodes: FrameosWriterEpisode[]
  sourceScript: string
  adaptationBrief: string
  adaptationContract?: unknown
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
  const layout = sections?.layout === REPAINT_DOCUMENTS_LAYOUT ? REPAINT_DOCUMENTS_LAYOUT : undefined
  return {
    id: script.id,
    title: script.title,
    type: '视频转绘',
    status: normalizeFrameosScriptStatus(script.status),
    createdAt: script.createdAt.toISOString(),
    updatedAt: script.updatedAt.toISOString(),
    episodes: readEpisodes(sections, script.content, script.id),
    ...(layout ? { layout } : {}),
    ...(sourceFileName ? { lineage: sourceFileName } : {}),
  }
}

/**
 * Target script and outline are the primary documents. An empty optional storyboard document is retained so it
 * can be generated or edited later without changing the saved script's layout.
 */
export function buildVideoRepaintSections(input: {
  scriptId: string
  outline?: string
  targetScript?: string
  storyboard?: string
  sourceScript?: string
  adaptationBrief?: string
  adaptationContract?: unknown
  model?: string
  sourceFileName?: string
}): FrameosVideoRepaintSections {
  return {
    version: 2,
    kind: 'video-repaint',
    layout: REPAINT_DOCUMENTS_LAYOUT,
    episodes: [
      { id: repaintScriptDocId(input.scriptId), title: REPAINT_SCRIPT_TITLE, body: cleanText(input.targetScript) },
      { id: repaintOutlineDocId(input.scriptId), title: REPAINT_OUTLINE_TITLE, body: cleanText(input.outline) },
      { id: repaintStoryboardDocId(input.scriptId), title: REPAINT_STORYBOARD_TITLE, body: cleanText(input.storyboard) },
    ],
    sourceScript: cleanText(input.sourceScript),
    adaptationBrief: input.adaptationBrief || '',
    adaptationContract: input.adaptationContract,
    model: input.model || '',
    sourceFileName: input.sourceFileName || '',
  }
}

/** The `content` column of a saved script: the document bodies in order, the way the editor joins them on every save. */
export function joinDocumentBodies(documents: readonly FrameosWriterEpisode[]): string {
  return documents.map((document) => document.body).filter(Boolean).join('\n\n')
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
