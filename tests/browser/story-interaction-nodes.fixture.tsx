import React, { useCallback, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ReactFlow, type Edge, type NodeTypes } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import '../../src/styles/frameos-replica.css'
import '../../src/features/canvas/story/story-canvas.css'
import { CanvasEditorProvider, type CanvasEditorContextValue } from '../../src/features/canvas/CanvasEditorContext'
import { StoryCanvasProvider, type StoryCanvasContextValue } from '../../src/features/canvas/story/StoryCanvasContext'
import { StoryInteractionNode } from '../../src/features/canvas/story/StoryInteractionNodes'
import { StorySceneNode } from '../../src/features/canvas/story/StoryLinearNodes'
import type { CanvasFlowNode } from '../../src/features/canvas/editor-types'

type PatchLog = { nodeId: string; patch: Record<string, unknown>; label?: string }
const log: { patches: PatchLog[]; focused: string[] } = { patches: [], focused: [] }
;(window as typeof window & { __storyFixture?: typeof log }).__storyFixture = log

const node = (id: string, type: string, position: { x: number; y: number }, data: Record<string, unknown>) =>
  ({ id, type, position, data }) as unknown as CanvasFlowNode
const mount = (sceneId: string, beatId: string): Edge =>
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

const initialEdges: Edge[] = [
  mount('scene-1', 'i-tap'),
  mount('scene-1', 'i-swipe'),
  mount('scene-1', 'i-timing'),
  mount('scene-1', 'i-hold'),
  mount('scene-1', 'i-choice'),
  mount('scene-2', 'i-bad'),
  mount('scene-3', 'i-free'),
]

const nodeTypes: NodeTypes = { story_scene: StorySceneNode, story_interaction: StoryInteractionNode }

function App() {
  const readOnly = new URLSearchParams(location.search).get('readonly') === '1'
  const [nodes, setNodes] = useState<CanvasFlowNode[]>(initialNodes)

  const updateNodeData = useCallback((nodeId: string, patch: Record<string, unknown>, label?: string) => {
    log.patches.push({ nodeId, patch, label })
    setNodes((current) => current.map((item) => (item.id === nodeId ? { ...item, data: { ...item.data, ...patch } } : item)))
  }, [])

  const editor = useMemo<CanvasEditorContextValue>(() => ({
    readOnly,
    playlistDropTargetId: null,
    canUndo: false,
    canRedo: false,
    saveState: 'saved',
    undo: () => {},
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
  }), [readOnly, updateNodeData])

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
    },
  }), [readOnly])

  return (
    <CanvasEditorProvider value={editor}>
      <StoryCanvasProvider value={story}>
        <ReactFlow
          nodes={nodes}
          edges={initialEdges}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.05 }}
          nodesDraggable={false}
          nodesConnectable={false}
          proOptions={{ hideAttribution: true }}
          minZoom={0.15}
        />
      </StoryCanvasProvider>
    </CanvasEditorProvider>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
