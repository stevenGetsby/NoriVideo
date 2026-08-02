'use client'

import { useEffect, useRef, useState } from 'react'
import type { Dispatch, DragEvent, SetStateAction } from 'react'
import { AppIcon } from '@/components/ui/icons'
import type {
  ProjectStyleReferenceDraftFile,
} from '@/lib/projects/style-reference-contract'
import {
  PROJECT_STYLE_REFERENCE_MAX_COUNT,
  PROJECT_STYLE_REFERENCE_MAX_FILE_BYTES,
  PROJECT_STYLE_REFERENCE_MAX_VIDEO_SECONDS,
  projectStyleReferenceKind,
} from '@/lib/projects/style-reference-contract'
import type { ProjectStyleReferenceUploadStatus } from '@/lib/projects/create-project-request'

type ValidationStatus = 'validating' | 'ready' | 'failed'

export interface ProjectStyleReferenceItem extends ProjectStyleReferenceDraftFile {
  previewUrl: string
  validationStatus: ValidationStatus
  uploadStatus: ProjectStyleReferenceUploadStatus
  progress: number
  error: string | null
}

function createItemId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `style-ref-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function fileIdentity(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`
}

function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

function readVideoDuration(previewUrl: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.onloadedmetadata = () => {
      const duration = video.duration
      video.removeAttribute('src')
      video.load()
      if (Number.isFinite(duration) && duration > 0) resolve(duration)
      else reject(new Error('无法读取视频时长'))
    }
    video.onerror = () => reject(new Error('无法读取视频'))
    video.src = previewUrl
  })
}

function uploadLabel(item: ProjectStyleReferenceItem): string {
  if (item.validationStatus === 'validating') return '正在读取'
  if (item.validationStatus === 'failed') return item.error || '文件不可用'
  if (item.uploadStatus === 'uploading') return `上传 ${item.progress}%`
  if (item.uploadStatus === 'processing') return '正在校验并保存'
  if (item.uploadStatus === 'uploaded') return '已保存'
  if (item.uploadStatus === 'failed') return item.error || '上传失败'
  const duration = item.durationSeconds == null ? '' : ` · ${item.durationSeconds.toFixed(1)} 秒`
  return `${formatFileSize(item.file.size)}${duration}`
}

