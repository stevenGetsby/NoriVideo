'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSession } from 'next-auth/react'
import {
  Background,
  ConnectionMode,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type EdgeChange,
  type FinalConnectionState,
  type NodeChange,
  type ReactFlowInstance,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import './canvas.css'

import { apiFetch } from '@/lib/api-fetch'
import { settleWithConcurrency } from '@/lib/async/settle-with-concurrency'
import { readApiErrorMessage } from '@/lib/api/read-error-message'
import { CANVAS_DOCUMENT_SCHEMA_VERSION } from '@/lib/canvas/document-version'
import { buildCanvasGenerationMaterialReferences } from '@/lib/canvas/generation-reference-contract'
import { CANVAS_PANORAMA_ASPECT_RATIO } from '@/lib/canvas/generator-options'
import { CANVAS_PANORAMA_PROCESS_TYPE } from '@/lib/canvas/panorama-contract'
import { toDisplayImageUrl } from '@/lib/media/image-url'
import { MaterialPickerDialog } from '@/components/frameos/materials/MaterialPickerDialog'
import type { FrameosMaterialItem } from '@/components/frameos/materials/contracts'
import { CanvasEditorProvider, type CanvasNodeAction, type CanvasPlaylistVideoSource } from './CanvasEditorContext'
import { CanvasGenerator, type CanvasGenerateRequest } from './components/CanvasGenerator'
import { CanvasChrome } from './components/CanvasChrome'
import { CanvasConflictDialog, CanvasHistoryDialog, CanvasOfflineRecoveryDialog, CanvasRevisionDialog } from './components/CanvasDialogs'
import { CanvasHelpPanel } from './components/CanvasHelpPanel'
import { CanvasImageOperationDialog, type CanvasImageOperationInput, type CanvasImageOperationMode } from './components/CanvasImageOperationDialog'
import { CanvasImageEditDialog } from './components/CanvasImageEditDialog'
import { CanvasModel3DDialog } from './components/CanvasModel3D'
import { CanvasMediaPreviewDialog } from './components/CanvasMediaPreviewDialog'
import { CanvasVideoOperationDialog, type CanvasVideoOperationInput, type CanvasVideoOperationMode } from './components/CanvasVideoOperationDialog'
import { CANVAS_MATERIAL_DRAG_TYPE, CANVAS_WORKFLOW_DRAG_TYPE, CanvasProjectAssets, type CanvasWorkflowTemplate } from './components/CanvasProjectAssets'
import { CanvasWorkflowDialog } from './components/CanvasWorkflowDialog'
import { CanvasPanoramaDialog } from './components/CanvasPanoramaDialog'
import {
  panoramaCaptureResultMessage,
  settlePanoramaCaptureUploads,
  type PanoramaCaptureCommitResult,
} from './panorama-capture'
import { CanvasAddPanel, CanvasToolRail, CanvasViewportControls } from './components/CanvasToolRail'
import { CanvasContextMenu, CanvasEmptyState, CanvasWireMenu } from './components/CanvasMenus'
import {
  CANVAS_CLIPBOARD_PREFIX,
  isCanvasClipboardMimeAvailable,
  isCanvasClipboardTextAvailable,
  resolveCanvasClipboardPasteSource,
} from './clipboard'
import { cloneCanvasNodeDataForNewNode } from './clone-node-data'
import {
  canvasEdgeToFlow,
  canvasNodeToFlow,
  canvasReplacementAccept,
  clampCanvasMenuPoint,
  createFlowNode,
  flowEdgeToCanvas,
  flowNodeToCanvas,
  isMatchingCanvasReplacementFile,
  mergeServerTerminalFlowNode,
  normalizeCanvasConnection,
  replaceCanvasNodeContent,
  shouldBlockCanvasShortcutWhileLocked,
  type CanvasContextMenuState,
  type CanvasFlowEdge,
  type CanvasFlowNode,
  type CanvasNodeMenuType,
  type CanvasReplaceableMediaType,
  type CanvasWireMenuState,
} from './editor-types'
import {
  arrangeCanvasGroupMembers,
  arrangeCanvasGroupNodes,
  arrangeCanvasNodes,
  canvasGroupIdsContainingMembers,
  fitCanvasGroupsToMembers,
} from './actions/layout'
import { reconcileDraggedNodeGroupMembership } from './actions/grouping'
import { CANVAS_REPLACE_CONTENT_EVENT, CreativeNode } from './nodes/CreativeNode'
import { GroupNode } from './nodes/GroupNode'
import { ProductionNode } from './nodes/ProductionNode'
import { PlaylistNode } from './nodes/PlaylistNode'
import { Studio3DNode } from './nodes/Studio3DNode'
import { CanvasStudio3DDialog } from './components/CanvasStudio3D'
import { canvasApi, CanvasRevisionConflictError } from './api/client'
import { useCanvasGraph } from './state/useCanvasSync'
import { useCanvasHistory, type CanvasEditorSnapshot } from './state/useCanvasHistory'
import { useCanvasAutosave } from './state/useCanvasAutosave'
import { canEditInfiniteCanvas } from './permissions'
import {
  findCanvasNodeIdsIntersectingRect,
  findSvgEdgeIdsIntersectingRect,
  normalizeScreenRect,
} from './edge-marquee'
import { resolveCanvasGeneratorAnchor } from './generator-anchor'
import {
  CANVAS_GENERATOR_PANEL_WIDTH_DEFAULT,
  CANVAS_GENERATOR_PANEL_WIDTH_STORAGE_KEY,
  clampCanvasGeneratorPanelWidth,
} from './generator-panel-width'
import {
  beginMiniMapDrag,
  miniMapFlowPointFromClient,
  miniMapViewportForPointer,
  type MiniMapDragState,
} from './minimap-drag'
import {
  resolveCanvasOperationResponse,
  type CanvasOperationTaskUpdate,
  type ResolvedCanvasOperation,
} from './operation-task-client'
import {
  chunkCanvasToolboxAssetIds,
  isCanvasToolboxAssetMissingTerminal,
  resolveCanvasToolboxAssetPollState,
} from './toolbox-asset-poll-state'
import {
  cancelCanvasGenerationTask,
  canvasGenerationTaskError,
  fetchCanvasGenerationTask,
  readCanvasGenerationSubmission,
  retryCanvasGenerationTask,
  type CanvasGenerationTaskUpdate,
} from './generation-task-client'
import {
  removeDisconnectedCanvasReferences,
  isCanvasPanoramaNodeData,
  prependCanvasGenerationHistory,
  resolveCanvasModel3DRegenerationOptions,
  resolveCanvasRegenerationMode,
  type Canvas,
  type CanvasDocumentInput,
  type CanvasGenerationHistoryItem,
  type CanvasGraphResponse,
  type CanvasNodeData,
  type CanvasPlaylistItem,
  type CanvasPlaylistRenderSummary,
  type CanvasPlaylistReviewSummary,
  type CanvasProjectOption,
  type CanvasRevision,
  type Viewport,
} from './types'
import {
  normalizeCanvasStudioScene,
  normalizeCanvasStudioSummary,
  type CanvasStudioCapture,
  type CanvasStudioCaptureDraft,
  type CanvasStudioCaptureSendResult,
  type CanvasStudioCaptureStageResult,
  type CanvasStudioSummary,
} from './studio-types'

const nodeTypes = {
  note: CreativeNode,
  text: CreativeNode,
  image: CreativeNode,
  video: CreativeNode,
  audio: CreativeNode,
  model_3d: CreativeNode,
  studio_3d: Studio3DNode,
  group: GroupNode,
  production_episode: ProductionNode,
  production_storyboard: ProductionNode,
  production_panel: ProductionNode,
  production_video: ProductionNode,
  playlist: PlaylistNode,
} as const

const CANVAS_NODE_SOFT_LIMIT = 500
const CANVAS_NODE_HARD_LIMIT = 1_000
const CANVAS_EDGE_HARD_LIMIT = 4_000
const CANVAS_POLL_FAILURE_LIMIT = 4
const CANVAS_UPLOAD_CONCURRENCY = 2
const CANVAS_UPLOAD_MAX_ATTEMPTS = 4

type Props = {
  projectId: string
  projectName: string
  canvasId: string
  focusNodeId?: string
  canvases: Canvas[]
  onSelectCanvas: (canvasId: string) => void
  onCreateCanvas: () => void
  onRenameCanvas: () => void
  onDeleteCanvas: () => void
  projectOptions?: CanvasProjectOption[]
  onSelectProject?: (projectId: string) => void
  canvasHomeHref?: string
  createProjectHref?: string
  onCanvasUpdated?: (canvas: Canvas) => void
}

type ClipboardDocument = { nodes: CanvasFlowNode[]; edges: CanvasFlowEdge[] }
type ToolboxAsset = {
  id: string
  type: 'image' | 'video' | 'audio' | 'model3d'
  status: string
  url: string | null
  resultUrl: string | null
  materialId: string | null
  materialMetadata?: Record<string, unknown> | null
  errorMessage: string | null
  params?: { thumbnailUrl?: string } | null
  createdAt: string
  task?: { id: string; status: string; progress: number; errorMessage: string | null } | null
}
type ImageOperationState = { mode: CanvasImageOperationMode; sourceNodeId: string; targetNodeId?: string }
type VideoOperationState = { mode: CanvasVideoOperationMode; sourceNodeId: string }

function isToolboxAssetType(value: string): value is ToolboxAsset['type'] {
  return value === 'image' || value === 'video' || value === 'audio' || value === 'model3d'
}

function snapshot(nodes: CanvasFlowNode[], edges: CanvasFlowEdge[], viewport: Viewport): CanvasEditorSnapshot {
  return { nodes: structuredClone(nodes), edges: structuredClone(edges), viewport: { ...viewport } }
}

function nodeSize(node: CanvasFlowNode) {
  return { width: node.width || node.measured?.width || 300, height: node.height || node.measured?.height || 200 }
}

function hasInputFocus() {
  const active = document.activeElement
  return active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || active instanceof HTMLSelectElement || (active instanceof HTMLElement && active.isContentEditable)
}

function visibleMenuPoint(x: number, y: number, height: number) {
  return clampCanvasMenuPoint(
    { x, y },
    { width: window.innerWidth, height: window.innerHeight },
    { width: 160, height },
  )
}

function getMediaType(node: CanvasFlowNode) {
  return node.data.mediaType || (node.type === 'note' ? 'text' : node.type === 'model_3d' ? 'model3d' : node.type) || 'image'
}

function canvasVideoUrl(node: CanvasFlowNode) {
  return node.data.videoUrl || (node.data.mediaType === 'video' ? node.data.contentUrl : null) || null
}

function canvasVideoDurationMs(node: CanvasFlowNode) {
  const metadata = node.data.sourceMetadata
  const metadataMs = Number(metadata?.durationMs)
  if (Number.isFinite(metadataMs) && metadataMs > 0) return Math.round(metadataMs)
  const metadataSeconds = Number(metadata?.durationSeconds)
  if (Number.isFinite(metadataSeconds) && metadataSeconds > 0) return Math.round(metadataSeconds * 1_000)
  const generationSeconds = node.data.generation?.duration
  return typeof generationSeconds === 'number' && Number.isFinite(generationSeconds) && generationSeconds > 0
    ? Math.round(generationSeconds * 1_000)
    : null
}

function isCanvasVideoSource(node: CanvasFlowNode) {
  return getMediaType(node) === 'video' || node.type === 'production_video' || Boolean(canvasVideoUrl(node))
}

function playlistItemFromNode(node: CanvasFlowNode): CanvasPlaylistItem {
  const durationMs = canvasVideoDurationMs(node)
  return {
    id: typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `playlist-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    sourceNodeId: node.id,
    materialId: node.data.materialId || null,
    title: node.data.title || '视频节点',
    videoUrl: canvasVideoUrl(node),
    posterUrl: node.data.posterUrl || node.data.imageUrl || null,
    sourceInMs: 0,
    sourceOutMs: durationMs,
    durationMs,
  }
}

function minimapNodeColor(node: CanvasFlowNode) {
  const type = getMediaType(node)
  if (node.type === 'group') return 'rgba(121, 139, 184, .34)'
  if (type === 'video') return '#c25591'
  if (type === 'audio') return '#d99a38'
  if (type === 'image') return '#4b84db'
  if (type === 'model3d') return '#45a77e'
  return '#8a76d8'
}

function getReplaceableMediaType(node: CanvasFlowNode): CanvasReplaceableMediaType | null {
  const type = getMediaType(node)
  return type === 'image' || type === 'video' || type === 'audio' || type === 'model3d' ? type : null
}

function safeFileName(value: string, fallback: string) {
  return value.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 100) || fallback
}

function extensionForNode(node: CanvasFlowNode) {
  const type = getMediaType(node)
  if (type === 'text') return 'txt'
  if (type === 'video') return 'mp4'
  if (type === 'audio') return 'mp3'
  if (type === 'model3d') return 'glb'
  return 'jpg'
}

function extraReferenceMaterialIds(node: CanvasFlowNode) {
  const parameters = node.data.generation?.parameters
  // maskMaterialId has dedicated inpaint semantics and must never be sent as
  // an ordinary reference image.
  const values = [parameters?.referenceMaterialId]
  return values.filter((value): value is string => typeof value === 'string' && Boolean(value.trim()))
}

function imageEditMaskMaterialId(node: CanvasFlowNode) {
  if (node.data.processType !== 'image_edit') return ''
  const value = node.data.generation?.parameters?.maskMaterialId
  return typeof value === 'string' ? value.trim() : ''
}

function createHistoryItem(request: CanvasGenerateRequest, assetId?: string, taskId?: string): CanvasGenerationHistoryItem {
  return {
    id: crypto.randomUUID(),
    assetId,
    taskId,
    prompt: request.prompt,
    modelKey: request.modelKey,
    parameters: {
      inputMode: request.inputMode,
      aspectRatio: request.aspectRatio,
      resolution: request.resolution,
      quality: request.quality,
      duration: request.duration,
      ...(request.fps ? { fps: request.fps } : {}),
      generateAudio: request.generateAudio,
      count: request.count,
      ...(request.type === 'audio' ? { audioMode: request.audioMode, voice: request.audioVoice } : {}),
    },
    references: request.referenceSummary || [],
    source: 'generation',
    status: 'pending',
    createdAt: new Date().toISOString(),
  }
}

function CanvasEditor({ projectId, projectName, canvases, initialGraph, focusNodeId, onSelectCanvas, onCreateCanvas, onRenameCanvas, onDeleteCanvas, projectOptions, onSelectProject, canvasHomeHref, createProjectHref, onCanvasUpdated }: Omit<Props, 'canvasId'> & { initialGraph: CanvasGraphResponse }) {
  const { data: session } = useSession()
  const readOnly = !canEditInfiniteCanvas(session?.user)
  const [nodes, setNodes] = useState<CanvasFlowNode[]>(() => initialGraph.nodes.map(canvasNodeToFlow))
  const [edges, setEdges] = useState<CanvasFlowEdge[]>(() => initialGraph.edges.map(canvasEdgeToFlow))
  const [viewport, setViewportState] = useState<Viewport>(() => initialGraph.canvas.viewport || { x: 0, y: 0, zoom: 1 })
  const [flow, setFlow] = useState<ReactFlowInstance<CanvasFlowNode, CanvasFlowEdge> | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [assetsOpen, setAssetsOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [minimapVisible, setMinimapVisible] = useState(true)
  const [organizeMode, setOrganizeMode] = useState<'grid' | 'horizontal' | 'vertical'>('horizontal')
  const [organizeOpen, setOrganizeOpen] = useState(false)
  const [layoutAnimating, setLayoutAnimating] = useState(false)
  const [contextMenu, setContextMenu] = useState<CanvasContextMenuState | null>(null)
  const [clipboardCanPaste, setClipboardCanPaste] = useState(false)
  const [wireMenu, setWireMenu] = useState<CanvasWireMenuState | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [generatorPanelWidth, setGeneratorPanelWidth] = useState(CANVAS_GENERATOR_PANEL_WIDTH_DEFAULT)
  const [historyNodeId, setHistoryNodeId] = useState<string | null>(null)
  const persistentPollFailuresRef = useRef(new Map<string, number>())
  const assetPollFailuresRef = useRef(new Map<string, number>())
  const assetMissingPollsRef = useRef(new Map<string, number>())
  const [revisionsOpen, setRevisionsOpen] = useState(false)
  const [revisions, setRevisions] = useState<CanvasRevision[]>([])
  const [revisionsLoading, setRevisionsLoading] = useState(false)
  const [revisionsError, setRevisionsError] = useState<string | null>(null)
  const [restoringRevisionId, setRestoringRevisionId] = useState<string | null>(null)
  const [imageOperation, setImageOperation] = useState<ImageOperationState | null>(null)
  const [videoOperation, setVideoOperation] = useState<VideoOperationState | null>(null)
  const [modelPreviewNodeId, setModelPreviewNodeId] = useState<string | null>(null)
  const [mediaPreviewNodeId, setMediaPreviewNodeId] = useState<string | null>(null)
  const [panoramaPreviewNodeId, setPanoramaPreviewNodeId] = useState<string | null>(null)
  const [studioNodeId, setStudioNodeId] = useState<string | null>(null)
  const [workflowGroupId, setWorkflowGroupId] = useState<string | null>(null)
  const [workflowRefreshKey, setWorkflowRefreshKey] = useState(0)
  const [imageEditNodeId, setImageEditNodeId] = useState<string | null>(null)
  const [conflictLoading, setConflictLoading] = useState(false)
  const [offlineRecoveryLoading, setOfflineRecoveryLoading] = useState(false)
  const [productionSyncing, setProductionSyncing] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [connectionActive, setConnectionActive] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const uploadRef = useRef<HTMLInputElement>(null)
  const replacementUploadRef = useRef<HTMLInputElement>(null)
  const replacementNodeIdRef = useRef<string | null>(null)
  const pendingInsertPositionRef = useRef<{ x: number; y: number } | null>(null)
  const pendingUploadPositionRef = useRef<{ x: number; y: number } | null>(null)
  const nodesRef = useRef(nodes)
  const edgesRef = useRef(edges)
  const viewportRef = useRef(viewport)
  const canvasRef = useRef(initialGraph.canvas)
  const clipboardRef = useRef<ClipboardDocument | null>(null)
  const resizeHistoryRef = useRef(new Set<string>())
  const dragRecordedRef = useRef(false)
  const rightPanGestureRef = useRef<{ pointerId: number; x: number; y: number; moved: boolean } | null>(null)
  const miniMapDragRef = useRef<{
    pointerId: number
    svg: SVGSVGElement
    panel: HTMLElement
    drag: MiniMapDragState
    size: { width: number; height: number }
  } | null>(null)
  const connectionActiveRef = useRef(false)
  const edgeSelectionGestureRef = useRef<{ pointerId: number; start: { x: number; y: number }; additive: boolean } | null>(null)
  const suppressContextMenuUntilRef = useRef(0)
  const groupDragRef = useRef<{ id: string; start: { x: number; y: number }; members: Map<string, { x: number; y: number }> } | null>(null)
  const altCopyRef = useRef<ClipboardDocument | null>(null)
  const materializingStoryboardTasksRef = useRef(new Set<string>())
  const layoutAnimationFrameRef = useRef<number | null>(null)
  const focusAppliedRef = useRef(false)
  const {
    canUndo,
    canRedo,
    record: recordHistory,
    undo: undoHistory,
    redo: redoHistory,
    reset: resetHistory,
  } = useCanvasHistory()

  useEffect(() => { nodesRef.current = nodes }, [nodes])
  useEffect(() => { edgesRef.current = edges }, [edges])
  useEffect(() => { viewportRef.current = viewport }, [viewport])
  useEffect(() => {
    if (!flow || !focusNodeId || focusAppliedRef.current) return
    const target = nodesRef.current.find((node) => node.id === focusNodeId)
    if (!target) return
    focusAppliedRef.current = true
    setNodes((current) => current.map((node) => ({ ...node, selected: node.id === focusNodeId })))
    window.requestAnimationFrame(() => void flow.fitView({ nodes: [target], padding: 0.58, duration: 320 }))
  }, [flow, focusNodeId])
  useEffect(() => () => {
    if (layoutAnimationFrameRef.current !== null) window.cancelAnimationFrame(layoutAnimationFrameRef.current)
  }, [])
  useEffect(() => {
    const restoreWidth = () => {
      const saved = window.localStorage.getItem(CANVAS_GENERATOR_PANEL_WIDTH_STORAGE_KEY)
      setGeneratorPanelWidth(clampCanvasGeneratorPanelWidth(saved, window.innerWidth))
    }
    restoreWidth()
    window.addEventListener('resize', restoreWidth)
    return () => window.removeEventListener('resize', restoreWidth)
  }, [])
  const updateGeneratorPanelWidth = useCallback((width: number) => {
    const next = clampCanvasGeneratorPanelWidth(width, window.innerWidth)
    setGeneratorPanelWidth(next)
    window.localStorage.setItem(CANVAS_GENERATOR_PANEL_WIDTH_STORAGE_KEY, String(next))
  }, [])
  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 2_200)
    return () => window.clearTimeout(timer)
  }, [toast])
  useEffect(() => {
    if (!readOnly) return
    setAddOpen(false)
    setAssetsOpen(false)
    setOrganizeOpen(false)
    setWireMenu(null)
    setPickerOpen(false)
    setImageOperation(null)
    setVideoOperation(null)
    setStudioNodeId(null)
    setWorkflowGroupId(null)
    setImageEditNodeId(null)
  }, [readOnly])

  const currentSnapshot = useCallback(() => snapshot(nodesRef.current, edgesRef.current, viewportRef.current), [])
  const applySnapshot = useCallback((next: CanvasEditorSnapshot) => {
    setNodes(next.nodes)
    setEdges(next.edges)
    setViewportState(next.viewport)
    viewportRef.current = next.viewport
    void flow?.setViewport(next.viewport, { duration: 180 })
  }, [flow])

  const handleSaved = useCallback((graph: CanvasGraphResponse) => {
    canvasRef.current = graph.canvas
    const serverById = new Map(graph.nodes.map((node) => {
      const flowNode = canvasNodeToFlow(node)
      return [flowNode.id, flowNode]
    }))
    let changed = false
    const projected = nodesRef.current.map((localNode) => {
      const serverNode = serverById.get(localNode.id)
      if (!serverNode) return localNode
      serverById.delete(localNode.id)
      const next = mergeServerTerminalFlowNode(localNode, serverNode)
      if (next !== localNode) changed = true
      return next
    })
    if (serverById.size > 0) {
      projected.push(...serverById.values())
      changed = true
    }
    if (changed) {
      nodesRef.current = projected
      setNodes(projected)
    }
    const localEdgeIds = new Set(edgesRef.current.map((edge) => edge.id))
    const serverAdditions = graph.edges
      .map(canvasEdgeToFlow)
      .filter((edge) => !localEdgeIds.has(edge.id))
    if (serverAdditions.length > 0) {
      const nextEdges = [...edgesRef.current, ...serverAdditions]
      edgesRef.current = nextEdges
      setEdges(nextEdges)
    }
    onCanvasUpdated?.(graph.canvas)
  }, [onCanvasUpdated])

  const loadGraph = useCallback((graph: CanvasGraphResponse) => {
    canvasRef.current = graph.canvas
    const nextNodes = graph.nodes.map(canvasNodeToFlow)
    const nextEdges = graph.edges.map(canvasEdgeToFlow)
    const nextViewport = graph.canvas.viewport || { x: 0, y: 0, zoom: 1 }
    setNodes(nextNodes)
    setEdges(nextEdges)
    setViewportState(nextViewport)
    viewportRef.current = nextViewport
    resetHistory()
    void flow?.setViewport(nextViewport, { duration: 180 })
    onCanvasUpdated?.(graph.canvas)
  }, [flow, onCanvasUpdated, resetHistory])

  const mergeDocument = useCallback((document: CanvasDocumentInput, graph: CanvasGraphResponse) => {
    const selectedById = new Map(nodesRef.current.map((node) => [node.id, node.selected === true]))
    const selectedEdges = new Set(edgesRef.current.filter((edge) => edge.selected).map((edge) => edge.id))
    const nextNodes = document.nodes.map((node) => ({
      ...canvasNodeToFlow(node),
      selected: selectedById.get(node.id) === true,
    }))
    const nextEdges = document.edges.map((edge) => ({
      ...canvasEdgeToFlow(edge),
      selected: selectedEdges.has(edge.id),
    }))
    nodesRef.current = nextNodes
    edgesRef.current = nextEdges
    viewportRef.current = document.viewport
    setNodes(nextNodes)
    setEdges(nextEdges)
    setViewportState(document.viewport)
    void flow?.setViewport(document.viewport, { duration: 120 })
    canvasRef.current = graph.canvas
    onCanvasUpdated?.(graph.canvas)
  }, [flow, onCanvasUpdated])

  const restoreOfflineDocument = useCallback((document: CanvasDocumentInput) => {
    const nextNodes = document.nodes.map(canvasNodeToFlow)
    const nextEdges = document.edges.map(canvasEdgeToFlow)
    const nextViewport = document.viewport
    nodesRef.current = nextNodes
    edgesRef.current = nextEdges
    viewportRef.current = nextViewport
    setNodes(nextNodes)
    setEdges(nextEdges)
    setViewportState(nextViewport)
    resetHistory()
    void flow?.setViewport(nextViewport, { duration: 180 })
  }, [flow, resetHistory])

  const buildDocument = useCallback((expectedRevision: number, clientId: string, changeSummary: string) => ({
    schema_version: CANVAS_DOCUMENT_SCHEMA_VERSION,
    expectedRevision,
    clientId,
    changeSummary,
    viewport: viewportRef.current,
    nodes: nodesRef.current.map((node) => flowNodeToCanvas(node, initialGraph.canvas.id)),
    edges: edgesRef.current.map((edge) => flowEdgeToCanvas(edge, initialGraph.canvas.id)),
  }), [initialGraph.canvas.id])

  const autosave = useCanvasAutosave({
    accountId: session?.user?.id || '',
    enabled: !readOnly,
    projectId,
    canvasId: initialGraph.canvas.id,
    initialRevision: initialGraph.canvas.revision,
    buildDocument,
    onSaved: handleSaved,
    onLoadServer: loadGraph,
    onMergeDocument: mergeDocument,
    onRestoreLocal: restoreOfflineDocument,
  })
  const offlineRecoveryBlocking = autosave.offlineRecoveryState !== 'none'
  const writeLocked = readOnly || productionSyncing || offlineRecoveryBlocking
  const scheduleAutosave = autosave.scheduleSave
  const flushAutosave = autosave.flush
  const autosaveRevision = autosave.revision
  const autosaveClientId = autosave.clientId
  const loadAutosaveServerVersion = autosave.loadServerVersion
  const mergeAutosaveServerVersion = autosave.mergeServerVersion
  const prepareGenerationSubmission = autosave.prepareRevisionedMutation
  const prepareProductionSync = autosave.prepareRevisionedMutation
  const acceptProductionSyncRevision = autosave.acceptExternalRevision
  const loadServerAfterSyncConflict = autosave.loadServerVersion

  const markChanged = useCallback((label: string) => scheduleAutosave(label), [scheduleAutosave])
  const record = useCallback((label: string) => recordHistory(label, currentSnapshot()), [currentSnapshot, recordHistory])

  const listPlaylistVideoSources = useCallback((): CanvasPlaylistVideoSource[] => (
    nodesRef.current
      .filter(isCanvasVideoSource)
      .map((node) => ({
        id: node.id,
        title: node.data.title || '视频节点',
        videoUrl: canvasVideoUrl(node),
        posterUrl: node.data.posterUrl || node.data.imageUrl || null,
        materialId: node.data.materialId || null,
        durationMs: canvasVideoDurationMs(node),
      }))
  ), [])

  const loadPlaylistReview = useCallback(async (nodeId: string): Promise<CanvasPlaylistReviewSummary> => {
    const response = await apiFetch(`/api/projects/${encodeURIComponent(projectId)}/canvas/${encodeURIComponent(initialGraph.canvas.id)}/nodes/${encodeURIComponent(nodeId)}/playlist-review`, { cache: 'no-store' })
    if (!response.ok) throw new Error(await readApiErrorMessage(response, '读取播放列表审核状态失败'))
    const payload = await response.json() as { review?: CanvasPlaylistReviewSummary }
    if (!payload.review) throw new Error('播放列表审核状态响应无效')
    return payload.review
  }, [initialGraph.canvas.id, projectId])

  const loadPlaylistRender = useCallback(async (nodeId: string): Promise<CanvasPlaylistRenderSummary> => {
    const response = await apiFetch(`/api/projects/${encodeURIComponent(projectId)}/canvas/${encodeURIComponent(initialGraph.canvas.id)}/nodes/${encodeURIComponent(nodeId)}/playlist-render`, { cache: 'no-store' })
    if (!response.ok) throw new Error(await readApiErrorMessage(response, '读取播放列表成片状态失败'))
    const payload = await response.json() as { render?: CanvasPlaylistRenderSummary }
    if (!payload.render) throw new Error('播放列表成片状态响应无效')
    return payload.render
  }, [initialGraph.canvas.id, projectId])

  const startPlaylistRender = useCallback(async (nodeId: string): Promise<CanvasPlaylistRenderSummary> => {
    if (readOnly) throw new Error('当前账号只有查看权限')
    await flushAutosave()
    const response = await apiFetch(`/api/projects/${encodeURIComponent(projectId)}/canvas/${encodeURIComponent(initialGraph.canvas.id)}/nodes/${encodeURIComponent(nodeId)}/playlist-render`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    if (!response.ok) throw new Error(await readApiErrorMessage(response, '启动播放列表成片渲染失败'))
    const payload = await response.json() as { render?: CanvasPlaylistRenderSummary }
    if (!payload.render) throw new Error('播放列表成片任务响应无效')
    setToast('已开始拼装播放列表成片')
    return payload.render
  }, [flushAutosave, initialGraph.canvas.id, projectId, readOnly])

  const submitPlaylistReview = useCallback(async (nodeId: string): Promise<CanvasPlaylistReviewSummary> => {
    if (readOnly) throw new Error('当前账号只有查看权限')
    await flushAutosave()
    const response = await apiFetch(`/api/projects/${encodeURIComponent(projectId)}/canvas/${encodeURIComponent(initialGraph.canvas.id)}/nodes/${encodeURIComponent(nodeId)}/playlist-review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    if (!response.ok) throw new Error(await readApiErrorMessage(response, '提交播放列表审核失败'))
    const payload = await response.json() as { review?: CanvasPlaylistReviewSummary }
    if (!payload.review) throw new Error('播放列表提交响应无效')
    setToast('播放列表已提交最终审核；审核员可在“我的任务”中查看')
    return payload.review
  }, [flushAutosave, initialGraph.canvas.id, projectId, readOnly])

  const animateNodeLayout = useCallback((
    buildTarget: (current: CanvasFlowNode[]) => CanvasFlowNode[],
    onComplete?: () => void,
  ) => {
    if (layoutAnimationFrameRef.current !== null) {
      window.cancelAnimationFrame(layoutAnimationFrameRef.current)
      layoutAnimationFrameRef.current = null
    }
    const source = nodesRef.current
    const target = buildTarget(source)
    const sourceById = new Map(source.map((node) => [node.id, node]))
    const targetById = new Map(target.map((node) => [node.id, node]))
    const changed = target.filter((node) => {
      const before = sourceById.get(node.id)
      return !before
        || Math.abs(before.position.x - node.position.x) > 0.01
        || Math.abs(before.position.y - node.position.y) > 0.01
        || Math.abs((before.width || before.measured?.width || 0) - (node.width || node.measured?.width || 0)) > 0.01
        || Math.abs((before.height || before.measured?.height || 0) - (node.height || node.measured?.height || 0)) > 0.01
    })

    const exactTarget = (current: CanvasFlowNode[]) => current.map((node) => {
      const next = targetById.get(node.id)
      if (!next) return node
      return {
        ...node,
        position: { ...next.position },
        width: next.width,
        height: next.height,
        data: node.type === 'group'
          ? { ...node.data, memberIds: next.data.memberIds }
          : node.data,
      }
    })
    const useReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
    if (changed.length === 0 || source.length !== target.length || useReducedMotion) {
      const next = exactTarget(source)
      nodesRef.current = next
      setNodes(next)
      setLayoutAnimating(false)
      onComplete?.()
      return
    }

    const maximumTravel = changed.reduce((maximum, node) => {
      const before = sourceById.get(node.id)
      return before ? Math.max(maximum, Math.hypot(node.position.x - before.position.x, node.position.y - before.position.y)) : maximum
    }, 0)
    const duration = Math.max(260, Math.min(460, 235 + Math.sqrt(maximumTravel) * 5.5))
    const startedAt = performance.now()
    setLayoutAnimating(true)

    const frame = (now: number) => {
      const progress = Math.min(1, Math.max(0, (now - startedAt) / duration))
      const eased = 1 - Math.pow(1 - progress, 4)
      setNodes((current) => {
        const next = current.map((node) => {
          const before = sourceById.get(node.id)
          const after = targetById.get(node.id)
          if (!before || !after) return node
          const fromWidth = before.width || before.measured?.width
          const toWidth = after.width || after.measured?.width
          const fromHeight = before.height || before.measured?.height
          const toHeight = after.height || after.measured?.height
          return {
            ...node,
            position: {
              x: before.position.x + (after.position.x - before.position.x) * eased,
              y: before.position.y + (after.position.y - before.position.y) * eased,
            },
            width: fromWidth && toWidth ? fromWidth + (toWidth - fromWidth) * eased : node.width,
            height: fromHeight && toHeight ? fromHeight + (toHeight - fromHeight) * eased : node.height,
            data: progress === 1 && node.type === 'group'
              ? { ...node.data, memberIds: after.data.memberIds }
              : node.data,
          }
        })
        nodesRef.current = next
        return next
      })
      if (progress < 1) {
        layoutAnimationFrameRef.current = window.requestAnimationFrame(frame)
        return
      }
      // Keep the guard for one paint so ResizeObserver dimensions emitted by
      // the final frame cannot be mistaken for a manual resize operation.
      layoutAnimationFrameRef.current = window.requestAnimationFrame(() => {
        layoutAnimationFrameRef.current = null
        setLayoutAnimating(false)
        onComplete?.()
      })
    }
    layoutAnimationFrameRef.current = window.requestAnimationFrame(frame)
  }, [])

  const syncProduction = useCallback(async () => {
    if (readOnly || productionSyncing) return
    setProductionSyncing(true)
    try {
      const syncInput = await prepareProductionSync()
      const graph = await canvasApi.syncProduction(projectId, initialGraph.canvas.id, syncInput)
      const accepted = await acceptProductionSyncRevision(syncInput.expectedRevision, graph.canvas.revision)
      if (!accepted) {
        await loadServerAfterSyncConflict()
        throw new CanvasRevisionConflictError('同步期间画布版本发生变化，已加载最新服务端版本，请重试同步。')
      }
      const syncedNodes = graph.nodes.map(canvasNodeToFlow)
      const syncedEdges = graph.edges.map(canvasEdgeToFlow)
      const productionCount = syncedNodes.filter((node) => node.type?.startsWith('production_')).length
      record('同步项目内容')
      nodesRef.current = syncedNodes
      edgesRef.current = syncedEdges
      setNodes(syncedNodes)
      setEdges(syncedEdges)
      canvasRef.current = graph.canvas
      onCanvasUpdated?.(graph.canvas)
      setToast(productionCount > 0 ? `已同步 ${productionCount} 个剧本、分镜和成片节点` : '项目暂无可同步的剧本或分镜内容')
    } catch (error) {
      setToast(error instanceof Error ? error.message : '同步项目内容失败')
    } finally {
      setProductionSyncing(false)
    }
  }, [acceptProductionSyncRevision, initialGraph.canvas.id, loadServerAfterSyncConflict, onCanvasUpdated, prepareProductionSync, productionSyncing, projectId, readOnly, record])
  const ensureNodeCapacity = useCallback((additional: number) => {
    const nextCount = nodesRef.current.length + additional
    if (nextCount > CANVAS_NODE_HARD_LIMIT) {
      setToast(`画布最多支持 ${CANVAS_NODE_HARD_LIMIT} 个节点，请先删除不需要的内容`)
      return false
    }
    if (nextCount > CANVAS_NODE_SOFT_LIMIT) setToast(`当前将达到 ${nextCount} 个节点，复杂画布可能影响操作流畅度`)
    return true
  }, [])

  const loadRevisions = useCallback(async () => {
    setRevisionsLoading(true)
    setRevisionsError(null)
    try {
      setRevisions(await canvasApi.listRevisions(projectId, initialGraph.canvas.id))
    } catch (error) {
      setRevisionsError(error instanceof Error ? error.message : '读取历史版本失败')
    } finally {
      setRevisionsLoading(false)
    }
  }, [initialGraph.canvas.id, projectId])

  const openRevisions = useCallback(() => {
    setRevisionsOpen(true)
    if (readOnly) {
      void loadRevisions()
      return
    }
    void flushAutosave().then(loadRevisions)
  }, [flushAutosave, loadRevisions, readOnly])

  const restoreRevision = useCallback(async (revision: CanvasRevision) => {
    if (readOnly || restoringRevisionId) return
    setRestoringRevisionId(revision.id)
    setRevisionsError(null)
    try {
      await canvasApi.restoreRevision(projectId, initialGraph.canvas.id, {
        snapshotId: revision.id,
        expectedRevision: autosaveRevision.current,
        clientId: autosaveClientId.current || crypto.randomUUID(),
      })
      await loadAutosaveServerVersion()
      await loadRevisions()
      setToast(`已恢复到版本 ${revision.revision}`)
    } catch (error) {
      setRevisionsError(error instanceof Error ? error.message : '恢复历史版本失败')
    } finally {
      setRestoringRevisionId(null)
    }
  }, [autosaveClientId, autosaveRevision, initialGraph.canvas.id, loadAutosaveServerVersion, loadRevisions, projectId, readOnly, restoringRevisionId])

  const undo = useCallback(() => {
    if (readOnly) return
    const next = undoHistory(currentSnapshot())
    if (!next) return
    applySnapshot(next)
    markChanged('撤销')
  }, [applySnapshot, currentSnapshot, markChanged, readOnly, undoHistory])

  const redo = useCallback(() => {
    if (readOnly) return
    const next = redoHistory(currentSnapshot())
    if (!next) return
    applySnapshot(next)
    markChanged('重做')
  }, [applySnapshot, currentSnapshot, markChanged, readOnly, redoHistory])

  const updateNodeData = useCallback((nodeId: string, patch: Partial<CanvasNodeData>, historyLabel?: string) => {
    if (readOnly) return
    if (historyLabel) record(historyLabel)
    setNodes((current) => current.map((node) => node.id === nodeId ? { ...node, data: { ...node.data, ...patch } } : node))
    markChanged(historyLabel || '更新节点配置')
  }, [markChanged, readOnly, record])

  const cleanupDisconnectedReferences = useCallback((removedEdges: CanvasFlowEdge[], remainingEdges: CanvasFlowEdge[]) => {
    if (removedEdges.length === 0) return
    setNodes((current) => current.map((node) => {
      const referenceNodeIds = node.data.generation?.referenceNodeIds
      const nextReferenceNodeIds = removeDisconnectedCanvasReferences(referenceNodeIds, node.id, removedEdges, remainingEdges)
      if (nextReferenceNodeIds === referenceNodeIds) return node
      return {
        ...node,
        data: {
          ...node.data,
          generation: { ...(node.data.generation || {}), referenceNodeIds: nextReferenceNodeIds },
        },
      }
    }))
  }, [])

  const commitEdgeRemoval = useCallback((removedEdges: CanvasFlowEdge[], remainingEdges: CanvasFlowEdge[]) => {
    if (readOnly || removedEdges.length === 0) return
    record('删除连线')
    edgesRef.current = remainingEdges
    setEdges(remainingEdges)
    cleanupDisconnectedReferences(removedEdges, remainingEdges)
    markChanged('删除连线')
  }, [cleanupDisconnectedReferences, markChanged, readOnly, record])

  const removeEdgesById = useCallback((edgeIds: string[]) => {
    const ids = new Set(edgeIds)
    const removedEdges = edgesRef.current.filter((edge) => ids.has(edge.id))
    if (removedEdges.length === 0) return
    const remainingEdges = edgesRef.current.filter((edge) => !ids.has(edge.id))
    commitEdgeRemoval(removedEdges, remainingEdges)
  }, [commitEdgeRemoval])

  const selectElementsCoveredByRect = useCallback((
    start: { x: number; y: number },
    end: { x: number; y: number },
    additive = false,
  ) => {
    const wrapper = wrapperRef.current
    if (!wrapper) return
    const selectionRect = normalizeScreenRect(start, end, 3)
    const selectedNodeIds = new Set(findCanvasNodeIdsIntersectingRect(wrapper, selectionRect))
    const selectedEdgeIds = new Set(findSvgEdgeIdsIntersectingRect(wrapper, selectionRect))
    setNodes((current) => current.map((node) => {
      const selected = node.type === 'group'
        ? Boolean(additive && node.selected)
        : selectedNodeIds.has(node.id) || Boolean(additive && node.selected)
      return node.selected === selected ? node : { ...node, selected }
    }))
    const next = edgesRef.current.map((edge) => {
      const selected = selectedEdgeIds.has(edge.id) || Boolean(additive && edge.selected)
      return edge.selected === selected ? edge : { ...edge, selected }
    })
    edgesRef.current = next
    setEdges(next)
    if (selectedNodeIds.size > 0 || selectedEdgeIds.size > 0) {
      const parts = [
        selectedNodeIds.size > 0 ? `${selectedNodeIds.size} 个节点` : '',
        selectedEdgeIds.size > 0 ? `${selectedEdgeIds.size} 条连线` : '',
      ].filter(Boolean)
      setToast(`已框选 ${parts.join('、')}`)
    }
  }, [])

  const expandGroupNodeIds = useCallback((requestedIds: string[]) => {
    const expanded = new Set(requestedIds)
    for (const node of nodesRef.current) {
      if (expanded.has(node.id) && node.type === 'group') (node.data.memberIds || []).forEach((id) => expanded.add(id))
    }
    return expanded
  }, [])

  const removeNodes = useCallback((nodeIds: string[]) => {
    if (readOnly || nodeIds.length === 0) return
    record('删除节点')
    const ids = new Set(nodeIds)
    setNodes((current) => fitCanvasGroupsToMembers(current.filter((node) => !ids.has(node.id)).map((node) => node.type === 'group' ? { ...node, data: { ...node.data, memberIds: (node.data.memberIds || []).filter((id) => !ids.has(id)) } } : node)))
    const removedEdges = edgesRef.current.filter((edge) => ids.has(edge.source) || ids.has(edge.target))
    const remainingEdges = edgesRef.current.filter((edge) => !ids.has(edge.source) && !ids.has(edge.target))
    edgesRef.current = remainingEdges
    setEdges(remainingEdges)
    cleanupDisconnectedReferences(removedEdges, remainingEdges)
    markChanged('删除节点')
  }, [cleanupDisconnectedReferences, markChanged, readOnly, record])

  const removeGroupsWithMembers = useCallback((groupIds: string[], extraNodeIds: string[] = []) => {
    if (readOnly) return
    const expanded = expandGroupNodeIds([...groupIds, ...extraNodeIds])
    if (expanded.size === 0) return
    record('删除组及成员')
    setNodes((current) => fitCanvasGroupsToMembers(current.filter((node) => !expanded.has(node.id)).map((node) => node.type === 'group' ? { ...node, data: { ...node.data, memberIds: (node.data.memberIds || []).filter((id) => !expanded.has(id)) } } : node)))
    const removedEdges = edgesRef.current.filter((edge) => expanded.has(edge.source) || expanded.has(edge.target))
    const remainingEdges = edgesRef.current.filter((edge) => !expanded.has(edge.source) && !expanded.has(edge.target))
    edgesRef.current = remainingEdges
    setEdges(remainingEdges)
    cleanupDisconnectedReferences(removedEdges, remainingEdges)
    markChanged('删除组及成员')
    setToast(`已删除组及 ${Math.max(0, expanded.size - groupIds.length)} 个节点`)
  }, [cleanupDisconnectedReferences, expandGroupNodeIds, markChanged, readOnly, record])

  const removeCurrentSelection = useCallback(() => {
    if (readOnly) return
    const selectedNodes = nodesRef.current.filter((node) => node.selected)
    const selectedEdgeIds = edgesRef.current.filter((edge) => edge.selected).map((edge) => edge.id)
    if (selectedNodes.length > 0) {
      const groupIds = selectedNodes.filter((node) => node.type === 'group').map((node) => node.id)
      const otherIds = selectedNodes.filter((node) => node.type !== 'group').map((node) => node.id)
      if (groupIds.length) removeGroupsWithMembers(groupIds, otherIds)
      else removeNodes(otherIds)
    }
    // Node deletion already removes incident edges. This pass also deletes
    // independently box-selected wires whose endpoints were not selected.
    if (selectedEdgeIds.length > 0) removeEdgesById(selectedEdgeIds)
  }, [readOnly, removeEdgesById, removeGroupsWithMembers, removeNodes])

  const duplicateNodes = useCallback((requestedIds: string[]) => {
    if (readOnly) return
    const expanded = expandGroupNodeIds(requestedIds)
    const originals = nodesRef.current.filter((node) => expanded.has(node.id))
    if (originals.length === 0) return
    if (!ensureNodeCapacity(originals.length)) return
    const includesGroup = requestedIds.some((id) => nodesRef.current.some((node) => node.id === id && node.type === 'group'))
    const sourceEdges = edgesRef.current.filter((edge) => includesGroup ? expanded.has(edge.source) && expanded.has(edge.target) : expanded.has(edge.target))
    const copiedEdgeCount = sourceEdges.length
    if (edgesRef.current.length + copiedEdgeCount > CANVAS_EDGE_HARD_LIMIT) { setToast('连线数量将超过 4000 条上限'); return }
    record('创建副本')
    const idMap = new Map(originals.map((node) => [node.id, crypto.randomUUID()]))
    const clones = originals.map((node) => ({ ...structuredClone(node), id: idMap.get(node.id)!, position: { x: node.position.x + 42, y: node.position.y + 42 }, selected: true, data: cloneCanvasNodeDataForNewNode(node.data, (id) => idMap.get(id)) }))
    const copiedEdges = sourceEdges.map((edge) => ({ ...structuredClone(edge), id: crypto.randomUUID(), source: idMap.get(edge.source) || edge.source, target: idMap.get(edge.target) || edge.target, type: 'bezier', selected: false }))
    setNodes((current) => [...current.map((node) => ({ ...node, selected: false })), ...clones])
    setEdges((current) => [...current, ...copiedEdges])
    markChanged('创建副本')
    setToast(`已复制 ${clones.length} 个节点`)
  }, [ensureNodeCapacity, expandGroupNodeIds, markChanged, readOnly, record])

  const centerPosition = useCallback(() => {
    const rect = wrapperRef.current?.getBoundingClientRect()
    return flow && rect ? flow.screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }) : { x: 280, y: 220 }
  }, [flow])

  const addNode = useCallback((type: CanvasNodeMenuType, position = centerPosition()) => {
    if (readOnly) return null
    if (!ensureNodeCapacity(1)) return null
    record('添加节点')
    const node = createFlowNode(type, position)
    node.position = {
      x: position.x - (node.width || 300) / 2,
      y: position.y - (node.height || 200) / 2,
    }
    setNodes((current) => [...current.map((item) => ({ ...item, selected: false })), node])
    markChanged('添加节点')
    setAddOpen(false)
    setWireMenu(null)
    return node
  }, [centerPosition, ensureNodeCapacity, markChanged, readOnly, record])

  const createGroup = useCallback(() => {
    const members = nodesRef.current.filter((node) => node.selected && node.type !== 'group')
    if (members.length < 2 || readOnly) return
    if (!ensureNodeCapacity(1)) return
    record('创建组')
    const left = Math.min(...members.map((node) => node.position.x)) - 42
    const top = Math.min(...members.map((node) => node.position.y)) - 64
    const right = Math.max(...members.map((node) => node.position.x + nodeSize(node).width)) + 42
    const bottom = Math.max(...members.map((node) => node.position.y + nodeSize(node).height)) + 42
    const group: CanvasFlowNode = { id: crypto.randomUUID(), type: 'group', position: { x: left, y: top }, width: right - left, height: bottom - top, zIndex: -10, selected: true, data: { title: '组', memberIds: members.map((node) => node.id), groupColor: null, __server: { status: 'IDLE', taskId: null, runId: null, mediaObjectId: null, parentNodeId: null } } }
    const memberIds = new Set(members.map((node) => node.id))
    setNodes((current) => {
      const affectedGroupIds = canvasGroupIdsContainingMembers(current, memberIds)
      const affectedGroupIdSet = new Set(affectedGroupIds)
      const detached = current.map((node) => node.type === 'group'
        ? { ...node, selected: false, data: { ...node.data, memberIds: (node.data.memberIds || []).filter((id) => !memberIds.has(id)) } }
        : { ...node, selected: false }).filter((node) => (
        node.type !== 'group'
        || !affectedGroupIdSet.has(node.id)
        || Boolean(node.data.memberIds?.length)
      ))
      return [...fitCanvasGroupsToMembers(detached, affectedGroupIds), group]
    })
    markChanged('创建组')
  }, [ensureNodeCapacity, markChanged, readOnly, record])

  const organize = useCallback((mode: 'grid' | 'horizontal' | 'vertical') => {
    if (readOnly || nodesRef.current.filter((node) => node.type !== 'group').length === 0) return
    record('整理画布')
    animateNodeLayout(
      (current) => arrangeCanvasNodes(current, edgesRef.current, mode),
      () => window.requestAnimationFrame(() => void flow?.fitView({ padding: 0.18, duration: 260 })),
    )
    setOrganizeMode(mode)
    markChanged('整理画布')
    setOrganizeOpen(false)
    setToast(mode === 'horizontal' ? '已按连线从左到右整理画布' : mode === 'vertical' ? '已按连线从上到下整理画布' : '已完成网格整理')
  }, [animateNodeLayout, flow, markChanged, readOnly, record])

  const organizeSelection = useCallback((mode: 'horizontal' | 'vertical') => {
    if (readOnly) return
    const selected = nodesRef.current.filter((node) => node.selected && node.type !== 'group')
    if (selected.length < 2) {
      setToast('请至少选择两个可排列节点')
      return
    }
    record('排列选中节点')
    const selectedIds = new Set(selected.map((node) => node.id))
    animateNodeLayout((current) => {
      const arranged = arrangeCanvasGroupNodes(
        current.filter((node) => selectedIds.has(node.id)),
        mode,
        edgesRef.current,
      )
      const positions = new Map(arranged.map((node) => [node.id, node.position]))
      const moved = current.map((node) => positions.has(node.id) ? { ...node, position: positions.get(node.id)! } : node)
      return fitCanvasGroupsToMembers(moved, canvasGroupIdsContainingMembers(current, selectedIds))
    })
    markChanged('排列选中节点')
    setToast(mode === 'horizontal' ? '已水平排列选中节点' : '已按连线顺序纵向整理选中节点')
  }, [animateNodeLayout, markChanged, readOnly, record])

  const nudgeSelection = useCallback((delta: { x: number; y: number }) => {
    if (readOnly) return
    const requestedIds = nodesRef.current.filter((node) => node.selected).map((node) => node.id)
    if (requestedIds.length === 0) return
    const movedIds = expandGroupNodeIds(requestedIds)
    const movedGroupIds = new Set(nodesRef.current.filter((node) => movedIds.has(node.id) && node.type === 'group').map((node) => node.id))
    record('移动选中节点')
    setNodes((current) => {
      const moved = current.map((node) => movedIds.has(node.id)
        ? { ...node, position: { x: node.position.x + delta.x, y: node.position.y + delta.y } }
        : node)
      const reconciled = reconcileDraggedNodeGroupMembership(moved, requestedIds)
      const affectedGroupIds = canvasGroupIdsContainingMembers(reconciled, movedIds).filter((id) => !movedGroupIds.has(id))
      return fitCanvasGroupsToMembers(reconciled, affectedGroupIds)
    })
    markChanged('移动选中节点')
  }, [expandGroupNodeIds, markChanged, readOnly, record])

  const validateConnection = useCallback((connection: Connection | CanvasFlowEdge, pendingNodes: CanvasFlowNode[] = []) => {
    if (readOnly) return false
    const normalized = normalizeCanvasConnection(connection)
    if (!normalized?.source || !normalized.target || normalized.source === normalized.target) return false
    if (edgesRef.current.length >= CANVAS_EDGE_HARD_LIMIT) return false
    if (edgesRef.current.some((edge) => (
      (edge.source === normalized.source && edge.target === normalized.target)
      || (edge.source === normalized.target && edge.target === normalized.source)
    ))) return false
    const source = nodesRef.current.find((node) => node.id === normalized.source) || pendingNodes.find((node) => node.id === normalized.source)
    const target = nodesRef.current.find((node) => node.id === normalized.target) || pendingNodes.find((node) => node.id === normalized.target)
    if (!source || !target || source.type === 'group' || target.type === 'group') return false
    if (target.type === 'playlist') return isCanvasVideoSource(source)
    if (source.type === 'playlist') return false
    const sourceType = getMediaType(source)
    const targetType = getMediaType(target)
    if (target.data.origin === 'upload' && targetType !== 'text') return false
    if (targetType === 'text' && sourceType !== 'text') return false
    if (targetType === 'image' && (sourceType === 'video' || sourceType === 'audio')) return false
    if (target.type === 'studio_3d' && sourceType !== 'image' && sourceType !== 'model3d') return false
    return true
  }, [readOnly])

  const connect = useCallback((connection: Connection, pendingNodes: CanvasFlowNode[] = []) => {
    const normalized = normalizeCanvasConnection(connection)
    if (readOnly || !normalized?.source || !normalized.target || !validateConnection(normalized, pendingNodes)) return
    record('添加连线')
    const edge: CanvasFlowEdge = { id: crypto.randomUUID(), source: normalized.source, target: normalized.target, sourceHandle: 'output', targetHandle: 'input', type: 'bezier', data: { role: 'INPUT_DEFAULT' } }
    setEdges((current) => [...current, edge])
    const source = nodesRef.current.find((node) => node.id === normalized.source) || pendingNodes.find((node) => node.id === normalized.source)
    const target = nodesRef.current.find((node) => node.id === normalized.target) || pendingNodes.find((node) => node.id === normalized.target)
    if (source && target?.type === 'playlist' && isCanvasVideoSource(source)) {
      setNodes((current) => current.map((node) => {
        if (node.id !== target.id) return node
        const existing = Array.isArray(node.data.playlistItems) ? node.data.playlistItems : []
        if (existing.some((item) => item?.sourceNodeId === source.id)) return node
        return { ...node, data: { ...node.data, playlistItems: [...existing, playlistItemFromNode(source)] } }
      }))
    }
    markChanged('添加连线')
  }, [markChanged, readOnly, record, validateConnection])

  const copySelection = useCallback(async (cut = false, requestedNodeIds?: string[]) => {
    const requested = requestedNodeIds || nodesRef.current.filter((node) => node.selected).map((node) => node.id)
    if (requested.length === 0) return
    const expanded = expandGroupNodeIds(requested)
    const selected = nodesRef.current.filter((node) => expanded.has(node.id))
    const ids = new Set(selected.map((node) => node.id))
    const payload = { nodes: structuredClone(selected), edges: structuredClone(edgesRef.current.filter((edge) => ids.has(edge.source) && ids.has(edge.target))) }
    clipboardRef.current = payload
    setClipboardCanPaste(true)
    await navigator.clipboard?.writeText(`${CANVAS_CLIPBOARD_PREFIX}${JSON.stringify(payload)}`).catch(() => undefined)
    if (cut) removeNodes([...ids])
    else setToast(`已复制 ${selected.length} 个节点`)
  }, [expandGroupNodeIds, removeNodes])

  const refreshClipboardAvailability = useCallback(async () => {
    const text = await navigator.clipboard?.readText().catch(() => '') || ''
    if (isCanvasClipboardTextAvailable(text)) {
      setClipboardCanPaste(true)
      return
    }
    const items = await navigator.clipboard?.read?.().catch(() => []) || []
    const hasSystemMedia = items.some((item) => isCanvasClipboardMimeAvailable(item.types))
    setClipboardCanPaste(hasSystemMedia || Boolean(clipboardRef.current?.nodes.length))
  }, [])

  const paste = useCallback(async (position?: { x: number; y: number }) => {
    if (readOnly) return
    const systemText = await (async () => {
      try {
        const value = await navigator.clipboard?.readText()
        return { readable: typeof value === 'string', value: value || '' }
      } catch {
        return { readable: false, value: '' }
      }
    })()
    let payload: ClipboardDocument | null = null
    const source = resolveCanvasClipboardPasteSource({
      hasSystemMedia: false,
      systemTextReadable: systemText.readable,
      systemText: systemText.value,
      hasInternalCanvas: Boolean(clipboardRef.current?.nodes.length),
    })
    if (source === 'system-canvas') {
      try {
        payload = JSON.parse(systemText.value.slice(CANVAS_CLIPBOARD_PREFIX.length)) as ClipboardDocument
        clipboardRef.current = payload
      } catch {
        setToast('系统剪贴板中的画布数据已损坏')
        return
      }
    } else if (source === 'system-text') {
      const created = addNode('text', position || centerPosition())
      if (created) updateNodeData(created.id, { text: systemText.value.trim(), origin: 'upload', title: '粘贴文本' })
      return
    } else if (source === 'internal-canvas') {
      payload = clipboardRef.current
    } else {
      return
    }
    if (!payload?.nodes.length) return
    if (!ensureNodeCapacity(payload.nodes.length)) return
    if (edgesRef.current.length + payload.edges.length > CANVAS_EDGE_HARD_LIMIT) { setToast('粘贴后的连线数量将超过 4000 条上限'); return }
    record('粘贴节点')
    const idMap = new Map(payload.nodes.map((node) => [node.id, crypto.randomUUID()]))
    const minX = Math.min(...payload.nodes.map((node) => node.position.x))
    const minY = Math.min(...payload.nodes.map((node) => node.position.y))
    const anchor = position || { x: minX + 48, y: minY + 48 }
    const pasted = payload.nodes.map((node) => ({ ...structuredClone(node), id: idMap.get(node.id)!, position: { x: anchor.x + node.position.x - minX, y: anchor.y + node.position.y - minY }, selected: true, data: cloneCanvasNodeDataForNewNode(node.data, (id) => idMap.get(id)) }))
    const pastedEdges = payload.edges.map((edge) => ({ ...structuredClone(edge), id: crypto.randomUUID(), source: idMap.get(edge.source)!, target: idMap.get(edge.target)!, selected: false }))
    setNodes((current) => [...current.map((node) => ({ ...node, selected: false })), ...pasted])
    setEdges((current) => [...current, ...pastedEdges])
    markChanged('粘贴节点')
  }, [addNode, centerPosition, ensureNodeCapacity, markChanged, readOnly, record, updateNodeData])

  const ensureReferenceMaterialIds = useCallback(async (referenceNodeIds: string[]) => {
    const orderedNodeIds = Array.from(new Set(referenceNodeIds))
    if (orderedNodeIds.length === 0) return []
    const materialByNodeId = new Map<string, string>()
    const missingNodeIds: string[] = []
    for (const nodeId of orderedNodeIds) {
      const materialId = nodesRef.current.find((node) => node.id === nodeId)?.data.materialId
      if (typeof materialId === 'string' && materialId.trim()) materialByNodeId.set(nodeId, materialId.trim())
      else missingNodeIds.push(nodeId)
    }
    if (missingNodeIds.length > 0) {
      const response = await apiFetch(`/api/projects/${projectId}/canvas/${initialGraph.canvas.id}/materials`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodeIds: missingNodeIds }),
      })
      if (!response.ok) throw new Error(await readApiErrorMessage(response, '无法建立画布素材引用'))
      const payload = await response.json() as { materialByNodeId?: Record<string, string> }
      Object.entries(payload.materialByNodeId || {}).forEach(([nodeId, materialId]) => {
        if (materialId?.trim()) materialByNodeId.set(nodeId, materialId.trim())
      })
    }
    const resolved = orderedNodeIds.map((nodeId) => materialByNodeId.get(nodeId)).filter((value): value is string => Boolean(value))
    if (resolved.length !== orderedNodeIds.length) throw new Error('部分 @ 引用素材尚未准备完成，请刷新素材后重试')
    return resolved
  }, [initialGraph.canvas.id, projectId])

  const handleGenerate = useCallback(async (request: CanvasGenerateRequest) => {
    if (readOnly) return
    const target = nodesRef.current.find((node) => node.id === request.nodeId)
    if (!target) throw new Error('节点不存在或已被删除')
    const additionalNodes = request.storyboard ? request.count : request.type === 'image' ? Math.max(0, request.count - 1) : 0
    if (!ensureNodeCapacity(additionalNodes)) throw new Error('画布节点数量已达到上限')
    // Ordinary multi-image generation is materialized by the server. Flush
    // real user edits before showing an optimistic state, then never persist
    // that unbound RUNNING placeholder over the server's task/asset binding.
    // Persist real edits before exposing any optimistic RUNNING state.  Every
    // generation API binds its durable task/asset on the server; autosaving an
    // unbound placeholder while submission is in flight could otherwise erase
    // that binding after a slow or ambiguously failed response.
    const preparedRevision = await prepareGenerationSubmission()
    const selectedReferenceMaterialIds = request.type === 'text'
      ? []
      : await ensureReferenceMaterialIds(request.referenceNodeIds)
    const multiImageRevision = request.type === 'image' && !request.storyboard && request.count > 1
      ? preparedRevision
      : null
    record('提交生成')
    const generationParameters = { ...(target.data.generation?.parameters || {}) }
    if (request.type === 'video') {
      if (request.fps) generationParameters.fps = request.fps
      else delete generationParameters.fps
    }
    const generation = {
      ...(target.data.generation || {}),
      modelKey: request.modelKey,
      modelLabel: request.modelLabel,
      referenceNodeIds: request.referenceNodeIds,
      referenceSummary: request.referenceSummary || [],
      inputMode: request.inputMode,
      aspectRatio: request.aspectRatio,
      resolution: request.resolution,
      ...(request.type === 'image' ? { quality: request.quality } : {}),
      duration: request.duration,
      generateAudio: request.generateAudio,
      count: request.count,
      parameters: request.type === 'audio'
        ? { ...(target.data.generation?.parameters || {}), mode: request.audioMode, voice: request.audioVoice, genre: request.audioGenre, sfxKind: request.audioSfxKind }
        : request.type === 'model3d'
          ? { ...(target.data.generation?.parameters || {}), topology: request.model3dTopology || 'standard', generateTexture: request.model3dGenerateTexture !== false, pose: request.model3dPose || 'none' }
          : request.type === 'video'
            ? generationParameters
            : target.data.generation?.parameters,
    }
    if (request.storyboard || multiImageRevision) {
      delete generation.assetId
      delete generation.taskId
    }
    setNodes((current) => current.map((node) => node.id === target.id ? { ...node, data: { ...node.data, prompt: request.prompt, generation, progress: 2, errorMessage: null, pollErrorMessage: null, __server: { ...node.data.__server!, status: 'RUNNING' } } } : node))
    const restoreAuthoritativeTarget = async () => {
      try {
        await loadAutosaveServerVersion()
        setNodes((current) => current.map((node) => node.id === target.id
          ? { ...node, selected: true }
          : { ...node, selected: false }))
      } catch {
        // Keep the unsaved optimistic state visible when the graph cannot be
        // reloaded.  It is intentionally not queued for autosave, so a later
        // refresh/reconnect can still recover the server-owned task binding.
      }
    }

    if (request.type === 'text') {
      try {
        const response = await apiFetch(`/api/projects/${projectId}/canvas/${initialGraph.canvas.id}/generate-text`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nodeId: target.id, prompt: request.prompt, modelKey: request.modelKey }) })
        const submission = await readCanvasGenerationSubmission(response)
        const item: CanvasGenerationHistoryItem = {
          ...createHistoryItem(request, undefined, submission.taskId),
          status: 'processing',
        }
        setNodes((current) => current.map((node) => node.id === target.id ? {
          ...node,
          data: {
            ...node.data,
            prompt: request.prompt,
            generation: { ...generation, taskId: submission.taskId },
            generationTask: { kind: 'text', taskId: submission.taskId, submittedAt: new Date().toISOString() },
            progress: submission.update.task.progress,
            errorMessage: null,
            history: prependCanvasGenerationHistory(item, node.data.history),
            __server: {
              ...node.data.__server!,
              status: 'RUNNING',
              taskId: submission.taskId,
              runId: submission.runId,
            },
          },
        } : node))
        markChanged('文本生成任务已提交')
        setToast('文本生成已进入后台，刷新页面后会继续恢复')
      } catch (error) {
        await restoreAuthoritativeTarget()
        throw error
      }
      return
    }
    if (request.type === 'image' && request.storyboard) {
      try {
        const referenceMaterialIds = Array.from(new Set([...selectedReferenceMaterialIds, ...extraReferenceMaterialIds(target)]))
        const planResponse = await apiFetch(`/api/projects/${projectId}/canvas/${initialGraph.canvas.id}/generate-storyboard`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            nodeId: target.id,
            prompt: request.prompt,
            count: request.count,
            modelKey: request.modelKey,
            modelLabel: request.modelLabel,
            referenceNodeIds: request.referenceNodeIds,
            referenceMaterialIds,
            inputMode: request.inputMode,
            aspectRatio: request.aspectRatio,
            resolution: request.resolution,
            quality: request.quality,
          }),
        })
        const submission = await readCanvasGenerationSubmission(planResponse)
        setNodes((current) => current.map((node) => node.id === target.id ? {
          ...node,
          data: {
            ...node.data,
            prompt: request.prompt,
            processType: 'storyboard',
            generation: { ...generation, taskId: submission.taskId },
            generationTask: { kind: 'storyboard_plan', taskId: submission.taskId, submittedAt: new Date().toISOString() },
            progress: submission.update.task.progress,
            errorMessage: null,
            __server: {
              ...node.data.__server!,
              status: 'RUNNING',
              taskId: submission.taskId,
              runId: submission.runId,
            },
          },
        } : node))
        markChanged('连续故事版规划任务已提交')
        setToast('故事版正在后台规划，完成后会自动提交镜头图片')
      } catch (error) {
        await restoreAuthoritativeTarget()
        throw error
      }
      return
    }
    if (request.type !== 'image' && request.type !== 'video' && request.type !== 'audio' && request.type !== 'model3d') throw new Error('当前生成类型尚未配置可用服务')
    const referenceMaterialIds = Array.from(new Set([
      ...selectedReferenceMaterialIds,
      ...(request.inputMode === 'firstlastframe' ? [] : extraReferenceMaterialIds(target)),
    ]))
    const referenceMaterials = buildCanvasGenerationMaterialReferences(referenceMaterialIds, request.inputMode)
    const maskMaterialId = imageEditMaskMaterialId(target)
    const processType = target.data.processType === 'image_edit'
      ? 'image_edit'
      : isCanvasPanoramaNodeData(target.data)
        ? CANVAS_PANORAMA_PROCESS_TYPE
        : null
    const submissionBody = JSON.stringify({ projectId, canvasId: initialGraph.canvas.id, nodeId: target.id, type: request.type, title: target.data.title || (request.type === 'image' ? '画布图片' : request.type === 'video' ? '画布视频' : request.type === 'model3d' ? '画布 3D 模型' : '画布音频'), prompt: request.prompt, modelKey: request.modelKey, ...(processType ? { processType, ...(processType === 'image_edit' ? { maskMaterialId } : {}) } : {}), referenceMaterialIds, referenceMaterials, count: request.type === 'image' ? request.count : 1, inputMode: request.inputMode, idempotencyKey: crypto.randomUUID(), ...(multiImageRevision ? { expectedRevision: multiImageRevision.expectedRevision, clientId: multiImageRevision.clientId } : {}), options: { aspectRatio: request.aspectRatio, resolution: request.resolution, quality: request.quality, duration: request.duration, ...(request.fps ? { fps: request.fps } : {}), generateAudio: request.generateAudio, mode: request.audioMode, voice: request.audioVoice, genre: request.audioGenre, sfxKind: request.audioSfxKind, topology: request.model3dTopology || 'standard', generateTexture: request.model3dGenerateTexture !== false, pose: request.model3dPose || 'none' } })
    const submitMediaRequest = () => apiFetch(`/api/projects/${projectId}/canvas/${initialGraph.canvas.id}/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: submissionBody })
    let response: Response
    try {
      response = await submitMediaRequest()
    } catch {
      try {
        response = await submitMediaRequest()
      } catch (error) {
        await restoreAuthoritativeTarget()
        throw error
      }
    }
    if (!response.ok) {
      const message = await readApiErrorMessage(response, '生成提交失败')
      await restoreAuthoritativeTarget()
      throw new Error(message)
    }
    let payload: {
      tasks: Array<{ taskId: string; assetId: string; nodeId?: string }>
      failures?: Array<{ index: number; nodeId?: string; assetId?: string; message: string }>
      canvasRevision?: number
    }
    try {
      payload = await response.json() as typeof payload
      if (!Array.isArray(payload.tasks)) throw new Error('生成服务没有返回有效任务列表')
    } catch (error) {
      await restoreAuthoritativeTarget()
      throw error
    }
    if (multiImageRevision) {
      try {
        await loadAutosaveServerVersion()
      } catch {
        setToast(`已处理 ${request.count} 个生成输出；网络恢复或刷新后会显示最新状态`)
        return
      }
      const failedCount = payload.failures?.length || 0
      setToast(failedCount > 0
        ? `已提交 ${payload.tasks.length} 个生成任务，${failedCount} 个输出提交失败`
        : `已提交 ${payload.tasks.length} 个生成任务`)
      return
    }
    const task = payload.tasks[0]
    if (!task) {
      await restoreAuthoritativeTarget()
      throw new Error('生成服务没有返回任务')
    }
    const item = createHistoryItem(request, task.assetId, task.taskId)
    setNodes((current) => current.map((node) => node.id === target.id ? { ...node, data: { ...node.data, origin: 'generate', history: prependCanvasGenerationHistory(item, node.data.history), generation: { ...generation, assetId: task.assetId, taskId: task.taskId }, progress: 2, __server: { ...node.data.__server!, status: 'RUNNING', taskId: task.taskId } } } : node))
    markChanged('生成任务已提交')
    setToast(`已提交 ${payload.tasks.length} 个生成任务`)
  }, [ensureNodeCapacity, ensureReferenceMaterialIds, initialGraph.canvas.id, loadAutosaveServerVersion, markChanged, prepareGenerationSubmission, projectId, readOnly, record])

  const materializeStoryboardPlan = useCallback(async (
    _sourceNodeId: string,
    taskUpdate: CanvasGenerationTaskUpdate,
  ) => {
    const task = taskUpdate.task
    if (task.kind !== 'storyboard_plan' || task.status !== 'completed') return
    if (materializingStoryboardTasksRef.current.has(task.id)) return
    materializingStoryboardTasksRef.current.add(task.id)
    try {
      // Storyboard fan-out is owned by the planning worker. Flush unrelated
      // local edits, then load the durable nodes/tasks; the browser must never
      // resubmit a shot after refresh or reconnect.
      if (!readOnly) await prepareGenerationSubmission()
      await loadAutosaveServerVersion()
      const submitted = Math.max(0, Number(task.result?.fanout?.submittedCount) || 0)
      const failed = Math.max(0, Number(task.result?.fanout?.failedCount) || 0)
      setToast(failed > 0
        ? `故事版后台续跑完成：${submitted} 个镜头已提交，${failed} 个失败`
        : `故事版后台续跑完成：${submitted || '全部'} 个镜头已提交`)
    } catch (error) {
      setToast(error instanceof Error ? error.message : '读取后台故事版结果失败，请刷新画布重试')
    } finally {
      materializingStoryboardTasksRef.current.delete(task.id)
    }
  }, [loadAutosaveServerVersion, prepareGenerationSubmission, readOnly])

  const runNodeAction = useCallback((nodeId: string, action: CanvasNodeAction) => {
    const node = nodesRef.current.find((item) => item.id === nodeId)
    if (!node) return
    const safeInReadOnly = action === 'history'
      || action === 'preview'
      || action === 'download'
      || action === 'panorama_preview'
      || (action === 'studio_3d' && (node.type === 'model_3d' || node.type === 'studio_3d'))
    if (readOnly && !safeInReadOnly) return
    if (action === 'history') { setHistoryNodeId(nodeId); return }
    if (action === 'preview' && ['image', 'video', 'audio'].includes(getMediaType(node))) { setMediaPreviewNodeId(nodeId); return }
    if (node.type === 'group' && (action === 'arrange_grid' || action === 'arrange_horizontal' || action === 'arrange_vertical')) {
      if (readOnly) return
      const ids = new Set(node.data.memberIds || [])
      if (ids.size === 0) { setToast('组内没有可排列的节点'); return }
      const mode = action === 'arrange_horizontal' ? 'horizontal' : action === 'arrange_vertical' ? 'vertical' : 'grid'
      record('排列组内节点')
      animateNodeLayout((current) => arrangeCanvasGroupMembers(current, node.id, mode, edgesRef.current))
      markChanged('排列组内节点')
      setToast(mode === 'grid' ? '组内节点已网格整理' : mode === 'horizontal' ? '组内节点已横向整理' : '组内节点已按连线顺序纵向整理')
      return
    }
    if (node.type === 'group' && action === 'save_workflow') {
      setWorkflowGroupId(node.id)
      return
    }
    if (action === 'panorama_preview' && isCanvasPanoramaNodeData(node.data) && (node.data.contentUrl || node.data.imageUrl)) { setPanoramaPreviewNodeId(nodeId); return }
    if (action === 'studio_3d' && node.type === 'studio_3d') { setStudioNodeId(nodeId); return }
    if (action === 'studio_3d' && getMediaType(node) === 'model3d' && node.data.modelUrl) { setModelPreviewNodeId(nodeId); return }
    if (action === 'download') {
      const members = node.type === 'group' ? nodesRef.current.filter((item) => node.data.memberIds?.includes(item.id)) : [node]
      void (async () => {
        setToast(members.length > 1 ? `正在打包 ${members.length} 个节点…` : '正在准备下载…')
        const entries: Array<{ name: string; blob: Blob }> = []
        for (let index = 0; index < members.length; index += 1) {
          const item = members[index]
          if (item.type === 'studio_3d') {
            const documentResponse = await apiFetch(`/api/projects/${projectId}/canvas/${initialGraph.canvas.id}/nodes/${item.id}/studio-document`, { cache: 'no-store' })
            if (!documentResponse.ok) throw new Error(await readApiErrorMessage(documentResponse, '3D 导演台截图读取失败'))
            const documentPayload = await documentResponse.json().catch(() => null) as { studioDocument?: { document?: unknown } } | null
            if (!documentPayload?.studioDocument) throw new Error('3D 导演台截图读取失败：文档响应无效')
            const captures = normalizeCanvasStudioScene(documentPayload.studioDocument.document).captures
            for (let captureIndex = 0; captureIndex < captures.length; captureIndex += 1) {
              const capture = captures[captureIndex]
              const url = toDisplayImageUrl(capture.url) || capture.url
              if (!url) continue
              const response = await fetch(url)
              if (!response.ok) throw new Error(`${capture.title} 下载失败`)
              entries.push({ name: `${safeFileName(capture.title, `导演台截图-${captureIndex + 1}`)}.jpg`, blob: await response.blob() })
            }
            continue
          }
          const type = getMediaType(item)
          const extension = extensionForNode(item)
          const name = `${safeFileName(item.data.title || '', `画布素材-${index + 1}`)}.${extension}`
          if (type === 'text') {
            entries.push({ name, blob: new Blob([item.data.text || ''], { type: 'text/plain;charset=utf-8' }) })
            continue
          }
          const url = toDisplayImageUrl(item.data.contentUrl || item.data.imageUrl || item.data.videoUrl || item.data.audioUrl || item.data.modelUrl || null)
          if (!url) continue
          const response = await fetch(url)
          if (!response.ok) throw new Error(`${item.data.title || name} 下载失败`)
          entries.push({ name, blob: await response.blob() })
        }
        if (entries.length === 0) throw new Error('没有可下载的节点内容')
        let blob: Blob
        let fileName: string
        if (entries.length === 1) {
          blob = entries[0].blob
          fileName = entries[0].name
        } else {
          const { default: JSZip } = await import('jszip')
          const zip = new JSZip()
          entries.forEach((entry) => zip.file(entry.name, entry.blob))
          blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } })
          fileName = `${safeFileName(node.data.title || '', '画布批量下载')}.zip`
        }
        const objectUrl = URL.createObjectURL(blob)
        const anchor = document.createElement('a')
        anchor.href = objectUrl
        anchor.download = fileName
        anchor.click()
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000)
        setToast(entries.length > 1 ? `已打包下载 ${entries.length} 个文件` : '下载已开始')
      })().catch((error) => setToast(error instanceof Error ? error.message : '下载失败'))
      return
    }
    if (action === 'favorite') {
      if (!node.data.materialId) { setToast('素材尚未就绪，暂不可收藏'); return }
      const next = !node.data.isFavorited
      void apiFetch(`/api/projects/${projectId}/canvas/${initialGraph.canvas.id}/materials`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ materialId: node.data.materialId, isFavorited: next }) }).then((response) => {
        if (!response.ok) throw new Error('收藏操作失败')
        updateNodeData(nodeId, { isFavorited: next })
        setToast(next ? '已收藏' : '已取消收藏')
      }).catch(() => setToast('收藏操作失败'))
      return
    }
    if (action === 'cancel_generation') {
      const task = node.data.generationTask
      if (!task?.taskId || node.data.__server?.status !== 'RUNNING') return
      void cancelCanvasGenerationTask(projectId, initialGraph.canvas.id, task.taskId)
        .then((update) => {
          const message = update.task.error?.message || '任务已取消'
          setNodes((current) => current.map((item) => item.id === nodeId ? {
            ...item,
            data: {
              ...item.data,
              errorMessage: message,
              generationTask: { ...task, completed: true },
              history: item.data.history?.map((entry) => entry.taskId === task.taskId ? { ...entry, status: 'failed', errorMessage: message } : entry),
              __server: { ...item.data.__server!, status: 'FAILED' },
            },
          } : item))
          markChanged('取消画布生成任务')
          setToast('生成任务已取消，可从节点重试原任务')
        })
        .catch((error) => setToast(error instanceof Error ? error.message : '取消任务失败'))
      return
    }
    if (action === 'retry_generation_task') {
      const previousTask = node.data.generationTask
      if (!previousTask?.taskId || node.data.__server?.status !== 'FAILED') return
      void retryCanvasGenerationTask(projectId, initialGraph.canvas.id, previousTask.taskId)
        .then((submission) => {
          const nextTaskId = submission.taskId
          const nextHistory: CanvasGenerationHistoryItem = {
            id: crypto.randomUUID(),
            taskId: nextTaskId,
            prompt: node.data.prompt || null,
            modelKey: node.data.generation?.modelKey || null,
            source: 'generation',
            status: 'processing',
            createdAt: new Date().toISOString(),
          }
          setNodes((current) => current.map((item) => item.id === nodeId ? {
            ...item,
            data: {
              ...item.data,
              progress: submission.update.task.progress,
              errorMessage: null,
              generation: { ...(item.data.generation || {}), taskId: nextTaskId },
              generationTask: {
                kind: submission.update.task.kind || previousTask.kind,
                taskId: nextTaskId,
                retryOf: previousTask.taskId,
                submittedAt: new Date().toISOString(),
              },
              history: prependCanvasGenerationHistory(nextHistory, item.data.history),
              __server: {
                ...item.data.__server!,
                status: 'RUNNING',
                taskId: nextTaskId,
                runId: submission.runId,
              },
            },
          } : item))
          markChanged('重试画布生成任务')
          setToast('已按原参数重试，刷新页面后仍可恢复')
        })
        .catch(async (error) => {
          await loadAutosaveServerVersion().catch(() => undefined)
          setToast(error instanceof Error ? error.message : '重试任务失败')
        })
      return
    }
    if (action === 'regenerate') {
      const config = node.data.generation
      const regeneration = resolveCanvasRegenerationMode(node.data)
      if (node.data.prompt && config?.modelKey) void handleGenerate({ nodeId, type: getMediaType(node) as CanvasGenerateRequest['type'], prompt: node.data.prompt, modelKey: config.modelKey, modelLabel: config.modelLabel || config.modelKey, referenceNodeIds: config.referenceNodeIds || [], referenceSummary: config.referenceSummary || [], inputMode: config.inputMode || 'text', aspectRatio: config.aspectRatio || '16:9', resolution: config.resolution || '', quality: config.quality || 'high', duration: config.duration || 5, ...(typeof config.parameters?.fps === 'number' ? { fps: config.parameters.fps } : {}), generateAudio: config.generateAudio ?? true, count: regeneration.count, storyboard: regeneration.storyboard, audioMode: config.parameters?.mode === 'tts' || config.parameters?.mode === 'sfx' ? config.parameters.mode : 'music', audioVoice: String(config.parameters?.voice || ''), audioGenre: String(config.parameters?.genre || '电影配乐'), audioSfxKind: String(config.parameters?.sfxKind || '环境'), ...resolveCanvasModel3DRegenerationOptions(node.data) })
      return
    }
    if (readOnly) return
    if (action === 'image_edit' && getMediaType(node) === 'image') {
      setImageEditNodeId(node.id)
      return
    }
    if (action === 'grid_split' && getMediaType(node) === 'image') {
      setImageOperation({ mode: 'grid_split', sourceNodeId: node.id })
      return
    }
    if (action === 'superresolve' && getMediaType(node) === 'image') {
      setImageOperation({ mode: 'superresolve', sourceNodeId: node.id })
      return
    }
    if (action === 'superresolve' && getMediaType(node) === 'video') {
      setVideoOperation({ mode: 'video_superresolve', sourceNodeId: node.id })
      return
    }
    if (action === 'subtitle_erase' && getMediaType(node) === 'video') {
      setVideoOperation({ mode: 'subtitle_erase', sourceNodeId: node.id })
      return
    }
    if (action !== 'panorama_720') return
    record('创建处理节点')
    const derived = createFlowNode('image', { x: node.position.x + nodeSize(node).width + 90, y: node.position.y })
    derived.data = {
      ...derived.data,
      title: `${node.data.title || '节点'} · 720全景`,
      origin: 'derivative',
      processType: CANVAS_PANORAMA_PROCESS_TYPE,
      prompt: '把参考场景转换为无缝衔接的 21:9 超宽幅 720° 全景图。保持原场景的建筑、陈设、材质、时间、天气与光影一致；补全画面左右和背后的空间，地平线保持水平，画面边缘可无缝拼接；不要人物特写、文字、水印、边框或多宫格。',
      generation: {
        referenceNodeIds: [node.id],
        inputMode: 'image',
        aspectRatio: CANVAS_PANORAMA_ASPECT_RATIO,
        count: 1,
      },
    }
    const edge: CanvasFlowEdge = { id: crypto.randomUUID(), source: node.id, target: derived.id, sourceHandle: 'output', targetHandle: 'input', type: 'bezier', data: { role: 'REF' } }
    setNodes((current) => [...current.map((item) => ({ ...item, selected: false })), derived])
    setEdges((current) => [...current, edge])
    markChanged('创建处理节点')
  }, [animateNodeLayout, handleGenerate, initialGraph.canvas.id, loadAutosaveServerVersion, markChanged, projectId, readOnly, record, updateNodeData])

  const applyImageOperationResults = useCallback(async (operationInput: CanvasImageOperationInput, payload: ResolvedCanvasOperation) => {
    if (!imageOperation || readOnly) return
    if (payload.materialization?.materialized) {
      await mergeAutosaveServerVersion()
      setImageOperation(null)
      setToast(operationInput.operation === 'superresolve' ? '超清图片已生成并恢复到画布' : '图片处理结果已恢复到画布')
      return
    }
    if (payload.materialization?.reason === 'source-missing') {
      throw new Error('处理期间源图片节点已被删除；成功生成的图片仍保留在项目素材库中。')
    }
    const source = nodesRef.current.find((node) => node.id === imageOperation.sourceNodeId)
    if (!source) throw new Error('源图片节点已被删除')
    const expectedResults = operationInput.operation === 'grid_split' ? operationInput.selectedCells.length : 1
    if (nodesRef.current.length + expectedResults + (operationInput.operation === 'grid_split' ? 1 : 0) > 1_000) {
      throw new Error('画布节点已达到 1000 个上限，请先删除不需要的节点')
    }
    const results = Array.isArray(payload.results) ? payload.results : []
    if (results.length === 0) throw new Error('图片处理完成但没有返回结果')
    const taskId = payload.taskUpdate?.task.id
    const taskModelKey = payload.taskUpdate?.task.modelKey || undefined

    record(operationInput.operation === 'grid_split' ? '宫格切分' : operationInput.operation === 'lens_focus' ? '创建聚焦参考' : '图片超清')
    const sourceSize = nodeSize(source)
    const baseX = source.position.x + sourceSize.width + 92
    const baseY = source.position.y
    const maxTileWidth = operationInput.operation === 'grid_split' ? 220 : 300
    const created = results.map((result) => {
      const width = maxTileWidth
      const height = Math.max(130, Math.min(340, width * result.height / Math.max(1, result.width)))
      const position = operationInput.operation === 'grid_split'
        ? { x: baseX + result.col * (maxTileWidth + 34), y: baseY + result.row * 210 }
        : { x: baseX, y: baseY }
      const node = createFlowNode('image', position)
      node.width = width
      node.height = height
      node.selected = result.index === 0
      node.data = {
        ...node.data,
        title: result.title,
        mediaType: 'image',
        origin: 'derivative',
        processType: operationInput.operation,
        contentUrl: result.url,
        imageUrl: result.url,
        materialId: result.materialId,
        history: taskId ? [{ id: crypto.randomUUID(), taskId, url: result.url, materialId: result.materialId, prompt: operationInput.operation === 'superresolve' ? `图片超清 ${operationInput.scale}×` : operationInput.operation === 'lens_focus' ? '局部聚焦' : '宫格切分', modelKey: taskModelKey, source: 'generation' as const, status: 'ready' as const, createdAt: new Date().toISOString() }] : undefined,
        generation: { referenceNodeIds: [source.id], count: 1, taskId, modelKey: taskModelKey },
        __server: { ...node.data.__server!, status: 'SUCCEEDED' },
      }
      return node
    })
    const createdIds = new Set(created.map((node) => node.id))
    const newEdges: CanvasFlowEdge[] = created.map((node) => ({
      id: crypto.randomUUID(), source: source.id, target: node.id,
      sourceHandle: 'output', targetHandle: 'input', type: 'bezier', data: { role: 'REF' },
    }))

    let group: CanvasFlowNode | null = null
    if (operationInput.operation === 'grid_split' && created.length > 1) {
      const left = Math.min(...created.map((node) => node.position.x)) - 30
      const top = Math.min(...created.map((node) => node.position.y)) - 54
      const right = Math.max(...created.map((node) => node.position.x + (node.width || 220))) + 30
      const bottom = Math.max(...created.map((node) => node.position.y + (node.height || 160))) + 30
      group = {
        id: crypto.randomUUID(), type: 'group', position: { x: left, y: top }, width: right - left, height: bottom - top,
        zIndex: -10, selected: false,
        data: { title: `${source.data.title || '图片'} · ${created.length} 宫格`, memberIds: [...createdIds], groupColor: '#6366f1', __server: { status: 'IDLE', taskId: null, runId: null, mediaObjectId: null, parentNodeId: null } },
      }
    }

    if (operationInput.operation === 'lens_focus' && imageOperation.targetNodeId) {
      const targetId = imageOperation.targetNodeId
      const focusNode = created[0]
      if (nodesRef.current.some((node) => node.id === targetId)) {
        newEdges.push({ id: crypto.randomUUID(), source: focusNode.id, target: targetId, sourceHandle: 'output', targetHandle: 'input', type: 'bezier', data: { role: 'INPUT_IMAGE' } })
      }
    }

    setNodes((current) => {
      const next = current.map((node) => {
        if (operationInput.operation !== 'lens_focus' || node.id !== imageOperation.targetNodeId) return { ...node, selected: false }
        const referenceNodeIds = Array.from(new Set([...(node.data.generation?.referenceNodeIds || []), created[0].id]))
        return { ...node, selected: false, data: { ...node.data, generation: { ...(node.data.generation || {}), referenceNodeIds } } }
      })
      return [...next, ...(group ? [group] : []), ...created]
    })
    setEdges((current) => [...current, ...newEdges])
    markChanged(operationInput.operation === 'grid_split' ? '宫格切分完成' : operationInput.operation === 'lens_focus' ? '聚焦参考已创建' : '图片超清完成')
    setImageOperation(null)
    setToast(operationInput.operation === 'grid_split' ? `已生成 ${created.length} 张宫格切片` : operationInput.operation === 'lens_focus' ? '聚焦参考已连接' : '超清图片已生成')
  }, [imageOperation, markChanged, mergeAutosaveServerVersion, readOnly, record])

  const handleImageOperation = useCallback(async (operationInput: CanvasImageOperationInput, onTaskUpdate?: (update: CanvasOperationTaskUpdate) => void) => {
    if (!imageOperation || readOnly) return
    const source = nodesRef.current.find((node) => node.id === imageOperation.sourceNodeId)
    if (!source) throw new Error('源图片节点已被删除')
    const response = await apiFetch(`/api/projects/${projectId}/canvas/${initialGraph.canvas.id}/operations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceNodeId: source.id,
        targetNodeId: imageOperation.targetNodeId,
        operationRequestId: crypto.randomUUID(),
        ...operationInput,
      }),
    })
    const payload = await resolveCanvasOperationResponse(response, onTaskUpdate)
    await applyImageOperationResults(operationInput, payload)
  }, [applyImageOperationResults, imageOperation, initialGraph.canvas.id, projectId, readOnly])

  const handleImageEdit = useCallback(async ({ prompt, maskFile }: { prompt: string; maskFile: File }) => {
    if (!imageEditNodeId || readOnly) return
    const source = nodesRef.current.find((node) => node.id === imageEditNodeId)
    if (!source) throw new Error('源图片节点已被删除')
    if (!ensureNodeCapacity(1)) throw new Error('画布节点数量已达到上限')
    const form = new FormData()
    form.set('file', maskFile)
    form.set('title', `${source.data.title || '图片'} · 改图蒙版`)
    form.set('projectId', projectId)
    const response = await apiFetch(`/api/projects/${projectId}/canvas/${initialGraph.canvas.id}/materials`, { method: 'POST', body: form })
    if (!response.ok) throw new Error(await readApiErrorMessage(response, '蒙版上传失败'))
    const payload = await response.json() as { material?: FrameosMaterialItem }
    const mask = payload.material
    if (!mask?.id || !mask.url) throw new Error('蒙版上传成功但未返回素材')

    record('创建涂抹改图节点')
    const sourceSize = nodeSize(source)
    const derived = createFlowNode('image', { x: source.position.x + sourceSize.width + 92, y: source.position.y })
    derived.selected = true
    derived.data = {
      ...derived.data,
      title: `${source.data.title || '图片'} · 改图`,
      mediaType: 'image',
      origin: 'derivative',
      processType: 'image_edit',
      prompt: `只修改白色蒙版覆盖的局部区域，黑色区域必须保持原图内容、人物身份、构图和光影不变。修改要求：${prompt}`,
      generation: {
        referenceNodeIds: [source.id],
        inputMode: 'image',
        aspectRatio: source.data.generation?.aspectRatio || '16:9',
        count: 1,
        parameters: { maskMaterialId: mask.id },
      },
      maskMaterialId: mask.id,
      maskPreviewUrl: mask.url,
    }
    const edge: CanvasFlowEdge = { id: crypto.randomUUID(), source: source.id, target: derived.id, sourceHandle: 'output', targetHandle: 'input', type: 'bezier', data: { role: 'INPUT_IMAGE' } }
    setNodes((current) => [...current.map((node) => ({ ...node, selected: false })), derived])
    setEdges((current) => [...current, edge])
    markChanged('涂抹改图节点已创建')
    setImageEditNodeId(null)
    setToast('蒙版已保存，请确认提示词和模型后开始生成')
  }, [ensureNodeCapacity, imageEditNodeId, initialGraph.canvas.id, markChanged, projectId, readOnly, record])

  const applyVideoOperationResults = useCallback(async (operationInput: CanvasVideoOperationInput, payload: ResolvedCanvasOperation) => {
    if (!videoOperation || readOnly) return
    if (payload.materialization?.materialized) {
      await mergeAutosaveServerVersion()
      setVideoOperation(null)
      setToast(operationInput.operation === 'subtitle_erase' ? '去字幕视频已生成并恢复到画布' : '增强视频已生成并恢复到画布')
      return
    }
    const source = nodesRef.current.find((node) => node.id === videoOperation.sourceNodeId)
    if (!source) throw new Error('源视频节点已被删除')
    if (!ensureNodeCapacity(1)) throw new Error('画布节点数量已达到上限')
    const result = payload.results?.[0]
    if (!result?.url || !result.materialId) throw new Error('视频处理完成但没有返回结果')
    const taskId = payload.taskUpdate?.task.id
    const taskModelKey = payload.taskUpdate?.task.modelKey || undefined

    const label = operationInput.operation === 'subtitle_erase' ? '视频去字幕' : '视频增强'
    record(label)
    const size = nodeSize(source)
    const derived = createFlowNode('video', { x: source.position.x + size.width + 92, y: source.position.y })
    derived.selected = true
    derived.data = {
      ...derived.data,
      title: result.title,
      mediaType: 'video',
      origin: 'derivative',
      processType: operationInput.operation === 'subtitle_erase' ? 'subtitle_erase' : 'superresolve',
      contentUrl: result.url,
      videoUrl: result.url,
      materialId: result.materialId,
      duration: result.duration,
      fps: result.fps,
      history: [{ id: crypto.randomUUID(), taskId, url: result.url, materialId: result.materialId, modelKey: taskModelKey, source: 'generation', status: 'ready', createdAt: new Date().toISOString(), prompt: label }],
      generation: {
        referenceNodeIds: [source.id],
        count: 1,
        taskId,
        modelKey: taskModelKey,
        parameters: operationInput.operation === 'subtitle_erase'
          ? { eraseMode: operationInput.mode, ...operationInput.region }
          : { target: operationInput.target, interpolate: operationInput.interpolate },
      },
      __server: { ...derived.data.__server!, status: 'SUCCEEDED' },
    }
    const edge: CanvasFlowEdge = { id: crypto.randomUUID(), source: source.id, target: derived.id, sourceHandle: 'output', targetHandle: 'input', type: 'bezier', data: { role: 'REF' } }
    setNodes((current) => [...current.map((node) => ({ ...node, selected: false })), derived])
    setEdges((current) => [...current, edge])
    markChanged(`${label}完成`)
    setVideoOperation(null)
    setToast(operationInput.operation === 'subtitle_erase' ? '去字幕视频已生成' : '增强视频已生成')
  }, [ensureNodeCapacity, markChanged, mergeAutosaveServerVersion, readOnly, record, videoOperation])

  const handleVideoOperation = useCallback(async (operationInput: CanvasVideoOperationInput, onTaskUpdate?: (update: CanvasOperationTaskUpdate) => void) => {
    if (!videoOperation || readOnly) return
    const source = nodesRef.current.find((node) => node.id === videoOperation.sourceNodeId)
    if (!source) throw new Error('源视频节点已被删除')
    const response = await apiFetch(`/api/projects/${projectId}/canvas/${initialGraph.canvas.id}/operations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceNodeId: source.id, ...operationInput }),
    })
    const payload = await resolveCanvasOperationResponse(response, onTaskUpdate)
    await applyVideoOperationResults(operationInput, payload)
  }, [applyVideoOperationResults, initialGraph.canvas.id, projectId, readOnly, videoOperation])

  const isOperationTaskMaterialized = useCallback((taskId: string) => nodesRef.current.some((node) => (
    node.data.generation?.taskId === taskId
    || node.data.history?.some((item) => item.taskId === taskId)
  )), [])

  const handlePanoramaCapture = useCallback(async (files: File[], mode: 'current' | 'four' | 'twelve'): Promise<PanoramaCaptureCommitResult> => {
    if (!panoramaPreviewNodeId || readOnly || files.length === 0) {
      return { created: 0, failed: files.length, errors: files.length > 0 ? ['当前无法发送全景截图'] : [] }
    }
    const source = nodesRef.current.find((node) => node.id === panoramaPreviewNodeId)
    if (!source) throw new Error('全景节点已被删除')
    const groupCount = files.length > 1 ? 1 : 0
    if (!ensureNodeCapacity(files.length + groupCount)) throw new Error('画布节点数量已达到上限')
    const uploaded = await settlePanoramaCaptureUploads(files.length, async (index) => {
      const file = files[index]
      const form = new FormData()
      form.set('file', file)
      form.set('title', `${source.data.title || '全景图'} · ${mode === 'current' ? '当前视角' : mode === 'four' ? `四视角 ${index + 1}` : `十二视角 ${index + 1}`}`)
      form.set('projectId', projectId)
      const response = await apiFetch(`/api/projects/${projectId}/canvas/${initialGraph.canvas.id}/materials`, { method: 'POST', body: form })
      if (!response.ok) throw new Error(await readApiErrorMessage(response, `视角 ${index + 1} 上传失败`))
      const payload = await response.json() as { material?: FrameosMaterialItem }
      if (!payload.material?.id || !payload.material.url) throw new Error(`视角 ${index + 1} 未返回素材`)
      return payload.material
    })
    if (uploaded.successes.length === 0) {
      throw new Error(panoramaCaptureResultMessage({
        created: 0,
        failed: uploaded.failures.length,
        errors: uploaded.failures.map((failure) => failure.message),
      }))
    }

    record(mode === 'current' ? '全景当前视角截图' : mode === 'four' ? '全景四视角截图' : '全景十二视角截图')
    const size = nodeSize(source)
    const columns = mode === 'current' ? 1 : 4
    const width = 240
    const height = 150
    const baseX = source.position.x + size.width + 90
    const baseY = source.position.y
    const created = uploaded.successes.map(({ value: material, index }, createdIndex) => {
      const node = createFlowNode('image', { x: baseX + (index % columns) * (width + 28), y: baseY + Math.floor(index / columns) * (height + 56) })
      node.width = width
      node.height = height
      node.selected = createdIndex === 0
      node.data = {
        ...node.data,
        title: material.title || `全景视角 ${index + 1}`,
        mediaType: 'image',
        origin: 'derivative',
        contentUrl: material.url,
        imageUrl: material.url,
        materialId: material.id,
        generation: { referenceNodeIds: [source.id], count: 1, parameters: { panoramaCaptureMode: mode, panoramaCaptureIndex: index } },
        history: [{ id: crypto.randomUUID(), url: material.url, materialId: material.id, status: 'ready', createdAt: new Date().toISOString(), prompt: '全景视角截图' }],
        __server: { ...node.data.__server!, status: 'SUCCEEDED' },
      }
      return node
    })
    const newEdges: CanvasFlowEdge[] = created.map((node) => ({ id: crypto.randomUUID(), source: source.id, target: node.id, sourceHandle: 'output', targetHandle: 'input', type: 'bezier', data: { role: 'PANORAMA_VIEW' } }))
    let group: CanvasFlowNode | null = null
    if (created.length > 1) {
      const left = Math.min(...created.map((node) => node.position.x)) - 28
      const top = Math.min(...created.map((node) => node.position.y)) - 52
      const right = Math.max(...created.map((node) => node.position.x + width)) + 28
      const bottom = Math.max(...created.map((node) => node.position.y + height)) + 28
      group = {
        id: crypto.randomUUID(), type: 'group', position: { x: left, y: top }, width: right - left, height: bottom - top,
        zIndex: -10, selected: false,
        data: { title: `${source.data.title || '全景图'} · ${created.length} 视角`, memberIds: created.map((node) => node.id), groupColor: '#5c78d9', __server: { status: 'IDLE', taskId: null, runId: null, mediaObjectId: null, parentNodeId: null } },
      }
    }
    setNodes((current) => [...current.map((node) => ({ ...node, selected: false })), ...(group ? [group] : []), ...created])
    setEdges((current) => [...current, ...newEdges])
    markChanged(`已创建 ${created.length} 张全景视角截图`)
    const result = {
      created: created.length,
      failed: uploaded.failures.length,
      errors: uploaded.failures.map((failure) => failure.message),
    }
    setToast(panoramaCaptureResultMessage(result))
    return result
  }, [ensureNodeCapacity, initialGraph.canvas.id, markChanged, panoramaPreviewNodeId, projectId, readOnly, record])

  const handleStudioStageCaptures = useCallback(async (drafts: CanvasStudioCaptureDraft[]): Promise<CanvasStudioCaptureStageResult> => {
    if (!studioNodeId || readOnly || drafts.length === 0) return { captures: [], failed: drafts.length }
    const source = nodesRef.current.find((node) => node.id === studioNodeId)
    if (!source) throw new Error('3D 导演台节点已被删除')
    const settled = await settleWithConcurrency(drafts, CANVAS_UPLOAD_CONCURRENCY, async (draft, index): Promise<CanvasStudioCapture> => {
      const form = new FormData()
      form.set('file', draft.file)
      form.set('title', `${source.data.title || '3D导演台'} · ${draft.cameraName} ${index + 1}`)
      form.set('projectId', projectId)
      const response = await apiFetch(`/api/projects/${projectId}/canvas/${initialGraph.canvas.id}/materials`, { method: 'POST', body: form })
      if (!response.ok) throw new Error(await readApiErrorMessage(response, `机位截图 ${index + 1} 保存失败`))
      const payload = await response.json() as { material?: FrameosMaterialItem }
      if (!payload.material?.id || !payload.material.url) throw new Error(`机位截图 ${index + 1} 未返回素材`)
      return {
        id: crypto.randomUUID(),
        title: payload.material.title || `${draft.cameraName}截图`,
        url: payload.material.url,
        materialId: payload.material.id,
        cameraId: draft.cameraId,
        cameraName: draft.cameraName,
        aspectRatio: draft.aspectRatio,
        width: draft.width,
        height: draft.height,
        createdAt: payload.material.createdAt || new Date().toISOString(),
        sentAt: null,
      }
    })
    return {
      captures: settled.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []),
      failed: settled.filter((result) => result.status === 'rejected').length,
    }
  }, [initialGraph.canvas.id, projectId, readOnly, studioNodeId])

  const handleStudioCapture = useCallback(async (captures: CanvasStudioCapture[]): Promise<CanvasStudioCaptureSendResult> => {
    if (!studioNodeId || readOnly || captures.length === 0) return { sentIds: [], created: 0, failed: captures.length }
    const source = nodesRef.current.find((node) => node.id === studioNodeId)
    if (!source) throw new Error('3D 导演台节点已被删除')
    const available = Math.max(0, CANVAS_NODE_HARD_LIMIT - nodesRef.current.length)
    const accepted = captures.slice(0, available)
    const failed = captures.length - accepted.length
    if (accepted.length === 0) {
      ensureNodeCapacity(1)
      return { sentIds: [], created: 0, failed }
    }
    const groupCount = accepted.length > 1 && available > accepted.length ? 1 : 0
    if (!ensureNodeCapacity(accepted.length + groupCount)) return { sentIds: [], created: 0, failed: captures.length }
    record(accepted.length > 1 ? '发送多张导演台截图' : '发送导演台截图')
    const size = nodeSize(source)
    const width = 260
    const height = 164
    const columns = Math.min(4, accepted.length)
    const created = accepted.map((capture, index) => {
      const node = createFlowNode('image', { x: source.position.x + size.width + 90 + (index % columns) * (width + 30), y: source.position.y + Math.floor(index / columns) * (height + 58) })
      node.width = width
      node.height = height
      node.selected = index === 0
      node.data = {
        ...node.data,
        title: capture.title || `机位截图 ${index + 1}`,
        mediaType: 'image', origin: 'derivative', contentUrl: capture.url, imageUrl: capture.url, materialId: capture.materialId,
        generation: { referenceNodeIds: [source.id], count: 1, parameters: { studioCameraIndex: index, ...(capture.cameraId ? { studioCameraId: capture.cameraId } : {}), studioCaptureId: capture.id } },
        history: [{ id: crypto.randomUUID(), url: capture.url, materialId: capture.materialId, status: 'ready', createdAt: capture.createdAt, prompt: `3D 导演台 · ${capture.cameraName}` }],
        __server: { ...node.data.__server!, status: 'SUCCEEDED' },
      }
      return node
    })
    const newEdges: CanvasFlowEdge[] = created.map((node) => ({ id: crypto.randomUUID(), source: source.id, target: node.id, sourceHandle: 'output', targetHandle: 'input', type: 'bezier', data: { role: 'STUDIO_CAMERA' } }))
    let group: CanvasFlowNode | null = null
    if (groupCount > 0) {
      const left = Math.min(...created.map((node) => node.position.x)) - 28
      const top = Math.min(...created.map((node) => node.position.y)) - 52
      const right = Math.max(...created.map((node) => node.position.x + width)) + 28
      const bottom = Math.max(...created.map((node) => node.position.y + height)) + 28
      group = { id: crypto.randomUUID(), type: 'group', position: { x: left, y: top }, width: right - left, height: bottom - top, zIndex: -10, selected: false, data: { title: `${source.data.title || '3D导演台'} · 机位截图`, memberIds: created.map((node) => node.id), groupColor: '#7c5ce0', __server: { status: 'IDLE', taskId: null, runId: null, mediaObjectId: null, parentNodeId: null } } }
    }
    setNodes((current) => [...current.map((node) => ({ ...node, selected: false })), ...(group ? [group] : []), ...created])
    setEdges((current) => [...current, ...newEdges])
    markChanged(`已创建 ${created.length} 张导演台截图`)
    setToast(failed > 0 ? `发送完成：成功 ${created.length} 张，失败 ${failed} 张` : `已发送 ${created.length} 张机位截图到画布`)
    return { sentIds: accepted.map((capture) => capture.id), created: created.length, failed }
  }, [ensureNodeCapacity, markChanged, readOnly, record, studioNodeId])

  const handleStudioSummaryChange = useCallback((summary: CanvasStudioSummary) => {
    if (!studioNodeId || readOnly) return
    const node = nodesRef.current.find((item) => item.id === studioNodeId)
    if (!node) return
    const current = normalizeCanvasStudioSummary(node.data.studioSummary, node.data.studioScene)
    if (node.data.studioScene === undefined && JSON.stringify(current) === JSON.stringify(summary)) return
    updateNodeData(studioNodeId, { studioSummary: summary, studioScene: undefined })
  }, [readOnly, studioNodeId, updateNodeData])

  const editorContext = useMemo(() => ({
    readOnly: writeLocked,
    canUndo,
    canRedo,
    saveState: autosave.saveState,
    undo,
    redo,
    saveCanvas: flushAutosave,
    updateNodeData,
    removeNodes,
    duplicateNodes,
    runNodeAction,
    listPlaylistVideoSources,
    loadPlaylistRender,
    startPlaylistRender,
    loadPlaylistReview,
    submitPlaylistReview,
  }), [autosave.saveState, canRedo, canUndo, duplicateNodes, flushAutosave, listPlaylistVideoSources, loadPlaylistRender, loadPlaylistReview, redo, removeNodes, runNodeAction, startPlaylistRender, submitPlaylistReview, undo, updateNodeData, writeLocked])

  const onNodesChange = useCallback((changes: NodeChange<CanvasFlowNode>[]) => {
    if (productionSyncing || (readOnly && changes.some((change) => change.type !== 'select'))) return
    if (layoutAnimating && changes.some((change) => change.type === 'position' || change.type === 'dimensions')) return
    for (const change of changes) {
      if (change.type === 'remove') record('删除节点')
      if (change.type === 'dimensions') {
        if (change.setAttributes && !resizeHistoryRef.current.has(change.id)) { resizeHistoryRef.current.add(change.id); record('调整节点大小') }
        if (change.resizing === false) resizeHistoryRef.current.delete(change.id)
      }
    }
    setNodes((current) => applyNodeChanges(changes, current))
    const hasPersistentChange = changes.some((change) => (
      change.type === 'position'
      || change.type === 'remove'
      || (change.type === 'dimensions' && Boolean(change.setAttributes))
    ))
    if (hasPersistentChange) markChanged('调整画布节点')
    const removed = new Set(changes.filter((change) => change.type === 'remove').map((change) => change.id))
    if (removed.size) {
      const removedEdges = edgesRef.current.filter((edge) => removed.has(edge.source) || removed.has(edge.target))
      const remainingEdges = edgesRef.current.filter((edge) => !removed.has(edge.source) && !removed.has(edge.target))
      edgesRef.current = remainingEdges
      setEdges(remainingEdges)
      cleanupDisconnectedReferences(removedEdges, remainingEdges)
    }
  }, [cleanupDisconnectedReferences, layoutAnimating, markChanged, productionSyncing, readOnly, record])

  const onEdgesChange = useCallback((changes: EdgeChange<CanvasFlowEdge>[]) => {
    if (writeLocked) return
    const removedIds = new Set(changes.filter((change) => change.type === 'remove').map((change) => change.id))
    const next = applyEdgeChanges(changes, edgesRef.current)
    const removedEdges = edgesRef.current.filter((edge) => removedIds.has(edge.id))
    if (removedEdges.length > 0) {
      commitEdgeRemoval(removedEdges, next)
      return
    }
    edgesRef.current = next
    setEdges(next)
  }, [commitEdgeRemoval, writeLocked])

  const onNodeDragStart = useCallback((event: React.MouseEvent, node: CanvasFlowNode) => {
    if (writeLocked) return
    if (!dragRecordedRef.current) { record(event.altKey ? '拖拽复制' : '移动节点'); dragRecordedRef.current = true }
    if (event.altKey) {
      const selectedIds = nodesRef.current.filter((item) => item.selected).map((item) => item.id)
      const requestedIds = selectedIds.includes(node.id) ? selectedIds : [node.id]
      const expanded = expandGroupNodeIds(requestedIds)
      const originals = nodesRef.current.filter((item) => expanded.has(item.id))
      const includesGroup = originals.some((item) => item.type === 'group')
      altCopyRef.current = {
        nodes: structuredClone(originals),
        edges: structuredClone(edgesRef.current.filter((edge) => includesGroup
          ? expanded.has(edge.source) && expanded.has(edge.target)
          : expanded.has(edge.target))),
      }
    }
    if (node.type === 'group') {
      const memberIds = new Set(node.data.memberIds || [])
      groupDragRef.current = { id: node.id, start: { ...node.position }, members: new Map(nodesRef.current.filter((item) => memberIds.has(item.id)).map((item) => [item.id, { ...item.position }])) }
    }
  }, [expandGroupNodeIds, record, writeLocked])

  const onNodeDrag = useCallback((_event: React.MouseEvent, node: CanvasFlowNode) => {
    if (writeLocked) return
    const group = groupDragRef.current
    if (!group || group.id !== node.id) return
    const dx = node.position.x - group.start.x
    const dy = node.position.y - group.start.y
    setNodes((current) => current.map((item) => group.members.has(item.id) ? { ...item, position: { x: group.members.get(item.id)!.x + dx, y: group.members.get(item.id)!.y + dy } } : item))
  }, [writeLocked])

  const onNodeDragStop = useCallback((_event: React.MouseEvent, draggedNode: CanvasFlowNode) => {
    if (writeLocked) {
      altCopyRef.current = null
      groupDragRef.current = null
      dragRecordedRef.current = false
      return
    }
    if (altCopyRef.current?.nodes.length) {
      const originals = altCopyRef.current
      if (!ensureNodeCapacity(originals.nodes.length)) { altCopyRef.current = null; groupDragRef.current = null; dragRecordedRef.current = false; return }
      if (edgesRef.current.length + originals.edges.length > CANVAS_EDGE_HARD_LIMIT) {
        setToast('拖拽复制后的连线数量将超过 4000 条上限')
        altCopyRef.current = null
        groupDragRef.current = null
        dragRecordedRef.current = false
        return
      }
      const idMap = new Map(originals.nodes.map((node) => [node.id, crypto.randomUUID()]))
      setNodes((current) => [...current, ...originals.nodes.map((node) => ({ ...structuredClone(node), id: idMap.get(node.id)!, selected: false, data: cloneCanvasNodeDataForNewNode(node.data, (id) => idMap.get(id)) }))])
      setEdges((current) => [...current, ...originals.edges.map((edge) => ({ ...structuredClone(edge), id: crypto.randomUUID(), source: idMap.get(edge.source) || edge.source, target: idMap.get(edge.target) || edge.target, selected: false }))])
      altCopyRef.current = null
    }
    setNodes((current) => {
      const reconciled = reconcileDraggedNodeGroupMembership(current, [draggedNode.id])
      return draggedNode.type === 'group'
        ? reconciled
        : fitCanvasGroupsToMembers(reconciled, canvasGroupIdsContainingMembers(reconciled, [draggedNode.id]))
    })
    groupDragRef.current = null
    dragRecordedRef.current = false
    markChanged('移动节点')
  }, [ensureNodeCapacity, markChanged, writeLocked])

  const onSelectionDragStart = useCallback(() => { if (!writeLocked && !dragRecordedRef.current) { record('移动多个节点'); dragRecordedRef.current = true } }, [record, writeLocked])
  const onSelectionDragStop = useCallback((_event: React.MouseEvent, draggedNodes: CanvasFlowNode[]) => {
    if (writeLocked) {
      dragRecordedRef.current = false
      return
    }
    const draggedIds = draggedNodes.map((node) => node.id)
    const movedContent = draggedNodes.some((node) => node.type !== 'group')
    const draggedGroupIds = new Set(draggedNodes.filter((node) => node.type === 'group').map((node) => node.id))
    setNodes((current) => {
      const reconciled = reconcileDraggedNodeGroupMembership(current, draggedIds)
      if (!movedContent) return reconciled
      const affectedGroupIds = canvasGroupIdsContainingMembers(reconciled, draggedIds).filter((id) => !draggedGroupIds.has(id))
      return fitCanvasGroupsToMembers(reconciled, affectedGroupIds)
    })
    dragRecordedRef.current = false
    markChanged('移动多个节点')
  }, [markChanged, writeLocked])

  const insertMaterial = useCallback((material: FrameosMaterialItem, position?: { x: number; y: number }) => {
    if (readOnly || !material?.id || !material.url) return
    const type = material.type === 'video' ? 'video' : material.type === 'audio' ? 'audio' : material.type === 'model3d' ? 'model3d' : 'image'
    const nodeType = type === 'model3d' ? 'model_3d' : type
    const created = addNode(nodeType as CanvasNodeMenuType, position || centerPosition())
    if (!created) return
    updateNodeData(created.id, {
      title: material.title || '项目资产',
      mediaType: type,
      origin: material.source === 'upload' ? 'upload' : 'project',
      contentUrl: material.url,
      imageUrl: type === 'image' ? material.url : null,
      videoUrl: type === 'video' ? material.url : null,
      audioUrl: type === 'audio' ? material.url : null,
      modelUrl: type === 'model3d' ? material.url : null,
      materialId: material.id,
      sourceMetadata: material.metadata || null,
      __server: { ...created.data.__server!, status: 'SUCCEEDED' },
    } as Partial<CanvasNodeData>)
    setToast(`已添加「${material.title || '项目资产'}」`)
  }, [addNode, centerPosition, readOnly, updateNodeData])

  const insertWorkflow = useCallback((template: CanvasWorkflowTemplate, position?: { x: number; y: number }) => {
    if (readOnly) return
    const sourceNodes = Array.isArray(template.nodes) ? template.nodes.filter((node) => node && typeof node.id === 'string' && typeof node.position?.x === 'number' && typeof node.position?.y === 'number') : []
    const sourceEdges = Array.isArray(template.edges) ? template.edges.filter((edge) => edge && typeof edge.source === 'string' && typeof edge.target === 'string') : []
    if (sourceNodes.length === 0) { setToast('工作流模板没有可加载的节点'); return }
    if (!ensureNodeCapacity(sourceNodes.length)) return
    if (edgesRef.current.length + sourceEdges.length > CANVAS_EDGE_HARD_LIMIT) { setToast('加载后连线数量将超过 4000 条上限'); return }
    record('加载工作流')
    const idMap = new Map(sourceNodes.map((node) => [node.id, crypto.randomUUID()]))
    const left = Math.min(...sourceNodes.map((node) => node.position.x))
    const top = Math.min(...sourceNodes.map((node) => node.position.y))
    const right = Math.max(...sourceNodes.map((node) => node.position.x + nodeSize(node).width))
    const bottom = Math.max(...sourceNodes.map((node) => node.position.y + nodeSize(node).height))
    const anchor = position || centerPosition()
    const offset = { x: anchor.x - (left + right) / 2, y: anchor.y - (top + bottom) / 2 }
    const firstSelectable = sourceNodes.find((node) => node.type !== 'group')?.id
    const createdNodes = sourceNodes.map((source) => {
      const node = structuredClone(source)
      node.id = idMap.get(source.id)!
      node.position = { x: source.position.x + offset.x, y: source.position.y + offset.y }
      node.selected = source.id === firstSelectable
      node.data = cloneCanvasNodeDataForNewNode(node.data, (id) => idMap.get(id))
      return node
    })
    const createdEdges = sourceEdges.map((source) => ({ ...structuredClone(source), id: crypto.randomUUID(), source: idMap.get(source.source)!, target: idMap.get(source.target)!, type: 'bezier', selected: false }))
    setNodes((current) => [...current.map((node) => ({ ...node, selected: false })), ...createdNodes])
    setEdges((current) => [...current, ...createdEdges])
    markChanged('加载工作流')
    setToast(`已加载工作流「${template.name}」`)
  }, [centerPosition, ensureNodeCapacity, markChanged, readOnly, record])

  const saveWorkflow = useCallback(async (name: string) => {
    if (readOnly) throw new Error('当前账号只有查看权限')
    if (!workflowGroupId) throw new Error('工作流组已关闭')
    const group = nodesRef.current.find((node) => node.id === workflowGroupId && node.type === 'group')
    if (!group) throw new Error('工作流组不存在或已被删除')
    const memberIds = new Set(group.data.memberIds || [])
    const members = nodesRef.current.filter((node) => memberIds.has(node.id))
    if (members.length === 0) throw new Error('组内没有可保存的节点')
    const includedIds = new Set([group.id, ...members.map((node) => node.id)])
    const document = {
      nodes: [group, ...members].map((node) => {
        const copy = structuredClone(node)
        copy.selected = false
        copy.dragging = false
        return copy
      }),
      edges: edgesRef.current.filter((edge) => includedIds.has(edge.source) && includedIds.has(edge.target)).map((edge) => ({ ...structuredClone(edge), selected: false })),
    }
    const response = await apiFetch(`/api/projects/${projectId}/canvas/templates`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, document }),
    })
    if (!response.ok) throw new Error(await readApiErrorMessage(response, '保存工作流失败'))
    setWorkflowGroupId(null)
    setWorkflowRefreshKey((value) => value + 1)
    setToast(`工作流「${name}」已保存`)
  }, [projectId, readOnly, workflowGroupId])

  const uploadMaterial = useCallback(async (file: File) => {
    let lastError = `${file.name || '文件'}上传失败`
    for (let attempt = 1; attempt <= CANVAS_UPLOAD_MAX_ATTEMPTS; attempt += 1) {
      const form = new FormData()
      form.set('file', file)
      form.set('title', file.name.replace(/\.[^.]+$/, '') || '上传素材')
      form.set('projectId', projectId)
      const response = await apiFetch(`/api/projects/${projectId}/canvas/${initialGraph.canvas.id}/materials`, { method: 'POST', body: form })
      if (response.ok) {
        const payload = await response.json() as { material?: FrameosMaterialItem }
        if (!payload.material?.id || !payload.material.url) throw new Error(`${file.name || '文件'}未返回可用素材`)
        return payload.material
      }
      lastError = await readApiErrorMessage(response, lastError)
      if (response.status !== 429 || attempt === CANVAS_UPLOAD_MAX_ATTEMPTS) throw new Error(lastError)
      await new Promise((resolve) => window.setTimeout(resolve, 300 * attempt))
    }
    throw new Error(lastError)
  }, [initialGraph.canvas.id, projectId])

  const requestContentReplacement = useCallback((nodeId: string) => {
    if (writeLocked) return
    const node = nodesRef.current.find((item) => item.id === nodeId)
    const mediaType = node ? getReplaceableMediaType(node) : null
    const input = replacementUploadRef.current
    if (!node || !mediaType || !input) return
    replacementNodeIdRef.current = nodeId
    input.accept = canvasReplacementAccept(mediaType)
    input.click()
  }, [writeLocked])

  useEffect(() => {
    const handleReplacementRequest = (event: Event) => {
      const nodeId = (event as CustomEvent<{ nodeId?: unknown }>).detail?.nodeId
      if (typeof nodeId === 'string') requestContentReplacement(nodeId)
    }
    window.addEventListener(CANVAS_REPLACE_CONTENT_EVENT, handleReplacementRequest)
    return () => window.removeEventListener(CANVAS_REPLACE_CONTENT_EVENT, handleReplacementRequest)
  }, [requestContentReplacement])

  const handleContentReplacement = useCallback(async (nodeId: string, file: File) => {
    if (writeLocked || file.size <= 0) return
    const beforeUpload = nodesRef.current.find((item) => item.id === nodeId)
    const expectedType = beforeUpload ? getReplaceableMediaType(beforeUpload) : null
    if (!beforeUpload || !expectedType) throw new Error('节点不存在或不支持替换内容')
    if (!isMatchingCanvasReplacementFile(expectedType, file)) {
      throw new Error(`请选择与${expectedType === 'model3d' ? '3D 模型' : expectedType === 'image' ? '图片' : expectedType === 'video' ? '视频' : '音频'}节点相同类型的文件`)
    }

    setToast(`正在替换「${beforeUpload.data.title || '未命名节点'}」…`)
    const material = await uploadMaterial(file)
    const current = nodesRef.current.find((item) => item.id === nodeId)
    const currentType = current ? getReplaceableMediaType(current) : null
    if (!current || currentType !== expectedType) throw new Error('替换期间节点已变化，请重试')
    if (material.type !== expectedType || !material.url) throw new Error('上传结果类型与节点不一致')

    record('替换节点内容')
    const replacement = replaceCanvasNodeContent(current, {
      id: material.id,
      type: material.type,
      url: material.url,
    })
    const nextNodes = nodesRef.current.map((node) => node.id === nodeId ? replacement : node)
    const removedEdges = edgesRef.current.filter((edge) => edge.target === nodeId)
    const remainingEdges = removedEdges.length > 0
      ? edgesRef.current.filter((edge) => edge.target !== nodeId)
      : edgesRef.current
    nodesRef.current = nextNodes
    edgesRef.current = remainingEdges
    setNodes(nextNodes)
    if (removedEdges.length > 0) setEdges(remainingEdges)
    markChanged('替换节点内容')
    setToast(removedEdges.length > 0
      ? `已替换内容，并断开 ${removedEdges.length} 条不再适用的输入连线`
      : '已替换节点内容，旧版本已保留在历史中')
  }, [markChanged, record, uploadMaterial, writeLocked])

  const handleUploads = useCallback(async (input: File[] | FileList, position?: { x: number; y: number }) => {
    if (readOnly) return
    const files = Array.from(input).filter((file) => file.size > 0).slice(0, 100)
    if (files.length === 0) return
    if (!ensureNodeCapacity(files.length)) return
    setToast(`正在上传 ${files.length} 个文件…`)
    const results = await settleWithConcurrency(files, CANVAS_UPLOAD_CONCURRENCY, uploadMaterial)
    const materials = results.flatMap((result) => result.status === 'fulfilled' ? [result.value] : [])
    const failed = results.length - materials.length
    const anchor = position || centerPosition()
    const columns = Math.max(1, Math.ceil(Math.sqrt(materials.length)))
    materials.forEach((material, index) => insertMaterial(material, {
      x: anchor.x + (index % columns) * 360,
      y: anchor.y + Math.floor(index / columns) * 260,
    }))
    setToast(failed > 0 ? `已上传 ${materials.length} 个文件，${failed} 个失败` : `已上传 ${materials.length} 个文件`)
    if (materials.length === 0) {
      const firstFailure = results.find((result) => result.status === 'rejected')
      throw firstFailure?.reason instanceof Error ? firstFailure.reason : new Error('文件上传失败')
    }
  }, [centerPosition, ensureNodeCapacity, insertMaterial, readOnly, uploadMaterial])

  const openUploadPicker = useCallback((position?: { x: number; y: number }) => {
    pendingUploadPositionRef.current = position || null
    uploadRef.current?.click()
  }, [])

  const pasteFromSystem = useCallback(async (position?: { x: number; y: number }) => {
    if (readOnly) return
    const clipboardItems = await navigator.clipboard?.read?.().catch(() => []) || []
    const files: File[] = []
    for (const item of clipboardItems) {
      const mediaType = item.types.find((type) => isCanvasClipboardMimeAvailable([type]))
      if (!mediaType) continue
      try {
        const blob = await item.getType(mediaType)
        const extension = mediaType === 'image/png' ? 'png'
          : mediaType === 'image/webp' ? 'webp'
            : mediaType.startsWith('image/') ? 'jpg'
              : mediaType.startsWith('video/') ? 'mp4'
                : mediaType.startsWith('audio/') ? 'mp3'
                  : 'glb'
        files.push(new File([blob], `剪贴板素材-${files.length + 1}.${extension}`, { type: mediaType }))
      } catch {
        // A stale or unreadable system item must not prevent the internal
        // canvas clipboard fallback below.
      }
    }
    const source = resolveCanvasClipboardPasteSource({
      hasSystemMedia: files.length > 0,
      systemTextReadable: false,
      systemText: '',
      hasInternalCanvas: Boolean(clipboardRef.current?.nodes.length),
    })
    if (source === 'system-media') {
      await handleUploads(files, position)
      return
    }
    await paste(position)
  }, [handleUploads, paste, readOnly])

  const selectedNodes = nodes.filter((node) => node.selected)
  const selectedEdges = edges.filter((edge) => edge.selected)
  const contextNode = contextMenu?.scope === 'node' ? nodes.find((node) => node.id === contextMenu.nodeId) || null : null
  const canRegenerateContextNode = Boolean(contextNode?.data.prompt && contextNode.data.generation?.modelKey)
  const directlySelectedCreativeNode = selectedNodes.length === 1
    && !selectedNodes[0].type?.startsWith('production_')
    && selectedNodes[0].type !== 'group'
    && selectedNodes[0].type !== 'studio_3d'
    && selectedNodes[0].type !== 'playlist'
    ? selectedNodes[0]
    : null
  const selectedCreativeNode = directlySelectedCreativeNode
  const selectedCreativeNodePosition = selectedCreativeNode
    ? ((selectedCreativeNode as CanvasFlowNode & { positionAbsolute?: { x: number; y: number } }).positionAbsolute || selectedCreativeNode.position)
    : null
  const selectedCreativeNodeSize = selectedCreativeNode ? nodeSize(selectedCreativeNode) : null
  const generatorAnchor = selectedCreativeNode && selectedCreativeNodePosition && selectedCreativeNodeSize
    ? resolveCanvasGeneratorAnchor({
        nodePosition: selectedCreativeNodePosition,
        nodeSize: selectedCreativeNodeSize,
        viewport,
        surface: {
          width: wrapperRef.current?.clientWidth || 1280,
          height: wrapperRef.current?.clientHeight || 800,
        },
        panelWidth: generatorPanelWidth,
      })
    : null
  const incomingNodes = selectedCreativeNode ? edges.filter((edge) => edge.target === selectedCreativeNode.id).map((edge) => nodes.find((node) => node.id === edge.source)).filter((node): node is CanvasFlowNode => Boolean(node)) : []
  const historyNode = historyNodeId ? nodes.find((node) => node.id === historyNodeId) || null : null
  const modelPreviewNode = modelPreviewNodeId ? nodes.find((node) => node.id === modelPreviewNodeId) || null : null
  const mediaPreviewNode = mediaPreviewNodeId ? nodes.find((node) => node.id === mediaPreviewNodeId) || null : null
  const panoramaPreviewNode = panoramaPreviewNodeId ? nodes.find((node) => node.id === panoramaPreviewNodeId) || null : null
  const studioNode = studioNodeId ? nodes.find((node) => node.id === studioNodeId && node.type === 'studio_3d') || null : null
  const studioIncomingNodes = studioNode
    ? edges.filter((edge) => edge.target === studioNode.id).map((edge) => nodes.find((node) => node.id === edge.source)).filter((node): node is CanvasFlowNode => Boolean(node))
    : []
  const runningSignature = nodes.filter((node) => node.data.__server?.status === 'RUNNING' && node.data.generation?.assetId).map((node) => `${node.id}:${node.data.generation?.assetId}`).sort().join('|')
  const persistentTaskSignature = nodes
    .filter((node) => (
      node.data.__server?.status === 'RUNNING'
      && !node.data.generation?.assetId
      && Boolean(node.data.generationTask?.taskId)
    ))
    .map((node) => `${node.id}:${node.data.generationTask?.kind}:${node.data.generationTask?.taskId}`)
    .sort()
    .join('|')

  useEffect(() => {
    if (!persistentTaskSignature) return
    let active = true
    let polling = false
    const poll = async () => {
      if (polling) return
      polling = true
      try {
        const candidates = nodesRef.current
          .filter((node) => (
            node.data.__server?.status === 'RUNNING'
            && !node.data.generation?.assetId
            && Boolean(node.data.generationTask?.taskId)
          ))
          .map((node) => ({
            nodeId: node.id,
            taskId: node.data.generationTask!.taskId,
            kind: node.data.generationTask!.kind,
          }))
        const settled = await Promise.all(candidates.map(async (candidate) => {
          try {
            const update = await fetchCanvasGenerationTask(
              `/api/projects/${encodeURIComponent(projectId)}/canvas/${encodeURIComponent(initialGraph.canvas.id)}/generation-tasks/${encodeURIComponent(candidate.taskId)}`,
            )
            return { ...candidate, update, pollError: null as string | null }
          } catch (error) {
            return {
              ...candidate,
              update: null,
              pollError: error instanceof Error ? error.message : '读取任务状态失败',
            }
          }
        }))
        if (!active) return
        const updates = settled.flatMap((item) => item.update ? [{ ...item, update: item.update }] : [])
        const pollFailures = new Map<string, string>()
        let pollRecovered = false
        for (const item of settled) {
          if (item.update) {
            if (persistentPollFailuresRef.current.has(item.nodeId)) pollRecovered = true
            persistentPollFailuresRef.current.delete(item.nodeId)
            continue
          }
          const failures = (persistentPollFailuresRef.current.get(item.nodeId) || 0) + 1
          persistentPollFailuresRef.current.set(item.nodeId, failures)
          if (failures >= CANVAS_POLL_FAILURE_LIMIT) {
            pollFailures.set(item.nodeId, `连续 ${CANVAS_POLL_FAILURE_LIMIT} 次无法读取生成任务状态：${item.pollError || '网络异常'}`)
          }
        }
        const byNodeId = new Map(updates.map((item) => [item.nodeId, item]))
        const hasTerminalProjection = updates.some((entry) => (
          entry.update.task.status !== 'queued'
          && entry.update.task.status !== 'processing'
          && !(entry.kind === 'storyboard_plan' && entry.update.task.status === 'completed')
        ))
        setNodes((current) => current.map((node) => {
          const pollFailure = pollFailures.get(node.id)
          if (pollFailure) {
            return {
              ...node,
              data: {
                ...node.data,
                pollErrorMessage: pollFailure,
              },
            }
          }
          const entry = byNodeId.get(node.id)
          if (!entry || entry.update.task.id !== entry.taskId || entry.update.task.nodeId !== node.id) return node
          const task = entry.update.task
          if (task.status === 'queued' || task.status === 'processing') {
            const progress = Math.max(node.data.progress || 0, task.progress)
            if (progress === node.data.progress && !node.data.pollErrorMessage) return node
            return { ...node, data: { ...node.data, progress, pollErrorMessage: null } }
          }
          if (task.status === 'completed' && entry.kind === 'storyboard_plan') return node
          if (task.status === 'completed' && entry.kind === 'text') {
            const text = typeof task.result?.text === 'string' ? task.result.text.trim() : ''
            if (!text) {
              return {
                ...node,
                data: {
                  ...node.data,
                  progress: 100,
                  errorMessage: '文本生成完成，但没有返回可用内容',
                  pollErrorMessage: null,
                  generationTask: { ...node.data.generationTask!, completed: true },
                  __server: { ...node.data.__server!, status: 'FAILED' },
                },
              }
            }
            const existing = node.data.history?.find((item) => item.taskId === task.id)
            const item: CanvasGenerationHistoryItem = {
              ...(existing || {
                id: `task:${task.id}`,
                taskId: task.id,
                prompt: node.data.prompt,
                modelKey: node.data.generation?.modelKey,
                createdAt: task.finishedAt || new Date().toISOString(),
              }),
              text,
              status: 'ready',
              errorMessage: null,
            }
            return {
              ...node,
              data: {
                ...node.data,
                text,
                origin: 'generate',
                progress: 100,
                errorMessage: null,
                pollErrorMessage: null,
                generationTask: { ...node.data.generationTask!, completed: true },
                history: prependCanvasGenerationHistory(item, node.data.history),
                __server: { ...node.data.__server!, status: 'SUCCEEDED' },
              },
            }
          }

          const message = canvasGenerationTaskError(task, entry.kind === 'text' ? '文本生成失败' : '故事版规划失败')
          const history = entry.kind === 'text'
            ? (node.data.history || []).map((item) => item.taskId === task.id
              ? { ...item, status: 'failed' as const, errorMessage: message }
              : item)
            : node.data.history
          return {
            ...node,
            data: {
              ...node.data,
              progress: task.progress,
              errorMessage: message,
              pollErrorMessage: null,
              history,
              generationTask: { ...node.data.generationTask!, completed: true },
              __server: { ...node.data.__server!, status: 'FAILED' },
            },
          }
        }))
        if ((hasTerminalProjection || pollFailures.size > 0 || pollRecovered) && !readOnly) markChanged(pollFailures.size > 0 ? '生成任务状态读取异常' : pollRecovered ? '生成任务状态读取已恢复' : '画布生成任务结果回写')
        for (const entry of updates) {
          if (entry.kind === 'storyboard_plan' && entry.update.task.status === 'completed') {
            void materializeStoryboardPlan(entry.nodeId, entry.update)
          }
        }
      } finally {
        polling = false
      }
    }
    void poll()
    const timer = window.setInterval(() => void poll(), 1_500)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [initialGraph.canvas.id, markChanged, materializeStoryboardPlan, persistentTaskSignature, projectId, readOnly])

  useEffect(() => {
    if (!runningSignature) return
    let active = true
    let polling = false
    const poll = async () => {
      if (polling) return
      polling = true
      try {
        const pendingByType = new Map<ToolboxAsset['type'], string[]>()
        for (const node of nodesRef.current) {
          const assetId = node.data.generation?.assetId
          const type = getMediaType(node)
          if (node.data.__server?.status !== 'RUNNING' || !assetId || !isToolboxAssetType(type)) continue
          pendingByType.set(type, [...(pendingByType.get(type) || []), assetId])
        }
        const requests = Array.from(pendingByType.entries()).flatMap(([type, assetIds]) => (
          chunkCanvasToolboxAssetIds(assetIds).map((ids) => ({ type, ids }))
        ))
        const results = await Promise.all(requests.map(async ({ type, ids }) => {
          try {
            const params = new URLSearchParams({ projectId, type, assetIds: ids.join(',') })
            const response = await apiFetch(`/api/frameos/toolbox/assets?${params}`)
            if (!response.ok) throw new Error(await readApiErrorMessage(response, '读取生成状态失败'))
            const payload = await response.json() as { assets?: ToolboxAsset[] }
            return { type, ids, assets: payload.assets || [], error: null as string | null }
          } catch (error) {
            return { type, ids, assets: [] as ToolboxAsset[], error: error instanceof Error ? error.message : '读取生成状态失败' }
          }
        }))
        if (!active) return
        const byId = new Map(results.flatMap((result) => result.assets).map((asset) => [asset.id, asset]))
        const errorByAssetId = new Map(results.flatMap((result) => result.error
          ? result.ids.map((id) => [id, result.error!] as const)
          : []))
        const successfullyPolledAssetIds = new Set(results.flatMap((result) => result.error ? [] : result.ids))
        setNodes((current) => current.map((node) => {
          const assetId = node.data.generation?.assetId
          if (!assetId || node.data.__server?.status !== 'RUNNING') return node
          const nodeType = getMediaType(node)
          if (!isToolboxAssetType(nodeType)) return node
          const pollKey = `${node.id}:${assetId}`
          const pollRecovered = successfullyPolledAssetIds.has(assetId)
          if (pollRecovered) {
            assetPollFailuresRef.current.delete(pollKey)
          }
          const pollError = errorByAssetId.get(assetId)
          if (pollError) {
            const failures = (assetPollFailuresRef.current.get(pollKey) || 0) + 1
            assetPollFailuresRef.current.set(pollKey, failures)
            if (failures >= CANVAS_POLL_FAILURE_LIMIT) {
              const message = `连续 ${CANVAS_POLL_FAILURE_LIMIT} 次无法读取生成状态：${pollError}`
              if (node.data.pollErrorMessage === message) return node
              return {
                ...node,
                data: {
                  ...node.data,
                  pollErrorMessage: message,
                },
              }
            }
            return node
          }
          const asset = byId.get(assetId)
          if (!asset) {
            if (!pollRecovered) return node
            const misses = (assetMissingPollsRef.current.get(pollKey) || 0) + 1
            assetMissingPollsRef.current.set(pollKey, misses)
            if (!isCanvasToolboxAssetMissingTerminal(misses, CANVAS_POLL_FAILURE_LIMIT)) {
              return node.data.pollErrorMessage
                ? { ...node, data: { ...node.data, pollErrorMessage: null } }
                : node
            }
            assetMissingPollsRef.current.delete(pollKey)
            const message = `连续 ${CANVAS_POLL_FAILURE_LIMIT} 次未找到任务资产，请重新生成`
            return {
              ...node,
              data: {
                ...node.data,
                errorMessage: message,
                pollErrorMessage: null,
                history: (node.data.history || []).map((item) => item.assetId === assetId
                  ? { ...item, status: 'failed' as const, errorMessage: message }
                  : item),
                __server: { ...node.data.__server!, status: 'FAILED' },
              },
            }
          }
          assetMissingPollsRef.current.delete(pollKey)
          const { ready, failed } = resolveCanvasToolboxAssetPollState({
            assetStatus: asset.status,
            hasResult: Boolean(asset.url || asset.resultUrl),
            taskStatus: asset.task?.status,
          })
          const progress = ready ? 100 : failed ? node.data.progress || 0 : asset.task?.progress || Math.max(4, node.data.progress || 0)
          const historyItems = (node.data.history || []).map((item) => item.assetId === asset.id ? { ...item, status: ready ? 'ready' as const : failed ? 'failed' as const : 'processing' as const, url: asset.url || asset.resultUrl, materialId: asset.materialId, errorMessage: failed ? asset.errorMessage || asset.task?.errorMessage || '生成失败' : null } : item)
          return { ...node, data: { ...node.data, contentUrl: ready ? asset.url || asset.resultUrl : node.data.contentUrl, imageUrl: ready && asset.type === 'image' ? asset.url || asset.resultUrl : node.data.imageUrl, videoUrl: ready && asset.type === 'video' ? asset.url || asset.resultUrl : node.data.videoUrl, audioUrl: ready && asset.type === 'audio' ? asset.url || asset.resultUrl : node.data.audioUrl, modelUrl: ready && asset.type === 'model3d' ? asset.url || asset.resultUrl : node.data.modelUrl, posterUrl: ready && asset.type === 'model3d' && asset.params?.thumbnailUrl ? asset.params.thumbnailUrl : node.data.posterUrl, materialId: ready ? asset.materialId : node.data.materialId, sourceMetadata: ready ? asset.materialMetadata || node.data.sourceMetadata : node.data.sourceMetadata, progress, errorMessage: failed ? asset.errorMessage || asset.task?.errorMessage || '生成失败' : null, pollErrorMessage: null, history: historyItems, __server: { ...node.data.__server!, status: ready ? 'SUCCEEDED' : failed ? 'FAILED' : 'RUNNING' } } }
        }))
        // Toolbox workers project terminal state into the canvas node with a
        // task/asset compare-and-swap guard. Polling is intentionally display
        // only: persisting transient read errors (or a locally inferred
        // missing-asset failure) can race and overwrite that server truth.
      } finally {
        polling = false
      }
    }
    void poll()
    const timer = window.setInterval(() => void poll(), 2_500)
    return () => { active = false; window.clearInterval(timer) }
  }, [projectId, runningSignature])

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const dismissTransientUi = () => {
        setContextMenu(null)
        setWireMenu(null)
        setAddOpen(false)
        setAssetsOpen(false)
        setPickerOpen(false)
        setOrganizeOpen(false)
        setHelpOpen(false)
        setNodes((current) => current.map((node) => ({ ...node, selected: false })))
      }
      // Escape always dismisses canvas chrome, including when a search field in
      // the project-assets surface owns focus. Other input shortcuts stay local.
      if (event.key === 'Escape') {
        dismissTransientUi()
        return
      }
      if (hasInputFocus()) return
      const mod = event.metaKey || event.ctrlKey
      if (productionSyncing || offlineRecoveryBlocking) {
        if (shouldBlockCanvasShortcutWhileLocked(event)) event.preventDefault()
        return
      }
      if (mod && event.key.toLowerCase() === 'z') { if (readOnly) return; event.preventDefault(); if (event.shiftKey) redo(); else undo(); return }
      if (mod && event.key.toLowerCase() === 'y') { if (readOnly) return; event.preventDefault(); redo(); return }
      if (mod && event.key.toLowerCase() === 'c') { event.preventDefault(); void copySelection(); return }
      if (mod && event.key.toLowerCase() === 'x') { if (readOnly) return; event.preventDefault(); void copySelection(true); return }
      if (mod && event.key.toLowerCase() === 'v') { if (readOnly) return; event.preventDefault(); void pasteFromSystem().catch((error: unknown) => setToast(error instanceof Error ? error.message : '粘贴失败')); return }
      if (mod && event.key.toLowerCase() === 'd') { if (readOnly) return; event.preventDefault(); duplicateNodes(nodesRef.current.filter((node) => node.selected).map((node) => node.id)); return }
      if (mod && event.key.toLowerCase() === 'a') { event.preventDefault(); setNodes((current) => current.map((node) => ({ ...node, selected: true }))); return }
      if (mod && event.key.toLowerCase() === 's') { if (readOnly) return; event.preventDefault(); void flushAutosave(); return }
      if (mod && (event.key === '+' || event.key === '=')) { event.preventDefault(); void flow?.zoomIn({ duration: 120 }); return }
      if (mod && event.key === '-') { event.preventDefault(); void flow?.zoomOut({ duration: 120 }); return }
      if (mod && event.key === '0') { event.preventDefault(); void flow?.setViewport({ x: 0, y: 0, zoom: 1 }, { duration: 180 }); return }
      if (!mod && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
        if (readOnly || !nodesRef.current.some((node) => node.selected)) return
        event.preventDefault()
        const distance = event.shiftKey ? 50 : 5
        const delta = event.key === 'ArrowUp'
          ? { x: 0, y: -distance }
          : event.key === 'ArrowDown'
            ? { x: 0, y: distance }
            : event.key === 'ArrowLeft'
              ? { x: -distance, y: 0 }
              : { x: distance, y: 0 }
        nudgeSelection(delta)
        return
      }
      if (event.key === 'Backspace' || event.key === 'Delete') { if (readOnly) return; event.preventDefault(); removeCurrentSelection(); return }
      if (event.key.toLowerCase() === 'm') { setMinimapVisible((value) => !value); return }
      if (event.key === '?') {
        setAddOpen(false)
        setAssetsOpen(false)
        setOrganizeOpen(false)
        setHelpOpen((value) => !value)
        return
      }
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [copySelection, duplicateNodes, flow, flushAutosave, nudgeSelection, offlineRecoveryBlocking, pasteFromSystem, productionSyncing, readOnly, redo, removeCurrentSelection, undo])

  const handleContextAction = (action: string) => {
    const menu = contextMenu
    setContextMenu(null)
    if (!menu) return
    if (readOnly && action !== 'copy' && action !== 'reset-viewport') return
    if (menu.scope === 'node') {
      if (action === 'copy') { setNodes((current) => current.map((node) => ({ ...node, selected: node.id === menu.nodeId }))); void copySelection(false, [menu.nodeId]) }
      if (action === 'duplicate') duplicateNodes([menu.nodeId])
      if (action === 'delete') removeNodes([menu.nodeId])
      if (action === 'regenerate') runNodeAction(menu.nodeId, 'regenerate')
      return
    }
    if (menu.scope === 'group') {
      if (action === 'copy') {
        setNodes((current) => current.map((node) => ({ ...node, selected: node.id === menu.groupId })))
        void copySelection(false, [menu.groupId])
      }
      if (action === 'duplicate') duplicateNodes([menu.groupId])
      if (action === 'delete') {
        const group = nodesRef.current.find((node) => node.id === menu.groupId && node.type === 'group')
        const count = group?.data.memberIds?.length || 0
        if (group && window.confirm(`将删除「${group.data.title || '组'}」及组内 ${count} 个节点，此操作可以通过撤销恢复。是否继续？`)) removeGroupsWithMembers([menu.groupId])
      }
      return
    }
    if (menu.scope === 'edge' && action === 'delete-edge') { removeEdgesById([menu.edgeId]); return }
    if (menu.scope === 'pane') {
      if (action === 'add-playlist') { addNode('playlist', menu.flowPosition || centerPosition()); return }
      if (action === 'add-node') { pendingInsertPositionRef.current = menu.flowPosition || null; setAssetsOpen(false); setHelpOpen(false); setOrganizeOpen(false); setAddOpen(true); return }
      if (action === 'upload') { openUploadPicker(menu.flowPosition); return }
      if (action === 'paste') { void pasteFromSystem(menu.flowPosition).catch((error: unknown) => setToast(error instanceof Error ? error.message : '粘贴失败')); return }
      if (action === 'organize') { organize('horizontal'); return }
      if (action === 'reset-viewport') void flow?.setViewport({ x: 0, y: 0, zoom: 1 }, { duration: 180 })
    }
  }

  const handleWirePick = (type: CanvasNodeMenuType) => {
    if (!wireMenu) return
    const created = addNode(type, wireMenu.flowPosition || centerPosition())
    if (!created) return
    if (wireMenu.sourceHandle === 'input' || wireMenu.sourceHandle === 'left') {
      connect({ source: created.id, target: wireMenu.sourceNodeId, sourceHandle: 'output', targetHandle: 'input' }, [created])
    } else {
      connect({ source: wireMenu.sourceNodeId, target: created.id, sourceHandle: 'output', targetHandle: 'input' }, [created])
    }
  }

  const shouldSuppressContextMenu = () => (
    Boolean(rightPanGestureRef.current?.moved)
    || Date.now() < suppressContextMenuUntilRef.current
  )

  const startMiniMapDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !(event.target instanceof Element)) return false
    const panel = event.target.closest('.nori-canvas-minimap') as HTMLElement | null
    const svg = panel?.querySelector<SVGSVGElement>('.react-flow__minimap-svg') || null
    const surface = wrapperRef.current?.querySelector<HTMLElement>('.react-flow') || null
    if (!panel || !svg || !surface) return false

    const pointer = miniMapFlowPointFromClient(svg, { x: event.clientX, y: event.clientY })
    const size = { width: surface.clientWidth, height: surface.clientHeight }
    const drag = pointer ? beginMiniMapDrag(pointer, viewportRef.current, size) : null
    if (!drag) return false

    miniMapDragRef.current = { pointerId: event.pointerId, svg, panel, drag, size }
    panel.classList.add('is-dragging')
    try {
      // Keep pointer delivery owned by the MiniMap. Capturing it on the whole
      // workspace retargets the next move to the canvas pane and React Flow
      // consumes the gesture before the MiniMap can update the viewport.
      panel.setPointerCapture(event.pointerId)
    } catch {
      // Window-level pointer delivery still lets a short drag complete.
    }
    event.preventDefault()
    event.stopPropagation()
    return true
  }

  const moveMiniMapDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const active = miniMapDragRef.current
    if (!active || active.pointerId !== event.pointerId) return false
    const pointer = miniMapFlowPointFromClient(active.svg, { x: event.clientX, y: event.clientY })
    const next = pointer ? miniMapViewportForPointer(pointer, active.drag, active.size) : null
    if (next && flow) void flow.setViewport(next)
    event.preventDefault()
    event.stopPropagation()
    return true
  }

  const finishMiniMapDrag = (pointerId: number) => {
    const active = miniMapDragRef.current
    if (!active || active.pointerId !== pointerId) return false
    active.panel.classList.remove('is-dragging')
    miniMapDragRef.current = null
    try {
      if (active.panel.hasPointerCapture(pointerId)) active.panel.releasePointerCapture(pointerId)
    } catch {
      // Pointer capture may already be released by the browser.
    }
    return true
  }

  return (
    <CanvasEditorProvider value={editorContext}>
      <div
        className={`nori-canvas-workspace${readOnly ? ' is-readonly' : ''}${productionSyncing ? ' is-syncing' : ''}${layoutAnimating ? ' is-layout-animating' : ''}`}
        ref={wrapperRef}
        tabIndex={0}
        onPointerDownCapture={(event) => {
          if (startMiniMapDrag(event)) return
          if (event.button === 2) {
            rightPanGestureRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, moved: false }
            return
          }
          if (
            event.button === 0
            && !writeLocked
            && !connectionActiveRef.current
            && (event.target as HTMLElement).classList.contains('react-flow__pane')
          ) {
            edgeSelectionGestureRef.current = {
              pointerId: event.pointerId,
              start: { x: event.clientX, y: event.clientY },
              additive: event.shiftKey || event.metaKey || event.ctrlKey,
            }
          }
        }}
        onPointerMoveCapture={(event) => {
          if (moveMiniMapDrag(event)) return
          const gesture = rightPanGestureRef.current
          if (!gesture || gesture.pointerId !== event.pointerId || gesture.moved) return
          gesture.moved = Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 4
        }}
        onPointerUpCapture={(event) => {
          if (finishMiniMapDrag(event.pointerId)) {
            event.preventDefault()
            event.stopPropagation()
            return
          }
          const edgeSelection = edgeSelectionGestureRef.current
          if (edgeSelection?.pointerId === event.pointerId) {
            edgeSelectionGestureRef.current = null
            if (Math.hypot(event.clientX - edgeSelection.start.x, event.clientY - edgeSelection.start.y) > 5) {
              const end = { x: event.clientX, y: event.clientY }
              window.requestAnimationFrame(() => selectElementsCoveredByRect(edgeSelection.start, end, edgeSelection.additive))
            }
          }
          const gesture = rightPanGestureRef.current
          if (!gesture || gesture.pointerId !== event.pointerId) return
          if (gesture.moved) suppressContextMenuUntilRef.current = Date.now() + 250
          rightPanGestureRef.current = null
        }}
        onPointerCancelCapture={(event) => {
          finishMiniMapDrag(event.pointerId)
          rightPanGestureRef.current = null
          edgeSelectionGestureRef.current = null
        }}
        onLostPointerCapture={(event) => { finishMiniMapDrag(event.pointerId) }}
        onPointerDown={() => { setContextMenu(null); setWireMenu(null) }}
        onDoubleClick={(event) => { if (!writeLocked && (event.target as HTMLElement).classList.contains('react-flow__pane')) addNode('text', flow?.screenToFlowPosition({ x: event.clientX, y: event.clientY }) || centerPosition()) }}
        onDragOver={(event) => { if (!writeLocked && (event.dataTransfer.types.includes(CANVAS_MATERIAL_DRAG_TYPE) || event.dataTransfer.types.includes(CANVAS_WORKFLOW_DRAG_TYPE) || event.dataTransfer.types.includes('Files'))) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy' } }}
        onDrop={(event) => {
          if (writeLocked) return
          const workflowRaw = event.dataTransfer.getData(CANVAS_WORKFLOW_DRAG_TYPE)
          if (workflowRaw) {
            event.preventDefault()
            try {
              insertWorkflow(JSON.parse(workflowRaw) as CanvasWorkflowTemplate, flow?.screenToFlowPosition({ x: event.clientX, y: event.clientY }) || centerPosition())
            } catch {
              setToast('无法读取拖拽的工作流模板')
            }
            return
          }
          const raw = event.dataTransfer.getData(CANVAS_MATERIAL_DRAG_TYPE)
          if (!raw && event.dataTransfer.files.length > 0) {
            event.preventDefault()
            const position = flow?.screenToFlowPosition({ x: event.clientX, y: event.clientY }) || centerPosition()
            void handleUploads(event.dataTransfer.files, position).catch((error: unknown) => setToast(error instanceof Error ? error.message : '上传失败'))
            return
          }
          if (!raw) return
          event.preventDefault()
          try {
            const material = JSON.parse(raw) as FrameosMaterialItem
            if (!['image', 'video', 'audio', 'model3d'].includes(material.type)) throw new Error('invalid material')
            insertMaterial(material, flow?.screenToFlowPosition({ x: event.clientX, y: event.clientY }) || centerPosition())
          } catch {
            setToast('无法读取拖拽的项目资产')
          }
        }}
      >
        <div className="nori-canvas-surface">
          <ReactFlow<CanvasFlowNode, CanvasFlowEdge>
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onInit={setFlow}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={connect}
            onConnectStart={() => { connectionActiveRef.current = true; setConnectionActive(true); edgeSelectionGestureRef.current = null }}
            isValidConnection={validateConnection}
            onConnectEnd={(event, state: FinalConnectionState) => {
              connectionActiveRef.current = false
              setConnectionActive(false)
              if (writeLocked || state.isValid || !state.fromNode) return
              const point = 'clientX' in event ? { x: event.clientX, y: event.clientY } : { x: event.changedTouches[0]?.clientX || 0, y: event.changedTouches[0]?.clientY || 0 }
              if (state.toHandle) return
              if (state.toNode) {
                const sourceHandle = state.fromHandle?.id || 'output'
                const targetHandle = sourceHandle === 'input' || sourceHandle === 'left' ? 'output' : 'input'
                connect({ source: state.fromNode.id, target: state.toNode.id, sourceHandle, targetHandle })
                return
              }
              setWireMenu({ ...visibleMenuPoint(point.x, point.y, 210), flowPosition: flow?.screenToFlowPosition(point), sourceNodeId: state.fromNode.id, sourceHandle: state.fromHandle?.id || null })
            }}
            onNodeDragStart={onNodeDragStart}
            onNodeDrag={onNodeDrag}
            onNodeDragStop={onNodeDragStop}
            onSelectionDragStart={onSelectionDragStart}
            onSelectionDragStop={onSelectionDragStop}
            onMove={(_event, next) => setViewportState(next)}
            onMoveEnd={(_event, next) => {
              const previous = viewportRef.current
              const changed = Math.abs(previous.x - next.x) > 0.001
                || Math.abs(previous.y - next.y) > 0.001
                || Math.abs(previous.zoom - next.zoom) > 0.0001
              setViewportState(next)
              viewportRef.current = next
              if (!writeLocked && changed) markChanged('调整画布视图')
            }}
            onPaneClick={() => { setAddOpen(false); setOrganizeOpen(false); setContextMenu(null); setWireMenu(null) }}
            onPaneContextMenu={(event) => { event.preventDefault(); if (shouldSuppressContextMenu()) return; setClipboardCanPaste(Boolean(clipboardRef.current?.nodes.length)); void refreshClipboardAvailability(); setContextMenu({ scope: 'pane', ...visibleMenuPoint(event.clientX, event.clientY, readOnly ? 50 : 270), flowPosition: flow?.screenToFlowPosition({ x: event.clientX, y: event.clientY }) }) }}
            onNodeContextMenu={(event, node) => { event.preventDefault(); if (shouldSuppressContextMenu()) return; setContextMenu(node.type === 'group' ? { scope: 'group', groupId: node.id, ...visibleMenuPoint(event.clientX, event.clientY, readOnly ? 50 : 145) } : { scope: 'node', nodeId: node.id, ...visibleMenuPoint(event.clientX, event.clientY, readOnly ? 50 : 165) }) }}
            onEdgeContextMenu={(event, edge) => { event.preventDefault(); if (!writeLocked) setContextMenu({ scope: 'edge', edgeId: edge.id, ...visibleMenuPoint(event.clientX, event.clientY, 50) }) }}
            defaultViewport={initialGraph.canvas.viewport || { x: 0, y: 0, zoom: 1 }}
            minZoom={0.15}
            maxZoom={5}
            connectionMode={ConnectionMode.Loose}
            connectionRadius={64}
            reconnectRadius={64}
            nodesDraggable={!writeLocked}
            nodesConnectable={!writeLocked}
            selectionOnDrag={!connectionActive}
            selectionMode={SelectionMode.Partial}
            paneClickDistance={8}
            panOnDrag={[1, 2]}
            panActivationKeyCode="Space"
            panOnScroll
            zoomOnScroll
            zoomOnPinch
            zoomActivationKeyCode={['Meta', 'Control']}
            multiSelectionKeyCode={['Shift', 'Meta', 'Control']}
            deleteKeyCode={null}
            proOptions={{ hideAttribution: true }}
            colorMode="dark"
          >
            <Background id="minor-grid" color="rgba(255,255,255,.055)" gap={22} size={1} />
            <Background id="major-grid" color="rgba(255,255,255,.10)" gap={44} size={1.2} />
            {minimapVisible ? <MiniMap<CanvasFlowNode>
              position="bottom-left"
              pannable={false}
              zoomable
              zoomStep={8}
              offsetScale={8}
              ariaLabel="画布小地图：拖动蓝色视口可快速定位节点"
              className="nori-canvas-minimap"
              nodeColor={minimapNodeColor}
              nodeStrokeColor={(node) => node.selected ? '#b8c8ff' : 'rgba(255,255,255,.2)'}
              nodeStrokeWidth={3}
              maskColor="rgba(4,6,10,.58)"
              maskStrokeColor="rgba(126,159,255,.92)"
              maskStrokeWidth={2}
            /> : null}
          </ReactFlow>
        </div>
        {productionSyncing ? <div className="nori-canvas-sync-lock" role="status" aria-live="polite"><span><i />正在同步项目内容，请稍候…</span></div> : null}
        {autosave.offlineRecoveryState === 'loading' ? <div className="nori-canvas-sync-lock" role="status" aria-live="polite"><span><i />正在检查本地未同步版本…</span></div> : null}

        <CanvasChrome projectId={projectId} projectName={projectName} canvases={canvases} activeCanvas={{ ...(canvases.find((canvas) => canvas.id === canvasRef.current.id) || canvasRef.current), nodeCount: nodes.length }} saveState={autosave.saveState} canUndo={canUndo} canRedo={canRedo} onSelectCanvas={onSelectCanvas} onCreateCanvas={onCreateCanvas} onRenameCanvas={onRenameCanvas} onDeleteCanvas={onDeleteCanvas} projectOptions={projectOptions} onSelectProject={onSelectProject} canvasHomeHref={canvasHomeHref} createProjectHref={createProjectHref} onUndo={undo} onRedo={redo} onRetrySave={autosave.retry} onOpenRevisions={openRevisions} syncingProduction={productionSyncing} canSyncProduction={!readOnly} readOnly={readOnly} onOpenProjectAssets={() => { setAddOpen(false); setHelpOpen(false); setOrganizeOpen(false); setAssetsOpen(true) }} onSyncProduction={() => void syncProduction()} />

        <CanvasToolRail editable={!readOnly} addOpen={addOpen} assetsOpen={assetsOpen} onToggleAdd={() => { pendingInsertPositionRef.current = null; setAssetsOpen(false); setHelpOpen(false); setOrganizeOpen(false); setAddOpen((value) => !value) }} onToggleAssets={() => { pendingInsertPositionRef.current = null; setAddOpen(false); setHelpOpen(false); setOrganizeOpen(false); setAssetsOpen((value) => !value) }} onOpenLibrary={() => setPickerOpen(true)} onUpload={() => openUploadPicker()} onHelp={() => { setAddOpen(false); setAssetsOpen(false); setOrganizeOpen(false); setHelpOpen((value) => !value) }} />
        {!readOnly && addOpen ? <CanvasAddPanel onAddNode={(type) => { const position = pendingInsertPositionRef.current || undefined; pendingInsertPositionRef.current = null; addNode(type, position) }} onUpload={() => { const position = pendingInsertPositionRef.current || undefined; pendingInsertPositionRef.current = null; openUploadPicker(position) }} /> : null}
        {!readOnly && assetsOpen ? <CanvasProjectAssets projectId={projectId} onInsert={insertMaterial} onInsertWorkflow={insertWorkflow} onClose={() => setAssetsOpen(false)} refreshKey={workflowRefreshKey} /> : null}
        <CanvasViewportControls minimapVisible={minimapVisible} zoom={viewport.zoom} organizeMode={organizeMode} organizeOpen={organizeOpen} canOrganize={!readOnly} onToggleMinimap={() => setMinimapVisible((value) => !value)} onZoomIn={() => void flow?.zoomIn({ duration: 120 })} onZoomOut={() => void flow?.zoomOut({ duration: 120 })} onFitView={() => void flow?.fitView({ padding: 0.18, duration: 250 })} onResetViewport={() => void flow?.setViewport({ x: 0, y: 0, zoom: 1 }, { duration: 180 })} onToggleOrganize={() => { setAddOpen(false); setAssetsOpen(false); setHelpOpen(false); setOrganizeOpen((value) => !value) }} onOrganize={organize} />
        {nodes.length === 0 ? <CanvasEmptyState readOnly={readOnly} onAdd={(type) => addNode(type)} onUpload={() => openUploadPicker()} /> : null}
        {helpOpen ? <CanvasHelpPanel onClose={() => setHelpOpen(false)} /> : null}
        {(selectedNodes.length > 1 || selectedEdges.length > 0) && !readOnly ? <div className="nori-canvas-selection-toolbar">{selectedNodes.length > 1 ? <><button type="button" onClick={createGroup}>成组</button><button type="button" className="is-primary" onClick={() => organizeSelection('vertical')}>纵向整理</button><button type="button" onClick={() => organizeSelection('horizontal')}>横向排列</button></> : null}<button type="button" className="is-danger" onClick={removeCurrentSelection}>删除选中{selectedEdges.length ? `连线 ${selectedEdges.length}` : ''}</button></div> : null}
        {!readOnly && selectedCreativeNode ? <CanvasGenerator projectId={projectId} node={selectedCreativeNode} incomingNodes={incomingNodes} referenceNodes={nodes} anchor={generatorAnchor} panelWidth={generatorPanelWidth} onPanelWidthChange={updateGeneratorPanelWidth} onDraftChange={(patch) => updateNodeData(selectedCreativeNode.id, patch as Partial<CanvasNodeData>)} onGenerate={handleGenerate} onReplace={() => requestContentReplacement(selectedCreativeNode.id)} onClose={() => setNodes((current) => current.map((node) => node.id === selectedCreativeNode.id ? { ...node, selected: false } : node))} onFocus={() => { const source = incomingNodes.find((node) => getMediaType(node) === 'image'); if (source) setImageOperation({ mode: 'lens_focus', sourceNodeId: source.id, targetNodeId: selectedCreativeNode.id }); else setToast('请先连接一张可用图片') }} /> : null}
        {contextMenu ? <CanvasContextMenu state={contextMenu} canPaste={!readOnly && clipboardCanPaste} canRegenerate={!readOnly && canRegenerateContextNode} readOnly={readOnly} onAction={handleContextAction} /> : null}
        {!readOnly && wireMenu ? <CanvasWireMenu state={wireMenu} onPick={handleWirePick} /> : null}
        {historyNode ? <CanvasHistoryDialog node={historyNode} canUse={!readOnly} onClose={() => setHistoryNodeId(null)} onUse={(item) => { const type = getMediaType(historyNode); updateNodeData(historyNode.id, { text: type === 'text' && typeof item.text === 'string' ? item.text : historyNode.data.text, contentUrl: type === 'text' ? historyNode.data.contentUrl : item.url, imageUrl: type === 'image' ? item.url : historyNode.data.imageUrl, videoUrl: type === 'video' ? item.url : historyNode.data.videoUrl, audioUrl: type === 'audio' ? item.url : historyNode.data.audioUrl, materialId: type === 'text' ? historyNode.data.materialId : item.materialId || historyNode.data.materialId }, '选用历史版本'); setHistoryNodeId(null) }} /> : null}
        {revisionsOpen ? <CanvasRevisionDialog revisions={revisions} currentRevision={canvasRef.current.revision} loading={revisionsLoading} restoringId={restoringRevisionId} canRestore={!readOnly} error={revisionsError} onReload={() => void loadRevisions()} onRestore={(revision) => void restoreRevision(revision)} onClose={() => { if (!restoringRevisionId) setRevisionsOpen(false) }} /> : null}
        {!readOnly && imageOperation ? (() => { const node = nodes.find((item) => item.id === imageOperation.sourceNodeId); return node ? <CanvasImageOperationDialog projectId={projectId} canvasId={initialGraph.canvas.id} mode={imageOperation.mode} node={node} onSubmit={handleImageOperation} onRecover={applyImageOperationResults} isTaskMaterialized={isOperationTaskMaterialized} onClose={() => setImageOperation(null)} /> : null })() : null}
        {!readOnly && videoOperation ? (() => { const node = nodes.find((item) => item.id === videoOperation.sourceNodeId); return node ? <CanvasVideoOperationDialog projectId={projectId} canvasId={initialGraph.canvas.id} mode={videoOperation.mode} node={node} onSubmit={handleVideoOperation} onRecover={applyVideoOperationResults} isTaskMaterialized={isOperationTaskMaterialized} onClose={() => setVideoOperation(null)} /> : null })() : null}
        {mediaPreviewNode ? <CanvasMediaPreviewDialog node={mediaPreviewNode} onClose={() => setMediaPreviewNodeId(null)} /> : null}
        {modelPreviewNode?.data.modelUrl ? <CanvasModel3DDialog src={toDisplayImageUrl(modelPreviewNode.data.modelUrl) || modelPreviewNode.data.modelUrl} title={modelPreviewNode.data.title || '3D 模型'} onClose={() => setModelPreviewNodeId(null)} /> : null}
        {panoramaPreviewNode && (panoramaPreviewNode.data.contentUrl || panoramaPreviewNode.data.imageUrl) ? <CanvasPanoramaDialog src={toDisplayImageUrl(panoramaPreviewNode.data.contentUrl || panoramaPreviewNode.data.imageUrl) || panoramaPreviewNode.data.contentUrl || panoramaPreviewNode.data.imageUrl || ''} title={panoramaPreviewNode.data.title || '720 全景图'} readOnly={readOnly} onCapture={handlePanoramaCapture} onClose={() => setPanoramaPreviewNodeId(null)} /> : null}
        {studioNode ? <CanvasStudio3DDialog projectId={projectId} canvasId={initialGraph.canvas.id} node={studioNode} incomingNodes={studioIncomingNodes} readOnly={readOnly} onSummaryChange={handleStudioSummaryChange} onStageCaptures={handleStudioStageCaptures} onSendCaptures={handleStudioCapture} onClose={() => setStudioNodeId(null)} /> : null}
        {!readOnly && workflowGroupId ? <CanvasWorkflowDialog initialName={`${nodes.find((node) => node.id === workflowGroupId)?.data.title || '工作流'} 模板`} onConfirm={saveWorkflow} onClose={() => setWorkflowGroupId(null)} /> : null}
        {!readOnly && imageEditNodeId ? (() => { const node = nodes.find((item) => item.id === imageEditNodeId); return node ? <CanvasImageEditDialog node={node} onSubmit={handleImageEdit} onClose={() => setImageEditNodeId(null)} /> : null })() : null}
        {!readOnly && pickerOpen ? <MaterialPickerDialog projectId={projectId} uploadEndpoint={`/api/projects/${projectId}/canvas/${initialGraph.canvas.id}/materials`} allowAllTypes multiple maxSelected={100} title="从素材库选择" confirmLabel="添加到画布" onConfirm={(materials) => { const anchor = centerPosition(); const columns = Math.max(1, Math.ceil(Math.sqrt(materials.length))); materials.forEach((material, index) => insertMaterial(material, { x: anchor.x + (index % columns) * 360, y: anchor.y + Math.floor(index / columns) * 290 })); setPickerOpen(false) }} onClose={() => setPickerOpen(false)} /> : null}
        {!readOnly && autosave.conflictOpen ? <CanvasConflictDialog loading={conflictLoading} onLoadServer={() => { setConflictLoading(true); void autosave.loadServerVersion().finally(() => setConflictLoading(false)) }} onMerge={() => { setConflictLoading(true); void autosave.mergeServerVersion().finally(() => setConflictLoading(false)) }} /> : null}
        {!readOnly && autosave.offlineRecoveryState === 'pending' && autosave.offlineDraft ? <CanvasOfflineRecoveryDialog draft={autosave.offlineDraft} serverRevision={autosave.revision.current} loading={offlineRecoveryLoading} onUseServer={() => { setOfflineRecoveryLoading(true); void autosave.useServerVersion().finally(() => setOfflineRecoveryLoading(false)) }} onRestoreLocal={() => { setOfflineRecoveryLoading(true); void autosave.restoreLocalVersion().finally(() => setOfflineRecoveryLoading(false)) }} /> : null}
        {!readOnly ? <input ref={uploadRef} type="file" multiple accept="image/*,video/*,audio/*,.glb,model/gltf-binary" className="hidden" onChange={(event) => { const files = event.target.files ? Array.from(event.target.files) : []; const position = pendingUploadPositionRef.current || undefined; pendingUploadPositionRef.current = null; event.target.value = ''; if (files.length > 0) void handleUploads(files, position).catch((error: unknown) => setToast(error instanceof Error ? error.message : '上传失败')) }} /> : null}
        {!readOnly ? <input ref={replacementUploadRef} type="file" accept="image/*,video/*,audio/*,.glb,model/gltf-binary" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; const nodeId = replacementNodeIdRef.current; event.target.value = ''; replacementNodeIdRef.current = null; if (file && nodeId) void handleContentReplacement(nodeId, file).catch((error: unknown) => setToast(error instanceof Error ? error.message : '替换内容失败')) }} /> : null}
        {toast ? <div className="nori-canvas-toast">{toast}</div> : null}
      </div>
    </CanvasEditorProvider>
  )
}

function CanvasGraphLoader(props: Props) {
  const { projectId, canvasId } = props
  const query = useCanvasGraph(projectId, canvasId)
  if (query.isLoading) return <div className="nori-canvas-loading">正在加载画布…</div>
  if (query.error || !query.data) return <div className="nori-canvas-loading is-error"><span>画布加载失败：{String(query.error || '未返回数据')}</span><button type="button" onClick={() => void query.refetch()}>重试加载</button></div>
  return <CanvasEditor key={`${canvasId}:${query.data.canvas.revision}`} {...props} initialGraph={query.data} />
}

export default function CanvasGraph(props: Props) {
  return <ReactFlowProvider><CanvasGraphLoader {...props} /></ReactFlowProvider>
}
