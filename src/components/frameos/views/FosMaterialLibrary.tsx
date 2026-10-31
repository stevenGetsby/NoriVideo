'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSession } from 'next-auth/react'
import { Link } from '@/i18n/navigation'
import { AppIcon } from '@/components/ui/icons'
import { MediaImage } from '@/components/media/MediaImage'
import { apiFetch } from '@/lib/api-fetch'
import { readApiErrorMessage } from '@/lib/api/read-error-message'
import { toDisplayImageUrl, toPlayableVideoUrl, toPlayableAudioUrl } from '@/lib/media/image-url'
import { hasAccountPermissions } from '@/lib/account/permissions'
import { ConfirmActionDialog, RenameDialog } from '../works/FosWorksDialogs'
import { renameFrameosMaterial, trashFrameosMaterials } from '../materials/material-actions'
import { fetchAllFrameosMaterials } from '../materials/fetch-all-materials'
import { fetchAllProjectOptions } from '../works/fetch-all-projects'
import { ViewportDialogLayer } from '../ViewportDialogLayer'
import { ProjectDownloadDirectory } from '../ProjectDownloadDirectory'
import { downloadFrameosMaterial } from '../materials/download-material'
import { createMaterialUploadEntryId, runMaterialUploadQueue, type MaterialUploadEntry } from '../materials/upload-queue'
import { isImageUpload, materialTitleFromFilename, MAX_MATERIAL_BATCH_FILES, MAX_MATERIAL_FILE_BYTES, MAX_MATERIAL_TITLE_LENGTH } from '@/lib/frameos/upload-file-policy'
import { matchCharacterVoiceFile, validateCharacterAudioFile } from '@/lib/frameos/character-voice-reference'
import {
  FRAMEOS_ASSET_CATEGORIES,
  FRAMEOS_ASSET_CATEGORY_LABELS,
  frameosAssetCategoryFromMetadata,
  frameosCharacterBindingFromMetadata,
  type FrameosAssetCategory,
} from '@/lib/frameos/material-category'
import {
  MATERIAL_SOURCE_LABELS,
  type FrameosMaterialItem,
  type MaterialType,
} from '../materials/contracts'

type FilterTab = 'all' | MaterialType | 'fav'
type SourceFilter = 'all' | FrameosMaterialItem['source']
type TimeFilter = 'all' | 'today' | '7d' | '30d'

export interface MaterialUploadProjectItem {
  id: string
  name: string
}

type ProjectItem = MaterialUploadProjectItem

const FILTER_TABS: Array<{ key: FilterTab; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'image', label: '图片' },
  { key: 'video', label: '视频' },
  { key: 'audio', label: '音频' },
  { key: 'model3d', label: '3D 模型' },
  { key: 'fav', label: '收藏' },
]

const SOURCE_FILTERS: Array<{ key: SourceFilter; label: string }> = [
  { key: 'all', label: '全部来源' },
  { key: 'toolbox', label: MATERIAL_SOURCE_LABELS.toolbox },
  { key: 'creative', label: MATERIAL_SOURCE_LABELS.creative },
  { key: 'production', label: MATERIAL_SOURCE_LABELS.production },
  { key: 'upload', label: MATERIAL_SOURCE_LABELS.upload },
]

function createdFromForFilter(value: TimeFilter): string | null {
  if (value === 'all') return null
  const now = new Date()
  if (value === 'today') {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
  }
  const days = value === '7d' ? 7 : 30
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString()
}

function formatDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString('zh-CN', { hour12: false })
}

function MaterialPreview({ item, detail = false }: { item: FrameosMaterialItem; detail?: boolean }) {
  const src = item.type === 'video' ? toPlayableVideoUrl(item.url)
    : item.type === 'audio' ? toPlayableAudioUrl(item.url) : toDisplayImageUrl(item.url)
  if (src && item.type === 'image') {
    return <MediaImage src={src} alt={item.title || '素材'} fill sizes={detail ? '440px' : '360px'} style={{ objectFit: 'contain' }} />
  }
  if (src && item.type === 'video') {
    return <video src={src} controls={detail} muted={!detail} playsInline className="h-full w-full object-contain" />
  }
  if (src && item.type === 'audio') {
    return <audio src={src} controls className="w-[85%]" />
  }
  return <AppIcon name={item.type === 'audio' ? 'audioWave' : item.type === 'video' ? 'video' : item.type === 'model3d' ? 'cube' : 'image'} className="h-10 w-10 text-white/15" />
}

