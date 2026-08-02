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
  MATERIAL_SOURCE_LABELS,
  type FrameosMaterialItem,
  type FrameosMaterialLibraryCapabilities,
  type FrameosMaterialProjectOption,
  type MaterialType,
} from './contracts'
import {
  buildMaterialPickerQuery,
  filterMaterialPickerItemsByCategory,
  normalizeMaterialProjectOptions,
  shouldResetMaterialProjectScope,
  sortMaterialPickerItems,
  type MaterialPickerScope,
  type MaterialPickerSort,
} from './material-picker-query'
import {
  FRAMEOS_ASSET_CATEGORY_LABELS,
  type FrameosAssetCategory,
} from '@/lib/frameos/material-category'

interface Props {
  projectId?: string | null
  type?: MaterialType
  allowAllTypes?: boolean
  assetCategory?: FrameosAssetCategory
  title?: string
  maxSelected?: number
  selectedIds?: string[]
  multiple?: boolean
  confirmLabel?: string
  /** A domain-scoped upload route may grant the current editor upload access. */
  uploadEndpoint?: string
  onSelect?: (material: FrameosMaterialItem) => void
  onConfirm?: (materials: FrameosMaterialItem[]) => void
  onClose: () => void
}

const TYPE_FILTERS: Array<{ value: MaterialType | 'all'; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'image', label: '图片' },
  { value: 'video', label: '视频' },
  { value: 'audio', label: '音频' },
  { value: 'model3d', label: '3D' },
]

const SOURCE_SCOPES = [
  { value: 'workflow' as const, label: '工作流素材', hint: '项目制作产出', icon: 'settingsHexMinor' as const },
  { value: 'toolbox' as const, label: '工具箱素材', hint: '工具箱生成产出', icon: 'folderOpen' as const },
  { value: 'canvas' as const, label: '画布素材', hint: '创作与画布产出', icon: 'monitor' as const },
  { value: 'upload' as const, label: '上传素材', hint: '本地上传内容', icon: 'upload' as const },
]

const SCOPE_HINTS: Record<MaterialPickerScope, string> = {
  all: '当前项目与账号可用素材',
  favorites: '已收藏的可用素材',
  project: '仅显示当前项目素材',
  workflow: '分镜与项目制作产出',
  toolbox: '工具箱生成的素材',
  canvas: '资产创作与画布编辑产出',
  upload: '从本地上传的素材',
  trash: '已删除素材，可恢复后继续使用',
}

function formatDate(value: string): string {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return '-'
  return date.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })
}

