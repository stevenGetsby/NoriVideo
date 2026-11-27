'use client'

import { createContext, useContext, useState, type CSSProperties } from 'react'
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import { AlertTriangle, ArrowUpRight, PenLine, Play, Star, Trash2, X } from '@/components/ui/icons'
import { ViewportDialogLayer } from '@/components/frameos/ViewportDialogLayer'
import { Link } from '@/i18n/navigation'
import { chapterHref } from '@/lib/interactive/routes'
import { STORY_CHAPTER_STATUSES, type StoryChapterMeta, type StoryChapterStatus, type StoryStart } from '@/lib/interactive/types'
import { generativeCoverStyle } from '@/lib/ui/generative-cover'
import { CHAPTER_STATUS_LABEL, chapterMonogram, ENTRY_HANDLE_PREFIX, EXIT_HANDLE_PREFIX, type OverviewChapter } from './story-overview-model'

export type ChapterMapActions = {
  readOnly: boolean
  workId: string
  start: StoryStart | null
  onStatus: (projectId: string, status: StoryChapterStatus) => void
  onSetStart: (projectId: string, entryNodeId: string) => void
  onEdit: (projectId: string, input: { name: string; description: string | null }) => Promise<void>
  onDelete: (projectId: string) => void
}

export const ChapterMapContext = createContext<ChapterMapActions | null>(null)

export type ChapterNodeData = {
  chapter: OverviewChapter
  meta: StoryChapterMeta
  errors: number
  warnings: number
  focused: boolean
  segments: number
  branchSegments: number
}
export type ChapterFlowNode = Node<ChapterNodeData, 'chapter'>

const ENDING_LABEL = { good: '好结局', normal: '普通结局', bad: '坏结局', hidden: '隐藏结局' } as const

function ChapterInfoDialog({ name: initialName, description: initialDescription, onClose, onSave }: {
  name: string
  description: string | null
  onClose: () => void
  onSave: (name: string, description: string | null) => Promise<void>
}) {
  const [name, setName] = useState(initialName)
  const [description, setDescription] = useState(initialDescription ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const save = async () => {
    const trimmed = name.trim()
    if (!trimmed) { setError('请输入章节名称。'); return }
    setSaving(true)
    setError(null)
    try {
      await onSave(trimmed, description.trim() || null)
      onClose()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '保存章节失败')
      setSaving(false)
    }
  }
  return (
    <ViewportDialogLayer>
      <div className="fos-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose() }}>
        <form
          className="fos-dialog nori-ix nori-ix-dialog"
          role="dialog"
          aria-modal="true"
          aria-label="编辑章节信息"
          onSubmit={(event) => { event.preventDefault(); void save() }}
        >
          <header className="fos-dialog-head">
            <div className="fos-dialog-title">编辑章节信息</div>
            <button type="button" className="fos-dialog-x" disabled={saving} onClick={onClose} aria-label="关闭"><X /></button>
          </header>
          <div className="fos-dialog-body nori-ix-dialog-body">
            <label className="nori-ix-field">
              <span>章节名称</span>
              <input className="fos-input" value={name} maxLength={191} autoFocus disabled={saving} onChange={(event) => setName(event.target.value)} />
            </label>
            <label className="nori-ix-field">
              <span>章节简介</span>
              <textarea className="fos-input" value={description} maxLength={5000} rows={5} disabled={saving} placeholder="概括本章剧情、人物或创作说明" onChange={(event) => setDescription(event.target.value)} />
            </label>
            {error ? <p className="nori-ix-error" role="alert">{error}</p> : null}
          </div>
          <footer className="fos-dialog-foot">
            <button type="button" className="fos-btn fos-btn-ghost fos-btn-lg" disabled={saving} onClick={onClose}>取消</button>
            <button type="submit" className="fos-btn fos-btn-primary fos-btn-lg" disabled={saving}>{saving ? '保存中…' : '保存'}</button>
          </footer>
        </form>
      </div>
    </ViewportDialogLayer>
  )
}

