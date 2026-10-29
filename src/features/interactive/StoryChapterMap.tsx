'use client'

import { useEffect, useMemo, useRef } from 'react'
import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { StoryIssue } from '@/lib/interactive/types'
import {
  ENTRY_HANDLE_PREFIX,
  EXIT_HANDLE_PREFIX,
  orderedChapters,
  readChapterConnection,
  type StoryOverviewData,
} from './story-overview-model'
import { ChapterMapContext, StoryChapterNode, type ChapterFlowNode, type ChapterMapActions } from './StoryChapterNode'

const NODE_TYPES = { chapter: StoryChapterNode }

type MapProps = {
  data: StoryOverviewData
  issues: StoryIssue[]
  focusedId: string | null
  actions: ChapterMapActions
  onConnect: (connection: Connection) => void
  onDeleteLinks: (linkIds: string[]) => void
  onMove: (projectId: string, position: { x: number; y: number }) => void
  onFocus: (projectId: string | null) => void
}

function MapInner({ data, issues, focusedId, actions, onConnect, onDeleteLinks, onMove, onFocus }: MapProps) {
  const flow = useReactFlow()
  const derived = useMemo<ChapterFlowNode[]>(() => orderedChapters(data).map(({ meta, chapter }) => {
    const own = issues.filter((issue) => issue.projectId === chapter.projectId)
    return {
      id: chapter.projectId,
      type: 'chapter',
      position: meta.position,
      deletable: false,
      data: {
        chapter,
        meta,
        errors: own.filter((issue) => issue.level === 'error').length,
        warnings: own.filter((issue) => issue.level === 'warning').length,
        focused: focusedId === chapter.projectId,
      },
    }
  }), [data, focusedId, issues])
  const [nodes, setNodes, onNodesChange] = useNodesState<ChapterFlowNode>(derived)
  useEffect(() => {
    setNodes((current) => derived.map((node) => ({ ...node, selected: current.find((item) => item.id === node.id)?.selected ?? false })))
  }, [derived, setNodes])

  const edges = useMemo<Edge[]>(() => data.story.config.links.map((link) => ({
    id: link.id,
    source: link.fromProjectId,
    sourceHandle: `${EXIT_HANDLE_PREFIX}${link.exitNodeId}`,
    target: link.toProjectId,
    targetHandle: `${ENTRY_HANDLE_PREFIX}${link.toEntryNodeId}`,
    className: 'nori-ix-link',
    deletable: !actions.readOnly,
  })), [actions.readOnly, data.story.config.links])

  const count = derived.length
  const fitted = useRef(0)
  useEffect(() => {
    if (fitted.current === count) return
    const initial = fitted.current === 0
    fitted.current = count
    if (initial) return
    // New chapters need a measure pass before they can be framed.
    const timer = window.setTimeout(() => { void flow.fitView({ padding: 0.22, maxZoom: 1, duration: 300 }) }, 80)
    return () => window.clearTimeout(timer)
  }, [count, flow])

  useEffect(() => {
    if (!focusedId) return
    void flow.fitView({ nodes: [{ id: focusedId }], padding: 0.6, maxZoom: 1, duration: 360 })
  }, [focusedId, flow])

  return (
    <ChapterMapContext.Provider value={actions}>
      <ReactFlow<ChapterFlowNode, Edge>
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        onNodesChange={onNodesChange}
        fitView
        fitViewOptions={{ padding: 0.22, maxZoom: 1 }}
        onNodeDragStop={(_event, node) => onMove(node.id, { x: Math.round(node.position.x), y: Math.round(node.position.y) })}
        onPaneClick={() => onFocus(null)}
        onConnect={onConnect}
        isValidConnection={(connection) => readChapterConnection(connection) !== null}
        onEdgesDelete={(deleted) => onDeleteLinks(deleted.map((edge) => edge.id))}
        connectionMode={ConnectionMode.Strict}
        nodesDraggable={!actions.readOnly}
        nodesConnectable={!actions.readOnly}
        deleteKeyCode={actions.readOnly ? null : ['Backspace', 'Delete']}
        minZoom={0.25}
        maxZoom={1.6}
        proOptions={{ hideAttribution: true }}
        colorMode="dark"
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.2} color="rgba(255, 255, 255, .09)" />
        <Controls showInteractive={false} position="bottom-left" />
      </ReactFlow>
    </ChapterMapContext.Provider>
  )
}

export function StoryChapterMap(props: MapProps) {
  return (
    <div className="nori-ix-map">
      <ReactFlowProvider>
        <MapInner {...props} />
      </ReactFlowProvider>
      {props.data.chapters.length > 1 && !props.actions.readOnly ? (
        <p className="nori-ix-map-hint">从章节右侧的出口拖到另一章左侧的入口；选中连线后按 Delete 删除。</p>
      ) : null}
    </div>
  )
}
