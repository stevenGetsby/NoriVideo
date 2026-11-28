/**
 * 1-Click Materialize BatchItem -> Real Wired 4-Column Infinite Canvas (Canvas + CanvasNode + CanvasEdge).
 *
 * 4-Column Layout under `run.projectId`:
 *  - Column 1 (x = 80):   Source Video node (if present) + S1 Original Script Text node + S2 Rewritten Script Text node
 *  - Column 2 (x = 580):  S3 Character / Location / Prop Image nodes (+ Character Voice Audio nodes)
 *  - Column 3 (x = 1000): S5 Storyboard Video nodes (using selected Take) wired with exact `REF` edges to their S3 assets & character voices
 *  - Column 4 (x = 1440): `PlaylistNode` wired from all Column 3 shots in sequence, ready for review/export
 */

import { createHash, randomUUID } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { ApiError } from '@/lib/api-errors'
import { workspaceUserWhere } from '@/lib/collaboration/access'
import { CANVAS_DOCUMENT_SCHEMA_VERSION } from '@/lib/canvas/document-version'
import type { CanvasDocumentEdgeInput, CanvasDocumentNodeInput } from '@/lib/canvas/document'
import type { CanvasPlaylistItem } from '@/features/canvas/types'
import { mapBatchItemRow, mapBatchRunRow } from './service'
import type {
  BatchItemDTO,
  BatchItemStageOutputs,
  MaterializeCanvasResult,
  StoryboardShotItem,
  VideoGenShotEntry,
  VideoShotTake,
  WorkflowAssetItem,
  WorkflowModelConfig,
} from './types'

export type MaterializeCanvasMode = 'create' | 'sync' | 'check'
export type MaterializeCanvasSkippedShot = { shotId: string; reason: 'not_ready' | 'empty_url' }
export type MaterializeCanvasSyncResult = MaterializeCanvasResult & {
  item?: BatchItemDTO
  stale?: boolean
  fingerprint: string
  canvasFingerprint?: string | null
  synced?: boolean
  updatedNodeCount?: number
  skippedShots: MaterializeCanvasSkippedShot[]
}

export interface MaterializeCanvasMaterialRef {
  id: string
  title?: string | null
  type: string
  resultUrl?: string | null
  storageKey?: string | null
}

