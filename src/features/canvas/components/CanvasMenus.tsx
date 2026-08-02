'use client'

import { Clipboard, Copy, GitBranch, LayoutGrid, ListVideo, Plus, RefreshCw, RotateCcw, Trash2, Upload, type LucideIcon } from '@/components/ui/icons'
import { CANVAS_ADD_NODE_ITEMS, type CanvasContextMenuState, type CanvasNodeMenuType, type CanvasWireMenuState } from '../editor-types'
import { CanvasMenuPortal } from './CanvasMenuPortal'

const iconFor = (type: CanvasNodeMenuType) => CANVAS_ADD_NODE_ITEMS.find((item) => item.type === type)?.label || type

type ContextMenuItem =
  | { key: string; divider: true }
  | {
      key: string
      label: string
      icon: LucideIcon
      shortcut?: string
      hint?: string
      danger?: boolean
      disabled?: boolean
    }

export function CanvasWireMenu({ state, onPick }: { state: CanvasWireMenuState; onPick: (type: CanvasNodeMenuType) => void }) {
  return <CanvasMenuPortal><div className="nori-canvas-wire-menu" role="menu" aria-label="选择连接节点类型" style={{ left: state.x, top: state.y }} onPointerDown={(event) => event.stopPropagation()}><div>选择节点类型</div>{CANVAS_ADD_NODE_ITEMS.map((item) => <button type="button" role="menuitem" key={item.type} onClick={() => onPick(item.type)}><Plus /><span>{item.label}</span></button>)}</div></CanvasMenuPortal>
}

export function CanvasContextMenu({
  state,
  canPaste,
  canRegenerate,
  readOnly,
  onAction,
}: {
  state: CanvasContextMenuState
  canPaste: boolean
  canRegenerate: boolean
  readOnly: boolean
  onAction: (action: string) => void
}) {
  const items: ContextMenuItem[] = state.scope === 'group'
    ? readOnly ? [
      { key: 'copy', label: '复制', icon: Copy, shortcut: '⌘ C' },
    ] : [
      { key: 'copy', label: '复制', icon: Copy, shortcut: '⌘ C' },
      { key: 'duplicate', label: '创建副本', icon: GitBranch, shortcut: '⌘ D', hint: '复制组内节点及连线' },
      { key: 'divider', divider: true },
      { key: 'delete', label: '删除组及成员', icon: Trash2, shortcut: '⌫', danger: true },
    ]
    : state.scope === 'node'
    ? readOnly ? [
      { key: 'copy', label: '复制', icon: Copy, shortcut: '⌘ C' },
    ] : [
      { key: 'copy', label: '复制', icon: Copy, shortcut: '⌘ C' },
      { key: 'duplicate', label: '创建副本', icon: GitBranch, shortcut: '⌘ D', hint: '复制节点及上游连线' },
      { key: 'divider', divider: true },
      { key: 'regenerate', label: '重新生成', icon: RefreshCw, disabled: !canRegenerate },
      { key: 'divider-2', divider: true },
      { key: 'delete', label: '删除', icon: Trash2, shortcut: '⌫', danger: true },
    ]
    : state.scope === 'edge'
      ? readOnly ? [] : [{ key: 'delete-edge', label: '删除连线', icon: Trash2, danger: true }]
      : readOnly ? [
        { key: 'reset-viewport', label: '重置视图', icon: RotateCcw, shortcut: '⌘ 0' },
      ] : [
        { key: 'add-playlist', label: '添加播放列表', icon: ListVideo, hint: '顺序剪辑与最终审核节点' },
        { key: 'add-node', label: '添加节点', icon: Plus },
        { key: 'upload', label: '上传文件', icon: Upload },
        { key: 'divider', divider: true },
        { key: 'paste', label: '粘贴', icon: Clipboard, shortcut: '⌘ V', disabled: !canPaste },
        { key: 'divider-2', divider: true },
        { key: 'organize', label: '一键整理（从左到右）', icon: LayoutGrid },
        { key: 'reset-viewport', label: '重置视图', icon: RotateCcw, shortcut: '⌘ 0' },
      ]
  return (
    <CanvasMenuPortal>
      <div
        className="nori-canvas-context-menu"
        role="menu"
        aria-label={state.scope === 'node' ? '节点操作' : state.scope === 'group' ? '分组操作' : state.scope === 'edge' ? '连线操作' : '画布操作'}
        style={{ left: state.x, top: state.y }}
        onPointerDown={(event) => event.stopPropagation()}
      >
        {items.map((item) => {
          if ('divider' in item) return <i key={item.key} />
          const Icon = item.icon
          return <button type="button" role="menuitem" key={item.key} disabled={item.disabled} className={item.danger ? 'is-danger' : ''} onClick={() => onAction(item.key)}><Icon /><span>{item.label}{item.hint ? <small title={item.hint}>ⓘ</small> : null}</span>{item.shortcut ? <kbd>{item.shortcut}</kbd> : null}</button>
        })}
      </div>
    </CanvasMenuPortal>
  )
}

export function CanvasEmptyState({ readOnly, onAdd, onUpload }: { readOnly: boolean; onAdd: (type: CanvasNodeMenuType) => void; onUpload: () => void }) {
  return (
    <div className="nori-canvas-empty-state">
      <p>{readOnly ? '当前画布暂无内容 · 只读模式' : '选择一种方式开始创作'}</p>
      {readOnly ? null : <div>
          {CANVAS_ADD_NODE_ITEMS.slice(0, 3).map((item) => <button type="button" key={item.type} onClick={() => onAdd(item.type)}><Plus /><span>{iconFor(item.type)}</span></button>)}
          <button type="button" onClick={onUpload}><Upload /><span>上传文件</span></button>
        </div>}
    </div>
  )
}
