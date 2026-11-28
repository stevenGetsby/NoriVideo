'use client'

import { useCallback, useEffect, useRef, useState, type ChangeEvent, type ClipboardEvent, type DragEvent } from 'react'
import { AppIcon } from '@/components/ui/icons'
import { ViewportDialogLayer } from '@/components/frameos/ViewportDialogLayer'
import { apiFetch } from '@/lib/api-fetch'
import { readApiErrorMessage } from '@/lib/api/read-error-message'

export const MAX_FEEDBACK_IMAGES = 5
const MAX_FEEDBACK_IMAGE_BYTES = 10 * 1024 * 1024
const ACCEPTED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

export type FeedbackUploadedAttachment = {
  key: string
  url: string
  mimeType: string
  name?: string
  size?: number
  width?: number
  height?: number
}

export type FeedbackBrowserContext = {
  viewport?: string
  dpr?: number
  locale?: string
  appVersion?: string
}

export type FeedbackUploadDraft = {
  localId: string
  file: File
  previewUrl: string
  status: 'uploading' | 'done' | 'error'
  error?: string
  attachment?: FeedbackUploadedAttachment
}

export function collectFeedbackBrowserContext(appVersion?: string): FeedbackBrowserContext {
  if (typeof window === 'undefined') {
    return appVersion ? { appVersion } : {}
  }
  return {
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    dpr: Number.isFinite(window.devicePixelRatio) ? Math.round(window.devicePixelRatio * 100) / 100 : undefined,
    locale: document.documentElement.lang || navigator.language || undefined,
    ...(appVersion ? { appVersion } : {}),
  }
}

export function extractClipboardImageFiles(clipboardData: DataTransfer | null | undefined): File[] {
  if (!clipboardData) return []
  const files: File[] = []
  if (clipboardData.items && clipboardData.items.length > 0) {
    for (let i = 0; i < clipboardData.items.length; i += 1) {
      const item = clipboardData.items[i]
      if (item.kind !== 'file') continue
      if (item.type && !item.type.toLowerCase().startsWith('image/')) continue
      const file = item.getAsFile()
      if (file) files.push(file)
    }
  }
  if (files.length === 0 && clipboardData.files && clipboardData.files.length > 0) {
    for (let i = 0; i < clipboardData.files.length; i += 1) {
      const file = clipboardData.files[i]
      if (file && (!file.type || file.type.toLowerCase().startsWith('image/'))) {
        files.push(file)
      }
    }
  }
  return files
}

function readImageDimensions(previewUrl: string): Promise<{ width?: number; height?: number }> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined') { resolve({}); return }
    const img = new window.Image()
    img.onload = () => resolve({
      width: img.naturalWidth > 0 ? img.naturalWidth : undefined,
      height: img.naturalHeight > 0 ? img.naturalHeight : undefined,
    })
    img.onerror = () => resolve({})
    img.src = previewUrl
  })
}

async function uploadSingleFeedbackImage(file: File, previewUrl: string): Promise<FeedbackUploadedAttachment> {
  if (file.size <= 0) throw new Error('图片文件为空')
  if (file.size > MAX_FEEDBACK_IMAGE_BYTES) throw new Error('单张截图不能超过 10MB')
  const mime = (file.type || '').trim().toLowerCase()
  if (mime && !ACCEPTED_IMAGE_TYPES.has(mime)) {
    throw new Error('仅支持 PNG、JPEG、WebP 或 GIF 截图')
  }

  const formData = new FormData()
  const ext = mime === 'image/jpeg' ? 'jpg' : mime === 'image/webp' ? 'webp' : mime === 'image/gif' ? 'gif' : 'png'
  const filename = file.name && file.name.trim() ? file.name : `screenshot-${Date.now()}.${ext}`
  formData.append('file', file, filename)

  const [dims, response] = await Promise.all([
    readImageDimensions(previewUrl),
    apiFetch('/api/feedback/upload', { method: 'POST', body: formData }),
  ])
  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response, '截图上传失败，请重试'))
  }
  const payload = await response.json() as {
    attachment?: FeedbackUploadedAttachment
  }
  if (!payload.attachment?.key) {
    throw new Error('截图上传返回异常，请重试')
  }
  return {
    ...payload.attachment,
    ...(dims.width ? { width: dims.width } : {}),
    ...(dims.height ? { height: dims.height } : {}),
  }
}

