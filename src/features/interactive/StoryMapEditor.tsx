'use client'

import { useState } from 'react'
import { Map } from '@/components/ui/icons'
import type { StoryMapConfig } from '@/lib/interactive/types'
import { normalizeMapDraft, sanitizeMap } from './gameplay-edit'
import './story-gameplay.css'

/** Draft editor for the 地图 tab: the switch, what the viewer gets, and where the save points are. */
export function StoryMapEditor({ map, savePointCount, readOnly, onSave, onSaved }: {
  map: StoryMapConfig | undefined
  /** Scenes among the chapters currently loaded that carry a save point. */
  savePointCount: number
  readOnly: boolean
  onSave: (map: StoryMapConfig) => Promise<void>
  onSaved?: () => void
}) {
  const [draft, setDraft] = useState<StoryMapConfig>(() => normalizeMapDraft(map))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const initial = normalizeMapDraft(map)
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial)

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      await onSave(sanitizeMap(draft))
      onSaved?.()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="nori-story-vars nori-ix-map">
      <label className="nori-ix-shop-enable">
        <input type="checkbox" checked={draft.enabled} disabled={readOnly} aria-label="开启地图和存档"
          onChange={(event) => setDraft({ enabled: event.target.checked })} />
        <span><strong>开启地图和存档</strong><small>观众播放时右上角出现地图，可以回到去过的存档点，继续上次进度，并使用 3 个手动存档位。</small></span>
      </label>
      <ul className="nori-ix-map-points">
        <li><Map /><span><strong>右上角地图</strong>只显示观众已经解锁的存档点和路线，不剧透未到达的片段。</span></li>
        <li><span><strong>继续上次进度</strong>退出播放器时会自动存档，再次进入可以从上次的存档点继续。</span></li>
        <li><span><strong>3 个手动存档位</strong>观众可以随时手动存档，之后从任意存档点重新开始。</span></li>
      </ul>
      <p className="nori-ix-map-count">已标记 <b>{savePointCount}</b> 个存档点（基于当前加载的章节）。</p>
      {draft.enabled && savePointCount === 0 ? (
        <p className="nori-ix-note is-warning">地图已开启，但还没有片段标记为存档点。到剧情片段卡片里勾选「存档点」，观众才能在地图上看到它们。</p>
      ) : null}
      {draft.enabled ? null : <p className="nori-story-vars-hint">未开启时，片段上的存档点不会生效，观众也看不到地图。</p>}
      {error ? <p className="nori-story-vars-error" role="alert">{error}</p> : null}
      {readOnly ? null : (
        <div className="nori-story-vars-actions">
          <button type="button" className="is-primary" disabled={!dirty || saving} onClick={() => void save()}>{saving ? '保存中…' : '保存'}</button>
        </div>
      )}
    </div>
  )
}