function toJsonInput(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? {})) as Prisma.InputJsonValue
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function usableUrl(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function selectedAssetVersion(asset: WorkflowAssetItem) {
  const selected = asset.versions?.[asset.selectedVersionIndex]
  return selected || [...(asset.versions || [])].reverse().find((version) => version.status === 'ready') || null
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

/** Fingerprint only the adopted media and the order/timing that drives the playlist. */
export function computeBatchItemCanvasFingerprint(item: BatchItemDTO): string {
  const s4Shots = item.stageOutputs.storyboard?.shots || []
  const s5ByShotId = new Map((item.stageOutputs.video_gen?.shots || []).map((entry) => [entry.shotId, entry]))
  const assets = (item.stageOutputs.asset_extraction?.items || []).map((asset) => {
    const selected = selectedAssetVersion(asset)
    return {
      id: asset.id,
      selectedVersionIndex: asset.selectedVersionIndex,
      version: selected ? {
        versionIndex: selected.versionIndex,
        materialId: selected.materialId || null,
        imageUrl: selected.imageUrl || null,
        storageKey: selected.storageKey || null,
        status: selected.status,
      } : null,
      voiceMaterialId: asset.voiceMaterialId || null,
      voiceMaterialUrl: asset.voiceMaterialUrl || null,
    }
  })
  const shots = s4Shots.map((shot) => {
    const entry = s5ByShotId.get(shot.shotId)
    const take = pickSelectedTake(entry)
    return {
      shotId: shot.shotId,
      durationSec: shot.durationSec,
      take: take ? {
        takeIndex: take.takeIndex,
        videoUrl: take.videoUrl || null,
        status: take.status,
      } : null,
    }
  })
  const normalized = {
    shots,
    assets,
    playlist: shots.map((shot) => ({ shotId: shot.shotId, durationSec: shot.durationSec })),
  }
  return createHash('sha256').update(stableJson(normalized)).digest('hex')
}

function workflowNodeMetadata(key: string, extra: Record<string, unknown> = {}) {
  return { workflow: { owned: true, key, ...extra } }
}

function workflowNodeKey(node: CanvasDocumentNodeInput): string | null {
  const metadata = asRecord(asRecord(asRecord(node.data).sourceMetadata).workflow)
  return metadata.owned === true && typeof metadata.key === 'string' ? metadata.key : null
}


function formatOriginalScriptText(item: BatchItemDTO): string {
  const s1 = item.stageOutputs.script_analysis
  if (!s1) {
    return item.inputPayload.pastedScript || `# ${item.title}\n（尚未完成 S1 剧本解析）`
  }
  const lines: string[] = [
    `# S1 原剧本解析 · ${s1.title}`,
    `来源：${s1.sourceMode === 'pasted_script' ? '粘贴导入剧本' : '火山方舟视频解析'} | 预估时长：${s1.estimatedDurationSec}s`,
  ]
  if (s1.summary) lines.push(`概要：${s1.summary}`)
  if (s1.hookAnalysis) lines.push(`前3秒与节奏钩子：${s1.hookAnalysis}`)
  lines.push('')
  lines.push(s1.fullScriptText)
  return lines.join('\n').trim()
}

function formatRewrittenScriptText(item: BatchItemDTO): string {
  const s2 = item.stageOutputs.script_rewrite
  if (!s2) return ''
  const lines: string[] = [
    `# S2 洗稿剧本 · ${s2.title}（${s2.styleTag}）`,
    `预估时长：${s2.estimatedDurationSec}s | 改编摘要：${s2.rewriteSummary}`,
  ]
  if (Array.isArray(s2.changeHighlights) && s2.changeHighlights.length > 0) {
    lines.push(`核心亮点：${s2.changeHighlights.join(' · ')}`)
  }
  if (s2.hookLine3s) lines.push(`前3秒抓手：${s2.hookLine3s}`)
  lines.push('')
  lines.push(s2.fullScriptText)
  return lines.join('\n').trim()
}

function makeCanvasHref(projectId: string, canvasId: string): string {
  return `/canvas/${encodeURIComponent(projectId)}/${encodeURIComponent(canvasId)}`
}

function pickSelectedTake(entry?: VideoGenShotEntry | null): VideoShotTake | null {
  if (!entry || !Array.isArray(entry.takes) || entry.takes.length === 0) return null
  if (entry.selectedTakeIndex >= 0 && entry.selectedTakeIndex < entry.takes.length) {
    return entry.takes[entry.selectedTakeIndex]
  }
  const ready = [...entry.takes].reverse().find((t) => t.status === 'ready')
  return ready || entry.takes[entry.takes.length - 1]
}

/**
 * Pure deterministic 4-column Canvas graph builder (exported for unit tests).
 */
export function buildBatchItemCanvasGraph(params: {
  canvasId: string
  item: BatchItemDTO
  modelConfig?: WorkflowModelConfig
  materials?: readonly MaterializeCanvasMaterialRef[]
}): {
  title: string
  viewport: { x: number; y: number; zoom: number }
  nodes: CanvasDocumentNodeInput[]
  edges: CanvasDocumentEdgeInput[]
  skippedShots: MaterializeCanvasSkippedShot[]
} {
  const { item } = params
  const skippedShots: MaterializeCanvasSkippedShot[] = []
  const materialByAssetId = new Map(
    (item.stageOutputs.asset_extraction?.items || []).flatMap((asset) => {
      const selected = selectedAssetVersion(asset)
      const url = selected && selected.status === 'ready'
        ? usableUrl(selected.imageUrl) || usableUrl(selected.storageKey)
        : null
      return selected && selected.status === 'ready' && url
        ? [[asset.id, {
          id: selected.materialId || asset.id,
          title: null,
          type: 'image',
          resultUrl: selected.imageUrl || null,
          storageKey: selected.storageKey || null,
        } as MaterializeCanvasMaterialRef] as const]
        : []
    }),
  )
  const materialsById = new Map([
    ...(params.materials || []).map((m) => [m.id, m] as const),
    ...materialByAssetId,
  ])
  const nodes: CanvasDocumentNodeInput[] = []
  const edges: CanvasDocumentEdgeInput[] = []

  const addEdge = (sourceNodeId: string, targetNodeId: string, role: string) => {
    if (!sourceNodeId || !targetNodeId || sourceNodeId === targetNodeId) return
    const exists = edges.some(
      (e) => e.sourceNodeId === sourceNodeId && e.targetNodeId === targetNodeId && e.role === role,
    )
    if (exists) return
    edges.push({
      id: `edge_${randomUUID().slice(0, 12)}`,
      sourceNodeId,
      targetNodeId,
      sourceHandle: null,
      targetHandle: null,
      role,
    })
  }

  // ------------------------------------------------------------
  // Column 1 (x = 80): Source Video (if any) + S1 & S2 Script Text Nodes
  // ------------------------------------------------------------
  let col1Y = 80
  let sourceVideoNodeId: string | null = null

  const sourceVideoMat = item.inputPayload.sourceVideoMaterialId
    ? materialsById.get(item.inputPayload.sourceVideoMaterialId)
    : null
  const sourceVideoUrl =
    sourceVideoMat?.resultUrl
    || sourceVideoMat?.storageKey
    || item.inputPayload.sourceVideoUrl
    || item.inputPayload.sourceVideoStorageKey
    || null

  if (sourceVideoUrl && !item.inputPayload.skipVideoAnalysis) {
    sourceVideoNodeId = `node_src_video_${randomUUID().slice(0, 8)}`
    nodes.push({
      id: sourceVideoNodeId,
      type: 'video',
      position: { x: 80, y: col1Y },
      size: { width: 380, height: 240 },
      status: 'SUCCEEDED',
      taskId: null,
      runId: null,
      mediaObjectId: item.inputPayload.sourceVideoMaterialId || null,
      parentNodeId: null,
      data: {
        title: `源参考视频 · ${item.inputPayload.sourceVideoFileName || item.title}`.slice(0, 120),
        mediaType: 'video',
        origin: 'project',
        materialId: item.inputPayload.sourceVideoMaterialId || null,
        contentUrl: sourceVideoUrl,
        videoUrl: sourceVideoUrl,
        sourceMetadata: workflowNodeMetadata('source-video'),
      },
    })
    col1Y += 280
  }

  const s1NodeId = `node_s1_script_${randomUUID().slice(0, 8)}`
  nodes.push({
    id: s1NodeId,
    type: 'text',
    position: { x: 80, y: col1Y },
    size: { width: 420, height: 320 },
    status: 'SUCCEEDED',
    taskId: null,
    runId: null,
    mediaObjectId: null,
    parentNodeId: null,
    data: {
      title: `S1 原剧本 · ${item.stageOutputs.script_analysis?.title || item.title}`.slice(0, 120),
      mediaType: 'text',
      origin: 'project',
      text: formatOriginalScriptText(item),
      sourceMetadata: workflowNodeMetadata('script-s1'),
    },
  })
  if (sourceVideoNodeId) {
    addEdge(sourceVideoNodeId, s1NodeId, 'INPUT_DEFAULT')
  }
  col1Y += 360

  let primaryScriptNodeId = s1NodeId
  const s2Text = formatRewrittenScriptText(item)
  if (s2Text) {
    const s2NodeId = `node_s2_script_${randomUUID().slice(0, 8)}`
    nodes.push({
      id: s2NodeId,
      type: 'text',
      position: { x: 80, y: col1Y },
      size: { width: 420, height: 340 },
      status: 'SUCCEEDED',
      taskId: null,
      runId: null,
      mediaObjectId: null,
      parentNodeId: null,
      data: {
        title: `S2 洗稿剧本 · ${item.stageOutputs.script_rewrite?.title || item.title}`.slice(0, 120),
        mediaType: 'text',
        origin: 'project',
        text: s2Text,
        sourceMetadata: workflowNodeMetadata('script-s2'),
      },
    })
    addEdge(s1NodeId, s2NodeId, 'INPUT_TEXT')
    primaryScriptNodeId = s2NodeId
  }

  // ------------------------------------------------------------
  // Column 2 (x = 580): S3 Character / Location / Prop Image Nodes (+ Voice Audio Nodes)
  // ------------------------------------------------------------
  const s3 = item.stageOutputs.asset_extraction
  const assetNodeIdByAssetId = new Map<string, string>()
  const voiceNodeIdByAssetId = new Map<string, string>()
  const allAssetImageNodeIds: string[] = []
  let col2Y = 80

  const kindLabel = (kind: string) =>
    kind === 'character' ? '角色' : kind === 'location' ? '场景' : '道具'

  for (const asset of s3?.items || []) {
    const selectedVersion = selectedAssetVersion(asset)
    const imageUrl = selectedVersion?.status === 'ready'
      ? usableUrl(selectedVersion.imageUrl) || usableUrl(selectedVersion.storageKey)
      : null
    const mat = imageUrl ? materialByAssetId.get(asset.id) : null
    if (!mat || !imageUrl) continue
    const assetNodeId = `node_asset_${asset.id}_${randomUUID().slice(0, 6)}`
    assetNodeIdByAssetId.set(asset.id, assetNodeId)
    allAssetImageNodeIds.push(assetNodeId)

    const nodeStatus = 'SUCCEEDED'

    nodes.push({
      id: assetNodeId,
      type: 'image',
      position: { x: 580, y: col2Y },
      size: { width: 290, height: 250 },
      status: nodeStatus,
      taskId: asset.taskId || null,
      runId: null,
      mediaObjectId: asset.materialId || null,
      parentNodeId: null,
      data: {
        title: `${kindLabel(asset.kind)} · ${asset.name}`,
        mediaType: 'image',
        origin: asset.status === 'reused' ? 'project' : 'generate',
        materialId: asset.materialId || null,
        contentUrl: imageUrl,
        imageUrl,
        prompt: asset.imagePrompt,
        assetCategory: asset.kind,
        sourceMetadata: {
          ...workflowNodeMetadata(`asset:${asset.id}`, { assetId: asset.id }),
          workflowAssetId: asset.id,
          assetKind: asset.kind,
          aliases: asset.aliases,
          roleOrUsage: asset.roleOrUsage,
        },
      },
    })
    addEdge(primaryScriptNodeId, assetNodeId, 'INPUT_DEFAULT')
    col2Y += 290

    // Add bound Character Voice Audio node right below its character card
    if (asset.kind === 'character' && asset.voiceMaterialId) {
      const voiceMat = materialsById.get(asset.voiceMaterialId)
      const audioUrl = voiceMat?.resultUrl || voiceMat?.storageKey || asset.voiceMaterialUrl || null
      const voiceNodeId = `node_voice_${asset.id}_${randomUUID().slice(0, 6)}`
      voiceNodeIdByAssetId.set(asset.id, voiceNodeId)

      nodes.push({
        id: voiceNodeId,
        type: 'audio',
        position: { x: 580, y: col2Y },
        size: { width: 290, height: 120 },
        status: audioUrl ? 'SUCCEEDED' : 'IDLE',
        taskId: null,
        runId: null,
        mediaObjectId: asset.voiceMaterialId,
        parentNodeId: assetNodeId,
        data: {
          title: `音色 · ${asset.name}（${asset.voiceMaterialTitle || voiceMat?.title || '角色音色'}）`.slice(0, 120),
          mediaType: 'audio',
          origin: 'project',
          materialId: asset.voiceMaterialId,
          contentUrl: audioUrl,
          audioUrl,
          sourceMetadata: workflowNodeMetadata(`voice:${asset.id}`, { assetId: asset.id }),
        },
      })
      addEdge(assetNodeId, voiceNodeId, 'INPUT_DEFAULT')
      col2Y += 150
    }
  }

  // ------------------------------------------------------------
  // Column 3 (x = 1000): S5 Storyboard Video Nodes wired to exact referenced S3 assets
  // ------------------------------------------------------------
  const s4 = item.stageOutputs.storyboard
  const s5 = item.stageOutputs.video_gen
  const s5ByShotId = new Map<string, VideoGenShotEntry>(
    (s5?.shots || []).map((entry) => [entry.shotId, entry]),
  )

  const shots: StoryboardShotItem[] = s4?.shots && s4.shots.length > 0
    ? s4.shots
    : (s5?.shots || []).map((entry) => ({
        shotId: entry.shotId,
        shotIndex: entry.shotIndex,
        sceneIndex: entry.shotIndex,
        title: entry.title,
        durationSec: entry.durationSec,
        shotType: '中近景',
        cameraMovement: '平稳推进',
        visualDescription: entry.prompt,
        videoPrompt: entry.prompt,
        referencedAssetIds: entry.referencedAssetIds || [],
        referencedAssetNames: [],
        inputMode: s5?.inputMode || 'text',
        negativeConstraints: 'no music, no subtitles',
      }))

  const shotNodeByShotId = new Map<string, {
    nodeId: string
    shot: StoryboardShotItem
    selectedTake: VideoShotTake | null
  }>()

  shots.forEach((shot, idx) => {
    const s5Entry = s5ByShotId.get(shot.shotId)
    const take = pickSelectedTake(s5Entry)
    const videoUrl = take?.status === 'ready' ? usableUrl(take.videoUrl) : null
    if (!take || take.status !== 'ready') {
      skippedShots.push({ shotId: shot.shotId, reason: 'not_ready' })
    } else if (!videoUrl) {
      skippedShots.push({ shotId: shot.shotId, reason: 'empty_url' })
    }
    const shotNodeId = `node_shot_${shot.shotIndex}_${randomUUID().slice(0, 6)}`
    shotNodeByShotId.set(shot.shotId, { nodeId: shotNodeId, shot, selectedTake: take })

    const matchedImageNodeIds = (shot.referencedAssetIds || [])
      .map((assetId) => assetNodeIdByAssetId.get(assetId))
      .filter((id): id is string => Boolean(id))
    const matchedVoiceNodeIds = (shot.referencedAssetIds || [])
      .map((assetId) => voiceNodeIdByAssetId.get(assetId))
      .filter((id): id is string => Boolean(id))

    const wiredRefNodeIds = Array.from(new Set([
      ...(matchedImageNodeIds.length > 0 ? matchedImageNodeIds : allAssetImageNodeIds.slice(0, 3)),
      ...matchedVoiceNodeIds,
    ]))

    const status = videoUrl ? 'SUCCEEDED' : 'IDLE'

    nodes.push({
      id: shotNodeId,
      type: 'video',
      position: { x: 1000, y: 80 + idx * 340 },
      size: { width: 330, height: 290 },
      status,
      taskId: take?.taskId || null,
      runId: null,
      mediaObjectId: take?.materialId || null,
      parentNodeId: null,
      data: {
        title: `镜${shot.shotIndex} · ${shot.title}`.slice(0, 120),
        mediaType: 'video',
        origin: 'generate',
        prompt: take?.prompt || shot.videoPrompt,
        contentUrl: videoUrl,
        videoUrl,
        posterUrl: take?.posterUrl || null,
        materialId: take?.materialId || null,
        errorMessage: take?.errorMessage || null,
        generation: {
          modelKey: take?.modelKey || s5?.modelKey || params.modelConfig?.videoModelKey || 'nori::norivideo2.5',
          ...(take?.assetId ? { assetId: take.assetId } : {}),
          ...(take?.taskId ? { taskId: take.taskId } : {}),
          inputMode: take?.inputMode || shot.inputMode || 'text',
          referenceNodeIds: wiredRefNodeIds,
          aspectRatio: take?.aspectRatio || s4?.aspectRatio || params.modelConfig?.videoAspectRatio || '9:16',
          resolution: take?.resolution || s5?.resolution || params.modelConfig?.videoResolution || '720p',
          duration: take?.durationSec || shot.durationSec,
          generateAudio: take?.generateAudio ?? s5?.generateAudio ?? params.modelConfig?.videoGenerateAudio ?? true,
        },
        sourceMetadata: {
          ...workflowNodeMetadata(`shot:${shot.shotId}`, { shotId: shot.shotId }),
          shotId: shot.shotId,
          shotIndex: shot.shotIndex,
          sceneIndex: shot.sceneIndex,
          shotType: shot.shotType,
          cameraMovement: shot.cameraMovement,
          dialogue: shot.dialogue || null,
          onscreenText: shot.onscreenText || null,
          referencedAssetIds: shot.referencedAssetIds,
          selectedTakeIndex: s5Entry?.selectedTakeIndex ?? -1,
          takeCount: s5Entry?.takes.length ?? 0,
        },
      },
    })

    if (wiredRefNodeIds.length > 0) {
      for (const refNodeId of wiredRefNodeIds) {
        addEdge(refNodeId, shotNodeId, 'REF')
      }
    } else {
      addEdge(primaryScriptNodeId, shotNodeId, 'INPUT_TEXT')
    }
  })

  // ------------------------------------------------------------
  // Column 4 (x = 1440): PlaylistNode wired from all Shot Video Nodes
  // ------------------------------------------------------------
  const playlistItems: CanvasPlaylistItem[] = shots.flatMap((shot) => {
    const entry = shotNodeByShotId.get(shot.shotId)
    const take = entry?.selectedTake
    const videoUrl = take?.status === 'ready' ? usableUrl(take.videoUrl) : null
    if (!entry || !videoUrl) return []
    const durationMs = Math.max(1000, Math.round((take?.durationSec || shot.durationSec || 5) * 1000))
    return [{
      id: `pl_${shot.shotId}`,
      sourceNodeId: entry.nodeId,
      materialId: take?.materialId || null,
      title: `镜${shot.shotIndex} · ${shot.title}`,
      videoUrl,
      posterUrl: take?.posterUrl || null,
      sourceInMs: 0,
      sourceOutMs: durationMs,
      durationMs,
    }]
  })

  const playlistNodeId = `node_playlist_${randomUUID().slice(0, 8)}`
  nodes.push({
    id: playlistNodeId,
    type: 'playlist',
    position: { x: 1440, y: 120 },
    size: { width: 380, height: 420 },
    status: 'IDLE',
    taskId: null,
    runId: null,
    mediaObjectId: null,
    parentNodeId: null,
    data: {
      title: `成片播放列表 · ${item.stageOutputs.script_rewrite?.title || item.title}`.slice(0, 120),
      origin: 'project',
      playlistItems,
      sourceMetadata: {
        ...workflowNodeMetadata('playlist'),
        batchItemId: item.id,
        batchRunId: item.batchRunId,
        shotCount: shots.length,
      },
    },
  })

  for (const shotEntry of shotNodeByShotId.values()) {
    addEdge(shotEntry.nodeId, playlistNodeId, 'INPUT_DEFAULT')
  }

  const fingerprint = computeBatchItemCanvasFingerprint(item)
  const playlist = nodes.find((node) => workflowNodeKey(node) === 'playlist')
  if (playlist) {
    const sourceMetadata = asRecord(playlist.data?.sourceMetadata)
    const workflow = asRecord(sourceMetadata.workflow)
    playlist.data = {
      ...(playlist.data || {}),
      sourceMetadata: { ...sourceMetadata, workflow: { ...workflow, fingerprint } },
    }
  }
  return {
    title: `工作流精修 · ${item.title}`.slice(0, 120),
    viewport: { x: 40, y: 40, zoom: 0.7 },
    nodes,
    edges,
    skippedShots,
  }
}

export function mergeBatchItemCanvasSync(params: {
  existingNodes: CanvasDocumentNodeInput[]
  existingEdges: CanvasDocumentEdgeInput[]
  graph: ReturnType<typeof buildBatchItemCanvasGraph>
}) {
  const existingByKey = new Map(params.existingNodes.flatMap((node) => {
    const key = workflowNodeKey(node)
    return key ? [[key, node] as const] : []
  }))
  if (existingByKey.size === 0) return null
  const idMap = new Map<string, string>()
  for (const generated of params.graph.nodes) {
    const key = workflowNodeKey(generated)
    const existing = key ? existingByKey.get(key) : undefined
    if (existing) idMap.set(generated.id, existing.id)
  }
  const remapId = (id: string) => idMap.get(id) || id
  const mediaKeys = new Set([
    'contentUrl', 'imageUrl', 'videoUrl', 'audioUrl', 'posterUrl', 'materialId',
    'status', 'taskId', 'mediaObjectId', 'generation', 'sourceMetadata',
  ])
  const updated = params.graph.nodes.flatMap((generated) => {
    const key = workflowNodeKey(generated)
    const existing = key ? existingByKey.get(key) : undefined
    if (!existing || !key) return []
    const skippedShot = key.startsWith('shot:')
      && params.graph.skippedShots.some((shot) => `shot:${shot.shotId}` === key)
    const generatedData = { ...(generated.data || {}) }
    if (skippedShot) {
      for (const field of ['contentUrl', 'videoUrl', 'posterUrl', 'materialId', 'generation']) {
        delete generatedData[field]
      }
    }
    const generation = asRecord(generatedData.generation)
    if (key === 'playlist' && Array.isArray(generatedData.playlistItems)) {
      generatedData.playlistItems = generatedData.playlistItems.map((value) => {
        const entry = asRecord(value)
        return typeof entry.sourceNodeId === 'string'
          ? { ...entry, sourceNodeId: remapId(entry.sourceNodeId) }
          : entry
      })
    }
    if (Array.isArray(generation.referenceNodeIds)) {
      generation.referenceNodeIds = generation.referenceNodeIds
        .map((id) => typeof id === 'string' ? remapId(id) : id)
        .filter((id) => params.existingNodes.some((node) => node.id === id))
      generatedData.generation = generation
    }
    const data = { ...(existing.data || {}) }
    for (const [field, value] of Object.entries(generatedData)) {
      if (mediaKeys.has(field) || (key === 'playlist' && field === 'playlistItems')) data[field] = value
    }
    const sourceMetadata = {
      ...asRecord(existing.data?.sourceMetadata),
      ...asRecord(generated.data?.sourceMetadata),
    }
    sourceMetadata.workflow = {
      ...asRecord(asRecord(generated.data?.sourceMetadata).workflow),
      ...workflowNodeMetadata(key, key.startsWith('shot:')
        ? { shotId: key.slice(5) }
        : key.startsWith('asset:') || key.startsWith('voice:')
          ? { assetId: key.slice(key.indexOf(':') + 1) }
          : {}).workflow,
    }
    data.sourceMetadata = sourceMetadata
    const node = {
      ...existing,
      data,
      ...(skippedShot ? {} : {
        status: generated.status,
        taskId: generated.taskId,
        mediaObjectId: generated.mediaObjectId,
      }),
    }
    return [node]
  })
  const updatedKeys = new Set(updated.flatMap((node) => {
    const key = workflowNodeKey(node)
    return key ? [key] : []
  }))
  const unchangedOwned = params.existingNodes.filter((node) => {
    const key = workflowNodeKey(node)
    return key && !updatedKeys.has(key)
  })
  const userNodes = params.existingNodes.filter((node) => !workflowNodeKey(node))
  const workflowEdges = params.graph.edges.map((edge) => ({
    ...edge,
    sourceNodeId: remapId(edge.sourceNodeId),
    targetNodeId: remapId(edge.targetNodeId),
  })).filter((edge) => (
    params.existingNodes.some((node) => node.id === edge.sourceNodeId)
    && params.existingNodes.some((node) => node.id === edge.targetNodeId)
  ))
  const userEdges = params.existingEdges.filter((edge) => (
    userNodes.some((node) => node.id === edge.sourceNodeId || node.id === edge.targetNodeId)
  ))
  const edges = [...workflowEdges]
  const edgeKeys = new Set(edges.map((edge) => `${edge.sourceNodeId}|${edge.targetNodeId}|${edge.role}`))
  for (const edge of userEdges) {
    const key = `${edge.sourceNodeId}|${edge.targetNodeId}|${edge.role}`
    if (!edgeKeys.has(key)) edges.push(edge)
  }
  return { nodes: [...updated, ...unchangedOwned, ...userNodes], edges }
}

export function canvasFingerprintFromSnapshot(document: unknown): string | null {
  const root = asRecord(document)
  const metaWorkflow = asRecord(asRecord(root.meta).workflowMaterialization)
  if (typeof metaWorkflow.fingerprint === 'string') return metaWorkflow.fingerprint
  const nodes = Array.isArray(root.nodes) ? root.nodes : []
  for (const value of nodes) {
    const workflow = asRecord(asRecord(asRecord(asRecord(value).data).sourceMetadata).workflow)
    if (workflow.key === 'playlist' && typeof workflow.fingerprint === 'string') return workflow.fingerprint
  }
  return null
}

async function syncCanvasGraph(params: {
  workspaceOwnerId: string
  actorId: string
  projectId: string
  canvas: { id: string; revision: number; viewport: unknown }
  existingNodes: CanvasDocumentNodeInput[]
  graph: ReturnType<typeof buildBatchItemCanvasGraph>
  merged: NonNullable<ReturnType<typeof mergeBatchItemCanvasSync>>
  fingerprint: string
}) {
  let updatedNodeCount = 0
  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const claimed = await tx.canvas.updateMany({
      where: { id: params.canvas.id, projectId: params.projectId, revision: params.canvas.revision },
      data: { revision: { increment: 1 } },
    })
    if (claimed.count !== 1) {
      throw new ApiError('CONFLICT', { message: '画布已被其他标签页更新，请刷新后重试同步。' })
    }
    const nextRevision = params.canvas.revision + 1
    const nextNodes = params.merged.nodes
    for (const node of nextNodes) {
      const existing = params.existingNodes.find((candidate) => candidate.id === node.id)
      if (!existing || !workflowNodeKey(node)) continue
      if (stableJson(existing) !== stableJson(node)) {
        const result = await tx.canvasNode.updateMany({
          where: { id: node.id, canvasId: params.canvas.id },
          data: {
            data: toJsonInput(node.data),
            status: node.status,
            taskId: node.taskId,
            mediaObjectId: node.mediaObjectId,
          },
        })
        if (result.count !== 1) throw new ApiError('CONFLICT', { message: '工作流节点已被删除，请重试同步。' })
        updatedNodeCount += 1
      }
    }
    const nodeIds = new Set(nextNodes.map((node) => node.id))
    const edges = params.merged.edges.filter((edge) => nodeIds.has(edge.sourceNodeId) && nodeIds.has(edge.targetNodeId))
    const existingEdges = await tx.canvasEdge.findMany({ where: { canvasId: params.canvas.id } })
    const ownedIds = new Set(params.existingNodes.filter((node) => workflowNodeKey(node)).map((node) => node.id))
    const removableIds = existingEdges.filter((edge) => (
      ownedIds.has(edge.sourceNodeId) && ownedIds.has(edge.targetNodeId)
    )).map((edge) => edge.id)
    if (removableIds.length > 0) {
      await tx.canvasEdge.deleteMany({ where: { canvasId: params.canvas.id, id: { in: removableIds } } })
    }
    const existingEdgeKeys = new Set(existingEdges.filter((edge) => !removableIds.includes(edge.id))
      .map((edge) => `${edge.sourceNodeId}|${edge.targetNodeId}|${edge.role}`))
    const createEdges = edges.filter((edge) => !existingEdgeKeys.has(`${edge.sourceNodeId}|${edge.targetNodeId}|${edge.role}`))
    if (createEdges.length > 0) {
      await tx.canvasEdge.createMany({
        data: createEdges.map((edge) => ({
          id: edge.id,
          canvasId: params.canvas.id,
          sourceNodeId: edge.sourceNodeId,
          targetNodeId: edge.targetNodeId,
          sourceHandle: edge.sourceHandle,
          targetHandle: edge.targetHandle,
          role: edge.role,
        })),
      })
    }
    await tx.canvasSnapshot.create({
      data: {
        canvasId: params.canvas.id,
        revision: nextRevision,
        userId: params.actorId,
        clientId: 'batch-workflow-sync',
        changeSummary: '同步当前采用版本（保留手动画布布局与新增内容）',
        document: toJsonInput({
          schema_version: CANVAS_DOCUMENT_SCHEMA_VERSION,
          viewport: params.canvas.viewport,
          nodes: nextNodes,
          edges,
          meta: { workflowMaterialization: { fingerprint: params.fingerprint, skippedShots: params.graph.skippedShots } },
        }),
      },
    })
  })
  return { updatedNodeCount }
}