export function ProjectStyleReferencePicker({
  items,
  setItems,
  disabled,
  onError,
}: {
  items: ProjectStyleReferenceItem[]
  setItems: Dispatch<SetStateAction<ProjectStyleReferenceItem[]>>
  disabled: boolean
  onError: (message: string | null) => void
}) {
  const [dragActive, setDragActive] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const previewUrlsRef = useRef(new Set<string>())

  useEffect(() => () => {
    for (const url of previewUrlsRef.current) URL.revokeObjectURL(url)
    previewUrlsRef.current.clear()
  }, [])

  const updateItem = (id: string, update: Partial<ProjectStyleReferenceItem>) => {
    setItems((current) => current.map((item) => item.id === id ? { ...item, ...update } : item))
  }

  const addFiles = (incoming: File[]) => {
    if (disabled || incoming.length === 0) return
    const existing = new Set(items.map((item) => fileIdentity(item.file)))
    const available = Math.max(0, PROJECT_STYLE_REFERENCE_MAX_COUNT - items.length)
    const unique = incoming.filter((file) => !existing.has(fileIdentity(file)))
    if (unique.length > available) {
      onError(`画风参考最多上传 ${PROJECT_STYLE_REFERENCE_MAX_COUNT} 个文件。`)
    }

    const accepted: ProjectStyleReferenceItem[] = []
    for (const file of unique.slice(0, available)) {
      const kind = projectStyleReferenceKind(file)
      if (!kind) {
        onError('画风参考仅支持 JPG、PNG、MP4 或 MOV 文件。')
        continue
      }
      if (file.size <= 0 || file.size > PROJECT_STYLE_REFERENCE_MAX_FILE_BYTES) {
        onError('单个画风参考文件必须小于 200MB。')
        continue
      }
      const previewUrl = URL.createObjectURL(file)
      previewUrlsRef.current.add(previewUrl)
      accepted.push({
        id: createItemId(),
        file,
        kind,
        durationSeconds: null,
        previewUrl,
        validationStatus: kind === 'video' ? 'validating' : 'ready',
        uploadStatus: 'idle',
        progress: 0,
        error: null,
      })
    }
    if (accepted.length === 0) return
    setItems((current) => [...current, ...accepted])
    if (unique.length <= available) onError(null)

    for (const item of accepted) {
      if (item.kind !== 'video') continue
      void readVideoDuration(item.previewUrl)
        .then((durationSeconds) => {
          if (durationSeconds > PROJECT_STYLE_REFERENCE_MAX_VIDEO_SECONDS) {
            updateItem(item.id, {
              validationStatus: 'failed',
              error: '视频不能超过 1 分钟',
            })
            return
          }
          updateItem(item.id, { durationSeconds, validationStatus: 'ready', error: null })
        })
        .catch(() => updateItem(item.id, {
          validationStatus: 'failed',
          error: '无法读取这个视频',
        }))
    }
  }

  const removeItem = (id: string) => {
    if (disabled) return
    const removed = items.find((item) => item.id === id)
    if (removed) {
      URL.revokeObjectURL(removed.previewUrl)
      previewUrlsRef.current.delete(removed.previewUrl)
    }
    setItems((current) => current.filter((item) => item.id !== id))
    onError(null)
  }

  const receiveFiles = (fileList: FileList | null | undefined) => {
    addFiles(fileList ? Array.from(fileList) : [])
  }

  return (
    <div className="create-project-style-reference-picker">
      <div className="create-project-style-reference-head">
        <span>参考素材</span>
        <small>{items.length} / {PROJECT_STYLE_REFERENCE_MAX_COUNT}</small>
      </div>
      {items.length > 0 ? (
        <div className="create-project-style-reference-grid" aria-label="已选择的画风参考">
          {items.map((item) => (
            <div
              key={item.id}
              className={`create-project-style-reference-card${item.validationStatus === 'failed' || item.uploadStatus === 'failed' ? ' is-failed' : ''}`}
            >
              {item.kind === 'image' ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={item.previewUrl} alt={item.file.name} />
              ) : (
                <video src={item.previewUrl} muted playsInline preload="metadata" />
              )}
              <div className="create-project-style-reference-shade" />
              <span className="create-project-style-reference-kind"><AppIcon name={item.kind === 'image' ? 'image' : 'video'} /></span>
              <div className="create-project-style-reference-copy">
                <strong title={item.file.name}>{item.file.name}</strong>
                <small>{uploadLabel(item)}</small>
              </div>
              {item.uploadStatus === 'uploading' || item.uploadStatus === 'processing' ? (
                <span className="create-project-style-reference-progress" style={{ width: `${Math.max(3, item.progress)}%` }} />
              ) : null}
              {item.uploadStatus === 'uploaded' ? <span className="create-project-style-reference-ok"><AppIcon name="check" /></span> : null}
              <button type="button" disabled={disabled} onClick={() => removeItem(item.id)} aria-label={`移除 ${item.file.name}`}><AppIcon name="close" /></button>
            </div>
          ))}
        </div>
      ) : null}
      <div
        className={`create-project-style-reference-drop${dragActive ? ' is-dragging' : ''}${items.length >= PROJECT_STYLE_REFERENCE_MAX_COUNT ? ' is-full' : ''}`}
        role="button"
        tabIndex={disabled || items.length >= PROJECT_STYLE_REFERENCE_MAX_COUNT ? -1 : 0}
        onClick={() => { if (!disabled && items.length < PROJECT_STYLE_REFERENCE_MAX_COUNT) inputRef.current?.click() }}
        onKeyDown={(event) => {
          if ((event.key === 'Enter' || event.key === ' ') && !disabled && items.length < PROJECT_STYLE_REFERENCE_MAX_COUNT) inputRef.current?.click()
        }}
        onDragOver={(event: DragEvent) => { event.preventDefault(); if (!disabled) setDragActive(true) }}
        onDragLeave={() => setDragActive(false)}
        onDrop={(event: DragEvent) => {
          event.preventDefault()
          setDragActive(false)
          receiveFiles(event.dataTransfer.files)
        }}
        onPaste={(event) => receiveFiles(event.clipboardData.files)}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          hidden
          disabled={disabled}
          accept=".jpg,.jpeg,.png,.mp4,.mov,image/jpeg,image/png,video/mp4,video/quicktime"
          onChange={(event) => { receiveFiles(event.currentTarget.files); event.currentTarget.value = '' }}
        />
        <AppIcon name={items.length >= PROJECT_STYLE_REFERENCE_MAX_COUNT ? 'check' : 'cloudUpload'} />
        <span>{items.length >= PROJECT_STYLE_REFERENCE_MAX_COUNT ? '已选满 4 个参考' : '选择、拖拽或粘贴图片 / 视频'}</span>
        <small>JPG / PNG / MP4 / MOV · 视频最长 1 分钟</small>
      </div>
    </div>
  )
}

export function toProjectStyleReferenceDraftFiles(
  items: ProjectStyleReferenceItem[],
): ProjectStyleReferenceDraftFile[] {
  return items.map(({ id, file, kind, durationSeconds }) => ({ id, file, kind, durationSeconds }))
}
