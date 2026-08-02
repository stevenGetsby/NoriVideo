'use client'

import { AppIcon } from '@/components/ui/icons'
import type { CanvasOperationTaskUpdate } from '../operation-task-client'

const STAGE_LABELS: Record<string, string> = {
  canvas_operation_queued: '等待处理资源',
  canvas_operation_download: '读取源素材',
  canvas_operation_process: '正在处理画面',
  canvas_operation_upload: '上传处理结果',
  canvas_operation_persist: '写入素材与历史',
}

function statusLabel(status: CanvasOperationTaskUpdate['task']['status']) {
  if (status === 'queued') return '排队中'
  if (status === 'processing') return '处理中'
  if (status === 'completed') return '处理完成'
  if (status === 'canceled') return '已取消'
  return '处理失败'
}

export function CanvasOperationTaskProgress({
  update,
  engineLabel,
  materialized,
  actionBusy,
  onCancel,
  onRetry,
  onRecover,
}: {
  update: CanvasOperationTaskUpdate
  engineLabel?: string
  materialized?: boolean
  actionBusy?: boolean
  onCancel: () => void
  onRetry: () => void
  onRecover: () => void
}) {
  const { task } = update
  const active = task.status === 'queued' || task.status === 'processing'
  const failed = task.status === 'failed' || task.status === 'canceled'
  const progress = Math.max(0, Math.min(100, Math.round(task.progress || 0)))
  const displayedProgress = task.status === 'completed' ? 100 : progress
  const rawStageLabel = task.stageLabel?.trim() || ''
  const stage = (rawStageLabel && !/^(?:progress\.|[a-z][\w.-]*_[\w.-]+)/i.test(rawStageLabel) ? rawStageLabel : null)
    || (task.stage ? STAGE_LABELS[task.stage] : null)
    || statusLabel(task.status)

  return (
    <section
      className={`nori-canvas-operation-task is-${task.status}`}
      aria-label={`画布处理任务：${statusLabel(task.status)}`}
      aria-live="polite"
      aria-busy={active}
    >
      <header>
        <i><AppIcon name={active ? 'loader' : failed ? 'alert' : 'check'} className={active ? 'animate-spin' : ''} /></i>
        <span><strong>{statusLabel(task.status)}</strong><small>{engineLabel || task.modelKey || task.engineKey || '本地处理引擎'}</small></span>
        <b>{active ? `${displayedProgress}%` : task.status === 'completed' ? '100%' : '—'}</b>
      </header>
      <div
        className="nori-canvas-operation-task-bar"
        role="progressbar"
        aria-label={stage}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={displayedProgress}
        aria-valuetext={`${statusLabel(task.status)}，${displayedProgress}%`}
      ><i style={{ width: `${active ? Math.max(3, displayedProgress) : displayedProgress}%` }} /></div>
      <div className="nori-canvas-operation-task-stage"><span>{stage}</span><small>任务 {task.id.slice(0, 8)}</small></div>
      {task.error?.message ? <p role="alert">{task.error.message}</p> : null}
      <footer>
        {active && task.canCancel ? <button type="button" disabled={actionBusy} onClick={onCancel}><AppIcon name="close" />取消任务</button> : null}
        {failed && task.canRetry ? <button type="button" disabled={actionBusy} onClick={onRetry}><AppIcon name="refresh" />重试任务</button> : null}
        {task.status === 'completed' && !materialized ? <button type="button" className="is-primary" disabled={actionBusy} onClick={onRecover}><AppIcon name="download" />载入画布</button> : null}
        {task.status === 'completed' && materialized ? <span><AppIcon name="check" />结果已在画布中</span> : null}
      </footer>
    </section>
  )
}