export function useFeedbackAttachments(maxImages = MAX_FEEDBACK_IMAGES) {
  const [items, setItems] = useState<FeedbackUploadDraft[]>([])
  const [limitNotice, setLimitNotice] = useState<string | null>(null)
  const itemsRef = useRef<FeedbackUploadDraft[]>([])
  itemsRef.current = items
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      for (const item of itemsRef.current) {
        URL.revokeObjectURL(item.previewUrl)
      }
    }
  }, [])

  const runUpload = useCallback((localId: string, file: File, previewUrl: string) => {
    void uploadSingleFeedbackImage(file, previewUrl)
      .then((attachment) => {
        if (!mountedRef.current) return
        setItems((current) => current.map((entry) => (
          entry.localId === localId
            ? { ...entry, status: 'done', error: undefined, attachment }
            : entry
        )))
      })
      .catch((uploadError) => {
        if (!mountedRef.current) return
        const message = uploadError instanceof Error ? uploadError.message : '截图上传失败'
        setItems((current) => current.map((entry) => (
          entry.localId === localId
            ? { ...entry, status: 'error', error: message }
            : entry
        )))
      })
  }, [])

  const addFiles = useCallback((rawFiles: FileList | File[]) => {
    const incoming = Array.from(rawFiles).filter((file) => (
      file && (!file.type || file.type.toLowerCase().startsWith('image/'))
    ))
    if (incoming.length === 0) return false
    const remaining = Math.max(0, maxImages - itemsRef.current.length)
    if (remaining === 0) {
      setLimitNotice(`最多附带 ${maxImages} 张截图`)
      return true
    }
    const accepted = incoming.slice(0, remaining)
    setLimitNotice(incoming.length > remaining ? `已选取前 ${remaining} 张（最多 ${maxImages} 张）` : null)

    const drafts: FeedbackUploadDraft[] = accepted.map((file, idx) => ({
      localId: `${Date.now()}-${idx}-${Math.random().toString(16).slice(2, 8)}`,
      file,
      previewUrl: URL.createObjectURL(file),
      status: 'uploading',
    }))
    setItems((current) => [...current, ...drafts])
    for (const draft of drafts) {
      runUpload(draft.localId, draft.file, draft.previewUrl)
    }
    return true
  }, [maxImages, runUpload])

  const retryItem = useCallback((localId: string) => {
    const target = itemsRef.current.find((entry) => entry.localId === localId)
    if (!target || target.status === 'uploading') return
    setItems((current) => current.map((entry) => (
      entry.localId === localId ? { ...entry, status: 'uploading', error: undefined } : entry
    )))
    runUpload(target.localId, target.file, target.previewUrl)
  }, [runUpload])

  const removeItem = useCallback((localId: string) => {
    setLimitNotice(null)
    setItems((current) => {
      const target = current.find((entry) => entry.localId === localId)
      if (target) URL.revokeObjectURL(target.previewUrl)
      return current.filter((entry) => entry.localId !== localId)
    })
  }, [])

  const clearAll = useCallback(() => {
    setLimitNotice(null)
    setItems((current) => {
      for (const entry of current) URL.revokeObjectURL(entry.previewUrl)
      return []
    })
  }, [])

  const handleClipboardPaste = useCallback((clipboardData: DataTransfer | null | undefined): boolean => {
    const imageFiles = extractClipboardImageFiles(clipboardData)
    if (imageFiles.length === 0) return false
    return addFiles(imageFiles)
  }, [addFiles])

  const handleReactPaste = useCallback((event: ClipboardEvent<HTMLElement>) => {
    if (event.defaultPrevented) return
    if (handleClipboardPaste(event.clipboardData)) {
      event.preventDefault()
    }
  }, [handleClipboardPaste])

  const uploadedAttachments = items
    .filter((entry): entry is FeedbackUploadDraft & { attachment: FeedbackUploadedAttachment } => (
      entry.status === 'done' && Boolean(entry.attachment)
    ))
    .map((entry) => entry.attachment)
  const isUploading = items.some((entry) => entry.status === 'uploading')
  const hasFailedUploads = items.some((entry) => entry.status === 'error')
  const canAddMore = items.length < maxImages

  return {
    items,
    limitNotice,
    uploadedAttachments,
    isUploading,
    hasFailedUploads,
    canAddMore,
    maxImages,
    addFiles,
    retryItem,
    removeItem,
    clearAll,
    handleClipboardPaste,
    handleReactPaste,
  }
}

