'use client'

import { useRef, useState } from 'react'
import { MediaImage } from '@/components/media/MediaImage'
import { ImageIcon, X } from '@/components/ui/icons'
import { STORY_ASSET_ACCEPT, uploadStoryAsset } from '@/features/interactive/story-asset-upload'
import { toDisplayImageUrl } from '@/lib/media/image-url'

const display = (url: string | null | undefined) => (url ? toDisplayImageUrl(url) || url : null)

/**
 * One picture of an interaction or an option: a thumbnail with upload / replace / remove.
 * Uploads go to the 影游 asset endpoint; a canvas without a work id cannot upload.
 */
export function StoryImageField({ label = '图片', value, workId, readOnly, compact = false, onChange }: {
  label?: string
  value: string | null
  workId: string | null
  readOnly: boolean
  compact?: boolean
  onChange: (url: string | null) => void
}) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const disabled = readOnly || !workId || busy
  const src = display(value)

  const pick = () => {
    if (disabled) return
    setError(null)
    inputRef.current?.click()
  }

  const upload = async (file: File | null | undefined) => {
    if (!file || !workId) return
    setBusy(true)
    setError(null)
    try {
      const result = await uploadStoryAsset(workId, file)
      onChange(result.url)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '上传图片失败')
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <div className={`nori-story-image-field${compact ? ' is-compact' : ''}`}>
      <input
        ref={inputRef}
        type="file"
        className="nodrag nori-story-image-input"
        accept={STORY_ASSET_ACCEPT}
        disabled={disabled}
        data-testid="story-image-input"
        onChange={(event) => void upload(event.target.files?.[0])}
      />
      {compact ? (
        <>
          <button
            type="button"
            className="nori-story-image-button nodrag"
            aria-label={`${label}：${value ? '更换' : '上传'}`}
            title={readOnly ? undefined : `${value ? '更换' : '上传'}${label}`}
            disabled={disabled}
            onClick={pick}
          >
            {src ? <MediaImage src={src} alt={label} fill sizes="26px" draggable={false} /> : <ImageIcon />}
          </button>
          {value && !readOnly ? (
            <button type="button" className="nori-story-image-remove nodrag" aria-label={`移除${label}`} title={`移除${label}`} onClick={() => onChange(null)}>
              <X />
            </button>
          ) : null}
        </>
      ) : (
        <>
          <span className="nori-story-image-thumb">
            {src
              ? <MediaImage src={src} alt={label} fill sizes="32px" draggable={false} />
              : <span className="nori-story-image-empty"><ImageIcon /></span>}
          </span>
          <span className="nori-story-image-copy">
            <span className="nori-story-image-label">{label}</span>
            <span className="nori-story-image-actions">
              <button type="button" className="nodrag" data-testid="story-image-upload" disabled={disabled} onClick={pick}>
                {busy ? '上传中…' : src ? '更换' : '上传'}
              </button>
              {value && !readOnly ? (
                <button type="button" className="nodrag" disabled={busy} onClick={() => onChange(null)}>移除</button>
              ) : null}
            </span>
            {error ? <span className="nori-story-image-error" role="alert">{error}</span> : null}
          </span>
        </>
      )}
      {compact && error ? <span className="nori-story-image-error" role="alert">{error}</span> : null}
    </div>
  )
}
