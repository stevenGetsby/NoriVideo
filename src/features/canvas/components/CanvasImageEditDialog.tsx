'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Brush, Eraser, Focus, LoaderCircle, Redo2, RotateCcw, Trash2, Undo2, X } from '@/components/ui/icons'
import { MediaImage } from '@/components/media/MediaImage'
import { toDisplayImageUrl } from '@/lib/media/image-url'
import type { CanvasFlowNode } from '../editor-types'

export type CanvasMaskPoint = { x: number; y: number }
export type CanvasMaskTool = 'paint' | 'rectangle' | 'erase'
export type CanvasMaskAction =
  | { kind: 'stroke'; points: CanvasMaskPoint[]; width: number; mode: 'paint' | 'erase' }
  | { kind: 'rectangle'; start: CanvasMaskPoint; end: CanvasMaskPoint }

export function normalizeCanvasMaskRectangle(start: CanvasMaskPoint, end: CanvasMaskPoint) {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  }
}

export function isCanvasMaskActionDrawable(action: CanvasMaskAction) {
  if (action.kind === 'stroke') return action.points.length > 0
  const rectangle = normalizeCanvasMaskRectangle(action.start, action.end)
  return rectangle.width >= 0.002 && rectangle.height >= 0.002
}

export function renderCanvasMaskActions(
  context: CanvasRenderingContext2D,
  actions: CanvasMaskAction[],
  width: number,
  height: number,
  pixelRatio: number,
) {
  context.fillStyle = '#000'
  context.fillRect(0, 0, width, height)
  context.lineCap = 'round'
  context.lineJoin = 'round'
  for (const action of actions) {
    if (!isCanvasMaskActionDrawable(action)) continue
    if (action.kind === 'rectangle') {
      const rectangle = normalizeCanvasMaskRectangle(action.start, action.end)
      context.fillStyle = '#fff'
      context.fillRect(rectangle.x * width, rectangle.y * height, rectangle.width * width, rectangle.height * height)
      continue
    }
    context.strokeStyle = action.mode === 'erase' ? '#000' : '#fff'
    context.lineWidth = action.width * pixelRatio
    context.beginPath()
    context.moveTo(action.points[0].x * width, action.points[0].y * height)
    action.points.slice(1).forEach((point) => context.lineTo(point.x * width, point.y * height))
    if (action.points.length === 1) context.lineTo(action.points[0].x * width + 0.1, action.points[0].y * height + 0.1)
    context.stroke()
  }
}

function canvasBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('蒙版导出失败')), 'image/png'))
}