function MaterialCard({
  item,
  canFavorite,
  selected,
  onOpen,
  onFavorite,
  onDelete,
  onToggleSelect,
  onRename,
}: {
  item: FrameosMaterialItem
  canFavorite: boolean
  selected: boolean
  onOpen: () => void
  onFavorite: () => void
  onDelete: () => void
  onToggleSelect: () => void
  onRename: () => void
}) {
  const assetCategory = frameosAssetCategoryFromMetadata(item.metadata)
  const characterBinding = frameosCharacterBindingFromMetadata(item.metadata)
  const showVoiceBadge = assetCategory === 'character' && item.type === 'image'
  return (
    <article className={`relative overflow-hidden rounded-[10px] border bg-[var(--fos-bg-2)] transition-colors hover:border-[var(--fos-border-mid)] ${selected ? 'border-[var(--fos-primary)] ring-1 ring-[var(--fos-primary-border)]' : 'border-[var(--fos-border-soft)]'}`}>
      {item.source === 'upload' && canFavorite ? <button
        type="button"
        aria-label={selected ? `取消选择 ${item.title || '未命名素材'}` : `选择 ${item.title || '未命名素材'}`}
        aria-pressed={selected}
        className={`absolute left-2 top-2 z-10 flex h-6 w-6 items-center justify-center rounded-md border text-[12px] font-bold ${selected ? 'border-white/40 bg-[linear-gradient(100deg,#3c8bff_0%,#6c5cff_52%,#a855f7_100%)] text-white' : 'border-white/25 bg-black/65 text-white/60'}`}
        onClick={(event) => { event.stopPropagation(); onToggleSelect() }}
      >{selected ? '✓' : ''}</button> : null}
      <button type="button" onClick={onOpen} className="block w-full text-left">
        <div className="relative flex aspect-[4/3] items-center justify-center overflow-hidden bg-gradient-to-b from-[#1b1b23] to-[#0c0c11]">
          <MaterialPreview item={item} />
          <span className="absolute bottom-2 left-2 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-bold text-white">{item.type === 'image' ? '图片' : item.type === 'video' ? '视频' : item.type === 'audio' ? '音频' : '3D'}</span>
          {showVoiceBadge ? <span className="fml-voice-badge">
            <span className={`nori-voice-badge ${item.voice ? 'nori-voice-badge-bound' : 'nori-voice-badge-missing'}`}>
              <AppIcon name={item.voice ? 'audioWave' : 'infoCircle'} className="h-3 w-3" />
              {item.voice ? '有音色' : '缺音色'}
            </span>
          </span> : null}
        </div>
        <div className="truncate px-3 pt-2.5 text-[13px] font-bold text-white" title={item.title || ''}>{item.title || '未命名素材'}</div>
        <div className="flex items-center justify-between gap-2 px-3 pb-2.5 pt-1 text-[11px] text-[var(--fos-text-4)]">
          <span className="min-w-0 truncate">{item.projectName} · {FRAMEOS_ASSET_CATEGORY_LABELS[assetCategory]}{characterBinding ? ` · @${characterBinding.characterName || '已绑定角色'}` : ''}</span>
          <span className="shrink-0 rounded bg-[var(--fos-fill-mid)] px-1.5 py-0.5">{MATERIAL_SOURCE_LABELS[item.source]}</span>
        </div>
      </button>
      <div className="flex min-h-[38px] items-center justify-between gap-2 border-t border-[var(--fos-border-soft)] px-3 py-2">
        <span className="truncate text-[10px] text-[var(--fos-text-4)]">{formatDate(item.createdAt)}</span>
        <div className="flex items-center gap-2">
          {item.source === 'upload' && canFavorite ? <button type="button" onClick={(event) => { event.stopPropagation(); onDelete() }} title="删除上传资产" aria-label={`删除上传资产 ${item.title || '未命名素材'}`} className="text-[var(--fos-text-4)] hover:text-red-300"><AppIcon name="trash" className="h-4 w-4" /></button> : null}
          {canFavorite ? <button type="button" onClick={(event) => { event.stopPropagation(); onRename() }} title="重命名素材" aria-label={`重命名素材 ${item.title || '未命名素材'}`} className="text-[var(--fos-text-4)] hover:text-neutral-200"><AppIcon name="edit" className="h-4 w-4" /></button> : null}
          <button type="button" disabled={!canFavorite} onClick={onFavorite} title={canFavorite ? item.isFavorited ? '取消收藏' : '收藏' : '收藏需要资产编辑权限'} className="text-[var(--fos-text-4)] hover:text-[#ffd166] disabled:cursor-not-allowed disabled:opacity-35">
            <AppIcon name="bookmark" className="h-4 w-4" style={{ color: item.isFavorited ? '#ffd166' : undefined }} weight={item.isFavorited ? 'fill' : 'regular'} />
          </button>
        </div>
      </div>
    </article>
  )
}

