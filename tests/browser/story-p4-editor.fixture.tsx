import React, { useCallback, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ReactFlowProvider } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import '../../src/styles/frameos-replica.css'
import '../../src/features/canvas/story/story-canvas.css'
import '../../src/features/interactive/interactive.css'
import { CanvasEditorProvider, type CanvasEditorContextValue } from '../../src/features/canvas/CanvasEditorContext'
import { StoryCanvasProvider, type StoryCanvasContextValue } from '../../src/features/canvas/story/StoryCanvasContext'
import { StoryCanvasOverlay } from '../../src/features/canvas/story/StoryCanvasOverlay'
import { StoryGameplaySettings } from '../../src/features/interactive/StoryGameplaySettings'
import { StoryOverviewSide } from '../../src/features/interactive/StoryOverviewSide'
import type { OverviewStory } from '../../src/features/interactive/story-overview-model'
import type {
  InteractiveStoryConfig,
  StoryAchievement,
  StoryPlaybackConfig,
  StoryShop,
  StoryVariable,
} from '../../src/lib/interactive/types'

const log: {
  saves: Array<{ config: Partial<InteractiveStoryConfig> }>
  sideSaves: Array<{ config?: Partial<InteractiveStoryConfig> }>
  panels: Array<string | null>
} = { saves: [], sideSaves: [], panels: [] }
;(window as typeof window & { __p4Fixture?: typeof log }).__p4Fixture = log

const params = new URLSearchParams(location.search)
const readOnly = params.get('readonly') === '1'
const mode = params.get('mode') ?? 'editor'
const seed = params.get('seed') ?? 'none'

const SEEDED: Record<string, StoryPlaybackConfig | undefined> = {
  none: undefined,
  extra: { speeds: [1, 1.25] },
  all: { speeds: [1, 1.25, 1.5] },
}

const COUNTS = params.get('counts') === '1'
const MANY_VARIABLES: StoryVariable[] = [
  { id: 'coin', name: '金币', type: 'number', initial: 3 },
  { id: 'seen', name: '看见', type: 'boolean', initial: false },
  { id: 'mood', name: '心情', type: 'number', initial: 0 },
]
const MANY_SHOP: StoryShop = {
  enabled: true,
  currencyVariableId: 'coin',
  items: [{ id: 'shop_key', name: '钥匙', icon: null, description: '', price: 5, limit: 1, effects: [] }],
}
const MANY_ACHIEVEMENTS: StoryAchievement[] = [{
  id: 'ach_seed',
  name: '种子成就',
  description: '',
  icon: null,
  condition: { type: 'all_endings' },
  reward: { title: '', frameUrl: null },
}]

function initialConfig(): InteractiveStoryConfig {
  return {
    version: 1,
    variables: COUNTS ? MANY_VARIABLES : [],
    chapters: mode === 'editor' ? [] : [{ projectId: 'p1', order: 0, position: { x: 0, y: 0 }, status: 'drafting' }],
    links: [],
    start: null,
    ...(COUNTS ? {
      shop: MANY_SHOP,
      achievements: MANY_ACHIEVEMENTS,
      personality: { enabled: true, results: {} },
      map: { enabled: true },
    } : {}),
    ...(SEEDED[seed] ? { playback: SEEDED[seed] } : {}),
  }
}

function EditorApp() {
  const [config, setConfig] = useState<InteractiveStoryConfig>(initialConfig)
  const saveConfig = useCallback(async (patch: Partial<InteractiveStoryConfig>) => {
    log.saves.push({ config: patch })
    setConfig((current) => ({ ...current, ...patch }))
  }, [])
  return (
    <div style={{ display: 'flex', height: '100vh', minHeight: 0, flexDirection: 'column', background: '#17171f' }}>
      <StoryGameplaySettings
        variables={config.variables}
        shop={config.shop}
        achievements={config.achievements}
        personality={config.personality}
        map={config.map}
        playback={config.playback}
        workId="work-1"
        readOnly={readOnly}
        onSaveConfig={saveConfig}
      />
    </div>
  )
}

function SideApp() {
  const [config, setConfig] = useState<InteractiveStoryConfig>(initialConfig)
  const story = useMemo<OverviewStory>(() => ({
    workId: 'work-1',
    name: 'P4 总览测试',
    aspectRatio: '16:9',
    resolution: '720p',
    canManage: true,
    canCreateChapters: true,
    config,
  }), [config])
  return (
    <div style={{ display: 'flex', width: 360, maxWidth: '100vw', height: '100vh', flexDirection: 'column', background: '#0d0d13' }}>
      <StoryOverviewSide
        story={story}
        chapters={[]}
        issues={[]}
        readOnly={readOnly}
        onFocusIssue={() => {}}
        onSave={async (body) => {
          log.sideSaves.push(body)
          if (body.config) setConfig((current) => ({ ...current, ...body.config }))
        }}
      />
    </div>
  )
}

function OverlayApp() {
  const [config, setConfig] = useState<InteractiveStoryConfig>(initialConfig)
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
    updateNodeData: () => {},
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
  }), [])
  const story = useMemo<StoryCanvasContextValue>(() => ({
    projectId: 'p1',
    readOnly,
    story: {
      workId: 'work-1',
      name: 'P4 画布测试',
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
    panel: 'gameplay',
    setPanel: (next) => { log.panels.push(next) },
    actions: {
      quickAdd: () => {},
      createSceneMedia: () => {},
      focusNode: () => {},
      removeEdge: () => {},
      organize: () => {},
    },
  }), [config, readOnly, saveConfig])
  return (
    <ReactFlowProvider>
      <CanvasEditorProvider value={editor}>
        <StoryCanvasProvider value={story}>
          <div className="nori-canvas-workspace" style={{ position: 'relative', width: 460, maxWidth: '100vw', height: '100vh' }}>
            <StoryCanvasOverlay onFocusNode={() => {}} />
          </div>
        </StoryCanvasProvider>
      </CanvasEditorProvider>
    </ReactFlowProvider>
  )
}

createRoot(document.getElementById('root')!).render(
  mode === 'side' ? <SideApp /> : mode === 'overlay' ? <OverlayApp /> : <EditorApp />,
)
