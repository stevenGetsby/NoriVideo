import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ReactFlow, ReactFlowProvider, useReactFlow, useStoreApi, type NodeTypes } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import '../../src/styles/frameos-replica.css'
import '../../src/features/canvas/story/story-canvas.css'
import { CanvasEditorProvider, type CanvasEditorContextValue } from '../../src/features/canvas/CanvasEditorContext'
import { StoryCanvasProvider, type StoryCanvasContextValue } from '../../src/features/canvas/story/StoryCanvasContext'
import { StoryInteractionNode } from '../../src/features/canvas/story/StoryInteractionNodes'
import { StorySceneNode } from '../../src/features/canvas/story/StoryLinearNodes'
import { useStoryCanvasActions, type StoryActionDeps } from '../../src/features/canvas/story/useStoryCanvasActions'
import { useCanvasHistory } from '../../src/features/canvas/state/useCanvasHistory'
import { ConfirmHost } from '../../src/components/ui/ConfirmHost'
import type { CanvasFlowEdge, CanvasFlowNode } from '../../src/features/canvas/editor-types'

type PatchLog = { nodeId: string; patch: Record<string, unknown>; label?: string }
const log: { patches: PatchLog[]; focused: string[]; history: string[]; snapshot: () => { nodes: CanvasFlowNode[]; edges: CanvasFlowEdge[] } } = {
  patches: [], focused: [], history: [], snapshot: () => ({ nodes: [], edges: [] }),
}
;(window as typeof window & { __storyFixture?: typeof log }).__storyFixture = log

const node = (id: string, type: string, position: { x: number; y: number }, data: Record<string, unknown>) =>
  ({ id, type, position, data }) as unknown as CanvasFlowNode
const mount = (sceneId: string, beatId: string): CanvasFlowEdge =>
  ({ id: `${sceneId}>${beatId}`, source: sceneId, target: beatId, sourceHandle: 'interact', targetHandle: 'mount', type: 'bezier', data: { role: 'STORY_MOUNT' } })

const interaction = (id: string, title: string, position: { x: number; y: number }, data: Record<string, unknown>) =>
  node(id, 'story_interaction', position, {
    title,
    hint: '',
    during: 'play',
    results: {},
    ...data,
  })

const initialNodes: CanvasFlowNode[] = [
  node('scene-1', 'story_scene', { x: 0, y: 0 }, { title: '电梯逃生', lines: '电梯门被卡住了。', effects: [], videoUrl: '/clips/elevator.mp4', videoDurationSec: 60 }),
  interaction('i-tap', '快速点击', { x: 380, y: 0 }, { interaction: 'tap', startSec: 5, durationSec: 3, count: 10, buttonText: '', buttonImageUrl: null }),
  interaction('i-swipe', '方向滑动', { x: 740, y: 0 }, { interaction: 'swipe', startSec: 10, durationSec: 2, direction: 'up', buttonText: '', buttonImageUrl: null }),
  interaction('i-timing', '证据时机', { x: 1100, y: 0 }, { interaction: 'timing', startSec: 14, durationSec: 3, speed: 1, perfectWidth: 10, normalWidth: 30, propImageUrl: null }),
  interaction('i-hold', '拉弓蓄力', { x: 740, y: 700 }, { interaction: 'hold', startSec: 20, durationSec: 4, fillSec: 2, rangeMin: 80, rangeMax: 100, overchargeFails: false, buttonText: '', buttonImageUrl: null }),
  interaction('i-choice', '限时抉择', { x: 1100, y: 700 }, {
    interaction: 'choice', startSec: 30, durationSec: 3, during: 'freeze', prompt: '电梯还能撑住吗？', panelStyle: 'text', layout: 'auto', timeoutMode: 'default', defaultOptionId: null,
    options: [
      { id: 'opt_run', label: '冲出去', effects: [], imageUrl: null, when: 'now', retry: false },
      { id: 'opt_hide', label: '躲起来', effects: [], imageUrl: null, when: 'now', retry: false },
    ],
  }),
  node('scene-2', 'story_scene', { x: 0, y: 700 }, { title: '越界片段', lines: '', effects: [], videoUrl: '/clips/short.mp4', videoDurationSec: 20 }),
  interaction('i-bad', '越界互动', { x: 380, y: 700 }, { interaction: 'tap', startSec: 18, durationSec: 5, count: 10, buttonText: '', buttonImageUrl: null }),
  node('scene-3', 'story_scene', { x: 0, y: 1450 }, { title: '未记录时长', lines: '', effects: [] }),
  interaction('i-free', '时长未知互动', { x: 380, y: 1450 }, { interaction: 'swipe', startSec: 12, durationSec: 2, direction: 'left', buttonText: '', buttonImageUrl: null }),
  node('scene-4', 'story_scene', { x: 740, y: 1450 }, { title: '空白片段', lines: '', effects: [] }),
  interaction('i-unmounted', '未挂载互动', { x: 1100, y: 1450 }, { interaction: 'tap', startSec: 0, durationSec: 3, count: 10, buttonText: '', buttonImageUrl: null }),
]