export function StoryChapterNode({ data, selected }: NodeProps<ChapterFlowNode>) {
  const actions = useContext(ChapterMapContext)
  const { chapter, meta, errors, warnings, focused, segments, branchSegments } = data
  const nodes = chapter.graph.nodes
  const entries = nodes.filter((node) => node.kind === 'entry')
  const exits = nodes.filter((node) => node.kind === 'exit')
  const endings = nodes.flatMap((node) => (node.kind === 'ending' ? [node] : []))
  const scenes = nodes.filter((node) => node.kind === 'scene').length
  const choices = nodes.filter((node) => node.kind === 'choice' || node.kind === 'condition').length
  const start = actions?.start
  const readOnly = actions?.readOnly ?? true
  const isStartChapter = start?.projectId === chapter.projectId
  const [editorOpen, setEditorOpen] = useState(false)

  return (
    <div
      className={`nori-ix-chapter${selected ? ' is-selected' : ''}${focused ? ' is-focused' : ''}${isStartChapter ? ' is-start' : ''}`}
      style={generativeCoverStyle(chapter.projectId) as CSSProperties}
    >
      <div className="nori-ix-chapter-cover nori-gen-cover">
        <span className="nori-ix-chapter-order">第 {meta.order + 1} 章</span>
        {isStartChapter ? <span className="nori-ix-chapter-start"><Play />故事起点</span> : null}
        <span className="nori-ix-chapter-monogram" aria-hidden="true">{chapterMonogram(chapter.name)}</span>
      </div>
      <header className="nori-ix-chapter-head">
        <strong title={chapter.name}>{chapter.name}</strong>
        {!readOnly ? (
          <button
            type="button"
            className="nodrag nori-ix-chapter-edit"
            onPointerDown={(event) => event.stopPropagation()}
            aria-label="编辑章节信息"
            title="编辑章节信息"
            onClick={() => setEditorOpen(true)}
          >
            <PenLine />
          </button>
        ) : null}
        <select
          className={`nodrag nori-ix-status is-${meta.status}`}
          value={meta.status}
          disabled={readOnly}
          aria-label="章节状态"
          onChange={(event) => actions?.onStatus(chapter.projectId, event.target.value as StoryChapterStatus)}
        >
          {STORY_CHAPTER_STATUSES.map((status) => <option key={status} value={status}>{CHAPTER_STATUS_LABEL[status]}</option>)}
        </select>
      </header>
      <div className="nori-ix-chapter-stats">
        <span><b>{scenes}</b>剧情</span>
        <span><b>{choices}</b>分支</span>
        <span><b>{segments}</b>作品片段</span>
        {branchSegments ? <span><b>{branchSegments}</b>支线片段</span> : null}
        <span><b>{endings.length}</b>结局</span>
        {errors || warnings ? (
          <span className={errors ? 'is-error' : 'is-warning'}><AlertTriangle />{errors || warnings}</span>
        ) : null}
      </div>
      <div className="nori-ix-chapter-ports">
        <div className="nori-ix-ports is-in">
          <small>入口</small>
          {entries.length === 0 ? <em>没有入口</em> : entries.map((entry) => {
            const isStart = isStartChapter && start?.entryNodeId === entry.id
            return (
              <div key={entry.id} className={`nori-ix-port is-entry${isStart ? ' is-start' : ''}`}>
                <Handle type="target" position={Position.Left} id={`${ENTRY_HANDLE_PREFIX}${entry.id}`} className="nori-ix-handle is-entry" isConnectable={!readOnly} />
                <span title={entry.title}>{entry.title || '入口'}</span>
                <button
                  type="button"
                  className="nodrag"
                  disabled={readOnly || isStart}
                  aria-label={isStart ? '当前故事起点' : '设为故事起点'}
                  title={isStart ? '当前故事起点' : '设为故事起点'}
                  onClick={() => actions?.onSetStart(chapter.projectId, entry.id)}
                >
                  <Star />
                </button>
              </div>
            )
          })}
        </div>
        <div className="nori-ix-ports is-out">
          <small>出口 / 结局</small>
          {exits.length + endings.length === 0 ? <em>没有出口</em> : null}
          {exits.map((exit) => (
            <div key={exit.id} className="nori-ix-port is-exit">
              <span title={exit.title}>{exit.title || '出口'}</span>
              <Handle type="source" position={Position.Right} id={`${EXIT_HANDLE_PREFIX}${exit.id}`} className="nori-ix-handle is-exit" isConnectable={!readOnly} />
            </div>
          ))}
          {endings.map((ending) => (
            <div key={ending.id} className={`nori-ix-port is-ending is-${ending.endingType}`}>
              <span title={ending.title}>{ending.title || ENDING_LABEL[ending.endingType]}</span>
              <i>{ENDING_LABEL[ending.endingType]}</i>
            </div>
          ))}
        </div>
      </div>
      <footer className="nori-ix-chapter-foot">
        <span>{chapter.nodeCount} 个节点{chapter.runningCount ? ` · ${chapter.runningCount} 个生成中` : ''}</span>
        {chapter.canvasId && actions ? (
          <Link className="nodrag" href={chapterHref(actions.workId, chapter.projectId, chapter.canvasId)}>
            打开章节画布<ArrowUpRight />
          </Link>
        ) : null}
      </footer>
      {actions && !readOnly ? (
        <button
          type="button"
          className="nodrag nori-ix-chapter-delete"
          onPointerDown={(event) => event.stopPropagation()}
          aria-label="删除章节"
          title="删除章节"
          onClick={() => actions.onDelete(chapter.projectId)}
        >
          <Trash2 />删除章节
        </button>
      ) : null}
      {editorOpen && actions ? (
        <ChapterInfoDialog
          name={chapter.name}
          description={chapter.description}
          onClose={() => setEditorOpen(false)}
          onSave={(name, description) => actions.onEdit(chapter.projectId, { name, description })}
        />
      ) : null}
    </div>
  )
}
