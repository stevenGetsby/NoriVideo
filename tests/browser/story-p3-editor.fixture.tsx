import React, { useCallback, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ReactFlow, type NodeTypes } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import '../../src/styles/frameos-replica.css'
import '../../src/features/canvas/story/story-canvas.css'
import { CanvasEditorProvider, type CanvasEditorContextValue } from '../../src/features/canvas/CanvasEditorContext'
import { StoryCanvasProvider, type StoryCanvasContextValue } from '../../src/features/canvas/story/StoryCanvasContext'
import { StoryChoiceNode } from '../../src/features/canvas/story/StoryBranchNodes'
import { StoryEndingNode, StorySceneNode } from '../../src/features/canvas/story/StoryLinearNodes'
import { StoryGameplaySettings } from '../../src/features/interactive/StoryGameplaySettings'
import type { CanvasFlowNode } from '../../src/features/canvas/editor-types'
import type {
  InteractiveStoryConfig,
  StoryAchievement,
  StoryChapterGraph,
  StoryMapConfig,
  StoryPersonality,
  StorySavePoint,
  StoryShop,
  StoryVariable,
} from '../../src/lib/interactive/types'

type PatchLog = { nodeId: string; patch: Record<string, unknown>; label?: string }
const log: {
  patches: PatchLog[]
  saves: Array<{ config: Partial<InteractiveStoryConfig> }>
  panels: Array<string | null>
} = { patches: [], saves: [], panels: [] }
;(window as typeof window & { __p3Fixture?: typeof log }).__p3Fixture = log

const params = new URLSearchParams(location.search)
const readOnly = params.get('readonly') === '1'
const panelOnly = params.get('panel') === '1'
const oldConfig = params.get('old') === '1'
const seedFull = params.get('seed') === 'full'

const VARIABLES: StoryVariable[] = [
  { id: 'coin', name: '金币', type: 'number', initial: 3 },
  { id: 'seen', name: '看见', type: 'boolean', initial: false },
]

const SHOP: StoryShop = {
  enabled: true,
  currencyVariableId: 'coin',
  items: [{ id: 'shop_key', name: '钥匙', icon: '🔑', description: '打开金库', price: 5, limit: 1, effects: [] }],
}

const SEED_ACHIEVEMENTS: StoryAchievement[] = [{
  id: 'ach_seed',
  name: '种子成就',
  description: '',
  icon: null,
  condition: { type: 'ending', projectId: 'p1', nodeId: 'ending-1' },
  reward: { title: '先驱者', frameUrl: null },
}]

const SEED_PERSONALITY: StoryPersonality = { enabled: true, results: { ENFP: { name: '热情家', description: '', imageUrl: null } } }
const SEED_MAP: StoryMapConfig = { enabled: true }

const INITIAL_CONFIG: InteractiveStoryConfig = {
  version: 1,
  variables: VARIABLES,
  chapters: [],
  links: [],
  start: null,
  shop: SHOP,
  ...(oldConfig ? {} : {
    ...(seedFull ? { achievements: SEED_ACHIEVEMENTS, personality: SEED_PERSONALITY, map: SEED_MAP } : {}),
  }),
}

const OPTION_BASE = { id: 'o_a', label: '冲出去', effects: [], imageUrl: null, when: 'now' as const, retry: false }

const INITIAL_NODES: CanvasFlowNode[] = [
  {
    id: 'scene-1',
    type: 'story_scene',
    position: { x: 0, y: 0 },
    data: { title: '雨夜', lines: '雨下得很大。', effects: [] },
  },
  {
    id: 'ending-1',
    type: 'story_ending',
    position: { x: 0, y: 460 },
    data: { title: '好结局', endingType: 'good', description: '' },
  },
  {
    id: 'choice-1',
    type: 'story_choice',
    position: { x: 460, y: 0 },
    data: {
      title: '岔路',
      prompt: '往哪走？',
      panelStyle: 'text',
      layout: 'auto',
      timeoutMode: 'default',
      timeoutSec: null,
      defaultOptionId: null,
      options: [
        { ...OPTION_BASE, ...(seedFull ? { tags: ['E', 'N'] } : {}) },
        { ...OPTION_BASE, id: 'o_b', label: '等一等' },
      ],
    },
  },
] as unknown as CanvasFlowNode[]

