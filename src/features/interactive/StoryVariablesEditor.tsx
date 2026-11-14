'use client'

import { useState } from 'react'
import { ChevronDown, ImageIcon, Plus, X } from '@/components/ui/icons'
import { toDisplayImageUrl } from '@/lib/media/image-url'
import type { StoryVariable } from '@/lib/interactive/types'
import { StoryImageField } from '@/features/canvas/story/StoryImageField'
import {
  isImageIcon,
  sanitizeVariables,
  setVariableType,
  VARIABLE_LIMIT,
  VARIABLE_NAME_MAX,
  variableMaxWarning,
  variableNameProblem,
} from './gameplay-edit'
import './interactive.css'

const displayIcon = (icon: string) => toDisplayImageUrl(icon) || icon

/** Emoji text or an uploaded picture; one value, clearable, with a live preview. */
export function StoryIconField({ label = '图标', value, workId, readOnly, onChange }: {
  label?: string
  value: string | null | undefined
  workId: string | null
  readOnly: boolean
  onChange: (icon: string | undefined) => void
}) {
  const icon = value?.trim() ?? ''
  const image = isImageIcon(icon)
  return (
    <div className="nori-ix-icon-field">
      <span className={`nori-ix-icon-preview${icon ? ' has-icon' : ''}`} aria-hidden="true">
        {image ? <img src={displayIcon(icon)} alt="" /> : icon ? <span>{icon}</span> : <ImageIcon />}
      </span>
      <input
        className="nori-ix-icon-emoji"
        value={image ? '' : icon}
        placeholder="表情，如 🪙"
        maxLength={32}
        readOnly={readOnly}
        aria-label={`${label}表情`}
        onChange={(event) => onChange(event.target.value.trim() || undefined)}
      />
      <StoryImageField compact label={`${label}图片`} value={image ? icon : null} workId={workId} readOnly={readOnly} onChange={(url) => onChange(url ?? undefined)} />
      {icon ? <button type="button" className="nori-ix-icon-clear" aria-label={`清除${label}`} disabled={readOnly} onClick={() => onChange(undefined)}><X /></button> : null}
    </div>
  )
}