export function CanvasImageEditDialog({
  node,
  onSubmit,
  onClose,
}: {
  node: CanvasFlowNode
  onSubmit: (input: { prompt: string; maskFile: File }) => Promise<void>
  onClose: () => void
}) {
  const imageUrl = toDisplayImageUrl(node.data.contentUrl || node.data.imageUrl || null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const actionsRef = useRef<CanvasMaskAction[]>([])
  const redoRef = useRef<CanvasMaskAction[]>([])
  const activeActionRef = useRef<CanvasMaskAction | null>(null)
  const [prompt, setPrompt] = useState('')
  const [brushSize, setBrushSize] = useState(32)
  const [tool, setTool] = useState<CanvasMaskTool>('paint')
  const [actionCount, setActionCount] = useState(0)
  const [redoCount, setRedoCount] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const renderMask = useCallback(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return
    const wrapRect = wrap.getBoundingClientRect()
    const imageRect = wrap.querySelector('img')?.getBoundingClientRect()
    const rect = imageRect && imageRect.width > 0 && imageRect.height > 0 ? imageRect : wrapRect
    canvas.style.left = `${rect.left - wrapRect.left}px`
    canvas.style.top = `${rect.top - wrapRect.top}px`
    canvas.style.width = `${rect.width}px`
    canvas.style.height = `${rect.height}px`
    const ratio = Math.min(2, window.devicePixelRatio || 1)
    const width = Math.max(1, Math.round(rect.width * ratio))
    const height = Math.max(1, Math.round(rect.height * ratio))
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height }
    const context = canvas.getContext('2d')
    if (!context) return
    renderCanvasMaskActions(context, actionsRef.current, width, height, ratio)
  }, [])

  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    renderMask()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(renderMask)
    observer.observe(wrap)
    const image = wrap.querySelector('img')
    if (image) observer.observe(image)
    return () => observer.disconnect()
  }, [imageUrl, renderMask])

  const point = (event: React.PointerEvent<HTMLCanvasElement>): CanvasMaskPoint | null => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return null
    return { x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) }
  }

  const clear = () => { actionsRef.current = []; redoRef.current = []; activeActionRef.current = null; setActionCount(0); setRedoCount(0); renderMask() }
  const undo = () => {
    const action = actionsRef.current.pop()
    if (action) redoRef.current.push(action)
    setActionCount(actionsRef.current.length)
    setRedoCount(redoRef.current.length)
    renderMask()
  }
  const redo = () => {
    const action = redoRef.current.pop()
    if (action) actionsRef.current.push(action)
    setActionCount(actionsRef.current.length)
    setRedoCount(redoRef.current.length)
    renderMask()
  }

  const submit = async () => {
    if (!prompt.trim()) { setError('请描述要修改的内容。'); return }
    if (!actionsRef.current.some(isCanvasMaskActionDrawable)) { setError('请先在图片上涂抹或框选需要修改的区域。'); return }
    const canvas = canvasRef.current
    if (!canvas) return
    setSubmitting(true)
    setError(null)
    try {
      const blob = await canvasBlob(canvas)
      await onSubmit({ prompt: prompt.trim(), maskFile: new File([blob], `${node.data.title || 'image'}-mask.png`, { type: 'image/png' }) })
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '创建改图任务失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="nori-canvas-dialog-scrim" onMouseDown={(event) => { if (event.currentTarget === event.target && !submitting) onClose() }}>
      <div className="nori-canvas-dialog nori-canvas-image-edit-dialog">
        <header><span><Brush />改图 · {node.data.title || '图片节点'}</span><button type="button" title="关闭" disabled={submitting} onClick={onClose}><X /></button></header>
        <div className="nori-canvas-image-edit-body">
          <div className="nori-canvas-image-edit-stage">
            <div ref={wrapRef} className="nori-canvas-image-edit-wrap">
              {imageUrl ? <MediaImage src={imageUrl} alt="" draggable={false} onLoad={renderMask} width={1280} height={720} /> : null}
              <canvas
                ref={canvasRef}
                onPointerDown={(event) => {
                  const next = point(event)
                  if (!next) return
                  event.currentTarget.setPointerCapture(event.pointerId)
                  const action: CanvasMaskAction = tool === 'rectangle'
                    ? { kind: 'rectangle', start: next, end: next }
                    : { kind: 'stroke', points: [next], width: brushSize, mode: tool }
                  redoRef.current = []
                  actionsRef.current.push(action)
                  activeActionRef.current = action
                  setActionCount(actionsRef.current.length)
                  setRedoCount(0)
                  renderMask()
                }}
                onPointerMove={(event) => {
                  const active = activeActionRef.current
                  if (!active || !event.currentTarget.hasPointerCapture(event.pointerId)) return
                  const next = point(event)
                  if (!next) return
                  if (active.kind === 'rectangle') active.end = next
                  else active.points.push(next)
                  renderMask()
                }}
                onPointerUp={() => {
                  const active = activeActionRef.current
                  if (active && !isCanvasMaskActionDrawable(active)) actionsRef.current.pop()
                  activeActionRef.current = null
                  setActionCount(actionsRef.current.length)
                  renderMask()
                }}
                onPointerCancel={() => {
                  const active = activeActionRef.current
                  if (active && !isCanvasMaskActionDrawable(active)) actionsRef.current.pop()
                  activeActionRef.current = null
                  setActionCount(actionsRef.current.length)
                  renderMask()
                }}
              />
            </div>
            <div className="nori-canvas-image-edit-toolbar"><button type="button" className={tool === 'paint' ? 'is-active' : ''} disabled={submitting} onClick={() => setTool('paint')}><Brush />画笔</button><button type="button" className={tool === 'rectangle' ? 'is-active' : ''} disabled={submitting} onClick={() => setTool('rectangle')}><Focus />框选</button><button type="button" className={tool === 'erase' ? 'is-active' : ''} disabled={submitting} onClick={() => setTool('erase')}><Eraser />橡皮擦</button><input type="range" min={8} max={90} value={brushSize} disabled={tool === 'rectangle' || submitting} onChange={(event) => setBrushSize(Number(event.target.value))} /><b>{tool === 'rectangle' ? '—' : `${brushSize}px`}</b><i /><button type="button" disabled={actionCount === 0 || submitting} onClick={undo}><Undo2 />撤销</button><button type="button" disabled={redoCount === 0 || submitting} onClick={redo}><Redo2 />重做</button><button type="button" disabled={(actionCount === 0 && redoCount === 0) || submitting} onClick={clear}><Trash2 />清除</button></div>
          </div>
          <aside className="nori-canvas-image-edit-settings"><h3>修改描述</h3><textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="例如：把选中区域的红色外套改成深蓝色西装，保持人物身份、姿态、光影和背景不变" /><div className="nori-canvas-image-edit-tip"><RotateCcw /><span>画笔和框选会添加白色蒙版，橡皮擦用于减去蒙版；提交后会创建新节点，原图不会被覆盖。</span></div>{error ? <div className="nori-canvas-generator-error">{error}</div> : null}<div className="nori-canvas-image-operation-actions"><button type="button" disabled={submitting} onClick={onClose}>取消</button><button type="button" className="is-primary" disabled={submitting || !imageUrl} onClick={() => void submit()}>{submitting ? <LoaderCircle className="animate-spin" /> : <Brush />}{submitting ? '正在保存蒙版…' : '创建改图节点'}</button></div></aside>
        </div>
      </div>
    </div>
  )
}
