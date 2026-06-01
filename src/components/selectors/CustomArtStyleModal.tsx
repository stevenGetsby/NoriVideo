'use client'

import { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { AppIcon } from '@/components/ui/icons'
import type { CustomArtStyle } from '@/lib/constants'

interface CustomArtStyleModalProps {
  isOpen: boolean
  editingStyle?: CustomArtStyle | null
  onSave: (data: { label: string; promptZh: string; promptEn: string }) => void
  onClose: () => void
}

export function CustomArtStyleModal({ isOpen, editingStyle, onSave, onClose }: CustomArtStyleModalProps) {
  const [label, setLabel] = useState('')
  const [promptZh, setPromptZh] = useState('')
  const [promptEn, setPromptEn] = useState('')

  useEffect(() => {
    if (editingStyle) {
      setLabel(editingStyle.label)
      setPromptZh(editingStyle.promptZh)
      setPromptEn(editingStyle.promptEn)
    } else {
      setLabel('')
      setPromptZh('')
      setPromptEn('')
    }
  }, [editingStyle, isOpen])

  const handleSave = useCallback(() => {
    if (!label.trim() || !promptZh.trim()) return
    onSave({
      label: label.trim(),
      promptZh: promptZh.trim(),
      promptEn: promptEn.trim() || promptZh.trim(),
    })
  }, [label, promptZh, promptEn, onSave])

  if (!isOpen) return null

  return createPortal(
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/50"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="glass-surface-modal w-full max-w-md rounded-2xl p-5"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-semibold text-[var(--glass-text-primary)]">
            {editingStyle ? '编辑自定义风格' : '添加自定义风格'}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--glass-text-tertiary)] hover:bg-[var(--glass-surface-hover)]"
          >
            <AppIcon name="close" className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs text-[var(--glass-text-secondary)]">风格名称</label>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="例如：水彩画风格"
              className="glass-input-base h-9 w-full px-3 text-sm"
              maxLength={20}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-[var(--glass-text-secondary)]">中文提示词</label>
            <textarea
              value={promptZh}
              onChange={(e) => setPromptZh(e.target.value)}
              placeholder="描述画面风格的中文提示词，将用于图片生成"
              className="glass-input-base w-full resize-y px-3 py-2 text-sm"
              rows={3}
              maxLength={200}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-[var(--glass-text-secondary)]">英文提示词（可选）</label>
            <textarea
              value={promptEn}
              onChange={(e) => setPromptEn(e.target.value)}
              placeholder="English style prompt (optional, defaults to Chinese)"
              className="glass-input-base w-full resize-y px-3 py-2 text-sm"
              rows={2}
              maxLength={200}
            />
          </div>
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="glass-btn-base h-9 px-4 text-sm"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!label.trim() || !promptZh.trim()}
            className="glass-btn-base glass-btn-primary h-9 px-4 text-sm disabled:opacity-50"
          >
            {editingStyle ? '保存' : '添加'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
