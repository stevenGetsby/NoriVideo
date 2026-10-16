'use client'

import { useEffect, useRef, useState } from 'react'
import { FolderHeart, LoaderCircle, X } from '@/components/ui/icons'
import { MediaImage } from '@/components/media/MediaImage'
import { FRAMEOS_ASSET_CATEGORY_LABELS, type FrameosAssetCategory } from '@/lib/frameos/material-category'

/** 资产库目前只展示角色/场景/道具三类，这里只提供可归类的选项。 */
const LIBRARY_CATEGORIES: FrameosAssetCategory[] = ['character', 'location', 'prop']

export function CanvasAssetLibraryDialog({
  initialTitle,
  imageUrl,
  onConfirm,
  onClose,
}: {
  initialTitle: string
  imageUrl: string | null
  onConfirm: (input: { title: string; assetCategory: FrameosAssetCategory }) => Promise<void>
  onClose: () => void
}) {
  const [title, setTitle] = useState(initialTitle)
  const [assetCategory, setAssetCategory] = useState<FrameosAssetCategory>('character')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { inputRef.current?.focus(); inputRef.current?.select() }, [])
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => { if (event.key === 'Escape' && !saving) onClose() }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [onClose, saving])

  const submit = async () => {
    const value = title.replace(/\s+/g, ' ').trim()
    if (!value) { setError('请输入素材名称'); return }
    setSaving(true)
    setError(null)
    try {
      await onConfirm({ title: value, assetCategory })
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '上传资产库失败')
      setSaving(false)
    }
  }

  return (
    <div className="nori-canvas-dialog-scrim" onMouseDown={(event) => { if (event.currentTarget === event.target && !saving) onClose() }}>
      <form className="nori-canvas-dialog nori-canvas-asset-library-dialog" onSubmit={(event) => { event.preventDefault(); void submit() }}>
        <header><span><FolderHeart />上传到资产库</span><button type="button" disabled={saving} title="关闭" onClick={onClose}><X /></button></header>
        <div className="nori-canvas-dialog-body">
          <div className="nori-canvas-asset-library-preview">
            {imageUrl ? <MediaImage src={imageUrl} alt="" fill sizes="220px" style={{ objectFit: 'contain' }} /> : <span>该节点暂无可上传的图片</span>}
          </div>
          <label><span>素材名称</span><input ref={inputRef} value={title} maxLength={100} onChange={(event) => setTitle(event.target.value)} placeholder="例如：主角定妆照" /></label>
          <label><span>资产归类</span><select aria-label="资产归类" value={assetCategory} onChange={(event) => setAssetCategory(event.target.value as FrameosAssetCategory)}>{LIBRARY_CATEGORIES.map((category) => <option key={category} value={category}>{FRAMEOS_ASSET_CATEGORY_LABELS[category]}</option>)}</select></label>
          <p>图片会上传为本作品资产库素材，并按所选归类出现在资产库与素材库中，可继续用于画布、工具箱和分镜。</p>
          {error ? <div className="nori-canvas-generator-error">{error}</div> : null}
        </div>
        <footer><button type="button" disabled={saving} onClick={onClose}>取消</button><button type="submit" className="is-primary" disabled={saving || !imageUrl}>{saving ? <LoaderCircle className="animate-spin" /> : <FolderHeart />}{saving ? '正在上传…' : '上传到资产库'}</button></footer>
      </form>
    </div>
  )
}
