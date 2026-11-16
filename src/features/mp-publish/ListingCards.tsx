'use client'

import { useRef, useState } from 'react'
import { ImageIcon, Loader2, Trash2, Upload } from '@/components/ui/icons'
import { apiFetch } from '@/lib/api-fetch'
import { MP_TAGS } from '@/lib/mp/constants'
import type { MpWorkDraft } from '@/lib/mp/listing'
import { notify } from '@/lib/ui/feedback'
import { storyErrorMessage } from '../interactive/story-api-error'
import { fromDatetimeLocal, toDatetimeLocal } from './format'

export interface ListingForm {
  title: string
  tagline: string
  synopsis: string
  tags: string[]
  creatorName: string
  coverKey: string | null
  shareCoverKey: string | null
  trailerEnabled: boolean
  reservable: boolean
  scheduleMode: 'now' | 'at'
  scheduledAt: string | null
}

export function formFromListing(listing: MpWorkDraft | null, workName: string): ListingForm {
  return {
    title: listing?.title || [...workName].slice(0, 20).join(''),
    tagline: listing?.tagline ?? '',
    synopsis: listing?.synopsis ?? '',
    tags: listing?.tags ?? [],
    creatorName: listing?.creatorName ?? '',
    coverKey: listing?.coverKey ?? null,
    shareCoverKey: listing?.shareCoverKey ?? null,
    trailerEnabled: listing?.trailerEnabled ?? true,
    reservable: listing?.reservable ?? true,
    scheduleMode: listing?.scheduleMode ?? 'now',
    scheduledAt: listing?.scheduledAt ?? null,
  }
}

function FieldError({ message }: { message?: string }) {
  return message ? <p className="nori-mp-field-error">{message}</p> : null
}

function CoverUpload({ workId, label, hint, share, value, previewUrl, disabled, onChange }: {
  workId: string
  label: string
  hint: string
  share?: boolean
  value: string | null
  previewUrl: string | null
  disabled: boolean
  onChange: (key: string | null, previewUrl: string | null) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  const upload = async (file: File) => {
    if (file.size > 10 * 1024 * 1024) {
      notify('图片不能超过 10MB')
      return
    }
    setUploading(true)
    try {
      const body = new FormData()
      body.append('file', file)
      const response = await apiFetch(`/api/interactive/${encodeURIComponent(workId)}/assets`, { method: 'POST', body })
      if (!response.ok) throw new Error(await storyErrorMessage(response, '上传封面失败'))
      const payload = await response.json() as { key: string; url: string }
      onChange(payload.key, payload.url)
    } catch (error) {
      notify(error instanceof Error ? error.message : '上传封面失败')
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <div className="nori-ix-field">
      <span>{label}</span>
      <div className={`nori-mp-cover${share ? ' is-share' : ''}`}>
        {value && previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={previewUrl} alt={label} />
        ) : null}
        {value && !previewUrl ? <span className="nori-mp-cover-chip"><ImageIcon />已上传</span> : null}
        <button type="button" className="fos-btn fos-btn-ghost" disabled={disabled || uploading} onClick={() => inputRef.current?.click()}>
          {uploading ? <Loader2 className="nori-ix-spin" /> : <Upload />}{value ? '更换' : '上传'}
        </button>
        {value ? (
          <button type="button" className="fos-btn fos-btn-ghost" disabled={disabled || uploading} onClick={() => onChange(null, null)}>
            <Trash2 />移除
          </button>
        ) : null}
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png"
          hidden
          onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file) }}
        />
      </div>
      <small>{hint}</small>
    </div>
  )
}

