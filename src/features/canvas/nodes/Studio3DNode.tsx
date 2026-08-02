'use client'

import Box from 'lucide-react/dist/esm/icons/box.js'
import Camera from 'lucide-react/dist/esm/icons/camera.js'
import Cuboid from 'lucide-react/dist/esm/icons/cuboid.js'
import Download from 'lucide-react/dist/esm/icons/download.js'
import Maximize2 from 'lucide-react/dist/esm/icons/maximize-2.js'
import { Handle, NodeResizer, NodeToolbar, Position, type NodeProps } from '@xyflow/react'
import { useCanvasEditor } from '../CanvasEditorContext'
import type { CanvasFlowNode } from '../editor-types'
import { normalizeCanvasStudioSummary } from '../studio-types'

export function Studio3DNode({ id, data, selected }: NodeProps<CanvasFlowNode>) {
  const editor = useCanvasEditor()
  const studio = normalizeCanvasStudioSummary(data.studioSummary, data.studioScene)
  return (
    <article className={`nori-canvas-node nori-canvas-studio-node${selected ? ' is-selected' : ''}`}>
      <NodeResizer isVisible={selected && !editor.readOnly} minWidth={300} minHeight={220} lineClassName="nori-canvas-resize-line" handleClassName="nori-canvas-resize-handle" />
      <NodeToolbar isVisible={selected} position={Position.Top} offset={34} className="nori-canvas-node-toolbar">
        <button type="button" title={editor.readOnly ? '查看导演台' : '进入导演台'} onClick={() => editor.runNodeAction(id, 'studio_3d')}><Maximize2 /><span>{editor.readOnly ? '查看导演台' : '进入导演台'}</span></button>
        <button type="button" title={studio.captureCount > 0 ? '批量下载截图' : '暂无可下载截图'} disabled={studio.captureCount === 0} onClick={() => editor.runNodeAction(id, 'download')}><Download /></button>
      </NodeToolbar>
      <header className="nori-canvas-node-label"><Camera /><button type="button" className="nodrag" onDoubleClick={() => editor.runNodeAction(id, 'studio_3d')}>{data.title || '3D 导演台'}</button></header>
      <button type="button" className="nodrag nori-canvas-studio-node-body" onDoubleClick={() => editor.runNodeAction(id, 'studio_3d')}>
        <div className="nori-canvas-studio-node-scene">
          <span className="is-axis-x" /><span className="is-axis-y" /><span className="is-grid" />
          <i><Cuboid /></i><i><Box /></i><i><Camera /></i>
        </div>
        <div className="nori-canvas-studio-node-meta"><strong>3D 导演台</strong><span>{studio.objectCount} 个模型 · {studio.cameraCount} 个机位 · {studio.captureCount} 张截图</span><small>{studio.hasPanorama ? '已连接 720 全景背景' : '未连接全景图'}</small></div>
      </button>
      <Handle type="source" position={Position.Left} id="input" className="nori-canvas-handle" isConnectable={!editor.readOnly} />
      <Handle type="source" position={Position.Right} id="output" className="nori-canvas-handle" isConnectable={!editor.readOnly} />
    </article>
  )
}