export function FeedbackImageUploader({
  items,
  limitNotice,
  maxImages = MAX_FEEDBACK_IMAGES,
  disabled = false,
  onAddFiles,
  onRetry,
  onRemove,
}: {
  items: FeedbackUploadDraft[]
  limitNotice?: string | null
  maxImages?: number
  disabled?: boolean
  onAddFiles: (files: FileList | File[]) => void
  onRetry: (localId: string) => void
  onRemove: (localId: string) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)
  const canAddMore = !disabled && items.length < maxImages

  useEffect(() => {
    if (!lightboxUrl) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        setLightboxUrl(null)
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [lightboxUrl])

  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files.length > 0) {
      onAddFiles(event.target.files)
    }
    event.target.value = ''
  }

  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!canAddMore) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    if (!dragging) setDragging(true)
  }

  const onDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
    setDragging(false)
  }

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragging(false)
    if (!canAddMore) return
    if (event.dataTransfer.files && event.dataTransfer.files.length > 0) {
      onAddFiles(event.dataTransfer.files)
    }
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-bold text-[var(--fos-text-1)]">问题截图</span>
          <span className="rounded bg-[var(--fos-fill-soft)] px-1.5 py-0.5 text-[11px] text-[var(--fos-text-4)]">
            {items.length} / {maxImages}
          </span>
        </div>
        <span className="text-[11px] text-[var(--fos-text-4)]">支持 Ctrl+V / ⌘+V 直接粘贴、拖拽或点击上传</span>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        multiple
        className="hidden"
        disabled={!canAddMore}
        onChange={onFileChange}
      />

      <div
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className={`rounded-[10px] border border-dashed p-3 transition-colors ${
          dragging
            ? 'border-[var(--fos-primary-border)] bg-[var(--fos-primary-soft)]'
            : 'border-[var(--fos-border-strong)] bg-[var(--fos-bg-1)]'
        }`}
      >
        {items.length === 0 ? (
          <button
            type="button"
            disabled={!canAddMore}
            onClick={() => inputRef.current?.click()}
            className="flex w-full items-center justify-center gap-2.5 rounded-[8px] py-3 text-[12px] text-[var(--fos-text-3)] transition-colors hover:bg-[var(--fos-fill-soft)] hover:text-[var(--fos-text-1)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <AppIcon name="image" className="h-4 w-4 text-[var(--fos-primary-text)]" />
            <span>直接 <kbd className="rounded border border-[var(--fos-border-mid)] bg-[var(--fos-bg-3)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--fos-text-2)]">Ctrl+V</kbd> 粘贴截图，或点此选择图片（PNG / JPG / WebP，单张 ≤ 10MB）</span>
          </button>
        ) : (
          <div className="flex flex-wrap items-center gap-2.5">
            {items.map((item) => (
              <div
                key={item.localId}
                className={`group relative h-[76px] w-[108px] overflow-hidden rounded-[8px] border bg-[var(--fos-bg-2)] ${
                  item.status === 'error'
                    ? 'border-[rgba(229,72,77,.55)]'
                    : 'border-[var(--fos-border-mid)]'
                }`}
              >
                <button
                  type="button"
                  title={item.status === 'error' ? (item.error || '上传失败') : '点击查看大图'}
                  onClick={() => setLightboxUrl(item.attachment?.url || item.previewUrl)}
                  className="block h-full w-full cursor-zoom-in p-0"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={item.previewUrl}
                    alt={item.file.name || '反馈截图'}
                    className={`h-full w-full object-cover transition-opacity ${item.status === 'uploading' ? 'opacity-50' : 'opacity-100'}`}
                  />
                </button>

                {item.status === 'uploading' ? (
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/35 text-white">
                    <AppIcon name="loader" className="h-4 w-4 animate-spin" />
                  </div>
                ) : null}

                {item.status === 'error' ? (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/65 px-1.5 text-center text-[10px] text-white">
                    <span className="line-clamp-2 leading-tight text-[rgb(var(--nori-t-ff8589))]">{item.error || '上传失败'}</span>
                    <button
                      type="button"
                      onClick={() => onRetry(item.localId)}
                      className="inline-flex items-center gap-1 rounded bg-white/15 px-1.5 py-0.5 text-[10px] font-medium text-white hover:bg-white/25"
                    >
                      <AppIcon name="refresh" className="h-2.5 w-2.5" />重试
                    </button>
                  </div>
                ) : null}

                {!disabled ? (
                  <button
                    type="button"
                    aria-label="移除截图"
                    title="移除截图"
                    onClick={() => onRemove(item.localId)}
                    className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/70 text-white opacity-90 transition-opacity hover:bg-black group-hover:opacity-100"
                  >
                    <AppIcon name="close" className="h-3 w-3" />
                  </button>
                ) : null}
              </div>
            ))}

            {canAddMore ? (
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="flex h-[76px] w-[88px] flex-col items-center justify-center gap-1 rounded-[8px] border border-dashed border-[var(--fos-border-strong)] text-[11px] text-[var(--fos-text-3)] transition-colors hover:border-[var(--fos-primary-border)] hover:bg-[var(--fos-fill-soft)] hover:text-[var(--fos-text-1)]"
              >
                <AppIcon name="plus" className="h-4 w-4" />
                <span>添加截图</span>
              </button>
            ) : null}
          </div>
        )}
      </div>

      {limitNotice ? (
        <div className="mt-1.5 text-[11px] text-[rgb(var(--nori-t-ffd98a))]">{limitNotice}</div>
      ) : null}

      {lightboxUrl ? (
        <ViewportDialogLayer>
          <div
            className="fixed inset-0 z-[90] flex items-center justify-center bg-black/80 p-6"
            onClick={() => setLightboxUrl(null)}
            role="dialog"
            aria-modal="true"
            aria-label="截图预览"
          >
            <button
              type="button"
              aria-label="关闭预览"
              onClick={() => setLightboxUrl(null)}
              className="fixed right-5 top-5 flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/85"
            >
              <AppIcon name="close" className="h-4 w-4" />
            </button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={lightboxUrl}
              alt="反馈截图大图"
              onClick={(event) => event.stopPropagation()}
              className="max-h-[88vh] max-w-[90vw] rounded-[10px] border border-white/15 object-contain shadow-2xl"
            />
          </div>
        </ViewportDialogLayer>
      ) : null}
    </div>
  )
}