export async function materializeBatchItemToCanvas(params: {
  workspaceOwnerId: string
  actorId: string
  batchRunId: string
  itemId: string
  forceNew?: boolean
  mode?: MaterializeCanvasMode
  expectedRevision?: number
}): Promise<MaterializeCanvasSyncResult> {
  const runRow = await prisma.batchRun.findFirst({
    where: {
      id: params.batchRunId,
      userId: params.workspaceOwnerId,
    },
  })
  if (!runRow) {
    throw new ApiError('NOT_FOUND', { message: '工作流批次不存在或无权访问。' })
  }

  const itemRow = await prisma.batchItem.findFirst({
    where: { id: params.itemId, batchRunId: runRow.id },
  })
  if (!itemRow) {
    throw new ApiError('NOT_FOUND', { message: '工作流条目不存在。' })
  }

  const run = mapBatchRunRow(runRow)
  const item = mapBatchItemRow(itemRow)
  const fingerprint = computeBatchItemCanvasFingerprint(item)
  if (params.mode !== 'check' && params.expectedRevision !== undefined && params.expectedRevision !== (item.revision || 0)) {
    throw new ApiError('STALE_REVISION', { message: '工作流条目已被更新，请刷新后重试。' })
  }
  const existingCanvasId = item.stageOutputs.canvasId
  let existingCanvas: {
    id: string
    revision: number
    viewport: unknown
    nodes: Array<{ data: unknown }>
    _count: { nodes: number; edges: number }
  } | null = null

  if (!params.forceNew && params.mode !== 'create' && existingCanvasId) {
    existingCanvas = await prisma.canvas.findFirst({
      where: { id: existingCanvasId, projectId: run.projectId },
      select: {
        id: true,
        revision: true,
        viewport: true,
        nodes: { where: { type: 'playlist' }, select: { data: true }, take: 5 },
        _count: { select: { nodes: true, edges: true } },
      },
    })
    if (existingCanvas) {
      const latestSnapshot = await prisma.canvasSnapshot.findFirst({
        where: { canvasId: existingCanvas.id },
        orderBy: { revision: 'desc' },
        select: { document: true },
      })
      const canvasFingerprint = canvasFingerprintFromSnapshot({ nodes: existingCanvas.nodes })
        || canvasFingerprintFromSnapshot(latestSnapshot?.document)
      const base = {
        canvasId: existingCanvas.id,
        projectId: run.projectId,
        href: makeCanvasHref(run.projectId, existingCanvas.id),
        reused: true,
        nodeCount: existingCanvas._count.nodes,
        edgeCount: existingCanvas._count.edges,
        stale: canvasFingerprint !== fingerprint,
        fingerprint,
        canvasFingerprint,
        skippedShots: [] as MaterializeCanvasSkippedShot[],
      }
      if (params.mode === 'check' || params.mode !== 'sync') {
        const materials = await loadMaterializeCanvasMaterials(item, params.workspaceOwnerId)
        const graph = buildBatchItemCanvasGraph({ canvasId: existingCanvas.id, item, modelConfig: run.modelConfig, materials })
        return { ...base, item, skippedShots: graph.skippedShots }
      }
      if (!canvasFingerprint) {
        throw new ApiError('CONFLICT', {
          message: '旧画布没有工作流归属标记，无法安全同步，请选择新建画布。',
        })
      }
      const [existingNodeRows, existingEdgeRows] = await Promise.all([
        prisma.canvasNode.findMany({ where: { canvasId: existingCanvas.id } }),
        prisma.canvasEdge.findMany({ where: { canvasId: existingCanvas.id } }),
      ])
      const existingNodes = existingNodeRows.map((node) => ({
        ...node,
        position: node.position as CanvasDocumentNodeInput['position'],
        size: node.size as CanvasDocumentNodeInput['size'],
        data: node.data as CanvasDocumentNodeInput['data'],
      }))
      const existingEdges = existingEdgeRows.map((edge) => ({ ...edge }))
      const project = await prisma.project.findFirst({
        where: { id: run.projectId, userId: params.workspaceOwnerId, deletedAt: null },
        select: { id: true },
      })
      if (!project) throw new ApiError('NOT_FOUND', { message: '目标作品不存在或已被删除。' })
      const materials = await loadMaterializeCanvasMaterials(item, params.workspaceOwnerId)
      const graph = buildBatchItemCanvasGraph({ canvasId: existingCanvas.id, item, modelConfig: run.modelConfig, materials })
      const merged = mergeBatchItemCanvasSync({ existingNodes, existingEdges, graph })
      if (!merged) {
        throw new ApiError('CONFLICT', { message: '旧画布没有工作流归属标记，请选择新建画布。' })
      }
      if (!base.stale) return { ...base, item, synced: false, updatedNodeCount: 0, skippedShots: graph.skippedShots }
      const synced = await syncCanvasGraph({
        workspaceOwnerId: params.workspaceOwnerId,
        actorId: params.actorId,
        projectId: run.projectId,
        canvas: existingCanvas,
        existingNodes,
        graph,
        merged,
        fingerprint,
      })
      return {
        ...base,
        item,
        stale: false,
        nodeCount: merged.nodes.length,
        edgeCount: merged.edges.length,
        synced: true,
        updatedNodeCount: synced.updatedNodeCount,
        skippedShots: graph.skippedShots,
      }
    }
  }

  if (params.mode === 'check') {
    throw new ApiError('NOT_FOUND', { message: '尚未展开到有效画布。' })
  }
  if (params.expectedRevision !== undefined && params.expectedRevision !== (item.revision || 0)) {
    throw new ApiError('STALE_REVISION', { message: '工作流条目已被更新，请刷新后重试。' })
  }

  const project = await prisma.project.findFirst({
    where: { id: run.projectId, userId: params.workspaceOwnerId, deletedAt: null },
    select: { id: true },
  })
  if (!project) {
    throw new ApiError('NOT_FOUND', { message: '目标作品不存在或已被删除，无法展开到画布。' })
  }

  const materials = await loadMaterializeCanvasMaterials(item, params.workspaceOwnerId)
  const canvasId = randomUUID()
  const graph = buildBatchItemCanvasGraph({
    canvasId,
    item,
    modelConfig: run.modelConfig,
    materials,
  })

  let winnerCanvasId: string | null = null
  let updatedItemRow: typeof itemRow = itemRow
  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.canvas.create({
      data: {
        id: canvasId,
        projectId: run.projectId,
        userId: params.workspaceOwnerId,
        title: graph.title,
        themeColor: '#6366f1',
        viewport: toJsonInput(graph.viewport),
        revision: 1,
        visibility: 'PRIVATE',
      },
    })

    if (graph.nodes.length > 0) {
      await tx.canvasNode.createMany({
        data: graph.nodes.map((node) => ({
          id: node.id,
          canvasId,
          type: node.type,
          position: toJsonInput(node.position),
          size: node.size ? toJsonInput(node.size) : undefined,
          data: node.data ? toJsonInput(node.data) : undefined,
          status: node.status,
          taskId: node.taskId,
          runId: node.runId,
          mediaObjectId: node.mediaObjectId,
          parentNodeId: node.parentNodeId,
        })),
      })
    }

    if (graph.edges.length > 0) {
      await tx.canvasEdge.createMany({
        data: graph.edges.map((edge) => ({
          id: edge.id,
          canvasId,
          sourceNodeId: edge.sourceNodeId,
          targetNodeId: edge.targetNodeId,
          sourceHandle: edge.sourceHandle,
          targetHandle: edge.targetHandle,
          role: edge.role,
        })),
      })
    }

    await tx.canvasSnapshot.create({
      data: {
        canvasId,
        revision: 1,
        userId: params.actorId,
        clientId: 'batch-workflow-materialize',
        changeSummary: `5步工作流一键展开：${item.title}`.slice(0, 160),
        document: toJsonInput({
          schema_version: CANVAS_DOCUMENT_SCHEMA_VERSION,
          viewport: graph.viewport,
          nodes: graph.nodes,
          edges: graph.edges,
          meta: {
            workflowMaterialization: {
              batchItemId: item.id,
              fingerprint,
              skippedShots: graph.skippedShots,
            },
          },
        }),
      },
    })

    const latestItem = await tx.batchItem.findFirst({
      where: { id: item.id, batchRun: { userId: params.workspaceOwnerId } },
    })
    if (!latestItem) throw new ApiError('NOT_FOUND', { message: '工作流条目不存在。' })
    const latestOutputs = mapBatchItemRow(latestItem).stageOutputs
    if (!params.forceNew && params.mode !== 'create' && latestOutputs.canvasId) {
      winnerCanvasId = latestOutputs.canvasId
      await tx.canvas.deleteMany({ where: { id: canvasId, projectId: run.projectId } })
      return
    }
    const expectedRevision = params.expectedRevision ?? latestItem.revision ?? 0
    if (expectedRevision !== (latestItem.revision || 0)) {
      throw new ApiError('STALE_REVISION', { message: '工作流条目已被更新，请刷新后重试。' })
    }
    const nextOutputs: BatchItemStageOutputs = { ...latestOutputs, canvasId }
    const claimed = await tx.batchItem.updateMany({
      where: { id: item.id, revision: expectedRevision, batchRun: { userId: params.workspaceOwnerId } },
      data: { stageOutputs: toJsonInput(nextOutputs), revision: { increment: 1 } },
    })
    if (claimed.count !== 1) {
      const racedItem = await tx.batchItem.findFirst({
        where: { id: item.id, batchRun: { userId: params.workspaceOwnerId } },
      })
      const racedCanvasId = racedItem ? mapBatchItemRow(racedItem).stageOutputs.canvasId : undefined
      if (!params.forceNew && params.mode !== 'create' && racedCanvasId) {
        winnerCanvasId = racedCanvasId
        await tx.canvas.deleteMany({ where: { id: canvasId, projectId: run.projectId } })
        return
      }
      throw new ApiError('STALE_REVISION', { message: '工作流条目已被更新，请刷新后重试。' })
    }
    updatedItemRow = await tx.batchItem.findUniqueOrThrow({ where: { id: item.id } })
  })

  if (winnerCanvasId) {
    const winner = await prisma.canvas.findFirst({
      where: { id: winnerCanvasId, projectId: run.projectId },
      select: { id: true, _count: { select: { nodes: true, edges: true } } },
    })
    if (winner) {
      return {
        canvasId: winner.id,
        projectId: run.projectId,
        href: makeCanvasHref(run.projectId, winner.id),
        reused: true,
        nodeCount: winner._count.nodes,
        edgeCount: winner._count.edges,
        stale: false,
        fingerprint,
        skippedShots: graph.skippedShots,
        item: mapBatchItemRow(await prisma.batchItem.findUniqueOrThrow({ where: { id: item.id } })),
      }
    }
  }
  return {
    canvasId,
    projectId: run.projectId,
    href: makeCanvasHref(run.projectId, canvasId),
    reused: false,
    nodeCount: graph.nodes.length,
    edgeCount: graph.edges.length,
    fingerprint,
    stale: false,
    skippedShots: graph.skippedShots,
    item: mapBatchItemRow(updatedItemRow),
  }
}

async function loadMaterializeCanvasMaterials(item: BatchItemDTO, workspaceOwnerId: string) {
  const refMaterialIds = Array.from(new Set([
    item.inputPayload.sourceVideoMaterialId || '',
    ...(item.stageOutputs.asset_extraction?.items || []).map((asset) => asset.materialId || ''),
    ...(item.stageOutputs.asset_extraction?.items || []).map((asset) => asset.voiceMaterialId || ''),
    ...(item.inputPayload.referenceMaterialIds || []),
  ].filter(Boolean)))
  if (refMaterialIds.length === 0) return []
  const workspaceUsers = await prisma.user.findMany({
    where: workspaceUserWhere(workspaceOwnerId),
    select: { id: true },
  })
  return await prisma.frameosMaterial.findMany({
    where: {
      id: { in: refMaterialIds },
      userId: { in: workspaceUsers.map((user) => user.id) },
      deletedAt: null,
    },
    select: { id: true, title: true, type: true, resultUrl: true, storageKey: true },
  })
}
