'use client'

import { useEffect, useRef, useState } from 'react'
import { Captions, LoaderCircle, Maximize2, RotateCcw, ScanText, X } from '@/components/ui/icons'
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

export type CanvasVideoOperationInput =
  | {
      operation: 'subtitle_erase'
      mode: 'subtitle' | 'text'
      region: { x: number; y: number; width: number; height: number }
      engineKey?: string
      modelKey?: string
    }
  | {
      operation: 'video_superresolve'
      target: '2x' | '720p' | '1080p' | '2k' | '4k'
      interpolate: boolean
      engineKey?: string
      modelKey?: string
    }

export type CanvasVideoOperationMode = CanvasVideoOperationInput['operation']

const SUBTITLE_REGION = { x: 0.05, y: 0.78, width: 0.9, height: 0.18 }
const TEXT_REGION = { x: 0.05, y: 0.05, width: 0.9, height: 0.9 }

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

export function CanvasVideoOperationDialog({
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
  mode: CanvasVideoOperationMode
  node: CanvasFlowNode
  onSubmit: (input: CanvasVideoOperationInput, onTaskUpdate?: (update: CanvasOperationTaskUpdate) => void) => Promise<void>
  onRecover: (input: CanvasVideoOperationInput, result: ResolvedCanvasOperation) => Promise<void>
  isTaskMaterialized: (taskId: string) => boolean
  onClose: () => void
}) {
  const { generationAllowed } = useAccountBalance()
  const videoUrl = toDisplayImageUrl(node.data.contentUrl || node.data.videoUrl || null)
  const stageRef = useRef<HTMLDivElement>(null)
  const [eraseMode, setEraseMode] = useState<'subtitle' | 'text'>('subtitle')
  const [region, setRegion] = useState(SUBTITLE_REGION)
  const [videoAspect, setVideoAspect] = useState(16 / 9)
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null)
  const [target, setTarget] = useState<'2x' | '720p' | '1080p' | '2k' | '4k'>('1080p')
  const [interpolate, setInterpolate] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [taskActionBusy, setTaskActionBusy] = useState(false)
  const [taskUpdate, setTaskUpdate] = useState<CanvasOperationTaskUpdate | null>(null)
  const [engines, setEngines] = useState<Array<{ engineKey: string; modelKey: string; label: string; description: string; isDefault: boolean }>>([])
  const [engineKey, setEngineKey] = useState('')
  const [error, setError] = useState<string | null>(null)
  const operationsEndpoint = `/api/projects/${encodeURIComponent(projectId)}/canvas/${encodeURIComponent(canvasId)}/operations`

  useEffect(() => {
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

  const selectedEngine = engines.find((engine) => engine.engineKey === engineKey) || null
  const taskActive = taskUpdate?.task.status === 'queued' || taskUpdate?.task.status === 'processing'

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !submitting) onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose, submitting])

  const pointFromEvent = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = stageRef.current?.getBoundingClientRect()
    if (!rect) return null
    return {
      x: clamp((event.clientX - rect.left) / rect.width, 0, 1),
      y: clamp((event.clientY - rect.top) / rect.height, eraseMode === 'subtitle' ? 0.5 : 0, 1),
    }
  }

  const resetRegion = (nextMode = eraseMode) => {
    setEraseMode(nextMode)
    setRegion(nextMode === 'subtitle' ? SUBTITLE_REGION : TEXT_REGION)
  }

  const buildInput = (): CanvasVideoOperationInput => mode === 'subtitle_erase'
    ? { operation: 'subtitle_erase', mode: eraseMode, region, engineKey: selectedEngine?.engineKey || undefined, modelKey: selectedEngine?.modelKey || undefined }
    : { operation: 'video_superresolve', target, interpolate, engineKey: selectedEngine?.engineKey || undefined, modelKey: selectedEngine?.modelKey || undefined }

  const submit = async () => {
    if (!generationAllowed) { setError('积分不足，无法生成'); return }
    setSubmitting(true)
    setError(null)
    try {
      await onSubmit(buildInput(), setTaskUpdate)
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '视频处理失败')
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

  return (
    <div className="nori-canvas-dialog-scrim nori-canvas-video-operation-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget && !submitting) onClose() }}>
      <section className="nori-canvas-dialog nori-canvas-video-operation-dialog" role="dialog" aria-modal="true" aria-label={`${mode === 'subtitle_erase' ? '视频去字幕' : '视频增强'} · ${node.data.title || '视频节点'}`} onPointerDown={(event) => event.stopPropagation()}>
        <header>
          <div>
            <i>{mode === 'subtitle_erase' ? <Captions /> : <Maximize2 />}</i>
            <span><strong>{mode === 'subtitle_erase' ? '视频去字幕' : '视频增强'}</strong><small>{node.data.title || '视频节点'}</small></span>
          </div>
          <button type="button" title="关闭" disabled={submitting} onClick={onClose}><X /></button>
        </header>

        {mode === 'subtitle_erase' ? (
          <>
            <div className="nori-canvas-video-operation-modes">
              <button type="button" className={eraseMode === 'subtitle' ? 'is-active' : ''} onClick={() => resetRegion('subtitle')}><Captions />字幕模式</button>
              <button type="button" className={eraseMode === 'text' ? 'is-active' : ''} onClick={() => resetRegion('text')}><ScanText />文字模式</button>
              <span>{eraseMode === 'subtitle' ? '仅可框选画面下半区；不框选默认擦除底部字幕区' : '可在整个画面框选；适合水印或画面文字'}</span>
            </div>
            <div className="nori-canvas-video-operation-stage-wrap">
              <div
                ref={stageRef}
                className="nori-canvas-video-operation-stage"
                style={{ aspectRatio: String(videoAspect) }}
                onPointerDown={(event) => {
                  const point = pointFromEvent(event)
                  if (!point) return
                  event.currentTarget.setPointerCapture(event.pointerId)
                  setDragStart(point)
                  setRegion({ x: point.x, y: point.y, width: 0.02, height: 0.02 })
                }}
                onPointerMove={(event) => {
                  if (!dragStart) return
                  const point = pointFromEvent(event)
                  if (!point) return
                  const x = Math.min(dragStart.x, point.x)
                  const y = Math.min(dragStart.y, point.y)
                  setRegion({ x, y, width: Math.max(0.02, Math.abs(point.x - dragStart.x)), height: Math.max(0.02, Math.abs(point.y - dragStart.y)) })
                }}
                onPointerUp={(event) => {
                  if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
                  setDragStart(null)
                }}
              >
                {videoUrl ? <video src={videoUrl} controls playsInline onLoadedMetadata={(event) => { const video = event.currentTarget; if (video.videoWidth && video.videoHeight) setVideoAspect(video.videoWidth / video.videoHeight) }} /> : <div className="nori-canvas-video-operation-missing">视频文件不可用</div>}
                <div className="nori-canvas-video-operation-shade" />
                <div className="nori-canvas-video-operation-region" style={{ left: `${region.x * 100}%`, top: `${region.y * 100}%`, width: `${region.width * 100}%`, height: `${region.height * 100}%` }}><span>擦除区域</span></div>
              </div>
            </div>
            <div className="nori-canvas-video-operation-region-info"><span>区域</span><b>X {Math.round(region.x * 100)}%</b><b>Y {Math.round(region.y * 100)}%</b><b>W {Math.round(region.width * 100)}%</b><b>H {Math.round(region.height * 100)}%</b><button type="button" onClick={() => resetRegion()}><RotateCcw />重置</button></div>
          </>
        ) : (
          <div className="nori-canvas-video-enhance-body">
            <div className="nori-canvas-video-enhance-preview">{videoUrl ? <video src={videoUrl} controls playsInline /> : <span>视频文件不可用</span>}</div>
            <div className="nori-canvas-video-enhance-settings">
              <label><span>目标清晰度</span><select value={target} onChange={(event) => setTarget(event.target.value as typeof target)}><option value="2x">原尺寸 2×</option><option value="720p">720p</option><option value="1080p">1080p</option><option value="2k">2K</option><option value="4k">4K</option></select></label>
              <label className="is-check"><input type="checkbox" checked={interpolate} onChange={(event) => setInterpolate(event.target.checked)} /><span><strong>运动补帧至 60fps</strong><small>使用运动估计插帧，处理时间会明显增加</small></span></label>
              <p>增强会保留原视频声音，使用高质量缩放、细节锐化和 H.264 重新编码；结果会作为新素材写回画布。</p>
            </div>
          </div>
        )}

        <div className="nori-canvas-video-operation-engine">
          <label><span>处理引擎</span><select value={engineKey} onChange={(event) => setEngineKey(event.target.value)}>{engines.map((engine) => <option key={engine.engineKey} value={engine.engineKey}>{engine.label}</option>)}</select></label>
          <small>{selectedEngine?.description || '使用项目服务配置中的可用视频处理引擎'}</small>
        </div>

        {taskUpdate ? <CanvasOperationTaskProgress update={taskUpdate} engineLabel={selectedEngine?.label} materialized={isTaskMaterialized(taskUpdate.task.id)} actionBusy={taskActionBusy} onCancel={() => void cancelTask()} onRetry={() => void retryTask()} onRecover={() => void recoverTask()} /> : null}

        {error ? <div className="nori-canvas-video-operation-error">{error}</div> : null}
        <footer><button type="button" disabled={submitting} onClick={onClose}>取消</button><button type="button" className="is-primary" disabled={!generationAllowed || submitting || taskActive || !videoUrl || (engines.length > 0 && !selectedEngine)} title={!generationAllowed ? '积分不足，无法生成' : undefined} onClick={() => void submit()}>{submitting || taskActive ? <LoaderCircle className="animate-spin" /> : mode === 'subtitle_erase' ? <Captions /> : <Maximize2 />}{submitting || taskActive ? '后台处理中…' : !generationAllowed ? '积分不足' : mode === 'subtitle_erase' ? '开始去字幕' : '开始增强'}</button></footer>
      </section>
    </div>
  )
}