const focusedNodes: CanvasFlowNode[] = [
  node('hotspot-scene', 'story_scene', { x: 0, y: 2150 }, { title: '侦探房间', lines: '', effects: [], videoDurationSec: 20 }),
  interaction('i-hotspot', '找线索', { x: 380, y: 2150 }, {
    interaction: 'hotspot', startSec: 2, durationSec: 5, frameImageUrl: null, showZones: false,
    zones: [
      { id: 'opt_photo', label: '照片', x: 0.1, y: 0.1, w: 0.3, h: 0.3 },
      { id: 'opt_vase', label: '花瓶', x: 0.6, y: 0.6, w: 0.2, h: 0.2 },
    ],
  }),
  node('hotspot-ending', 'story_scene', { x: 740, y: 2150 }, { title: '发现线索', lines: '', effects: [] }),
]

const focusedEdges: CanvasFlowEdge[] = [
  mount('hotspot-scene', 'i-hotspot'),
  { id: 'hotspot-photo', source: 'i-hotspot', target: 'hotspot-ending', sourceHandle: 'opt_photo', targetHandle: 'input', type: 'bezier', data: { role: 'STORY_FLOW' } },
]

const initialEdges: CanvasFlowEdge[] = [
  mount('scene-1', 'i-tap'),
  mount('scene-1', 'i-swipe'),
  mount('scene-1', 'i-timing'),
  mount('scene-1', 'i-hold'),
  mount('scene-1', 'i-choice'),
  mount('scene-2', 'i-bad'),
  mount('scene-3', 'i-free'),
  { id: 'choice-run', source: 'i-choice', target: 'scene-2', sourceHandle: 'opt_run', targetHandle: 'input', type: 'bezier', data: { role: 'STORY_FLOW' } },
  { id: 'choice-hide', source: 'i-choice', target: 'scene-3', sourceHandle: 'opt_hide', targetHandle: 'input', type: 'bezier', data: { role: 'STORY_FLOW' } },
]

const nodeTypes: NodeTypes = { story_scene: StorySceneNode, story_interaction: StoryInteractionNode }

function App() {
  const readOnly = new URLSearchParams(location.search).get('readonly') === '1'
  const focus = new URLSearchParams(location.search).get('focus') ?? ''
  const [nodes, setNodes] = useState<CanvasFlowNode[]>(focus === 'hotspot' ? focusedNodes : focus === 'choice'
    ? initialNodes.filter((node) => ['i-choice', 'scene-2', 'scene-3'].includes(node.id))
      : focus === 'tap'
        ? initialNodes.filter((node) => ['i-tap', 'scene-1'].includes(node.id))
        : initialNodes)
  const [edges, setEdges] = useState<CanvasFlowEdge[]>(() => focus === 'hotspot' ? focusedEdges : focus
    ? initialEdges.filter((edge) => nodes.some((node) => node.id === edge.source) && nodes.some((node) => node.id === edge.target))
    : initialEdges)
  const nodesRef = useRef(nodes)
  const edgesRef = useRef(edges)
  const flow = useReactFlow<CanvasFlowNode, CanvasFlowEdge>()
  const flowStore = useStoreApi<CanvasFlowNode, CanvasFlowEdge>()
  const history = useCanvasHistory()
  useEffect(() => { nodesRef.current = nodes }, [nodes])
  useEffect(() => { edgesRef.current = edges }, [edges])
  useEffect(() => {
    log.snapshot = () => structuredClone({ nodes: nodesRef.current, edges: edgesRef.current })
  }, [])

  const record = useCallback((label: string) => {
    log.history.push(label)
    history.record(label, { nodes: nodesRef.current, edges: edgesRef.current, viewport: { x: 0, y: 0, zoom: 1 } })
  }, [history.record])
  const undo = useCallback(() => {
    const previous = history.undo({ nodes: nodesRef.current, edges: edgesRef.current, viewport: { x: 0, y: 0, zoom: 1 } })
    if (!previous) return
    nodesRef.current = previous.nodes
    edgesRef.current = previous.edges
    setNodes(previous.nodes)
    setEdges(previous.edges)
  }, [history.undo])
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        undo()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [undo])

  const updateNodeData = useCallback((nodeId: string, patch: Record<string, unknown>, label?: string) => {
    log.patches.push({ nodeId, patch, label })
    if (label) record(label)
    const next = nodesRef.current.map((item) => (item.id === nodeId ? { ...item, data: { ...item.data, ...patch } } : item))
    nodesRef.current = next
    setNodes(next)
  }, [record])

  const actionDeps = useMemo<StoryActionDeps>(() => ({
    story: null, writeLocked: readOnly, flow, flowStore, nodesRef, edgesRef, setNodes, setEdges,
    setWireMenu: () => {}, record, markChanged: () => {}, ensureNodeCapacity: () => true, toast: () => {},
    toFlowPoint: (point) => point, animateNodeLayout: () => {}, removeEdges: () => {}, maxEdges: 100,
  }), [flow, flowStore, readOnly, record])
  const actions = useStoryCanvasActions(actionDeps)

  const editor = useMemo<CanvasEditorContextValue>(() => ({
    readOnly,
    playlistDropTargetId: null,
    canUndo: history.canUndo,
    canRedo: history.canRedo,
    saveState: 'saved',
    undo,
    redo: () => {},
    saveCanvas: async () => {},
    updateNodeData,
    setTextEditing: () => {},
    textEditingNodeId: null,
    removeNodes: () => {},
    duplicateNodes: () => {},
    runNodeAction: () => {},
    listPlaylistVideoSources: () => [],
    loadPlaylistRender: async () => ({}) as never,
    startPlaylistRender: async () => ({}) as never,
    loadPlaylistReview: async () => ({}) as never,
    submitPlaylistReview: async () => ({}) as never,
  }), [readOnly, updateNodeData, history.canUndo, history.canRedo, undo])

  const story = useMemo<StoryCanvasContextValue>(() => ({
    projectId: 'project-1',
    readOnly,
    story: {
      workId: 'work-1',
      name: '互动节点测试',
      aspectRatio: '9:16',
      resolution: '720p',
      canManage: true,
      config: { version: 1, variables: [], chapters: [], links: [], start: null },
      chapters: [],
    },
    variables: [],
    saveConfig: async () => {},
    trialEntryId: undefined,
    openTrial: () => {},
    closeTrial: () => {},
    panel: null,
    setPanel: () => {},
    actions: {
      quickAdd: () => {},
      createSceneMedia: () => {},
      focusNode: (nodeId: string) => { log.focused.push(nodeId) },
      removeEdge: () => {},
      organize: () => {},
      retargetInteraction: actions.retargetInteraction,
      removeInteractionHandle: actions.removeInteractionHandle,
    },
  }), [readOnly, actions])

  return (
    <CanvasEditorProvider value={editor}>
      <StoryCanvasProvider value={story}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          fitView={focus === ''}
          fitViewOptions={{ padding: 0.05 }}
          nodesDraggable={false}
          nodesConnectable={false}
          proOptions={{ hideAttribution: true }}
          minZoom={0.15}
          onInit={(instance) => {
            if (focus) {
              const selected = nodes.find((node) => node.id === (focus === 'choice' ? 'i-choice' : focus === 'hotspot' ? 'i-hotspot' : 'i-tap'))
              if (selected) void instance.fitView({ nodes: [selected], padding: 0.2, maxZoom: 1 })
            }
          }}
        />
        <ConfirmHost />
      </StoryCanvasProvider>
    </CanvasEditorProvider>
  )
}

