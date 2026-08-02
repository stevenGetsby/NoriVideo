'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Box,
  Captions,
  Download,
  Film,
  GalleryHorizontal,
  Globe2,
  History,
  ImageIcon,
  Maximize2,
  MoreHorizontal,
  Music2,
  Paintbrush,
  RefreshCw,
  Sparkles,
  Star,
  Type,
  Upload,
  X,
} from '@/components/ui/icons'
import {
  Handle,
  NodeResizer,
  NodeToolbar,
  Position,
  type NodeProps,
} from '@xyflow/react'
import { MediaImage } from '@/components/media/MediaImage'
import { toDisplayImageUrl } from '@/lib/media/image-url'
import { useCanvasEditor, type CanvasNodeAction } from '../CanvasEditorContext'
import type { CanvasFlowNode } from '../editor-types'
import { CanvasModel3DViewer } from '../components/CanvasModel3D'
import { CanvasMediaPreviewDialog } from '../components/CanvasMediaPreviewDialog'
import { isCanvasPanoramaNodeData } from '../types'
import type { CanvasGenerationReferenceSummary } from '../types'

const ICONS = {
  text: Type,
  image: ImageIcon,
  video: Film,
  audio: Music2,
  model3d: Box,
} as const

export const CANVAS_REPLACE_CONTENT_EVENT = 'nori:canvas-replace-content'

function displayType(node: CanvasFlowNode) {
  if (node.type === 'model_3d') return 'model3d'
  if (node.type === 'studio_3d') return 'model3d'
  if (node.type === 'note') return 'text'
  return node.data.mediaType || node.type || 'image'
}

function actionButton(action: CanvasNodeAction, title: string, icon: typeof Download) {
  return { action, title, icon }
}

const PRIMARY_ACTIONS = [
  actionButton('preview', '全屏预览', Maximize2),
  actionButton('download', '下载', Download),
  actionButton('favorite', '收藏', Star),
  actionButton('history', '生成历史', History),
]

function derivativeActions(type: string) {
  if (type === 'image') {
    return [
      actionButton('superresolve', '超清', Maximize2),
      actionButton('panorama_720', '720 全景', Globe2),
      actionButton('image_edit', '涂抹改图', Paintbrush),
      actionButton('grid_split', '宫格切分', GalleryHorizontal),
    ]
  }
  if (type === 'video') {
    return [
      actionButton('superresolve', '超清', Maximize2),
      actionButton('subtitle_erase', '去字幕', Captions),
    ]
  }
  if (type === 'model3d') return [actionButton('studio_3d', '进入 3D 预览', Box)]
  return []
}

function TextContent({ id, value, readOnly }: { id: string; value: string; readOnly: boolean }) {
  const editor = useCanvasEditor()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => setDraft(value), [value])
  useEffect(() => { if (editing) ref.current?.focus() }, [editing])

  const save = () => {
    setEditing(false)
    if (draft !== value) editor.updateNodeData(id, { text: draft }, '编辑文本')
  }

  if (editing && !readOnly) {
    return (
      <textarea
        ref={ref}
        className="nodrag nowheel nori-canvas-text-editor"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={save}
        onKeyDown={(event) => {
          if (event.key === 'Escape') { setDraft(value); setEditing(false) }
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') save()
        }}
      />
    )
  }
  return (
    <button
      type="button"
      className="nori-canvas-text-preview"
      onDoubleClick={() => !readOnly && setEditing(true)}
    >
      {value.trim() || <span>（双击编辑文本）</span>}
    </button>
  )
}

function EmptyMedia({ type }: { type: string }) {
  const Icon = type === 'video' ? Film : type === 'audio' ? Music2 : type === 'model3d' ? Box : ImageIcon
  return <div className="nori-canvas-empty-media"><Icon /><span>（空{type === 'video' ? '视频' : type === 'audio' ? '音频' : type === 'model3d' ? '3D 模型' : '图片'}节点）</span></div>
}

function ReferencePreview({ reference }: { reference: CanvasGenerationReferenceSummary }) {
  const src = toDisplayImageUrl(reference.previewUrl || null)
  if (src && reference.type === 'image') {
    return <MediaImage src={src} alt="" fill sizes="34px" style={{ objectFit: 'cover' }} />
  }
  if (src && reference.type === 'video') {
    return <video src={src} muted playsInline preload="metadata" />
  }
  const Icon = reference.type === 'audio' ? Music2 : reference.type === 'video' ? Film : ImageIcon
  return <Icon />
}

