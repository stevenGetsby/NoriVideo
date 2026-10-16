'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Focus, GalleryHorizontal, LoaderCircle, Maximize2, X } from '@/components/ui/icons'
import { MediaImage } from '@/components/media/MediaImage'
import { toDisplayImageUrl } from '@/lib/media/image-url'
import type { CanvasFlowNode } from '../editor-types'
import {
  cancelCanvasOperationTask,
  loadCanvasOperationConfig,
  retryCanvasOperationTask,
  waitForCanvasOperationTask,
  type CanvasOperationTaskUpdate,
  type ResolvedCanvasOperation,
} from '../operation-task-client'
import { useAccountBalance } from '@/hooks/common/useAccountBalance'
import { CanvasOperationTaskProgress } from './CanvasOperationTaskProgress'

export type CanvasImageOperationMode = 'grid_split' | 'lens_focus' | 'superresolve'

export type CanvasImageOperationInput =
  | { operation: 'grid_split'; rows: number; cols: number; selectedCells: Array<{ row: number; col: number }> }
  | { operation: 'lens_focus'; crop: { x: number; y: number; width: number; height: number } }
  | { operation: 'superresolve'; scale: 2 | 4; engineKey?: string; modelKey?: string }

const GRID_PRESETS = [
  { rows: 2, cols: 2 },
  { rows: 3, cols: 3 },
  { rows: 1, cols: 3 },
  { rows: 3, cols: 1 },
  { rows: 4, cols: 4 },
]

function clamp(value: number) {
  return Math.max(0, Math.min(1, value))
}

function gridCellKeys(rows: number, cols: number) {
  return Array.from({ length: rows * cols }, (_, index) => `${Math.floor(index / cols)}:${index % cols}`)
}

