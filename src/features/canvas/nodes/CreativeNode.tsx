'use client'

import { sanitizePublicError } from '@/lib/errors/sanitize-public-error'

import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  AlertTriangle,
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
  useStore,
  type NodeProps,
} from '@xyflow/react'
import { CanvasPosterImage, CanvasPreviewImage } from './CanvasPreviewImage'
import { toCanvasDisplayImageUrl, toDisplayImageUrl, toPlayableVideoUrl, toVideoPosterUrl } from '@/lib/media/image-url'
import { useCanvasEditor, useCanvasMultiSelection, type CanvasNodeAction } from '../CanvasEditorContext'
import { selectZoomBucket } from '../zoom-bucket'
import type { CanvasFlowNode } from '../editor-types'
import { CanvasModel3DViewer } from '../components/CanvasModel3D'
import { CanvasMediaPreviewDialog } from '../components/CanvasMediaPreviewDialog'
import { CanvasNodeVideo } from './CanvasNodeVideo'
import { CanvasNodeVideoPoster } from './CanvasNodeVideoPoster'
import { recallPlayback } from '../media-playback'
import { CANVAS_RENDER_BUDGET } from '../rendering/canvas-render-budget'
import { ViewportPopover } from '@/components/ui/viewport-popover'
import { getCanvasNodeCurrentCostLabel, isCanvasPanoramaNodeData } from '../types'
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
      actionButton('audio_extract', '提取音频', Music2),
    ]
  }
  if (type === 'model3d') return [actionButton('studio_3d', '进入 3D 预览', Box)]
  return []
}

import CanvasTextContent from './CanvasTextContent'

function EmptyMedia({ type }: { type: string }) {
  const Icon = type === 'video' ? Film : type === 'audio' ? Music2 : type === 'model3d' ? Box : ImageIcon
  return <div className="nori-canvas-empty-media"><Icon /><span>（空{type === 'video' ? '视频' : type === 'audio' ? '音频' : type === 'model3d' ? '3D 模型' : '图片'}节点）</span></div>
}

function ReferencePreview({ reference }: { reference: CanvasGenerationReferenceSummary }) {
  const src = toDisplayImageUrl(reference.previewUrl || null)
  if (src && reference.type === 'image') {
    return <CanvasPreviewImage src={src} alt="" fill sizes="34px" style={{ objectFit: 'cover' }} />
  }
  if (src && reference.type === 'video') {
    const poster = toVideoPosterUrl(reference.previewUrl, 480)
    return poster
      ? <CanvasPosterImage src={poster} alt="" loading="lazy" decoding="async" />
      : <video src={toPlayableVideoUrl(reference.previewUrl) || src} muted playsInline preload="none" />
  }
  const Icon = reference.type === 'audio' ? Music2 : reference.type === 'video' ? Film : ImageIcon
  return <Icon />
}

const COLLAPSED_REFERENCE_COUNT = 4

type MountedVideoEntry = { id: string; isPlaying: () => boolean; demote: () => void }
const mountedVideoCards = new Map<string, MountedVideoEntry>()

function registerMountedVideoCard(entry: MountedVideoEntry) {
  mountedVideoCards.delete(entry.id)
  mountedVideoCards.set(entry.id, entry)
  if (mountedVideoCards.size <= CANVAS_RENDER_BUDGET.maxPlayingInstances) return
  for (const [key, candidate] of mountedVideoCards) {
    if (mountedVideoCards.size <= CANVAS_RENDER_BUDGET.maxPlayingInstances) break
    if (key === entry.id || candidate.isPlaying()) continue
    mountedVideoCards.delete(key)
    candidate.demote()
  }
}

