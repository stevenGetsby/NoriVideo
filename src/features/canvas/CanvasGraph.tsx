'use client'


import { Link } from '@/i18n/navigation'
import { nodeSize, getMediaType, minimapNodeColor, getReplaceableMediaType, safeFileName, extensionForNode, extraReferenceMaterialIds, imageEditMaskMaterialId, createHistoryItem, readNodeGenerationTaskId } from './canvas-node-presentation-utils'
import { confirmAction } from '@/lib/ui/feedback'
import type { AgentGraphChange } from './agent/bridge-types'
import { createCanvasAgentTurnController } from './agent/turn-record'
import { useCanvasAgentBridge } from './agent/useCanvasAgentBridge'
import { CanvasAgentDock } from './agent/CanvasAgentDock'
import { CanvasAgentGhostSlot } from './agent/CanvasAgentGhostSlot'
import { createAgentFeedbackStore } from './agent/feedback-store'
import { fitCanvasAgentBounds, followCanvasAgentNodes } from './agent/viewport'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { startVisiblePolling } from '@/hooks/common/useVisiblePolling'
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
  getViewportForBounds,
  useStoreApi,
  type Connection,
  type EdgeChange,
  type EdgeMouseHandler,
  type NodeChange,
  type NodeMouseHandler,
  type OnConnectEnd,
  type OnConnectStart,
  type OnMove,
  type ReactFlowInstance,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import './canvas.css'
import './story/story-canvas.css'
import { useNoriTheme } from '@/lib/theme/useNoriTheme'
import { canvasThemeColors } from './theme-colors'

import { apiFetch } from '@/lib/api-fetch'
import { settleWithConcurrency } from '@/lib/async/settle-with-concurrency'
import { readApiErrorMessage } from '@/lib/api/read-error-message'
import { CANVAS_DOCUMENT_SCHEMA_VERSION } from '@/lib/canvas/document-version'
import { buildCanvasGenerationMaterialReferences } from '@/lib/canvas/generation-reference-contract'
import { removeDeletedCanvasReferences, requireExistingReferenceNodeIds } from './reference-resolution'
import { isTextEntryTarget } from './context-menu-target'
import { selectServerOnlyEntities } from './graph-merge'
import { resolvePasteDecision } from './paste-target'
import { createMaterialFlowNode } from './material-node'
import { downloadFrameosMaterial } from '@/components/frameos/materials/download-material'
import { getProjectDownloadDirectory, saveProjectDownload } from '@/lib/media/project-download-directory'
import { buildNovelVideoExportFileName } from '@/lib/novel-promotion/video-export-name'
import { CANVAS_PANORAMA_ASPECT_RATIO } from '@/lib/canvas/generator-options'
import {
  composeCanvasGlobalStylePrompt,
  composeCanvasVideoPrefixPrompt,
  findCanvasGlobalStylePromptNode,
  readCanvasGlobalStylePrompt,
  readCanvasVideoPrefixPrompt,
} from '@/lib/canvas/global-style-prompt'
import { CANVAS_PANORAMA_PROCESS_TYPE } from '@/lib/canvas/panorama-contract'
import { toDisplayImageUrl } from '@/lib/media/image-url'
import { MaterialPickerDialog } from '@/components/frameos/materials/MaterialPickerDialog'
import type { FrameosMaterialItem } from '@/components/frameos/materials/contracts'
import { CanvasEditorProvider, CanvasMultiSelectionProvider, type CanvasNodeAction, type CanvasPlaylistVideoSource } from './CanvasEditorContext'
import { CanvasGenerator, type CanvasGenerateRequest } from './components/CanvasGenerator'
import { CANVAS_UPLOAD_MAX_ATTEMPTS, canvasUploadRetryDelay } from './upload-retry'
import { CanvasChrome } from './components/CanvasChrome'
import { canvasOrganizeOption } from './components/CanvasOrganizeMenu'
import { CanvasConflictDialog, CanvasHistoryDialog, CanvasOfflineRecoveryDialog, CanvasRevisionDialog, CanvasTaskIdDialog } from './components/CanvasDialogs'
import { CanvasHelpPanel } from './components/CanvasHelpPanel'
import { CanvasImageOperationDialog, type CanvasImageOperationInput, type CanvasImageOperationMode } from './components/CanvasImageOperationDialog'
import { CanvasImageEditDialog } from './components/CanvasImageEditDialog'
import { CanvasModel3DDialog } from './components/CanvasModel3D'
import { CanvasMediaPreviewDialog } from './components/CanvasMediaPreviewDialog'
import { CanvasVideoOperationDialog, type CanvasVideoOperationInput, type CanvasVideoOperationMode } from './components/CanvasVideoOperationDialog'
import {
  CANVAS_MATERIAL_COLLECTION_DRAG_TYPE,
  CANVAS_MATERIAL_DRAG_TYPE,
  CANVAS_WORKFLOW_DRAG_TYPE,
  CanvasProjectAssets,
  type CanvasWorkflowTemplate,
} from './components/CanvasProjectAssets'
import { CanvasWorkflowDialog } from './components/CanvasWorkflowDialog'
import { CanvasAssetLibraryDialog } from './components/CanvasAssetLibraryDialog'
import { CanvasViewportLayer } from './components/CanvasViewportLayer'
import { CanvasPanoramaDialog } from './components/CanvasPanoramaDialog'
import type { FrameosAssetCategory } from '@/lib/frameos/material-category'
import { characterVoiceMaterialId } from '@/lib/frameos/character-voice-reference'
import {
  panoramaCaptureResultMessage,
  settlePanoramaCaptureUploads,
  type PanoramaCaptureCommitResult,
} from './panorama-capture'
import { CanvasAddPanel, CanvasToolRail, CanvasViewportControls } from './components/CanvasToolRail'
import { CanvasContextMenu, CanvasEmptyState, CanvasNodeTypeMenu, CanvasWireMenu } from './components/CanvasMenus'
import { CanvasConnectionLine } from './components/CanvasConnectionLine'
import { collectCanvasSecondaryNodeIds } from './components/canvas-mention-references'
import { CanvasEdge } from './components/CanvasEdge'
import {
  CANVAS_CLIPBOARD_MIME,
  collectCanvasClipboardText,
  hasCanvasClipboardMime,
  isCanvasClipboardMimeAvailable,
  isCanvasClipboardTextAvailable,
  parseCanvasClipboardDocument,
  resolveCanvasClipboardPasteSource,
  writeCanvasClipboard,
} from './clipboard'
import { cloneCanvasNodeDataForNewNode } from './clone-node-data'
import { filterStoryClipboardDocument } from './clipboard'
import { resolvePastedWires, selectCopiedWires } from './clipboard-wires'
import { collectSelectionDownloadNodes } from './selection-download'
import { createVideoComparisonDraft, persistVideoComparisonDraft, shouldCreateVideoComparison } from './video-comparison'
import {
  CANVAS_ADD_NODE_ITEMS,
  STORY_ADD_NODE_ITEMS,
  STORY_INTERACTION_ADD_ITEMS,
  canvasEdgeToFlow,
  canvasNodeToFlow,
  canvasReplacementAccept,
  clampCanvasMenuPoint,
  DEFAULT_NODE_SIZES,
  createFlowNode,
  flowEdgeToCanvas,
  flowNodeToCanvas,
  flowNodeToCanvasSnapshot,
  isMatchingCanvasReplacementFile,
  mergeServerTerminalFlowNode,
  normalizeCanvasConnection,
  replaceCanvasNodeContent,
  shouldBlockCanvasShortcutWhileLocked,
  type CanvasContextMenuState,
  type CanvasFlowEdge,
  type CanvasFlowNode,
  type CanvasNodeMenuType,
  type CanvasWireMenuState,
} from './editor-types'
import {
  arrangeCanvasGroupMembers,
  arrangeCanvasGroupNodes,
  arrangeCanvasNodes,
  canvasGroupIdsContainingMembers,
  type CanvasOrganizeMode,
  fitCanvasGroupsToMembers,
} from './actions/layout'
import { reconcileDraggedNodeGroupMembership } from './actions/grouping'
import { CANVAS_REPLACE_CONTENT_EVENT, CreativeNode } from './nodes/CreativeNode'
import { GroupNode } from './nodes/GroupNode'
import { ProductionNode } from './nodes/ProductionNode'
import { PlaylistNode } from './nodes/PlaylistNode'
import { Studio3DNode } from './nodes/Studio3DNode'
import {
  CANVAS_VIDEO_EDIT_MATERIAL_EVENT,
  CANVAS_VIDEO_EDIT_REFERENCE_EVENT,
  CANVAS_VIDEO_EDIT_SUBMIT_EVENT,
  VideoEditNode,
} from './nodes/VideoEditNode'
import { CanvasStudio3DDialog } from './components/CanvasStudio3D'
import { selectMaterialsForReferenceLimits } from './material-reference-drop'
import { isCanvasConnectionAllowed, planCanvasBatchConnections } from './batch-node-connection'
import { STORY_HANDLE_PATCH_KEYS, pruneStoryFlows, resolveStoryConnection } from './story/story-connection'
import { StoryWireMenu } from './story/StoryWireMenu'
import { useStoryCanvasActions } from './story/useStoryCanvasActions'
import { STORY_CANVAS_TOAST_EVENT, StoryCanvasProvider, useStoryCanvas } from './story/StoryCanvasContext'
import { StoryCanvasOverlay } from './story/StoryCanvasOverlay'
import { StoryEndingNode, StoryEntryNode, StoryExitNode, StorySceneNode } from './story/StoryLinearNodes'
import { StoryChoiceNode, StoryConditionNode } from './story/StoryBranchNodes'
import { StoryInteractionNode } from './story/StoryInteractionNodes'
import { isStoryNodeType } from '@/lib/interactive/compile'
import type { StoryInteractionKind } from '@/lib/interactive/types'
import { createCanvasNodeSource, CanvasNodeSourceProvider } from './canvas-node-source'
import { CanvasFoldedEdgesEntry } from './rendering/CanvasFoldedEdgesEntry'
import { CanvasOverviewLayer } from './rendering/CanvasOverviewLayer'
import { CanvasProjectedMinimap } from './rendering/CanvasProjectedMinimap'
import { projectedNodeIdsInLayoutRect } from './rendering/projected-marquee'
import { useCanvasRenderProjection, type ProjectedEdgeSummary } from './rendering/useCanvasRenderProjection'
import { canvasApi, CanvasRevisionConflictError } from './api/client'
import { useCanvasGraph } from './state/useCanvasSync'
import { useCanvasNodeDetails } from './state/useCanvasNodeDetails'
import { hydrateCanvasDocumentForWrite } from './state/canvas-node-detail-cache'
import { useCanvasHistory, type CanvasEditorSnapshot } from './state/useCanvasHistory'
import { useCanvasAutosave } from './state/useCanvasAutosave'
import { canvasGraphToDocument } from './state/canvas-operations'
import { useStableCallback } from './state/useStableCallback'
import { canEditInfiniteCanvas } from './permissions'
import {
  findCanvasNodeIdsIntersectingRect,
  findSvgEdgeIdsIntersectingRect,
  normalizeScreenRect,
} from './edge-marquee'
import {
  findCanvasTargetNodeIdAtPoint,
  resolveCanvasRenderedScale,
} from './connection-line-geometry'
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
  appendCanvasVideoSourceToPlaylist,
  canvasVideoDurationMs,
  canvasVideoUrl,
  findCanvasPlaylistDropTargetId,
  isCanvasVideoSource,
} from './playlist-node-drop'
import {
  cancelCanvasGenerationTask,
  canvasGenerationTaskError,
  fetchCanvasGenerationTask,
  readCanvasGenerationSubmission,
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
  type CanvasNode,
  type CanvasNodeData,
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
  video_edit: VideoEditNode,
  audio: CreativeNode,
  model_3d: CreativeNode,
  studio_3d: Studio3DNode,
  group: GroupNode,
  production_episode: ProductionNode,
  production_storyboard: ProductionNode,
  production_panel: ProductionNode,
  production_video: ProductionNode,
  playlist: PlaylistNode,
  story_entry: StoryEntryNode,
  story_scene: StorySceneNode,
  story_choice: StoryChoiceNode,
  story_condition: StoryConditionNode,
  story_exit: StoryExitNode,
  story_ending: StoryEndingNode,
  story_interaction: StoryInteractionNode,
} as const

type CanvasMediaExecution = {
  nodeId: string
  assetId?: string
  taskId?: string
  type: ToolboxAsset['type']
}

function canvasMediaExecution(node: CanvasFlowNode): CanvasMediaExecution | null {
  const type = getMediaType(node)
  if (node.data.__server?.status !== 'RUNNING' || !isToolboxAssetType(type)) return null
  const assetId = node.data.generation?.assetId?.trim() || undefined
  const taskId = node.data.__server?.taskId?.trim()
    || node.data.generation?.taskId?.trim()
    || undefined
  if (!assetId && !taskId) return null
  return { nodeId: node.id, assetId, taskId, type }
}

const edgeTypes = {
  bezier: CanvasEdge,
} as const

const CANVAS_POLL_REQUEST_TIMEOUT_MS = 15_000
const CANVAS_NODE_SOFT_LIMIT = 500
const CANVAS_NODE_HARD_LIMIT = 1_000
const CANVAS_EDGE_HARD_LIMIT = 4_000
const CANVAS_POLL_FAILURE_LIMIT = 4
const CANVAS_UPLOAD_CONCURRENCY = 2
/** 稳定的空数组引用，避免生成器因为每次渲染新建数组而重复合并引用。 */
const EMPTY_REFERENCE_NODE_IDS: string[] = []
const EMPTY_NODE_ID_SET: ReadonlySet<string> = new Set()
const EMPTY_NODE_LIST: CanvasFlowNode[] = []

type Props = {
  /** Required: plain canvases never get story nodes, story wires, or the story overlay. */
  mode: 'canvas' | 'story'
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
  parentProjectId?: string | null
  parentProjectName?: string | null
  onSelectProject?: (projectId: string) => void
  canvasHomeHref?: string
  createProjectHref?: string
  onCanvasUpdated?: (canvas: Canvas) => void
  /** Opt-in summary graph; old story/editor callers keep the full document. */
  lightGraph?: boolean
  projectionEnabled?: boolean
}

type ClipboardDocument = { nodes: CanvasFlowNode[]; edges: CanvasFlowEdge[] }
type CanvasMarqueeRect = { x: number; y: number; width: number; height: number }
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
  task?: { id: string; status: string; progress: number; errorMessage: string | null; costPoints?: number | null } | null
}
type ImageOperationState = {
  mode: CanvasImageOperationMode
  sourceNodeId: string
  targetNodeId?: string
  initialGrid?: { rows: number; cols: number }
}
type VideoOperationState = { mode: CanvasVideoOperationMode; sourceNodeId: string }

function isToolboxAssetType(value: string): value is ToolboxAsset['type'] {
  return value === 'image' || value === 'video' || value === 'audio' || value === 'model3d'
}

function snapshot(nodes: CanvasFlowNode[], edges: CanvasFlowEdge[], viewport: Viewport): CanvasEditorSnapshot {
  return { nodes, edges, viewport }
}

function hasInputFocus() {
  const active = document.activeElement
  return active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || active instanceof HTMLSelectElement || (active instanceof HTMLElement && active.isContentEditable)
}

/** True when either end of a proposed wire is a story node. */
function connectionTouchesStoryNode(input: { source?: string | null; target?: string | null }, nodes: readonly CanvasFlowNode[]) {
  const ids = [input.source, input.target].filter((id): id is string => Boolean(id))
  return nodes.some((node) => ids.includes(node.id) && isStoryNodeType(node.type))
}

function isCanvasBlankPointerTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) return false
  if (target.closest([
    '.react-flow__node',
    '.react-flow__node-toolbar',
    '.nori-canvas-node-toolbar',
    '.react-flow__edge',
    '.react-flow__edgelabel-renderer',
    '.react-flow__handle',
    '.react-flow__minimap',
    '.react-flow__controls',
    '.react-flow__selection',
    '.react-flow__nodesselection',
    '.react-flow__viewport-portal',
  ].join(','))) return false
  return Boolean(
    target.closest('.react-flow__pane')
    || target.closest('.react-flow__renderer')
    || target.closest('.react-flow__background'),
  )
}

/** A picture wire released on a story canvas can also start a new scene that shows it. */
const MEDIA_WIRE_MENU_ITEMS: ReadonlyArray<{ type: CanvasNodeMenuType; label: string }> = [{ type: 'story_scene', label: '剧情片段（用作画面）' }, ...CANVAS_ADD_NODE_ITEMS]

function visibleMenuPoint(x: number, y: number, height: number) {
  return clampCanvasMenuPoint(
    { x, y },
    { width: window.innerWidth, height: window.innerHeight },
    { width: 160, height },
  )
}

function wrapperLayoutPoint(wrapper: HTMLElement, clientX: number, clientY: number) {
  const bounds = wrapper.getBoundingClientRect()
  const renderedScale = resolveCanvasRenderedScale({
    layoutWidth: wrapper.clientWidth,
    layoutHeight: wrapper.clientHeight,
    renderedWidth: bounds.width,
    renderedHeight: bounds.height,
  })
  return {
    x: (clientX - bounds.left) / renderedScale.x,
    y: (clientY - bounds.top) / renderedScale.y,
  }
}

function clientToFlowPoint(
  wrapper: HTMLElement,
  clientX: number,
  clientY: number,
  viewport: Viewport,
) {
  const layout = wrapperLayoutPoint(wrapper, clientX, clientY)
  return {
    x: (layout.x - viewport.x) / viewport.zoom,
    y: (layout.y - viewport.y) / viewport.zoom,
  }
}

function normalizedMarqueeRect(
  start: { x: number; y: number },
  end: { x: number; y: number },
): CanvasMarqueeRect {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  }
}

const DEFAULT_CANVAS_VIEWPORT: Viewport = { x: 0, y: 0, zoom: 1 }
// React Flow re-renders every node when one of its props changes identity, so
// object-valued props live at module scope instead of being rebuilt per render.
const FLOW_PRO_OPTIONS = { hideAttribution: true }
const FLOW_PAN_ON_DRAG = [1]
// Past this size every pan paints thousands of off-screen DOM nodes; small canvases keep every node mounted.
const FLOW_VISIBLE_ONLY_NODE_THRESHOLD = 40
const FLOW_MULTI_SELECTION_KEYS = ['Shift', 'Meta', 'Control']