function LegacyApp() {
  const readOnly = new URLSearchParams(location.search).get('readonly') === '1'
  const [nodes, setNodes] = useState<CanvasFlowNode[]>(initialNodes)
  const updateNodeData = useCallback((nodeId: string, patch: Record<string, unknown>, label?: string) => {
    log.patches.push({ nodeId, patch, label })
    setNodes((current) => current.map((item) => (item.id === nodeId ? { ...item, data: { ...item.data, ...patch } } : item)))
  }, [])
  const editor = useMemo<CanvasEditorContextValue>(() => ({
    readOnly, playlistDropTargetId: null, canUndo: false, canRedo: false, saveState: 'saved',
    undo: () => {}, redo: () => {}, saveCanvas: async () => {}, updateNodeData,
    setTextEditing: () => {}, textEditingNodeId: null, removeNodes: () => {}, duplicateNodes: () => {},
    runNodeAction: () => {}, listPlaylistVideoSources: () => [], loadPlaylistRender: async () => ({}) as never,
    startPlaylistRender: async () => ({}) as never, loadPlaylistReview: async () => ({}) as never, submitPlaylistReview: async () => ({}) as never,
  }), [readOnly, updateNodeData])
  const story = useMemo<StoryCanvasContextValue>(() => ({
    projectId: 'project-1', readOnly,
    story: { workId: 'work-1', name: '互动节点测试', aspectRatio: '9:16', resolution: '720p', canManage: true, config: { version: 1, variables: [], chapters: [], links: [], start: null }, chapters: [] },
    variables: [], saveConfig: async () => {}, trialEntryId: undefined, openTrial: () => {}, closeTrial: () => {}, panel: null, setPanel: () => {},
    actions: { quickAdd: () => {}, createSceneMedia: () => {}, focusNode: (nodeId) => { log.focused.push(nodeId) }, removeEdge: () => {}, organize: () => {}, retargetInteraction: async () => {}, removeInteractionHandle: async () => true },
  }), [readOnly])
  return (
    <CanvasEditorProvider value={editor}>
      <StoryCanvasProvider value={story}>
        <ReactFlow nodes={nodes} edges={initialEdges} nodeTypes={nodeTypes} fitView fitViewOptions={{ padding: 0.05 }} nodesDraggable={false} nodesConnectable={false} proOptions={{ hideAttribution: true }} minZoom={0.15} />
      </StoryCanvasProvider>
    </CanvasEditorProvider>
  )
}

function FocusedApp() {
  return (
    <ReactFlowProvider>
      <App />
    </ReactFlowProvider>
  )
}

createRoot(document.getElementById('root')!).render(new URLSearchParams(location.search).get('focus') ? <FocusedApp /> : <LegacyApp />)