export const CreativeNode = memo(function CreativeNode(props: NodeProps<CanvasFlowNode>) {
  const { id, data, selected } = props
  const editor = useCanvasEditor()
  const multiSelected = useCanvasMultiSelection()
  const chromeVisible = selected && !multiSelected
  const mediaType = displayType(props as unknown as CanvasFlowNode)
  const Icon = ICONS[mediaType as keyof typeof ICONS] || ImageIcon
  const status = data.__server?.status || 'IDLE'
  const imageSource = mediaType === 'image'
    ? data.contentUrl || data.imageUrl || data.posterUrl || null
    : data.posterUrl || data.imageUrl || null
  const originalImageUrl = toDisplayImageUrl(imageSource)
  const zoomBucket = useStore(selectZoomBucket)
  const [imageUrl, setImageUrl] = useState(() => toCanvasDisplayImageUrl(imageSource, 480))
  const imageContainerRef = useRef<HTMLDivElement>(null)
  const videoUrl = toPlayableVideoUrl(data.videoUrl || data.contentUrl || null)
  const audioUrl = toDisplayImageUrl(data.audioUrl || data.contentUrl || null)
  const hasContent = mediaType === 'text'
    ? Boolean(data.text?.trim())
    : mediaType === 'video' ? Boolean(videoUrl)
      : mediaType === 'audio' ? Boolean(audioUrl)
        : mediaType === 'model3d' ? Boolean(data.modelUrl)
          : Boolean(imageUrl)
  const canReplaceContent = !editor.readOnly && ['image', 'video', 'audio', 'model3d'].includes(mediaType)
  const isPanorama = mediaType === 'image' && isCanvasPanoramaNodeData(data)
  const canPreviewPanorama = Boolean(isPanorama && imageUrl && status !== 'RUNNING')
  const actions = useMemo(() => {
    const available = hasContent
      ? [
      ...PRIMARY_ACTIONS.filter((action) => {
        if (action.action === 'preview') return ['image', 'video', 'audio'].includes(mediaType)
        if (action.action === 'favorite') return Boolean(data.materialId)
        if (action.action === 'history') return Boolean(data.historyCount ?? data.history?.length)
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
  }, [canPreviewPanorama, data.historyCount, data.history?.length, data.materialId, editor.readOnly, hasContent, mediaType])
  const [renaming, setRenaming] = useState(false)
  const [title, setTitle] = useState(data.title || '未命名节点')
  const [moreActionsOpen, setMoreActionsOpen] = useState(false)
  const moreActionsRef = useRef<HTMLButtonElement>(null)
  const toolbarRef = useRef<HTMLDivElement | null>(null)
  const lastImageWidthRef = useRef(480)
  const scheduleImageWidthRef = useRef<(() => void) | null>(null)
  const videoPlayingRef = useRef(false)
  const [previewReference, setPreviewReference] = useState<CanvasGenerationReferenceSummary | null>(null)
  const [videoFailed, setVideoFailed] = useState(false)
  const [videoActive, setVideoActive] = useState(() => Boolean(videoUrl && recallPlayback(videoUrl)?.playing))
  const [videoAttempt, setVideoAttempt] = useState(0)
  useEffect(() => { setVideoFailed(false); setVideoAttempt(0) }, [videoUrl])
  useEffect(() => {
    if (!videoActive || mediaType !== 'video' || !videoUrl) {
      mountedVideoCards.delete(id)
      videoPlayingRef.current = false
      return
    }
    registerMountedVideoCard({
      id,
      isPlaying: () => videoPlayingRef.current,
      demote: () => setVideoActive(false),
    })
    return () => {
      mountedVideoCards.delete(id)
      videoPlayingRef.current = false
    }
  }, [id, mediaType, videoActive, videoUrl])
  const inlineActions = mediaType === 'image'
    ? actions
    : actions.filter(({ action }) => action === 'preview' || action === 'download')
  const overflowActions = mediaType === 'image'
    ? []
    : actions.filter(({ action }) => action !== 'preview' && action !== 'download')
  const references = mediaType === 'video' ? data.generation?.referenceSummary || [] : []
  const hiddenReferenceCount = references.length - COLLAPSED_REFERENCE_COUNT
  const visibleReferences = references.slice(0, COLLAPSED_REFERENCE_COUNT)
  const currentCost = getCanvasNodeCurrentCostLabel(data, mediaType)
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
    if (!chromeVisible) setMoreActionsOpen(false)
  }, [chromeVisible])
  useEffect(() => {
    lastImageWidthRef.current = 480
    setImageUrl(toCanvasDisplayImageUrl(imageSource, 480))
    if (!originalImageUrl || !imageContainerRef.current) {
      scheduleImageWidthRef.current = null
      return
    }
    const element = imageContainerRef.current
    let frame = 0
    const update = () => {
      frame = 0
      const displayedWidth = element.getBoundingClientRect().width * (window.devicePixelRatio || 1)
      const width = displayedWidth <= 480 ? 480 : displayedWidth <= 960 ? 960 : 1440
      if (width === lastImageWidthRef.current) return
      lastImageWidthRef.current = width
      setImageUrl(toCanvasDisplayImageUrl(originalImageUrl, width))
    }
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update) }
    scheduleImageWidthRef.current = schedule
    const observer = new ResizeObserver(schedule)
    observer.observe(element)
    schedule()
    return () => {
      if (scheduleImageWidthRef.current === schedule) scheduleImageWidthRef.current = null
      observer.disconnect()
      if (frame) cancelAnimationFrame(frame)
    }
  }, [originalImageUrl])
  useEffect(() => {
    scheduleImageWidthRef.current?.()
  }, [zoomBucket])
  useLayoutEffect(() => {
    if (!chromeVisible || mediaType !== 'image') return
    const toolbar = toolbarRef.current?.parentElement
    if (!toolbar) return
    const surface = toolbar.closest('.nori-canvas-workspace')
    if (!(toolbar instanceof HTMLElement) || !(surface instanceof HTMLElement)) return
    const node = surface.querySelector(`.react-flow__node[data-id="${id}"]`)
    const flowViewport = surface.querySelector('.react-flow__viewport')
    const chrome = surface.querySelector('.nori-canvas-chrome')
    if (!(node instanceof HTMLElement)) return
    let frame = 0
    let lastLeft = Number.parseFloat(toolbar.style.left) || 0
    let lastTop = Number.parseFloat(toolbar.style.top) || 0
    const keepVisible = () => {
      frame = 0
      const nodeBounds = node.getBoundingClientRect()
      const bounds = surface.getBoundingClientRect()
      const toolbarBounds = toolbar.getBoundingClientRect()
      const offsetParent = toolbar.offsetParent instanceof HTMLElement
        ? toolbar.offsetParent
        : null
      if (!offsetParent) return
      const parentBounds = offsetParent.getBoundingClientRect()
      const margin = 8
      const parentScaleX = parentBounds.width > 0
        ? offsetParent.offsetWidth / parentBounds.width
        : 1
      const parentScaleY = parentBounds.height > 0
        ? offsetParent.offsetHeight / parentBounds.height
        : 1
      const currentLeft = Number.parseFloat(toolbar.style.left) || 0
      const currentTop = Number.parseFloat(toolbar.style.top) || 0
      // Correct from the natural DOM position, never from the current offset.
      // NodeToolbar's internal measurements can lag behind the real node DOM.
      const naturalLeft = toolbarBounds.left - currentLeft / parentScaleX
      const naturalTop = toolbarBounds.top - currentTop / parentScaleY
      const desiredCenter = Math.min(
        Math.max(nodeBounds.left + nodeBounds.width / 2, bounds.left + margin + toolbarBounds.width / 2),
        bounds.right - margin - toolbarBounds.width / 2,
      )
      const chromeBounds = chrome?.getBoundingClientRect()
      const topBoundary = chromeBounds && chromeBounds.bottom > bounds.top
        ? chromeBounds.bottom
        : bounds.top
      let desiredTop = nodeBounds.top - 26 - toolbarBounds.height
      if (desiredTop < topBoundary + margin) {
        desiredTop = nodeBounds.bottom + margin
      }
      desiredTop = Math.min(desiredTop, bounds.bottom - margin - toolbarBounds.height)
      desiredTop = Math.max(desiredTop, bounds.top + margin)
      const nextLeft = (desiredCenter - toolbarBounds.width / 2 - naturalLeft) * parentScaleX
      const nextTop = (desiredTop - naturalTop) * parentScaleY
      if (Math.abs(nextLeft - lastLeft) > 1) {
        lastLeft = nextLeft
        toolbar.style.left = `${nextLeft}px`
      }
      if (Math.abs(nextTop - lastTop) > 1) {
        lastTop = nextTop
        toolbar.style.top = `${nextTop}px`
      }
    }
    const schedule = () => { if (!frame) frame = requestAnimationFrame(keepVisible) }
    schedule()
    const resizeObserver = new ResizeObserver(schedule)
    resizeObserver.observe(toolbar)
    resizeObserver.observe(node)
    resizeObserver.observe(surface)
    const transformObserver = new MutationObserver(schedule)
    const renderer = toolbar.parentElement
    transformObserver.observe(toolbar, { attributes: true, attributeFilter: ['style'] })
    transformObserver.observe(node, { attributes: true, attributeFilter: ['style'] })
    if (renderer) transformObserver.observe(renderer, { attributes: true, attributeFilter: ['style'] })
    if (flowViewport) transformObserver.observe(flowViewport, { attributes: true, attributeFilter: ['style'] })
    window.addEventListener('resize', schedule)
    return () => {
      if (frame) cancelAnimationFrame(frame)
      resizeObserver.disconnect()
      transformObserver.disconnect()
      window.removeEventListener('resize', schedule)
      toolbar.style.left = ''
      toolbar.style.top = ''
    }
  }, [actions.length, canReplaceContent, id, mediaType, chromeVisible])

  const saveTitle = () => {
    setRenaming(false)
    const next = title.trim() || '未命名节点'
    setTitle(next)
    if (next !== data.title) editor.updateNodeData(id, { title: next }, '重命名节点')
  }

  return (
    <article className={`nori-canvas-node nori-canvas-node--${mediaType}${selected ? ' is-selected' : ''}${status === 'FAILED' ? ' is-error' : ''}`}>
      <NodeResizer
        isVisible={chromeVisible && !editor.readOnly}
        keepAspectRatio={false}
        minWidth={180}
        minHeight={mediaType === 'audio' ? 110 : 120}
        lineClassName="nori-canvas-resize-line"
        handleClassName="nori-canvas-resize-handle"
      />
      <NodeToolbar isVisible={chromeVisible && (actions.length > 0 || canReplaceContent)} position={Position.Top} offset={26} className={`nori-canvas-node-toolbar nori-canvas-node-toolbar--${mediaType}${mediaType === 'image' || mediaType === 'video' || mediaType === 'model_3d' ? ' nori-force-dark' : ''} nodrag nowheel`} onPointerDown={(event) => event.stopPropagation()}>
        <div ref={toolbarRef} className="nori-canvas-node-toolbar-anchor" aria-hidden="true" />
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
              ref={moreActionsRef}
              type="button"
              title="更多操作"
              aria-label="更多操作"
              aria-expanded={moreActionsOpen}
              onClick={() => setMoreActionsOpen((open) => !open)}
            >
              <MoreHorizontal />
            </button>
            {moreActionsOpen ? (
              <ViewportPopover anchorRef={moreActionsRef} onClose={() => setMoreActionsOpen(false)} width={200} role="menu" aria-label="节点更多操作" className="nori-canvas-node-toolbar-menu">
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
              </ViewportPopover>
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
        {currentCost ? (
          <span className="nori-canvas-node-cost" title={currentCost.kind === 'actual' ? `实际消耗 ${currentCost.points} 积分` : `预计消耗 ${currentCost.points} 积分`}>
            {currentCost.kind === 'actual' ? '实际' : '预计'} {currentCost.points} 积分
          </span>
        ) : null}
      </header>

      <div ref={imageContainerRef} className="nori-canvas-node-body">
        {mediaType !== 'text' ? <span className="nori-canvas-node-drag-frame" title="拖动节点" aria-hidden="true" /> : null}
        {mediaType === 'text' ? <CanvasTextContent id={id} value={data.text || ''} marks={data.textMarks} readOnly={editor.readOnly} /> : null}
        {mediaType === 'image' && imageUrl ? <CanvasPreviewImage src={imageUrl} alt={title} fill sizes="480px" style={{ objectFit: 'contain' }} onError={() => { if (originalImageUrl) setImageUrl(originalImageUrl) }} /> : null}
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
        {mediaType === 'video' && videoUrl ? (
          <>
            {videoActive ? <CanvasNodeVideo key={`${videoUrl}:${videoAttempt}`} src={videoUrl} poster={imageUrl || undefined} autoPlay onExpand={() => editor.runNodeAction(id, 'preview')} onLoadedData={() => setVideoFailed(false)} onError={() => setVideoFailed(true)} onPlayingChange={(isPlaying) => { videoPlayingRef.current = isPlaying }} onOffscreenPause={() => setVideoActive(false)} /> : <CanvasNodeVideoPoster posterUrl={imageUrl || toVideoPosterUrl(data.videoUrl || data.contentUrl, 480)} onPlay={() => setVideoActive(true)} />}
            {videoFailed ? <div className="nori-canvas-video-load-error nodrag nowheel" role="status"><Film /><span>视频已生成，播放加载失败</span><button type="button" onClick={(event) => { event.stopPropagation(); setVideoFailed(false); setVideoAttempt((value) => value + 1) }}><RefreshCw />重新加载</button><button type="button" onClick={() => editor.runNodeAction(id, 'preview')}>打开预览</button></div> : null}
          </>
        ) : null}
        {mediaType === 'video' && references.length > 0 ? (
          <div className="nori-canvas-reference-strip nowheel" aria-label={`视频引用素材，共 ${references.length} 项`}>
            <div className="nori-canvas-reference-thumbnails">
              {visibleReferences.map((reference) => (
                <button
                  type="button"
                  className="nodrag nowheel"
                  key={`${reference.role || 'REF'}:${reference.id}`}
                  data-canvas-reference-node-id={reference.id}
                  title={`放大预览 @${reference.title}`}
                  aria-label={`放大预览 @${reference.title}`}
                  onClick={(event) => {
                    event.stopPropagation()
                    setPreviewReference(reference)
                  }}
                >
                  <i><ReferencePreview reference={reference} /></i>
                </button>
              ))}
            </div>
            {hiddenReferenceCount > 0 ? (
              <span className="nori-canvas-reference-count" title="在提示词框中查看全部引用">+{hiddenReferenceCount}</span>
            ) : null}
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
          // Display-only on purpose: a one-click retry here was mis-triggered and re-submitted paid generations.
          <div className="nodrag nori-canvas-node-error" role="alert"><AlertTriangle />{sanitizePublicError(data.errorMessage || '生成失败')}</div>
        ) : null}
        {status === 'FAILED' && data.cgtid ? <div className="nodrag nori-canvas-node-error">cgtid：{data.cgtid}（向上游反馈时提供）</div> : null}
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
})
