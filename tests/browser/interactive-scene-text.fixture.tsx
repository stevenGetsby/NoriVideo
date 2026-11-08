import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ReactFlow, useNodesState } from '@xyflow/react'
import { StorySceneNode } from '../../src/features/canvas/story/StoryLinearNodes'
import { CanvasEditorProvider, type CanvasEditorContextValue } from '../../src/features/canvas/CanvasEditorContext'
import { StoryCanvasProvider, type StoryCanvasContextValue } from '../../src/features/canvas/story/StoryCanvasContext'
import { canvasNodeToFlow, type CanvasFlowNode } from '../../src/features/canvas/editor-types'
import '@xyflow/react/dist/style.css'
import '../../src/features/canvas/canvas.css'
import '../../src/features/canvas/story/story-canvas.css'

const params = new URLSearchParams(location.search)
const readOnly = params.get('readonly') === 'true'
const media = params.get('media')
const initialLines = params.get('long') === 'true'
  ? `第一行\r\n第二行\r\n${'长'.repeat(300)}`
  : '敌军压境。'
const nodeTypes = { story_scene: StorySceneNode }

function Fixture() {
  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasFlowNode>([{
    ...canvasNodeToFlow({
      id: 'scene-1',
      canvasId: 'fixture',
      type: 'story_scene',
      position: { x: 120, y: 120 },
      size: null,
      status: 'IDLE',
      taskId: null,
      runId: null,
      mediaObjectId: null,
      parentNodeId: null,
      data: {
        title: '城头',
        lines: initialLines,
        effects: [],
        ...(media === 'ready'
          ? { imageUrl: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="42" height="26"><rect width="42" height="26" fill="#3b5b7a"/></svg>') }
          : {}),
      },
    }),
    selected: true,
  }])

  const editor = {
    readOnly,
    updateNodeData: (id: string, patch: Record<string, unknown>) => {
      setNodes((items) => items.map((node) => (node.id === id ? { ...node, data: { ...node.data, ...patch } } : node)))
    },
  } as unknown as CanvasEditorContextValue

  const story = {
    projectId: 'p1',
    readOnly,
    story: {
      workId: 'work-1',
      name: '长安夜行',
      aspectRatio: '16:9',
      resolution: '1080p',
      canManage: true,
      config: { version: 1, variables: [], chapters: [], links: [], start: null },
      chapters: [{ projectId: 'p1', name: '第一章' }],
    },
    variables: [],
    saveVariables: async () => undefined,
    trialEntryId: undefined,
    openTrial: () => undefined,
    closeTrial: () => undefined,
    panel: null,
    setPanel: () => undefined,
    actions: {
      quickAdd: () => undefined,
      createSceneMedia: () => undefined,
      focusNode: () => undefined,
      removeEdge: () => undefined,
      organize: () => undefined,
    },
  } as unknown as StoryCanvasContextValue

  return <>
    <main className="fos-app">
      <StoryCanvasProvider value={story}>
        <CanvasEditorProvider value={editor}>
          <div className="nori-canvas-workspace">
            <div className="nori-canvas-surface" style={{ height: '100vh' }}>
              <ReactFlow
                nodes={nodes}
                edges={[]}
                nodeTypes={nodeTypes}
                onNodesChange={onNodesChange}
                nodesDraggable={!readOnly}
                nodesConnectable={!readOnly}
                defaultViewport={{ x: 0, y: 0, zoom: 1 }}
                minZoom={0.2}
                maxZoom={2}
                proOptions={{ hideAttribution: true }}
              />
            </div>
          </div>
        </CanvasEditorProvider>
      </StoryCanvasProvider>
    </main>
    <aside className="fixture-output" style={{ position: 'fixed', right: 12, bottom: 12, zIndex: 9999, color: '#fff' }}>
      <output data-testid="node-lines">{JSON.stringify(nodes[0].data.lines ?? '')}</output>
      <output data-testid="node-effects">{JSON.stringify(nodes[0].data.effects ?? [])}</output>
    </aside>
  </>
}

createRoot(document.getElementById('root')!).render(<Fixture />)
