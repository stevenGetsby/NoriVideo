'use client'

import { useState } from 'react'
import { ViewportDialogLayer } from '@/components/frameos/ViewportDialogLayer'
import { X } from '@/components/ui/icons'
import { useRouter } from '@/i18n/navigation'
import { apiFetch } from '@/lib/api-fetch'
import { storyErrorMessage } from './story-api-error'
import { STORY_ASPECT_RATIOS, STORY_RESOLUTIONS, type StoryAspectRatio, type StoryResolution } from '@/lib/interactive/types'

export const ASPECT_COPY: Record<StoryAspectRatio, { label: string; hint: string }> = {
  '9:16': { label: '竖屏 9:16', hint: '手机全屏沉浸，适合短剧式互动' },
  '16:9': { label: '横屏 16:9', hint: '电影画幅，适合大屏与网页游玩' },
}

export function StoryFormatPicker({ aspectRatio, resolution, disabled, onChange }: {
  aspectRatio: StoryAspectRatio
  resolution: StoryResolution
  disabled?: boolean
  onChange: (next: { aspectRatio?: StoryAspectRatio; resolution?: StoryResolution }) => void
}) {
  return (
    <>
      <div className="nori-ix-aspects" role="radiogroup" aria-label="画幅">
        {STORY_ASPECT_RATIOS.map((ratio) => (
          <button
            key={ratio}
            type="button"
            role="radio"
            aria-checked={aspectRatio === ratio}
            disabled={disabled}
            className={`nori-ix-aspect${aspectRatio === ratio ? ' is-on' : ''}`}
            onClick={() => onChange({ aspectRatio: ratio })}
          >
            <i className={ratio === '9:16' ? 'is-portrait' : 'is-landscape'} aria-hidden="true" />
            <strong>{ASPECT_COPY[ratio].label}</strong>
            <small>{ASPECT_COPY[ratio].hint}</small>
          </button>
        ))}
      </div>
      <label className="nori-ix-field">
        <span>分辨率</span>
        <select className="fos-input" value={resolution} disabled={disabled} onChange={(event) => onChange({ resolution: event.target.value as StoryResolution })}>
          {STORY_RESOLUTIONS.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
      </label>
    </>
  )
}

export function CreateStoryDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [aspectRatio, setAspectRatio] = useState<StoryAspectRatio>('9:16')
  const [resolution, setResolution] = useState<StoryResolution>('1080p')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    setSubmitting(true)
    setError(null)
    try {
      const response = await apiFetch('/api/interactive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() || undefined, aspectRatio, resolution }),
      })
      if (!response.ok) throw new Error(await storyErrorMessage(response, '创建影游失败'))
      const payload = await response.json() as { story: { workId: string } }
      router.push(`/interactive/${encodeURIComponent(payload.story.workId)}`)
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : '创建影游失败')
      setSubmitting(false)
    }
  }

  return (
    <ViewportDialogLayer>
      <div className="fos-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget && !submitting) onClose() }}>
        <form
          className="fos-dialog nori-ix nori-ix-dialog"
          role="dialog"
          aria-modal="true"
          aria-label="新建影游"
          onSubmit={(event) => { event.preventDefault(); void submit() }}
        >
          <header className="fos-dialog-head">
            <div>
              <div className="fos-dialog-title">新建影游</div>
              <p className="nori-ix-dialog-sub">一个影游是一个项目，每一章是项目里的一个作品，各自拥有画布。</p>
            </div>
            <button type="button" className="fos-dialog-x" disabled={submitting} onClick={onClose} aria-label="关闭"><X /></button>
          </header>
          <div className="fos-dialog-body nori-ix-dialog-body">
            <label className="nori-ix-field">
              <span>影游名称</span>
              <input className="fos-input" value={name} maxLength={60} placeholder="例如：雨夜来电" autoFocus disabled={submitting} onChange={(event) => setName(event.target.value)} />
            </label>
            <StoryFormatPicker
              aspectRatio={aspectRatio}
              resolution={resolution}
              disabled={submitting}
              onChange={(next) => {
                if (next.aspectRatio) setAspectRatio(next.aspectRatio)
                if (next.resolution) setResolution(next.resolution)
              }}
            />
            <p className="nori-ix-note">画幅和分辨率会同步到每一章的生成设置，之后也可以在故事总览中修改。</p>
            {error ? <p className="nori-ix-error" role="alert">{error}</p> : null}
          </div>
          <footer className="fos-dialog-foot">
            <button type="button" className="fos-btn fos-btn-ghost fos-btn-lg" disabled={submitting} onClick={onClose}>取消</button>
            <button type="submit" className="fos-btn fos-btn-primary fos-btn-lg" disabled={submitting}>{submitting ? '创建中…' : '创建并打开'}</button>
          </footer>
        </form>
      </div>
    </ViewportDialogLayer>
  )
}
