'use client'

import { useState } from 'react'
import { STORY_PERSONALITY_DEFAULTS, STORY_PERSONALITY_TYPES, type StoryPersonalityType } from '@/lib/interactive/personality'
import type { StoryPersonality, StoryPersonalityResult } from '@/lib/interactive/types'
import { StoryImageField } from '@/features/canvas/story/StoryImageField'
import {
  normalizePersonalityDraft,
  PERSONALITY_DESCRIPTION_MAX,
  PERSONALITY_NAME_MAX,
  personalityEntryOf,
  personalityHasCustomCopy,
  restoreAllPersonalityEntries,
  restorePersonalityEntry,
  sanitizePersonality,
  withPersonalityEntry,
} from './gameplay-edit'
import './story-gameplay.css'

/** Draft editor for the 人格测试 tab: the switch plus the sixteen result cards. */
export function StoryPersonalityEditor({ personality, workId = null, readOnly, onSave, onSaved }: {
  personality: StoryPersonality | undefined
  workId?: string | null
  readOnly: boolean
  onSave: (personality: StoryPersonality) => Promise<void>
  onSaved?: () => void
}) {
  const [draft, setDraft] = useState<StoryPersonality>(() => normalizePersonalityDraft(personality))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const initial = normalizePersonalityDraft(personality)
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial)
  const hasCustom = personalityHasCustomCopy(draft)
  const updateEntry = (type: StoryPersonalityType, patch: Partial<StoryPersonalityResult>) => {
    setDraft((current) => withPersonalityEntry(current, type, { ...personalityEntryOf(current, type), ...patch }))
  }

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      await onSave(sanitizePersonality(draft))
      onSaved?.()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="nori-story-vars nori-ix-personality">
      <label className="nori-ix-shop-enable">
        <input type="checkbox" checked={draft.enabled} disabled={readOnly} aria-label="开启人格测试"
          onChange={(event) => setDraft((current) => ({ ...current, enabled: event.target.checked }))} />
        <span><strong>开启人格测试</strong><small>观众在抉择选项上累计 E/I、S/N、T/F、J/P，结局可展示对应的 16 型结果。</small></span>
      </label>
      <p className="nori-story-vars-hint">
        在抉择节点的选项上打人格标签；结局节点勾选「显示人格结果」后，结局会展示观众的人格类型。没改写的类型继续使用内置名称和文案。
      </p>
      <div className="nori-ix-pt-head">
        <span>16 型结果（默认仅作占位）</span>
        {readOnly || !hasCustom ? null : (
          <button type="button" className="nori-ix-pt-restore-all" onClick={() => setDraft((current) => restoreAllPersonalityEntries(current))}>
            全部恢复默认
          </button>
        )}
      </div>
      <ul className="nori-ix-pt-grid">
        {STORY_PERSONALITY_TYPES.map((type) => {
          const defaults = STORY_PERSONALITY_DEFAULTS[type]
          const entry = personalityEntryOf(draft, type)
          const customized = Boolean(entry.name.trim() || entry.description.trim() || entry.imageUrl)
          return (
            <li key={type} className={`nori-ix-pt-card${customized ? ' is-custom' : ''}`} data-type={type}>
              <div className="nori-ix-pt-card-head">
                <b className="nori-ix-pt-code">{type}</b>
                {!readOnly && customized ? (
                  <button type="button" className="nori-ix-pt-restore" aria-label={`恢复 ${type} 默认`}
                    onClick={() => setDraft((current) => restorePersonalityEntry(current, type))}>恢复默认</button>
                ) : null}
              </div>
              <input value={entry.name} placeholder={defaults.name} maxLength={PERSONALITY_NAME_MAX} readOnly={readOnly}
                aria-label={`${type} 结果名称`} onChange={(event) => updateEntry(type, { name: event.target.value })} />
              <textarea rows={2} value={entry.description} placeholder={defaults.description} maxLength={PERSONALITY_DESCRIPTION_MAX}
                readOnly={readOnly} aria-label={`${type} 结果描述`} onChange={(event) => updateEntry(type, { description: event.target.value })} />
              <StoryImageField compact label={`${type} 结果图片`} value={entry.imageUrl} workId={workId} readOnly={readOnly}
                onChange={(imageUrl) => updateEntry(type, { imageUrl })} />
            </li>
          )
        })}
      </ul>
      {error ? <p className="nori-story-vars-error" role="alert">{error}</p> : null}
      {readOnly ? null : (
        <div className="nori-story-vars-actions">
          <button type="button" className="is-primary" disabled={!dirty || saving} onClick={() => void save()}>{saving ? '保存中…' : '保存'}</button>
        </div>
      )}
    </div>
  )
}
