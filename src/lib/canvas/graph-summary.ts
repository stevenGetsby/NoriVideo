import type { CanvasGenerationHistoryItem, CanvasHistorySummaryItemV1, CanvasNode, CanvasNodeData, CanvasNodeSummaryV1, CanvasPlaylistItem } from '@/features/canvas/types'
import { createCanvasNodeDetailVersion, getCanvasCurrentCostLabel } from '@/features/canvas/types'

export const CANVAS_SUMMARY_VIEW = 'summary-v1'
export const CANVAS_DETAIL_VIEW = 'detail-v1'
export const CANVAS_HISTORY_VIEW = 'history-v1'
export const CANVAS_HISTORY_ITEM_VIEW = 'history-item-v1'
export const CANVAS_HISTORY_DEFAULT_LIMIT = 20
export const CANVAS_HISTORY_MAX_LIMIT = 40
export const CANVAS_HISTORY_SUMMARY_MAX_PROMPT = 160
export const CANVAS_HISTORY_SUMMARY_MAX_TEXT = 160

const SUMMARY_MAX_TEXT_PREVIEW = 160
const SUMMARY_MAX_TITLE = 191
const SUMMARY_MAX_ERROR = 400
const SUMMARY_MAX_REFERENCES = 16
const SUMMARY_MAX_PLAYLIST_ITEMS = 80
const SUMMARY_MAX_VIDEO_KEYFRAMES = 400
const CARD_SCALAR_DATA_KEYS = [
  'mediaType', 'origin', 'processType', 'materialId', 'contentUrl', 'posterUrl', 'audioUrl', 'modelUrl',
  'imageUrl', 'videoUrl', 'isFavorited', 'globalStylePrompt', 'videoPrefixPrompt', 'voiceDetached',
  'progress', 'cgtid', 'errorMessage', 'pollErrorMessage', 'memberIds', 'groupColor', 'sourceType',
  'sourceId', 'subtitle', 'description', 'statusLabel', 'episodeNumber', 'panelIndex', 'hasImage',
  'hasVideo', 'stats',
] as const
export const CANVAS_CARD_SOURCE_KEYS = [
  ...CARD_SCALAR_DATA_KEYS, 'title', 'text', 'generation', 'generationTask', 'videoEdit',
  'videoKeyframes', 'playlistItems', 'studioSummary', '__studioDocumentSource',
] as const

type SummaryRecord = Record<string, unknown>

function record(value: unknown): SummaryRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as SummaryRecord : null
}

function boundedText(value: unknown, max: number): string | null | undefined {
  if (typeof value !== 'string') return null
  return value.length > max ? value.slice(0, max) : value
}

function boundedId(value: unknown): string | null | undefined {
  return typeof value === 'string' && value.length <= 191 ? value : null
}

function finiteNumber(value: unknown): number | null | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function boundedStringArray(value: unknown, max = 64): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.slice(0, max).filter((item): item is string => typeof item === 'string' && item.length <= 191)
}

function pickScalar(value: unknown): string | number | boolean | null | undefined {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null
    ? value as string | number | boolean | null
    : undefined
}

function copyDefined(target: SummaryRecord, key: string, value: unknown) {
  if (value !== undefined) target[key] = value
}

function summarizeGeneration(value: unknown): SummaryRecord | undefined {
  const generation = record(value)
  if (!generation) return undefined
  const output: SummaryRecord = {}
  for (const key of ['modelKey', 'modelLabel', 'assetId', 'taskId', 'inputMode', 'aspectRatio', 'resolution', 'quality'] as const) {
    copyDefined(output, key, boundedId(generation[key]))
  }
  for (const key of ['duration', 'count'] as const) copyDefined(output, key, finiteNumber(generation[key]))
  copyDefined(output, 'generateAudio', typeof generation.generateAudio === 'boolean' ? generation.generateAudio : undefined)
  copyDefined(output, 'referenceNodeIds', boundedStringArray(generation.referenceNodeIds))
  const references = Array.isArray(generation.referenceSummary)
    ? generation.referenceSummary.slice(0, SUMMARY_MAX_REFERENCES).map((entry) => {
      const reference = record(entry)
      if (!reference) return null
      const summary: SummaryRecord = {}
      for (const key of ['id', 'title', 'type', 'role', 'previewUrl', 'url', 'materialId'] as const) {
        copyDefined(summary, key, boundedText(reference[key], SUMMARY_MAX_TITLE))
      }
      copyDefined(summary, 'durationSeconds', finiteNumber(reference.durationSeconds))
      return summary
    }).filter(Boolean)
    : undefined
  copyDefined(output, 'referenceSummary', references)
  // Parameters stay scalar-only: card controls need model toggles, not prompt/reference payloads.
  const parameters = record(generation.parameters)
  if (parameters) {
    const scalarParameters: SummaryRecord = {}
    for (const [key, item] of Object.entries(parameters)) {
      if (key === 'prompt' || key === 'references' || key === 'inputImages') continue
      copyDefined(scalarParameters, key, pickScalar(item))
    }
    output.parameters = scalarParameters
  }
  return output
}

