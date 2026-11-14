import React, { useCallback, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ReactFlow, type NodeTypes } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import '../../src/styles/frameos-replica.css'
import '../../src/features/canvas/story/story-canvas.css'
import { CanvasEditorProvider, type CanvasEditorContextValue } from '../../src/features/canvas/CanvasEditorContext'
import { StoryCanvasProvider, type StoryCanvasContextValue } from '../../src/features/canvas/story/StoryCanvasContext'
import { StoryChoiceNode } from '../../src/features/canvas/story/StoryBranchNodes'
import { StoryGameplaySettings } from '../../src/features/interactive/StoryGameplaySettings'
import type { CanvasFlowNode } from '../../src/features/canvas/editor-types'
import type { InteractiveStoryConfig, StoryShop, StoryVariable } from '../../src/lib/interactive/types'

type PatchLog = { nodeId: string; patch: Record<string, unknown>; label?: string }
const log: {
  patches: PatchLog[]
  saves: Array<{ config: Partial<InteractiveStoryConfig> }>
  panels: Array<string | null>
  state: { variables: StoryVariable[]; shop: StoryShop } | null
} = { patches: [], saves: [], panels: [], state: null }
;(window as typeof window & { __gameplayFixture?: typeof log }).__gameplayFixture = log

const INITIAL_VARIABLES: StoryVariable[] = [
  { id: 'coin', name: '金币', type: 'number', initial: 3 },
  { id: 'key', name: '钥匙', type: 'number', initial: 0 },
]

const INITIAL_SHOP: StoryShop = {
  enabled: false,
  currencyVariableId: null,
  items: [
    { id: 'shop_key', name: '钥匙', icon: '🔑', description: '打开金库', price: 5, limit: 1, effects: [{ variableId: 'key', op: 'add', value: 1 }] },
  ],
}

const INITIAL_NODES: CanvasFlowNode[] = [
  {
    id: 'choice-1',
    type: 'story_choice',
    position: { x: 0, y: 0 },
    data: {
      title: '金库大门',
      prompt: '怎么进去？',
      panelStyle: 'text',
      layout: 'auto',
      timeoutMode: 'default',
      timeoutSec: null,
      defaultOptionId: null,
      options: [
        {
          id: 'o_push',
          label: '硬闯',
          effects: [],
          imageUrl: null,
          when: 'now',
          retry: false,
          unlock: { mode: 'locked', match: 'all', conditions: [{ variableId: 'coin', op: '>=', value: 1 }], shopItemId: 'shop_key' },
        },
        { id: 'o_open', label: '开门', effects: [], imageUrl: null, when: 'now', retry: false },
      ],
    },
  },
] as unknown as CanvasFlowNode[]

const nodeTypes: NodeTypes = { story_choice: StoryChoiceNode }

function App() {
  const readOnly = new URLSearchParams(location.search).get('readonly') === '1'
  const [nodes, setNodes] = useState<CanvasFlowNode[]>(INITIAL_NODES)
  const [variables, setVariables] = useState<StoryVariable[]>(INITIAL_VARIABLES)
  const [shop, setShop] = useState<StoryShop>(INITIAL_SHOP)

  const updateNodeData = useCallback((nodeId: string, patch: Record<string, unknown>, label?: string) => {
    log.patches.push({ nodeId, patch, label })
    setNodes((current) => current.map((item) => (item.id === nodeId ? { ...item, data: { ...item.data, ...patch } } : item)))
  }, [])

  const saveConfig = useCallback(async (patch: Partial<InteractiveStoryConfig>) => {
    log.saves.push({ config: patch })
    if (patch.variables) setVariables(patch.variables)
    if (patch.shop) setShop(patch.shop)
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
    projectId: 'p1',
    readOnly,
    story: {
      workId: 'work-1',
      name: '玩法设置测试',
      aspectRatio: '16:9',
      resolution: '720p',
      canManage: true,
      config: { version: 1, variables, chapters: [], links: [], start: null, shop },
      chapters: [],
    },
    variables,
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
  }), [readOnly, saveConfig, shop, variables])

  log.state = { variables, shop }

  return (
    <CanvasEditorProvider value={editor}>
      <StoryCanvasProvider value={story}>
        <div style={{ display: 'flex', height: '100vh', minHeight: 0 }}>
          <div style={{ width: 740, flex: 'none', height: '100%' }}>
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
          <div style={{ display: 'flex', width: 430, flex: 'none', flexDirection: 'column', minHeight: 0, borderLeft: '1px solid #2f2f3a', background: '#17171f' }}>
            <StoryGameplaySettings
              variables={variables}
              shop={shop}
              workId="work-1"
              readOnly={readOnly}
              onSaveConfig={saveConfig}
            />
          </div>
        </div>
      </StoryCanvasProvider>
    </CanvasEditorProvider>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
