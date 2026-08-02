import type { CanvasNodeData, CanvasPlaylistItem } from '@/features/canvas/types'
import type { VideoEditorProject } from '@/features/video-editor/types/editor.types'

export const CANVAS_PLAYLIST_SCOPE_PREFIX = 'canvas-playlist:'
export const CANVAS_PLAYLIST_MAX_ITEMS = 100
export const CANVAS_PLAYLIST_FPS = 30

export type CanvasPlaylistRenderRecord = {
  fingerprint: string
  taskId: string
  status: 'completed'
  storageKey: string
  outputUrl: string
  materialId: string
  durationMs: number
  completedAt: string
}

export function canvasPlaylistScopeId(canvasId: string, nodeId: string) {
  return `${CANVAS_PLAYLIST_SCOPE_PREFIX}${canvasId}:${nodeId}`
}

export function isCanvasPlaylistScopeId(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(CANVAS_PLAYLIST_SCOPE_PREFIX)
}

function finiteMs(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : null
}

function cleanText(value: unknown, fallback = '', maximum = 191) {
  return typeof value === 'string' && value.trim()
    ? value.trim().slice(0, maximum)
    : fallback
}

function cleanUrl(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export function normalizeCanvasPlaylistItems(value: unknown): CanvasPlaylistItem[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const items: CanvasPlaylistItem[] = []
  for (let index = 0; index < value.length && items.length < CANVAS_PLAYLIST_MAX_ITEMS; index += 1) {
    const raw = value[index]
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
    const row = raw as Record<string, unknown>
    let id = cleanText(row.id, `playlist-item-${index + 1}`)
    while (seen.has(id)) id = `${id.slice(0, 176)}-${index + 1}`
    seen.add(id)
    const durationMs = finiteMs(row.durationMs)
    const sourceInMs = finiteMs(row.sourceInMs) || 0
    const sourceOutMs = finiteMs(row.sourceOutMs)
    items.push({
      id,
      sourceNodeId: cleanText(row.sourceNodeId) || null,
      materialId: cleanText(row.materialId) || null,
      title: cleanText(row.title, `视频 ${index + 1}`, 120),
      videoUrl: cleanUrl(row.videoUrl),
      posterUrl: cleanUrl(row.posterUrl),
      sourceInMs,
      sourceOutMs,
      durationMs,
    })
  }
  return items
}

/** Stable, non-cryptographic content identity used to invalidate stale renders. */
export function canvasPlaylistFingerprint(value: unknown) {
  const canonical = JSON.stringify(normalizeCanvasPlaylistItems(value).map((item) => ({
    id: item.id,
    sourceNodeId: item.sourceNodeId || null,
    materialId: item.materialId || null,
    videoUrl: item.videoUrl || null,
    sourceInMs: item.sourceInMs,
    sourceOutMs: item.sourceOutMs ?? null,
    durationMs: item.durationMs ?? null,
  })))
  let first = 0x811c9dc5
  let second = 0x9e3779b9
  for (let index = 0; index < canonical.length; index += 1) {
    const code = canonical.charCodeAt(index)
    first = Math.imul(first ^ code, 0x01000193) >>> 0
    second = Math.imul(second ^ code, 0x85ebca6b) >>> 0
  }
  return `${first.toString(16).padStart(8, '0')}${second.toString(16).padStart(8, '0')}`
}

export function readCanvasPlaylistRenderRecord(value: unknown): CanvasPlaylistRenderRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  const durationMs = finiteMs(row.durationMs)
  if (
    typeof row.fingerprint !== 'string'
    || typeof row.taskId !== 'string'
    || row.status !== 'completed'
    || typeof row.storageKey !== 'string'
    || typeof row.outputUrl !== 'string'
    || typeof row.materialId !== 'string'
    || durationMs == null
    || typeof row.completedAt !== 'string'
  ) return null
  return {
    fingerprint: row.fingerprint,
    taskId: row.taskId,
    status: 'completed',
    storageKey: row.storageKey,
    outputUrl: row.outputUrl,
    materialId: row.materialId,
    durationMs,
    completedAt: row.completedAt,
  }
}

export function canvasPlaylistMsToFrame(value: unknown, fps = CANVAS_PLAYLIST_FPS) {
  const ms = finiteMs(value) || 0
  return Math.max(0, Math.round((ms / 1_000) * fps))
}

export function canvasPlaylistFrameToMs(value: unknown, fps = CANVAS_PLAYLIST_FPS) {
  const parsed = typeof value === 'number' ? value : Number(value)
  const frame = Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0
  return Math.round((frame / fps) * 1_000)
}

export function canvasPlaylistItemFrameRange(item: CanvasPlaylistItem, fps = CANVAS_PLAYLIST_FPS) {
  const fallbackDurationMs = finiteMs(item.sourceOutMs) || canvasPlaylistFrameToMs(1, fps)
  const durationMs = Math.max(canvasPlaylistFrameToMs(1, fps), finiteMs(item.durationMs) || fallbackDurationMs)
  const sourceDurationInFrames = Math.max(1, canvasPlaylistMsToFrame(durationMs, fps))
  const requestedFrom = canvasPlaylistMsToFrame(item.sourceInMs, fps)
  const from = Math.min(requestedFrom, Math.max(0, sourceDurationInFrames - 1))
  const requestedTo = item.sourceOutMs == null
    ? sourceDurationInFrames
    : canvasPlaylistMsToFrame(item.sourceOutMs, fps)
  const to = Math.max(from + 1, Math.min(requestedTo || sourceDurationInFrames, sourceDurationInFrames))
  return { from, to, sourceDurationInFrames }
}