function summarizeGenerationTask(value: unknown): SummaryRecord | undefined {
  const task = record(value)
  if (!task) return undefined
  const output: SummaryRecord = {}
  copyDefined(output, 'kind', boundedId(task.kind))
  copyDefined(output, 'taskId', boundedId(task.taskId))
  copyDefined(output, 'retryOf', boundedId(task.retryOf))
  copyDefined(output, 'submittedAt', boundedId(task.submittedAt))
  copyDefined(output, 'completed', typeof task.completed === 'boolean' ? task.completed : undefined)
  return output
}

function summarizeVideoEdit(value: unknown): SummaryRecord | undefined {
  const edit = record(value)
  if (!edit) return undefined
  const output: SummaryRecord = {}
  copyDefined(output, 'sourceKind', boundedId(edit.sourceKind))
  for (const key of ['sourceNodeId', 'materialId'] as const) copyDefined(output, key, boundedId(edit[key]))
  for (const key of ['startMs', 'endMs'] as const) copyDefined(output, key, finiteNumber(edit[key]))
  copyDefined(output, 'generateAudio', typeof edit.generateAudio === 'boolean' ? edit.generateAudio : undefined)
  const references = Array.isArray(edit.references)
    ? edit.references.slice(0, SUMMARY_MAX_REFERENCES).map((entry) => {
      const reference = record(entry)
      if (!reference) return null
      const summary: SummaryRecord = {}
      for (const key of ['id', 'title', 'type', 'role', 'previewUrl', 'url', 'materialId'] as const) {
        copyDefined(summary, key, boundedText(reference[key], SUMMARY_MAX_TITLE))
      }
      copyDefined(summary, 'durationSeconds', finiteNumber(reference.durationSeconds))
      return summary
    }).filter(Boolean)
    : undefined
  copyDefined(output, 'references', references)
  return output
}

function summarizePlaylistItems(value: unknown): CanvasPlaylistItem[] | undefined {
  if (!Array.isArray(value)) return undefined
  const items: CanvasPlaylistItem[] = []
  for (const entry of value.slice(0, SUMMARY_MAX_PLAYLIST_ITEMS)) {
    const item = record(entry)
    const id = boundedId(item?.id)
    const title = boundedText(item?.title, SUMMARY_MAX_TITLE)
    const sourceInMs = finiteNumber(item?.sourceInMs)
    if (!id || typeof title !== 'string' || typeof sourceInMs !== 'number') continue
    items.push({
      id,
      title,
      sourceInMs,
      sourceNodeId: boundedId(item?.sourceNodeId) ?? null,
      materialId: boundedId(item?.materialId) ?? null,
      videoUrl: boundedText(item?.videoUrl, 2048) ?? null,
      posterUrl: boundedText(item?.posterUrl, 2048) ?? null,
      sourceOutMs: finiteNumber(item?.sourceOutMs) ?? null,
      durationMs: finiteNumber(item?.durationMs) ?? null,
    })
  }
  return items
}

function summarizeVideoKeyframes(value: unknown) {
  if (!Array.isArray(value)) return undefined
  return value.slice(0, SUMMARY_MAX_VIDEO_KEYFRAMES).flatMap((entry) => {
    const keyframe = record(entry)
    const id = boundedId(keyframe?.id)
    const time = finiteNumber(keyframe?.time)
    return id && typeof time === 'number' && (keyframe?.kind === 'manual' || keyframe?.kind === 'shot')
      ? [{ id, time, kind: keyframe.kind }]
      : []
  })
}

function historyEntries(data: CanvasNodeData): CanvasGenerationHistoryItem[] {
  return Array.isArray(data.history) ? data.history.filter((entry): entry is CanvasGenerationHistoryItem => Boolean(record(entry))) : []
}

/** Stable newest-first order shared by paging and history expansion. */
export function sortCanvasHistoryForV1(history: CanvasGenerationHistoryItem[]): CanvasGenerationHistoryItem[] {
  return [...history].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
}

export function summarizeCanvasHistoryItemV1(item: CanvasGenerationHistoryItem): CanvasHistorySummaryItemV1 {
  const { prompt, text, references, parameters, ...rest } = item
  return {
    ...rest,
    ...(typeof prompt === 'string' ? { prompt: boundedText(prompt, CANVAS_HISTORY_SUMMARY_MAX_PROMPT) } : {}),
    ...(typeof text === 'string' ? { text: boundedText(text, CANVAS_HISTORY_SUMMARY_MAX_TEXT) } : {}),
    ...(Array.isArray(references) ? { referenceCount: references.length } : {}),
    ...(parameters ? {
      parameters: Object.fromEntries(Object.entries(parameters).filter(([, value]) => (
        value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
      ))),
    } : {}),
  }
}

