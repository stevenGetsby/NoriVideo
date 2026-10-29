'use client'

import { useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Handle, Position, useNodeId, useStore } from '@xyflow/react'
import { Plus } from '@/components/ui/icons'
import { STORY_KIND_BY_TYPE, STORY_KIND_LABEL } from '@/lib/interactive/compile'
import { STORY_FLOW_ROLE, STORY_OUTPUT_HANDLE, type StoryNodeType } from '@/lib/interactive/types'
import { useCanvasEditor } from '../CanvasEditorContext'
import { STORY_NODE_HUES, STORY_NODE_ICONS, useStoryCanvasContext } from './StoryCanvasContext'
import { STORY_MEDIA_HANDLE } from './story-connection'

export function useStoryNodeEditing(id: string) {
  const editor = useCanvasEditor()
  const story = useStoryCanvasContext()
  const readOnly = editor.readOnly
  return {
    readOnly,
    story,
    variables: story?.variables ?? [],
    manageVariables: story && !story.readOnly ? () => story.setPanel('variables') : undefined,
    patch: (patch: Record<string, unknown>, label?: string) => { if (!readOnly) editor.updateNodeData(id, patch, label) },
  }
}

type HandleSide = 'in' | 'out' | 'media'

const HANDLE_LOOK: Record<HandleSide, { position: Position; title?: string }> = {
  in: { position: Position.Left, title: '剧情从这里进入' },
  out: { position: Position.Right },
  media: { position: Position.Top, title: '画面：连接视频或图片' },
}

/** The "+" beside a free out-port answers "what happens next?" without dragging a wire. */
function StoryQuickAdd({ handleId }: { handleId: string }) {
  const nodeId = useNodeId()
  const editor = useCanvasEditor()
  const story = useStoryCanvasContext()
  const linked = useStore((state) => state.edges.some((edge) => (
    edge.source === nodeId && edge.data?.role === STORY_FLOW_ROLE && (edge.sourceHandle || STORY_OUTPUT_HANDLE) === handleId
  )))
  if (!nodeId || !story || editor.readOnly || linked) return null
  return (
    <button
      type="button"
      className="nori-story-quick-add nodrag nopan"
      aria-label="添加下一步"
      title="添加下一步（也可以从连接点拖出连线）"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation()
        const rect = event.currentTarget.getBoundingClientRect()
        story.actions.quickAdd(nodeId, handleId, { x: rect.right + 8, y: rect.top - 8 })
      }}
    >
      <Plus />
    </button>
  )
}

export function StoryHandle({ id, side }: { id: string; side: HandleSide }) {
  const editor = useCanvasEditor()
  const look = HANDLE_LOOK[side]
  return (
    <>
      <Handle
        type="source"
        id={id}
        position={look.position}
        className={`nori-story-handle is-${side}`}
        isConnectable={!editor.readOnly}
        title={editor.readOnly ? undefined : look.title}
      />
      {side === 'out' ? <StoryQuickAdd handleId={id} /> : null}
    </>
  )
}

/** Same convention as the other canvas cards: the title drags and selects the card; double-click renames it. */
function StoryTitle({ title, placeholder, readOnly, onRename }: { title: string; placeholder: string; readOnly: boolean; onRename: (title: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null)
  const cancelled = useRef(false)
  if (draft === null || readOnly) {
    return (
      <span
        className={`nori-story-node-title${title ? '' : ' is-placeholder'}`}
        title={readOnly ? title || placeholder : '拖动节点 · 双击重命名'}
        onDoubleClick={readOnly ? undefined : () => setDraft(title)}
      >
        {title || placeholder}
      </span>
    )
  }
  return (
    <input
      className="nodrag nori-story-node-title is-editing"
      value={draft}
      placeholder={placeholder}
      maxLength={40}
      aria-label={`${placeholder}名称`}
      autoFocus
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        const next = draft.trim()
        const keep = !cancelled.current
        cancelled.current = false
        setDraft(null)
        if (keep && next !== title) onRename(next)
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== 'Escape') return
        event.preventDefault()
        event.stopPropagation()
        cancelled.current = event.key === 'Escape'
        event.currentTarget.blur()
      }}
    />
  )
}

export function StoryNodeShell({ id, type, selected, title, input = true, output = false, media = false, badge, className, children }: {
  id: string
  type: StoryNodeType
  selected: boolean
  title: string
  input?: boolean
  output?: boolean
  /** Adds the top picture port (scenes). */
  media?: boolean
  badge?: ReactNode
  className?: string
  children?: ReactNode
}) {
  const { readOnly, patch } = useStoryNodeEditing(id)
  const Icon = STORY_NODE_ICONS[type]
  const kindLabel = STORY_KIND_LABEL[STORY_KIND_BY_TYPE[type]]
  return (
    <div
      className={`nori-story-node is-${type.slice(6)}${selected ? ' is-selected' : ''}${className ? ` ${className}` : ''}`}
      style={{ '--story-hue': STORY_NODE_HUES[type] } as CSSProperties}
    >
      <header className="nori-story-node-head">
        <span className="nori-story-node-icon"><Icon /></span>
        <StoryTitle title={title} placeholder={kindLabel} readOnly={readOnly} onRename={(next) => patch({ title: next }, '重命名节点')} />
        {badge ?? <span className="nori-story-node-kind">{kindLabel}</span>}
      </header>
      {children ? <div className="nori-story-node-body">{children}</div> : null}
      {input ? <StoryHandle id="input" side="in" /> : null}
      {output ? <StoryHandle id={STORY_OUTPUT_HANDLE} side="out" /> : null}
      {media ? <StoryHandle id={STORY_MEDIA_HANDLE} side="media" /> : null}
    </div>
  )
}