const nodeTypes: NodeTypes = { story_scene: StorySceneNode, story_ending: StoryEndingNode, story_choice: StoryChoiceNode }

function sceneSavePoint(data: Record<string, unknown>): StorySavePoint | null {
  const raw = data.savePoint
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>
  if (record.enabled !== true) return null
  return {
    name: typeof record.name === 'string' && record.name.trim() ? record.name.trim() : '雨夜',
    coverUrl: typeof record.coverUrl === 'string' && record.coverUrl ? record.coverUrl : null,
  }
}

function App() {
  const [nodes, setNodes] = useState<CanvasFlowNode[]>(INITIAL_NODES)
  const [config, setConfig] = useState<InteractiveStoryConfig>(INITIAL_CONFIG)
  const sceneNode = nodes.find((node) => node.id === 'scene-1')
  const savePoint = sceneNode ? sceneSavePoint(sceneNode.data as Record<string, unknown>) : null

  const chapter = useMemo<StoryChapterGraph>(() => ({
    projectId: 'p1',
    title: '第一章',
    nodes: [
      { id: 'scene-1', kind: 'scene', title: '雨夜', lines: '', media: null, effects: [], beats: [], ...(savePoint ? { savePoint } : {}) },
      { id: 'ending-1', kind: 'ending', title: '好结局', endingType: 'good', description: '' },
    ],
    flows: [],
  }), [savePoint])

  const updateNodeData = useCallback((nodeId: string, patch: Record<string, unknown>, label?: string) => {
    log.patches.push({ nodeId, patch, label })
    setNodes((current) => current.map((node) => (node.id === nodeId ? { ...node, data: { ...node.data, ...patch } } : node)))
  }, [])

  const saveConfig = useCallback(async (patch: Partial<InteractiveStoryConfig>) => {
    log.saves.push({ config: patch })
    setConfig((current) => ({ ...current, ...patch }))
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
  }), [updateNodeData])

  const story = useMemo<StoryCanvasContextValue>(() => ({
    projectId: 'p1',
    readOnly,
    story: {
      workId: 'work-1',
      name: 'P3 编辑测试',
      aspectRatio: '16:9',
      resolution: '720p',
      canManage: true,
      config,
      chapters: [{ projectId: 'p1', name: '第一章', order: 0 }],
    },
    variables: config.variables,
    saveConfig,
    trialEntryId: undefined,
    openTrial: () => {},
    closeTrial: () => {},
    panel: null,
    setPanel: (next) => { log.panels.push(next) },
    actions: {
      quickAdd: () => {},
      createSceneMedia: () => {},
      focusNode: () => {},
      removeEdge: () => {},
      organize: () => {},
    },
  }), [config, saveConfig])

  const settings = (
    <StoryGameplaySettings
      variables={config.variables}
      shop={config.shop}
      chapters={[chapter]}
      achievements={config.achievements}
      personality={config.personality}
      map={config.map}
      workId="work-1"
      readOnly={readOnly}
      onSaveConfig={saveConfig}
    />
  )

  if (panelOnly) {
    return (
      <div style={{ display: 'flex', width: '100vw', maxWidth: '100%', height: '100vh', flexDirection: 'column', minHeight: 0, background: '#17171f' }}>
        {settings}
      </div>
    )
  }

  return (
    <CanvasEditorProvider value={editor}>
      <StoryCanvasProvider value={story}>
        <div style={{ display: 'flex', height: '100vh', minHeight: 0 }}>
          <div style={{ width: 760, flex: 'none', height: '100%' }}>
            <ReactFlow
              nodes={nodes}
              edges={[]}
              nodeTypes={nodeTypes}
              fitView
              fitViewOptions={{ padding: 0.08 }}
              nodesDraggable={false}
              nodesConnectable={false}
              proOptions={{ hideAttribution: true }}
              minZoom={0.3}
            />
          </div>
          <div style={{ display: 'flex', width: 430, maxWidth: '100%', flex: 'none', flexDirection: 'column', minHeight: 0, borderLeft: '1px solid #2f2f3a', background: '#17171f' }}>
            {settings}
          </div>
        </div>
      </StoryCanvasProvider>
    </CanvasEditorProvider>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
