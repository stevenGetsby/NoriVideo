'use client'

import { useEffect, useRef, useState } from 'react'
import { Boxes, LoaderCircle, X } from '@/components/ui/icons'

export function CanvasWorkflowDialog({
  initialName,
  onConfirm,
  onClose,
}: {
  initialName: string
  onConfirm: (name: string) => Promise<void>
  onClose: () => void
}) {
  const [name, setName] = useState(initialName)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { inputRef.current?.focus(); inputRef.current?.select() }, [])
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => { if (event.key === 'Escape' && !saving) onClose() }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [onClose, saving])

  const submit = async () => {
    const value = name.replace(/\s+/g, ' ').trim()
    if (!value) { setError('请输入工作流名称'); return }
    setSaving(true)
    setError(null)
    try {
      await onConfirm(value)
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '保存工作流失败')
      setSaving(false)
    }
  }

  return (
    <div className="nori-canvas-dialog-scrim" onMouseDown={(event) => { if (event.currentTarget === event.target && !saving) onClose() }}>
      <form className="nori-canvas-dialog nori-canvas-workflow-dialog" onSubmit={(event) => { event.preventDefault(); void submit() }}>
        <header><span><Boxes />保存为工作流</span><button type="button" disabled={saving} title="关闭" onClick={onClose}><X /></button></header>
        <div className="nori-canvas-dialog-body">
          <label><span>工作流名称</span><input ref={inputRef} value={name} maxLength={100} onChange={(event) => setName(event.target.value)} placeholder="例如：角色参考图 → 连续故事版 → 视频" /></label>
          <p>组内节点、连线和生成参数会保存为可复用模板。再次加载时会创建独立副本，不修改原工作流。</p>
          {error ? <div className="nori-canvas-generator-error">{error}</div> : null}
        </div>
        <footer><button type="button" disabled={saving} onClick={onClose}>取消</button><button type="submit" className="is-primary" disabled={saving}>{saving ? <LoaderCircle className="animate-spin" /> : <Boxes />}{saving ? '正在保存…' : '保存工作流'}</button></footer>
      </form>
    </div>
  )
}