export function MaterialPickerDialog({
  projectId,
  type = 'image',
  allowAllTypes = false,
  assetCategory,
  title = '从素材库选择',
  maxSelected = 9,
  selectedIds = [],
  multiple = false,
  confirmLabel = '添加参考素材',
  uploadEndpoint,
  onSelect,
  onConfirm,
  onClose,
}: Props) {
  const { data: session } = useSession()
  const canManageFavorites = hasAccountPermissions({ role: session?.user?.role, permissions: session?.user?.permissions }, ['assetWrite'])
  const canUpload = Boolean(uploadEndpoint) || canManageFavorites
  const currentUserName = session?.user?.name?.trim() || ''
  const inputRef = useRef<HTMLInputElement>(null)
  const requestIdRef = useRef(0)
  const initialSyncRef = useRef(false)
  const [materials, setMaterials] = useState<FrameosMaterialItem[]>([])
  const [projectOptions, setProjectOptions] = useState<FrameosMaterialProjectOption[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState(projectId?.trim() || '')
  const [trashCapability, setTrashCapability] = useState<FrameosMaterialLibraryCapabilities['trash']>({
    supported: false,
    count: 0,
    reason: '正在确认回收站能力…',
  })
  const [activeScope, setActiveScope] = useState<MaterialPickerScope>('all')
  const [activeType, setActiveType] = useState<MaterialType | 'all'>(allowAllTypes ? 'all' : type)
  const [query, setQuery] = useState('')
  const [createdByMe, setCreatedByMe] = useState(false)
  const [createdFrom, setCreatedFrom] = useState('')
  const [createdTo, setCreatedTo] = useState('')
  const [favoriteOnly, setFavoriteOnly] = useState(false)
  const [sort, setSort] = useState<MaterialPickerSort>('newest')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadName, setUploadName] = useState('')
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [showUpload, setShowUpload] = useState(false)
  const [pendingSelected, setPendingSelected] = useState<FrameosMaterialItem[]>([])

  const selectedIdSet = useMemo(
    () => new Set([...selectedIds, ...pendingSelected.map((material) => material.id)]),
    [pendingSelected, selectedIds],
  )
  const selectedCount = selectedIdSet.size
  const visibleMaterials = useMemo(
    () => sortMaterialPickerItems(filterMaterialPickerItemsByCategory(materials, assetCategory), sort),
    [assetCategory, materials, sort],
  )
  const browsingTrash = activeScope === 'trash'
  const hasFilters = activeScope !== 'all'
    || activeType !== (allowAllTypes ? 'all' : type)
    || Boolean(query.trim() || createdByMe || createdFrom || createdTo || favoriteOnly)
    || sort !== 'newest'

  const chooseMaterial = (material: FrameosMaterialItem) => {
    if (!multiple) {
      onSelect?.(material)
      return
    }
    setPendingSelected((current) => {
      if (current.some((item) => item.id === material.id)) return current.filter((item) => item.id !== material.id)
      if (selectedIds.includes(material.id) || selectedIds.length + current.length >= maxSelected) return current
      return [...current, material]
    })
  }

  const load = useCallback(async (sync = false) => {
    const requestId = ++requestIdRef.current
    setLoading(true)
    setError(null)
    try {
      const params = buildMaterialPickerQuery({
        projectId: activeScope === 'project' ? selectedProjectId : browsingTrash ? undefined : projectId,
        scope: activeScope,
        type: activeType,
        query,
        creator: createdByMe ? currentUserName : '',
        createdFrom,
        createdTo,
        favoriteOnly,
        sync,
      })
      const response = await apiFetch(`/api/frameos/materials?${params}`)
      if (!response.ok) throw new Error(await readApiErrorMessage(response, '加载素材失败'))
      const payload = await response.json() as {
        materials?: FrameosMaterialItem[]
        projects?: FrameosMaterialProjectOption[]
        capabilities?: Partial<FrameosMaterialLibraryCapabilities>
      }
      if (requestId !== requestIdRef.current) return
      setMaterials(Array.isArray(payload.materials) ? payload.materials : [])
      const nextProjects = normalizeMaterialProjectOptions(
        Array.isArray(payload.projects) ? payload.projects : [],
        projectId,
      )
      setProjectOptions(nextProjects)
      setSelectedProjectId((current) => current || projectId?.trim() || nextProjects[0]?.id || '')
      if (payload.capabilities?.trash) setTrashCapability(payload.capabilities.trash)
    } catch (loadError) {
      if (requestId !== requestIdRef.current) return
      setMaterials([])
      setError(loadError instanceof Error ? loadError.message : '加载素材失败')
    } finally {
      if (requestId === requestIdRef.current) setLoading(false)
    }
  }, [activeScope, activeType, browsingTrash, createdByMe, createdFrom, createdTo, currentUserName, favoriteOnly, projectId, query, selectedProjectId])

  useEffect(() => {
    setActiveType(allowAllTypes ? 'all' : type)
  }, [allowAllTypes, type])

  useEffect(() => {
    if (shouldResetMaterialProjectScope(activeScope, selectedProjectId)) setActiveScope('all')
  }, [activeScope, selectedProjectId])

  useEffect(() => {
    setSelectedProjectId(projectId?.trim() || '')
  }, [projectId])

  useEffect(() => {
    initialSyncRef.current = false
  }, [projectId])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const shouldSync = !initialSyncRef.current
      initialSyncRef.current = true
      void load(shouldSync)
    }, query.trim() ? 250 : 0)
    return () => window.clearTimeout(timer)
  }, [load, query])

  const clearFilters = () => {
    setActiveScope('all')
    setActiveType(allowAllTypes ? 'all' : type)
    setQuery('')
    setCreatedByMe(false)
    setCreatedFrom('')
    setCreatedTo('')
    setFavoriteOnly(false)
    setSort('newest')
  }

  const toggleFavorite = async (material: FrameosMaterialItem) => {
    if (!canManageFavorites) return
    const next = !material.isFavorited
    setMaterials((current) => (activeScope === 'favorites' || favoriteOnly) && !next
      ? current.filter((item) => item.id !== material.id)
      : current.map((item) => item.id === material.id ? { ...item, isFavorited: next } : item))
    try {
      const response = await apiFetch(`/api/frameos/materials/${material.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isFavorited: next }),
      })
      if (!response.ok) throw new Error(await readApiErrorMessage(response, '更新收藏失败'))
    } catch (favoriteError) {
      setError(favoriteError instanceof Error ? favoriteError.message : '更新收藏失败')
      void load(false)
    }
  }

  const restoreMaterial = async (material: FrameosMaterialItem) => {
    if (!canManageFavorites || !browsingTrash) return
    setError(null)
    try {
      const response = await apiFetch(`/api/frameos/materials/${material.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ restore: true }),
      })
      if (!response.ok) throw new Error(await readApiErrorMessage(response, '恢复素材失败'))
      setMaterials((current) => current.filter((item) => item.id !== material.id))
      setTrashCapability((current) => ({ ...current, count: Math.max(0, current.count - 1) }))
    } catch (restoreError) {
      setError(restoreError instanceof Error ? restoreError.message : '恢复素材失败')
      void load(false)
    }
  }

  const upload = async () => {
    if (!canUpload) {
      setError('当前角色可以选择已有素材，但没有本地上传权限。')
      return
    }
    if (!uploadFile || !uploadName.trim()) {
      setError('请选择本地文件并填写素材名称。')
      return
    }
    setUploading(true)
    setError(null)
    try {
      const form = new FormData()
      form.set('file', uploadFile)
      form.set('title', uploadName.trim())
      form.set('projectId', projectId || 'global')
      if (assetCategory) form.set('assetCategory', assetCategory)
      const response = await apiFetch(uploadEndpoint || '/api/frameos/materials', { method: 'POST', body: form })
      if (!response.ok) throw new Error(await readApiErrorMessage(response, '上传素材失败'))
      const payload = await response.json() as { material?: FrameosMaterialItem }
      if (!payload.material) throw new Error('上传成功但未返回素材。')
      setMaterials((current) => [payload.material!, ...current.filter((item) => item.id !== payload.material!.id)])
      setUploadFile(null)
      setUploadName('')
      setShowUpload(false)
      if (!selectedIdSet.has(payload.material.id) && selectedCount < maxSelected) chooseMaterial(payload.material)
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : '上传素材失败')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="fos-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div className="fos-dialog flex max-h-[88vh] flex-col overflow-hidden" style={{ width: 'min(1120px, calc(100vw - 24px))', maxWidth: 1120 }}>
        <div className="fos-dialog-head shrink-0">
          <div>
            <div className="fos-dialog-title">{title}</div>
            <div className="mt-1 text-[12px] text-[var(--fos-text-4)]">{SCOPE_HINTS[activeScope]}{assetCategory ? ` · 仅${FRAMEOS_ASSET_CATEGORY_LABELS[assetCategory]}` : ''} · 已选 {selectedCount} 个</div>
          </div>
          <button type="button" className="fos-dialog-x" aria-label="关闭素材选择器" onClick={onClose}><AppIcon name="close" className="h-4 w-4" /></button>
        </div>

        <div className="flex shrink-0 items-center gap-3 border-b border-[var(--fos-border-soft)] px-5 py-3">
          <div className="relative min-w-0 flex-1">
            <AppIcon name="search" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--fos-text-4)]" />
            <input className="fos-input" style={{ paddingLeft: 36 }} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索素材名称…" />
          </div>
          <button type="button" className="fos-btn fos-btn-ghost fos-btn-sm" onClick={() => void load(true)} disabled={loading}><AppIcon name="refresh" className="h-3.5 w-3.5" />刷新</button>
          <button type="button" className="fos-btn fos-btn-primary fos-btn-sm" disabled={!canUpload || browsingTrash} title={browsingTrash ? '请先退出已删除范围' : canUpload ? '本地命名上传' : '当前角色没有资产编辑权限'} onClick={() => setShowUpload((value) => !value)}><AppIcon name="plus" className="h-3.5 w-3.5" />本地上传</button>
        </div>

        <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] md:grid-cols-[220px_minmax(0,1fr)] md:grid-rows-1">
          <aside className="max-h-[190px] overflow-y-auto border-b border-[var(--fos-border-soft)] bg-[var(--fos-bg-1)] p-3 md:max-h-none md:border-b-0 md:border-r">
            <div className="mb-1 px-2 text-[11px] font-bold uppercase tracking-[.08em] text-[var(--fos-text-4)]">素材范围</div>
            <nav className="grid grid-cols-2 gap-1 md:block" aria-label="素材分类">
              {([
                { value: 'all' as const, label: '全部素材', hint: '当前可用', icon: 'folderOpen' as const },
                { value: 'favorites' as const, label: '我的收藏', hint: '收藏内容', icon: 'bookmark' as const },
              ]).map((item) => (
                <button key={item.value} type="button" className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors md:mb-1 ${activeScope === item.value ? 'bg-[var(--fos-primary-soft)] text-[#9bb6ff]' : 'text-[var(--fos-text-2)] hover:bg-[var(--fos-fill-soft)]'}`} onClick={() => { setActiveScope(item.value); setFavoriteOnly(item.value === 'favorites') }}>
                  <AppIcon name={item.icon} className="h-4 w-4 shrink-0" /><span className="min-w-0 flex-1 truncate text-[12px] font-semibold">{item.label}</span><small className="hidden text-[9px] text-[var(--fos-text-4)] md:block">{item.hint}</small>
                </button>
              ))}
              <div className="col-span-2 mb-1 mt-4 px-2 text-[11px] font-bold uppercase tracking-[.08em] text-[var(--fos-text-4)]">项目</div>
              {projectOptions.length > 0 ? projectOptions.map((project) => {
                const active = activeScope === 'project' && selectedProjectId === project.id
                const current = project.id === projectId
                return (
                  <button key={project.id} type="button" className={`col-span-2 flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors md:mb-1 ${active ? 'bg-[var(--fos-primary-soft)] text-[#9bb6ff]' : 'text-[var(--fos-text-2)] hover:bg-[var(--fos-fill-soft)]'}`} onClick={() => { setSelectedProjectId(project.id); setActiveScope('project') }}>
                    <AppIcon name="folder" className="h-4 w-4 shrink-0" /><span className="min-w-0 flex-1"><b className="block truncate text-[12px]">{project.name}</b><small className="block truncate text-[9px] font-normal text-[var(--fos-text-4)]">{current ? '当前项目' : '可访问项目'}</small></span>
                  </button>
                )
              }) : (
                <button type="button" disabled className="col-span-2 flex w-full cursor-not-allowed items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[var(--fos-text-4)] opacity-55 md:mb-1">
                  <AppIcon name="folder" className="h-4 w-4 shrink-0" /><span className="text-[12px]">暂无可访问项目</span>
                </button>
              )}
              <button type="button" disabled={!trashCapability.supported} aria-disabled={!trashCapability.supported} title={trashCapability.reason || '已删除素材'} data-testid="material-trash-scope" className={`col-span-2 flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-55 md:mb-1 ${browsingTrash ? 'bg-[var(--fos-primary-soft)] text-[#9bb6ff]' : 'text-[var(--fos-text-2)] hover:bg-[var(--fos-fill-soft)]'}`} onClick={() => { setActiveScope('trash'); setFavoriteOnly(false); setShowUpload(false) }}>
                <AppIcon name="trash" className="h-4 w-4 shrink-0" /><span className="min-w-0 flex-1"><b className="block truncate text-[12px]">已删除</b><small className="block truncate text-[9px] font-normal">{trashCapability.supported ? `${trashCapability.count} 个素材` : '正在确认回收站能力'}</small></span>
              </button>
              <div className="col-span-2 mb-1 mt-4 px-2 text-[11px] font-bold uppercase tracking-[.08em] text-[var(--fos-text-4)]">素材来源</div>
              {SOURCE_SCOPES.map((item) => (
                <button key={item.value} type="button" className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors md:mb-1 ${activeScope === item.value ? 'bg-[var(--fos-primary-soft)] text-[#9bb6ff]' : 'text-[var(--fos-text-2)] hover:bg-[var(--fos-fill-soft)]'}`} onClick={() => setActiveScope(item.value)}>
                  <AppIcon name={item.icon} className="h-4 w-4 shrink-0" /><span className="min-w-0 flex-1 truncate text-[12px] font-semibold">{item.label}</span><small className="hidden text-[9px] text-[var(--fos-text-4)] md:block">{item.hint}</small>
                </button>
              ))}
            </nav>
          </aside>

          <main className="flex min-h-0 min-w-0 flex-col overflow-hidden">
            <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--fos-border-soft)] px-4 py-2.5">
              <div className="flex items-center gap-1.5" aria-label="素材类型">
                {(allowAllTypes ? TYPE_FILTERS : TYPE_FILTERS.filter((item) => item.value === type)).map((item) => (
                  <button key={item.value} type="button" className={`rounded-md border px-2.5 py-1.5 text-[11px] font-semibold transition-colors ${activeType === item.value ? 'border-[rgba(111,140,255,.48)] bg-[rgba(111,140,255,.18)] text-white' : 'border-[var(--fos-border-soft)] bg-[var(--fos-bg-2)] text-[var(--fos-text-3)]'}`} onClick={() => setActiveType(item.value)}>{item.label}</button>
                ))}
              </div>
              <span className="mx-1 h-5 w-px bg-[var(--fos-border-soft)]" />
              <button type="button" className={`fos-btn fos-btn-sm ${favoriteOnly ? 'fos-btn-soft' : 'fos-btn-ghost'}`} onClick={() => { setFavoriteOnly((value) => !value); if (activeScope === 'favorites') setActiveScope('all') }}><AppIcon name="bookmark" className="h-3.5 w-3.5" />收藏</button>
              <button type="button" disabled={!currentUserName} title={currentUserName ? `仅显示由 ${currentUserName} 创建的素材` : '当前账号未设置显示名称'} className={`fos-btn fos-btn-sm ${createdByMe ? 'fos-btn-soft' : 'fos-btn-ghost'}`} onClick={() => setCreatedByMe((value) => !value)}><AppIcon name="user" className="h-3.5 w-3.5" />由我创建</button>
              <select className="fos-input ml-auto" style={{ width: 128 }} aria-label="创建时间排序" value={sort} onChange={(event) => setSort(event.target.value as MaterialPickerSort)}><option value="newest">创建时间 ↓</option><option value="oldest">创建时间 ↑</option></select>
            </div>

            <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--fos-border-soft)] px-4 py-2.5">
              <span className="text-[11px] font-semibold text-[var(--fos-text-4)]">创建日期</span>
              <input type="date" className="fos-input" style={{ width: 145 }} aria-label="开始日期" max={createdTo || undefined} value={createdFrom} onChange={(event) => setCreatedFrom(event.target.value)} />
              <span className="text-[11px] text-[var(--fos-text-4)]">至</span>
              <input type="date" className="fos-input" style={{ width: 145 }} aria-label="结束日期" min={createdFrom || undefined} value={createdTo} onChange={(event) => setCreatedTo(event.target.value)} />
              {hasFilters ? <button type="button" className="fos-btn fos-btn-ghost fos-btn-sm" onClick={clearFilters}>清除筛选</button> : null}
              <span className="ml-auto text-[11px] text-[var(--fos-text-4)]">{loading ? '读取中…' : `${visibleMaterials.length} 个结果`}</span>
            </div>

            {showUpload && canUpload ? (
              <div className="grid shrink-0 gap-3 border-b border-[var(--fos-border-soft)] bg-[var(--fos-bg-3)] px-4 py-3 md:grid-cols-[1fr_1.3fr_auto]">
                <input className="fos-input" value={uploadName} onChange={(event) => setUploadName(event.target.value)} placeholder="素材名称（必填）" />
                <button type="button" className="fos-btn fos-btn-ghost justify-start" onClick={() => inputRef.current?.click()}><AppIcon name="folderOpen" className="h-4 w-4" /><span className="min-w-0 truncate">{uploadFile?.name || '选择本地文件'}</span></button>
                <input ref={inputRef} type="file" accept={activeType === 'all' ? 'image/*,video/*,audio/*,.glb,model/gltf-binary' : activeType === 'image' ? 'image/*' : activeType === 'video' ? 'video/*' : activeType === 'audio' ? 'audio/*' : '.glb,model/gltf-binary'} title="3D 模型仅支持自包含 GLB 2.0" className="hidden" onChange={(event) => setUploadFile(event.target.files?.[0] || null)} />
                <button type="button" className="fos-btn fos-btn-primary" disabled={uploading} onClick={() => void upload()}>{uploading ? '上传中…' : '上传并选用'}</button>
              </div>
            ) : null}

            {error ? <div className="mx-4 mt-3 shrink-0 rounded-lg border border-red-400/25 bg-red-500/10 px-3 py-2 text-[12px] text-red-200">{error}</div> : null}
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {loading ? <div className="py-16 text-center text-[13px] text-[var(--fos-text-4)]">正在加载素材…</div> : null}
              {!loading && visibleMaterials.length === 0 ? <div className="py-16 text-center text-[13px] text-[var(--fos-text-4)]">{browsingTrash ? '回收站为空。' : hasFilters ? '当前筛选条件下没有素材。' : canUpload ? '暂无可用素材，可点击“本地上传”。' : '暂无可用素材；请联系资产师上传后再选择。'}</div> : null}
              <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(172px, 1fr))' }}>
                {visibleMaterials.map((material) => {
                  const selected = selectedIdSet.has(material.id)
                  const disabled = !selected && selectedCount >= maxSelected
                  const src = toDisplayImageUrl(material.url)
                  return (
                    <article key={material.id} className="relative overflow-hidden rounded-[10px] border transition-colors" style={{ borderColor: selected ? 'var(--fos-primary)' : 'var(--fos-border-mid)', background: 'var(--fos-bg-2)' }}>
                      <button type="button" disabled={browsingTrash || disabled || (!multiple && selected)} onClick={() => chooseMaterial(material)} className="block w-full text-left disabled:opacity-55">
                        <div className="relative aspect-[4/3] overflow-hidden bg-black/40">
                          {src && material.type === 'image' ? <MediaImage src={src} alt={material.title || '素材'} fill sizes="220px" style={{ objectFit: 'cover' }} /> : <AppIcon name={material.type === 'video' ? 'video' : material.type === 'audio' ? 'audioWave' : material.type === 'model3d' ? 'cube' : 'image'} className="absolute left-1/2 top-1/2 h-9 w-9 -translate-x-1/2 -translate-y-1/2 text-white/15" />}
                          <span className="absolute bottom-2 left-2 rounded bg-black/70 px-1.5 py-0.5 text-[9px] font-bold text-white">{material.type === 'image' ? '图片' : material.type === 'video' ? '视频' : material.type === 'audio' ? '音频' : '3D'}</span>
                          {selected ? <span className="absolute right-2 top-2 rounded-md bg-[var(--fos-primary)] px-2 py-1 text-[10px] font-bold text-white">{multiple ? '已选择' : '已添加'}</span> : null}
                        </div>
                        <div className="truncate px-2.5 pt-2 text-[12px] font-bold text-white" title={material.title || ''}>{material.title || '未命名素材'}</div>
                        <div className="flex items-center justify-between gap-2 px-2.5 pt-1 text-[10px] text-[var(--fos-text-4)]"><span className="min-w-0 truncate">{material.projectName}</span><span className="shrink-0 rounded bg-[var(--fos-fill-mid)] px-1.5 py-0.5">{MATERIAL_SOURCE_LABELS[material.source]}</span></div>
                        <div className="flex items-center justify-between gap-2 px-2.5 pb-2 pt-1.5 text-[9px] text-[var(--fos-text-4)]"><span className="min-w-0 truncate">{material.ownerName || '未记录创建者'}</span><span className="shrink-0">{formatDate(material.createdAt)}</span></div>
                      </button>
                      {browsingTrash ? (
                        <button type="button" disabled={!canManageFavorites} aria-label={`恢复 ${material.title || '素材'}`} title={canManageFavorites ? '恢复素材' : '恢复需要资产编辑权限'} className="absolute left-2 top-2 flex items-center gap-1 rounded-md bg-black/70 px-2 py-1.5 text-[10px] font-semibold text-white/85 hover:text-[#9bb6ff] disabled:cursor-not-allowed disabled:opacity-40" onClick={() => void restoreMaterial(material)}><AppIcon name="refresh" className="h-3.5 w-3.5" />恢复</button>
                      ) : (
                        <button type="button" disabled={!canManageFavorites} aria-label={material.isFavorited ? `取消收藏 ${material.title || '素材'}` : `收藏 ${material.title || '素材'}`} title={canManageFavorites ? material.isFavorited ? '取消收藏' : '收藏' : '收藏需要资产编辑权限'} className="absolute left-2 top-2 rounded-md bg-black/65 p-1.5 text-white/80 hover:text-[#ffd166] disabled:cursor-not-allowed disabled:opacity-40" onClick={() => void toggleFavorite(material)}><AppIcon name="bookmark" className="h-3.5 w-3.5" style={{ color: material.isFavorited ? '#ffd166' : undefined, fill: material.isFavorited ? '#ffd166' : 'none' }} /></button>
                      )}
                    </article>
                  )
                })}
              </div>
            </div>
          </main>
        </div>

        {multiple ? (
          <div className="flex shrink-0 items-center justify-between gap-3 border-t border-[var(--fos-border-soft)] px-5 py-3">
            <span className="text-[11px] text-[var(--fos-text-4)]">已选 {selectedCount}/{maxSelected}，确认后会一次加入。</span>
            <div className="flex items-center gap-2"><button type="button" className="fos-btn fos-btn-ghost fos-btn-sm" onClick={onClose}>取消</button><button type="button" className="fos-btn fos-btn-primary fos-btn-sm" disabled={pendingSelected.length === 0} onClick={() => onConfirm?.(pendingSelected)}>{confirmLabel} · {pendingSelected.length}</button></div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
