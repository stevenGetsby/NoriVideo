'use client'

import { useCallback, useRef, useState } from 'react'
import { AppIcon } from '@/components/ui/icons'
import { apiFetch } from '@/lib/api-fetch'

interface AddPanelModalProps {
  onSubmit: (data: { description: string; imageUrl?: string; videoPrompt?: string }) => void
  onClose: () => void
}

export function AddPanelModal({ onSubmit, onClose }: AddPanelModalProps) {
  const [mode, setMode] = useState<'blank' | 'upload'>('blank')
  const [description, setDescription] = useState('')
  const [videoPrompt, setVideoPrompt] = useState('')
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFileSelect = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) return
    setUploading(true)

    // Preview
    const base64 = await new Promise<string>((resolve) => {
      const reader = new FileReader()
      reader.onload = (e) => resolve(e.target?.result as string)
      reader.readAsDataURL(file)
    })
    setImagePreview(base64)

    // Upload as base64 JSON, get storage key
    try {
      const res = await apiFetch('/api/asset-hub/upload-temp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: base64 }),
      })
      if (res.ok) {
        const data = await res.json()
        setImageUrl(data.key || data.url || null)
      }
    } finally {
      setUploading(false)
    }
  }, [])

  const handleSubmit = useCallback(() => {
    onSubmit({
      description: description.trim() || '新镜头',
      imageUrl: imageUrl || undefined,
      videoPrompt: videoPrompt.trim() || undefined,
    })
  }, [description, imageUrl, videoPrompt, onSubmit])

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="glass-surface-modal w-full max-w-md rounded-2xl p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-[var(--glass-text-primary)]">添加分镜面板</h3>
          <button onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--glass-text-tertiary)] hover:bg-[var(--glass-surface-hover)]">
            <AppIcon name="close" className="h-4 w-4" />
          </button>
        </div>

        {/* 模式切换 */}
        <div className="flex gap-2 p-1 glass-surface-soft rounded-xl mb-4">
          <button
            type="button"
            onClick={() => setMode('blank')}
            className={`flex-1 py-2 text-xs font-medium rounded-lg transition-all ${mode === 'blank'
              ? 'bg-[var(--glass-bg-surface)] text-[var(--glass-text-primary)] shadow-sm'
              : 'text-[var(--glass-text-tertiary)]'}`}
          >
            空白面板
          </button>
          <button
            type="button"
            onClick={() => setMode('upload')}
            className={`flex-1 py-2 text-xs font-medium rounded-lg transition-all ${mode === 'upload'
              ? 'bg-[var(--glass-bg-surface)] text-[var(--glass-text-primary)] shadow-sm'
              : 'text-[var(--glass-text-tertiary)]'}`}
          >
            上传分镜图
          </button>
        </div>

        <div className="space-y-3">
          {/* 描述 */}
          <div>
            <label className="mb-1 block text-xs text-[var(--glass-text-secondary)]">镜头描述</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="描述这个镜头的画面内容..."
              className="glass-input-base w-full resize-y px-3 py-2 text-sm"
              rows={3}
            />
          </div>

          {/* 视频提示词 */}
          <div>
            <label className="mb-1 block text-xs text-[var(--glass-text-secondary)]">视频提示词（可选）</label>
            <textarea
              value={videoPrompt}
              onChange={(e) => setVideoPrompt(e.target.value)}
              placeholder="视频生成的动态描述..."
              className="glass-input-base w-full resize-y px-3 py-2 text-sm"
              rows={2}
            />
          </div>

          {/* 上传分镜图 */}
          {mode === 'upload' && (
            <div>
              <label className="mb-1 block text-xs text-[var(--glass-text-secondary)]">分镜图片</label>
              {imagePreview ? (
                <div className="relative rounded-lg overflow-hidden border border-[var(--glass-stroke-base)]">
                  <img src={imagePreview} alt="" className="w-full max-h-48 object-contain bg-black/20" />
                  <button
                    onClick={() => { setImagePreview(null); setImageUrl(null) }}
                    className="absolute top-2 right-2 w-6 h-6 bg-black/60 text-white rounded-full flex items-center justify-center"
                  >
                    <AppIcon name="close" className="w-3 h-3" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="w-full py-6 border-2 border-dashed border-[var(--glass-stroke-strong)] rounded-lg text-[var(--glass-text-tertiary)] hover:border-[var(--glass-tone-info-fg)] hover:text-[var(--glass-tone-info-fg)] transition-colors flex flex-col items-center gap-2"
                >
                  <AppIcon name="image" className="w-8 h-8" />
                  <span className="text-xs">{uploading ? '上传中...' : '点击上传分镜图'}</span>
                </button>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => { if (e.target.files?.[0]) { void handleFileSelect(e.target.files[0]); e.target.value = '' } }}
              />
            </div>
          )}
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="glass-btn-base h-9 px-4 text-sm">取消</button>
          <button
            onClick={handleSubmit}
            disabled={uploading || (mode === 'upload' && !imageUrl)}
            className="glass-btn-base glass-btn-primary h-9 px-4 text-sm disabled:opacity-50"
          >
            添加
          </button>
        </div>
      </div>
    </div>
  )
}