export function CreativeNode(props: NodeProps<CanvasFlowNode>) {
  const { id, data, selected } = props
  const editor = useCanvasEditor()
  const mediaType = displayType(props as unknown as CanvasFlowNode)
  const Icon = ICONS[mediaType as keyof typeof ICONS] || ImageIcon
  const status = data.__server?.status || 'IDLE'
  const imageUrl = toDisplayImageUrl(data.contentUrl || data.imageUrl || data.posterUrl || null)
  const videoUrl = toDisplayImageUrl(data.contentUrl || data.videoUrl || null)
  const audioUrl = toDisplayImageUrl(data.audioUrl || data.contentUrl || null)
  const hasContent = mediaType === 'text'
    ? Boolean(data.text?.trim())
    : Boolean(imageUrl || videoUrl || audioUrl || data.modelUrl)
  const canReplaceContent = !editor.readOnly && ['image', 'video', 'audio', 'model3d'].includes(mediaType)
  const isPanorama = mediaType === 'image' && isCanvasPanoramaNodeData(data)
  const canPreviewPanorama = Boolean(isPanorama && imageUrl && status !== 'RUNNING')
  const actions = useMemo(() => {
    const available = hasContent
      ? [
      ...PRIMARY_ACTIONS.filter((action) => {
        if (action.action === 'preview') return ['image', 'video', 'audio'].includes(mediaType)
        if (action.action === 'favorite') return Boolean(data.materialId)
        if (action.action === 'history') return Boolean(data.history?.length)
        return true
      }),
      ...(canPreviewPanorama ? [actionButton('panorama_preview', '全景预览', Globe2)] : []),
      ...derivativeActions(mediaType),
      ]
      : []
    if (!editor.readOnly) return available
    return available.filter(({ action }) => (
      action === 'preview'
      || action === 'download'
      || action === 'history'
      || action === 'panorama_preview'
      || (action === 'studio_3d' && mediaType === 'model3d')
    ))
  }, [canPreviewPanorama, data.history?.length, data.materialId, editor.readOnly, hasContent, mediaType])
  const [renaming, setRenaming] = useState(false)
  const [title, setTitle] = useState(data.title || '未命名节点')
  const [moreActionsOpen, setMoreActionsOpen] = useState(false)
  const [previewReference, setPreviewReference] = useState<CanvasGenerationReferenceSummary | null>(null)
  const inlineActions = actions.filter(({ action }) => action === 'preview' || action === 'download')
  const overflowActions = actions.filter(({ action }) => action !== 'preview' && action !== 'download')
  const references = mediaType === 'video' ? data.generation?.referenceSummary || [] : []
  const previewReferenceNode = previewReference
    ? {
        id: `reference-preview:${previewReference.id}`,
        type: previewReference.type,
        position: { x: 0, y: 0 },
        data: {
          title: `@${previewReference.title}`,
          mediaType: previewReference.type,
          contentUrl: previewReference.previewUrl || null,
          origin: 'project' as const,
        },
      } satisfies CanvasFlowNode
    : null

  useEffect(() => setTitle(data.title || '未命名节点'), [data.title])
  useEffect(() => {
    if (!selected) setMoreActionsOpen(false)
  }, [selected])

  const saveTitle = () => {
    setRenaming(false)
    const next = title.trim() || '未命名节点'
    setTitle(next)
    if (next !== data.title) editor.updateNodeData(id, { title: next }, '重命名节点')
  }

  return (
    <article className={`nori-canvas-node nori-canvas-node--${mediaType}${selected ? ' is-selected' : ''}${status === 'FAILED' ? ' is-error' : ''}`}>
      <NodeResizer
        isVisible={selected && !editor.readOnly}
        keepAspectRatio={false}
        minWidth={180}
        minHeight={mediaType === 'audio' ? 110 : 120}
        lineClassName="nori-canvas-resize-line"
        handleClassName="nori-canvas-resize-handle"
      />
      <NodeToolbar isVisible={selected && (actions.length > 0 || canReplaceContent)} position={Position.Top} offset={26} className="nori-canvas-node-toolbar nodrag nowheel">
        {canReplaceContent ? (
          <button
            type="button"
            title="替换内容"
            aria-label="替换内容"
            onClick={() => window.dispatchEvent(new CustomEvent(CANVAS_REPLACE_CONTENT_EVENT, { detail: { nodeId: id } }))}
          >
            <Upload />
          </button>
        ) : null}
        {inlineActions.map(({ action, title: actionTitle, icon: ActionIcon }) => (
          <button
            type="button"
            key={action}
            title={actionTitle}
            aria-label={actionTitle}
            className={action === 'favorite' && data.isFavorited ? 'is-active' : ''}
            onClick={() => editor.runNodeAction(id, action)}
          >
            <ActionIcon />
          </button>
        ))}
        {overflowActions.length > 0 ? (
          <div className="nori-canvas-node-toolbar-more">
            <button
              type="button"
              title="更多操作"
              aria-label="更多操作"
              aria-expanded={moreActionsOpen}
              onClick={() => setMoreActionsOpen((open) => !open)}
            >
              <MoreHorizontal />
            </button>
            {moreActionsOpen ? (
              <div role="menu" aria-label="节点更多操作" className="nori-canvas-node-toolbar-menu">
                {overflowActions.map(({ action, title: actionTitle, icon: ActionIcon }) => (
                  <button
                    type="button"
                    role="menuitem"
                    key={action}
                    className={action === 'favorite' && data.isFavorited ? 'is-active' : ''}
                    onClick={() => {
                      setMoreActionsOpen(false)
                      editor.runNodeAction(id, action)
                    }}
                  >
                    <ActionIcon />
                    <span>{actionTitle}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </NodeToolbar>

      <header className="nori-canvas-node-label">
        <Icon />
        {renaming && !editor.readOnly ? (
          <input
            className="nodrag"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onBlur={saveTitle}
            onKeyDown={(event) => {
              if (event.key === 'Enter') saveTitle()
              if (event.key === 'Escape') { setTitle(data.title || '未命名节点'); setRenaming(false) }
            }}
            autoFocus
          />
        ) : (
          <button type="button" className="nori-canvas-node-drag-handle" title={editor.readOnly ? title : '拖动节点 · 双击重命名'} onDoubleClick={() => !editor.readOnly && setRenaming(true)}>{title}</button>
        )}
      </header>

      <div className="nori-canvas-node-body">
        {mediaType === 'text' ? <TextContent id={id} value={data.text || ''} readOnly={editor.readOnly} /> : null}
        {mediaType === 'image' && imageUrl ? <MediaImage src={imageUrl} alt={title} fill sizes="480px" style={{ objectFit: 'contain' }} /> : null}
        {canPreviewPanorama ? (
          <button
            type="button"
            className="nodrag nowheel nori-canvas-panorama-preview"
            aria-label="全景预览"
            title="打开 720° 全景预览"
            onClick={(event) => {
              event.stopPropagation()
              editor.runNodeAction(id, 'panorama_preview')
            }}
          >
            <Globe2 />
            <span>全景预览</span>
            <small>720°</small>
          </button>
        ) : null}
        {mediaType === 'video' && videoUrl ? <video src={videoUrl} poster={imageUrl || undefined} controls playsInline className="nodrag nowheel" /> : null}
        {mediaType === 'video' && references.length > 0 ? (
          <div className="nori-canvas-reference-strip" aria-label="视频引用素材">
            {references.slice(0, 4).map((reference) => (
              <button
                type="button"
                className="nodrag nowheel"
                key={`${reference.role || 'REF'}:${reference.id}`}
                title={`放大预览 @${reference.title}`}
                aria-label={`放大预览 @${reference.title}`}
                onClick={(event) => {
                  event.stopPropagation()
                  setPreviewReference(reference)
                }}
              >
                <i><ReferencePreview reference={reference} /></i>
                <b>@{reference.title}</b>
              </button>
            ))}
            {references.length > 4 ? <em>+{references.length - 4}</em> : null}
          </div>
        ) : null}
        {mediaType === 'audio' && audioUrl ? <div className="nori-canvas-audio"><Music2 /><audio src={audioUrl} controls className="nodrag nowheel" /></div> : null}
        {mediaType === 'model3d' && data.modelUrl ? <CanvasModel3DViewer src={toDisplayImageUrl(data.modelUrl) || data.modelUrl} compact /> : null}
        {mediaType !== 'text' && !hasContent ? <EmptyMedia type={mediaType} /> : null}

        {status === 'RUNNING' ? (
          <div className="nori-canvas-node-progress">
            <Sparkles className="animate-pulse" />
            <span title={data.pollErrorMessage || undefined}>{data.progress || 0}%{data.pollErrorMessage ? ' · 状态读取异常，正在重试' : ''}</span>
            <i><b style={{ width: `${data.progress || 3}%` }} /></i>
            {!editor.readOnly && data.generationTask?.taskId ? (
              <button type="button" className="nodrag" onClick={() => editor.runNodeAction(id, 'cancel_generation')}>
                <X />取消任务
              </button>
            ) : null}
          </div>
        ) : null}
        {status === 'FAILED' ? (
          editor.readOnly
            ? <div className="nodrag nori-canvas-node-error"><RefreshCw />{data.errorMessage || '生成失败'}</div>
            : <button type="button" className="nodrag nori-canvas-node-error" onClick={() => editor.runNodeAction(id, data.generationTask?.taskId ? 'retry_generation_task' : 'regenerate')}><RefreshCw />{data.errorMessage || '生成失败，点击重试'}</button>
        ) : null}
      </div>

      <Handle type="source" position={Position.Left} id="input" className="nori-canvas-handle" isConnectable={!editor.readOnly} />
      <Handle type="source" position={Position.Right} id="output" className="nori-canvas-handle" isConnectable={!editor.readOnly} />
      {previewReferenceNode && typeof document !== 'undefined'
        ? createPortal(
            <CanvasMediaPreviewDialog node={previewReferenceNode} onClose={() => setPreviewReference(null)} />,
            document.body,
          )
        : null}
    </article>
  )
}