function CanvasEditor({ mode, projectId, projectName, canvases, initialGraph, lightGraph = false, projectionEnabled = true, focusNodeId, onSelectCanvas, onCreateCanvas, onRenameCanvas, onDeleteCanvas, projectOptions, parentProjectId, parentProjectName, onSelectProject, canvasHomeHref, createProjectHref, onCanvasUpdated }: Omit<Props, 'canvasId'> & { initialGraph: CanvasGraphResponse }) {
  const { data: session } = useSession()
  const { resolved: resolvedTheme } = useNoriTheme()
  const themeColors = canvasThemeColors(resolvedTheme)
  const flowStore = useStoreApi<CanvasFlowNode, CanvasFlowEdge>()
  useEffect(() => {
    if (process.env.NORI_CANVAS_PERF_FIXTURE !== '1') return
    ;(window as unknown as { __noriSetViewport: (viewport: Viewport) => Promise<void> }).__noriSetViewport = async (viewport) => {
      const instance = (window as unknown as { __noriFlowInstance?: ReactFlowInstance<CanvasFlowNode, CanvasFlowEdge> }).__noriFlowInstance
      await instance?.setViewport(viewport)
    }
    ;(window as unknown as { __noriFlowNodes: () => unknown }).__noriFlowNodes = () => [...flowStore.getState().nodeLookup.values()].map((node) => ({ id: node.id, selected: node.selected, position: node.position }))
    ;(window as unknown as { __noriFlowState: () => unknown }).__noriFlowState = () => {
      const state = flowStore.getState()
      return {
        dragging: state.nodesDraggable,
        paneDragging: state.paneDragging,
        transform: state.transform,
        selected: [...state.nodeLookup.values()].filter((node) => node.selected).map((node) => ({ id: node.id, position: node.internals.positionAbsolute, dragging: node.dragging })),
      }
    }
  }, [flowStore])
  const readOnly = !canEditInfiniteCanvas(session?.user)
  const summaryMode = lightGraph && mode === 'canvas'
  const [nodes, setNodesState] = useState<CanvasFlowNode[]>(() => initialGraph.nodes.map((node) => {
    const flowNode = canvasNodeToFlow(node)
    return summaryMode ? {
      ...flowNode,
      data: { ...flowNode.data, __canvasUnhydrated: true },
      ...('detailVersion' in node && typeof node.detailVersion === 'string' ? { detailVersion: node.detailVersion } : {}),
    } : flowNode
  }))
  const [edges, setEdges] = useState<CanvasFlowEdge[]>(() => initialGraph.edges.map(canvasEdgeToFlow))
  const [viewport, setViewportState] = useState<Viewport>(() => initialGraph.canvas.viewport || { x: 0, y: 0, zoom: 1 })
  const [flow, setFlow] = useState<ReactFlowInstance<CanvasFlowNode, CanvasFlowEdge> | null>(null)
  useEffect(() => {
    if (process.env.NORI_CANVAS_PERF_FIXTURE !== '1') return
    ;(window as unknown as { __noriFlowInstance: ReactFlowInstance<CanvasFlowNode, CanvasFlowEdge> | null }).__noriFlowInstance = flow
  }, [flow])
  const [addOpen, setAddOpen] = useState(false)
  const [assetsOpen, setAssetsOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const addOpenRef = useRef(false)
  const assetsOpenRef = useRef(false)
  const helpOpenRef = useRef(false)
  useEffect(() => { addOpenRef.current = addOpen; if (!addOpen) pendingInsertPositionRef.current = null }, [addOpen])
  useEffect(() => { assetsOpenRef.current = assetsOpen }, [assetsOpen])
  useEffect(() => { helpOpenRef.current = helpOpen }, [helpOpen])
  const [minimapVisible, setMinimapVisible] = useState(false)
  const [organizeMode, setOrganizeMode] = useState<CanvasOrganizeMode>('horizontal')
  const [organizeOpen, setOrganizeOpen] = useState(false)
  const [layoutAnimating, setLayoutAnimating] = useState(false)
  const [nodeDragging, setNodeDragging] = useState(false)
  const [contextMenu, setContextMenu] = useState<CanvasContextMenuState | null>(null)
  const [clipboardCanPaste, setClipboardCanPaste] = useState(false)
  const [wireMenu, setWireMenu] = useState<CanvasWireMenuState | null>(null)
  const [nodeTypeMenu, setNodeTypeMenu] = useState<{ x: number; y: number; flowPosition: { x: number; y: number } } | null>(null)
  const nodeTypeMenuRef = useRef<typeof nodeTypeMenu>(null)
  useEffect(() => { nodeTypeMenuRef.current = nodeTypeMenu }, [nodeTypeMenu])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [videoEditMaterialNodeId, setVideoEditMaterialNodeId] = useState<string | null>(null)
  const [videoEditReferencePicker, setVideoEditReferencePicker] = useState<{ nodeId: string; type: 'image' | 'audio' } | null>(null)
  const [assetLibraryNodeId, setAssetLibraryNodeId] = useState<string | null>(null)
  const [generatorReferencePicker, setGeneratorReferencePicker] = useState<{
    nodeId: string
    type: 'all' | 'image' | 'video' | 'audio'
    maxSelected: number
  } | null>(null)
  const [generatorReferenceInjection, setGeneratorReferenceInjection] = useState<{ nodeId: string; ids: string[] }>({ nodeId: '', ids: [] })
  const pendingMentionGeneratorRef = useRef<string | null>(null)
  const [generatorPanelWidth, setGeneratorPanelWidth] = useState(CANVAS_GENERATOR_PANEL_WIDTH_DEFAULT)
  const [canvasSurfaceSize, setCanvasSurfaceSize] = useState({ width: 1280, height: 800 })
  const [historyNodeId, setHistoryNodeId] = useState<string | null>(null)
  const [taskIdInfo, setTaskIdInfo] = useState<{ taskId: string; title: string } | null>(null)
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
  const [playlistDropTargetId, setPlaylistDropTargetId] = useState<string | null>(null)
  const [batchDropTargetId, setBatchDropTargetId] = useState<string | null>(null)
  const [marqueeRect, setMarqueeRect] = useState<CanvasMarqueeRect | null>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const uploadRef = useRef<HTMLInputElement>(null)
  const replacementUploadRef = useRef<HTMLInputElement>(null)
  const replacementNodeIdRef = useRef<string | null>(null)
  const pendingInsertPositionRef = useRef<{ x: number; y: number } | null>(null)
  const pendingUploadPositionRef = useRef<{ x: number; y: number } | null>(null)
  const nodesRef = useRef(nodes)
  const setNodes: typeof setNodesState = useCallback((next) => {
    setNodesState((current) => {
      const value = typeof next === 'function' ? next(current) : next
      // React Flow can invoke the updater before the parent commits. Publish
      // here so measurement confirmation reads this exact node generation.
      nodesRef.current = value
      return value
    })
  }, [])
  const edgesRef = useRef(edges)
  const viewportRef = useRef(viewport)
  const defaultViewportRef = useRef<Viewport>(initialGraph.canvas.viewport || DEFAULT_CANVAS_VIEWPORT)
  const viewportMoveStartRef = useRef(viewport)
  const canvasRef = useRef(initialGraph.canvas)
  const clipboardRef = useRef<ClipboardDocument | null>(null)
  const internalCopyTextRef = useRef<string | null>(null)
  const deletedNodeIdsRef = useRef(new Map<string, number>())
  const deletedEdgeIdsRef = useRef(new Map<string, number>())
  const [agentTurn] = useState(createCanvasAgentTurnController)
  const [agentFeedback] = useState(createAgentFeedbackStore)
  const [agentOpen, setAgentOpen] = useState(false)
  const lastManualViewportAt = useRef(0)
  const agentTouched = useSyncExternalStore(agentFeedback.touch.subscribe, agentFeedback.touch.get, agentFeedback.touch.get)
  useEffect(() => () => agentFeedback.dispose(), [agentFeedback])
  const confirmOpenRef = useRef(false)
  const requestTextEdit = useCallback((nodeId: string) => {
    wrapperRef.current?.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(nodeId)}"] .nori-canvas-text-preview`)
      ?.dispatchEvent(new CustomEvent('nori:edit-text'))
  }, [])
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
  // A wire released on empty canvas makes the browser fire a click on the pane; it must not close the menu the release just opened.
  const wireReleaseClickRef = useRef(false)
  const edgeSelectionGestureRef = useRef<{ pointerId: number; start: { x: number; y: number }; additive: boolean } | null>(null)
  const spacePanActiveRef = useRef(false)
  const panCursorActiveRef = useRef(false)
  const panPointerIdRef = useRef<number | null>(null)
  const syncPanCursor = () => {
    const active = spacePanActiveRef.current || panCursorActiveRef.current
    wrapperRef.current?.querySelector('.nori-canvas-surface')?.classList.toggle('is-panning', active)
  }
  const suppressContextMenuUntilRef = useRef(0)
  const groupDragRef = useRef<{ id: string; start: { x: number; y: number }; members: Map<string, { x: number; y: number }> } | null>(null)
  // Selected nodes projection has unmounted never receive React Flow drag deltas; they follow at drop.
  const unmountedDragRef = useRef<{ anchorId: string; anchorStart: { x: number; y: number }; rest: Map<string, { x: number; y: number }> } | null>(null)
  const playlistNodeDragRef = useRef<{ id: string; start: { x: number; y: number } } | null>(null)
  const batchNodeDragRef = useRef<Map<string, { x: number; y: number }> | null>(null)
  const batchWireSourcesRef = useRef<string[]>([])
  const batchConnectPointerRef = useRef<{ pointerId: number; sourceIds: string[] } | null>(null)
  const altCopyRef = useRef<ClipboardDocument | null>(null)
  const materializingStoryboardTasksRef = useRef(new Set<string>())
  const layoutAnimationFrameRef = useRef<number | null>(null)
  // A first click only selects a node so its edge lights up and wiring stays
  // unobstructed; the generator opens on the next click of that same node.
  const [generatorSuppressedNodeId, setGeneratorSuppressedNodeId] = useState<string | null>(null)
  const [textEditingNodeId, setTextEditingNodeId] = useState<string | null>(null)
  const setTextEditing = useCallback((nodeId: string | null) => {
    setTextEditingNodeId((current) => nodeId === null || current === null || current === nodeId ? nodeId : current)
  }, [])
  const soleSelectedNodeIdRef = useRef<string | null>(null)
  const focusAppliedRef = useRef(false)
  const {
    canUndo,
    canRedo,
    record: recordHistory,
    undo: undoHistory,
    redo: redoHistory,
    reset: resetHistory,
    getDepth: getHistoryDepth,
    getLastLabel: getLastHistoryLabel,
    getHead: getHistoryHead,
  } = useCanvasHistory()

  const projectionPinnedIds = useMemo(() => (textEditingNodeId ? [textEditingNodeId] : []), [textEditingNodeId])
  const projectionFallbackSurface = useCallback(() => (
    wrapperRef.current?.clientWidth
      ? { width: wrapperRef.current.clientWidth, height: wrapperRef.current.clientHeight }
      : { width: window.innerWidth, height: window.innerHeight }
  ), [])
  const projectionFallbackSize = useCallback((type: string) => DEFAULT_NODE_SIZES[type] ?? { width: 300, height: 200 }, [])
  // Only the ordinary canvas is projected; story mode keeps mounting every node.
  const projection = useCanvasRenderProjection<CanvasFlowNode, CanvasFlowEdge>({
    enabled: mode === 'canvas' && projectionEnabled,
    nodes,
    edges,
    flowStore,
    pinnedIds: projectionPinnedIds,
    initialViewport: initialGraph.canvas.viewport || DEFAULT_CANVAS_VIEWPORT,
    fallbackSurface: projectionFallbackSurface,
    fallbackSize: projectionFallbackSize,
  })
  const projectionActive = projection.active
  const getProjectionEngine = projection.getEngine
  useEffect(() => {
    if (process.env.NORI_CANVAS_PERF_FIXTURE !== '1') return
    ;(window as unknown as { __noriProjection: () => unknown }).__noriProjection = () => ({
      nodes: nodesRef.current.map((node) => ({
        id: node.id,
        selected: Boolean(node.selected),
        type: node.type,
        position: node.position,
        width: node.width || node.measured?.width || DEFAULT_NODE_SIZES[node.type || '']?.width || 300,
        height: node.height || node.measured?.height || DEFAULT_NODE_SIZES[node.type || '']?.height || 200,
        ...(node.type === 'group' ? { memberIds: node.data.memberIds ?? [] } : {}),
      })),
      mounted: [...projection.mountedNodeIds],
    })
  }, [projection.mountedNodeIds])
  const nodeSourceRef = useRef<ReturnType<typeof createCanvasNodeSource> | null>(null)
  if (!nodeSourceRef.current) nodeSourceRef.current = createCanvasNodeSource(nodes)
  const nodeSource = nodeSourceRef.current

  useLayoutEffect(() => { nodesRef.current = nodes }, [nodes])
  useLayoutEffect(() => { nodeSource.publish(nodes) }, [nodeSource, nodes])
  useLayoutEffect(() => { edgesRef.current = edges }, [edges])
  useLayoutEffect(() => { viewportRef.current = viewport }, [viewport])

  // With projection RF only holds a subset, so framing must come from the full render index.
  const fitCanvasView = useCallback((ids: readonly string[] | null, options: { padding: number; maxZoom?: number; duration: number }) => {
    if (!flow) return
    const engine = getProjectionEngine()
    if (!engine) {
      void flow.fitView({ ...(ids ? { nodes: ids.map((id) => ({ id })) } : {}), ...options })
      return
    }
    const bounds = engine.index.boundsOf(ids ?? undefined)
    if (!bounds) return
    const { width, height } = flowStore.getState()
    if (!width || !height) return
    const next = getViewportForBounds(
      { x: bounds.left, y: bounds.top, width: bounds.right - bounds.left, height: bounds.bottom - bounds.top },
      width,
      height,
      0.15,
      options.maxZoom ?? 5,
      options.padding,
    )
    void flow.setViewport(next, { duration: options.duration })
  }, [flow, flowStore, getProjectionEngine])
  useEffect(() => {
    if (!flow || !focusNodeId || focusAppliedRef.current) return
    const target = nodesRef.current.find((node) => node.id === focusNodeId)
    if (!target) return
    focusAppliedRef.current = true
    setNodes((current) => current.map((node) => ({ ...node, selected: node.id === focusNodeId })))
    window.requestAnimationFrame(() => {
      const width = target.measured?.width ?? target.width ?? 0
      const height = target.measured?.height ?? target.height ?? 0
      const surface = wrapperRef.current
        ? { width: wrapperRef.current.clientWidth, height: wrapperRef.current.clientHeight }
        : { width: window.innerWidth, height: window.innerHeight }
      if (!width || !height || !surface.width || !surface.height) {
        fitCanvasView([target.id], { padding: 0.58, duration: 320 })
        return
      }
      // Leave room under the node so the anchored generator never has to cover it.
      const availableHeight = Math.max(96, surface.height - 116 - 96 - 316 - 8)
      const zoom = Math.min(1.2, Math.max(0.2, Math.min(surface.width * 0.5 / width, availableHeight / height)))
      void flow.setViewport({
        x: surface.width / 2 - (target.position.x + width / 2) * zoom,
        y: 124 - target.position.y * zoom,
        zoom,
      }, { duration: 320 })
    })
  }, [fitCanvasView, flow, focusNodeId])
  useEffect(() => () => {
    if (layoutAnimationFrameRef.current !== null) window.cancelAnimationFrame(layoutAnimationFrameRef.current)
  }, [])
  useEffect(() => {
    const restoreWidth = () => {
      const saved = window.localStorage.getItem(CANVAS_GENERATOR_PANEL_WIDTH_STORAGE_KEY)
      const width = wrapperRef.current?.clientWidth || window.innerWidth
      const height = wrapperRef.current?.clientHeight || window.innerHeight
      setCanvasSurfaceSize((previous) => previous.width === width && previous.height === height ? previous : { width, height })
      setGeneratorPanelWidth(clampCanvasGeneratorPanelWidth(saved, width))
    }
    restoreWidth()
    const observer = new ResizeObserver(restoreWidth)
    if (wrapperRef.current) observer.observe(wrapperRef.current)
    window.addEventListener('resize', restoreWidth)
    return () => { observer.disconnect(); window.removeEventListener('resize', restoreWidth) }
  }, [])
  const updateGeneratorPanelWidth = useCallback((width: number) => {
    const next = clampCanvasGeneratorPanelWidth(width, wrapperRef.current?.clientWidth || window.innerWidth)
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
    setVideoEditMaterialNodeId(null)
    setVideoEditReferencePicker(null)
    setImageOperation(null)
    setVideoOperation(null)
    setStudioNodeId(null)
    setWorkflowGroupId(null)
    setImageEditNodeId(null)
  }, [readOnly])

  const currentSnapshot = useCallback(() => snapshot(nodesRef.current, edgesRef.current, viewportRef.current), [])
  const applySnapshot = useCallback((next: CanvasEditorSnapshot) => {
    setTextEditingNodeId(null)
    setNodes(next.nodes)
    setEdges(next.edges)
    setViewportState(next.viewport)
    viewportRef.current = next.viewport
    void flow?.setViewport(next.viewport, { duration: 180 })
  }, [flow])

  const handleSaved = useCallback((graph: CanvasGraphResponse) => {
    canvasRef.current = graph.canvas
    // Geometry/viewport delta acknowledgements have no server node bodies or
    // edges to merge. The editor already holds the local positions.
    if (!graph.nodes.length && !graph.edges.length) {
      onCanvasUpdated?.(graph.canvas)
      return
    }
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
      const additions = selectServerOnlyEntities({
        serverIds: new Set(serverById.keys()),
        localIds: new Set(nodesRef.current.map((node) => node.id)),
        tombstones: deletedNodeIdsRef.current,
        now: Date.now(),
      })
      if (additions.length > 0) {
        projected.push(...additions.map((id) => serverById.get(id)!))
        changed = true
      }
    }
    if (changed) {
      nodesRef.current = projected
      setNodes(projected)
    }
    const localEdgeIds = new Set(edgesRef.current.map((edge) => edge.id))
    const serverEdges = graph.edges.map(canvasEdgeToFlow)
    const serverAdditions = selectServerOnlyEntities({
      serverIds: new Set(serverEdges.map((edge) => edge.id)),
      localIds: localEdgeIds,
      tombstones: deletedEdgeIdsRef.current,
      now: Date.now(),
    }).map((id) => serverEdges.find((edge) => edge.id === id)!)
    if (serverAdditions.length > 0) {
      const nextEdges = [...edgesRef.current, ...serverAdditions]
      edgesRef.current = nextEdges
      setEdges(nextEdges)
    }
    onCanvasUpdated?.(graph.canvas)
  }, [onCanvasUpdated])

  const refreshedGraphRevisionRef = useRef(initialGraph.canvas.revision)
  useEffect(() => {
    if (refreshedGraphRevisionRef.current === initialGraph.canvas.revision) return
    refreshedGraphRevisionRef.current = initialGraph.canvas.revision
    // Background refetches must not remount an active prompt editor. Full graph
    // replacement remains confined to explicit conflict/offline recovery.
    handleSaved(initialGraph)
  }, [handleSaved, initialGraph])

  const loadGraph = useCallback((graph: CanvasGraphResponse) => {
    canvasRef.current = graph.canvas
    // Server refreshes must not close the generator panel the user has open.
    const selectedById = new Set(nodesRef.current.filter((node) => node.selected).map((node) => node.id))
    const nextNodes = graph.nodes.map((node) => {
      const flowNode = canvasNodeToFlow(node)
      return selectedById.has(node.id) ? { ...flowNode, selected: true } : flowNode
    })
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

  const restoreOfflineDocument = useCallback((document: CanvasDocumentInput, geometryOnly = false) => {
    const restoredById = geometryOnly ? new Map(document.nodes.map((node) => [node.id, node])) : null
    const nextNodes = restoredById
      ? nodesRef.current.map((node) => {
          const restored = restoredById.get(node.id)
          if (!restored) return node
          const { size } = flowNodeToCanvasSnapshot(node, initialGraph.canvas.id)
          const resized = restored.size && (restored.size.width !== size?.width || restored.size.height !== size?.height)
          if (restored.position === node.position && !resized) return node
          return { ...node, position: restored.position, ...(resized && restored.size ? { width: restored.size.width, height: restored.size.height } : {}) }
        })
      : document.nodes.map(canvasNodeToFlow)
    const nextEdges = geometryOnly ? edgesRef.current : document.edges.map((edge) => canvasEdgeToFlow({
      ...edge,
      role: edge.role === 'VIDEO_FRAME' ? 'REF' : edge.role,
    }))
    const nextViewport = document.viewport
    nodesRef.current = nextNodes
    edgesRef.current = nextEdges
    viewportRef.current = nextViewport
    setNodes(nextNodes)
    setEdges(nextEdges)
    setViewportState(nextViewport)
    resetHistory()
    void flow?.setViewport(nextViewport, { duration: 180 })
  }, [flow, initialGraph.canvas.id, resetHistory])

  const buildDocument = useCallback((expectedRevision: number, clientId: string, changeSummary: string) => ({
    schema_version: CANVAS_DOCUMENT_SCHEMA_VERSION,
    expectedRevision,
    clientId,
    changeSummary,
    viewport: viewportRef.current,
    nodes: nodesRef.current.map((node) => flowNodeToCanvasSnapshot(node, initialGraph.canvas.id)),
    edges: edgesRef.current.map((edge) => flowEdgeToCanvas(edge, initialGraph.canvas.id)),
  }), [initialGraph.canvas.id])

  const changeSource = useMemo(() => ({
    nodes: () => nodesRef.current,
    edges: () => edgesRef.current,
    viewport: () => viewportRef.current,
    nodeToDocument: (node: CanvasFlowNode) => flowNodeToCanvas(node, initialGraph.canvas.id),
    nodeGeometryToDocument: (node: CanvasFlowNode) => flowNodeToCanvasSnapshot(node, initialGraph.canvas.id),
    edgeToDocument: (edge: CanvasFlowEdge) => flowEdgeToCanvas(edge, initialGraph.canvas.id),
  }), [initialGraph.canvas.id])

  const loadNodeDetail = useCanvasNodeDetails(session?.user?.id || '', projectId, initialGraph.canvas.id)
  const initialDocument = useMemo(() => canvasGraphToDocument(initialGraph, 'initial'), [initialGraph])
  const confirmHydratedNodesRef = useRef<(nodes: CanvasNode[]) => void>(() => undefined)
  const confirmMeasuredNodesRef = useRef<(nodes: readonly CanvasFlowNode[]) => void>(() => undefined)
  const prepareNodeForWrite = useCallback(async (nodeId: string) => {
    if (!summaryMode) return
    const current = nodesRef.current.find((node) => node.id === nodeId)
    if (!current || current.data.__canvasUnhydrated !== true) return
    const detail = await loadNodeDetail(nodeId, current)
    const { detailVersion, ...hydratedNode } = detail as typeof detail & { detailVersion?: string }
    const latest = nodesRef.current.find((node) => node.id === nodeId) || current
    const position = latest.position
    const size = {
      width: latest.width || latest.measured?.width || hydratedNode.size?.width || 300,
      height: latest.height || latest.measured?.height || hydratedNode.size?.height || 200,
    }
    const confirmedNode = { ...hydratedNode, position, size }
    const hydrated = {
      ...canvasNodeToFlow(confirmedNode),
      ...(detailVersion ? { detailVersion } : {}),
    }
    const nextNodes = nodesRef.current.map((node) => node.id === nodeId ? {
      ...hydrated,
      selected: node.selected,
      dragging: node.dragging,
      position: node.position,
      width: node.width,
      height: node.height,
    } : node)
    nodesRef.current = nextNodes
    setNodes(nextNodes)
    confirmHydratedNodesRef.current([confirmedNode])
  }, [loadNodeDetail, summaryMode])
  const hydrateForDocument = useCallback(async (document: CanvasDocumentInput, confirmed?: CanvasDocumentInput | null) => {
    if (!summaryMode) return document
    return hydrateCanvasDocumentForWrite(document, async (node) => {
      const current = nodesRef.current.find((candidate) => candidate.id === node.id)
      return loadNodeDetail(node.id, current || node)
    }, confirmed)
  }, [loadNodeDetail, summaryMode])
  const autosave = useCanvasAutosave({
    accountId: session?.user?.id || '',
    enabled: !readOnly,
    projectId,
    canvasId: initialGraph.canvas.id,
    initialRevision: initialGraph.canvas.revision,
    buildDocument,
    initialDocument,
    changeSource: mode === 'canvas' ? changeSource : undefined,
    geometryOps: summaryMode,
    hydrateForDocument,
    onSaved: handleSaved,
    onLoadServer: loadGraph,
    onMergeDocument: mergeDocument,
    onRestoreLocal: restoreOfflineDocument,
  })
  confirmHydratedNodesRef.current = autosave.confirmHydratedNodes
  confirmMeasuredNodesRef.current = autosave.confirmMeasuredNodes
  const offlineRecoveryBlocking = autosave.offlineRecoveryState !== 'none'
  const writeLocked = readOnly || productionSyncing || offlineRecoveryBlocking
  // Async callbacks captured before a lock change must read the live value at
  // write time, not the stale closure from when the request started.
  const writeLockedRef = useRef(writeLocked)
  writeLockedRef.current = writeLocked
  const scheduleAutosave = autosave.scheduleSave
  const holdAutosave = autosave.holdPersistence
  useEffect(() => { holdAutosave(nodeDragging) }, [holdAutosave, nodeDragging])
  const flushAutosave = autosave.flush
  const autosaveRevision = autosave.revision
  const autosaveClientId = autosave.clientId
  const loadAutosaveServerVersion = autosave.loadServerVersion
  const mergeAutosaveServerVersion = autosave.mergeServerVersion
  const saveGenerationRevisioned = autosave.saveRevisionedOperations
  const prepareGenerationSubmission = autosave.prepareRevisionedMutation
  const prepareProductionSync = autosave.prepareRevisionedMutation
  const acceptProductionSyncRevision = autosave.acceptExternalRevision
  const loadServerAfterSyncConflict = autosave.loadServerVersion

  const markChanged = useCallback((label: string, options?: { viewportOnly?: boolean }) => scheduleAutosave(agentTurn.labelFor(label), options), [agentTurn, scheduleAutosave])
  const record = useCallback((label: string) => {
    agentTurn.record(label, (next) => recordHistory(next, currentSnapshot()), getHistoryDepth, getHistoryHead)
  }, [agentTurn, currentSnapshot, getHistoryDepth, getHistoryHead, recordHistory])
  const commitAgentChange = useCallback((change: AgentGraphChange) => {
    if (writeLocked) return
    record(change.label)
    const now = Date.now()
    change.deletedNodeIds.forEach((id) => deletedNodeIdsRef.current.set(id, now))
    change.deletedEdgeIds.forEach((id) => deletedEdgeIdsRef.current.set(id, now))
    if (change.deletedNodeIds.length) setTextEditingNodeId(null)
    nodesRef.current = change.nodes
    edgesRef.current = change.edges
    setNodes(change.nodes)
    setEdges(change.edges)
    markChanged(change.label)
  }, [markChanged, record, setNodes, writeLocked])

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
            height: fromHeight && toHeight && !isStoryNodeType(node.type) ? fromHeight + (toHeight - fromHeight) * eased : node.height,
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
      const accepted = await acceptProductionSyncRevision(syncInput.expectedRevision, graph)
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
    const currentNode = nodesRef.current.find((node) => node.id === nodeId)
    if (currentNode?.data.__canvasUnhydrated === true) {
      setToast('节点详情仍在加载，请稍候再编辑')
      return
    }
    if (historyLabel) record(historyLabel)
    setNodes((current) => current.map((node) => node.id === nodeId ? { ...node, data: { ...node.data, ...patch } } : node))
    const storyNode = STORY_HANDLE_PATCH_KEYS.some((key) => key in patch) ? nodesRef.current.find((node) => node.id === nodeId) : null
    if (storyNode) {
      const pruned = pruneStoryFlows(edgesRef.current, { ...storyNode, data: { ...storyNode.data, ...patch } })
      if (pruned !== edgesRef.current) {
        edgesRef.current = pruned
        setEdges(pruned)
      }
    }
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

  const clearCanvasSelection = useCallback(() => {
    setNodes((current) => current.map((node) => (
      node.selected ? { ...node, selected: false } : node
    )))
    const deselectedEdges = edgesRef.current.map((edge) => (
      edge.selected ? { ...edge, selected: false } : edge
    ))
    edgesRef.current = deselectedEdges
    setEdges(deselectedEdges)
  }, [])

  const commitEdgeRemoval = useCallback((removedEdges: CanvasFlowEdge[], remainingEdges: CanvasFlowEdge[], label?: string, preserveReferences = false) => {
    if (readOnly || removedEdges.length === 0) return
    record(label ?? '删除连线')
    removedEdges.forEach((edge) => deletedEdgeIdsRef.current.set(edge.id, Date.now()))
    edgesRef.current = remainingEdges
    setEdges(remainingEdges)
    if (!preserveReferences) cleanupDisconnectedReferences(removedEdges, remainingEdges)
    markChanged(label ?? '删除连线')
  }, [cleanupDisconnectedReferences, markChanged, readOnly, record])

  const removeEdgesById = useCallback((edgeIds: string[], label?: string) => {
    const ids = new Set(edgeIds)
    const removedEdges = edgesRef.current.filter((edge) => ids.has(edge.id))
    if (removedEdges.length === 0) return
    const remainingEdges = edgesRef.current.filter((edge) => !ids.has(edge.id))
    commitEdgeRemoval(removedEdges, remainingEdges, label)
  }, [commitEdgeRemoval])

  const removeReferenceWire = useCallback((targetNodeId: string, sourceNodeId: string) => {
    removeEdgesById(edgesRef.current
      .filter((edge) => edge.target === targetNodeId && edge.source === sourceNodeId)
      .map((edge) => edge.id))
  }, [removeEdgesById])

  const changeReferenceWire = useCallback((targetNodeId: string, sourceNodeId: string, selectedReferenceIds: string[]) => {
    if (writeLocked) return
    const edges = edgesRef.current
    const connected = (edge: CanvasFlowEdge) => edge.target === targetNodeId && edge.source === sourceNodeId
    const removed = edges.filter(connected)
    if (removed.length) {
      commitEdgeRemoval(removed, edges.filter((edge) => !connected(edge)), '断开引用连线', true)
      // Older nodes derive references from incoming edges until the first edit.
      // Materialize the current selection before the edge can change that fallback.
      const target = nodesRef.current.find((node) => node.id === targetNodeId)
      if (target && !target.data.generation?.referenceNodeIds) {
        nodesRef.current = nodesRef.current.map((node) => node.id === targetNodeId ? {
          ...node,
          data: { ...node.data, generation: { ...node.data.generation, referenceNodeIds: selectedReferenceIds } },
        } : node)
        setNodes(nodesRef.current)
      }
      return
    }
    const plan = planCanvasBatchConnections({
      nodes: nodesRef.current, edges, sourceNodeIds: [sourceNodeId], targetNodeId, maxEdges: CANVAS_EDGE_HARD_LIMIT,
    })
    if (!plan.added) { setToast('当前画布或模型不允许此连线'); return }
    record('添加引用连线')
    edgesRef.current = plan.edges
    setEdges(plan.edges)
    markChanged('添加引用连线')
  }, [commitEdgeRemoval, markChanged, record, writeLocked])

  const selectElementsCoveredByRect = useCallback((
    start: { x: number; y: number },
    end: { x: number; y: number },
    additive = false,
  ) => {
    const wrapper = wrapperRef.current
    if (!wrapper) return
    window.setTimeout(() => {
      const selectionRect = normalizeScreenRect(start, end, 3)
      const engine = getProjectionEngine()
      // Projection unmounts most nodes, so the DOM would only ever box-select what is currently drawn.
      const selectedNodeIds = new Set(engine
        ? projectedNodeIdsInLayoutRect(
          engine.index,
          normalizeScreenRect(wrapperLayoutPoint(wrapper, start.x, start.y), wrapperLayoutPoint(wrapper, end.x, end.y), 3),
          viewportRef.current,
        )
        : findCanvasNodeIdsIntersectingRect(wrapper, selectionRect))
      const selectedEdgeIds = new Set(findSvgEdgeIdsIntersectingRect(wrapper, selectionRect))
      const selectedNodeIdSet = selectedNodeIds
      setNodes((current) => current.map((node) => {
        const selected = node.type === 'group'
          ? Boolean(additive && node.selected)
          : selectedNodeIdSet.has(node.id) || Boolean(additive && node.selected)
        return node.selected === selected || (!node.selected && !selected) ? node : { ...node, selected }
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
    }, 0)
  }, [getProjectionEngine])

  const expandGroupNodeIds = useCallback((requestedIds: string[]) => {
    const expanded = new Set(requestedIds)
    for (const node of nodesRef.current) {
      if (expanded.has(node.id) && node.type === 'group') (node.data.memberIds || []).forEach((id) => expanded.add(id))
    }
    return expanded
  }, [])

  const removeNodes = useCallback((nodeIds: string[]) => {
    if (readOnly || nodeIds.length === 0) return
    setTextEditingNodeId(null)
    record('删除节点')
    const ids = new Set(nodeIds)
    ids.forEach((id) => deletedNodeIdsRef.current.set(id, Date.now()))
    setNodes((current) => removeDeletedCanvasReferences(fitCanvasGroupsToMembers(current.filter((node) => !ids.has(node.id)).map((node) => node.type === 'group' ? { ...node, data: { ...node.data, memberIds: (node.data.memberIds || []).filter((id) => !ids.has(id)) } } : node)), ids))
    const removedEdges = edgesRef.current.filter((edge) => ids.has(edge.source) || ids.has(edge.target))
    removedEdges.forEach((edge) => deletedEdgeIdsRef.current.set(edge.id, Date.now()))
    const remainingEdges = edgesRef.current.filter((edge) => !ids.has(edge.source) && !ids.has(edge.target))
    edgesRef.current = remainingEdges
    setEdges(remainingEdges)
    cleanupDisconnectedReferences(removedEdges, remainingEdges)
    markChanged('删除节点')
  }, [cleanupDisconnectedReferences, markChanged, readOnly, record])

  const removeGroupsWithMembers = useCallback((groupIds: string[], extraNodeIds: string[] = []) => {
    if (readOnly) return
    setTextEditingNodeId(null)
    const expanded = expandGroupNodeIds([...groupIds, ...extraNodeIds])
    if (expanded.size === 0) return
    expanded.forEach((id) => deletedNodeIdsRef.current.set(id, Date.now()))
    record('删除组及成员')
    setNodes((current) => removeDeletedCanvasReferences(fitCanvasGroupsToMembers(current.filter((node) => !expanded.has(node.id)).map((node) => node.type === 'group' ? { ...node, data: { ...node.data, memberIds: (node.data.memberIds || []).filter((id) => !expanded.has(id)) } } : node)), expanded))
    const removedEdges = edgesRef.current.filter((edge) => expanded.has(edge.source) || expanded.has(edge.target))
    removedEdges.forEach((edge) => deletedEdgeIdsRef.current.set(edge.id, Date.now()))
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

  const screenToCanvasPosition = useCallback((point: { x: number; y: number }) => {
    const wrapper = wrapperRef.current
    return wrapper ? clientToFlowPoint(wrapper, point.x, point.y, viewportRef.current) : { x: 280, y: 220 }
  }, [])

  const centerPosition = useCallback(() => {
    const rect = wrapperRef.current?.getBoundingClientRect()
    return rect ? screenToCanvasPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }) : { x: 280, y: 220 }
  }, [screenToCanvasPosition])

  const storyLoad = useStoryCanvas(projectId, readOnly, mode === 'story')
  const storyCanvas = storyLoad.story
  const storyActions = useStoryCanvasActions({
    story: storyCanvas, writeLocked, flow, flowStore, nodesRef, edgesRef,
    setNodes, setEdges, setWireMenu, record, markChanged, ensureNodeCapacity,
    toast: setToast, toFlowPoint: screenToCanvasPosition, animateNodeLayout,
    removeEdges: removeEdgesById, maxEdges: CANVAS_EDGE_HARD_LIMIT,
  })
  const storyContextValue = useMemo(() => (storyCanvas ? { ...storyCanvas, actions: storyActions } : null), [storyCanvas, storyActions])
  const storyNavigation = useMemo(() => (mode === 'story' && storyCanvas ? {
    workId: storyCanvas.story.workId,
    workName: storyCanvas.story.name,
    chapters: storyCanvas.story.chapters,
    currentProjectId: projectId,
  } : undefined), [mode, projectId, storyCanvas])

  const duplicateNodes = useCallback(async (requestedIds: string[]) => {
    if (readOnly) return
    const expanded = expandGroupNodeIds(requestedIds)
    const allOriginals = nodesRef.current.filter((node) => expanded.has(node.id))
    // A plain canvas must not spawn story nodes through copy / duplicate.
    const originalCopy = filterStoryClipboardDocument(allOriginals, [], mode === 'story')
    if (originalCopy.filtered) setToast('剧情节点只能用在影游画布')
    if (originalCopy.nodes.length === 0) return
    try {
      for (const node of originalCopy.nodes) await prepareNodeForWrite(node.id)
    } catch (error) {
      setToast(error instanceof Error ? error.message : '节点详情加载失败，请重试')
      return
    }
    const originals = nodesRef.current.filter((node) => originalCopy.nodes.some((original) => original.id === node.id))
    if (!ensureNodeCapacity(originals.length)) return
    const includesGroup = requestedIds.some((id) => nodesRef.current.some((node) => node.id === id && node.type === 'group'))
    // A copy never takes over an outside card's story line: every exit keeps exactly one flow.
    const sourceEdges = selectCopiedWires(edgesRef.current, new Set(originals.map((node) => node.id)), includesGroup)
    const copiedEdgeCount = sourceEdges.length
    if (edgesRef.current.length + copiedEdgeCount > CANVAS_EDGE_HARD_LIMIT) { setToast('连线数量将超过 4000 条上限'); return }
    record('创建副本')
    const idMap = new Map(originals.map((node) => [node.id, crypto.randomUUID()]))
    const shift = storyCanvas ? storyActions.copyOffset(originals.map((node) => node.id)) : { x: 42, y: 42 }
    const clones = originals.map((node) => ({ ...structuredClone(node), id: idMap.get(node.id)!, position: { x: node.position.x + shift.x, y: node.position.y + shift.y }, selected: true, data: cloneCanvasNodeDataForNewNode(node.data, (id) => idMap.get(id)) }))
    const copiedEdges = sourceEdges.map((edge) => ({ ...structuredClone(edge), id: crypto.randomUUID(), source: idMap.get(edge.source) || edge.source, target: idMap.get(edge.target) || edge.target, type: 'bezier', selected: false }))
    setNodes((current) => [...current.map((node) => ({ ...node, selected: false })), ...clones])
    setEdges((current) => [...current, ...copiedEdges])
    markChanged('创建副本')
    setToast(`已复制 ${clones.length} 个节点`)
  }, [ensureNodeCapacity, expandGroupNodeIds, markChanged, mode, prepareNodeForWrite, readOnly, record, storyActions, storyCanvas])

  const addNode = useCallback((type: CanvasNodeMenuType, position = centerPosition(), interaction?: StoryInteractionKind) => {
    if (readOnly) return null
    if (mode !== 'story' && isStoryNodeType(type)) {
      setToast('剧情节点只能用在影游画布')
      return null
    }
    if (!ensureNodeCapacity(1)) return null
    record('添加节点')
    const node = createFlowNode(type, position, interaction)
    node.position = storyCanvas ? storyActions.placeNew(type, position) : {
      x: position.x - (node.width || 300) / 2,
      y: position.y - (node.height || 200) / 2,
    }
    setNodes((current) => [...current.map((item) => ({ ...item, selected: false })), node])
    markChanged('添加节点')
    setAddOpen(false)
    setWireMenu(null)
    return node
  }, [centerPosition, ensureNodeCapacity, markChanged, mode, readOnly, record, storyActions, storyCanvas])

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

  const organize = useCallback((mode: CanvasOrganizeMode) => {
    if (readOnly || nodesRef.current.filter((node) => node.type !== 'group').length === 0) return
    record('整理画布')
    animateNodeLayout(
      (current) => arrangeCanvasNodes(current, edgesRef.current, mode),
      () => window.requestAnimationFrame(() => fitCanvasView(null, { padding: 0.18, duration: 260 })),
    )
    setOrganizeMode(mode)
    markChanged('整理画布')
    setOrganizeOpen(false)
    setToast(canvasOrganizeOption(mode).toast)
  }, [animateNodeLayout, fitCanvasView, markChanged, readOnly, record])

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
    return !writeLocked && isCanvasConnectionAllowed(connection, [...nodesRef.current, ...pendingNodes], edgesRef.current, CANVAS_EDGE_HARD_LIMIT, mode === 'story')
  }, [mode, writeLocked])

  const connect = useCallback((connection: Connection, pendingNodes: CanvasFlowNode[] = []) => {
    const allNodes = [...nodesRef.current, ...pendingNodes]
    const storyPlan = mode === 'story' ? resolveStoryConnection(connection, allNodes) : { kind: 'not_story' as const }
    if (storyPlan.kind !== 'not_story') {
      if (!readOnly) storyActions.commit(storyPlan)
      return
    }
    if (mode !== 'story' && connectionTouchesStoryNode(connection, allNodes)) {
      setToast('剧情节点只能在影游画布里连线')
      return
    }
    const normalized = normalizeCanvasConnection(connection)
    if (readOnly || !normalized?.source || !normalized.target || !validateConnection(normalized, pendingNodes)) return
    const result = planCanvasBatchConnections({
      nodes: [...new Map(allNodes.map((node) => [node.id, node])).values()],
      edges: edgesRef.current,
      sourceNodeIds: [normalized.source],
      targetNodeId: normalized.target,
      maxEdges: CANVAS_EDGE_HARD_LIMIT,
      allowStory: mode === 'story',
    })
    if (!result.added) {
      setToast('未新增连线：节点不兼容、素材未就绪或已达到引用上限')
      return
    }
    record('添加连线')
    nodesRef.current = result.nodes
    edgesRef.current = result.edges
    setNodes(result.nodes)
    setEdges(result.edges)
    markChanged('添加连线')
  }, [markChanged, mode, readOnly, record, storyActions, validateConnection])

  const connectBatch = useCallback((sourceIds: string[], targetId: string, alreadyRecorded = false) => {
    if (writeLocked) return false
    if (mode !== 'story' && connectionTouchesStoryNode({ source: sourceIds[0], target: targetId }, nodesRef.current)) {
      setToast('剧情节点只能在影游画布里连线')
      return false
    }
    const storySource = sourceIds.find((id) => nodesRef.current.some((node) => node.id === id && isStoryNodeType(node.type)))
    if (mode !== 'story' && storySource) {
      setToast('剧情节点只能在影游画布里连线')
      return false
    }
    const result = planCanvasBatchConnections({
      nodes: nodesRef.current, edges: edgesRef.current, sourceNodeIds: sourceIds,
      targetNodeId: targetId, maxEdges: CANVAS_EDGE_HARD_LIMIT,
      allowStory: mode === 'story',
    })
    if (result.added > 0) {
      if (!alreadyRecorded) record('批量连接节点')
      nodesRef.current = result.nodes
      edgesRef.current = result.edges
      setNodes(result.nodes)
      setEdges(result.edges)
      markChanged('批量连接节点')
    }
    setToast(result.added > 0
      ? `已连接 ${result.added} 个节点${result.skipped ? `；${result.skipped} 个因已连接、不兼容或超出引用上限跳过` : ''}`
      : '未新增连线：节点已连接、不兼容或已达到引用上限')
    return result.added > 0
  }, [markChanged, mode, record, writeLocked])

  const connectGesture = useCallback((connection: Connection) => {
    const normalized = normalizeCanvasConnection(connection)
    if (normalized && batchWireSourcesRef.current.length > 1) {
      connectBatch(batchWireSourcesRef.current, normalized.target)
    } else connect(connection)
  }, [connect, connectBatch])
  const validateGestureConnection = useCallback((connection: Connection | CanvasFlowEdge) => {
    // Story wiring only exists in story mode; a plain canvas rejects both ends outright.
    if (mode !== 'story') return !connectionTouchesStoryNode(connection, nodesRef.current) && validateConnection(connection)
    // Story wires settle in onConnectEnd, which snaps them to the port the preview showed.
    if (resolveStoryConnection(connection, nodesRef.current).kind !== 'not_story') return false
    const normalized = normalizeCanvasConnection(connection)
    return normalized && batchWireSourcesRef.current.length > 1
      ? batchWireSourcesRef.current.some((source) => validateConnection({ ...normalized, source }))
      : validateConnection(connection)
  }, [mode, validateConnection])

  const copySelection = useCallback(async (cut = false, requestedNodeIds?: string[]) => {
    const requested = requestedNodeIds || nodesRef.current.filter((node) => node.selected).map((node) => node.id)
    if (requested.length === 0) return
    const expanded = expandGroupNodeIds(requested)
    const selected = nodesRef.current.filter((node) => expanded.has(node.id))
    const ids = new Set(selected.map((node) => node.id))
    const includesGroup = requested.some((id) => nodesRef.current.some((node) => node.id === id && node.type === 'group'))
    const copied = filterStoryClipboardDocument(selected, selectCopiedWires(edgesRef.current, ids, includesGroup), mode === 'story')
    if (copied.filtered) setToast('剧情节点只能用在影游画布')
    if (copied.nodes.length === 0) return
    try {
      for (const node of copied.nodes) await prepareNodeForWrite(node.id)
    } catch (error) {
      setToast(error instanceof Error ? error.message : '节点详情加载失败，请重试')
      return
    }
    const hydratedIds = new Set(copied.nodes.map((node) => node.id))
    const hydratedCopied = {
      nodes: nodesRef.current.filter((node) => hydratedIds.has(node.id)),
      edges: copied.edges,
    }
    const payload = { nodes: structuredClone(hydratedCopied.nodes), edges: structuredClone(hydratedCopied.edges) }
    clipboardRef.current = payload
    setClipboardCanPaste(true)
    const plainText = collectCanvasClipboardText(hydratedCopied.nodes)
    const { canvasFormat } = await writeCanvasClipboard(JSON.stringify(payload), plainText)
    internalCopyTextRef.current = canvasFormat ? null : plainText
    if (cut) removeNodes(hydratedCopied.nodes.map((node) => node.id))
    else setToast(`已复制 ${hydratedCopied.nodes.length} 个节点`)
  }, [expandGroupNodeIds, mode, prepareNodeForWrite, removeNodes])

  const refreshClipboardAvailability = useCallback(async () => {
    const text = await navigator.clipboard?.readText().catch(() => '') || ''
    if (isCanvasClipboardTextAvailable(text)) {
      setClipboardCanPaste(true)
      return
    }
    const items = await navigator.clipboard?.read?.().catch(() => []) || []
    const hasSystemContent = items.some((item) => hasCanvasClipboardMime(item.types) || isCanvasClipboardMimeAvailable(item.types))
    setClipboardCanPaste(hasSystemContent || Boolean(clipboardRef.current?.nodes.length))
  }, [])

  const paste = useCallback(async (position?: { x: number; y: number }, systemCanvasJson: string | null = null) => {
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
      hasSystemCanvas: systemCanvasJson !== null,
      hasSystemMedia: false,
      systemTextReadable: systemText.readable,
      systemText: systemText.value,
      hasInternalCanvas: Boolean(clipboardRef.current?.nodes.length),
      internalCopyText: internalCopyTextRef.current,
    })
    if (source === 'system-canvas') {
      payload = parseCanvasClipboardDocument<CanvasFlowNode, CanvasFlowEdge>(systemCanvasJson ?? '')
      if (!payload) {
        setToast('系统剪贴板中的画布数据已损坏')
        return
      }
      clipboardRef.current = payload
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
    // A plain canvas silently drops story nodes (and their wires) pasted from a story chapter.
    const prepared = filterStoryClipboardDocument(payload.nodes, payload.edges, mode === 'story')
    if (prepared.filtered) setToast('剧情节点只能用在影游画布')
    if (!prepared.nodes.length) return
    if (!ensureNodeCapacity(prepared.nodes.length)) return
    const idMap = new Map(prepared.nodes.map((node) => [node.id, crypto.randomUUID()]))
    const pastedEdges = resolvePastedWires(prepared.edges, idMap, new Set(nodesRef.current.map((node) => node.id)))
      .map((edge) => ({ ...structuredClone(edge), id: crypto.randomUUID(), selected: false }))
    if (edgesRef.current.length + pastedEdges.length > CANVAS_EDGE_HARD_LIMIT) { setToast('粘贴后的连线数量将超过 4000 条上限'); return }
    record('粘贴节点')
    const minX = Math.min(...prepared.nodes.map((node) => node.position.x))
    const minY = Math.min(...prepared.nodes.map((node) => node.position.y))
    const anchor = position || { x: minX + 48, y: minY + 48 }
    const placed = prepared.nodes.map((node) => ({ ...node, position: { x: anchor.x + node.position.x - minX, y: anchor.y + node.position.y - minY } }))
    const shift = storyCanvas ? storyActions.pasteOffset(placed) : { x: 0, y: 0 }
    const pasted = placed.map((node) => ({ ...structuredClone(node), id: idMap.get(node.id)!, position: { x: node.position.x + shift.x, y: node.position.y + shift.y }, selected: true, data: cloneCanvasNodeDataForNewNode(node.data, (id) => idMap.get(id)) }))
    setNodes((current) => [...current.map((node) => ({ ...node, selected: false })), ...pasted])
    setEdges((current) => [...current, ...pastedEdges])
    markChanged('粘贴节点')
  }, [addNode, centerPosition, ensureNodeCapacity, markChanged, mode, readOnly, record, storyActions, storyCanvas, updateNodeData])

  const ensureReferenceMaterialIds = useCallback(async (referenceNodeIds: string[]) => {
    const orderedNodeIds = requireExistingReferenceNodeIds(referenceNodeIds, nodesRef.current)
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

  const handleGenerate = useCallback(async (request: CanvasGenerateRequest, verifyApproval?: () => void) => {
    if (readOnly) return
    const target = nodesRef.current.find((node) => node.id === request.nodeId)
    if (!target) throw new Error('节点不存在或已被删除')
    await prepareNodeForWrite(target.id)
    for (const referenceNodeId of request.referenceNodeIds || []) await prepareNodeForWrite(referenceNodeId)
    const hydratedTarget = nodesRef.current.find((node) => node.id === request.nodeId)
    if (!hydratedTarget || hydratedTarget.data.__canvasUnhydrated === true) throw new Error('节点详情尚未加载完成，请重试')
    if ((target.data.generationTask && !target.data.generationTask.completed) || target.data.__server?.status === 'RUNNING') throw new Error('该节点正在生成，请等待完成后再提交')
    const referenceNodeIds = requireExistingReferenceNodeIds(request.referenceNodeIds, nodesRef.current)
    verifyApproval?.()
    // Global style is a canvas-level text node. Compose it at request time so
    // the node's own prompt stays the user's original text and repeated
    // submissions never stack duplicate style blocks.
    const globalStyleNode = request.type === 'image' || request.type === 'video'
      ? findCanvasGlobalStylePromptNode(nodesRef.current)
      : null
    const globalStylePrompt = globalStyleNode ? readCanvasGlobalStylePrompt(nodesRef.current) : ''
    const styledPrompt = request.type === 'image' || request.type === 'video'
      ? composeCanvasGlobalStylePrompt(request.prompt, globalStylePrompt)
      : request.prompt
    // The video prefix leads the prompt (style trails it) and never reaches
    // image/audio/3D requests; the node keeps the user's original text.
    const generationPrompt = request.type === 'video'
      ? composeCanvasVideoPrefixPrompt(styledPrompt, readCanvasVideoPrefixPrompt(nodesRef.current))
      : styledPrompt
    const isVideoComparison = request.type === 'video' && shouldCreateVideoComparison(target)
    const additionalNodes = request.storyboard ? request.count : request.type === 'image' ? Math.max(0, request.count - 1) : isVideoComparison ? 1 : 0
    if (!ensureNodeCapacity(additionalNodes)) throw new Error('画布节点数量已达到上限')
    if (isVideoComparison && edgesRef.current.length + edgesRef.current.filter((edge) => edge.target === target.id).length > CANVAS_EDGE_HARD_LIMIT) {
      throw new Error('对照节点继承连线后将超过 4000 条上限，请先整理画布')
    }
    // Persist real edits before exposing any optimistic RUNNING state. Every
    // generation API binds its durable task/asset on the server; autosaving an
    // unbound placeholder while submission is in flight could otherwise erase
    // that binding after a slow or ambiguously failed response.
    const preparedRevision = await prepareGenerationSubmission()
    const selectedReferenceMaterialIds = request.type === 'text'
      ? []
      : await ensureReferenceMaterialIds(referenceNodeIds)
    verifyApproval?.()
    const multiImageRevision = request.type === 'image' && !request.storyboard && request.count > 1
      ? preparedRevision
      : null
    const referenceMentionNames: Record<string, string[]> = {}
    referenceNodeIds.forEach((nodeId, index) => {
      const names = request.referenceMentionNames?.[nodeId]
      const materialId = selectedReferenceMaterialIds[index]
      if (!names?.length || !materialId) return
      referenceMentionNames[materialId] = [...new Set([...(referenceMentionNames[materialId] || []), ...names])]
    })
    const hasReferenceMentionNames = Object.keys(referenceMentionNames).length > 0
    record('提交生成')
    const generationParameters = { ...(target.data.generation?.parameters || {}) }
    if (request.type === 'video') {
      if (request.fps) generationParameters.fps = request.fps
      else delete generationParameters.fps
      if (request.superresolveTarget) generationParameters.superresolveTarget = request.superresolveTarget
      else delete generationParameters.superresolveTarget
    }
    const generation = {
      ...(target.data.generation || {}),
      modelKey: request.modelKey,
      modelLabel: request.modelLabel,
      referenceNodeIds,
      referenceSummary: request.referenceSummary || [],
      referenceMentionNames: request.referenceMentionNames,
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
    const videoComparison = isVideoComparison
      ? createVideoComparisonDraft({ source: target, edges: edgesRef.current, prompt: request.prompt, generation, referenceNodeIds })
      : null
    const generationTargetId = videoComparison?.node.id || target.id
    let comparisonPersisted = false
    let discardPersistedComparison: (() => Promise<void>) | null = null
    const discardComparison = async () => {
      if (!videoComparison || !comparisonPersisted) return
      await discardPersistedComparison?.()
      comparisonPersisted = false
    }
    if (videoComparison) {
      setNodes((current) => [...current.map((node) => ({ ...node, selected: false })), videoComparison.node])
      setEdges((current) => [...current, ...videoComparison.edges])
    } else {
      setNodes((current) => current.map((node) => node.id === target.id ? { ...node, data: { ...node.data, prompt: request.prompt, generation, progress: 2, errorMessage: null, pollErrorMessage: null, __server: { ...node.data.__server!, status: 'RUNNING' } } } : node))
    }
    const restoreAuthoritativeTarget = async (discardUnknownSubmission = false) => {
      try {
        if (videoComparison) {
          if (discardUnknownSubmission) {
            const graph = await loadAutosaveServerVersion()
            if (graph.nodes.some((node) => node.id === generationTargetId && node.taskId)) return
          }
          await discardComparison()
          setNodes((current) => current.filter((node) => node.id !== generationTargetId).map((node) => ({ ...node, selected: node.id === target.id })))
          setEdges((current) => current.filter((edge) => edge.target !== generationTargetId))
          return
        }
        await loadAutosaveServerVersion()
        setNodes((current) => current.map((node) => node.id === generationTargetId
          ? { ...node, selected: true }
          : { ...node, selected: false }))
      } catch {
        if (videoComparison) {
          setNodes((current) => current.filter((node) => node.id !== generationTargetId).map((node) => ({ ...node, selected: node.id === target.id })))
          setEdges((current) => current.filter((edge) => edge.target !== generationTargetId))
          if (comparisonPersisted) markChanged('清理未提交的对照视频')
        }
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
            globalStylePrompt,
            count: request.count,
            modelKey: request.modelKey,
            modelLabel: request.modelLabel,
            referenceNodeIds,
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
    const voiceDetachedMaterialIds = request.type === 'video'
      ? referenceNodeIds.flatMap((nodeId, index) => (
        nodesRef.current.find((item) => item.id === nodeId)?.data.voiceDetached === true && selectedReferenceMaterialIds[index]
          ? [selectedReferenceMaterialIds[index]]
          : []
      ))
      : []
    const maskMaterialId = imageEditMaskMaterialId(target)
    const processType = target.data.processType === 'image_edit'
      ? 'image_edit'
      : isCanvasPanoramaNodeData(target.data)
        ? CANVAS_PANORAMA_PROCESS_TYPE
        : null
    const submissionBody = JSON.stringify({ projectId, canvasId: initialGraph.canvas.id, nodeId: generationTargetId, type: request.type, title: videoComparison?.node.data.title || target.data.title || (request.type === 'image' ? '画布图片' : request.type === 'video' ? '画布视频' : request.type === 'model3d' ? '画布 3D 模型' : '画布音频'), prompt: generationPrompt, modelKey: request.modelKey, ...(processType ? { processType, ...(processType === 'image_edit' ? { maskMaterialId } : {}) } : {}), referenceMaterialIds, referenceMaterials, ...(hasReferenceMentionNames ? { referenceMentionNames } : {}), ...(voiceDetachedMaterialIds.length > 0 ? { voiceDetachedMaterialIds } : {}), count: request.type === 'image' ? request.count : 1, inputMode: request.inputMode, idempotencyKey: crypto.randomUUID(), ...(multiImageRevision ? { expectedRevision: multiImageRevision.expectedRevision, clientId: multiImageRevision.clientId } : {}), options: { aspectRatio: request.aspectRatio, ...(request.resolution ? { resolution: request.resolution } : {}), ...(request.superresolveTarget ? { superresolveTarget: request.superresolveTarget } : {}), quality: request.quality, duration: request.duration, ...(request.fps ? { fps: request.fps } : {}), generateAudio: request.generateAudio, mode: request.audioMode, voice: request.audioVoice, genre: request.audioGenre, sfxKind: request.audioSfxKind, topology: request.model3dTopology || 'standard', generateTexture: request.model3dGenerateTexture !== false, pose: request.model3dPose || 'none' } })
    const submitMediaRequest = () => apiFetch(`/api/projects/${projectId}/canvas/${initialGraph.canvas.id}/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: submissionBody })
    let response: Response
    try {
      if (videoComparison) {
        const persisted = await persistVideoComparisonDraft({
          projectId,
          canvasId: initialGraph.canvas.id,
          sourceNodeId: target.id,
          draft: videoComparison,
          nodes: nodesRef.current,
          edges: edgesRef.current,
          saveRevisioned: saveGenerationRevisioned,
          loadServer: loadAutosaveServerVersion,
        })
        nodesRef.current = persisted.nodes
        edgesRef.current = persisted.edges
        setNodes(nodesRef.current)
        setEdges(edgesRef.current)
        handleSaved(persisted.graph)
        discardPersistedComparison = persisted.discard
        comparisonPersisted = true
      }
    } catch (error) {
      if (videoComparison) {
        // persist already removed any committed draft server-side; drop the
        // optimistic copy so a failed first click never leaves a blank node.
        nodesRef.current = nodesRef.current
          .filter((node) => node.id !== generationTargetId)
          .map((node) => ({ ...node, selected: node.id === target.id }))
        edgesRef.current = edgesRef.current.filter((edge) => edge.target !== generationTargetId)
        setNodes(nodesRef.current)
        setEdges(edgesRef.current)
      } else if (comparisonPersisted) {
        await restoreAuthoritativeTarget()
      }
      throw error
    }
    try {
      response = await submitMediaRequest()
    } catch {
      try {
        response = await submitMediaRequest()
      } catch (error) {
        await restoreAuthoritativeTarget(true)
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
    setNodes((current) => current.map((node) => node.id === generationTargetId ? { ...node, data: { ...node.data, origin: 'generate', history: prependCanvasGenerationHistory(item, node.data.history), generation: { ...generation, assetId: task.assetId, taskId: task.taskId }, progress: 2, __server: { ...node.data.__server!, status: 'RUNNING', taskId: task.taskId } } } : node))
    markChanged('生成任务已提交')
    setToast(videoComparison ? '对照视频已提交，原视频和输入连线已保留' : `已提交 ${payload.tasks.length} 个生成任务`)
  }, [ensureNodeCapacity, ensureReferenceMaterialIds, handleSaved, initialGraph.canvas.id, loadAutosaveServerVersion, markChanged, prepareGenerationSubmission, projectId, readOnly, record, saveGenerationRevisioned])

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

  const downloadCanvasNodes = useCallback((members: CanvasFlowNode[], archiveTitle: string) => {
    void (async () => {
      const directory = await getProjectDownloadDirectory(session?.user?.id || '', projectId, true)
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
        const name = type === 'video' ? buildNovelVideoExportFileName({
          projectName, generationName: item.data.title, sequence: index + 1,
          creatorName: typeof item.data.sourceMetadata?.creatorName === 'string' ? item.data.sourceMetadata.creatorName : '未记录创建者',
        }).replace(/\.mp4$/, `.${extension}`) : `${safeFileName(item.data.title || '', `画布素材-${index + 1}`)}.${extension}`
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
        fileName = `${safeFileName(archiveTitle || '', '画布批量下载')}.zip`
      }
      await saveProjectDownload(session?.user?.id || '', projectId, fileName, blob, directory)
      setToast(entries.length > 1 ? `已打包下载 ${entries.length} 个文件` : '下载已开始')
    })().catch((error) => setToast(error instanceof Error ? error.message : '下载失败'))
  }, [initialGraph.canvas.id, projectId, projectName, session?.user?.id])

  const regenerateNode = useCallback(async (nodeId: string, promptOverride?: string) => {
    const node = nodesRef.current.find((item) => item.id === nodeId)
    if (!node) return
    const config = node.data.generation
    const prompt = promptOverride ?? node.data.prompt
    if (!config?.modelKey) { setToast('缺少模型配置，请在生成面板里重新选择模型后生成'); return }
    if (!prompt) { setToast('请先填写提示词'); return }
    const regeneration = resolveCanvasRegenerationMode(node.data)
    try {
      await handleGenerate({ nodeId, type: getMediaType(node) as CanvasGenerateRequest['type'], prompt, modelKey: config.modelKey, modelLabel: config.modelLabel || config.modelKey, referenceNodeIds: config.referenceNodeIds || [], referenceSummary: config.referenceSummary || [], ...(config.referenceMentionNames ? { referenceMentionNames: config.referenceMentionNames } : {}), inputMode: config.inputMode || 'text', aspectRatio: config.aspectRatio || '16:9', resolution: config.resolution || '', quality: config.quality || 'high', duration: config.duration || 5, ...(typeof config.parameters?.fps === 'number' ? { fps: config.parameters.fps } : {}), ...(config.parameters?.superresolveTarget === '720p' || config.parameters?.superresolveTarget === '1080p' || config.parameters?.superresolveTarget === '4k' ? { superresolveTarget: config.parameters.superresolveTarget } : {}), generateAudio: config.generateAudio ?? true, count: regeneration.count, storyboard: regeneration.storyboard, audioMode: 'tts', audioVoice: String(config.parameters?.voice || ''), audioGenre: '', audioSfxKind: '', ...resolveCanvasModel3DRegenerationOptions(node.data) })
    } catch (error) {
      setNodes((current) => current.map((item) => ({ ...item, selected: item.id === nodeId })))
      setToast(error instanceof Error ? error.message : '生成提交失败，请检查引用素材。')
      throw error
    }
  }, [handleGenerate])

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
      if (members.length === 1 && node.data.materialId) {
        void downloadFrameosMaterial(session?.user?.id || '', projectId, node.data.materialId)
          .then((saved) => setToast(`已下载：${saved.name}`)).catch((cause) => setToast(cause instanceof Error ? cause.message : '下载失败'))
        return
      }
      downloadCanvasNodes(members, node.data.title || '')
      return
    }
    if (action === 'cancel_generation') {
      const task = node.data.generationTask
      if (!task?.taskId || node.data.__server?.status !== 'RUNNING') return false
      return cancelCanvasGenerationTask(projectId, initialGraph.canvas.id, task.taskId)
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
          setToast('生成任务已取消，需要时可右键节点重新生成')
          return true
        })
        .catch((error) => { setToast(error instanceof Error ? error.message : '取消任务失败'); return false })
    }
    if (action === 'regenerate') {
      void regenerateNode(nodeId).catch(() => undefined)
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
    if (action === 'audio_extract' && getMediaType(node) === 'video') {
      setVideoOperation({ mode: 'audio_extract', sourceNodeId: node.id })
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
  }, [animateNodeLayout, downloadCanvasNodes, initialGraph.canvas.id, loadAutosaveServerVersion, markChanged, projectId, projectName, readOnly, record, regenerateNode, session?.user?.id, updateNodeData])

  const applyImageOperationResults = useCallback(async (operationInput: CanvasImageOperationInput, payload: ResolvedCanvasOperation) => {
    if (!imageOperation || readOnly) return
    if (payload.materialization?.materialized) {
      await mergeAutosaveServerVersion()
      setImageOperation(null)
      setToast(operationInput.operation === 'superresolve' ? '超清图片已生成并恢复到画布' : '图片处理结果已恢复到画布')
      return
    }
    if (payload.materialization?.reason === 'source-missing') {
      throw new Error('处理期间源图片节点已被删除；成功生成的图片仍保留在作品素材库中。')
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
    form.set('projectId', 'personal')
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
    const isAudioExtract = operationInput.operation === 'audio_extract'
    const isSubtitleErase = operationInput.operation === 'subtitle_erase'
    const label = isAudioExtract ? '提取音频' : isSubtitleErase ? '视频去字幕' : '视频增强'
    if (payload.materialization?.materialized) {
      await mergeAutosaveServerVersion()
      setVideoOperation(null)
      setToast(isAudioExtract ? '音频已提取并恢复到画布' : isSubtitleErase ? '去字幕视频已生成并恢复到画布' : '增强视频已生成并恢复到画布')
      return
    }
    const source = nodesRef.current.find((node) => node.id === videoOperation.sourceNodeId)
    if (!source) throw new Error('源视频节点已被删除')
    if (!ensureNodeCapacity(1)) throw new Error('画布节点数量已达到上限')
    const result = payload.results?.[0]
    if (!result?.url || !result.materialId) throw new Error('视频处理完成但没有返回结果')
    const taskId = payload.taskUpdate?.task.id
    const taskModelKey = payload.taskUpdate?.task.modelKey || undefined

    record(label)
    const size = nodeSize(source)
    const derived = createFlowNode(isAudioExtract ? 'audio' : 'video', { x: source.position.x + size.width + 92, y: source.position.y })
    derived.selected = true
    derived.data = {
      ...derived.data,
      title: result.title,
      mediaType: isAudioExtract ? 'audio' : 'video',
      origin: 'derivative',
      processType: isAudioExtract ? 'audio_extract' : isSubtitleErase ? 'subtitle_erase' : 'superresolve',
      contentUrl: result.url,
      ...(isAudioExtract ? { audioUrl: result.url } : { videoUrl: result.url }),
      materialId: result.materialId,
      duration: result.duration,
      fps: result.fps,
      history: [{ id: crypto.randomUUID(), taskId, url: result.url, materialId: result.materialId, modelKey: taskModelKey, source: 'generation', status: 'ready', createdAt: new Date().toISOString(), prompt: label }],
      generation: {
        referenceNodeIds: [source.id],
        count: 1,
        taskId,
        modelKey: taskModelKey,
        parameters: isAudioExtract
          ? { startMs: operationInput.startMs, endMs: operationInput.endMs }
          : isSubtitleErase
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
    setToast(isAudioExtract ? '音频已提取' : isSubtitleErase ? '去字幕视频已生成' : '增强视频已生成')
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

  const submitVideoEdit = useCallback(async (input: {
    nodeId: string
    prompt: string
    startMs: number
    endMs: number
    generateAudio: boolean
  }) => {
    if (readOnly) return
    const target = nodesRef.current.find((node) => node.id === input.nodeId && node.type === 'video_edit')
    if (!target) throw new Error('视频编辑节点不存在或已被删除')
    const incoming = target.data.videoEdit?.sourceKind === 'node' && target.data.videoEdit.sourceNodeId
      ? nodesRef.current.find((node) => node.id === target.data.videoEdit?.sourceNodeId) || null
      : null
    if (!incoming && !(target.data.videoUrl || target.data.contentUrl)) {
      throw new Error('请先为视频编辑节点提供源视频。')
    }

    const updateFromTask = (update: CanvasOperationTaskUpdate) => {
      setNodes((current) => current.map((node) => node.id === target.id ? {
        ...node,
        data: {
          ...node.data,
          progress: update.task.progress,
          errorMessage: update.task.error?.message || null,
          __server: {
            ...node.data.__server!,
            status: update.task.status === 'failed' ? 'FAILED' : update.task.status === 'completed' ? 'SUCCEEDED' : 'RUNNING',
            taskId: update.task.id,
          },
        },
      } : node))
    }

    record('提交视频编辑')
    setNodes((current) => current.map((node) => node.id === target.id ? {
      ...node,
      data: {
        ...node.data,
        progress: 2,
        errorMessage: null,
        __server: { ...node.data.__server!, status: 'RUNNING' },
      },
    } : node))
    try {
      const response = await apiFetch(`/api/projects/${projectId}/canvas/${initialGraph.canvas.id}/operations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceNodeId: target.id,
          operation: 'video_edit',
          prompt: input.prompt,
          startMs: input.startMs,
          endMs: input.endMs,
          generateAudio: input.generateAudio,
        }),
      })
      await resolveCanvasOperationResponse(response, updateFromTask)
      await mergeAutosaveServerVersion()
      setNodes((current) => current.map((node) => node.id === target.id
        ? { ...node, selected: true }
        : { ...node, selected: false }))
      markChanged('视频编辑完成')
      setToast('视频编辑完成')
    } catch (error) {
      const message = error instanceof Error ? error.message : '视频编辑失败'
      setNodes((current) => current.map((node) => node.id === target.id ? {
        ...node,
        data: {
          ...node.data,
          errorMessage: message,
          __server: { ...node.data.__server!, status: 'FAILED' },
        },
      } : node))
      throw error
    }
  }, [initialGraph.canvas.id, markChanged, mergeAutosaveServerVersion, projectId, readOnly, record])

  const handleVideoFrameCapture = useCallback(async (file: File, source: CanvasFlowNode) => {
    if (readOnly) throw new Error('当前账号只有查看权限')
    if (!nodesRef.current.some((node) => node.id === source.id)) throw new Error('视频节点已被删除')
    if (!ensureNodeCapacity(1)) throw new Error('画布节点数量已达到上限')
    if (edgesRef.current.length >= CANVAS_EDGE_HARD_LIMIT) throw new Error('画布连线数量已达到上限')
    const form = new FormData()
    form.set('file', file)
    form.set('title', `${source.data.title || '视频'} · 关键帧 ${file.name.match(/([\d.]+)s\.jpg$/)?.[1] || '0.00'}s`)
    form.set('projectId', 'personal')
    const response = await apiFetch(`/api/projects/${projectId}/canvas/${initialGraph.canvas.id}/materials`, { method: 'POST', body: form })
    if (!response.ok) throw new Error(await readApiErrorMessage(response, '关键帧上传失败'))
    const payload = await response.json() as { material?: FrameosMaterialItem }
    const material = payload.material
    if (!material?.id || !material.url) throw new Error('关键帧上传未返回可用素材')
    if (!ensureNodeCapacity(1) || edgesRef.current.length >= CANVAS_EDGE_HARD_LIMIT) throw new Error('画布容量已变化，请为关键帧图片预留节点和连线空间')
    const size = nodeSize(source)
    const slot = edgesRef.current.filter((edge) => edge.source === source.id && edge.data?.role === 'REF' && nodesRef.current.find((node) => node.id === edge.target)?.data.generation?.parameters?.videoFrameCapture === true).length
    const created = createFlowNode('image', { x: source.position.x + size.width + 90 + Math.floor(slot / 4) * 356, y: source.position.y + (slot % 4) * 238 })
    created.width = 320
    created.height = 210
    created.selected = true
    created.data = {
      ...created.data,
      title: material.title || file.name.replace(/\.jpg$/i, ''),
      mediaType: 'image',
      origin: 'derivative',
      contentUrl: material.url,
      imageUrl: material.url,
      materialId: material.id,
      generation: { referenceNodeIds: [source.id], count: 1, parameters: { videoFrameCapture: true } },
      history: [{ id: crypto.randomUUID(), url: material.url, materialId: material.id, status: 'ready', createdAt: new Date().toISOString(), prompt: '视频关键帧截图' }],
      __server: { ...created.data.__server!, status: 'SUCCEEDED' },
    }
    record('截取视频关键帧')
    setNodes((current) => [...current.map((node) => node.selected ? { ...node, selected: false } : node), created])
    setEdges((current) => [...current, { id: crypto.randomUUID(), source: source.id, target: created.id, sourceHandle: 'output', targetHandle: 'input', type: 'bezier', data: { role: 'REF' } }])
    markChanged('已添加视频关键帧')
    setToast('关键帧已添加到画布')
  }, [ensureNodeCapacity, initialGraph.canvas.id, markChanged, projectId, readOnly, record])

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
      form.set('projectId', 'personal')
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
      form.set('projectId', 'personal')
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

  const focusStoryNode = useCallback((nodeId: string) => {
    const target = nodesRef.current.find((node) => node.id === nodeId)
    if (!target) return
    setNodes((current) => current.map((node) => (node.selected === (node.id === nodeId) ? node : { ...node, selected: node.id === nodeId })))
    fitCanvasView([target.id], { padding: 0.9, maxZoom: 1, duration: 320 })
  }, [fitCanvasView])

  const overviewTitleOf = useCallback((id: string) => getProjectionEngine()?.titleOf(id) ?? '', [getProjectionEngine])
  const locateFoldedEdge = useCallback((edge: ProjectedEdgeSummary) => {
    // A selected edge is never folded, so selecting it also makes the wire and both ends appear.
    const next = edgesRef.current.map((item) => (Boolean(item.selected) === (item.id === edge.id) ? item : { ...item, selected: item.id === edge.id }))
    edgesRef.current = next
    setEdges(next)
    fitCanvasView([edge.source, edge.target], { padding: 0.4, maxZoom: 1, duration: 300 })
  }, [fitCanvasView])

  const editorContext = useMemo(() => ({
    readOnly: writeLocked,
    playlistDropTargetId,
    undo,
    redo,
    saveCanvas: flushAutosave,
    updateNodeData,
    setTextEditing,
    textEditingNodeId,
    removeNodes,
    duplicateNodes,
    runNodeAction,
    listPlaylistVideoSources,
    loadPlaylistRender,
    startPlaylistRender,
    loadPlaylistReview,
    submitPlaylistReview,
  }), [duplicateNodes, flushAutosave, listPlaylistVideoSources, loadPlaylistRender, loadPlaylistReview, playlistDropTargetId, redo, removeNodes, runNodeAction, setTextEditing, startPlaylistRender, submitPlaylistReview, textEditingNodeId, undo, updateNodeData, writeLocked])
  const editorPersistence = useMemo(() => ({ canUndo, canRedo, saveState: autosave.saveState }), [autosave.saveState, canRedo, canUndo])

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
    const removed = new Set(changes.filter((change) => change.type === 'remove').map((change) => change.id))
    removed.forEach((id) => deletedNodeIdsRef.current.set(id, Date.now()))
    const selected = changes.flatMap((change) => change.type === 'select' && change.selected ? [change.id] : [])
    const pendingReference = pendingMentionGeneratorRef.current
      && selected.length === 1
      && selected[0] !== pendingMentionGeneratorRef.current
      ? pendingMentionGeneratorRef.current
      : null
    if (pendingReference) pendingMentionGeneratorRef.current = null
    const measuredIds = new Set(changes.flatMap((change) =>
      change.type === 'dimensions' && change.resizing !== true && !change.setAttributes ? [change.id] : []
    ))
    setNodes((current) => {
      const next = applyNodeChanges(changes, current)
      const restored = pendingReference
        ? next.map((node) => ({ ...node, selected: node.id === pendingReference }))
        : next
      const result = removed.size ? removeDeletedCanvasReferences(restored, removed) : restored
      if (measuredIds.size) {
        nodesRef.current = result
        confirmMeasuredNodesRef.current(result.filter((node) => measuredIds.has(node.id)))
      }
      return result
    })
    const hasPersistentChange = changes.some((change) => (
      change.type === 'position'
      || change.type === 'remove'
      || (change.type === 'dimensions' && change.resizing !== undefined && Boolean(change.setAttributes))
    ))
    if (hasPersistentChange) markChanged('调整画布节点')
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

  const beginBatchNodeDrag = useCallback((event: React.MouseEvent, draggedNodes: CanvasFlowNode[]) => {
    setBatchDropTargetId(null)
    // Group moves and Alt-copy remain layout gestures, not reference drops.
    batchNodeDragRef.current = !event.altKey && draggedNodes.length >= 2 && !draggedNodes.some((node) => node.type === 'group')
      ? new Map(draggedNodes.map((node) => [node.id, { ...node.position }]))
      : null
  }, [])
  const batchConnectionTargetAtPoint = useCallback((event: { clientX: number; clientY: number }, sourceIds: string[], excludeSources = true) => {
    const wrapper = wrapperRef.current
    if (!sourceIds.length || !wrapper || writeLocked) return null
    const point = clientToFlowPoint(wrapper, event.clientX, event.clientY, viewportRef.current)
    const targetId = findCanvasTargetNodeIdAtPoint({
      nodes: Array.from(flowStore.getState().nodeLookup.values()).filter((node) => (
        (!excludeSources || !sourceIds.includes(node.id)) && node.type !== 'group' && !node.hidden
      )),
      point,
    })
    const currentNodes = new Map(nodesRef.current.map((node) => [node.id, node]))
    const target = targetId ? currentNodes.get(targetId) : null
    if (!target) return null
    // Reject incompatible drop surfaces without turning an ordinary layout
    // move into a canceled reference gesture. Ignore duplicates here so an
    // already-connected target still gives a harmless, idempotent drop.
    return sourceIds.some((id) => {
      const source = currentNodes.get(id)
      return source && isCanvasConnectionAllowed({ source: id, target: target.id }, [source, target], [])
    }) ? target.id : null
  }, [flowStore, writeLocked])
  const batchTargetAtPointer = useCallback((event: React.MouseEvent) => (
      batchNodeDragRef.current
      ? batchConnectionTargetAtPoint(event, [...batchNodeDragRef.current.keys()])
      : null
  ), [batchConnectionTargetAtPoint])
  const finishBatchNodeDrag = useCallback((event: React.MouseEvent, draggedNodes: CanvasFlowNode[]) => {
    const originalPositions = batchNodeDragRef.current
    const targetId = batchTargetAtPointer(event)
    batchNodeDragRef.current = null
    setBatchDropTargetId(null)
    if (!originalPositions || !targetId || writeLocked) return false
    const finalNodes = new Map(draggedNodes.map((node) => [node.id, node]))
    const restoredNodes = nodesRef.current.map((node) => {
      const original = originalPositions.get(node.id)
      return original ? { ...(finalNodes.get(node.id) || node), position: original } : node
    })
    nodesRef.current = restoredNodes
    setNodes(restoredNodes)
    connectBatch([...originalPositions.keys()], targetId, true)
    groupDragRef.current = null
    dragRecordedRef.current = false
    // A rejected reference drop also returns nodes to their original layout.
    // Avoid leaving them piled on a node when nothing could be connected.
    markChanged('批量投放节点')
    return true
  }, [batchTargetAtPointer, connectBatch, markChanged, writeLocked])

  const beginUnmountedSelectionDrag = useCallback((anchor: CanvasFlowNode) => {
    unmountedDragRef.current = null
    if (!getProjectionEngine() || !anchor.selected) return
    const mounted = new Set(Array.from(wrapperRef.current?.querySelectorAll('.react-flow__node[data-id]') ?? [], (element) => element.getAttribute('data-id')))
    const rest = nodesRef.current.filter((item) => item.selected && item.type !== 'group' && item.id !== anchor.id && !mounted.has(item.id))
    if (rest.length === 0) return
    unmountedDragRef.current = {
      anchorId: anchor.id,
      anchorStart: { ...anchor.position },
      rest: new Map(rest.map((item) => [item.id, { ...item.position }])),
    }
  }, [flowStore, getProjectionEngine])
  const finishUnmountedSelectionDrag = useCallback((
    pending: typeof unmountedDragRef.current,
    anchorFinal: CanvasFlowNode | undefined,
    skipIds: ReadonlySet<string>,
  ) => {
    if (!pending) return
    const anchor = anchorFinal ?? nodesRef.current.find((item) => item.id === pending.anchorId)
    if (!anchor) return
    const dx = anchor.position.x - pending.anchorStart.x
    const dy = anchor.position.y - pending.anchorStart.y
    if (dx === 0 && dy === 0) return
    setNodes((current) => current.map((item) => {
      const start = pending.rest.get(item.id)
      return start && !skipIds.has(item.id) ? { ...item, position: { x: start.x + dx, y: start.y + dy } } : item
    }))
  }, [])

  const onNodeDragStart = useCallback((event: React.MouseEvent, node: CanvasFlowNode) => {
    if (writeLocked) return
    setNodeDragging(true)
    beginUnmountedSelectionDrag(node)
    const dragNodes = node.selected ? nodesRef.current.filter((current) => current.selected) : [node]
    beginBatchNodeDrag(event, dragNodes)
    const selectedNodeCount = node.selected
      ? nodesRef.current.filter((current) => current.selected && current.type !== 'group').length
      : 1
    setPlaylistDropTargetId(null)
    playlistNodeDragRef.current = !event.altKey && selectedNodeCount === 1 && isCanvasVideoSource(node)
      ? { id: node.id, start: { ...node.position } }
      : null
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
  }, [beginBatchNodeDrag, beginUnmountedSelectionDrag, expandGroupNodeIds, record, writeLocked])

  const onNodeDrag = useCallback((event: React.MouseEvent, node: CanvasFlowNode) => {
    if (writeLocked) return
    if (batchNodeDragRef.current) setBatchDropTargetId(batchTargetAtPointer(event))
    if (playlistNodeDragRef.current?.id === node.id) {
      const currentNodes = nodesRef.current.map((current) => current.id === node.id ? node : current)
      setPlaylistDropTargetId(findCanvasPlaylistDropTargetId(currentNodes, node))
    }
    const group = groupDragRef.current
    if (!group || group.id !== node.id) return
    const dx = node.position.x - group.start.x
    const dy = node.position.y - group.start.y
    setNodes((current) => current.map((item) => group.members.has(item.id) ? { ...item, position: { x: group.members.get(item.id)!.x + dx, y: group.members.get(item.id)!.y + dy } } : item))
  }, [batchTargetAtPointer, writeLocked])

  const onNodeDragStop = useCallback((event: React.MouseEvent, draggedNode: CanvasFlowNode, draggedNodes: CanvasFlowNode[]) => {
    setNodeDragging(false)
    const unmountedDrag = unmountedDragRef.current
    unmountedDragRef.current = null
    if (finishBatchNodeDrag(event, draggedNodes || [draggedNode])) return
    const playlistDrag = playlistNodeDragRef.current?.id === draggedNode.id ? playlistNodeDragRef.current : null
    const currentNodes = nodesRef.current.map((node) => node.id === draggedNode.id ? draggedNode : node)
    const playlistTargetId = playlistDrag
      ? findCanvasPlaylistDropTargetId(currentNodes, draggedNode)
      : null
    playlistNodeDragRef.current = null
    setPlaylistDropTargetId(null)
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
    if (playlistDrag && playlistTargetId) {
      const target = currentNodes.find((node) => node.id === playlistTargetId && node.type === 'playlist')
      const source = currentNodes.find((node) => node.id === draggedNode.id) || draggedNode
      const result = target
        ? appendCanvasVideoSourceToPlaylist(target.data.playlistItems, source)
        : null
      const restoredNodes = currentNodes.map((node) => {
        if (node.id === source.id) return { ...node, position: { ...playlistDrag.start } }
        if (node.id === target?.id && result?.outcome === 'added') {
          return { ...node, data: { ...node.data, playlistItems: result.items } }
        }
        return node
      })
      nodesRef.current = restoredNodes
      setNodes(restoredNodes)

      if (target && result?.outcome === 'added') {
        const hasEdge = edgesRef.current.some((edge) => edge.source === source.id && edge.target === target.id)
        if (!hasEdge && edgesRef.current.length < CANVAS_EDGE_HARD_LIMIT) {
          const nextEdges = [...edgesRef.current, {
            id: crypto.randomUUID(),
            source: source.id,
            target: target.id,
            sourceHandle: 'output',
            targetHandle: 'input',
            type: 'bezier',
            data: { role: 'INPUT_DEFAULT' },
          } satisfies CanvasFlowEdge]
          edgesRef.current = nextEdges
          setEdges(nextEdges)
        }
        setToast(`已将“${source.data.title || '视频节点'}”加入最终审核播放列表`)
        markChanged('添加视频到最终审核播放列表')
      } else {
        if (result?.outcome === 'not_ready') setToast('该视频尚未生成完成，完成后才能加入审核播放列表')
        else if (result?.outcome === 'duplicate') setToast('该视频已在这个审核播放列表中')
        else if (result?.outcome === 'full') setToast('审核播放列表已达到 200 个片段上限')
        markChanged('取消视频投放')
      }
      groupDragRef.current = null
      dragRecordedRef.current = false
      return
    }
    finishUnmountedSelectionDrag(unmountedDrag, draggedNode, new Set(groupDragRef.current?.members.keys() ?? []))
    setNodes((current) => {
      const reconciled = reconcileDraggedNodeGroupMembership(current, [draggedNode.id])
      return draggedNode.type === 'group'
        ? reconciled
        : fitCanvasGroupsToMembers(reconciled, canvasGroupIdsContainingMembers(reconciled, [draggedNode.id]))
    })
    groupDragRef.current = null
    dragRecordedRef.current = false
    markChanged('移动节点')
  }, [ensureNodeCapacity, finishBatchNodeDrag, finishUnmountedSelectionDrag, markChanged, writeLocked])

  const onSelectionDragStart = useCallback((event: React.MouseEvent, draggedNodes: CanvasFlowNode[]) => {
    if (writeLocked) return
    setNodeDragging(true)
    if (draggedNodes[0]) beginUnmountedSelectionDrag(draggedNodes[0])
    beginBatchNodeDrag(event, draggedNodes)
    if (!dragRecordedRef.current) {
      record('移动多个节点')
      dragRecordedRef.current = true
    }
  }, [beginBatchNodeDrag, beginUnmountedSelectionDrag, record, writeLocked])
  const onSelectionDrag = useCallback((event: React.MouseEvent) => {
    if (batchNodeDragRef.current) setBatchDropTargetId(batchTargetAtPointer(event))
  }, [batchTargetAtPointer])
  const onSelectionDragStop = useCallback((event: React.MouseEvent, draggedNodes: CanvasFlowNode[]) => {
    setNodeDragging(false)
    const unmountedDrag = unmountedDragRef.current
    unmountedDragRef.current = null
    if (finishBatchNodeDrag(event, draggedNodes)) return
    if (writeLocked) {
      dragRecordedRef.current = false
      return
    }
    finishUnmountedSelectionDrag(unmountedDrag, draggedNodes.find((node) => node.id === unmountedDrag?.anchorId), EMPTY_NODE_ID_SET)
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
  }, [finishBatchNodeDrag, finishUnmountedSelectionDrag, markChanged, writeLocked])

  const insertMaterials = useCallback((entries: Array<{ material: FrameosMaterialItem; position: { x: number; y: number } }>) => {
    if (readOnly) return []
    const created = entries.flatMap(({ material, position }) => {
      const node = createMaterialFlowNode(material, position)
      return node ? [node] : []
    })
    if (!created.length || !ensureNodeCapacity(created.length)) return []
    // One undo snapshot and one update for the entire batch, rather than
    // cloning/remapping the whole graph twice for every imported material.
    record('添加作品素材')
    const lastId = created.at(-1)!.id
    setNodes((current) => [...current.map((node) => node.selected ? { ...node, selected: false } : node), ...created.map((node) => ({ ...node, selected: node.id === lastId }))])
    markChanged('添加作品素材')
    setToast(`已添加 ${created.length} 个素材`)
    return created
  }, [ensureNodeCapacity, markChanged, readOnly, record])

  const insertMaterial = useCallback((material: FrameosMaterialItem, position?: { x: number; y: number }) => (
    insertMaterials([{ material, position: position || centerPosition() }])[0] || null
  ), [centerPosition, insertMaterials])

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
      form.set('projectId', 'personal')
      const response = await apiFetch(`/api/projects/${projectId}/canvas/${initialGraph.canvas.id}/materials`, { method: 'POST', body: form })
      if (response.ok) {
        const payload = await response.json() as { material?: FrameosMaterialItem }
        if (!payload.material?.id || !payload.material.url) throw new Error(`${file.name || '文件'}未返回可用素材`)
        return payload.material
      }
      lastError = await readApiErrorMessage(response, lastError)
      if (response.status !== 429 || attempt === CANVAS_UPLOAD_MAX_ATTEMPTS) throw new Error(lastError)
      const retryAfter = Number(response.headers.get('retry-after'))
      await new Promise((resolve) => window.setTimeout(resolve, canvasUploadRetryDelay(attempt, retryAfter)))
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

  useEffect(() => {
    const handleStoryToast = (event: Event) => {
      const message = (event as CustomEvent<{ message?: unknown }>).detail?.message
      if (typeof message === 'string' && message) setToast(message)
    }
    window.addEventListener(STORY_CANVAS_TOAST_EVENT, handleStoryToast)
    return () => window.removeEventListener(STORY_CANVAS_TOAST_EVENT, handleStoryToast)
  }, [])

  useEffect(() => {
    const handleMaterialRequest = (event: Event) => {
      const nodeId = (event as CustomEvent<{ nodeId?: unknown }>).detail?.nodeId
      if (typeof nodeId !== 'string') return
      const target = nodesRef.current.find((node) => node.id === nodeId && node.type === 'video_edit')
      if (target) setVideoEditMaterialNodeId(nodeId)
    }
    const handleReferenceRequest = (event: Event) => {
      const detail = (event as CustomEvent<{ nodeId?: unknown; type?: unknown }>).detail
      if (typeof detail?.nodeId !== 'string') return
      if (detail.type !== 'image' && detail.type !== 'audio') return
      const target = nodesRef.current.find((node) => node.id === detail.nodeId && node.type === 'video_edit')
      if (target) setVideoEditReferencePicker({ nodeId: detail.nodeId, type: detail.type })
    }
    const handleSubmitRequest = (event: Event) => {
      const detail = (event as CustomEvent<{
        nodeId?: unknown
        prompt?: unknown
        startMs?: unknown
        endMs?: unknown
        generateAudio?: unknown
      }>).detail
      if (typeof detail?.nodeId !== 'string' || typeof detail.prompt !== 'string') return
      if (typeof detail.startMs !== 'number' || typeof detail.endMs !== 'number') return
      void submitVideoEdit({
        nodeId: detail.nodeId,
        prompt: detail.prompt,
        startMs: detail.startMs,
        endMs: detail.endMs,
        generateAudio: detail.generateAudio !== false,
      }).catch((error) => setToast(error instanceof Error ? error.message : '视频编辑失败'))
    }
    window.addEventListener(CANVAS_VIDEO_EDIT_MATERIAL_EVENT, handleMaterialRequest)
    window.addEventListener(CANVAS_VIDEO_EDIT_REFERENCE_EVENT, handleReferenceRequest)
    window.addEventListener(CANVAS_VIDEO_EDIT_SUBMIT_EVENT, handleSubmitRequest)
    return () => {
      window.removeEventListener(CANVAS_VIDEO_EDIT_MATERIAL_EVENT, handleMaterialRequest)
      window.removeEventListener(CANVAS_VIDEO_EDIT_REFERENCE_EVENT, handleReferenceRequest)
      window.removeEventListener(CANVAS_VIDEO_EDIT_SUBMIT_EVENT, handleSubmitRequest)
    }
  }, [submitVideoEdit])

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
    if (replacement.type === 'video_edit') {
      replacement.data = {
        ...replacement.data,
        videoEdit: {
          ...(replacement.data.videoEdit || {}),
          sourceKind: 'upload',
          sourceNodeId: null,
          materialId: material.id,
        },
      }
    }
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
    insertMaterials(materials.map((material, index) => ({ material, position: {
      x: anchor.x + (index % columns) * 360,
      y: anchor.y + Math.floor(index / columns) * 260,
    } })))
    setToast(failed > 0 ? `已上传 ${materials.length} 个文件，${failed} 个失败` : `已上传 ${materials.length} 个文件`)
    if (materials.length === 0) {
      const firstFailure = results.find((result) => result.status === 'rejected')
      throw firstFailure?.reason instanceof Error ? firstFailure.reason : new Error('文件上传失败')
    }
  }, [centerPosition, ensureNodeCapacity, insertMaterials, readOnly, uploadMaterial])

  const openUploadPicker = useCallback((position?: { x: number; y: number }) => {
    pendingUploadPositionRef.current = position || null
    uploadRef.current?.click()
  }, [])

  /** 把画布上的图片登记成本作品资产库素材，并带上角色/场景/道具归类。 */
  const uploadNodeToAssetLibrary = useCallback(async (
    nodeId: string,
    input: { title: string; assetCategory: FrameosAssetCategory },
  ) => {
    if (readOnly) throw new Error('当前画布为只读，无法上传到资产库')
    await prepareGenerationSubmission()
    const response = await apiFetch(`/api/projects/${projectId}/canvas/${initialGraph.canvas.id}/materials`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ register: 'library', nodeIds: [nodeId], ...input }),
    })
    if (!response.ok) throw new Error(await readApiErrorMessage(response, '上传资产库失败'))
    const payload = await response.json().catch(() => null) as { materials?: Array<{ title?: string }> } | null
    setAssetLibraryNodeId(null)
    setToast(`已上传「${payload?.materials?.[0]?.title || input.title}」到资产库`)
  }, [initialGraph.canvas.id, prepareGenerationSubmission, projectId, readOnly])

  /** 从素材库直接给生成节点添加引用素材，并把它放进画布作为可复用的引用节点。 */
  const addGeneratorReferenceMaterials = useCallback((materials: FrameosMaterialItem[]) => {
    const picker = generatorReferencePicker
    setGeneratorReferencePicker(null)
    if (!picker || materials.length === 0) return
    const anchorNode = nodesRef.current.find((node) => node.id === picker.nodeId)
    if (!anchorNode) return
    const referencedIds = new Set([
      ...(anchorNode.data.generation?.referenceNodeIds || []),
      ...edgesRef.current.filter((edge) => edge.target === anchorNode.id).map((edge) => edge.source),
    ])
    const existingReferences = nodesRef.current.filter((node) => referencedIds.has(node.id))
    const existingMaterialIds = new Set(existingReferences.map((node) => node.data.materialId).filter(Boolean))
    const uniqueMaterials = [...new Map(materials.map((material) => [material.id, material])).values()]
      .filter((material) => !existingMaterialIds.has(material.id))
    const type = anchorNode.type
    const validMaterials = type === 'image' || type === 'video' || type === 'audio'
      ? selectMaterialsForReferenceLimits(uniqueMaterials, {
        type,
        inputMode: anchorNode.data.generation?.inputMode || null,
        inputSchema: anchorNode.data.generation?.inputSchema || null,
      }, existingReferences.flatMap((node) => {
        const mediaType = node.data.mediaType || node.type
        return mediaType === 'image' || mediaType === 'video' || mediaType === 'audio' ? [mediaType] : []
      }))
      : uniqueMaterials
    if (validMaterials.length === 0) {
      setToast(uniqueMaterials.length === 0 ? '所选素材已经引用，无需重复添加' : '素材类型不兼容或引用数量已达到模型上限')
      return
    }
    if (!ensureNodeCapacity(validMaterials.length)) return
    const anchor = anchorNode
      ? { x: anchorNode.position.x - 420, y: anchorNode.position.y + 40 }
      : centerPosition()
    const createdIds = insertMaterials(validMaterials.map((material, index) => ({ material, position: { x: anchor.x, y: anchor.y + index * 280 } }))).map((node) => node.id)
    if (createdIds.length === 0) {
      setToast('引用素材未能添加到画布')
      return
    }
    setNodes((current) => current.map((node) => {
      if (node.id !== picker.nodeId) return node.selected ? { ...node, selected: false } : node
      return {
        ...node, selected: true,
        data: {
          ...node.data,
          generation: {
            ...(node.data.generation || {}),
            referenceNodeIds: [...new Set([...(node.data.generation?.referenceNodeIds || []), ...createdIds])],
          },
        },
      }
    }))
    setGeneratorReferenceInjection({ nodeId: picker.nodeId, ids: createdIds })
    markChanged('添加生成引用素材')
    const skipped = materials.length - createdIds.length
    setToast(`已引用 ${createdIds.length} 个素材${skipped > 0 ? `，${skipped} 个重复、不兼容或超出模型上限的素材未添加` : ''}`)
  }, [centerPosition, ensureNodeCapacity, generatorReferencePicker, insertMaterials, markChanged])

  const selectGeneratorMentionMaterial = useCallback((nodeId: string, material: FrameosMaterialItem): string | null => {
    if (writeLocked || !material.url) return null
    const target = nodesRef.current.find((node) => node.id === nodeId)
    if (!target) return null
    let source = nodesRef.current.find((node) => node.id !== nodeId && node.data.materialId === material.id) || null
    if (!source) {
      pendingMentionGeneratorRef.current = nodeId
      const created = insertMaterials([{
        material,
        position: { x: target.position.x - 420, y: target.position.y + 40 },
      }])[0]
      if (!created) {
        pendingMentionGeneratorRef.current = null
        return null
      }
      source = created
      nodesRef.current = [...nodesRef.current, created]
    }
    const result = planCanvasBatchConnections({
      nodes: nodesRef.current,
      edges: edgesRef.current,
      sourceNodeIds: [source.id],
      targetNodeId: nodeId,
      maxEdges: CANVAS_EDGE_HARD_LIMIT,
    })
    const alreadyReferenced = target.data.generation?.referenceNodeIds?.includes(source.id) || false
    if (result.added === 0 && !alreadyReferenced) {
      pendingMentionGeneratorRef.current = null
      return null
    }
    record('引用个人素材库素材')
    nodesRef.current = result.nodes.map((node) => ({ ...node, selected: node.id === nodeId }))
    edgesRef.current = result.edges
    setNodes(nodesRef.current)
    setEdges(result.edges)
    setGeneratorReferenceInjection({ nodeId, ids: [source.id] })
    markChanged('引用个人素材库素材')
    setToast(alreadyReferenced ? '已引用素材，原有连线保持不变' : '已引用素材并自动连接')
    return source.id
  }, [insertMaterials, markChanged, record, writeLocked])

  // One-click prompt matching wires a whole batch in one undo step: reuse
  // canvas nodes already carrying the material, create the rest beside the
  // generator, then connect everything that is not referenced yet.
  const matchGeneratorPromptMaterials = useCallback((nodeId: string, materials: FrameosMaterialItem[], validateReferences: (references: CanvasFlowNode[]) => boolean) => {
    // Read the live lock: an async caller may have started before a production
    // sync / offline recovery began, and must not write once the canvas locks.
    if (writeLockedRef.current || materials.length === 0) return null
    const target = nodesRef.current.find((node) => node.id === nodeId)
    if (!target) return null
    const unique = [...new Map(materials.map((material) => [material.id, material])).values()]
    const targetMediaType = getMediaType(target)
    const inputMode = target.data.generation?.inputMode || 'text'
    const allowsAudio = targetMediaType === 'video' && inputMode === 'text'
      && target.data.generation?.generateAudio !== false
    // Character images drag their bound voice along, the same contract the
    // submission route applies server-side; other modes never receive audio.
    const voiceIds = [...new Set(unique.flatMap((material) => {
      if (!allowsAudio || material.type !== 'image') return []
      const voiceId = characterVoiceMaterialId(material.metadata)
      return voiceId && !unique.some((item) => item.id === voiceId) ? [voiceId] : []
    }))]
    const existingByMaterialId = new Map<string, CanvasFlowNode>()
    const wiredSourceIds = new Set(edgesRef.current.filter((edge) => edge.target === nodeId).map((edge) => edge.source))
    const referencedIds = new Set(target.data.generation?.referenceNodeIds ?? wiredSourceIds)
    // Prefer the node the generator already references, then any wired input,
    // then the first canvas copy — a duplicate elsewhere must not win.
    for (const node of nodesRef.current) {
      if (node.id === nodeId || typeof node.data.materialId !== 'string') continue
      const previous = existingByMaterialId.get(node.data.materialId)
      if (!previous
        || (referencedIds.has(node.id) && !referencedIds.has(previous.id))
        || (wiredSourceIds.has(node.id) && !wiredSourceIds.has(previous.id) && !referencedIds.has(previous.id))) {
        existingByMaterialId.set(node.data.materialId, node)
      }
    }
    const missing = unique.filter((material) => !existingByMaterialId.has(material.id))
    // Plan on a snapshot: nothing is written until the connection planner has
    // accepted at least one source, so a full rejection leaves no orphan nodes.
    const created = missing.flatMap((material, index) => {
      const node = createMaterialFlowNode(material, { x: target.position.x - 420, y: target.position.y + 40 + index * 180 })
      return node ? [node] : []
    })
    const sourceNodeIds = unique.flatMap((material) => {
      const node = existingByMaterialId.get(material.id) || created.find((item) => item.data.materialId === material.id)
      return node ? [node.id] : []
    })
    if (sourceNodeIds.length === 0) return null
    const toConnect = sourceNodeIds.filter((id) => !referencedIds.has(id))
    // Bound voices ride along only when their character image is accepted.
    // Reuse an existing voice node; a voice with no canvas node is left to the
    // server-side auto-include at submission (it needs the stored audio file).
    const voiceNodeIds = voiceIds.flatMap((voiceId) => {
      const owner = unique.find((material) => material.type === 'image' && characterVoiceMaterialId(material.metadata) === voiceId)
      if (!owner) return []
      const ownerNode = existingByMaterialId.get(owner.id) || created.find((item) => item.data.materialId === owner.id)
      if (!ownerNode) return []
      const voiceNode = existingByMaterialId.get(voiceId)
      return voiceNode ? [voiceNode.id] : []
    })
    const voiceToConnect = voiceNodeIds.filter((id) => !referencedIds.has(id) && !toConnect.includes(id))
    if (toConnect.length === 0 && voiceToConnect.length === 0) {
      return { added: 0, restored: 0, matched: sourceNodeIds.length, skippedForNodeCapacity: 0 }
    }
    // Capacity is checked against the nodes that will actually be written, not
    // the candidate count: a tight canvas may still accept a partial result.
    const capacityFor = (acceptedIds: Set<string>) => created.filter((node) => acceptedIds.has(node.id)).length
    // Images/videos first so a voice cannot consume the last audio slot before
    // its owner image is planned; voices follow in a second pass.
    const primaryResult = toConnect.length > 0
      ? planCanvasBatchConnections({
        nodes: [...nodesRef.current, ...created],
        edges: edgesRef.current,
        sourceNodeIds: toConnect,
        validateReferences,
        newSourceCapacity: {
          ids: new Set(created.map((node) => node.id)),
          remaining: Math.max(0, CANVAS_NODE_HARD_LIMIT - nodesRef.current.length),
        },
        targetNodeId: nodeId,
        maxEdges: CANVAS_EDGE_HARD_LIMIT,
      })
      : null
    const baseNodes = primaryResult ? primaryResult.nodes : [...nodesRef.current, ...created]
    const baseEdges = primaryResult ? primaryResult.edges : edgesRef.current
    const baseTarget = baseNodes.find((node) => node.id === nodeId)
    const baseAcceptedIds = new Set(baseTarget?.data.generation?.referenceNodeIds ?? referencedIds)
    const eligibleVoiceIds = voiceToConnect.filter((voiceId) => {
      const voiceNode = nodesRef.current.find((node) => node.id === voiceId)
      const voiceMaterialId = typeof voiceNode?.data.materialId === 'string' ? voiceNode.data.materialId : ''
      return unique.some((material) => {
        if (material.type !== 'image' || characterVoiceMaterialId(material.metadata) !== voiceMaterialId) return false
        const ownerNode = existingByMaterialId.get(material.id) || created.find((item) => item.data.materialId === material.id)
        return Boolean(ownerNode && ownerNode.data.voiceDetached !== true && baseAcceptedIds.has(ownerNode.id))
      })
    })
    const voiceResult = eligibleVoiceIds.length > 0
      ? planCanvasBatchConnections({
        nodes: baseNodes,
        edges: baseEdges,
        sourceNodeIds: eligibleVoiceIds,
        validateReferences,
        targetNodeId: nodeId,
        maxEdges: CANVAS_EDGE_HARD_LIMIT,
      })
      : null
    const result = voiceResult || { nodes: baseNodes, edges: baseEdges, added: 0, skipped: 0 }
    const totalAdded = (primaryResult?.added || 0) + (voiceResult?.added || 0)
    const restored = (primaryResult?.restored || 0) + (voiceResult?.restored || 0)
    const skippedForNodeCapacity = primaryResult?.skippedForNodeCapacity ?? 0
    if (totalAdded === 0 && restored === 0) {
      if (toConnect.length > 0 && skippedForNodeCapacity === 0) return null
      return { added: 0, restored: 0, matched: sourceNodeIds.length - toConnect.length, skippedForNodeCapacity }
    }
    const plannedTarget = result.nodes.find((node) => node.id === nodeId)
    const acceptedIds = new Set(plannedTarget?.data.generation?.referenceNodeIds ?? referencedIds)
    if (!ensureNodeCapacity(capacityFor(acceptedIds))) return null
    // Drop created nodes whose connection was rejected (model reference caps):
    // they would sit on the canvas unreferenced and undo would still remove them.
    const rejectedCreatedIds = new Set(created.filter((node) => !acceptedIds.has(node.id)).map((node) => node.id))
    const committedNodes = result.nodes
      .filter((node) => !rejectedCreatedIds.has(node.id))
      .map((node) => ({ ...node, selected: node.id === nodeId }))
    const committedEdges = result.edges.filter((edge) => !rejectedCreatedIds.has(edge.source) && !rejectedCreatedIds.has(edge.target))
    // One history entry for the whole batch, recorded before the write.
    record('一键匹配引用')
    nodesRef.current = committedNodes
    edgesRef.current = committedEdges
    setNodes(committedNodes)
    setEdges(committedEdges)
    markChanged('一键匹配引用')
    return { added: totalAdded, restored, matched: sourceNodeIds.filter((id) => acceptedIds.has(id)).length, skippedForNodeCapacity }
  }, [ensureNodeCapacity, markChanged, record])

  const handleMaterialCollectionDrop = useCallback((materials: FrameosMaterialItem[], position: { x: number; y: number }) => {
    const dropped = materials.filter((material) => ['image', 'video', 'audio', 'model3d'].includes(material.type))
    if (dropped.length === 0) {
      setToast('没有可添加的素材类型')
      return
    }
    const target = wrapperRef.current
      ? findCanvasTargetNodeIdAtPoint({
        nodes: Array.from(flowStore.getState().nodeLookup.values()),
        point: position,
      })
      : null
    const targetNode = nodesRef.current.find((node) => node.id === target)
    const existingReferenceIds = new Set([
      ...(targetNode?.data.generation?.referenceNodeIds || []),
      ...edgesRef.current.filter((edge) => edge.target === target).map((edge) => edge.source),
    ])
    const existingReferenceNodes = nodesRef.current.filter((node) => existingReferenceIds.has(node.id))
    const existingMaterialIds = new Set(existingReferenceNodes.map((node) => node.data.materialId).filter(Boolean))
    const uniqueDropped = [...new Map(dropped.map((material) => [material.id, material])).values()]
      .filter((material) => !targetNode || !existingMaterialIds.has(material.id))
    const targetMediaType = targetNode?.type === 'image' || targetNode?.type === 'video' || targetNode?.type === 'audio'
      ? targetNode.type
      : null
    const inputMode = targetMediaType === 'video'
      ? (targetNode?.data.generation?.inputMode || 'text')
      : null
    const compatible = targetMediaType === 'image'
      ? uniqueDropped.filter((material) => material.type === 'image')
      : targetMediaType === 'audio'
        ? uniqueDropped.filter((material) => material.type === 'audio')
        : targetMediaType === 'video'
          ? inputMode === 'image' || inputMode === 'firstlastframe'
            ? uniqueDropped.filter((material) => material.type === 'image')
            : uniqueDropped.filter((material) => material.type === 'image' || material.type === 'video' || material.type === 'audio')
          : uniqueDropped
    const valid = targetMediaType
      ? selectMaterialsForReferenceLimits(compatible, {
        type: targetMediaType,
        inputMode: targetNode?.data.generation?.inputMode || null,
        inputSchema: targetNode?.data.generation?.inputSchema || null,
      }, existingReferenceNodes.flatMap((node) => {
        const type = node.data.mediaType || node.type
        return type === 'image' || type === 'video' || type === 'audio' ? [type] : []
      }))
      : compatible
    if (targetMediaType && valid.length === 0) {
      setToast(uniqueDropped.length === 0 ? '所选素材已经引用，无需重复添加' : compatible.length === 0 ? '所选素材类型与目标生成节点不匹配' : '所选模型的可引用素材数量已达到上限')
      return
    }
    const columns = targetMediaType ? 1 : Math.max(1, Math.ceil(Math.sqrt(valid.length)))
    const anchor = targetMediaType && targetNode
      ? { x: targetNode.position.x - 420, y: targetNode.position.y + 40 }
      : position
    const createdIds = insertMaterials(valid.map((material, index) => ({ material, position: {
      x: anchor.x + (index % columns) * 360,
      y: anchor.y + Math.floor(index / columns) * 280,
    } }))).map((node) => node.id)
    if (createdIds.length === 0) return

    if (targetMediaType && targetNode && createdIds.length > 0) {
      setNodes((current) => current.map((node) => {
        if (node.id !== targetNode.id) return node.selected ? { ...node, selected: false } : node
        const currentReferenceNodeIds = node.data.generation?.referenceNodeIds || []
        const referenceNodeIds = Array.from(new Set([...currentReferenceNodeIds, ...createdIds]))
        return {
          ...node,
          selected: true,
          data: {
            ...node.data,
            generation: {
              ...(node.data.generation || {}),
              referenceNodeIds,
            },
          },
        }
      }))
      setGeneratorReferenceInjection({ nodeId: targetNode.id, ids: createdIds })
      markChanged('批量引用作品素材')
    }
    const skipped = materials.length - createdIds.length
    setToast(`已添加 ${createdIds.length} 个素材${skipped > 0 ? `，${skipped} 个重复、不兼容或超出模型上限的素材未添加` : ''}`)
  }, [flowStore, insertMaterials, markChanged])

  const pasteFromSystem = useCallback(async (position?: { x: number; y: number }) => {
    if (readOnly) return
    const selected = nodesRef.current.filter((node) => node.selected)
    const textTarget = selected.length === 1 && (selected[0].type === 'text' || selected[0].type === 'note') ? selected[0] : null
    const clipboardItems = await navigator.clipboard?.read?.().catch(() => []) || []
    const files: File[] = []
    let systemCanvasJson: string | null = null
    for (const item of clipboardItems) {
      if (hasCanvasClipboardMime(item.types)) {
        try {
          systemCanvasJson = await (await item.getType(CANVAS_CLIPBOARD_MIME)).text()
        } catch {
          systemCanvasJson = ''
        }
        continue
      }
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
    const systemText = await navigator.clipboard?.readText().catch(() => '') || ''
    const decision = resolvePasteDecision({
      soleSelectedTextNodeId: textTarget?.id || null,
      readOnly,
      systemText,
      systemHasFiles: files.length > 0,
      internalClipboardIsLatest: systemCanvasJson !== null || (Boolean(clipboardRef.current?.nodes.length) && (!systemText || systemText.trim() === internalCopyTextRef.current?.trim())),
    })
    if (decision === 'insert-text' && textTarget) {
      const text = systemText.slice(0, 20_000)
      const previous = typeof textTarget.data.text === 'string' ? textTarget.data.text : ''
      updateNodeData(textTarget.id, { text: `${previous}${previous && !previous.endsWith('\n') ? '\n' : ''}${text}` }, '粘贴文本')
      if (systemText.length > 20_000) setToast('文本过长，已截取前 20000 个字符')
      return
    }
    const source = resolveCanvasClipboardPasteSource({
      hasSystemCanvas: systemCanvasJson !== null,
      hasSystemMedia: files.length > 0,
      systemTextReadable: false,
      systemText: '',
      hasInternalCanvas: Boolean(clipboardRef.current?.nodes.length),
      internalCopyText: null,
    })
    if (source === 'system-media') {
      await handleUploads(files, position)
      return
    }
    await paste(position, source === 'system-canvas' ? systemCanvasJson : null)
  }, [handleUploads, paste, readOnly, updateNodeData])

  const selectedNodes = nodes.filter((node) => node.selected)
  const selectionDownloadNodes = selectedNodes.length > 1 ? collectSelectionDownloadNodes(nodes, selectedNodes) : EMPTY_NODE_LIST
  const selectedEdges = edges.filter((edge) => edge.selected)
  const contextNode = contextMenu?.scope === 'node' ? nodes.find((node) => node.id === contextMenu.nodeId) || null : null
  const canRegenerateContextNode = Boolean(contextNode?.data.prompt && contextNode.data.generation?.modelKey)
  const assetLibrarySourceNode = contextNode && getMediaType(contextNode) === 'image'
    ? contextNode
    : null
  const canUploadToAssetLibrary = Boolean(
    !readOnly
    && assetLibrarySourceNode
    && (assetLibrarySourceNode.data.contentUrl || assetLibrarySourceNode.data.imageUrl || assetLibrarySourceNode.data.posterUrl),
  )
  const assetLibraryNode = assetLibraryNodeId
    ? nodes.find((node) => node.id === assetLibraryNodeId && getMediaType(node) === 'image') || null
    : null
  const directlySelectedCreativeNode = selectedNodes.length === 1
    && !selectedNodes[0].type?.startsWith('production_')
    && selectedNodes[0].type !== 'group'
    && selectedNodes[0].type !== 'studio_3d'
    && selectedNodes[0].type !== 'playlist'
    && selectedNodes[0].type !== 'video_edit'
    && !isStoryNodeType(selectedNodes[0].type)
    ? selectedNodes[0]
    : null
  const selectedCreativeNode = directlySelectedCreativeNode && directlySelectedCreativeNode.id !== generatorSuppressedNodeId && directlySelectedCreativeNode.id !== textEditingNodeId
    && directlySelectedCreativeNode.data.__canvasUnhydrated !== true
    ? directlySelectedCreativeNode
    : null
  soleSelectedNodeIdRef.current = selectedNodes.length === 1 ? selectedNodes[0].id : null
  // Keep the panel width in workspace pixels; only the flow zoom is canceled.
  const renderedGeneratorPanelWidth = Math.min(generatorPanelWidth, Math.max(240, canvasSurfaceSize.width - 80))
  const renderGenerator = () => selectedCreativeNode && wrapperRef.current
    ? <CanvasGenerator projectId={projectId} node={selectedCreativeNode} incomingNodes={incomingNodes} secondaryNodeIds={secondaryIncomingNodeIds} referenceNodes={nodes} viewportLayerTarget={wrapperRef.current} panelWidth={renderedGeneratorPanelWidth} onPanelWidthChange={updateGeneratorPanelWidth} onDraftChange={(patch) => updateNodeData(selectedCreativeNode.id, patch as Partial<CanvasNodeData>)} onGenerate={handleGenerate} onReplace={() => requestContentReplacement(selectedCreativeNode.id)} onClose={() => setNodes((current) => current.map((node) => node.id === selectedCreativeNode.id ? { ...node, selected: false } : node))} onAddReferences={(request) => setGeneratorReferencePicker({ nodeId: selectedCreativeNode.id, ...request })} onRemoveReference={(sourceNodeId) => removeReferenceWire(selectedCreativeNode.id, sourceNodeId)} onChangeReferenceWire={writeLocked ? undefined : (sourceNodeId, referenceIds) => changeReferenceWire(selectedCreativeNode.id, sourceNodeId, referenceIds)} onToggleReferenceVoice={(nodeId) => updateNodeData(nodeId, { voiceDetached: nodesRef.current.find((item) => item.id === nodeId)?.data.voiceDetached !== true }, '切换角色音色携带')} onSelectLibraryMaterial={(material) => selectGeneratorMentionMaterial(selectedCreativeNode.id, material)} onMatchPromptMaterials={writeLocked ? undefined : (materials, validateReferences) => matchGeneratorPromptMaterials(selectedCreativeNode.id, materials, validateReferences)} injectedReferenceNodeIds={generatorReferenceInjection.nodeId === selectedCreativeNode.id ? generatorReferenceInjection.ids : EMPTY_REFERENCE_NODE_IDS} onFocus={() => { const source = incomingNodes.find((node) => getMediaType(node) === 'image'); if (source) setImageOperation({ mode: 'lens_focus', sourceNodeId: source.id, targetNodeId: selectedCreativeNode.id }); else setToast('请先连接一张可用图片') }} globalStyleNodeId={globalStyleNode?.id} globalStyleSourceTitle={globalStyleNode?.data.title || '未命名文本'} globalStylePrompt={typeof globalStyleNode?.data.text === 'string' ? globalStyleNode.data.text : ''} onGlobalStylePromptChange={(value) => { if (globalStyleNode) updateNodeData(globalStyleNode.id, { text: value }) }} videoPrefixNodeId={videoPrefixNode?.id} videoPrefixSourceTitle={videoPrefixNode?.data.title || '未命名文本'} videoPrefixPrompt={typeof videoPrefixNode?.data.text === 'string' ? videoPrefixNode.data.text : ''} onVideoPrefixPromptChange={(value) => { if (videoPrefixNode) updateNodeData(videoPrefixNode.id, { text: value }) }} />
    : null
  const incomingNodes = selectedCreativeNode ? edges.filter((edge) => edge.target === selectedCreativeNode.id).map((edge) => nodes.find((node) => node.id === edge.source)).filter((node): node is CanvasFlowNode => Boolean(node)) : []
  const secondaryIncomingNodeIds = selectedCreativeNode
    ? new Set(collectCanvasSecondaryNodeIds(edges, selectedCreativeNode.id, incomingNodes.map((node) => node.id)))
    : EMPTY_NODE_ID_SET
  const globalStyleNodes = nodes.filter((node) => getMediaType(node) === 'text' && node.data.globalStylePrompt === true)
  // The flag is unique by construction; if legacy data holds duplicates we
  // deliberately show no style block rather than picking an arbitrary source.
  const globalStyleNode = globalStyleNodes.length === 1 ? globalStyleNodes[0] : null
  const videoPrefixNodes = nodes.filter((node) => getMediaType(node) === 'text' && node.data.videoPrefixPrompt === true)
  const videoPrefixNode = videoPrefixNodes.length === 1 ? videoPrefixNodes[0] : null
  const historyNode = historyNodeId ? nodes.find((node) => node.id === historyNodeId) || null : null
  const hydrationNodeIds = summaryMode
    ? [...new Set([
      ...(directlySelectedCreativeNode ? [directlySelectedCreativeNode.id] : []),
      ...(textEditingNodeId ? [textEditingNodeId] : []),
      ...nodes.filter((node) => node.data.__server?.status === 'RUNNING').map((node) => node.id),
      ...(globalStyleNode ? [globalStyleNode.id] : []),
      ...(videoPrefixNode ? [videoPrefixNode.id] : []),
    ])]
    : []
  const hydrationKey = hydrationNodeIds.sort().join(' ')
  useEffect(() => {
    if (!hydrationKey) return
    let active = true
    for (const nodeId of hydrationKey.split(' ')) {
      const current = nodesRef.current.find((node) => node.id === nodeId)
      if (!current || current.data.__canvasUnhydrated !== true) continue
      void prepareNodeForWrite(nodeId).catch((error: unknown) => {
        if (active) setToast(error instanceof Error ? error.message : '节点详情加载失败')
      })
    }
    return () => { active = false }
  }, [hydrationKey, prepareNodeForWrite])
  const modelPreviewNode = modelPreviewNodeId ? nodes.find((node) => node.id === modelPreviewNodeId) || null : null
  const mediaPreviewNode = mediaPreviewNodeId ? nodes.find((node) => node.id === mediaPreviewNodeId) || null : null
  const panoramaPreviewNode = panoramaPreviewNodeId ? nodes.find((node) => node.id === panoramaPreviewNodeId) || null : null
  const studioNode = studioNodeId ? nodes.find((node) => node.id === studioNodeId && node.type === 'studio_3d') || null : null
  const studioIncomingNodes = studioNode
    ? edges.filter((edge) => edge.target === studioNode.id).map((edge) => nodes.find((node) => node.id === edge.source)).filter((node): node is CanvasFlowNode => Boolean(node))
    : []
  const runningSignature = nodes.map(canvasMediaExecution)
    .filter((execution): execution is CanvasMediaExecution => Boolean(execution))
    .map((execution) => `${execution.nodeId}:${execution.assetId || execution.taskId}`)
    .sort().join('|')
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
    if (generatorSuppressedNodeId && selectedNodes.length === 0) setGeneratorSuppressedNodeId(null)
  }, [generatorSuppressedNodeId, selectedNodes.length])

  useEffect(() => {
    if (!persistentTaskSignature) return
    let active = true
    let polling = false
    const controllers = new Set<AbortController>()
    const requestSignal = () => {
      const controller = new AbortController()
      controllers.add(controller)
      const timer = window.setTimeout(() => controller.abort(), CANVAS_POLL_REQUEST_TIMEOUT_MS)
      return {
        signal: controller.signal,
        finish: () => {
          window.clearTimeout(timer)
          controllers.delete(controller)
        },
      }
    }
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
          const request = requestSignal()
          try {
            const update = await fetchCanvasGenerationTask(
              `/api/projects/${encodeURIComponent(projectId)}/canvas/${encodeURIComponent(initialGraph.canvas.id)}/generation-tasks/${encodeURIComponent(candidate.taskId)}`,
              request.signal,
            )
            return { ...candidate, update, pollError: null as string | null }
          } catch (error) {
            return {
              ...candidate,
              update: null,
              pollError: request.signal.aborted ? '读取任务状态超时，正在重试' : error instanceof Error ? error.message : '读取任务状态失败',
            }
          } finally {
            request.finish()
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
              actualCostPoints: task.cost?.points ?? null,
            }
            return {
              ...node,
              data: {
                ...node.data,
                text,
                textMarks: undefined,
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
    const stopPolling = startVisiblePolling(poll, 3_000)
    return () => {
      stopPolling()
      active = false
      for (const controller of controllers) controller.abort()
    }
  }, [initialGraph.canvas.id, markChanged, materializeStoryboardPlan, persistentTaskSignature, projectId, readOnly])

  useEffect(() => {
    if (!runningSignature) return
    let active = true
    let polling = false
    const controllers = new Set<AbortController>()
    const requestSignal = () => {
      const controller = new AbortController()
      controllers.add(controller)
      const timer = window.setTimeout(() => controller.abort(), CANVAS_POLL_REQUEST_TIMEOUT_MS)
      return {
        signal: controller.signal,
        finish: () => {
          window.clearTimeout(timer)
          controllers.delete(controller)
        },
      }
    }
    const poll = async () => {
      if (polling) return
      polling = true
      try {
        const pendingByType = new Map<ToolboxAsset['type'], CanvasMediaExecution[]>()
        for (const node of nodesRef.current) {
          const execution = canvasMediaExecution(node)
          if (!execution) continue
          pendingByType.set(execution.type, [...(pendingByType.get(execution.type) || []), execution])
        }
        const requests = Array.from(pendingByType.entries()).flatMap(([type, executions]) => {
          const direct = executions.filter((execution) => execution.assetId)
          const byTask = executions.filter((execution) => !execution.assetId && execution.taskId)
          return [
            ...chunkCanvasToolboxAssetIds(direct.map((execution) => execution.assetId!)).map((ids) => ({
              type, ids, key: 'assetIds' as const,
              executions: direct.filter((execution) => ids.includes(execution.assetId!)),
            })),
            ...chunkCanvasToolboxAssetIds(byTask.map((execution) => execution.taskId!)).map((ids) => ({
              type, ids, key: 'taskIds' as const,
              executions: byTask.filter((execution) => ids.includes(execution.taskId!)),
            })),
          ]
        })
        const results = await Promise.all(requests.map(async ({ type, ids, key, executions }) => {
          const request = requestSignal()
          try {
            const params = new URLSearchParams({ projectId, type, [key]: ids.join(',') })
            const response = await apiFetch(`/api/frameos/toolbox/assets?${params}`, { signal: request.signal })
            if (!response.ok) throw new Error(await readApiErrorMessage(response, '读取生成状态失败'))
            const payload = await response.json() as { assets?: ToolboxAsset[] }
            return { type, ids, key, executions, assets: payload.assets || [], error: null as string | null }
          } catch (error) {
            return { type, ids, key, executions, assets: [] as ToolboxAsset[], error: request.signal.aborted ? '读取生成状态超时，正在重试' : error instanceof Error ? error.message : '读取生成状态失败' }
          } finally {
            request.finish()
          }
        }))
        if (!active) return
        const pollResultsByNodeId = new Map(results.flatMap((result) => result.executions.map((execution) => [
          execution.nodeId,
          { pollId: execution.assetId || execution.taskId!, error: result.error } as const,
        ])))
        const byNodeId = new Map(results.flatMap((result) => result.executions.flatMap((execution) => {
          const asset = result.assets.find((item) => execution.assetId
            ? item.id === execution.assetId
            : item.task?.id === execution.taskId)
          return asset ? [[execution.nodeId, asset] as const] : []
        })))
        setNodes((current) => current.map((node) => {
          const execution = canvasMediaExecution(node)
          if (!execution) return node
          const pollId = execution.assetId || execution.taskId!
          const pollKey = `${node.id}:${pollId}`
          const pollResult = pollResultsByNodeId.get(node.id)
          const pollRecovered = pollResult?.pollId === pollId && !pollResult.error
          if (pollRecovered) {
            assetPollFailuresRef.current.delete(pollKey)
          }
          const pollError = pollResult?.pollId === pollId ? pollResult.error : null
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
          const asset = byNodeId.get(node.id)
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
                history: (node.data.history || []).map((item) => item.assetId === execution.assetId
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
          const actualCostPoints = ready ? asset.task?.costPoints ?? null : null
          const historyItems = (node.data.history || []).map((item) => item.assetId === asset.id ? { ...item, status: ready ? 'ready' as const : failed ? 'failed' as const : 'processing' as const, url: asset.url || asset.resultUrl, materialId: asset.materialId, errorMessage: failed ? asset.errorMessage || asset.task?.errorMessage || '生成失败' : null, actualCostPoints: ready ? actualCostPoints ?? item.actualCostPoints ?? null : item.actualCostPoints ?? null } : item)
          return { ...node, data: { ...node.data, generation: node.data.generation ? { ...node.data.generation, assetId: asset.id, taskId: asset.task?.id || node.data.generation.taskId } : node.data.generation, contentUrl: ready ? asset.url || asset.resultUrl : node.data.contentUrl, imageUrl: ready && asset.type === 'image' ? asset.url || asset.resultUrl : node.data.imageUrl, videoUrl: ready && asset.type === 'video' ? asset.url || asset.resultUrl : node.data.videoUrl, audioUrl: ready && asset.type === 'audio' ? asset.url || asset.resultUrl : node.data.audioUrl, modelUrl: ready && asset.type === 'model3d' ? asset.url || asset.resultUrl : node.data.modelUrl, posterUrl: ready && asset.type === 'model3d' && asset.params?.thumbnailUrl ? asset.params.thumbnailUrl : node.data.posterUrl, materialId: ready ? asset.materialId : node.data.materialId, sourceMetadata: ready ? asset.materialMetadata || node.data.sourceMetadata : node.data.sourceMetadata, progress, errorMessage: failed ? asset.errorMessage || asset.task?.errorMessage || '生成失败' : null, pollErrorMessage: null, history: historyItems, __server: { ...node.data.__server!, status: ready ? 'SUCCEEDED' : failed ? 'FAILED' : 'RUNNING' } } }
        }))
        // Toolbox workers project terminal state into the canvas node with a
        // task/asset compare-and-swap guard. Polling is intentionally display
        // only: persisting transient read errors (or a locally inferred
        // missing-asset failure) can race and overwrite that server truth.
      } finally {
        polling = false
      }
    }
    const stopPolling = startVisiblePolling(poll, 3_000)
    return () => {
      stopPolling()
      active = false
      for (const controller of controllers) controller.abort()
    }
  }, [projectId, runningSignature])

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const dismissTransientUi = () => {
        setContextMenu(null)
        setWireMenu(null)
        setNodeTypeMenu(null)
        setAddOpen(false)
        setAssetsOpen(false)
        setPickerOpen(false)
        setOrganizeOpen(false)
        setHelpOpen(false)
        setNodes((current) => current.map((node) => node.selected ? { ...node, selected: false } : node))
      }
      // Escape always dismisses canvas chrome, including when a search field in
      // the project-assets surface owns focus. Other input shortcuts stay local.
      if (event.key === 'Escape') {
        if (event.defaultPrevented) {
          const generatorId = nodesRef.current.find((node) => (
            node.selected
            && !node.type?.startsWith('production_')
            && !['group', 'studio_3d', 'playlist', 'video_edit'].includes(node.type || '')
            && !isStoryNodeType(node.type)
          ))?.id
          if (generatorId) {
            setNodes((current) => current.map((node) => ({ ...node, selected: node.id === generatorId })))
          }
          return
        }
        const batchPointer = batchConnectPointerRef.current
        batchConnectPointerRef.current = null
        setBatchDropTargetId(null)
        setNodeDragging(false)
        if (batchPointer && wrapperRef.current?.hasPointerCapture(batchPointer.pointerId)) {
          wrapperRef.current.releasePointerCapture(batchPointer.pointerId)
        }
        flowStore.getState().cancelConnection()
        batchWireSourcesRef.current = []
        connectionActiveRef.current = false
        setMediaPreviewNodeId(null)
        setModelPreviewNodeId(null)
        setPanoramaPreviewNodeId(null)
        dismissTransientUi()
        return
      }
      if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'j' && mode === 'canvas' && !readOnly) {
        event.preventDefault()
        if (!event.repeat) setAgentOpen((value) => !value)
        return
      }
      if (hasInputFocus()) return
      if (['Backspace', 'Delete', 'Enter'].includes(event.key)) {
        const target = event.target instanceof Element ? event.target : null
        const overlayOpen = Boolean(target?.closest('[role="dialog"], [role="menu"], [role="alertdialog"], .fos-overlay, .nori-canvas-generator, .nori-canvas-add-panel'))
          || Boolean(mediaPreviewNodeId || modelPreviewNodeId || panoramaPreviewNodeId || historyNodeId || taskIdInfo || revisionsOpen || confirmOpenRef.current)
        if (overlayOpen || event.repeat) return
        if ((event.key === 'Enter' || event.code === 'Space') && target?.closest('button, a, summary, [role="button"]')) return
      }
      if (event.code === 'Space') {
        // React Flow pans on Space; the custom marquee must never compete with it.
        spacePanActiveRef.current = true
        syncPanCursor()
        if (edgeSelectionGestureRef.current) {
          edgeSelectionGestureRef.current = null
          setMarqueeRect(null)
        }
        return
      }
      const mod = event.metaKey || event.ctrlKey
      if (productionSyncing || offlineRecoveryBlocking) {
        if (shouldBlockCanvasShortcutWhileLocked(event)) event.preventDefault()
        return
      }
      if (mod && event.key.toLowerCase() === 'z') { if (readOnly) return; event.preventDefault(); if (event.shiftKey) redo(); else undo(); return }
      if (mod && event.key.toLowerCase() === 'y') { if (readOnly) return; event.preventDefault(); redo(); return }
      if (mod && event.key.toLowerCase() === 'c') { event.preventDefault(); void copySelection(); return }
      if (mod && event.key.toLowerCase() === 'x') { if (readOnly) return; event.preventDefault(); void copySelection(true); return }
      if (mod && event.key.toLowerCase() === 'v') { if (readOnly) return; event.preventDefault(); event.stopPropagation(); void pasteFromSystem().catch((error: unknown) => setToast(error instanceof Error ? error.message : '粘贴失败')); return }
      if (mod && event.key.toLowerCase() === 'd') { if (readOnly) return; event.preventDefault(); void duplicateNodes(nodesRef.current.filter((node) => node.selected).map((node) => node.id)); return }
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
      if (event.key === 'Enter' && !(event.metaKey || event.ctrlKey) && !event.shiftKey && !readOnly) {
        const selected = nodesRef.current.filter((node) => node.selected)
        if (selected.length === 1 && (selected[0].type === 'text' || selected[0].type === 'note')) {
          event.preventDefault()
          requestTextEdit(selected[0].id)
          return
        }
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
    const keyup = (event: KeyboardEvent) => {
      if (event.code === 'Space') {
        spacePanActiveRef.current = false
        syncPanCursor()
      }
    }
    const clearSpacePan = () => {
      spacePanActiveRef.current = false
      panPointerIdRef.current = null
      panCursorActiveRef.current = false
      syncPanCursor()
    }
    window.addEventListener('keyup', keyup)
    window.addEventListener('blur', clearSpacePan)
    const releasePanPointer = (event: PointerEvent) => {
      // pointercancel does not guarantee button===1, so track the armed pointer
      // id and release on either button match or id match.
      if (event.button !== 1 && event.pointerId !== panPointerIdRef.current) return
      panPointerIdRef.current = null
      panCursorActiveRef.current = false
      syncPanCursor()
    }
    window.addEventListener('pointerup', releasePanPointer)
    window.addEventListener('pointercancel', releasePanPointer)
    return () => {
      window.removeEventListener('keydown', keydown)
      window.removeEventListener('keyup', keyup)
      window.removeEventListener('blur', clearSpacePan)
      window.removeEventListener('pointerup', releasePanPointer)
      window.removeEventListener('pointercancel', releasePanPointer)
    }
  }, [copySelection, duplicateNodes, flow, flowStore, flushAutosave, historyNodeId, mediaPreviewNodeId, modelPreviewNodeId, nudgeSelection, offlineRecoveryBlocking, panoramaPreviewNodeId, pasteFromSystem, productionSyncing, readOnly, redo, removeCurrentSelection, requestTextEdit, revisionsOpen, taskIdInfo, undo])

  const agentBridge = useCanvasAgentBridge({
    projectId, canvasId: initialGraph.canvas.id, mode, readOnly, writeLocked,
    nodesRef, edgesRef, viewportRef, wrapperRef, turn: agentTurn,
    limits: { maxNodes: CANVAS_NODE_HARD_LIMIT, maxEdges: CANVAS_EDGE_HARD_LIMIT },
    centerPosition, commit: commitAgentChange, generate: handleGenerate, runNodeAction, undo,
    history: { getDepth: getHistoryDepth, getLastLabel: getLastHistoryLabel, getHead: getHistoryHead },
    focus: (ids) => fitCanvasView(ids === 'all' ? null : ids, { padding: 0.24, maxZoom: 1, duration: 300 }),
    focusBounds: (bounds) => fitCanvasAgentBounds(flow, wrapperRef.current, bounds),
    flash: (ids, follow) => {
      agentFeedback.flash(ids)
      if (follow && Date.now() - lastManualViewportAt.current >= 3000) {
        followCanvasAgentNodes(flow, wrapperRef.current, viewportRef.current, nodesRef.current, ids)
      }
    },
    select: (ids) => {
      if (readOnly || mode !== 'canvas') return
      const selected = new Set(ids)
      setGeneratorSuppressedNodeId(null)
      const next = nodesRef.current.map((node) => Boolean(node.selected) === selected.has(node.id) ? node : { ...node, selected: selected.has(node.id) })
      nodesRef.current = next
      setNodes(next)
    },
    prepareNodesForWrite: async (ids) => {
      // Each pass respects the existing detail loader and versioned cache.
      for (const id of ids) await prepareNodeForWrite(id)
    },
    readNodeDetails: async (id) => {
      const current = nodesRef.current.find((node) => node.id === id)
      if (!current) throw new Error('NODE_NOT_FOUND')
      return current.data.__canvasUnhydrated ? canvasNodeToFlow(await loadNodeDetail(id, current)) : current
    },
  })

  const handleContextAction = (action: string) => {
    const menu = contextMenu
    setContextMenu(null)
    if (!menu) return
    if (readOnly && action !== 'copy' && action !== 'reset-viewport') return
    if (menu.scope === 'node') {
      if (action === 'copy') { setNodes((current) => current.map((node) => ({ ...node, selected: node.id === menu.nodeId }))); void copySelection(false, [menu.nodeId]) }
      if (action === 'duplicate') void duplicateNodes([menu.nodeId])
      if (action === 'delete') removeNodes([menu.nodeId])
      if (action === 'regenerate') runNodeAction(menu.nodeId, 'regenerate')
      if (action === 'upload-asset-library') setAssetLibraryNodeId(menu.nodeId)
      if (action === 'view-task-id') {
        const target = nodesRef.current.find((node) => node.id === menu.nodeId && getMediaType(node) === 'video')
        if (!target) return
        const generationTaskId = readNodeGenerationTaskId(target)
        if (!generationTaskId) { setToast('该节点没有关联的生成任务记录'); return }
        setTaskIdInfo({ taskId: generationTaskId, title: target.data.title || '未命名视频' })
        return
      }
      if (action === 'grid-split-2' || action === 'grid-split-3' || action === 'grid-split-4') {
        const target = nodesRef.current.find((node) => node.id === menu.nodeId && getMediaType(node) === 'image')
        if (!target) return
        const size = Number(action.slice('grid-split-'.length))
        setImageOperation({ mode: 'grid_split', sourceNodeId: target.id, initialGrid: { rows: size, cols: size } })
        return
      }
      if (action === 'set-global-style' || action === 'clear-global-style') {
        const target = nodesRef.current.find((node) => node.id === menu.nodeId && getMediaType(node) === 'text')
        if (!target) return
        const enabled = action === 'set-global-style'
        setNodes((current) => current.map((node) => {
          // One text node cannot be both roles: it would inject the same text twice into videos.
          if (node.id === target.id) return { ...node, data: { ...node.data, globalStylePrompt: enabled, ...(enabled ? { videoPrefixPrompt: false } : {}) } }
          if (enabled && getMediaType(node) === 'text' && node.data.globalStylePrompt) {
            return { ...node, data: { ...node.data, globalStylePrompt: false } }
          }
          return node
        }))
        markChanged(enabled ? '设置画布全局风格' : '取消画布全局风格')
        setToast(enabled ? '已设为画布全局风格，将注入所有图片/视频提示词' : '已取消画布全局风格')
        return
      }
      if (action === 'set-video-prefix' || action === 'clear-video-prefix') {
        const target = nodesRef.current.find((node) => node.id === menu.nodeId && getMediaType(node) === 'text')
        if (!target) return
        const enabled = action === 'set-video-prefix'
        setNodes((current) => current.map((node) => {
          if (node.id === target.id) return { ...node, data: { ...node.data, videoPrefixPrompt: enabled, ...(enabled ? { globalStylePrompt: false } : {}) } }
          if (enabled && getMediaType(node) === 'text' && node.data.videoPrefixPrompt) {
            return { ...node, data: { ...node.data, videoPrefixPrompt: false } }
          }
          return node
        }))
        markChanged(enabled ? '设置视频统一前置提示词' : '取消视频统一前置提示词')
        setToast(enabled ? '已设为视频统一前置提示词，将置于所有视频提示词最前面' : '已取消视频统一前置提示词')
        return
      }
      return
    }
    if (menu.scope === 'group') {
      if (action === 'copy') {
        setNodes((current) => current.map((node) => ({ ...node, selected: node.id === menu.groupId })))
        void copySelection(false, [menu.groupId])
      }
      if (action === 'duplicate') void duplicateNodes([menu.groupId])
      if (action === 'delete') {
        const group = nodesRef.current.find((node) => node.id === menu.groupId && node.type === 'group')
        const count = group?.data.memberIds?.length || 0
        if (group && !confirmOpenRef.current) {
          confirmOpenRef.current = true
          void confirmAction({
            title: `删除「${group.data.title || '组'}」？`,
            message: `组内 ${count} 个节点会一并删除，删除后可以撤销恢复。`,
            confirmLabel: '删除',
            danger: true,
          }).then((confirmed) => { confirmOpenRef.current = false; if (confirmed) removeGroupsWithMembers([menu.groupId]) })
        }
      }
      return
    }
    if (menu.scope === 'edge' && action === 'delete-edge') { removeEdgesById([menu.edgeId]); return }
    if (menu.scope === 'pane') {
      if (action === 'add-playlist') { addNode('playlist', menu.flowPosition || centerPosition()); return }
      if (action === 'add-node') {
        setContextMenu(null)
        setAssetsOpen(false); setHelpOpen(false); setOrganizeOpen(false); setAddOpen(false)
        setNodeTypeMenu({ ...visibleMenuPoint(menu.x, menu.y, 420), flowPosition: menu.flowPosition || { x: 0, y: 0 } })
        return
      }
      if (action === 'upload') { openUploadPicker(menu.flowPosition); return }
      if (action === 'paste') { void pasteFromSystem(menu.flowPosition).catch((error: unknown) => setToast(error instanceof Error ? error.message : '粘贴失败')); return }
      if (action === 'organize') { if (mode === 'story' && storyCanvas) storyActions.organize(); else organize('horizontal'); return }
      if (action === 'reset-viewport') void flow?.setViewport({ x: 0, y: 0, zoom: 1 }, { duration: 180 })
    }
  }

  const handleWirePick = (type: CanvasNodeMenuType, interaction?: StoryInteractionKind) => {
    if (!wireMenu) return
    if (mode === 'story' && storyActions.pickWireNode(wireMenu, type, interaction)) return
    const created = addNode(type, wireMenu.flowPosition || centerPosition(), interaction)
    if (!created) return
    if (wireMenu.sourceHandle === 'input' || wireMenu.sourceHandle === 'left') {
      connect({ source: created.id, target: wireMenu.sourceNodeId, sourceHandle: 'output', targetHandle: 'input' }, [created])
    } else {
      connect({ source: wireMenu.sourceNodeId, target: created.id, sourceHandle: wireMenu.sourceHandle || 'output', targetHandle: 'input' }, [created])
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

  const projectedNodes = projection.renderNodes as CanvasFlowNode[]
  const flowNodes = useMemo(() => batchDropTargetId || agentTouched.size
    ? projectedNodes.map((node) => node.id === batchDropTargetId || agentTouched.has(node.id)
      ? { ...node, className: `${node.className || ''}${node.id === batchDropTargetId ? ' nori-canvas-batch-connect-target' : ''}${agentTouched.has(node.id) ? ' is-agent-touched' : ''}` } : node)
    : projectedNodes, [agentTouched, batchDropTargetId, projectedNodes])

  const handleConnectStart = useStableCallback<OnConnectStart>((_event, params) => {
    connectionActiveRef.current = true
    edgeSelectionGestureRef.current = null
    const selected = nodesRef.current.filter((node) => node.selected && node.type !== 'group').map((node) => node.id)
    batchWireSourcesRef.current = (params.handleId === 'output' || params.handleId === 'right') && params.nodeId !== null && selected.length > 1 && selected.includes(params.nodeId)
      ? selected : []
  })
  const handleConnectEnd = useStableCallback<OnConnectEnd>((event, state) => {
    connectionActiveRef.current = false
    wireReleaseClickRef.current = true
    const batchSources = batchWireSourcesRef.current
    batchWireSourcesRef.current = []
    const finishConnection = (connection: Connection) => {
      const normalized = normalizeCanvasConnection(connection)
      if (normalized && batchSources.length > 1) connectBatch(batchSources, normalized.target)
      else connect(connection)
    }
    if (writeLocked || state.isValid || !state.fromNode) return
    const point = 'clientX' in event ? { x: event.clientX, y: event.clientY } : { x: event.changedTouches[0]?.clientX || 0, y: event.changedTouches[0]?.clientY || 0 }
    if (mode === 'story' && storyActions.finishWire(state.fromNode.id, state.fromHandle?.id, point)) return
    if (state.toHandle) return
    if (state.toNode) {
      const sourceHandle = state.fromHandle?.id || 'output'
      const targetHandle = sourceHandle === 'input' || sourceHandle === 'left' ? 'output' : 'input'
      finishConnection({ source: state.fromNode.id, target: state.toNode.id, sourceHandle, targetHandle })
      return
    }
    const wrapper = wrapperRef.current
    if (wrapper) {
      const flowPoint = clientToFlowPoint(wrapper, point.x, point.y, viewportRef.current)
      const areaTargetId = findCanvasTargetNodeIdAtPoint({
        nodes: Array.from(flowStore.getState().nodeLookup.values()),
        point: flowPoint,
        excludeNodeId: state.fromNode.id,
      })
      if (areaTargetId) {
        const sourceHandle = state.fromHandle?.id || 'output'
        const targetHandle = sourceHandle === 'input' || sourceHandle === 'left' ? 'output' : 'input'
        finishConnection({ source: state.fromNode.id, target: areaTargetId, sourceHandle, targetHandle })
        return
      }
    }
    setWireMenu({ ...visibleMenuPoint(point.x, point.y, 210), flowPosition: screenToCanvasPosition(point), sourceNodeId: state.fromNode.id, sourceHandle: state.fromHandle?.id || null })
  })
  const handleMoveStart = useStableCallback<OnMove>((event) => {
    if (event) lastManualViewportAt.current = Date.now()
    setNodeTypeMenu(null)
    viewportMoveStartRef.current = { ...viewportRef.current }
  })
  const handleMove = useStableCallback<OnMove>((_event, next) => {
    if (next.zoom !== viewportRef.current.zoom) projection.setViewportZooming(true)
    viewportRef.current = next
  })
  const handleMoveEnd = useStableCallback<OnMove>((_event, next) => {
    const previous = viewportMoveStartRef.current
    const changed = Math.abs(previous.x - next.x) > 0.001
      || Math.abs(previous.y - next.y) > 0.001
      || Math.abs(previous.zoom - next.zoom) > 0.0001
    setViewportState(next)
    viewportRef.current = next
    projection.setViewportZooming(false)
    if (!writeLocked && changed) markChanged('调整画布视图', { viewportOnly: true })
  })
  // In overview mode nodes are painted on a canvas layer, so a click on one lands on the pane and is resolved from the index.
  const overviewNodeAt = (event: { clientX: number; clientY: number }) => {
    const engine = getProjectionEngine()
    const wrapper = wrapperRef.current
    if (!engine || engine.renderMode !== 'overview' || !wrapper) return null
    const point = clientToFlowPoint(wrapper, event.clientX, event.clientY, viewportRef.current)
    const id = engine.index.hitTestNode(point.x, point.y)
    return id && engine.index.nodeBox(id)?.type !== 'group' ? id : null
  }
  const handlePaneClick = useStableCallback((event: React.MouseEvent) => {
    if (wireReleaseClickRef.current) {
      wireReleaseClickRef.current = false
      return
    }
    setAddOpen(false)
    setOrganizeOpen(false)
    setContextMenu(null)
    setWireMenu(null)
    setNodeTypeMenu(null)
    const hitId = overviewNodeAt(event)
    if (!hitId) {
      clearCanvasSelection()
      return
    }
    const additive = event.shiftKey || event.metaKey || event.ctrlKey
    setNodes((current) => current.map((node) => {
      const selected = node.id === hitId ? (additive ? !node.selected : true) : additive && Boolean(node.selected)
      return Boolean(node.selected) === selected ? node : { ...node, selected }
    }))
    if (!additive) {
      const deselectedEdges = edgesRef.current.map((edge) => (edge.selected ? { ...edge, selected: false } : edge))
      edgesRef.current = deselectedEdges
      setEdges(deselectedEdges)
    }
  })
  const handleNodeClick = useStableCallback<NodeMouseHandler<CanvasFlowNode>>((event, node) => {
    if (event.shiftKey || event.metaKey || event.ctrlKey) return
    setAddOpen(false)
    setNodeTypeMenu(null)
    // A double-click on a title or a text body means rename/edit, not "open the generator".
    if (event.detail > 1 && (node.type === 'text' || node.type === 'note' || (event.target instanceof Element && event.target.closest('.nori-canvas-node-drag-handle')))) return
    if (node.type === 'text' || node.type === 'note') {
      setGeneratorSuppressedNodeId(node.id)
      if (event.detail === 1 && document.activeElement instanceof HTMLElement && event.target instanceof Element && event.target.closest('.nori-canvas-text-preview')) document.activeElement.blur()
      const onBody = event.target instanceof Element && event.target.closest('.nori-canvas-text-preview')
      if (soleSelectedNodeIdRef.current === node.id && onBody && event.detail === 1 && !readOnly) requestTextEdit(node.id)
      return
    }
    if (soleSelectedNodeIdRef.current === node.id) setGeneratorSuppressedNodeId((current) => current === node.id ? null : current)
    else setGeneratorSuppressedNodeId(node.id)
  })
  const handlePaneContextMenu = useStableCallback((event: React.MouseEvent | MouseEvent) => { event.preventDefault(); if (shouldSuppressContextMenu()) return; setNodeTypeMenu(null); setClipboardCanPaste(Boolean(clipboardRef.current?.nodes.length)); void refreshClipboardAvailability(); setContextMenu({ scope: 'pane', ...visibleMenuPoint(event.clientX, event.clientY, readOnly ? 50 : 270), flowPosition: screenToCanvasPosition({ x: event.clientX, y: event.clientY }) }) })
  const handleNodeContextMenu = useStableCallback<NodeMouseHandler<CanvasFlowNode>>((event, node) => { event.preventDefault(); if (shouldSuppressContextMenu()) return; setNodeTypeMenu(null); const nodeMenuHeight = 230 + (getMediaType(node) === 'image' ? 118 : getMediaType(node) === 'text' ? 46 : 0); setContextMenu(node.type === 'group' ? { scope: 'group', groupId: node.id, ...visibleMenuPoint(event.clientX, event.clientY, readOnly ? 50 : 145) } : { scope: 'node', nodeId: node.id, ...visibleMenuPoint(event.clientX, event.clientY, readOnly ? 50 : nodeMenuHeight) }) })
  const handleEdgeContextMenu = useStableCallback<EdgeMouseHandler<CanvasFlowEdge>>((event, edge) => { event.preventDefault(); if (!writeLocked) { setNodeTypeMenu(null); setContextMenu({ scope: 'edge', edgeId: edge.id, ...visibleMenuPoint(event.clientX, event.clientY, 50) }) } })

  // Story mode only reaches here through the chapter route; a missing story means broken data.
  if (mode === 'story' && storyLoad.status === 'missing') {
    return (
      <div className="nori-canvas-loading is-error">
        <span>这个章节不属于任何影游</span>
        <Link href={{ pathname: '/interactive' }}>返回影游画布</Link>
      </div>
    )
  }

  return (
    <CanvasEditorProvider value={editorContext} persistence={editorPersistence}>
      <CanvasMultiSelectionProvider value={selectedNodes.length > 1}>
      <StoryCanvasProvider value={storyContextValue}>
      <CanvasNodeSourceProvider source={projectionActive ? nodeSource : null}>
      <div
        className={`nori-canvas-workspace${readOnly ? ' is-readonly' : ''}${productionSyncing ? ' is-syncing' : ''}${layoutAnimating ? ' is-layout-animating' : ''}${nodeDragging ? ' is-node-dragging' : ''}${agentOpen && !readOnly && mode === 'canvas' ? ' has-agent-panel' : ''}`}
        ref={wrapperRef}
        tabIndex={0}
        onPointerDownCapture={(event) => {
          wireReleaseClickRef.current = false
          // Close popover panels when the click lands outside them.
          const target = event.target instanceof Element ? event.target : null
          if (target?.closest('.nori-canvas-agent-panel, .nori-canvas-agent-launcher')) return
          if (nodeTypeMenuRef.current && target && !target.closest('.nori-canvas-wire-menu')) setNodeTypeMenu(null)
          if (addOpenRef.current && target && !target.closest('.nori-canvas-add-panel, .nori-canvas-tool-rail')) setAddOpen(false)
          if (assetsOpenRef.current && target && !target.closest('.nori-canvas-project-assets, .nori-canvas-tool-rail, .nori-canvas-chrome')) setAssetsOpen(false)
          if (helpOpenRef.current && target && !target.closest('.nori-canvas-help-panel, .nori-canvas-tool-rail')) setHelpOpen(false)
          if (startMiniMapDrag(event)) return
          if (event.button === 1 && !hasInputFocus()) {
            panPointerIdRef.current = event.pointerId
            panCursorActiveRef.current = true
            syncPanCursor()
          }
          if (event.button === 2) {
            // Suppression belongs to the previous drag, never to a fresh click.
            suppressContextMenuUntilRef.current = 0
            rightPanGestureRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, moved: false }
            return
          }
          if (
            event.button === 0
            && !writeLocked
            && !spacePanActiveRef.current
            && !connectionActiveRef.current
            && isCanvasBlankPointerTarget(event.target)
          ) {
            const wrapper = wrapperRef.current
            edgeSelectionGestureRef.current = {
              pointerId: event.pointerId,
              start: { x: event.clientX, y: event.clientY },
              additive: event.shiftKey || event.metaKey || event.ctrlKey,
            }
            if (wrapper) {
              const startLayout = wrapperLayoutPoint(wrapper, event.clientX, event.clientY)
              setMarqueeRect({ x: startLayout.x, y: startLayout.y, width: 0, height: 0 })
            }
            try {
              event.currentTarget.setPointerCapture(event.pointerId)
            } catch {
              // Pointer capture can be unavailable during synthetic events.
            }
          }
        }}
        onPointerMoveCapture={(event) => {
          const batchPointer = batchConnectPointerRef.current
          if (batchPointer?.pointerId === event.pointerId) {
            setBatchDropTargetId(batchConnectionTargetAtPoint(event, batchPointer.sourceIds, false))
            event.preventDefault()
            event.stopPropagation()
            return
          }
          if (moveMiniMapDrag(event)) return
          const edgeSelection = edgeSelectionGestureRef.current
          if (edgeSelection?.pointerId === event.pointerId && wrapperRef.current && !spacePanActiveRef.current) {
            const wrapper = wrapperRef.current
            const start = wrapperLayoutPoint(wrapper, edgeSelection.start.x, edgeSelection.start.y)
            const current = wrapperLayoutPoint(wrapper, event.clientX, event.clientY)
            setMarqueeRect(normalizedMarqueeRect(start, current))
          }
          const gesture = rightPanGestureRef.current
          if (!gesture || gesture.pointerId !== event.pointerId || gesture.moved) return
          gesture.moved = Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 8
          if (gesture.moved) { setContextMenu(null); setWireMenu(null) }
        }}
        onPointerUpCapture={(event) => {
          const batchPointer = batchConnectPointerRef.current
          if (batchPointer?.pointerId === event.pointerId) {
            const targetId = batchConnectionTargetAtPoint(event, batchPointer.sourceIds, false)
            batchConnectPointerRef.current = null
            setBatchDropTargetId(null)
            setNodeDragging(false)
            if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
            if (targetId) connectBatch(batchPointer.sourceIds.filter((id) => id !== targetId), targetId)
            event.preventDefault()
            event.stopPropagation()
            return
          }
          if (finishMiniMapDrag(event.pointerId)) {
            event.preventDefault()
            event.stopPropagation()
            return
          }
          const edgeSelection = edgeSelectionGestureRef.current
          if (edgeSelection?.pointerId === event.pointerId) {
            edgeSelectionGestureRef.current = null
            setMarqueeRect(null)
            const wrapper = wrapperRef.current
            if (wrapper?.hasPointerCapture(event.pointerId)) {
              wrapper.releasePointerCapture(event.pointerId)
            }
            if (spacePanActiveRef.current) return
            if (Math.hypot(event.clientX - edgeSelection.start.x, event.clientY - edgeSelection.start.y) > 5) {
              const end = { x: event.clientX, y: event.clientY }
              window.requestAnimationFrame(() => selectElementsCoveredByRect(edgeSelection.start, end, edgeSelection.additive))
            } else if (!edgeSelection.additive) {
              clearCanvasSelection()
            }
          }
          const gesture = rightPanGestureRef.current
          if (!gesture || gesture.pointerId !== event.pointerId) return
          if (gesture.moved) suppressContextMenuUntilRef.current = Date.now() + 250
          rightPanGestureRef.current = null
        }}
        onPointerCancelCapture={(event) => {
          batchConnectPointerRef.current = null
          batchNodeDragRef.current = null
          setBatchDropTargetId(null)
          setNodeDragging(false)
          finishMiniMapDrag(event.pointerId)
          rightPanGestureRef.current = null
          edgeSelectionGestureRef.current = null
          setMarqueeRect(null)
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId)
          }
        }}
        onLostPointerCapture={(event) => { batchConnectPointerRef.current = null; setBatchDropTargetId(null); setNodeDragging(false); finishMiniMapDrag(event.pointerId) }}
        onPointerDown={(event) => { if (event.button === 0) { setContextMenu(null); setWireMenu(null) } }}
        onContextMenuCapture={(event) => {
          const target = event.target
          if (!(target instanceof Element)) return
          const insideFlow = Boolean(target.closest('.react-flow'))
          if (target.closest('.nori-canvas-generator') || (insideFlow && isTextEntryTarget(target))) {
            // Keep the caret and the native Cut/Copy/Paste menu; the custom menu would blur the editor and end edit mode.
            event.stopPropagation()
            setContextMenu(null)
            setWireMenu(null)
            return
          }
          if (!insideFlow) return
          event.preventDefault()
          event.stopPropagation()
          if (shouldSuppressContextMenu()) return
          setWireMenu(null)
          const nodeId = target.closest('.react-flow__node')?.getAttribute('data-id')
          const node = nodesRef.current.find((item) => item.id === nodeId)
          if (node) {
            const nodeMenuHeight = 230 + (getMediaType(node) === 'image' ? 118 : getMediaType(node) === 'text' ? 46 : 0)
            setContextMenu(node.type === 'group'
              ? { scope: 'group', groupId: node.id, ...visibleMenuPoint(event.clientX, event.clientY, 145) }
              : { scope: 'node', nodeId: node.id, ...visibleMenuPoint(event.clientX, event.clientY, nodeMenuHeight) })
            return
          }
          const edgeId = target.closest('.react-flow__edge')?.getAttribute('data-id')
          if (edgeId && !writeLocked) {
            setContextMenu({ scope: 'edge', edgeId, ...visibleMenuPoint(event.clientX, event.clientY, 50) })
            return
          }
          setClipboardCanPaste(Boolean(clipboardRef.current?.nodes.length))
          void refreshClipboardAvailability()
          setContextMenu({ scope: 'pane', ...visibleMenuPoint(event.clientX, event.clientY, readOnly ? 50 : 270), flowPosition: screenToCanvasPosition({ x: event.clientX, y: event.clientY }) })
        }}
        onDoubleClick={(event) => {
          if (!(event.target as HTMLElement).classList.contains('react-flow__pane')) return
          const overviewId = overviewNodeAt(event)
          if (overviewId) { fitCanvasView([overviewId], { padding: 0.6, maxZoom: 1, duration: 260 }); return }
          if (!writeLocked) addNode('text', screenToCanvasPosition({ x: event.clientX, y: event.clientY }))
        }}
        onDragOver={(event) => { if (!writeLocked && (event.dataTransfer.types.includes(CANVAS_MATERIAL_DRAG_TYPE) || event.dataTransfer.types.includes(CANVAS_MATERIAL_COLLECTION_DRAG_TYPE) || event.dataTransfer.types.includes(CANVAS_WORKFLOW_DRAG_TYPE) || event.dataTransfer.types.includes('Files'))) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy' } }}
        onDrop={(event) => {
          if (writeLocked) return
          const workflowRaw = event.dataTransfer.getData(CANVAS_WORKFLOW_DRAG_TYPE)
          if (workflowRaw) {
            event.preventDefault()
            try {
              insertWorkflow(JSON.parse(workflowRaw) as CanvasWorkflowTemplate, screenToCanvasPosition({ x: event.clientX, y: event.clientY }))
            } catch {
              setToast('无法读取拖拽的工作流模板')
            }
            return
          }
          const collectionRaw = event.dataTransfer.getData(CANVAS_MATERIAL_COLLECTION_DRAG_TYPE)
          if (collectionRaw) {
            event.preventDefault()
            try {
              const collection = JSON.parse(collectionRaw) as FrameosMaterialItem[]
              if (!Array.isArray(collection) || collection.length === 0) throw new Error('invalid collection')
              handleMaterialCollectionDrop(collection, screenToCanvasPosition({ x: event.clientX, y: event.clientY }))
            } catch {
              setToast('无法读取批量拖拽的作品资产')
            }
            return
          }
          const raw = event.dataTransfer.getData(CANVAS_MATERIAL_DRAG_TYPE)
          if (!raw && event.dataTransfer.files.length > 0) {
            event.preventDefault()
            const position = screenToCanvasPosition({ x: event.clientX, y: event.clientY })
            void handleUploads(event.dataTransfer.files, position).catch((error: unknown) => setToast(error instanceof Error ? error.message : '上传失败'))
            return
          }
          if (!raw) return
          event.preventDefault()
          try {
            const material = JSON.parse(raw) as FrameosMaterialItem
            if (!['image', 'video', 'audio', 'model3d'].includes(material.type)) throw new Error('invalid material')
            handleMaterialCollectionDrop([material], screenToCanvasPosition({ x: event.clientX, y: event.clientY }))
          } catch {
            setToast('无法读取拖拽的作品资产')
          }
        }}
      >
        <div className="nori-canvas-surface">
          <ReactFlow<CanvasFlowNode, CanvasFlowEdge>
            nodes={flowNodes}
            edges={projection.renderEdges as CanvasFlowEdge[]}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onInit={setFlow}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={connectGesture}
            connectOnClick={false}
            connectionLineComponent={CanvasConnectionLine}
            onConnectStart={handleConnectStart}
            isValidConnection={validateGestureConnection}
            onConnectEnd={handleConnectEnd}
            onNodeDragStart={onNodeDragStart}
            onNodeDrag={onNodeDrag}
            onNodeDragStop={onNodeDragStop}
            onSelectionDragStart={onSelectionDragStart}
            onSelectionDrag={onSelectionDrag}
            onSelectionDragStop={onSelectionDragStop}
            onMoveStart={handleMoveStart}
            onMove={handleMove}
            onMoveEnd={handleMoveEnd}
            onPaneClick={handlePaneClick}
            onNodeClick={handleNodeClick}
            onPaneContextMenu={handlePaneContextMenu}
            onNodeContextMenu={handleNodeContextMenu}
            onEdgeContextMenu={handleEdgeContextMenu}
            defaultViewport={defaultViewportRef.current}
            minZoom={0.15}
            maxZoom={5}
            connectionMode={ConnectionMode.Loose}
            connectionRadius={64}
            reconnectRadius={64}
            nodesDraggable={!writeLocked}
            nodesConnectable={!writeLocked}
            selectNodesOnDrag={false}
            selectionOnDrag={false}
            selectionKeyCode="Shift"
            selectionMode={SelectionMode.Partial}
            paneClickDistance={8}
            panOnDrag={FLOW_PAN_ON_DRAG}
            onlyRenderVisibleElements={!projectionActive && nodes.length > FLOW_VISIBLE_ONLY_NODE_THRESHOLD}
            panActivationKeyCode="Space"
            zoomOnScroll
            zoomOnPinch
            multiSelectionKeyCode={FLOW_MULTI_SELECTION_KEYS}
            deleteKeyCode={null}
            proOptions={FLOW_PRO_OPTIONS}
            colorMode={resolvedTheme}
          >
            <Background id="minor-grid" color={themeColors.background} gap={24} size={1} />
            {mode === 'canvas' && !readOnly && <CanvasAgentGhostSlot feedback={agentFeedback} />}
            {projectionActive ? (
              <CanvasOverviewLayer
                store={projection.overviewStore}
                flowStore={flowStore}
                getTitle={overviewTitleOf}
                edgeColor={themeColors.edge}
                selectedColor={resolvedTheme === 'light' ? '#5b67f5' : '#b8c8ff'}
                labelColor={resolvedTheme === 'light' ? 'rgba(40, 46, 80, .72)' : 'rgba(220, 226, 255, .72)'}
              />
            ) : null}
            {minimapVisible && projectionActive ? (
              <CanvasProjectedMinimap
                getEngine={getProjectionEngine}
                store={projection.overviewStore}
                flowStore={flowStore}
                nodeStroke={themeColors.minimapStroke}
                selectedStroke={resolvedTheme === 'light' ? '#5b67f5' : '#b8c8ff'}
                maskColor={themeColors.minimapMask}
                maskStroke={themeColors.minimapMaskStroke}
                ariaLabel="画布小地图：拖动蓝色视口可快速定位节点"
                onZoom={(factor) => void flow?.zoomTo(viewportRef.current.zoom * factor)}
              />
            ) : null}
            {minimapVisible && !projectionActive ? <MiniMap<CanvasFlowNode>
              position="bottom-left"
              pannable={false}
              zoomable
              zoomStep={8}
              offsetScale={8}
              ariaLabel="画布小地图：拖动蓝色视口可快速定位节点"
              className="nori-canvas-minimap"
              nodeColor={minimapNodeColor}
              nodeStrokeColor={(node) => node.selected ? (resolvedTheme === 'light' ? '#5b67f5' : '#b8c8ff') : themeColors.minimapStroke}
              nodeStrokeWidth={3}
              maskColor={themeColors.minimapMask}
              maskStrokeColor={themeColors.minimapMaskStroke}
              maskStrokeWidth={2}
            /> : null}
          </ReactFlow>
          {marqueeRect ? (
            <div
              className="nori-canvas-marquee"
              style={{
                left: marqueeRect.x,
                top: marqueeRect.y,
                width: marqueeRect.width,
                height: marqueeRect.height,
              }}
            />
          ) : null}
        </div>
        {productionSyncing ? <div className="nori-canvas-sync-lock" role="status" aria-live="polite"><span><i />正在同步项目内容，请稍候…</span></div> : null}
        {autosave.offlineRecoveryState === 'loading' ? <div className="nori-canvas-sync-lock" role="status" aria-live="polite"><span><i />正在检查本地未同步版本…</span></div> : null}

        <CanvasChrome projectId={projectId} projectName={projectName} canvases={canvases} activeCanvas={{ ...(canvases.find((canvas) => canvas.id === canvasRef.current.id) || canvasRef.current), nodeCount: nodes.length }} saveState={autosave.saveState} canUndo={canUndo} canRedo={canRedo} onSelectCanvas={onSelectCanvas} onCreateCanvas={onCreateCanvas} onRenameCanvas={onRenameCanvas} onDeleteCanvas={onDeleteCanvas} projectOptions={projectOptions} storyNavigation={storyNavigation} parentProjectId={parentProjectId} parentProjectName={parentProjectName} onSelectProject={onSelectProject} canvasHomeHref={canvasHomeHref} createProjectHref={createProjectHref} onUndo={undo} onRedo={redo} onRetrySave={autosave.retry} onOpenRevisions={openRevisions} syncingProduction={productionSyncing} canSyncProduction={!readOnly} readOnly={readOnly} onOpenProjectAssets={() => { setAddOpen(false); setHelpOpen(false); setOrganizeOpen(false); setAssetsOpen(true) }} onSyncProduction={() => void syncProduction()} />

        <CanvasToolRail editable={!readOnly} addOpen={addOpen} assetsOpen={assetsOpen} onToggleAdd={() => { pendingInsertPositionRef.current = null; setAssetsOpen(false); setHelpOpen(false); setOrganizeOpen(false); setAddOpen((value) => !value) }} onToggleAssets={() => { pendingInsertPositionRef.current = null; setAddOpen(false); setHelpOpen(false); setOrganizeOpen(false); setAssetsOpen((value) => !value) }} onOpenLibrary={() => setPickerOpen(true)} onUpload={() => openUploadPicker()} onHelp={() => { setAddOpen(false); setAssetsOpen(false); setOrganizeOpen(false); setHelpOpen((value) => !value) }} />
        {!readOnly && addOpen ? <CanvasAddPanel storyItems={mode === 'story' && storyCanvas ? STORY_ADD_NODE_ITEMS : undefined} interactionItems={mode === 'story' && storyCanvas ? STORY_INTERACTION_ADD_ITEMS : undefined} onAddNode={(type, interaction) => { const position = pendingInsertPositionRef.current || undefined; pendingInsertPositionRef.current = null; addNode(type, position, interaction) }} onUpload={() => { const position = pendingInsertPositionRef.current || undefined; pendingInsertPositionRef.current = null; openUploadPicker(position) }} /> : null}
        {!readOnly && assetsOpen ? <CanvasProjectAssets projectId={projectId} onInsert={insertMaterial} onInsertWorkflow={insertWorkflow} onClose={() => setAssetsOpen(false)} refreshKey={workflowRefreshKey} /> : null}
        <CanvasViewportControls minimapVisible={minimapVisible} zoom={viewport.zoom} organizeMode={organizeMode} organizeOpen={organizeOpen} canOrganize={!readOnly} storyOrganize={mode === 'story' && storyCanvas ? storyActions.organize : undefined} onToggleMinimap={() => setMinimapVisible((value) => !value)} onZoomIn={() => void flow?.zoomIn({ duration: 120 })} onZoomOut={() => void flow?.zoomOut({ duration: 120 })} onFitView={() => fitCanvasView(null, { padding: 0.18, duration: 250 })} onResetViewport={() => void flow?.setViewport({ x: 0, y: 0, zoom: 1 }, { duration: 180 })} onToggleOrganize={() => { setAddOpen(false); setAssetsOpen(false); setHelpOpen(false); setOrganizeOpen((value) => !value) }} onOrganize={organize} />
        {projectionActive ? (
          <CanvasFoldedEdgesEntry
            store={projection.overviewStore}
            describe={projection.describeFoldedEdges}
            onLocate={locateFoldedEdge}
            onDisconnect={writeLocked ? undefined : (edge) => removeEdgesById([edge.id])}
            aboveMinimap={minimapVisible}
          />
        ) : null}
        {nodes.length === 0 ? <CanvasEmptyState readOnly={readOnly} onAdd={(type) => addNode(type)} onUpload={() => openUploadPicker()} /> : null}
        {helpOpen ? <CanvasHelpPanel onClose={() => setHelpOpen(false)} /> : null}
        {mode === 'canvas' && !readOnly && <CanvasAgentDock bridge={agentBridge} title={canvasRef.current.title} open={agentOpen} onOpenChange={setAgentOpen} feedback={agentFeedback} />}
        {(selectedNodes.length > 1 || selectedEdges.length > 0) && !readOnly ? <div className="nori-canvas-selection-toolbar">{selectedNodes.length > 1 ? <>
          <button type="button" className="nori-canvas-batch-connect-handle is-primary" disabled={writeLocked} aria-label="拖到目标节点批量连接" title="按住拖到目标节点；也可直接拖动已选节点。Esc 取消"
            onPointerDown={(event) => {
              if (writeLocked || event.button !== 0) return
              const sourceIds = nodesRef.current.filter((node) => node.selected && node.type !== 'group').map((node) => node.id)
              if (sourceIds.length < 2) return
              batchConnectPointerRef.current = { pointerId: event.pointerId, sourceIds }
              setBatchDropTargetId(null)
              setNodeDragging(true)
              wrapperRef.current?.setPointerCapture(event.pointerId)
              event.preventDefault()
              event.stopPropagation()
            }}>拖拽批量连接</button>
          <button type="button" disabled={selectionDownloadNodes.length === 0} title={selectionDownloadNodes.length > 0 ? `打包下载选中的 ${selectionDownloadNodes.length} 个节点内容` : '选中的节点暂无可下载内容'} onClick={() => downloadCanvasNodes(selectionDownloadNodes, '画布批量下载')}>下载</button>
          <button type="button" onClick={createGroup}>成组</button><button type="button" className="is-primary" onClick={() => organizeSelection('vertical')}>纵向整理</button><button type="button" onClick={() => organizeSelection('horizontal')}>横向排列</button></> : null}<button type="button" className="is-danger" onClick={removeCurrentSelection}>删除选中{selectedEdges.length ? `连线 ${selectedEdges.length}` : ''}</button></div> : null}
        {!readOnly ? renderGenerator() : null}
        {contextMenu ? <CanvasContextMenu state={contextMenu} canPaste={!readOnly && clipboardCanPaste} canRegenerate={!readOnly && canRegenerateContextNode} canUploadToAssetLibrary={canUploadToAssetLibrary} nodeMediaType={contextNode ? getMediaType(contextNode) : null} isGlobalStylePrompt={contextNode?.data.globalStylePrompt === true} isVideoPrefixPrompt={contextNode?.data.videoPrefixPrompt === true} readOnly={readOnly} onAction={handleContextAction} /> : null}
        <CanvasViewportLayer>
        {!readOnly && assetLibraryNode ? <CanvasAssetLibraryDialog initialTitle={assetLibraryNode.data.title || '画布素材'} imageUrl={toDisplayImageUrl(assetLibraryNode.data.contentUrl || assetLibraryNode.data.imageUrl || assetLibraryNode.data.posterUrl || null)} onConfirm={(input) => uploadNodeToAssetLibrary(assetLibraryNode.id, input)} onClose={() => setAssetLibraryNodeId(null)} /> : null}
        {!readOnly && wireMenu ? (wireMenu.story && wireMenu.story !== 'media'
          ? <StoryWireMenu state={wireMenu} onPick={handleWirePick} />
          : <CanvasWireMenu state={wireMenu} items={wireMenu.story === 'media' ? (mode === 'story' ? MEDIA_WIRE_MENU_ITEMS : CANVAS_ADD_NODE_ITEMS) : undefined} onPick={handleWirePick} />) : null}
        {nodeTypeMenu ? <CanvasNodeTypeMenu state={nodeTypeMenu} storyMode={mode === 'story' && Boolean(storyCanvas)} onDismiss={() => setNodeTypeMenu(null)} onPick={(type, interaction) => { addNode(type, nodeTypeMenu.flowPosition, interaction); setNodeTypeMenu(null) }} onUpload={() => { openUploadPicker(nodeTypeMenu.flowPosition); setNodeTypeMenu(null) }} /> : null}
        {historyNode ? <CanvasHistoryDialog node={historyNode} projectId={projectId} canvasId={initialGraph.canvas.id} onDemand={summaryMode} canUse={!readOnly} onClose={() => setHistoryNodeId(null)} onUse={(item) => {
          void prepareNodeForWrite(historyNode.id).then(() => {
            const type = getMediaType(historyNode)
            updateNodeData(historyNode.id, { text: type === 'text' && typeof item.text === 'string' ? item.text : historyNode.data.text, ...(type === 'text' ? { textMarks: undefined } : {}), contentUrl: type === 'text' ? historyNode.data.contentUrl : item.url, imageUrl: type === 'image' ? item.url : historyNode.data.imageUrl, videoUrl: type === 'video' ? item.url : historyNode.data.videoUrl, audioUrl: type === 'audio' ? item.url : historyNode.data.audioUrl, materialId: type === 'text' ? historyNode.data.materialId : item.materialId || historyNode.data.materialId }, '选用历史版本')
            setHistoryNodeId(null)
          }).catch((error: unknown) => setToast(error instanceof Error ? error.message : '节点详情加载失败'))
        }} /> : null}
        {revisionsOpen ? <CanvasRevisionDialog revisions={revisions} currentRevision={canvasRef.current.revision} loading={revisionsLoading} restoringId={restoringRevisionId} canRestore={!readOnly} error={revisionsError} onReload={() => void loadRevisions()} onRestore={(revision) => void restoreRevision(revision)} onClose={() => { if (!restoringRevisionId) setRevisionsOpen(false) }} /> : null}
        {taskIdInfo ? <CanvasTaskIdDialog taskId={taskIdInfo.taskId} title={taskIdInfo.title} onClose={() => setTaskIdInfo(null)} /> : null}
        {!readOnly && imageOperation ? (() => { const node = nodes.find((item) => item.id === imageOperation.sourceNodeId); return node ? <CanvasImageOperationDialog projectId={projectId} canvasId={initialGraph.canvas.id} mode={imageOperation.mode} node={node} initialGrid={imageOperation.initialGrid} onSubmit={handleImageOperation} onRecover={applyImageOperationResults} isTaskMaterialized={isOperationTaskMaterialized} onClose={() => setImageOperation(null)} /> : null })() : null}
        {!readOnly && videoOperation ? (() => { const node = nodes.find((item) => item.id === videoOperation.sourceNodeId); return node ? <CanvasVideoOperationDialog projectId={projectId} canvasId={initialGraph.canvas.id} mode={videoOperation.mode} node={node} onSubmit={handleVideoOperation} onRecover={applyVideoOperationResults} isTaskMaterialized={isOperationTaskMaterialized} onClose={() => setVideoOperation(null)} /> : null })() : null}
        {mediaPreviewNode ? <CanvasMediaPreviewDialog node={mediaPreviewNode} readOnly={readOnly} onCaptureFrame={handleVideoFrameCapture} onKeyframesChange={(keyframes, source) => updateNodeData(source.id, { videoKeyframes: keyframes }, '更新视频关键帧')} onPromptSave={readOnly ? undefined : (prompt, source) => updateNodeData(source.id, { prompt }, '修改提示词')} onPromptRegenerate={readOnly ? undefined : async (prompt, source) => {
          updateNodeData(source.id, { prompt }, '修改提示词')
          await regenerateNode(source.id, prompt)
          setMediaPreviewNodeId(null)
          setToast('已提交重新生成，完成后可在节点的历史版本里对比')
        }} onClose={() => setMediaPreviewNodeId(null)} /> : null}
        {modelPreviewNode?.data.modelUrl ? <CanvasModel3DDialog src={toDisplayImageUrl(modelPreviewNode.data.modelUrl) || modelPreviewNode.data.modelUrl} title={modelPreviewNode.data.title || '3D 模型'} onClose={() => setModelPreviewNodeId(null)} /> : null}
        {panoramaPreviewNode && (panoramaPreviewNode.data.contentUrl || panoramaPreviewNode.data.imageUrl) ? <CanvasPanoramaDialog src={toDisplayImageUrl(panoramaPreviewNode.data.contentUrl || panoramaPreviewNode.data.imageUrl) || panoramaPreviewNode.data.contentUrl || panoramaPreviewNode.data.imageUrl || ''} title={panoramaPreviewNode.data.title || '720 全景图'} readOnly={readOnly} onCapture={handlePanoramaCapture} onClose={() => setPanoramaPreviewNodeId(null)} /> : null}
        {studioNode ? <CanvasStudio3DDialog projectId={projectId} canvasId={initialGraph.canvas.id} node={studioNode} incomingNodes={studioIncomingNodes} readOnly={readOnly} onSummaryChange={handleStudioSummaryChange} onStageCaptures={handleStudioStageCaptures} onSendCaptures={handleStudioCapture} onClose={() => setStudioNodeId(null)} /> : null}
        {!readOnly && workflowGroupId ? <CanvasWorkflowDialog initialName={`${nodes.find((node) => node.id === workflowGroupId)?.data.title || '工作流'} 模板`} onConfirm={saveWorkflow} onClose={() => setWorkflowGroupId(null)} /> : null}
        {!readOnly && imageEditNodeId ? (() => { const node = nodes.find((item) => item.id === imageEditNodeId); return node ? <CanvasImageEditDialog node={node} onSubmit={handleImageEdit} onClose={() => setImageEditNodeId(null)} /> : null })() : null}
        {!readOnly && pickerOpen ? <MaterialPickerDialog projectId={projectId} uploadEndpoint={`/api/projects/${projectId}/canvas/${initialGraph.canvas.id}/materials`} allowAllTypes multiple maxSelected={100} title="从素材库选择" confirmLabel="添加到画布并关闭" onConfirm={(materials) => { const anchor = centerPosition(); const columns = Math.max(1, Math.ceil(Math.sqrt(materials.length))); insertMaterials(materials.map((material, index) => ({ material, position: { x: anchor.x + (index % columns) * 360, y: anchor.y + Math.floor(index / columns) * 290 } }))); setPickerOpen(false) }} onClose={() => setPickerOpen(false)} /> : null}
        {!readOnly && generatorReferencePicker ? (generatorReferencePicker.type === 'all'
          ? <MaterialPickerDialog projectId={projectId} uploadEndpoint={`/api/projects/${projectId}/canvas/${initialGraph.canvas.id}/materials`} allowAllTypes multiple maxSelected={generatorReferencePicker.maxSelected} title="选择引用素材" confirmLabel="添加引用" onConfirm={addGeneratorReferenceMaterials} onClose={() => setGeneratorReferencePicker(null)} />
          : <MaterialPickerDialog projectId={projectId} uploadEndpoint={`/api/projects/${projectId}/canvas/${initialGraph.canvas.id}/materials`} type={generatorReferencePicker.type} multiple maxSelected={generatorReferencePicker.maxSelected} title="选择引用素材" confirmLabel="添加引用" onConfirm={addGeneratorReferenceMaterials} onClose={() => setGeneratorReferencePicker(null)} />) : null}
        {videoEditMaterialNodeId ? <MaterialPickerDialog projectId={projectId} uploadEndpoint={`/api/projects/${projectId}/canvas/${initialGraph.canvas.id}/materials`} type="video" multiple={false} maxSelected={1} title="选择源视频" confirmLabel="使用该视频" onConfirm={(materials) => {
          const material = materials[0]
          const node = nodesRef.current.find((item) => item.id === videoEditMaterialNodeId && item.type === 'video_edit')
          if (material && node) {
            const removedEdges = edgesRef.current.filter((edge) => edge.target === node.id)
            if (removedEdges.length > 0) {
              edgesRef.current = edgesRef.current.filter((edge) => edge.target !== node.id)
              setEdges(edgesRef.current)
              cleanupDisconnectedReferences(removedEdges, edgesRef.current)
            }
            updateNodeData(node.id, {
              videoUrl: material.url,
              contentUrl: material.url,
              materialId: material.id,
              videoEdit: {
                ...(node.data.videoEdit || {}),
                sourceKind: 'material',
                sourceNodeId: null,
                materialId: material.id,
              },
            })
            markChanged('选择视频编辑源视频')
          }
          setVideoEditMaterialNodeId(null)
        }} onClose={() => setVideoEditMaterialNodeId(null)} /> : null}
        {videoEditReferencePicker ? <MaterialPickerDialog projectId={projectId} uploadEndpoint={`/api/projects/${projectId}/canvas/${initialGraph.canvas.id}/materials`} type={videoEditReferencePicker.type} multiple maxSelected={videoEditReferencePicker.type === 'image' ? 30 : 10} title={videoEditReferencePicker.type === 'image' ? '选择参考图片' : '选择参考音频'} confirmLabel="添加参考素材" onConfirm={(materials) => {
          const node = nodesRef.current.find((item) => item.id === videoEditReferencePicker.nodeId && item.type === 'video_edit')
          if (node && materials.length > 0) {
            const current = Array.isArray(node.data.videoEdit?.references) ? node.data.videoEdit.references : []
            const currentEdit = node.data.videoEdit || { sourceKind: 'none' as const, generateAudio: true }
            const additions = materials.map((material) => ({
              id: material.id,
              title: material.title || (videoEditReferencePicker.type === 'image' ? '参考图片' : '参考音频'),
              type: videoEditReferencePicker.type,
              previewUrl: material.url,
              url: material.url,
              materialId: material.id,
            }))
            updateNodeData(node.id, {
              videoEdit: {
                ...currentEdit,
                references: [
                  ...current.filter((item) => !additions.some((addition) => addition.id === item.id)),
                  ...additions,
                ],
              },
            })
          }
          setVideoEditReferencePicker(null)
        }} onClose={() => setVideoEditReferencePicker(null)} /> : null}
        {!readOnly && autosave.conflictOpen ? <CanvasConflictDialog loading={conflictLoading} onLoadServer={() => { setConflictLoading(true); void autosave.loadServerVersion().finally(() => setConflictLoading(false)) }} onMerge={() => { setConflictLoading(true); void autosave.mergeServerVersion().finally(() => setConflictLoading(false)) }} /> : null}
        {!readOnly && autosave.offlineRecoveryState === 'pending' && autosave.offlineDraft ? <CanvasOfflineRecoveryDialog draft={autosave.offlineDraft} serverRevision={autosave.revision.current} loading={offlineRecoveryLoading} onUseServer={() => { setOfflineRecoveryLoading(true); void autosave.useServerVersion().finally(() => setOfflineRecoveryLoading(false)) }} onRestoreLocal={() => { setOfflineRecoveryLoading(true); void autosave.restoreLocalVersion().catch((error: unknown) => setToast(error instanceof Error ? error.message : '恢复本地画布失败')).finally(() => setOfflineRecoveryLoading(false)) }} /> : null}
        </CanvasViewportLayer>
        {!readOnly ? <input ref={uploadRef} type="file" multiple accept="image/*,video/*,audio/*,.glb,model/gltf-binary" className="hidden" onChange={(event) => { const files = event.target.files ? Array.from(event.target.files) : []; const position = pendingUploadPositionRef.current || undefined; pendingUploadPositionRef.current = null; event.target.value = ''; if (files.length > 0) void handleUploads(files, position).catch((error: unknown) => setToast(error instanceof Error ? error.message : '上传失败')) }} /> : null}
        {!readOnly ? <input ref={replacementUploadRef} type="file" accept="image/*,video/*,audio/*,.glb,model/gltf-binary" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; const nodeId = replacementNodeIdRef.current; event.target.value = ''; replacementNodeIdRef.current = null; if (file && nodeId) void handleContentReplacement(nodeId, file).catch((error: unknown) => setToast(error instanceof Error ? error.message : '替换内容失败')) }} /> : null}
        {mode === 'story' ? <StoryCanvasOverlay onFocusNode={focusStoryNode} /> : null}
        {toast ? <div className="nori-canvas-toast">{toast}</div> : null}
      </div>
      </CanvasNodeSourceProvider>
      </StoryCanvasProvider>
      </CanvasMultiSelectionProvider>
    </CanvasEditorProvider>
  )
}

function CanvasGraphLoader(props: Props) {
  const { projectId, canvasId } = props
  const query = useCanvasGraph(projectId, canvasId, props.lightGraph === true && props.mode === 'canvas')
  if (query.isLoading) return <div className="nori-canvas-loading">正在加载画布…</div>
  if (query.error || !query.data) return <div className="nori-canvas-loading is-error"><span>画布加载失败：{String(query.error || '未返回数据')}</span><button type="button" onClick={() => void query.refetch()}>重试加载</button></div>
  return <CanvasEditor key={canvasId} {...props} initialGraph={query.data} />
}

export default function CanvasGraph(props: Props) {
  return <ReactFlowProvider><CanvasGraphLoader {...props} /></ReactFlowProvider>
}
