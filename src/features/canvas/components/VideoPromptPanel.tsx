'use client'

import { useEffect, useRef, useState } from 'react'
import { Copy } from '@/components/ui/icons'
import type { VideoVersionPrompt } from '../video-prompt'

const promptDrafts = new Map<string, { version: string; prompt: string }>()

function timeLabel(value: number, precise: boolean) {
  const seconds = Math.max(0, value)
  const minutes = Math.floor(seconds / 60)
  const whole = Math.floor(seconds % 60)
  return `${String(minutes).padStart(2, '0')}:${String(whole).padStart(2, '0')}${precise ? `.${Math.floor((seconds % 1) * 10)}` : ''}`
}

export function VideoPromptPanel({ nodeId, version, currentPrompt, currentTime, readOnly, hasVideoPrefix, onSave, onRegenerate, onMessage }: {
  nodeId: string
  version: VideoVersionPrompt
  currentPrompt: string
  currentTime: number
  readOnly: boolean
  hasVideoPrefix: boolean
  onSave?: (prompt: string) => void
  onRegenerate?: (prompt: string) => Promise<void>
  onMessage: (message: string) => void
}) {
  const versionPrompt = version.prompt || currentPrompt
  const [draft, setDraft] = useState(() => {
    const saved = promptDrafts.get(nodeId)
    return saved?.version === versionPrompt ? saved.prompt : versionPrompt
  })
  const [copied, setCopied] = useState(false)
  const [saved, setSaved] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const stored = promptDrafts.get(nodeId)
    setDraft(stored?.version === versionPrompt ? stored.prompt : versionPrompt)
  }, [nodeId, versionPrompt])
  useEffect(() => {
    const textarea = textareaRef.current
    if (textarea) textarea.style.height = `${Math.min(280, Math.max(160, textarea.scrollHeight))}px`
  }, [draft])
  const copyTimer = useRef<number | null>(null)
  const saveTimer = useRef<number | null>(null)
  useEffect(() => () => {
    if (copyTimer.current) clearTimeout(copyTimer.current)
    if (saveTimer.current) clearTimeout(saveTimer.current)
  }, [])
  const change = (prompt: string) => {
    setDraft(prompt)
    setSaved(false)
    promptDrafts.set(nodeId, { version: versionPrompt, prompt })
  }
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(version.prompt)
      setCopied(true)
      if (copyTimer.current) window.clearTimeout(copyTimer.current)
      copyTimer.current = window.setTimeout(() => setCopied(false), 1500)
    } catch {
      onMessage('复制失败，请手动选择提示词复制')
    }
  }
  const save = () => {
    if (!onSave) return
    onSave(draft)
    promptDrafts.delete(nodeId)
    setSaved(true)
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => setSaved(false), 1500)
  }
  const regenerate = async () => {
    if (!onRegenerate || submitting) return
    setSubmitting(true)
    try {
      await onRegenerate(draft)
      promptDrafts.delete(nodeId)
    } catch (error) {
      onMessage(error instanceof Error ? error.message : '重新生成提交失败')
    } finally {
      setSubmitting(false)
    }
  }
  const insertTime = () => {
    const textarea = textareaRef.current
    if (!textarea) return
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const insertion = `${timeLabel(currentTime, false)} `
    change(`${draft.slice(0, start)}${insertion}${draft.slice(end)}`)
    requestAnimationFrame(() => {
      textarea.focus()
      textarea.setSelectionRange(start + insertion.length, start + insertion.length)
    })
  }
  const parameters = version.parameters || {}
  const metadata = [
    version.modelKey,
    typeof parameters.duration === 'number' ? `${parameters.duration}秒` : null,
    typeof parameters.aspectRatio === 'string' ? parameters.aspectRatio : null,
  ].filter(Boolean).join(' · ')
  const dirty = draft !== currentPrompt
  const modified = draft !== version.prompt

  return <div className="nori-video-prompt-panel">
    <header className="nori-video-prompt-heading"><strong>提示词</strong><time>{timeLabel(currentTime, true)}</time></header>
    <section className="nori-video-prompt-version">
      <div className="nori-video-prompt-label"><strong>生成这个视频的提示词</strong>{version.prompt ? <button type="button" onClick={() => void copy()}><Copy />{copied ? '已复制' : '复制'}</button> : null}</div>
      {version.prompt ? <div className="nori-video-prompt-readonly">{version.prompt}</div> : <p className="nori-video-prompt-none">这个视频没有保存提示词</p>}
      {metadata || version.source === 'metadata' || version.source === 'node' ? <div className="nori-video-prompt-meta">{metadata}{version.source === 'metadata' || version.source === 'node' ? <span>{metadata ? ' · ' : ''}来自节点当前提示词</span> : null}</div> : null}
    </section>
    {readOnly ? <p className="nori-video-prompt-readonly-note">只读预览不可修改</p> : <section className="nori-video-prompt-edit">
      <div className="nori-video-prompt-label"><strong>修改提示词</strong>{dirty && modified ? <span className="is-modified">已修改，与当前视频不一致</span> : !dirty && modified ? <span>已保存到节点，尚未重新生成</span> : null}</div>
      <textarea
        ref={textareaRef}
        className="nodrag nowheel"
        aria-label="修改提示词"
        rows={8}
        value={draft}
        data-dirty={dirty ? 'true' : 'false'}
        onChange={(event) => change(event.target.value)}
      />
      <div className="nori-video-prompt-tools">
        <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={insertTime}>插入时间点</button>
        <button type="button" disabled={!modified} onClick={() => change(versionPrompt)}>恢复原提示词</button>
      </div>
      <button type="button" className="nori-video-prompt-save" disabled={!dirty} onClick={save}>{saved ? '已保存' : '保存到节点'}</button>
      <button type="button" className="nori-video-prompt-regenerate" disabled={submitting || !onRegenerate} onClick={() => void regenerate()}>{submitting ? '提交中…' : '保存并重新生成'}</button>
      <small>会生成新版本并消耗积分，旧版本保留在历史里</small>
    </section>}
    {hasVideoPrefix ? <p className="nori-video-prompt-prefix">生成时会自动拼上项目的视频前缀提示词，这里只显示你写的部分。</p> : null}
  </div>
}
