import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ReactFlow, useNodesState } from '@xyflow/react'
import { Studio3DNode } from '../../src/features/canvas/nodes/Studio3DNode'
import { CanvasEditorProvider, type CanvasEditorContextValue } from '../../src/features/canvas/CanvasEditorContext'
import { canvasNodeToFlow, type CanvasFlowNode } from '../../src/features/canvas/editor-types'
import '@xyflow/react/dist/style.css'
import '../../src/features/canvas/canvas.css'

const params = new URLSearchParams(location.search)
const readOnly = params.get('readonly') === 'true'
const width = Number(params.get('width') || 360)
const height = Number(params.get('height') || 260)
const zoom = Number(params.get('zoom') || 1)
const nodeTypes = { studio_3d: Studio3DNode }

function Fixture() {
  const [actionCount, setActionCount] = useState(0)
  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasFlowNode>([{
    ...canvasNodeToFlow({
      id: 'studio-test', canvasId: 'fixture', type: 'studio_3d',
      position: { x: 160, y: 140 }, size: { width, height },
      status: 'IDLE', taskId: null, runId: null, mediaObjectId: null, parentNodeId: null,
      data: {
        title: params.get('long') === 'true' ? '夜晚街道与角色调度的超长名称 3D 导演台节点' : '3D 导演台',
        studioSummary: {
          version: 1, objectCount: 12, cameraCount: 8, captureCount: 24, hasPanorama: true,
        },
      },
    }),
    selected: true,
  }])
  const editor = {
    readOnly, runNodeAction: () => setActionCount((value) => value + 1),
  } as unknown as CanvasEditorContextValue

  return <>
    <main className="fos-app">
      <CanvasEditorProvider value={editor}>
        <div className="nori-canvas-workspace">
          <div className="nori-canvas-surface">
            <ReactFlow
              nodes={nodes} edges={[]} nodeTypes={nodeTypes} onNodesChange={onNodesChange}
              nodesDraggable={!readOnly} nodesConnectable={!readOnly}
              selectNodesOnDrag={false} zoomOnDoubleClick={false}
              defaultViewport={{ x: 0, y: 0, zoom }} minZoom={0.15} maxZoom={5}
              panOnDrag={[1, 2]}
            />
          </div>
        </div>
      </CanvasEditorProvider>
    </main>
    <aside style={{ position: 'fixed', right: 12, bottom: 12, zIndex: 9999, color: '#fff' }}>
      <output data-testid="node-position">{JSON.stringify(nodes[0].position)}</output>
      <output data-testid="action-count">{actionCount}</output>
      <button onClick={() => setNodes((items) => items.map((node) => ({
        ...node, position: { x: 160, y: 140 }, selected: true,
      })))}>重置测试节点</button>
    </aside>
  </>
}

createRoot(document.getElementById('root')!).render(<Fixture />)
