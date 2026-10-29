'use client'

import { useState } from 'react'
import { Plus, X } from '@/components/ui/icons'
import type { StoryVariable } from '@/lib/interactive/types'
import './interactive.css'

const NAME_MAX = 24
const LIMIT = 50

function validate(variables: StoryVariable[]): string | null {
  const names = new Set<string>()
  for (const variable of variables) {
    const name = variable.name.trim()
    if (!name) return '变量名称不能为空'
    if (name.length > NAME_MAX) return `变量名称不能超过 ${NAME_MAX} 个字`
    if (names.has(name)) return `变量「${name}」重名`
    names.add(name)
  }
  return null
}

/** Draft editor for the story's global variables; nothing is saved until 保存. */
export function StoryVariablesEditor({ variables, readOnly, onSave, onSaved }: {
  variables: StoryVariable[]
  readOnly: boolean
  onSave: (variables: StoryVariable[]) => Promise<void>
  onSaved?: () => void
}) {
  const [draft, setDraft] = useState(variables)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dirty = JSON.stringify(draft) !== JSON.stringify(variables)
  const update = (id: string, patch: Partial<StoryVariable>) => setDraft((current) => current.map((variable) => (variable.id === id ? { ...variable, ...patch } : variable)))

  const save = async () => {
    const trimmed = draft.map((variable) => ({ ...variable, name: variable.name.trim() }))
    const problem = validate(trimmed)
    if (problem) { setError(problem); return }
    setSaving(true)
    setError(null)
    try {
      await onSave(trimmed)
      onSaved?.()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="nori-story-vars">
      <p className="nori-story-vars-hint">变量在整部影游内共享：剧情片段和选项可以改变它们，条件节点按它们分支。</p>
      {draft.length === 0 ? <p className="nori-story-vars-empty">还没有变量，例如「勇气」「拿到钥匙」。</p> : (
        <ul>
          {draft.map((variable) => (
            <li key={variable.id}>
              <input value={variable.name} placeholder="变量名称" maxLength={NAME_MAX} readOnly={readOnly} aria-label="变量名称"
                onChange={(event) => update(variable.id, { name: event.target.value })} />
              <select value={variable.type} disabled={readOnly} aria-label="变量类型"
                onChange={(event) => update(variable.id, event.target.value === 'boolean' ? { type: 'boolean', initial: false } : { type: 'number', initial: 0 })}>
                <option value="number">数值</option>
                <option value="boolean">开关</option>
              </select>
              {variable.type === 'boolean' ? (
                <select value={variable.initial ? 'true' : 'false'} disabled={readOnly} aria-label="起始值"
                  onChange={(event) => update(variable.id, { initial: event.target.value === 'true' })}>
                  <option value="false">起始：否</option>
                  <option value="true">起始：是</option>
                </select>
              ) : (
                <input type="number" value={Number(variable.initial)} readOnly={readOnly} aria-label="起始值"
                  onChange={(event) => update(variable.id, { initial: Number.isFinite(event.target.valueAsNumber) ? event.target.valueAsNumber : 0 })} />
              )}
              {readOnly ? null : <button type="button" aria-label="删除变量" onClick={() => setDraft((current) => current.filter((item) => item.id !== variable.id))}><X /></button>}
            </li>
          ))}
        </ul>
      )}
      {error ? <p className="nori-story-vars-error" role="alert">{error}</p> : null}
      {readOnly ? null : (
        <div className="nori-story-vars-actions">
          <button type="button" disabled={draft.length >= LIMIT} onClick={() => setDraft((current) => [
            ...current,
            { id: `v_${crypto.randomUUID().slice(0, 8)}`, name: `变量${current.length + 1}`, type: 'number', initial: 0 },
          ])}><Plus />添加变量</button>
          <button type="button" className="is-primary" disabled={!dirty || saving} onClick={() => void save()}>{saving ? '保存中…' : '保存'}</button>
        </div>
      )}
    </div>
  )
}