export function MaterialUploadDialog({
  projects,
  initialProjectId,
  initialAssetCategory = 'other',
  lockAssetCategory = false,
  imageOnly = false,
  lockProject = false,
  assetCategoryOptions = FRAMEOS_ASSET_CATEGORIES,
  onCreated,
  onClose,
}: {
  projects: MaterialUploadProjectItem[]
  initialProjectId: string | null
  initialAssetCategory?: FrameosAssetCategory
  lockAssetCategory?: boolean
  imageOnly?: boolean
  lockProject?: boolean
  assetCategoryOptions?: readonly FrameosAssetCategory[]
  onCreated: (material: FrameosMaterialItem) => void
  onClose: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [entries, setEntries] = useState<MaterialUploadEntry[]>([])
  const [projectId, setProjectId] = useState(initialProjectId || 'global')
  const [assetCategory, setAssetCategory] = useState<FrameosAssetCategory>(initialAssetCategory)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const savingRef = useRef(false)
  const [voiceFiles, setVoiceFiles] = useState<File[]>([])
  const [voiceMapping, setVoiceMapping] = useState<Record<string, string>>({})
  const uploadedImagesRef = useRef(new Map<string, FrameosMaterialItem>())
  const uploadedVoicesRef = useRef(new Map<string, FrameosMaterialItem>())
  const successCount = entries.filter((entry) => entry.status === 'success').length
  const unfinished = entries.filter((entry) => entry.status !== 'success')
  const hasFailures = entries.some((entry) => entry.status === 'failed')

  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !savingRef.current) onClose()
    }
    window.addEventListener('keydown', escape)
    return () => window.removeEventListener('keydown', escape)
  }, [onClose])

  const addFiles = (files: File[]) => {
    if (savingRef.current) return
    const errors: string[] = []
    const next = entries.length > 0 && entries.every((entry) => entry.status === 'success') ? [] : [...entries]
    for (const file of files) {
      if (next.length >= MAX_MATERIAL_BATCH_FILES) { errors.push(`每批最多 ${MAX_MATERIAL_BATCH_FILES} 个文件`); break }
      if (file.size <= 0 || file.size > MAX_MATERIAL_FILE_BYTES) { errors.push(`${file.name}：文件须为 1 字节–200MB`); continue }
      if (imageOnly && !isImageUpload(file)) { errors.push(`${file.name}：当前目录仅支持图片`); continue }
      if (next.some((entry) => entry.file.name === file.name && entry.file.size === file.size && entry.file.lastModified === file.lastModified)) continue
      next.push({ id: createMaterialUploadEntryId(), file, title: materialTitleFromFilename(file.name), status: 'pending', error: null })
    }
    setEntries(next)
    setError(errors.length ? errors.join('；') : null)
  }

  const submit = async () => {
    if (savingRef.current || unfinished.length === 0) return
    if (unfinished.some((entry) => !entry.title.trim())) {
      setError('请为每个待上传文件填写素材名称。')
      return
    }
    const selectedVoices = entries.map((entry) => voiceMapping[entry.id]).filter(Boolean)
    if (assetCategory === 'character' && voiceFiles.length > 0 && (new Set(selectedVoices).size !== selectedVoices.length || voiceFiles.some((file) => !selectedVoices.includes(file.name)))) {
      setError('请将每个音色文件对应到且只对应到一个角色；重名文件请先重命名，不能自动覆盖。')
      return
    }
    savingRef.current = true
    setSaving(true)
    setError(null)
    let failed = false
    let completed = false
    try {
      await runMaterialUploadQueue(entries, async (entry) => {
        const uploadFile = async (file: File, title: string) => {
          const form = new FormData()
          form.set('title', title); form.set('file', file); form.set('projectId', projectId); form.set('assetCategory', assetCategory)
          const response = await apiFetch('/api/frameos/materials', { method: 'POST', body: form })
          if (!response.ok) throw new Error(await readApiErrorMessage(response, '上传素材失败'))
          const payload = await response.json() as { material?: FrameosMaterialItem }
          if (!payload.material) throw new Error('上传成功但未返回素材。')
          return payload.material
        }
        let image = uploadedImagesRef.current.get(entry.id)
        if (!image) {
          image = await uploadFile(entry.file, entry.title.trim())
          uploadedImagesRef.current.set(entry.id, image)
        }
        if (image.title !== entry.title.trim()) {
          const renamed = await apiFetch(`/api/frameos/materials/${image.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: entry.title.trim() }) })
          if (!renamed.ok) throw new Error(await readApiErrorMessage(renamed, '更新已上传角色名称失败'))
          image = { ...image, title: entry.title.trim() }
          uploadedImagesRef.current.set(entry.id, image)
        }
        const voiceFile = assetCategory === 'character' ? voiceFiles.find((file) => file.name === voiceMapping[entry.id]) : null
        if (voiceFile) {
          const voiceKey = `${entry.id}:${voiceFile.name}:${voiceFile.size}:${voiceFile.lastModified}`
          let voice = uploadedVoicesRef.current.get(voiceKey)
          if (!voice) {
            voice = await uploadFile(voiceFile, `${entry.title.trim()}音色`)
            uploadedVoicesRef.current.set(voiceKey, voice)
          }
          const response = await apiFetch(`/api/frameos/materials/${image.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ voiceMaterialId: voice.id }) })
          if (!response.ok) throw new Error(await readApiErrorMessage(response, '图片已上传，音色绑定失败；重试不会重复上传已成功的图片或音频'))
          image = { ...image, metadata: { ...image.metadata, voiceMaterialId: voice.id }, voice: { materialId: voice.id, title: voice.title, url: voice.url } }
        }
        return image
      }, (id, status, itemError) => {
        if (status === 'failed') failed = true
        setEntries((current) => current.map((entry) => entry.id === id ? { ...entry, status, error: itemError } : entry))
      }, onCreated)
      completed = !failed
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '上传素材失败')
    } finally {
      savingRef.current = false
      setSaving(false)
    }
    if (completed) onClose()
  }

  return (
    <ViewportDialogLayer>
    <div className="fos-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget && !savingRef.current) onClose() }}>
      <section role="dialog" aria-modal="true" aria-label="批量上传素材" className="fos-dialog" style={{ maxWidth: 680 }}>
        <div className="fos-dialog-head"><div><div className="fos-dialog-title">批量上传素材</div><div className="mt-1 text-[11px] text-[var(--fos-text-4)]">按文件名自动命名，可逐项修改 · 每批最多 100 个 · 单文件 200MB</div></div><button type="button" className="fos-dialog-x" aria-label="关闭上传" disabled={saving} onClick={onClose}><AppIcon name="close" className="h-4 w-4" /></button></div>
        <div className="fos-dialog-body space-y-4">
          <label className="block"><span className="mb-2 block text-[12px] font-bold text-white">归属作品</span><select aria-label="归属作品" className="fos-input" value={projectId} disabled={lockProject || saving || successCount > 0 || uploadedImagesRef.current.size > 0} onChange={(event) => setProjectId(event.target.value)}><option value="global">账号素材</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
          <label className="block"><span className="mb-2 block text-[12px] font-bold text-white">资产归类</span><select aria-label="资产归类" className="fos-input" value={assetCategory} disabled={lockAssetCategory || saving || uploadedImagesRef.current.size > 0 || (successCount > 0 && unfinished.length > 0)} onChange={(event) => { setAssetCategory(event.target.value as FrameosAssetCategory); setVoiceFiles([]); setVoiceMapping({}) }}>{assetCategoryOptions.map((category) => <option key={category} value={category}>{FRAMEOS_ASSET_CATEGORY_LABELS[category]}</option>)}</select><span className="mt-1.5 block text-[10px] text-[var(--fos-text-4)]">{lockAssetCategory ? `当前入口固定归入${FRAMEOS_ASSET_CATEGORY_LABELS[assetCategory]}，不会混入其他品类。` : '全部上传成功后自动关闭；部分失败时保留弹窗，仅重试失败项。'}</span></label>
          <div>
            <span className="mb-2 block text-[12px] font-bold text-white">本地文件 <span className="text-red-400">*</span></span>
            <button type="button" disabled={saving} className="flex min-h-20 w-full items-center justify-center gap-2 rounded-[10px] border border-dashed border-[var(--fos-border-strong)] bg-[var(--fos-bg-1)] px-4 text-[13px] text-[var(--fos-text-3)] hover:border-[var(--fos-primary-border)] hover:text-[var(--fos-primary-text)]" onClick={() => inputRef.current?.click()}><AppIcon name="folderOpen" className="h-5 w-5" /><span>{imageOnly ? '选择多张资产图片' : '选择多个图片、视频、音频或自包含 GLB'}</span></button>
            <input ref={inputRef} type="file" multiple accept={imageOnly ? 'image/*' : 'image/*,video/*,audio/*,.glb,model/gltf-binary'} title={imageOnly ? '请选择图片文件' : '3D 模型仅支持自包含 GLB 2.0'} className="hidden" onChange={(event) => { addFiles(Array.from(event.target.files || [])); event.target.value = '' }} />
          </div>
          {assetCategory === 'character' && entries.every((entry) => isImageUpload(entry.file)) ? <div className="rounded-lg border border-violet-300/20 bg-[var(--fos-bg-2)] p-3">
            <label className="block text-[12px] font-bold text-white">角色音色配对（选填）<input aria-label="批量角色音色文件" className="fos-input mt-2 w-full" type="file" multiple accept="audio/*,.mp3,.wav,.m4a,.ogg" disabled={saving} onChange={(event) => {
              const files = Array.from(event.target.files || [])
              event.target.value = ''
              if (files.length > MAX_MATERIAL_BATCH_FILES || new Set(files.map((file) => file.name)).size !== files.length) { setError('音色最多 100 个且文件名不能重复。'); return }
              const invalid = files.find((file) => validateCharacterAudioFile(file))
              if (invalid) { setError(`${invalid.name}：${validateCharacterAudioFile(invalid)}`); return }
              setVoiceFiles(files)
              setVoiceMapping(Object.fromEntries(entries.map((entry) => [entry.id, matchCharacterVoiceFile(entry.file.name, files)?.name || ''])))
              setError(null)
            }} /></label>
            <p className="mt-2 text-[11px] leading-5 text-[var(--fos-text-4)]">同时选择音频，如“关羽.png + 关羽.mp3”或“关羽_voice.wav”，按文件名匹配；每个角色也可手动选择。失败重试不重复上传成功文件。</p>
          </div> : null}
          <div aria-live="polite" className="text-[12px] text-[var(--fos-text-3)]">已上传 {successCount} / {entries.length}{saving ? ' · 正在逐张上传，请勿关闭' : hasFailures ? ' · 部分失败，可仅重试失败项' : ''}</div>
          <div className="grid gap-2">
            {entries.map((entry) => <div key={entry.id} data-upload-status={entry.status} className="rounded-lg border border-[var(--fos-border-mid)] p-3">
              <div className="flex min-w-0 items-center gap-2">
                <label className="min-w-0 flex-1"><span className="block break-all text-[11px] text-[var(--fos-text-4)]">{entry.file.name}</span><input aria-label={`素材名称 ${entry.file.name}`} className="fos-input mt-1" maxLength={MAX_MATERIAL_TITLE_LENGTH} value={entry.title} disabled={saving || entry.status === 'success'} onChange={(event) => setEntries((current) => current.map((item) => item.id === entry.id ? { ...item, title: event.target.value } : item))} /></label>
                <span className="shrink-0 text-[11px]">{entry.status === 'success' ? '成功' : entry.status === 'uploading' ? '上传中' : entry.status === 'failed' ? '失败' : '待上传'}</span>
                {entry.status !== 'success' ? <button type="button" aria-label={`移除 ${entry.file.name}`} disabled={saving} onClick={() => setEntries((current) => current.filter((item) => item.id !== entry.id))}><AppIcon name="close" className="h-4 w-4" /></button> : null}
              </div>
              {assetCategory === 'character' && voiceFiles.length > 0 ? <label className="mt-2 block text-[11px] text-[var(--fos-text-3)]">对应音色<select aria-label={`对应音色 ${entry.file.name}`} className="fos-input mt-1" disabled={saving || entry.status === 'success'} value={voiceMapping[entry.id] || ''} onChange={(event) => setVoiceMapping((current) => ({ ...current, [entry.id]: event.target.value }))}><option value="">不绑定音色</option>{voiceFiles.map((file) => <option key={file.name} value={file.name}>{file.name}</option>)}</select></label> : null}
              {entry.error ? <p role="alert" className="mt-2 break-words text-[11px] text-red-200">{entry.error}</p> : null}
            </div>)}
          </div>
          {error ? <div className="rounded-lg border border-red-400/25 bg-red-500/10 px-3 py-2 text-[12px] text-red-200">{error}</div> : null}
        </div>
        <div className="fos-dialog-foot"><button type="button" className="fos-btn fos-btn-ghost" disabled={saving} onClick={onClose}>{successCount ? '完成' : '取消'}</button><button type="button" className="fos-btn fos-btn-primary" disabled={saving || unfinished.length === 0} onClick={() => void submit()}>{saving ? '上传中…' : hasFailures ? '重试未成功项' : '开始上传'}</button></div>
      </section>
    </div>
    </ViewportDialogLayer>
  )
}

