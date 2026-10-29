'use client'

import { useState } from 'react'
import { AlertTriangle, CheckCircle2 } from '@/components/ui/icons'
import { countIssues } from '@/lib/interactive/validate'
import type { StoryAspectRatio, StoryIssue, StoryResolution, StoryVariable } from '@/lib/interactive/types'
import { StoryFormatPicker } from './CreateStoryDialog'
import { StoryVariablesEditor } from './StoryVariablesEditor'
import type { OverviewStory } from './story-overview-model'
import type { StoryPatch } from './useStoryOverview'

type Tab = 'checks' | 'variables' | 'settings'

function StorySettings({ story, readOnly, onSave }: { story: OverviewStory; readOnly: boolean; onSave: (patch: StoryPatch) => Promise<void> }) {
  const [name, setName] = useState(story.name)
  const [aspectRatio, setAspectRatio] = useState<StoryAspectRatio>(story.aspectRatio)
  const [resolution, setResolution] = useState<StoryResolution>(story.resolution)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const trimmed = name.trim()
  const dirty = (story.canManage && trimmed !== story.name) || aspectRatio !== story.aspectRatio || resolution !== story.resolution
  const formatChanged = aspectRatio !== story.aspectRatio || resolution !== story.resolution

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      await onSave({
        ...(story.canManage && trimmed && trimmed !== story.name ? { name: trimmed } : {}),
        ...(aspectRatio !== story.aspectRatio ? { aspectRatio } : {}),
        ...(resolution !== story.resolution ? { resolution } : {}),
      })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="nori-ix-settings">
      <label className="nori-ix-field">
        <span>影游名称</span>
        <input className="fos-input" value={name} maxLength={60} disabled={readOnly || !story.canManage || saving} onChange={(event) => setName(event.target.value)} />
        {!story.canManage ? <small>只有项目管理员可以改名。</small> : null}
      </label>
      <StoryFormatPicker
        aspectRatio={aspectRatio}
        resolution={resolution}
        disabled={readOnly || saving}
        onChange={(next) => {
          if (next.aspectRatio) setAspectRatio(next.aspectRatio)
          if (next.resolution) setResolution(next.resolution)
        }}
      />
      {formatChanged ? <p className="nori-ix-note is-warning">保存后每一章的生成画幅与分辨率都会改为新设置，已生成的素材不受影响。</p> : null}
      {error ? <p className="nori-ix-error" role="alert">{error}</p> : null}
      <button type="button" className="fos-btn fos-btn-primary" disabled={readOnly || saving || !dirty || !trimmed} onClick={() => void save()}>
        {saving ? '保存中…' : '保存设置'}
      </button>
    </div>
  )
}

export function StoryOverviewSide({ story, issues, readOnly, onFocusIssue, onSave }: {
  story: OverviewStory
  issues: StoryIssue[]
  readOnly: boolean
  onFocusIssue: (issue: StoryIssue) => void
  onSave: (patch: StoryPatch) => Promise<void>
}) {
  const [tab, setTab] = useState<Tab>('checks')
  const { errors, warnings } = countIssues(issues)
  const tabs: Array<{ key: Tab; label: string; badge?: number; tone?: string }> = [
    { key: 'checks', label: '检查', badge: errors || warnings || undefined, tone: errors ? 'is-error' : 'is-warning' },
    { key: 'variables', label: '全局变量', badge: story.config.variables.length || undefined },
    { key: 'settings', label: '设置' },
  ]

  return (
    <aside className="nori-ix-side" aria-label="故事面板">
      <div className="nori-ix-tabs" role="tablist">
        {tabs.map((item) => (
          <button key={item.key} type="button" role="tab" aria-selected={tab === item.key} className={tab === item.key ? 'is-on' : ''} onClick={() => setTab(item.key)}>
            {item.label}{item.badge ? <b className={item.tone}>{item.badge}</b> : null}
          </button>
        ))}
      </div>

      {tab === 'checks' ? (
        <div className="nori-ix-checks">
          <div className={`nori-ix-checks-summary ${errors ? 'is-error' : warnings ? 'is-warning' : 'is-ok'}`}>
            {errors || warnings ? <AlertTriangle /> : <CheckCircle2 />}
            <div>
              <strong>{errors ? `${errors} 个问题需要处理` : warnings ? `${warnings} 个提醒` : '整部影游可以完整走通'}</strong>
              <span>{errors ? '问题会让观众卡住或走不到结局。' : '检查覆盖起点、章节连线、条件与变量。'}</span>
            </div>
          </div>
          {issues.length ? (
            <ul>
              {issues.map((issue, index) => (
                <li key={`${issue.code}:${issue.projectId}:${issue.nodeId}:${index}`} className={`is-${issue.level}`}>
                  <button type="button" disabled={!issue.projectId} onClick={() => onFocusIssue(issue)}>
                    <span>{issue.level === 'error' ? '问题' : '提醒'}</span>{issue.message}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {tab === 'variables' ? (
        <StoryVariablesEditor
          key={JSON.stringify(story.config.variables)}
          variables={story.config.variables}
          readOnly={readOnly}
          onSave={(variables: StoryVariable[]) => onSave({ config: { variables } })}
        />
      ) : null}

      {tab === 'settings' ? (
        <StorySettings key={`${story.name}:${story.aspectRatio}:${story.resolution}`} story={story} readOnly={readOnly} onSave={onSave} />
      ) : null}
    </aside>
  )
}