export function pageCanvasHistoryV1(
  history: CanvasGenerationHistoryItem[] | undefined,
  { limit = CANVAS_HISTORY_DEFAULT_LIMIT, cursor }: { limit?: number; cursor?: string | null } = {},
): { items: CanvasGenerationHistoryItem[]; nextCursor: string | null } {
  const boundedLimit = Math.max(1, Math.min(CANVAS_HISTORY_MAX_LIMIT, Math.floor(limit)))
  const ordered = sortCanvasHistoryForV1(historyEntries({ history }))
  const start = cursor ? ordered.findIndex((item) => item.id === cursor) + 1 : 0
  if (cursor && start === 0) return { items: [], nextCursor: null }
  const items = ordered.slice(start, start + boundedLimit)
  return { items, nextCursor: start + items.length < ordered.length ? items.at(-1)?.id ?? null : null }
}

/**
 * Projects a full, sanitized node into its card representation. Unknown extension fields are
 * deliberately omitted instead of copied: this is the boundary that keeps old payloads small.
 */
export function projectCanvasNodeCardData(data: CanvasNode['data']): CanvasNodeData {
  const source = (record(data) as CanvasNodeData | null) ?? {}
  const summary: CanvasNodeData = {}
  for (const key of CARD_SCALAR_DATA_KEYS) {
    const value = source[key]
    if (key === 'memberIds') copyDefined(summary, key, boundedStringArray(value))
    else if (key === 'progress' || key === 'episodeNumber' || key === 'panelIndex') copyDefined(summary, key, finiteNumber(value))
    else if (key === 'stats') {
      const stats = record(value)
      if (stats) summary.stats = Object.fromEntries(Object.entries(stats).filter(([, item]) => typeof item === 'number' && Number.isFinite(item))) as Record<string, number>
    } else if (key === 'description' || key === 'errorMessage' || key === 'pollErrorMessage') {
      copyDefined(summary, key, boundedText(value, SUMMARY_MAX_ERROR))
    } else copyDefined(summary, key, value === undefined ? undefined : value)
  }
  copyDefined(summary, 'title', boundedText(source.title, SUMMARY_MAX_TITLE))
  // Text bodies are only a preview on cards; opening the editor hydrates detail-v1 first.
  copyDefined(summary, 'text', boundedText(source.text, SUMMARY_MAX_TEXT_PREVIEW))
  copyDefined(summary, 'generation', summarizeGeneration(source.generation))
  copyDefined(summary, 'generationTask', summarizeGenerationTask(source.generationTask))
  copyDefined(summary, 'videoEdit', summarizeVideoEdit(source.videoEdit))
  copyDefined(summary, 'videoKeyframes', summarizeVideoKeyframes(source.videoKeyframes))
  copyDefined(summary, 'playlistItems', summarizePlaylistItems(source.playlistItems))
  const studioSummary = record(source.studioSummary)
  if (studioSummary) {
    summary.studioSummary = {
      version: 1,
      objectCount: finiteNumber(studioSummary.objectCount) ?? 0,
      cameraCount: finiteNumber(studioSummary.cameraCount) ?? 0,
      captureCount: finiteNumber(studioSummary.captureCount) ?? 0,
      hasPanorama: studioSummary.hasPanorama === true,
    }
  }
  const studioSource = record(source.__studioDocumentSource)
  if (studioSource) {
    summary.__studioDocumentSource = {
      kind: boundedId(studioSource.kind),
      projectId: boundedId(studioSource.projectId),
      canvasId: boundedId(studioSource.canvasId),
      nodeId: boundedId(studioSource.nodeId),
      templateId: boundedId(studioSource.templateId),
    }
  }
  return summary
}

export function buildCanvasNodeSummaryV1(node: CanvasNode): CanvasNodeSummaryV1 {
  return buildCanvasNodeSummaryWithMetrics(node)
}

export function buildCanvasNodeSummaryWithMetrics(node: CanvasNode, metrics?: {
  historyCount: number
  currentCost: CanvasNodeData['currentCost']
  detailVersion: string
}): CanvasNodeSummaryV1 {
  const summary = projectCanvasNodeCardData(node.data)
  const source = node.data ?? {}
  const history = metrics ? [] : historyEntries(source)
  const historyCount = metrics?.historyCount ?? history.length
  summary.historyCount = historyCount
  summary.currentCost = metrics ? metrics.currentCost : historyCount > 0 ? getCanvasCurrentCostLabel(history, source, source.mediaType ?? '') : null
  return {
    id: node.id,
    canvasId: node.canvasId,
    type: node.type,
    position: node.position,
    size: node.size,
    data: summary,
    status: node.status,
    taskId: node.taskId,
    runId: node.runId,
    mediaObjectId: node.mediaObjectId,
    parentNodeId: node.parentNodeId,
    historyCount,
    detailVersion: metrics?.detailVersion ?? createCanvasNodeDetailVersion(node),
  }
}