/** Draft editor for the story's global variables; nothing is saved until 保存. */
export function StoryVariablesEditor({ variables, workId = null, readOnly, onSave, onSaved }: {
  variables: StoryVariable[]
  /** Needed to upload a picture icon; a canvas without a work id can still use emoji. */
  workId?: string | null
  readOnly: boolean
  onSave: (variables: StoryVariable[]) => Promise<void>
  onSaved?: () => void
}) {
  const [draft, setDraft] = useState(variables)
  const [openId, setOpenId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dirty = JSON.stringify(draft) !== JSON.stringify(variables)
  const update = (id: string, patch: Partial<StoryVariable>) => setDraft((current) => current.map((variable) => (variable.id === id ? { ...variable, ...patch } : variable)))

  const save = async () => {
    const trimmed = draft.map((variable) => ({ ...variable, name: variable.name.trim() }))
    const problem = variableNameProblem(trimmed)
    if (problem) { setError(problem); return }
    setSaving(true)
    setError(null)
    try {
      await onSave(sanitizeVariables(trimmed))
      onSaved?.()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const append = () => {
    const id = `v_${crypto.randomUUID().slice(0, 8)}`
    setDraft((current) => [...current, { id, name: `变量${current.length + 1}`, type: 'number', initial: 0 }])
    setOpenId(id)
  }

  return (
    <div className="nori-story-vars">
      <p className="nori-story-vars-hint">变量在整部影游内共享：剧情片段和选项可以改变它们，条件节点按它们分支。</p>
      {draft.length === 0 ? <p className="nori-story-vars-empty">还没有变量，例如「勇气」「拿到钥匙」。</p> : (
        <ul>
          {draft.map((variable) => {
            const icon = variable.icon?.trim() ?? ''
            const extra = openId === variable.id
            const warning = variableMaxWarning(variable)
            const hasSettings = !!icon || variable.showInHud === true || variable.scope === 'permanent' || (variable.type === 'number' && typeof variable.max === 'number')
            return (
              <li key={variable.id} className={`nori-ix-var${extra ? ' is-open' : ''}`}>
                <div className="nori-ix-var-main">
                  <span className={`nori-ix-icon-preview${icon ? ' has-icon' : ''}`} aria-hidden="true">
                    {isImageIcon(icon) ? <img src={displayIcon(icon)} alt="" /> : icon ? <span>{icon}</span> : <ImageIcon />}
                  </span>
                  <input value={variable.name} placeholder="变量名称" maxLength={VARIABLE_NAME_MAX} readOnly={readOnly} aria-label="变量名称"
                    onChange={(event) => update(variable.id, { name: event.target.value })} />
                  {readOnly ? null : <button type="button" aria-label="删除变量" onClick={() => setDraft((current) => current.filter((item) => item.id !== variable.id))}><X /></button>}
                </div>
                <div className="nori-ix-var-controls">
                  <select value={variable.type} disabled={readOnly} aria-label="变量类型"
                    onChange={(event) => setDraft((current) => current.map((item) => (item.id === variable.id ? setVariableType(item, event.target.value === 'boolean' ? 'boolean' : 'number') : item)))}>
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
                    <input className="nori-ix-var-initial" type="number" value={Number(variable.initial)} readOnly={readOnly} aria-label="起始值"
                      onChange={(event) => update(variable.id, { initial: Number.isFinite(event.target.valueAsNumber) ? event.target.valueAsNumber : 0 })} />
                  )}
                  <button type="button" className={`nori-ix-var-toggle${hasSettings ? ' is-active' : ''}`} aria-expanded={extra} aria-label="显示设置"
                    onClick={() => setOpenId(extra ? null : variable.id)}>
                    <ChevronDown />显示设置
                  </button>
                </div>
                {extra ? (
                  <div className="nori-ix-var-extra">
                    <StoryIconField label="变量图标" value={variable.icon} workId={workId} readOnly={readOnly} onChange={(next) => update(variable.id, { icon: next })} />
                    {variable.type === 'number' ? (
                      <label className="nori-ix-var-field">
                        <span>上限</span>
                        <input type="number" value={variable.max ?? ''} placeholder="不限" readOnly={readOnly} aria-label="上限"
                          onChange={(event) => update(variable.id, { max: event.target.value.trim() === '' ? undefined : Number(event.target.valueAsNumber) })} />
                      </label>
                    ) : null}
                    <label className="nori-ix-var-check">
                      <input type="checkbox" checked={variable.showInHud === true} disabled={readOnly} aria-label="显示在右上角"
                        onChange={(event) => update(variable.id, { showInHud: event.target.checked || undefined })} />
                      显示在右上角
                    </label>
                    <label className="nori-ix-var-field">
                      <span>数值保留</span>
                      <select value={variable.scope === 'permanent' ? 'permanent' : 'run'} disabled={readOnly} aria-label="数值保留"
                        onChange={(event) => update(variable.id, { scope: event.target.value === 'permanent' ? 'permanent' : undefined })}>
                        <option value="run">仅本局</option>
                        <option value="permanent">永久</option>
                      </select>
                    </label>
                    {warning ? <p className="nori-ix-var-warning" role="status">{warning}</p> : null}
                  </div>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
      {error ? <p className="nori-story-vars-error" role="alert">{error}</p> : null}
      {readOnly ? null : (
        <div className="nori-story-vars-actions">
          <button type="button" disabled={draft.length >= VARIABLE_LIMIT} onClick={append}><Plus />添加变量</button>
          <button type="button" className="is-primary" disabled={!dirty || saving} onClick={() => void save()}>{saving ? '保存中…' : '保存'}</button>
        </div>
      )}
    </div>
  )
}