function MaterialPreviewDialog({ item, canEdit, onCharacterBind, onRename, onClose, onDownload }: {
  item: FrameosMaterialItem
  canEdit: boolean
  onCharacterBind: (characterId: string | null) => void
  onRename: () => void
  onClose: () => void
  onDownload: () => Promise<void>
}) {
  const assetCategory = frameosAssetCategoryFromMetadata(item.metadata)
  const characterBinding = frameosCharacterBindingFromMetadata(item.metadata)
  const canBindProjectCharacter = assetCategory === 'character'
    && item.projectId !== 'global'
    && item.projectId !== 'global-asset-hub'
  const [characters, setCharacters] = useState<Array<{ id: string; name: string }>>([])
  const [charactersLoading, setCharactersLoading] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState<string | null>(null)

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  useEffect(() => {
    if (!canBindProjectCharacter) {
      setCharacters([])
      return
    }
    setCharactersLoading(true)
    void apiFetch(`/api/assets?scope=project&projectId=${encodeURIComponent(item.projectId)}&kind=character`)
      .then(async (response) => {
        if (!response.ok) throw new Error(await readApiErrorMessage(response, '读取作品角色失败'))
        return await response.json() as { assets?: Array<{ id: string; name: string }> }
      })
      .then((payload) => setCharacters(Array.isArray(payload.assets) ? payload.assets.map((asset) => ({ id: asset.id, name: asset.name })) : []))
      .catch(() => setCharacters([]))
      .finally(() => setCharactersLoading(false))
  }, [canBindProjectCharacter, item.projectId])

  const rows: Array<[string, string]> = [
    ['素材名称', item.title || '未命名素材'],
    ['归属作品', item.projectName],
    ['素材类型', item.type === 'image' ? '图片' : item.type === 'video' ? '视频' : item.type === 'audio' ? '音频' : '3D 模型'],
    ['来源', MATERIAL_SOURCE_LABELS[item.source]],
    ['创建者', item.ownerName || '-'],
    ['创建时间', formatDate(item.createdAt)],
  ]
  return (
    <ViewportDialogLayer>
    <div className="fos-overlay material-preview-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section
        role="dialog"
        aria-modal="true"
        aria-label={`${item.title || '素材'}大图预览`}
        data-testid="material-large-preview"
        className="fos-dialog material-preview-dialog"
        style={{ maxWidth: 1280, height: 'min(88dvh, 900px)' }}
      >
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-[var(--fos-border-soft)] px-5">
          <div className="min-w-0"><h3 className="truncate text-[16px] font-bold text-white">{item.title || '未命名素材'}</h3><p className="mt-0.5 text-[11px] text-[var(--fos-text-4)]">大图预览 · 按 Esc 关闭</p></div>
          <button type="button" onClick={onClose} className="fos-dialog-x" aria-label="关闭大图预览"><AppIcon name="close" className="h-4 w-4" /></button>
        </header>
        <div className="material-preview-layout grid min-h-0 flex-1 md:grid-cols-[minmax(0,1fr)_300px]">
          <div className="material-preview-media relative flex min-h-0 items-center justify-center overflow-hidden bg-[#08080c] p-3">
            <div className="relative h-full w-full overflow-hidden rounded-[10px]"><MaterialPreview item={item} detail /></div>
          </div>
          <aside className="overflow-y-auto border-t border-[var(--fos-border-soft)] p-5 md:border-l md:border-t-0">
            <div className="mb-3 text-[12px] font-bold text-[var(--fos-text-3)]">素材信息</div>
            <div className="divide-y divide-[var(--fos-border-soft)] rounded-[10px] border border-[var(--fos-border-soft)]">{rows.map(([key, value]) => <div key={key} className="px-3.5 py-3 text-[12px]"><span className="block text-[var(--fos-text-4)]">{key}</span><span className="mt-1 block break-words font-bold text-white">{value}</span>{key === '素材名称' && canEdit ? <button type="button" className="fos-btn fos-btn-ghost fos-btn-sm mt-2" onClick={onRename}><AppIcon name="edit" className="h-3.5 w-3.5" />修改名称</button> : null}</div>)}</div>
            {canBindProjectCharacter ? <label className="mt-4 block"><span className="mb-2 block text-[12px] font-bold text-[var(--fos-text-3)]">绑定作品角色</span><select className="fos-input" value={characterBinding?.characterId || ''} disabled={!canEdit || charactersLoading} onChange={(event) => onCharacterBind(event.target.value || null)}><option value="">不绑定具体角色</option>{characters.map((character) => <option key={character.id} value={character.id}>@{character.name}</option>)}</select><span className="mt-1.5 block text-[10px] leading-4 text-[var(--fos-text-4)]">同一角色的图片与音频会在资产库聚合显示；绑定音频后同步设为该角色音色。</span></label> : null}
            <div className="mt-4 space-y-3"><ProjectDownloadDirectory projectId={item.projectId} /><button type="button" className="fos-btn fos-btn-primary" disabled={downloading} onClick={() => { setDownloading(true); setDownloadError(null); void onDownload().catch((cause) => setDownloadError(cause instanceof Error ? cause.message : '下载失败')).finally(() => setDownloading(false)) }}>{downloading ? '下载中…' : '按项目规则下载素材'}</button>{downloadError ? <p role="alert" className="break-words text-[12px] text-red-200">{downloadError}</p> : null}</div>
          </aside>
        </div>
      </section>
    </div>
    </ViewportDialogLayer>
  )
}