export function canvasPlaylistClipDurationMs(item: CanvasPlaylistItem) {
  const range = canvasPlaylistItemFrameRange(item)
  return canvasPlaylistFrameToMs(range.to - range.from)
}

export function canvasPlaylistEditorProject(
  timelineId: string,
  items: CanvasPlaylistItem[],
  fps = CANVAS_PLAYLIST_FPS,
): VideoEditorProject {
  return {
    id: `canvas-playlist:${timelineId}`,
    episodeId: timelineId,
    schemaVersion: '1.0',
    config: { fps, width: 1920, height: 1080 },
    timeline: items.map((item, index) => {
      const range = canvasPlaylistItemFrameRange(item, fps)
      return {
        id: item.id,
        src: item.videoUrl || '',
        durationInFrames: range.to - range.from,
        trim: { from: range.from, to: range.to },
        metadata: {
          panelId: item.id,
          storyboardId: item.sourceNodeId || item.materialId || timelineId,
          sceneLabel: `片段 ${String(index + 1).padStart(2, '0')}`,
          segmentLabel: item.title,
          imageUrl: item.posterUrl || null,
          sourceDurationInFrames: range.sourceDurationInFrames,
        },
      }
    }),
    bgmTrack: [],
  }
}

export type CanvasPlaylistSourceNode = {
  id: string
  type: string
  data: CanvasNodeData | null
}

function sourceDurationMs(data: CanvasNodeData | null | undefined) {
  const metadata = data?.sourceMetadata
  const metadataMs = finiteMs(metadata?.durationMs)
  if (metadataMs && metadataMs > 0) return metadataMs
  const metadataSeconds = typeof metadata?.durationSeconds === 'number' ? metadata.durationSeconds : Number(metadata?.durationSeconds)
  if (Number.isFinite(metadataSeconds) && metadataSeconds > 0) return Math.round(metadataSeconds * 1_000)
  const generatedSeconds = data?.generation?.duration
  return typeof generatedSeconds === 'number' && Number.isFinite(generatedSeconds) && generatedSeconds > 0
    ? Math.round(generatedSeconds * 1_000)
    : null
}

export function resolveCanvasPlaylistTimeline(input: {
  projectName: string
  canvasId: string
  nodeId: string
  title: string
  items: unknown
  sourceNodes: CanvasPlaylistSourceNode[]
  requireReady?: boolean
  capturedAt?: string
  episodeOutputUrl?: string | null
  renderFingerprint?: string | null
}) {
  const items = normalizeCanvasPlaylistItems(input.items)
  if (input.requireReady && items.length === 0) {
    throw new Error('播放列表为空，请先加入至少一个视频。')
  }
  const sources = new Map(input.sourceNodes.map((node) => [node.id, node]))
  let cursorMs = 0
  const segments = items.map((item, index) => {
    const source = item.sourceNodeId ? sources.get(item.sourceNodeId) : null
    const sourceData = source?.data || null
    const videoUrl = cleanUrl(sourceData?.videoUrl || sourceData?.contentUrl) || cleanUrl(item.videoUrl)
    const posterUrl = cleanUrl(sourceData?.posterUrl || sourceData?.imageUrl) || cleanUrl(item.posterUrl)
    const inferredDurationMs = sourceDurationMs(sourceData)
      || (finiteMs(item.durationMs) || 0)
      || (finiteMs(item.sourceOutMs) || 0)
      || 5_000
    const frameRange = canvasPlaylistItemFrameRange({ ...item, durationMs: inferredDurationMs })
    const trimStartMs = canvasPlaylistFrameToMs(frameRange.from)
    const trimEndMs = canvasPlaylistFrameToMs(frameRange.to)
    const durationMs = trimEndMs - trimStartMs
    const startMs = cursorMs
    cursorMs += durationMs
    const title = cleanText(sourceData?.title, item.title, 120)
    return {
      clipId: item.id,
      panelId: item.id,
      storyboardId: input.canvasId,
      sequence: index + 1,
      sceneLabel: 'PLAYLIST',
      segmentLabel: `Clip ${String(index + 1).padStart(2, '0')}`,
      label: `Clip ${String(index + 1).padStart(2, '0')} · ${title}`,
      description: cleanText(sourceData?.description, '', 2_000) || null,
      sourceText: cleanText(sourceData?.subtitle || sourceData?.text, '', 4_000) || null,
      videoPrompt: cleanText(sourceData?.prompt, '', 8_000) || null,
      location: null,
      shotType: null,
      cameraMove: null,
      characters: [],
      props: [],
      imageUrl: posterUrl,
      videoUrl,
      startMs,
      endMs: cursorMs,
      durationMs,
      trimStartMs,
      trimEndMs,
    }
  })
  if (input.requireReady && segments.some((segment) => !segment.videoUrl)) {
    throw new Error('播放列表中存在尚未生成或已失效的视频，请替换或移除后再提交。')
  }
  const scopeId = canvasPlaylistScopeId(input.canvasId, input.nodeId)
  return {
    snapshot: {
      version: 1 as const,
      capturedAt: input.capturedAt || new Date().toISOString(),
      episodeId: scopeId,
      episodeName: cleanText(input.title, '画布播放列表', 191),
      episodeOutputUrl: cleanUrl(input.episodeOutputUrl),
      renderFingerprint: cleanText(input.renderFingerprint) || null,
      durationMs: cursorMs,
      totalPanelCount: segments.length,
      readyPanelCount: segments.filter((segment) => Boolean(segment.videoUrl)).length,
      segments,
    },
    target: {
      kind: 'canvas_playlist' as const,
      projectName: input.projectName,
      canvasId: input.canvasId,
      nodeId: input.nodeId,
      title: cleanText(input.title, '画布播放列表', 191),
    },
  }
}
