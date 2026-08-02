'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Download, Grid2X2, Group, ListTree, Rows3, Save, Ungroup } from '@/components/ui/icons'
import { NodeResizer, NodeToolbar, Position, useReactFlow, type NodeProps, type ShouldResize } from '@xyflow/react'
import { useCanvasEditor } from '../CanvasEditorContext'
import type { CanvasFlowNode } from '../editor-types'
import { canResizeCanvasGroupToMembers } from '../actions/layout'

const DEFAULT_GROUP_COLOR = '#64748b'
const GROUP_COLORS: Array<string | null> = [
  null,
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#14b8a6',
  '#3b82f6',
  '#6366f1',
  '#ec4899',
  '#9ca3af',
]

export function GroupNode({ id, data, selected }: NodeProps<CanvasFlowNode>) {
  const editor = useCanvasEditor()
  const flow = useReactFlow<CanvasFlowNode>()
  const [renaming, setRenaming] = useState(false)
  const [title, setTitle] = useState(data.title || '组')
  const [openMenu, setOpenMenu] = useState<'color' | 'arrange' | null>(null)
  const toolbarRef = useRef<HTMLDivElement>(null)
  useEffect(() => setTitle(data.title || '组'), [data.title])
  useEffect(() => {
    if (!openMenu) return
    const closeOutside = (event: PointerEvent) => {
      if (!toolbarRef.current?.contains(event.target as Node)) setOpenMenu(null)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenMenu(null)
    }
    document.addEventListener('pointerdown', closeOutside, true)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOutside, true)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [openMenu])

  const save = () => {
    setRenaming(false)
    const next = title.trim() || '组'
    setTitle(next)
    editor.updateNodeData(id, { title: next }, '重命名组')
  }
  const shouldResize = useCallback<ShouldResize>((_event, nextRect) => (
    canResizeCanvasGroupToMembers(flow.getNodes(), id, nextRect)
  ), [flow, id])

  return (
    <section className={`nori-canvas-group${selected ? ' is-selected' : ''}`} style={{ '--group-color': data.groupColor || '#64748b' } as React.CSSProperties}>
      <span className="nori-canvas-group-drag-edge is-top" aria-hidden="true" />
      <span className="nori-canvas-group-drag-edge is-right" aria-hidden="true" />
      <span className="nori-canvas-group-drag-edge is-bottom" aria-hidden="true" />
      <span className="nori-canvas-group-drag-edge is-left" aria-hidden="true" />
      <NodeResizer isVisible={selected && !editor.readOnly} minWidth={260} minHeight={180} shouldResize={shouldResize} lineClassName="nori-canvas-resize-line" handleClassName="nori-canvas-resize-handle" />
      <NodeToolbar isVisible={selected} position={Position.Top} offset={8} className="nori-canvas-group-toolbar">
        {!editor.readOnly ? <>
          <div ref={toolbarRef} className="nori-canvas-group-toolbar-inner">
            <div className="nori-canvas-group-toolbar-item">
              <button type="button" className={`is-icon-only${openMenu === 'color' ? ' is-active' : ''}`} aria-label="切换背景色" title="切换背景色" onClick={() => setOpenMenu((current) => current === 'color' ? null : 'color')}><span className="nori-canvas-group-color-dot" style={{ '--swatch': data.groupColor || DEFAULT_GROUP_COLOR } as React.CSSProperties} /></button>
              {openMenu === 'color' ? <div className="nori-canvas-group-popover is-colors">{GROUP_COLORS.map((color) => <button type="button" key={color || 'default'} aria-label={color ? `背景色 ${color}` : '默认色'} className={(data.groupColor ?? null) === color ? 'is-current' : ''} style={{ '--swatch': color || DEFAULT_GROUP_COLOR } as React.CSSProperties} onClick={() => { editor.updateNodeData(id, { groupColor: color }, '修改组背景色'); setOpenMenu(null) }}><span /></button>)}</div> : null}
            </div>
            <div className="nori-canvas-group-toolbar-item">
              <button type="button" className={`is-icon-only${openMenu === 'arrange' ? ' is-active' : ''}`} aria-label="整理组内节点" title="整理组内节点" onClick={() => setOpenMenu((current) => current === 'arrange' ? null : 'arrange')}><Rows3 /></button>
              {openMenu === 'arrange' ? <div className="nori-canvas-group-popover is-arrange"><button type="button" onClick={() => { editor.runNodeAction(id, 'arrange_vertical'); setOpenMenu(null) }}><Rows3 /><span>纵向整理（推荐）</span></button><button type="button" onClick={() => { editor.runNodeAction(id, 'arrange_grid'); setOpenMenu(null) }}><Grid2X2 /><span>宫格排列</span></button><button type="button" onClick={() => { editor.runNodeAction(id, 'arrange_horizontal'); setOpenMenu(null) }}><ListTree /><span>水平排列</span></button></div> : null}
            </div>
          </div>
          <i className="nori-canvas-group-toolbar-divider" />
          <button type="button" onClick={() => editor.runNodeAction(id, 'save_workflow')}><Save /><span>保存工作流</span></button>
        </> : null}
        <button type="button" onClick={() => editor.runNodeAction(id, 'download')}><Download /><span>批量下载</span></button>
        {!editor.readOnly ? <button type="button" onClick={() => editor.removeNodes([id])}><Ungroup /><span>解组</span></button> : null}
      </NodeToolbar>
      <header className="nori-canvas-group-header nori-canvas-group-drag-handle">
        <Group />
        {renaming && !editor.readOnly ? <input className="nodrag" value={title} onChange={(event) => setTitle(event.target.value)} onBlur={save} onKeyDown={(event) => { if (event.key === 'Enter') save() }} autoFocus /> : <button type="button" className="nodrag" onDoubleClick={() => !editor.readOnly && setRenaming(true)}>{title}</button>}
        <span>{data.memberIds?.length || 0} 个节点</span>
      </header>
    </section>
  )
}
