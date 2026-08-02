'use client'

import { useEffect, useState } from 'react'
import { AppIcon } from '@/components/ui/icons'
import type { Canvas } from '../types'

export type CanvasManagementIntent =
  | { type: 'create'; defaultTitle: string }
  | { type: 'rename'; canvas: Canvas }
  | { type: 'delete'; canvas: Canvas }

export function CanvasManagementDialog({
  intent,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  intent: CanvasManagementIntent | null
  busy: boolean
  error: string | null
  onClose: () => void
  onSubmit: (title?: string) => Promise<void> | void
}) {
  const [title, setTitle] = useState('')
  const [validationError, setValidationError] = useState<string | null>(null)

  useEffect(() => {
    if (!intent) return
    setTitle(intent.type === 'create' ? intent.defaultTitle : intent.type === 'rename' ? intent.canvas.title : '')
    setValidationError(null)
  }, [intent])

  useEffect(() => {
    if (!intent) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || busy) return
      event.preventDefault()
      onClose()
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [busy, intent, onClose])

  if (!intent) return null

  const isDelete = intent.type === 'delete'
  const trimmedTitle = title.trim()
  const unchanged = intent.type === 'rename' && trimmedTitle === intent.canvas.title
  const invalidTitle = !isDelete && (!trimmedTitle || trimmedTitle.length > 120)
  const submit = () => {
    if (isDelete) {
      void onSubmit()
      return
    }
    if (!trimmedTitle) {
      setValidationError('请输入画布名称')
      return
    }
    if (trimmedTitle.length > 120) {
      setValidationError('画布名称不能超过 120 个字符')
      return
    }
    if (unchanged) {
      onClose()
      return
    }
    setValidationError(null)
    void onSubmit(trimmedTitle)
  }

  const heading = intent.type === 'create' ? '新建画布' : intent.type === 'rename' ? '重命名画布' : '删除画布'
  const description = intent.type === 'create'
    ? '创建一张新的无限画布，用于组织文本、素材和生成工作流。'
    : intent.type === 'rename'
      ? '名称会同步显示在画布选择器和访问路径的导航中。'
      : `确定删除「${intent.canvas.title}」吗？画布内的节点、连线和历史版本将一并删除。`

  return (
    <div
      className="nori-canvas-dialog-scrim nori-canvas-management-scrim"
      data-testid={`canvas-${intent.type}-dialog`}
      onMouseDown={(event) => { if (event.currentTarget === event.target && !busy) onClose() }}
    >
      <form
        className={`nori-canvas-dialog nori-canvas-management-dialog${isDelete ? ' is-danger' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="canvas-management-title"
        onSubmit={(event) => { event.preventDefault(); submit() }}
      >
        <header>
          <span id="canvas-management-title"><AppIcon name={intent.type === 'create' ? 'plus' : intent.type === 'rename' ? 'edit' : 'trash'} />{heading}</span>
          <button type="button" title="关闭" disabled={busy} onClick={onClose}><AppIcon name="close" /></button>
        </header>
        <div className="nori-canvas-dialog-body">
          <p className="nori-canvas-management-description">{description}</p>
          {!isDelete ? (
            <label className="nori-canvas-management-field">
              <span>画布名称 <small>{title.length} / 120</small></span>
              <input
                autoFocus
                maxLength={120}
                value={title}
                placeholder="请输入画布名称"
                disabled={busy}
                onChange={(event) => { setTitle(event.target.value); setValidationError(null) }}
              />
            </label>
          ) : (
            <div className="nori-canvas-management-warning">
              <AppIcon name="alert" />
              <span><b>此操作无法撤销</b><small>当前画布包含 {intent.canvas.nodeCount ?? 0} 个节点。删除后，如果这是项目最后一张画布，将返回创建引导。</small></span>
            </div>
          )}
          {validationError || error ? <div className="nori-canvas-management-error" role="alert"><AppIcon name="alert" />{validationError || error}</div> : null}
        </div>
        <footer>
          <button type="button" disabled={busy} onClick={onClose}>取消</button>
          <button type="submit" className={isDelete ? 'is-danger' : 'is-primary'} disabled={busy || invalidTitle || unchanged}>
            {busy ? <><AppIcon name="loader" className="animate-spin" />处理中…</> : isDelete ? '确认删除' : intent.type === 'create' ? '创建画布' : '保存名称'}
          </button>
        </footer>
      </form>
    </div>
  )
}
