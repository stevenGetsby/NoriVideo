'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSession } from 'next-auth/react'
import { AppIcon } from '@/components/ui/icons'
import { MediaImage } from '@/components/media/MediaImage'
import { apiFetch } from '@/lib/api-fetch'
import { readApiErrorMessage } from '@/lib/api/read-error-message'
import { toDisplayImageUrl } from '@/lib/media/image-url'
import { hasAccountPermissions } from '@/lib/account/permissions'
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
  const src = toDisplayImageUrl(item.url)
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

function MaterialCard({ item, canFavorite, onOpen, onFavorite }: { item: FrameosMaterialItem; canFavorite: boolean; onOpen: () => void; onFavorite: () => void }) {
  const assetCategory = frameosAssetCategoryFromMetadata(item.metadata)
  const characterBinding = frameosCharacterBindingFromMetadata(item.metadata)
  return (
    <article className="overflow-hidden rounded-[10px] border border-[var(--fos-border-soft)] bg-[var(--fos-bg-2)] transition-colors hover:border-[var(--fos-border-mid)]">
      <button type="button" onClick={onOpen} className="block w-full text-left">
        <div className="relative flex aspect-[4/3] items-center justify-center overflow-hidden bg-gradient-to-b from-[#181820] to-[#0e0e12]">
          <MaterialPreview item={item} />
          <span className="absolute bottom-2 left-2 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-bold text-white">{item.type === 'image' ? '图片' : item.type === 'video' ? '视频' : item.type === 'audio' ? '音频' : '3D'}</span>
        </div>
        <div className="truncate px-3 pt-2.5 text-[13px] font-bold text-white" title={item.title || ''}>{item.title || '未命名素材'}</div>
        <div className="flex items-center justify-between gap-2 px-3 pb-2.5 pt-1 text-[11px] text-[var(--fos-text-4)]">
          <span className="min-w-0 truncate">{item.projectName} · {FRAMEOS_ASSET_CATEGORY_LABELS[assetCategory]}{characterBinding ? ` · @${characterBinding.characterName || '已绑定角色'}` : ''}</span>
          <span className="shrink-0 rounded bg-[var(--fos-fill-mid)] px-1.5 py-0.5">{MATERIAL_SOURCE_LABELS[item.source]}</span>
        </div>
      </button>
      <div className="flex items-center justify-between border-t border-[var(--fos-border-soft)] px-3 py-2">
        <span className="truncate text-[10px] text-[var(--fos-text-4)]">{formatDate(item.createdAt)}</span>
        <button type="button" disabled={!canFavorite} onClick={onFavorite} title={canFavorite ? item.isFavorited ? '取消收藏' : '收藏' : '收藏需要资产编辑权限'} className="text-[var(--fos-text-4)] hover:text-[#ffd166] disabled:cursor-not-allowed disabled:opacity-35">
          <AppIcon name="bookmark" className="h-4 w-4" style={{ color: item.isFavorited ? '#ffd166' : undefined, fill: item.isFavorited ? '#ffd166' : 'none' }} />
        </button>
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
  onCreated,
  onClose,
}: {
  projects: MaterialUploadProjectItem[]
  initialProjectId: string | null
  initialAssetCategory?: FrameosAssetCategory
  lockAssetCategory?: boolean
  imageOnly?: boolean
  onCreated: (material: FrameosMaterialItem) => void
  onClose: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [title, setTitle] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [projectId, setProjectId] = useState(initialProjectId || 'global')
  const [assetCategory, setAssetCategory] = useState<FrameosAssetCategory>(initialAssetCategory)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    if (!title.trim() || !file) {
      setError('素材名称和本地文件都不能为空。')
      return
    }
    if (imageOnly && !file.type.startsWith('image/')) {
      setError('当前资产分类只支持上传图片。视频、音频和 3D 文件请前往素材库上传。')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const form = new FormData()
      form.set('title', title.trim())
      form.set('file', file)
      form.set('projectId', projectId)
      form.set('assetCategory', assetCategory)
      const response = await apiFetch('/api/frameos/materials', { method: 'POST', body: form })
      if (!response.ok) throw new Error(await readApiErrorMessage(response, '上传素材失败'))
      const payload = await response.json() as { material?: FrameosMaterialItem }
      if (!payload.material) throw new Error('上传成功但未返回素材。')
      onCreated(payload.material)
      onClose()
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '上传素材失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fos-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div className="fos-dialog" style={{ maxWidth: 520 }}>
        <div className="fos-dialog-head"><div className="fos-dialog-title">本地上传素材</div><button type="button" className="fos-dialog-x" onClick={onClose}><AppIcon name="close" className="h-4 w-4" /></button></div>
        <div className="fos-dialog-body space-y-4">
          <label className="block"><span className="mb-2 block text-[12px] font-bold text-white">素材名称 <span className="text-red-400">*</span></span><input className="fos-input" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：苏晚卿雨夜近景" autoFocus /></label>
          <label className="block"><span className="mb-2 block text-[12px] font-bold text-white">归属项目</span><select className="fos-input" value={projectId} onChange={(event) => setProjectId(event.target.value)}><option value="global">账号素材</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
          <label className="block"><span className="mb-2 block text-[12px] font-bold text-white">资产归类</span><select className="fos-input" value={assetCategory} disabled={lockAssetCategory} onChange={(event) => setAssetCategory(event.target.value as FrameosAssetCategory)}>{FRAMEOS_ASSET_CATEGORIES.map((category) => <option key={category} value={category}>{FRAMEOS_ASSET_CATEGORY_LABELS[category]}</option>)}</select><span className="mt-1.5 block text-[10px] text-[var(--fos-text-4)]">{lockAssetCategory ? `当前入口固定归入${FRAMEOS_ASSET_CATEGORY_LABELS[assetCategory]}，不会混入其他品类。` : '选择角色、场景或道具后，也会出现在对应项目的资产库分类中。'}</span></label>
          <div>
            <span className="mb-2 block text-[12px] font-bold text-white">本地文件 <span className="text-red-400">*</span></span>
            <button type="button" className="flex min-h-24 w-full items-center justify-center gap-2 rounded-[10px] border border-dashed border-[var(--fos-border-strong)] bg-[var(--fos-bg-1)] px-4 text-[13px] text-[var(--fos-text-3)] hover:border-[var(--fos-primary)]" onClick={() => inputRef.current?.click()}><AppIcon name="folderOpen" className="h-5 w-5" /><span className="min-w-0 truncate">{file?.name || (imageOnly ? '选择一张资产图片' : '选择图片、视频、音频或自包含 GLB')}</span></button>
            <input ref={inputRef} type="file" accept={imageOnly ? 'image/*' : 'image/*,video/*,audio/*,.glb,model/gltf-binary'} title={imageOnly ? '请选择图片文件' : '3D 模型仅支持自包含 GLB 2.0'} className="hidden" onChange={(event) => { setFile(event.target.files?.[0] || null); setError(null) }} />
          </div>
          {error ? <div className="rounded-lg border border-red-400/25 bg-red-500/10 px-3 py-2 text-[12px] text-red-200">{error}</div> : null}
        </div>
        <div className="fos-dialog-foot"><button type="button" className="fos-btn fos-btn-ghost" onClick={onClose}>取消</button><button type="button" className="fos-btn fos-btn-primary" disabled={saving} onClick={() => void submit()}>{saving ? '上传中…' : '上传到素材库'}</button></div>
      </div>
    </div>
  )
}

function MaterialPreviewDialog({ item, canEdit, onCategoryChange, onCharacterBind, onClose }: {
  item: FrameosMaterialItem
  canEdit: boolean
  onCategoryChange: (category: FrameosAssetCategory) => void
  onCharacterBind: (characterId: string | null) => void
  onClose: () => void
}) {
  const assetCategory = frameosAssetCategoryFromMetadata(item.metadata)
  const characterBinding = frameosCharacterBindingFromMetadata(item.metadata)
  const canBindProjectCharacter = assetCategory === 'character'
    && item.projectId !== 'global'
    && item.projectId !== 'global-asset-hub'
  const [characters, setCharacters] = useState<Array<{ id: string; name: string }>>([])
  const [charactersLoading, setCharactersLoading] = useState(false)

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
        if (!response.ok) throw new Error(await readApiErrorMessage(response, '读取项目角色失败'))
        return await response.json() as { assets?: Array<{ id: string; name: string }> }
      })
      .then((payload) => setCharacters(Array.isArray(payload.assets) ? payload.assets.map((asset) => ({ id: asset.id, name: asset.name })) : []))
      .catch(() => setCharacters([]))
      .finally(() => setCharactersLoading(false))
  }, [canBindProjectCharacter, item.projectId])

  const rows: Array<[string, string]> = [
    ['素材名称', item.title || '未命名素材'],
    ['归属项目', item.projectName],
    ['素材类型', item.type === 'image' ? '图片' : item.type === 'video' ? '视频' : item.type === 'audio' ? '音频' : '3D 模型'],
    ['来源', MATERIAL_SOURCE_LABELS[item.source]],
    ['创建者', item.ownerName || '-'],
    ['创建时间', formatDate(item.createdAt)],
  ]
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section
        role="dialog"
        aria-modal="true"
        aria-label={`${item.title || '素材'}大图预览`}
        data-testid="material-large-preview"
        className="flex h-[min(88vh,900px)] w-[min(1280px,calc(100vw-32px))] flex-col overflow-hidden rounded-[14px] border border-white/10 bg-[var(--fos-bg-2)] shadow-2xl"
      >
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-[var(--fos-border-soft)] px-5">
          <div className="min-w-0"><h3 className="truncate text-[16px] font-bold text-white">{item.title || '未命名素材'}</h3><p className="mt-0.5 text-[11px] text-[var(--fos-text-4)]">大图预览 · 按 Esc 关闭</p></div>
          <button type="button" onClick={onClose} className="fos-dialog-x" aria-label="关闭大图预览"><AppIcon name="close" className="h-4 w-4" /></button>
        </header>
        <div className="grid min-h-0 flex-1 md:grid-cols-[minmax(0,1fr)_300px]">
          <div className="relative flex min-h-[360px] items-center justify-center overflow-hidden bg-[#050506] p-3 md:min-h-0">
            <div className="relative h-full w-full overflow-hidden rounded-[10px]"><MaterialPreview item={item} detail /></div>
          </div>
          <aside className="overflow-y-auto border-t border-[var(--fos-border-soft)] p-5 md:border-l md:border-t-0">
            <div className="mb-3 text-[12px] font-bold text-[var(--fos-text-3)]">素材信息</div>
            <div className="divide-y divide-[var(--fos-border-soft)] rounded-[10px] border border-[var(--fos-border-soft)]">{rows.map(([key, value]) => <div key={key} className="px-3.5 py-3 text-[12px]"><span className="block text-[var(--fos-text-4)]">{key}</span><span className="mt-1 block break-words font-bold text-white">{value}</span></div>)}</div>
            <label className="mt-4 block"><span className="mb-2 block text-[12px] font-bold text-[var(--fos-text-3)]">资产归类</span><select className="fos-input" value={assetCategory} disabled={!canEdit} onChange={(event) => onCategoryChange(event.target.value as FrameosAssetCategory)}>{FRAMEOS_ASSET_CATEGORIES.map((category) => <option key={category} value={category}>{FRAMEOS_ASSET_CATEGORY_LABELS[category]}</option>)}</select><span className="mt-1.5 block text-[10px] leading-4 text-[var(--fos-text-4)]">归类后会同步用于素材库、项目资产库和无限画布筛选。</span></label>
            {canBindProjectCharacter ? <label className="mt-4 block"><span className="mb-2 block text-[12px] font-bold text-[var(--fos-text-3)]">绑定项目角色</span><select className="fos-input" value={characterBinding?.characterId || ''} disabled={!canEdit || charactersLoading} onChange={(event) => onCharacterBind(event.target.value || null)}><option value="">不绑定具体角色</option>{characters.map((character) => <option key={character.id} value={character.id}>@{character.name}</option>)}</select><span className="mt-1.5 block text-[10px] leading-4 text-[var(--fos-text-4)]">同一角色的图片与音频会在资产库聚合显示；绑定音频后同步设为该角色音色。</span></label> : null}
          </aside>
        </div>
      </section>
    </div>
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
  const [projectId, setProjectId] = useState<string | null>(initialProjectId || null)
  const [filter, setFilter] = useState<FilterTab>('all')
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all')
  const [categoryFilter, setCategoryFilter] = useState<'all' | FrameosAssetCategory>('all')
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('all')
  const [creator, setCreator] = useState('')
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [detail, setDetail] = useState<FrameosMaterialItem | null>(null)
  const [uploadOpen, setUploadOpen] = useState(false)
  const initialMaterialOpenedRef = useRef(false)

  useEffect(() => {
    void apiFetch('/api/projects?page=1&pageSize=100')
      .then(async (response) => response.ok ? await response.json() as { projects?: ProjectItem[] } : { projects: [] })
      .then((payload) => setProjects(Array.isArray(payload.projects) ? payload.projects : []))
  }, [])

  const load = useCallback(async (sync = false) => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ limit: '500' })
      if (projectId) params.set('projectId', projectId)
      if (filter === 'image' || filter === 'video' || filter === 'audio' || filter === 'model3d') params.set('type', filter)
      if (filter === 'fav') params.set('favorite', '1')
      if (sourceFilter !== 'all') params.set('source', sourceFilter)
      if (creator.trim()) params.set('creator', creator.trim())
      const createdFrom = createdFromForFilter(timeFilter)
      if (createdFrom) params.set('createdFrom', createdFrom)
      if (query.trim()) params.set('query', query.trim())
      if (sync) params.set('sync', '1')
      const response = await apiFetch(`/api/frameos/materials?${params}`)
      if (!response.ok) throw new Error(await readApiErrorMessage(response, '加载素材库失败'))
      const payload = await response.json() as { materials?: FrameosMaterialItem[] }
      setMaterials(Array.isArray(payload.materials) ? payload.materials : [])
    } catch (loadError) {
      setMaterials([])
      setError(loadError instanceof Error ? loadError.message : '加载素材库失败')
    } finally {
      setLoading(false)
    }
  }, [creator, filter, projectId, query, sourceFilter, timeFilter])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(true), query || creator ? 250 : 0)
    return () => window.clearTimeout(timer)
  }, [creator, load, query])

  const activeProjectName = projectId === 'global'
    ? '账号素材'
    : projectId ? projects.find((project) => project.id === projectId)?.name || '项目素材' : '全部素材'
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

  const updateCategory = async (item: FrameosMaterialItem, assetCategory: FrameosAssetCategory) => {
    if (!canEditAssets) return
    const response = await apiFetch(`/api/frameos/materials/${item.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assetCategory }),
    })
    if (!response.ok) {
      setError(await readApiErrorMessage(response, '更新素材归类失败'))
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
    setDetail(next)
  }

  const updateCharacterBinding = async (item: FrameosMaterialItem, characterId: string | null) => {
    if (!canEditAssets) return
    const response = await apiFetch(`/api/frameos/materials/${item.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ characterId }),
    })
    if (!response.ok) {
      setError(await readApiErrorMessage(response, '更新项目角色绑定失败'))
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
    setDetail(next)
  }

  return (
    <div className="fml-layout flex min-h-0 flex-1">
      <aside className="fml-tree flex w-[230px] shrink-0 flex-col overflow-y-auto border-r border-[var(--fos-border-soft)] p-3">
        <div className="mb-2 px-2 text-[12px] font-bold text-[var(--fos-text-4)]">素材范围</div>
        <button type="button" className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px]" style={{ color: !projectId ? '#8fb0ff' : 'var(--fos-text-2)', background: !projectId ? 'var(--fos-primary-soft)' : 'transparent' }} onClick={() => setProjectId(null)}><AppIcon name="folderOpen" className="h-4 w-4" />全部素材</button>
        <button type="button" className="mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px]" style={{ color: projectId === 'global' ? '#8fb0ff' : 'var(--fos-text-2)', background: projectId === 'global' ? 'var(--fos-primary-soft)' : 'transparent' }} onClick={() => setProjectId('global')}><AppIcon name="folderHeart" className="h-4 w-4" />账号素材</button>
        {projects.length > 0 ? <div className="mb-1 mt-5 px-2 text-[12px] font-bold text-[var(--fos-text-4)]">我的项目</div> : null}
        {projects.map((project) => <button key={project.id} type="button" className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px]" style={{ color: projectId === project.id ? '#8fb0ff' : 'var(--fos-text-2)', background: projectId === project.id ? 'var(--fos-primary-soft)' : 'transparent' }} onClick={() => setProjectId(project.id)}><AppIcon name="folder" className="h-4 w-4" /><span className="truncate">{project.name}</span></button>)}
        <div className="fml-index mt-5 rounded-[10px] border border-[var(--fos-border-soft)] bg-[var(--fos-bg-2)] p-3 text-[11px] text-[var(--fos-text-4)]"><div className="mb-2 font-bold text-[var(--fos-text-2)]">当前索引</div><div>图片 {counts.image}</div><div className="mt-1">视频 {counts.video}</div><div className="mt-1">音频 {counts.audio}</div><div className="mt-1">3D {counts.model3d}</div></div>
      </aside>

      <main className="fml-main flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="fml-header flex flex-wrap items-center gap-3 border-b border-[var(--fos-border-soft)] px-5 py-3">
          <div className="fml-heading"><div className="text-[15px] font-bold text-white">{activeProjectName}</div><div className="mt-0.5 text-[11px] text-[var(--fos-text-4)]">生成结果会自动收录；本地素材上传时必须填写名称</div></div>
          <div className="fml-header-actions ml-auto flex items-center gap-2">
            <label className="fos-material-search"><AppIcon name="search" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索素材名称" /></label>
            <button type="button" className="fos-btn fos-btn-ghost fos-btn-sm" disabled={loading} onClick={() => void load(true)}><AppIcon name="refresh" className="h-3.5 w-3.5" />刷新</button>
            <button type="button" className="fos-btn fos-btn-primary fos-btn-sm" disabled={!canEditAssets} title={canEditAssets ? '本地上传素材' : '本地上传需要资产编辑权限'} onClick={() => setUploadOpen(true)}><AppIcon name="plus" className="h-3.5 w-3.5" />本地上传</button>
          </div>
        </div>
        <div className="fml-tabs flex items-center gap-1 border-b border-[var(--fos-border-soft)] px-5 py-2">
          {FILTER_TABS.map((tab) => <button key={tab.key} type="button" onClick={() => setFilter(tab.key)} className="rounded-lg px-3 py-1.5 text-[12px] font-bold" style={{ background: filter === tab.key ? 'var(--fos-primary)' : 'transparent', color: filter === tab.key ? 'white' : 'var(--fos-text-2)' }}>{tab.label}</button>)}
        </div>
        <div className="fml-filters flex flex-wrap items-center gap-2 border-b border-[var(--fos-border-soft)] px-5 py-2.5">
          <select className="fos-input w-[150px]" aria-label="素材来源" value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value as SourceFilter)}>{SOURCE_FILTERS.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select>
          <select className="fos-input w-[150px]" aria-label="资产归类" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value as 'all' | FrameosAssetCategory)}><option value="all">全部归类</option>{FRAMEOS_ASSET_CATEGORIES.map((category) => <option key={category} value={category}>{FRAMEOS_ASSET_CATEGORY_LABELS[category]}</option>)}</select>
          <select className="fos-input w-[130px]" aria-label="创建时间" value={timeFilter} onChange={(event) => setTimeFilter(event.target.value as TimeFilter)}><option value="all">全部时间</option><option value="today">今天</option><option value="7d">近 7 天</option><option value="30d">近 30 天</option></select>
          <input className="fos-input w-[180px]" aria-label="创建人" value={creator} onChange={(event) => setCreator(event.target.value)} placeholder="按创建人筛选" />
          {(sourceFilter !== 'all' || categoryFilter !== 'all' || timeFilter !== 'all' || creator.trim()) ? <button type="button" className="fos-btn fos-btn-ghost fos-btn-sm" onClick={() => { setSourceFilter('all'); setCategoryFilter('all'); setTimeFilter('all'); setCreator('') }}>清除筛选</button> : null}
        </div>
        <div className="fml-content min-h-0 flex-1 overflow-y-auto p-5">
          {error ? <div className="mb-4 rounded-lg border border-red-400/25 bg-red-500/10 px-3 py-2 text-[12px] text-red-200">{error}</div> : null}
          {loading ? <div className="py-20 text-center text-[13px] text-[var(--fos-text-4)]">正在同步素材库…</div> : null}
          {!loading && visibleMaterials.length === 0 ? <div className="py-20 text-center text-[13px] text-[var(--fos-text-4)]">暂无匹配素材，可调整筛选、从本地上传或先完成图片/视频生成。</div> : null}
          <div className="fml-grid grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>{visibleMaterials.map((item) => <MaterialCard key={item.id} item={item} canFavorite={canEditAssets} onOpen={() => setDetail(item)} onFavorite={() => void toggleFavorite(item)} />)}</div>
        </div>
      </main>

      {uploadOpen && canEditAssets ? <MaterialUploadDialog projects={projects} initialProjectId={projectId} onCreated={(material) => setMaterials((current) => [material, ...current])} onClose={() => setUploadOpen(false)} /> : null}
      {detail ? <MaterialPreviewDialog item={detail} canEdit={canEditAssets} onCategoryChange={(category) => void updateCategory(detail, category)} onCharacterBind={(characterId) => void updateCharacterBinding(detail, characterId)} onClose={() => setDetail(null)} /> : null}
    </div>
  )
}
