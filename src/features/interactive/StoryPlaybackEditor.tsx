'use client'

import { useState } from 'react'
import { speedLabel } from '@/lib/interactive/playback'
import { STORY_PLAYBACK_SPEEDS, type StoryPlaybackConfig, type StoryPlaybackSpeed } from '@/lib/interactive/types'
import { normalizePlaybackDraft, sanitizePlayback, togglePlaybackSpeed } from './gameplay-edit'
import './story-gameplay.css'

const SPEED_LABELS: Record<StoryPlaybackSpeed, string> = { 1: '1x 原速', 1.25: '1.25x', 1.5: '1.5x' }

/** Draft editor for the 倍速 tab: which speeds the viewer may switch between; 1x is always on. */
export function StoryPlaybackEditor({ playback, readOnly, onSave, onSaved }: {
  playback: StoryPlaybackConfig | undefined
  readOnly: boolean
  onSave: (playback: StoryPlaybackConfig) => Promise<void>
  onSaved?: () => void
}) {
  const [draft, setDraft] = useState<StoryPlaybackConfig>(() => normalizePlaybackDraft(playback))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const initial = normalizePlaybackDraft(playback)
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial)
  const preview = draft.speeds.length > 1
    ? `观众可在 ${draft.speeds.map(speedLabel).join(' / ')} 间切换`
    : '观众只有原速，不会显示倍速按钮'

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      await onSave(sanitizePlayback(draft))
      onSaved?.()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="nori-story-vars nori-ix-playback">
      <p className="nori-story-vars-hint">勾选观众可以切换的速度。互动倒计时和互动窗口按现实时间计时，不受倍速影响。</p>
      <ul className="nori-ix-playback-list">
        {STORY_PLAYBACK_SPEEDS.map((speed) => {
          const locked = speed === 1
          return (
            <li key={speed}>
              <label className={`nori-ix-playback-speed${locked || readOnly ? ' is-locked' : ''}`}>
                <input type="checkbox" data-testid={`playback-speed-${speed}`} aria-label={`播放速度 ${speedLabel(speed)}`}
                  checked={draft.speeds.includes(speed)} disabled={readOnly || locked}
                  onChange={() => setDraft((current) => togglePlaybackSpeed(current, speed))} />
                <span>
                  <strong>{SPEED_LABELS[speed]}</strong>
                  {locked ? <small>始终开启，不能关闭</small> : null}
                </span>
              </label>
            </li>
          )
        })}
      </ul>
      <p className="nori-ix-playback-preview" data-testid="playback-preview">{preview}</p>
      {error ? <p className="nori-story-vars-error" role="alert">{error}</p> : null}
      {readOnly ? null : (
        <div className="nori-story-vars-actions">
          <button type="button" className="is-primary" disabled={!dirty || saving} onClick={() => void save()}>{saving ? '保存中…' : '保存'}</button>
        </div>
      )}
    </div>
  )
}
