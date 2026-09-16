'use client'

import type { KeyboardEvent } from 'react'
import Box from 'lucide-react/dist/esm/icons/box.js'
import Camera from 'lucide-react/dist/esm/icons/camera.js'
import Cuboid from 'lucide-react/dist/esm/icons/cuboid.js'
import Download from 'lucide-react/dist/esm/icons/download.js'
import Maximize2 from 'lucide-react/dist/esm/icons/maximize-2.js'
import { Handle, NodeResizer, NodeToolbar, Position, type NodeProps } from '@xyflow/react'
import { useCanvasEditor } from '../CanvasEditorContext'
import type { CanvasFlowNode } from '../editor-types'
import { normalizeCanvasStudioSummary, STUDIO_NODE_MIN_SIZE } from '../studio-types'

export function Studio3DNode({ id, data, selected }: NodeProps<CanvasFlowNode>) {
  const editor = useCanvasEditor()
  const studio = normalizeCanvasStudioSummary(data.studioSummary, data.studioScene)
  const openStudio = () => editor.runNodeAction(id, 'studio_3d')
  const openFromKeyboard = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    event.stopPropagation()
    openStudio()
  }
  const openHint = editor.readOnly ? '双击查看导演台' : '拖动节点 · 双击进入导演台'
  return (
    <article className={`nori-canvas-node nori-canvas-studio-node${selected ? ' is-selected' : ''}${editor.readOnly ? ' is-readonly' : ''}`}>
      <NodeResizer isVisible={selected && !editor.readOnly} minWidth={STUDIO_NODE_MIN_SIZE.width} minHeight={STUDIO_NODE_MIN_SIZE.height} lineClassName="nori-canvas-resize-line" handleClassName="nori-canvas-resize-handle" />
      <NodeToolbar isVisible={selected} position={Position.Top} offset={34} className="nori-canvas-node-toolbar nodrag nowheel">
        <button type="button" title={editor.readOnly ? '查看导演台' : '进入导演台'} onClick={() => editor.runNodeAction(id, 'studio_3d')}><Maximize2 /><span>{editor.readOnly ? '查看导演台' : '进入导演台'}</span></button>
        <button type="button" title={studio.captureCount > 0 ? '批量下载截图' : '暂无可下载截图'} disabled={studio.captureCount === 0} onClick={() => editor.runNodeAction(id, 'download')}><Download /></button>
      </NodeToolbar>
      <header className="nori-canvas-node-label">
        <Camera />
        <button type="button" className="nori-canvas-node-drag-handle" title={`${data.title || '3D 导演台'} · ${openHint}`} onDoubleClick={openStudio} onKeyDown={openFromKeyboard}>{data.title || '3D 导演台'}</button>
      </header>
      <div className="nori-canvas-studio-node-body" role="button" tabIndex={0} aria-label={`3D 导演台预览，${openHint}`} title={openHint} onDoubleClick={openStudio} onKeyDown={openFromKeyboard}>
        <div className="nori-canvas-studio-node-scene" aria-hidden="true">
          <span className="is-axis-x" /><span className="is-axis-y" /><span className="is-grid" />
          <i><Cuboid /></i><i><Box /></i><i><Camera /></i>
        </div>
        <div className="nori-canvas-studio-node-meta">
          <strong>3D 导演台</strong>
          <div className="nori-canvas-studio-node-stats">
            <span>{studio.objectCount} 个模型</span>
            <span>{studio.cameraCount} 个机位</span>
            <span>{studio.captureCount} 张截图</span>
          </div>
          <small>{studio.hasPanorama ? '已连接 720 全景背景' : '未连接全景图'}</small>
        </div>
      </div>
      <Handle type="source" position={Position.Left} id="input" className="nori-canvas-handle" isConnectable={!editor.readOnly} />
      <Handle type="source" position={Position.Right} id="output" className="nori-canvas-handle" isConnectable={!editor.readOnly} />
    </article>
  )
}
