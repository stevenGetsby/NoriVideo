'use client'

import { useCallback, useRef, useState } from 'react'
import { AppIcon } from '@/components/ui/icons'
import { apiFetch } from '@/lib/api-fetch'

interface DirectUploadSectionProps {
  onImagesReady: (imageUrls: string[]) => void
  maxImages?: number
  label?: string
  hint?: string
}

export function DirectUploadSection({
  onImagesReady,
  maxImages = 5,
  label = '直接上传图片',
  hint = '上传已制作好的图片，直接作为资产，不经过 AI 生成',
}: DirectUploadSectionProps) {
  const [images, setImages] = useState<string[]>([])
  const [previews, setPreviews] = useState<string[]>([])
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFileSelect = useCallback(async (files: FileList) => {
    const fileArray = Array.from(files).filter((f) => f.type.startsWith('image/')).slice(0, maxImages - images.length)
    if (fileArray.length === 0) return

    setUploading(true)
    try {
      const newUrls: string[] = []
      const newPreviews: string[] = []
      for (const file of fileArray) {
        const base64 = await new Promise<string>((resolve) => {
          const reader = new FileReader()
          reader.onload = (e) => resolve(e.target?.result as string)
          reader.readAsDataURL(file)
        })
        newPreviews.push(base64)
        const res = await apiFetch('/api/asset-hub/upload-temp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageBase64: base64 }),
        })
        if (res.ok) {
          const data = await res.json()
          if (data.key) newUrls.push(data.key)
          else if (data.url) newUrls.push(data.url)
        }
      }
      const allUrls = [...images, ...newUrls]
      setImages(allUrls)
      setPreviews(prev => [...prev, ...newPreviews])
      onImagesReady(allUrls)
    } finally {
      setUploading(false)
    }
  }, [images, maxImages, onImagesReady])

  const removeImage = useCallback((index: number) => {
    const next = images.filter((_, i) => i !== index)
    const nextPreviews = previews.filter((_, i) => i !== index)
    setImages(next)
    setPreviews(nextPreviews)
    onImagesReady(next)
  }, [images, previews, onImagesReady])

  return (
    <div className="glass-surface-soft rounded-xl p-4 space-y-3 border border-dashed border-[var(--glass-stroke-strong)]">
      <div className="flex items-center gap-2 text-sm font-medium text-[var(--glass-tone-info-fg)]">
        <AppIcon name="upload" className="w-4 h-4" />
        <span>{label}</span>
      </div>
      <p className="text-xs text-[var(--glass-text-tertiary)]">{hint}</p>

      {previews.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          {previews.map((preview, i) => (
            <div key={i} className="relative w-16 h-16 rounded-lg overflow-hidden border border-[var(--glass-stroke-base)] group">
              <img src={preview} alt="" className="w-full h-full object-cover" />
              <button
                onClick={() => removeImage(i)}
                className="absolute top-0 right-0 w-4 h-4 bg-[var(--glass-tone-danger-bg)] text-[var(--glass-tone-danger-fg)] rounded-bl-lg flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <AppIcon name="close" className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={uploading || images.length >= maxImages}
        className="glass-btn-base glass-btn-secondary w-full py-2 text-xs rounded-lg disabled:opacity-50 flex items-center justify-center gap-1.5"
      >
        {uploading ? (
          <span>上传中...</span>
        ) : (
          <>
            <AppIcon name="plus" className="w-3.5 h-3.5" />
            <span>选择图片（最多 {maxImages} 张）</span>
          </>
        )}
      </button>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => { if (e.target.files) { void handleFileSelect(e.target.files); e.target.value = '' } }}
      />
    </div>
  )
}