export function ListingCard({ workId, form, fieldErrors, saving, onChange, onSave }: {
  workId: string
  form: ListingForm
  fieldErrors: Record<string, string>
  saving: boolean
  onChange: (form: ListingForm) => void
  onSave: () => void
}) {
  const [previews, setPreviews] = useState<{ coverKey: string | null; shareCoverKey: string | null }>({ coverKey: null, shareCoverKey: null })

  const toggleTag = (tag: string) => {
    if (form.tags.includes(tag)) {
      onChange({ ...form, tags: form.tags.filter((item) => item !== tag) })
      return
    }
    if (form.tags.length >= 3) {
      notify('最多选 3 个')
      return
    }
    onChange({ ...form, tags: [...form.tags, tag] })
  }

  const setCover = (field: 'coverKey' | 'shareCoverKey') => (key: string | null, previewUrl: string | null) => {
    onChange({ ...form, [field]: key })
    setPreviews((current) => ({ ...current, [field]: previewUrl }))
  }

  return (
    <section className="nori-mp-card">
      <h2>上架信息</h2>
      <div className="nori-mp-fields">
        <label className="nori-ix-field">
          <span>作品名</span>
          <input className="fos-input" value={form.title} maxLength={20} placeholder="观众在小程序里看到的名字" disabled={saving} onChange={(event) => onChange({ ...form, title: event.target.value })} />
          <FieldError message={fieldErrors.title} />
        </label>
        <label className="nori-ix-field">
          <span>一句话简介</span>
          <input className="fos-input" value={form.tagline} maxLength={30} placeholder="出现在卡片和分享里，一句话勾住观众" disabled={saving} onChange={(event) => onChange({ ...form, tagline: event.target.value })} />
          <FieldError message={fieldErrors.tagline} />
        </label>
        <label className="nori-ix-field">
          <span>详细介绍</span>
          <textarea className="fos-textarea" value={form.synopsis} maxLength={300} rows={4} placeholder="讲讲故事背景和玩法" disabled={saving} onChange={(event) => onChange({ ...form, synopsis: event.target.value })} />
          <small className="nori-mp-count">{[...form.synopsis].length}/300</small>
          <FieldError message={fieldErrors.synopsis} />
        </label>
        <div className="nori-ix-field">
          <span>题材标签</span>
          <div className="nori-mp-chips" role="group" aria-label="题材标签">
            {MP_TAGS.map((tag) => (
              <button key={tag} type="button" className={`nori-mp-chip${form.tags.includes(tag) ? ' is-on' : ''}`} aria-pressed={form.tags.includes(tag)} disabled={saving} onClick={() => toggleTag(tag)}>
                {tag}
              </button>
            ))}
          </div>
          <small>最多选 3 个</small>
          <FieldError message={fieldErrors.tags} />
        </div>
        <CoverUpload
          workId={workId}
          label="竖版封面"
          hint="建议 1080×1440，不上传则使用开场画面"
          value={form.coverKey}
          previewUrl={previews.coverKey}
          disabled={saving}
          onChange={setCover('coverKey')}
        />
        <FieldError message={fieldErrors.coverKey} />
        <CoverUpload
          workId={workId}
          label="分享封面"
          hint="用于微信分享卡片，建议 1000×800，不上传则从竖版封面裁切"
          share
          value={form.shareCoverKey}
          previewUrl={previews.shareCoverKey}
          disabled={saving}
          onChange={setCover('shareCoverKey')}
        />
        <FieldError message={fieldErrors.shareCoverKey} />
        <label className="nori-ix-field">
          <span>出品署名</span>
          <input className="fos-input" value={form.creatorName} maxLength={12} placeholder="例如：蓝喵工作室" disabled={saving} onChange={(event) => onChange({ ...form, creatorName: event.target.value })} />
          <FieldError message={fieldErrors.creatorName} />
        </label>
        <label className="nori-mp-switch">
          <input type="checkbox" checked={form.trailerEnabled} disabled={saving} onChange={(event) => onChange({ ...form, trailerEnabled: event.target.checked })} />
          <span>预告片<small>自动生成 15 秒预告片</small></span>
        </label>
      </div>
      <p className="nori-ix-note">上架信息随版本一起审核，修改后需要重新生成版本才会在小程序里生效。</p>
      <div className="nori-mp-card-foot">
        <button type="button" className="fos-btn fos-btn-primary" disabled={saving} onClick={onSave}>
          {saving ? <Loader2 className="nori-ix-spin" /> : null}保存
        </button>
      </div>
    </section>
  )
}

export function ScheduleCard({ form, fieldErrors, onChange }: {
  form: ListingForm
  fieldErrors: Record<string, string>
  onChange: (form: ListingForm) => void
}) {
  const min = toDatetimeLocal(new Date(Date.now() + 3600_000).toISOString())
  const max = toDatetimeLocal(new Date(Date.now() + 60 * 24 * 3600_000).toISOString())
  return (
    <section className="nori-mp-card">
      <h2>上线设置</h2>
      <div className="nori-mp-radio" role="radiogroup" aria-label="上线时间">
        <label>
          <input type="radio" name="mp-schedule" checked={form.scheduleMode === 'now'} onChange={() => onChange({ ...form, scheduleMode: 'now', scheduledAt: null })} />
          审核通过后立即上线
        </label>
        <label>
          <input type="radio" name="mp-schedule" checked={form.scheduleMode === 'at'} onChange={() => onChange({ ...form, scheduleMode: 'at' })} />
          定时上线
        </label>
      </div>
      {form.scheduleMode === 'at' ? (
        <label className="nori-ix-field">
          <span>上线时间（北京时间）</span>
          <input
            className="fos-input"
            type="datetime-local"
            min={min}
            max={max}
            value={toDatetimeLocal(form.scheduledAt)}
            onChange={(event) => onChange({ ...form, scheduledAt: fromDatetimeLocal(event.target.value) })}
          />
          <FieldError message={fieldErrors.scheduledAt} />
        </label>
      ) : null}
      <label className="nori-mp-check">
        <input type="checkbox" checked={form.reservable} onChange={(event) => onChange({ ...form, reservable: event.target.checked })} />
        <span>开放预约（上线前观众可以预约，并在上线时收到提醒）</span>
      </label>
      <p className="nori-ix-note">和上架信息共用「保存」按钮。</p>
    </section>
  )
}
