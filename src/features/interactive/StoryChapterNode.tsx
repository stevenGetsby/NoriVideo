'use client'

import { createContext, useContext, type CSSProperties } from 'react'
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import { AlertTriangle, ArrowUpRight, Play, Star } from '@/components/ui/icons'
import { Link } from '@/i18n/navigation'
import { STORY_CHAPTER_STATUSES, type StoryChapterMeta, type StoryChapterStatus, type StoryStart } from '@/lib/interactive/types'
import { generativeCoverStyle } from '@/lib/ui/generative-cover'
import { CHAPTER_STATUS_LABEL, chapterMonogram, ENTRY_HANDLE_PREFIX, EXIT_HANDLE_PREFIX, type OverviewChapter } from './story-overview-model'

export type ChapterMapActions = {
  readOnly: boolean
  start: StoryStart | null
  onStatus: (projectId: string, status: StoryChapterStatus) => void
  onSetStart: (projectId: string, entryNodeId: string) => void
}

export const ChapterMapContext = createContext<ChapterMapActions | null>(null)

export type ChapterNodeData = {
  chapter: OverviewChapter
  meta: StoryChapterMeta
  errors: number
  warnings: number
  focused: boolean
}
export type ChapterFlowNode = Node<ChapterNodeData, 'chapter'>

const ENDING_LABEL = { good: '好结局', normal: '普通结局', bad: '坏结局', hidden: '隐藏结局' } as const

export function StoryChapterNode({ data, selected }: NodeProps<ChapterFlowNode>) {
  const actions = useContext(ChapterMapContext)
  const { chapter, meta, errors, warnings, focused } = data
  const nodes = chapter.graph.nodes
  const entries = nodes.filter((node) => node.kind === 'entry')
  const exits = nodes.filter((node) => node.kind === 'exit')
  const endings = nodes.flatMap((node) => (node.kind === 'ending' ? [node] : []))
  const scenes = nodes.filter((node) => node.kind === 'scene').length
  const choices = nodes.filter((node) => node.kind === 'choice' || node.kind === 'condition').length
  const start = actions?.start
  const readOnly = actions?.readOnly ?? true
  const isStartChapter = start?.projectId === chapter.projectId

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
        {chapter.canvasId ? (
          <Link className="nodrag" href={`/canvas/${encodeURIComponent(chapter.projectId)}/${encodeURIComponent(chapter.canvasId)}`}>
            打开画布<ArrowUpRight />
          </Link>
        ) : null}
      </footer>
    </div>
  )
}