export function FosMaterialLibrary({
  initialProjectId,
  initialMaterialId,
}: {
  initialProjectId?: string | null
  initialMaterialId?: string | null
} = {}) {
  const { data: session } = useSession()
  const canEditAssets = hasAccountPermissions({ role: session?.user?.role, permissions: session?.user?.permissions }, ['assetWrite'])
  const [materials, setMaterials] = useState<FrameosMaterialItem[]>([])
  const [projects, setProjects] = useState<ProjectItem[]>([])
  const [projectId, setProjectId] = useState<string | null>(initialProjectId || 'global')
  const [filter, setFilter] = useState<FilterTab>('all')
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all')
  const [categoryFilter, setCategoryFilter] = useState<'all' | FrameosAssetCategory>('all')
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('all')
  const [creator, setCreator] = useState('')
  const [creatorOptions, setCreatorOptions] = useState<string[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [detail, setDetail] = useState<FrameosMaterialItem | null>(null)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<FrameosMaterialItem | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [renameTarget, setRenameTarget] = useState<FrameosMaterialItem | null>(null)
  const [renaming, setRenaming] = useState(false)
  const renamingRef = useRef(false)
  const [batchDeleteTarget, setBatchDeleteTarget] = useState<string[]>([])
  const [batchDeleting, setBatchDeleting] = useState(false)
  const initialMaterialOpenedRef = useRef(false)
  const loadSequence = useRef(0)
  const loadAbort = useRef<AbortController | null>(null)
  const initialSyncRef = useRef(false)

  useEffect(() => {
    setProjectId(initialProjectId || 'global')
    setSelectedIds([])
    setDetail(null)
    setRenameTarget(null)
    initialSyncRef.current = false
  }, [initialProjectId])

  useEffect(() => {
    const controller = new AbortController()
    void fetchAllProjectOptions(controller.signal).then((items) => {
      if (!controller.signal.aborted) setProjects(items)
    }).catch(() => {})
    return () => controller.abort()
  }, [])

  const load = useCallback(async (sync = false) => {
    const sequence = ++loadSequence.current
    loadAbort.current?.abort()
    const controller = new AbortController()
    loadAbort.current = controller
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ limit: '500' })
      if (projectId) params.set('projectId', projectId)
      if (filter === 'image' || filter === 'video' || filter === 'audio' || filter === 'model3d') params.set('type', filter)
      if (filter === 'fav') params.set('favorite', '1')
      if (sourceFilter !== 'all') params.set('source', sourceFilter)
      if (creator.trim()) {
        params.set('creator', creator.trim())
        params.set('creatorExact', '1')
      }
      const createdFrom = createdFromForFilter(timeFilter)
      if (createdFrom) params.set('createdFrom', createdFrom)
      if (query.trim()) params.set('query', query.trim())
      if (sync) params.set('sync', '1')
      let creatorNames: string[] | null = null
      const items = await fetchAllFrameosMaterials(params, controller.signal, (options) => {
        creatorNames = options.map((option) => option.name?.trim()).filter(Boolean)
      })
      if (sequence !== loadSequence.current || controller.signal.aborted) return
      setMaterials(items)
      setCreatorOptions((current) => Array.from(new Set([
        ...(creatorNames ?? current),
        ...items.map((item) => item.ownerName?.trim() || '').filter(Boolean),
      ])).sort((left, right) => left.localeCompare(right, 'zh-CN')))
    } catch (loadError) {
      if (sequence !== loadSequence.current || controller.signal.aborted) return
      setMaterials([])
      setError(loadError instanceof Error ? loadError.message : '加载素材库失败')
    } finally {
      if (sequence === loadSequence.current) setLoading(false)
    }
  }, [creator, filter, projectId, query, sourceFilter, timeFilter])

  const cancelMaterialReads = useCallback(() => {
    loadSequence.current++
    loadAbort.current?.abort()
  }, [])
  useEffect(() => {
    cancelMaterialReads()
    setLoading(true)
    setSelectedIds([])
    const timer = window.setTimeout(() => {
      const sync = !initialSyncRef.current
      initialSyncRef.current = true
      void load(sync)
    }, query ? 250 : 0)
    return () => { window.clearTimeout(timer); cancelMaterialReads() }
  }, [cancelMaterialReads, creator, load, query])

  const activeProjectName = projectId === 'global'
    ? '账号素材'
    : projectId ? projects.find((project) => project.id === projectId)?.name || '作品素材' : '全部素材'
  const counts = useMemo(() => ({
    image: materials.filter((item) => item.type === 'image').length,
    video: materials.filter((item) => item.type === 'video').length,
    audio: materials.filter((item) => item.type === 'audio').length,
    model3d: materials.filter((item) => item.type === 'model3d').length,
  }), [materials])
  const visibleMaterials = useMemo(() => categoryFilter === 'all'
    ? materials
    : materials.filter((item) => frameosAssetCategoryFromMetadata(item.metadata) === categoryFilter),
  [categoryFilter, materials])
  const deletableVisibleMaterials = useMemo(
    () => visibleMaterials.filter((item) => item.source === 'upload'),
    [visibleMaterials],
  )
  const selectedVisibleIds = useMemo(
    () => selectedIds.filter((id) => deletableVisibleMaterials.some((item) => item.id === id)),
    [deletableVisibleMaterials, selectedIds],
  )
  const allVisibleSelected = deletableVisibleMaterials.length > 0
    && selectedVisibleIds.length === deletableVisibleMaterials.length

  useEffect(() => {
    if (initialMaterialOpenedRef.current || !initialMaterialId || materials.length === 0) return
    const material = materials.find((item) => item.id === initialMaterialId)
    if (!material) return
    initialMaterialOpenedRef.current = true
    setDetail(material)
  }, [initialMaterialId, materials])

  const toggleFavorite = async (item: FrameosMaterialItem) => {
    if (!canEditAssets) return
    const next = !item.isFavorited
    setMaterials((current) => current.map((material) => material.id === item.id ? { ...material, isFavorited: next } : material))
    const response = await apiFetch(`/api/frameos/materials/${item.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isFavorited: next }),
    })
    if (!response.ok) void load()
  }

  const updateCharacterBinding = async (item: FrameosMaterialItem, characterId: string | null) => {
    if (!canEditAssets) return
    const response = await apiFetch(`/api/frameos/materials/${item.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ characterId }),
    })
    if (!response.ok) {
      setError(await readApiErrorMessage(response, '更新作品角色绑定失败'))
      return
    }
    const payload = await response.json() as { material?: FrameosMaterialItem }
    if (!payload.material) return
    const next = {
      ...item,
      ...payload.material,
      url: payload.material.resultUrl || payload.material.storageKey || item.url,
    }
    setMaterials((current) => current.map((material) => material.id === item.id ? next : material))
    setDetail((current) => current?.id === item.id ? next : current)
  }

  const deleteUploadedMaterial = async () => {
    if (!deleteTarget || !canEditAssets || deleting) return
    setDeleting(true)
    setDeleteError(null)
    try {
      const response = await apiFetch(`/api/frameos/materials/${encodeURIComponent(deleteTarget.id)}`, { method: 'DELETE' })
      if (!response.ok) throw new Error(await readApiErrorMessage(response, '删除上传素材失败'))
      cancelMaterialReads()
      setLoading(false)
      setMaterials((current) => current.filter((material) => material.id !== deleteTarget.id))
      setDetail((current) => current?.id === deleteTarget.id ? null : current)
      setDeleteTarget(null)
    } catch (cause) {
      setDeleteError(cause instanceof Error ? cause.message : '删除上传素材失败')
    } finally {
      setDeleting(false)
    }
  }

  const renameMaterial = async (title: string) => {
    if (!canEditAssets || !renameTarget || renamingRef.current) return
    renamingRef.current = true
    setRenaming(true)
    try {
      const updated = await renameFrameosMaterial(renameTarget.id, title)
      cancelMaterialReads()
      setLoading(false)
      setMaterials((current) => current.map((item) => item.id === updated.id ? { ...item, ...updated } : item))
      setDetail((current) => current?.id === updated.id ? { ...current, ...updated } : current)
      setRenameTarget(null)
    } finally {
      renamingRef.current = false
      setRenaming(false)
    }
  }

  const deleteBatch = async () => {
    if (!canEditAssets || batchDeleteTarget.length === 0 || batchDeleting) return
    setBatchDeleting(true)
    setError(null)
    try {
      await trashFrameosMaterials(batchDeleteTarget)
      cancelMaterialReads()
      setLoading(false)
      const deletedIds = new Set(batchDeleteTarget)
      setMaterials((current) => current.filter((item) => !deletedIds.has(item.id)))
      setSelectedIds((current) => current.filter((id) => !deletedIds.has(id)))
      setDetail((current) => current && deletedIds.has(current.id) ? null : current)
      setBatchDeleteTarget([])
    } catch (cause) {
      throw new Error(cause instanceof Error ? cause.message : '批量删除素材失败')
    } finally {
      setBatchDeleting(false)
    }
  }

  return (
    <div className="fml-layout flex min-h-0 flex-1">
      <aside className="fml-tree flex w-[230px] shrink-0 flex-col overflow-y-auto border-r border-[var(--fos-border-soft)] p-3">
        <div className="mb-2 px-2 text-[12px] font-bold text-[var(--fos-text-4)]">素材范围</div>
        <button type="button" className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px]" style={{ color: !projectId ? 'var(--fos-primary-text)' : 'var(--fos-text-2)', background: !projectId ? 'var(--fos-primary-soft)' : 'transparent' }} onClick={() => setProjectId(null)}><AppIcon name="folderOpen" className="h-4 w-4" />全部可访问素材</button>
        <button type="button" className="mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px]" style={{ color: projectId === 'global' ? 'var(--fos-primary-text)' : 'var(--fos-text-2)', background: projectId === 'global' ? 'var(--fos-primary-soft)' : 'transparent' }} onClick={() => setProjectId('global')}><AppIcon name="folderHeart" className="h-4 w-4" />账号素材</button>
        {projects.length > 0 ? <div className="mb-1 mt-5 px-2 text-[12px] font-bold text-[var(--fos-text-4)]">作品范围（默认当前作品）</div> : null}
        {projects.map((project) => <button key={project.id} type="button" className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px]" style={{ color: projectId === project.id ? 'var(--fos-primary-text)' : 'var(--fos-text-2)', background: projectId === project.id ? 'var(--fos-primary-soft)' : 'transparent' }} onClick={() => setProjectId(project.id)}><AppIcon name="folder" className="h-4 w-4" /><span className="truncate">{project.name}</span></button>)}
        <div className="fml-index mt-5 rounded-[10px] border border-[var(--fos-border-soft)] bg-[var(--fos-bg-2)] p-3 text-[11px] text-[var(--fos-text-4)]"><div className="mb-2 font-bold text-[var(--fos-text-2)]">当前索引</div><div>图片 {counts.image}</div><div className="mt-1">视频 {counts.video}</div><div className="mt-1">音频 {counts.audio}</div><div className="mt-1">3D {counts.model3d}</div></div>
      </aside>

      <main className="fml-main flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="fml-header flex flex-wrap items-center gap-3 border-b border-[var(--fos-border-soft)] px-5 py-3">
          <div className="fml-heading"><div className="text-[15px] font-bold text-white">{activeProjectName}</div><div className="mt-0.5 text-[11px] text-[var(--fos-text-4)]">所有生成与上传的原始文件；归类为角色后会在<Link href="/workspace/asset-hub" className="mx-1 font-bold text-white hover:underline">资产库</Link>按角色聚合并绑定音色。</div></div>
          <div className="fml-header-actions ml-auto flex items-center gap-2">
            <label className="fos-material-search"><AppIcon name="search" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索素材名称" /></label>
            <button type="button" className="fos-btn fos-btn-ghost" disabled={loading} onClick={() => void load(true)}><AppIcon name="refresh" className="h-3.5 w-3.5" />刷新</button>
            <button type="button" className="fos-btn fos-btn-primary" disabled={!canEditAssets} title={canEditAssets ? '本地上传素材' : '本地上传需要资产编辑权限'} onClick={() => setUploadOpen(true)}><AppIcon name="plus" className="h-3.5 w-3.5" />本地上传</button>
          </div>
        </div>
        <div className="fml-tabs flex items-center gap-1 border-b border-[var(--fos-border-soft)] px-5 py-2">
          {FILTER_TABS.map((tab) => <button key={tab.key} type="button" onClick={() => setFilter(tab.key)} className="h-8 rounded-lg px-3 text-[12px] font-bold" style={{ background: filter === tab.key ? 'rgba(255,255,255,.16)' : 'transparent', color: filter === tab.key ? 'white' : 'var(--fos-text-2)' }}>{tab.label}</button>)}
        </div>
        <div className="fml-filters flex flex-wrap items-center gap-2 border-b border-[var(--fos-border-soft)] px-5 py-2.5">
          <select className="fos-input w-[150px]" aria-label="素材来源" value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value as SourceFilter)}>{SOURCE_FILTERS.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select>
          <select className="fos-input w-[150px]" aria-label="资产归类" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value as 'all' | FrameosAssetCategory)}><option value="all">全部归类</option>{FRAMEOS_ASSET_CATEGORIES.map((category) => <option key={category} value={category}>{FRAMEOS_ASSET_CATEGORY_LABELS[category]}</option>)}</select>
          <select className="fos-input w-[130px]" aria-label="创建时间" value={timeFilter} onChange={(event) => setTimeFilter(event.target.value as TimeFilter)}><option value="all">全部时间</option><option value="today">今天</option><option value="7d">近 7 天</option><option value="30d">近 30 天</option></select>
          <select className="fos-input w-[160px]" aria-label="创建人" value={creator} onChange={(event) => setCreator(event.target.value)}>
            <option value="">全部创建人</option>
            {creator && !creatorOptions.includes(creator) ? <option value={creator}>{creator}</option> : null}
            {creatorOptions.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
          {(sourceFilter !== 'all' || categoryFilter !== 'all' || timeFilter !== 'all' || creator.trim()) ? <button type="button" className="fos-btn fos-btn-ghost" onClick={() => { setSourceFilter('all'); setCategoryFilter('all'); setTimeFilter('all'); setCreator('') }}>清除筛选</button> : null}
          <div className="ml-auto flex items-center gap-2">
            {canEditAssets ? <button type="button" className="fos-btn fos-btn-ghost" disabled={deletableVisibleMaterials.length === 0} onClick={() => setSelectedIds(allVisibleSelected ? [] : deletableVisibleMaterials.map((item) => item.id))}>{allVisibleSelected ? '取消全选' : '全选上传素材'}</button> : null}
            {canEditAssets ? <button
              type="button"
              className="fos-btn fos-btn-danger"
              disabled={selectedVisibleIds.length === 0 || selectedVisibleIds.length > 200 || batchDeleting || loading}
              title="仅可批量删除本地上传且未被画布引用的素材；每批最多 200 个"
              onClick={() => setBatchDeleteTarget(selectedVisibleIds)}
            >
              <AppIcon name="trash" className="h-3.5 w-3.5" />批量删除{selectedVisibleIds.length > 0 ? ` (${selectedVisibleIds.length})` : ''}
            </button> : null}
          </div>
        </div>
        <div className="fml-content min-h-0 flex-1 overflow-y-auto p-5">
          {error ? <div className="mb-4 rounded-lg border border-red-400/25 bg-red-500/10 px-3 py-2 text-[12px] text-red-200">{error}</div> : null}
          {loading ? <div className="py-20 text-center text-[13px] text-[var(--fos-text-4)]">正在同步素材库…</div> : null}
          {!loading && visibleMaterials.length === 0 ? <div className="py-20 text-center text-[13px] text-[var(--fos-text-4)]">暂无匹配素材，可调整筛选、从本地上传或先完成图片/视频生成。</div> : null}
          <div className="fml-grid grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>{!loading && visibleMaterials.map((item) => <MaterialCard
            key={item.id}
            item={item}
            canFavorite={canEditAssets}
            selected={selectedIds.includes(item.id)}
            onOpen={() => setDetail(item)}
            onFavorite={() => void toggleFavorite(item)}
            onDelete={() => { setDeleteError(null); setDeleteTarget(item) }}
            onToggleSelect={() => setSelectedIds((current) => current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id])}
            onRename={() => setRenameTarget(item)}
          />)}</div>
        </div>
      </main>

      {uploadOpen && canEditAssets ? <MaterialUploadDialog projects={projects} initialProjectId={projectId} onCreated={(material) => {
        cancelMaterialReads()
        setLoading(false)
        if (!projectId || material.projectId === projectId) setMaterials((current) => [material, ...current.filter((item) => item.id !== material.id)])
      }} onClose={() => { setUploadOpen(false); void load() }} /> : null}
      {detail ? <MaterialPreviewDialog item={detail} canEdit={canEditAssets} onCharacterBind={(characterId) => void updateCharacterBinding(detail, characterId)} onRename={() => setRenameTarget(detail)} onClose={() => { if (!renameTarget) setDetail(null) }} onDownload={async () => {
        await downloadFrameosMaterial(session?.user?.id || '', detail.projectId, detail.id)
      }} /> : null}
      {renameTarget && canEditAssets ? <RenameDialog kind="素材" initialName={renameTarget.title || ''} busy={renaming} onClose={() => { if (!renamingRef.current) setRenameTarget(null) }} onSave={renameMaterial} /> : null}
      {deleteTarget && canEditAssets ? <ConfirmActionDialog
        title="删除上传素材"
        description={`确定删除「${deleteTarget.title || '未命名素材'}」吗？素材将移入回收站；如果仍被画布引用，系统会拒绝删除。${deleteError ? ` ${deleteError}` : ''}`}
        confirmLabel="确认删除"
        danger
        busy={deleting}
        onClose={() => { if (!deleting) { setDeleteTarget(null); setDeleteError(null) } }}
        onConfirm={deleteUploadedMaterial}
      /> : null}
      {batchDeleteTarget.length > 0 && canEditAssets ? <ConfirmActionDialog
        title="批量删除上传素材"
        description={`确定将选中的 ${batchDeleteTarget.length} 个本地上传素材移入回收站吗？如果其中有素材仍被画布或工作流引用，系统会拒绝整批操作。`}
        confirmLabel="确认批量删除"
        danger
        busy={batchDeleting}
        onClose={() => { if (!batchDeleting) setBatchDeleteTarget([]) }}
        onConfirm={deleteBatch}
      /> : null}
    </div>
  )
}