export function CanvasImageOperationDialog({
  projectId,
  canvasId,
  mode,
  node,
  onSubmit,
  onRecover,
  isTaskMaterialized,
  onClose,
}: {
  projectId: string
  canvasId: string
  mode: CanvasImageOperationMode
  node: CanvasFlowNode
  onSubmit: (input: CanvasImageOperationInput, onTaskUpdate?: (update: CanvasOperationTaskUpdate) => void) => Promise<void>
  onRecover: (input: CanvasImageOperationInput, result: ResolvedCanvasOperation) => Promise<void>
  isTaskMaterialized: (taskId: string) => boolean
  onClose: () => void
}) {
  const { generationAllowed, generationDisabledReason, generationDisabledLabel } = useAccountBalance()
  const imageUrl = toDisplayImageUrl(node.data.contentUrl || node.data.imageUrl || null)
  const previewRef = useRef<HTMLDivElement>(null)
  const [rows, setRows] = useState(2)
  const [cols, setCols] = useState(2)
  const [selectedCells, setSelectedCells] = useState(() => gridCellKeys(2, 2))
  const [scale, setScale] = useState<2 | 4>(2)
  const [crop, setCrop] = useState({ x: 0.2, y: 0.2, width: 0.6, height: 0.6 })
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null)
  const [aspectRatio, setAspectRatio] = useState(16 / 9)
  const [submitting, setSubmitting] = useState(false)
  const [taskActionBusy, setTaskActionBusy] = useState(false)
  const [taskUpdate, setTaskUpdate] = useState<CanvasOperationTaskUpdate | null>(null)
  const [engines, setEngines] = useState<Array<{ engineKey: string; modelKey: string; label: string; description: string; isDefault: boolean }>>([])
  const [engineKey, setEngineKey] = useState('')
  const [error, setError] = useState<string | null>(null)
  const operationsEndpoint = `/api/projects/${encodeURIComponent(projectId)}/canvas/${encodeURIComponent(canvasId)}/operations`

  useEffect(() => {
    if (mode !== 'superresolve') return
    let mounted = true
    void loadCanvasOperationConfig(operationsEndpoint, { sourceNodeId: node.id, operation: mode })
      .then((config) => {
        if (!mounted) return
        const available = config.engines.filter((engine) => engine.operation === mode)
        setEngines(available)
        setEngineKey((current) => current || available.find((engine) => engine.isDefault)?.engineKey || available[0]?.engineKey || '')
        if (config.latestTask && config.latestTaskLinks) {
          const latest = { task: config.latestTask, links: config.latestTaskLinks }
          setTaskUpdate(latest)
          if (latest.task.status === 'queued' || latest.task.status === 'processing') {
            void waitForCanvasOperationTask(latest, (next) => { if (mounted) setTaskUpdate(next) }).catch(() => undefined)
          }
        }
      })
      .catch((loadError) => { if (mounted) setError(loadError instanceof Error ? loadError.message : '加载处理引擎失败') })
    return () => { mounted = false }
  }, [mode, node.id, operationsEndpoint])

  const selectedEngine = useMemo(() => engines.find((engine) => engine.engineKey === engineKey) || null, [engineKey, engines])
  const taskActive = taskUpdate?.task.status === 'queued' || taskUpdate?.task.status === 'processing'

  const point = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = previewRef.current?.getBoundingClientRect()
    if (!rect) return null
    return {
      x: clamp((event.clientX - rect.left) / rect.width),
      y: clamp((event.clientY - rect.top) / rect.height),
    }
  }

  const setGrid = (nextRows: number, nextCols: number) => {
    setRows(nextRows)
    setCols(nextCols)
    setSelectedCells(gridCellKeys(nextRows, nextCols))
  }

  const toggleCell = (key: string) => {
    setSelectedCells((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key])
  }

  const buildInput = (): CanvasImageOperationInput => {
    if (mode === 'grid_split') return { operation: mode, rows, cols, selectedCells: selectedCells.map((key) => { const [row, col] = key.split(':').map(Number); return { row, col } }) }
    if (mode === 'lens_focus') return { operation: mode, crop }
    return { operation: mode, scale, engineKey: selectedEngine?.engineKey || undefined, modelKey: selectedEngine?.modelKey || undefined }
  }

  const submit = async () => {
    if (!generationAllowed) { setError(generationDisabledReason || '当前账号不可生成'); return }
    setSubmitting(true)
    setError(null)
    try {
      await onSubmit(buildInput(), setTaskUpdate)
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '图片处理失败')
    } finally {
      setSubmitting(false)
    }
  }

  const cancelTask = async () => {
    if (!taskUpdate) return
    setTaskActionBusy(true)
    setError(null)
    try {
      setTaskUpdate(await cancelCanvasOperationTask(taskUpdate))
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : '取消任务失败')
    } finally {
      setTaskActionBusy(false)
    }
  }

  const retryTask = async () => {
    if (!taskUpdate) return
    setTaskActionBusy(true)
    setSubmitting(true)
    setError(null)
    try {
      const resolved = await retryCanvasOperationTask(taskUpdate, setTaskUpdate)
      await onRecover(buildInput(), resolved)
    } catch (retryError) {
      setError(retryError instanceof Error ? retryError.message : '重试任务失败')
    } finally {
      setSubmitting(false)
      setTaskActionBusy(false)
    }
  }

  const recoverTask = async () => {
    if (!taskUpdate?.task.result) return
    setTaskActionBusy(true)
    setError(null)
    try {
      await onRecover(buildInput(), { ...taskUpdate.task.result, taskUpdate })
    } catch (recoverError) {
      setError(recoverError instanceof Error ? recoverError.message : '载入任务结果失败')
    } finally {
      setTaskActionBusy(false)
    }
  }

  const title = mode === 'grid_split' ? '宫格切分' : mode === 'lens_focus' ? '局部聚焦' : '图片超清'
  const Icon = mode === 'grid_split' ? GalleryHorizontal : mode === 'lens_focus' ? Focus : Maximize2

  return (
    <div className="nori-canvas-dialog-scrim" onMouseDown={(event) => { if (event.currentTarget === event.target && !submitting) onClose() }}>
      <div className="nori-canvas-dialog nori-canvas-image-operation-dialog" role="dialog" aria-modal="true" aria-label={`${title} · ${node.data.title || '图片节点'}`}>
        <header><span><Icon />{title} · {node.data.title || '图片节点'}</span><button type="button" title="关闭" disabled={submitting} onClick={onClose}><X /></button></header>
        <div className="nori-canvas-image-operation-body">
          <div className="nori-canvas-image-operation-preview-shell">
            {imageUrl ? (
              <div
                ref={previewRef}
                className={`nori-canvas-image-operation-preview is-${mode}`}
                style={{ aspectRatio }}
                onPointerDown={mode === 'lens_focus' ? (event) => {
                  const next = point(event)
                  if (!next) return
                  event.currentTarget.setPointerCapture(event.pointerId)
                  setDragStart(next)
                  setCrop({ x: next.x, y: next.y, width: 0.02, height: 0.02 })
                } : undefined}
                onPointerMove={mode === 'lens_focus' ? (event) => {
                  if (!dragStart) return
                  const next = point(event)
                  if (!next) return
                  setCrop({
                    x: Math.min(dragStart.x, next.x),
                    y: Math.min(dragStart.y, next.y),
                    width: Math.max(0.02, Math.abs(next.x - dragStart.x)),
                    height: Math.max(0.02, Math.abs(next.y - dragStart.y)),
                  })
                } : undefined}
                onPointerUp={mode === 'lens_focus' ? () => setDragStart(null) : undefined}
              >
                <MediaImage src={imageUrl} alt="" draggable={false} width={1280} height={720} onLoad={(event) => { const image = event.currentTarget; if (image.naturalWidth && image.naturalHeight) setAspectRatio(image.naturalWidth / image.naturalHeight) }} />
                {mode === 'grid_split' ? <div className="nori-canvas-grid-overlay" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)`, gridTemplateRows: `repeat(${rows}, 1fr)` }}>{gridCellKeys(rows, cols).map((key) => { const [row, col] = key.split(':').map(Number); const selected = selectedCells.includes(key); return <button type="button" key={key} className={selected ? 'is-selected' : ''} aria-label={`${selected ? '取消' : '选择'}第 ${row + 1} 行第 ${col + 1} 列`} onClick={() => toggleCell(key)}><span>{selected ? '✓' : '+'}</span></button> })}</div> : null}
                {mode === 'lens_focus' ? <div className="nori-canvas-focus-box" style={{ left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.width * 100}%`, height: `${crop.height * 100}%` }}><span>{Math.round(crop.width * 100)}% × {Math.round(crop.height * 100)}%</span></div> : null}
                {mode === 'superresolve' ? <div className="nori-canvas-upscale-preview-badge"><Maximize2 />{scale}× 超清</div> : null}
              </div>
            ) : <div className="nori-canvas-operation-empty">源图片不可用</div>}
          </div>

          <aside className="nori-canvas-image-operation-settings">
            {mode === 'grid_split' ? <>
              <h3>选择宫格</h3>
              <div className="nori-canvas-grid-presets">{GRID_PRESETS.map((preset) => <button type="button" key={`${preset.rows}x${preset.cols}`} className={rows === preset.rows && cols === preset.cols ? 'is-active' : ''} onClick={() => setGrid(preset.rows, preset.cols)}><b>{preset.rows * preset.cols} 宫格</b><span>{preset.rows} × {preset.cols}</span></button>)}</div>
              <h3>自定义</h3>
              <div className="nori-canvas-grid-custom"><label>行<select value={rows} onChange={(event) => setGrid(Number(event.target.value), cols)}>{[1, 2, 3, 4, 5, 6].map((value) => <option key={value}>{value}</option>)}</select></label><i>×</i><label>列<select value={cols} onChange={(event) => setGrid(rows, Number(event.target.value))}>{[1, 2, 3, 4, 5, 6].map((value) => <option key={value}>{value}</option>)}</select></label></div>
              <div className="nori-canvas-grid-selection"><span>已选 {selectedCells.length} / {rows * cols} 格</span><button type="button" onClick={() => setSelectedCells(gridCellKeys(rows, cols))}>全选</button><button type="button" onClick={() => setSelectedCells([])}>清空</button></div>
              <p>点击左侧格子选择需要切出的画面；结果会作为一组新图片节点落在源图右侧，并自动加入素材库。</p>
            </> : null}
            {mode === 'lens_focus' ? <><h3>框选聚焦区域</h3><p>在左侧图片上拖拽一个矩形。系统会裁出局部参考图并自动连接到当前生成节点，适合强化人物面部、服饰或关键物件细节。</p><div className="nori-canvas-focus-values"><span>X {Math.round(crop.x * 100)}%</span><span>Y {Math.round(crop.y * 100)}%</span><span>W {Math.round(crop.width * 100)}%</span><span>H {Math.round(crop.height * 100)}%</span></div></> : null}
            {mode === 'superresolve' ? <><h3>处理引擎</h3><label className="nori-canvas-operation-engine"><select aria-label="图片超清处理引擎" value={engineKey} onChange={(event) => setEngineKey(event.target.value)}>{engines.map((engine) => <option key={engine.engineKey} value={engine.engineKey}>{engine.label}</option>)}</select><small>{selectedEngine?.description || '使用作品服务配置中的可用超清引擎'}</small></label><h3>放大倍数</h3><div className="nori-canvas-scale-options">{([2, 4] as const).map((value) => <button type="button" key={value} className={scale === value ? 'is-active' : ''} onClick={() => setScale(value)}><b>{value}×</b><span>{value === 2 ? '适合常规交付' : '适合裁切与大屏'}</span></button>)}</div><p>任务会在后台异步处理，最长边限制为 8192px；关闭画布后仍可恢复进度和失败原因。</p></> : null}
            {mode === 'superresolve' && taskUpdate ? <CanvasOperationTaskProgress update={taskUpdate} engineLabel={selectedEngine?.label} materialized={isTaskMaterialized(taskUpdate.task.id)} actionBusy={taskActionBusy} onCancel={() => void cancelTask()} onRetry={() => void retryTask()} onRecover={() => void recoverTask()} /> : null}
            {rows * cols > 25 ? <div className="nori-canvas-generator-error">切片总数不能超过 25</div> : null}
            {error ? <div className="nori-canvas-generator-error">{error}</div> : null}
            <div className="nori-canvas-image-operation-actions"><button type="button" disabled={submitting} onClick={onClose}>取消</button><button type="button" className="is-primary" disabled={!generationAllowed || submitting || taskActive || !imageUrl || (mode === 'superresolve' && engines.length > 0 && !selectedEngine) || (mode === 'grid_split' && (rows * cols < 2 || rows * cols > 25 || selectedCells.length === 0))} title={!generationAllowed ? generationDisabledReason || undefined : undefined} onClick={() => void submit()}>{submitting || taskActive ? <LoaderCircle className="animate-spin" /> : <Icon />}{submitting || taskActive ? '后台处理中…' : !generationAllowed ? generationDisabledLabel : mode === 'grid_split' ? `生成 ${selectedCells.length} 张` : mode === 'lens_focus' ? '创建聚焦参考' : `生成 ${scale}× 超清图`}</button></div>
          </aside>
        </div>
      </div>
    </div>
  )
}
