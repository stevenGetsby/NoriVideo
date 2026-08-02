'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useSearchParams } from 'next/navigation'
import { Link } from '@/i18n/navigation'
import { AppIcon } from '@/components/ui/icons'
import { MediaImage } from '@/components/media/MediaImage'
import { apiFetch } from '@/lib/api-fetch'
import { readApiErrorMessage } from '@/lib/api/read-error-message'
import type { AssetSummary, VisualAssetSummary } from '@/lib/assets/contracts'
import { logError } from '@/lib/logging/core'
import { toDisplayImageUrl } from '@/lib/media/image-url'
import {
  MATERIAL_SOURCE_LABELS,
  type FrameosMaterialItem,
} from '@/components/frameos/materials/contracts'
import {
  frameosAssetCategoryFromMetadata,
  frameosCharacterBindingFromMetadata,
  type FrameosAssetCategory,
} from '@/lib/frameos/material-category'
import { hasAccountPermissions } from '@/lib/account/permissions'
import { MaterialUploadDialog } from './FosMaterialLibrary'

type AssetCategory = 'characters' | 'items' | 'environments'
type RoleTag = '角色' | '道具' | '环境'

interface ProjectItem {
  id: string
  name: string
}

interface Asset {
  key: string
  id: string
  name: string
  role: RoleTag
  category: AssetCategory
  sourceLabel: string
  imageUrls: string[]
  poses: number
  voice?: {
    bound: boolean
    label: string
    url: string | null
  }
}

const ROLE_COLORS: Record<RoleTag, string> = {
  '角色': '#e0a23a',
  '道具': '#3b82f6',
  '环境': '#10b981',
}

const CATEGORY_LABELS: Record<AssetCategory, string> = {
  characters: '角色',
  items: '物品',
  environments: '环境',
}

const TEST_MODE = process.env.NEXT_PUBLIC_NORI_TEST_MODE === 'true'

function selectedImageUrls(asset: VisualAssetSummary): string[] {
  const selected: string[] = []
  const remaining: string[] = []
  const seen = new Set<string>()

  for (const variant of asset.variants) {
    for (const render of variant.renders) {
      const url = render.imageUrl?.trim()
      if (!url || seen.has(url)) continue
      seen.add(url)
      if (render.isSelected) selected.push(url)
      else remaining.push(url)
    }
  }

  return [...selected, ...remaining]
}

function mapAsset(asset: AssetSummary, sourceLabel: string): Asset | null {
  if (asset.kind === 'voice') return null
  const imageUrls = selectedImageUrls(asset)
  const category: AssetCategory = asset.kind === 'character'
    ? 'characters'
    : asset.kind === 'prop'
      ? 'items'
      : 'environments'
  const role: RoleTag = asset.kind === 'character' ? '角色' : asset.kind === 'prop' ? '道具' : '环境'
  const variantCount = asset.variants.length
  const voice = asset.kind === 'character'
    ? {
        bound: Boolean(asset.voice.voiceType || asset.voice.voiceId || asset.voice.customVoiceUrl || asset.voice.media?.url),
        label: asset.voice.voiceType === 'uploaded'
          ? '上传音色'
          : asset.voice.voiceType === 'qwen-designed'
            ? '设计音色'
            : asset.voice.voiceType === 'custom'
              ? '角色音色'
              : asset.voice.voiceId
                ? '平台音色'
                : '未绑定音色',
        url: asset.voice.media?.url || asset.voice.customVoiceUrl || null,
      }
    : undefined

  return {
    key: `${asset.scope}:${asset.kind}:${asset.id}`,
    id: asset.id,
    name: asset.name,
    role,
    category,
    sourceLabel,
    imageUrls,
    poses: Math.max(1, Math.min(4, imageUrls.length || variantCount || 1)),
    voice,
  }
}

function mapClassifiedMaterial(material: FrameosMaterialItem, sourceLabel: string): Asset | null {
  if (material.type !== 'image' || (material.source !== 'toolbox' && material.source !== 'upload')) return null
  if (frameosCharacterBindingFromMetadata(material.metadata)) return null
  const materialCategory = frameosAssetCategoryFromMetadata(material.metadata)
  const category: AssetCategory | null = materialCategory === 'character'
    ? 'characters'
    : materialCategory === 'prop'
      ? 'items'
      : materialCategory === 'location'
        ? 'environments'
        : null
  if (!category) return null
  const role: RoleTag = category === 'characters' ? '角色' : category === 'items' ? '道具' : '环境'
  const imageUrl = material.url || material.resultUrl || material.storageKey
  return {
    key: `material:${material.id}`,
    id: material.id,
    name: material.title || '未命名分类资产',
    role,
    category,
    sourceLabel: `${sourceLabel} · ${MATERIAL_SOURCE_LABELS[material.source]}`,
    imageUrls: imageUrl ? [imageUrl] : [],
    poses: 1,
  }
}

function mergeBoundCharacterMaterials(
  assets: Asset[],
  materials: FrameosMaterialItem[],
): Asset[] {
  const byCharacter = new Map<string, { images: string[]; audioUrl: string | null }>()
  for (const material of materials) {
    const binding = frameosCharacterBindingFromMetadata(material.metadata)
    if (!binding || (material.type !== 'image' && material.type !== 'audio')) continue
    const current = byCharacter.get(binding.characterId) || { images: [], audioUrl: null }
    const url = material.url || material.resultUrl || material.storageKey
    if (url && material.type === 'image' && !current.images.includes(url)) current.images.push(url)
    if (url && material.type === 'audio' && !current.audioUrl) current.audioUrl = url
    byCharacter.set(binding.characterId, current)
  }
  if (byCharacter.size === 0) return assets
  return assets.map((asset) => {
    if (asset.category !== 'characters') return asset
    const bound = byCharacter.get(asset.id)
    if (!bound) return asset
    const imageUrls = Array.from(new Set([...asset.imageUrls, ...bound.images]))
    const voice = asset.voice?.bound || !bound.audioUrl
      ? asset.voice
      : { bound: true, label: '素材库角色音频', url: bound.audioUrl }
    return {
      ...asset,
      imageUrls,
      poses: Math.max(1, Math.min(4, imageUrls.length || asset.poses)),
      voice,
    }
  })
}

function AssetPreview({ kind, imageUrl }: { kind: AssetCategory; imageUrl?: string }) {
  const src = toDisplayImageUrl(imageUrl)
  return (
    <div className="relative flex h-full w-full items-center justify-center overflow-hidden bg-gradient-to-b from-[#1a1a20] to-[#101014]">
      {src ? (
        <MediaImage src={src} alt="" fill sizes="280px" style={{ objectFit: 'cover' }} />
      ) : (
        <AppIcon name={kind === 'characters' ? 'user' : kind === 'items' ? 'package' : 'imageLandscape'} className="h-7 w-7 text-white/12" />
      )}
    </div>
  )
}

function AssetCard({
  asset,
  batch,
  checked,
  onToggle,
  onOpen,
}: {
  asset: Asset
  batch: boolean
  checked: boolean
  onToggle: () => void
  onOpen: () => void
}) {
  const color = ROLE_COLORS[asset.role]
  return (
    <div className="overflow-hidden rounded-[12px] border border-[var(--fos-border-soft)] bg-[var(--fos-bg-2)] transition-colors hover:border-[var(--fos-border-mid)]">
      <div className="relative">
        {batch ? (
          <button
            type="button"
            onClick={onToggle}
            className="absolute left-2 top-2 z-10 flex h-6 w-6 items-center justify-center rounded-[6px] border-2"
            style={{ borderColor: checked ? 'var(--fos-primary)' : 'rgba(255,255,255,.5)', background: checked ? 'var(--fos-primary)' : 'rgba(0,0,0,.4)' }}
          >
            {checked ? <AppIcon name="check" className="h-3.5 w-3.5 text-white" /> : null}
          </button>
        ) : null}
        <button
          type="button"
          onClick={batch ? onToggle : onOpen}
          className="grid w-full"
          style={{ gridTemplateColumns: `1.3fr repeat(${Math.max(asset.poses - 1, 0)}, 1fr)`, aspectRatio: '16 / 7' }}
        >
          {Array.from({ length: asset.poses }).map((_, index) => (
            <div key={index} className="min-w-0 border-r border-black/30 last:border-r-0">
              <AssetPreview kind={asset.category} imageUrl={asset.imageUrls[index]} />
            </div>
          ))}
        </button>
      </div>
      <div className="flex min-h-[68px] flex-col justify-center gap-2 border-t border-[var(--fos-border-soft)] px-3 py-2.5">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <span className="min-w-0 truncate text-[13px] font-bold leading-5 text-white" title={asset.name}>{asset.name}</span>
          <span className="flex-none rounded-md px-2 py-0.5 text-[11px] font-bold leading-4" style={{ background: `${color}26`, color }}>{asset.role}</span>
        </div>
        <div className="flex min-w-0 items-center gap-2 text-[11px] leading-4 text-[var(--fos-text-4)]"><span className="min-w-0 flex-1 truncate">{asset.sourceLabel}</span>{asset.voice?.bound ? <span className="shrink-0 rounded bg-violet-400/10 px-1.5 py-0.5 font-bold text-violet-200">音色已绑定</span> : null}</div>
      </div>
    </div>
  )
}

function TreeRow({
  icon,
  label,
  active,
  depth = 0,
  caret,
  onClick,
}: {
  icon?: string
  label: string
  active?: boolean
  depth?: number
  caret?: boolean
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-[8px] py-2 pr-3 text-left text-[13px]"
      style={{ paddingLeft: 12 + depth * 16, background: active ? 'var(--fos-primary-soft)' : 'transparent', color: active ? '#8fb0ff' : 'var(--fos-text-2)', fontWeight: active ? 700 : 500 }}
    >
      {caret ? <AppIcon name="chevronDown" className="h-3 w-3 shrink-0 text-[var(--fos-text-4)]" /> : <span className="w-3 shrink-0" />}
      {icon ? <AppIcon name={icon as never} className="h-4 w-4 shrink-0" /> : null}
      <span className="min-w-0 truncate">{label}</span>
    </button>
  )
}

export function FosAssetLibrary() {
  const { data: session } = useSession()
  const params = useSearchParams()
  const [category, setCategory] = useState<AssetCategory>('characters')
  const [batch, setBatch] = useState(params?.get('batch') === '1')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [lightbox, setLightbox] = useState<Asset | null>(null)
  const [projects, setProjects] = useState<ProjectItem[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [assets, setAssets] = useState<Asset[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [projectMenuOpen, setProjectMenuOpen] = useState(false)
  const [uploadOpen, setUploadOpen] = useState(false)
  const accountKey = session?.user?.name || session?.user?.email || (TEST_MODE ? 'test-mode' : '')
  const canEditAssets = hasAccountPermissions(
    { role: session?.user?.role, permissions: session?.user?.permissions },
    ['assetWrite'],
  )

  const selectedProject = projects.find((project) => project.id === selectedProjectId) || null
  const sourceLabel = selectedProject?.name || '全局资产'

  const loadProjects = useCallback(async () => {
    if (!accountKey) return
    try {
      const response = await apiFetch('/api/projects?page=1&pageSize=100')
      if (!response.ok) throw new Error(await readApiErrorMessage(response, '加载项目失败'))
      const payload = await response.json() as { projects?: ProjectItem[] }
      setProjects(Array.isArray(payload.projects) ? payload.projects : [])
    } catch (loadError) {
      logError('[FosAssetLibrary] 加载账号项目失败', loadError)
      setProjects([])
    }
  }, [accountKey])

  const loadAssets = useCallback(async () => {
    if (!accountKey) return
    setLoading(true)
    setError(null)
    try {
      const url = selectedProjectId
        ? `/api/assets?scope=project&projectId=${encodeURIComponent(selectedProjectId)}`
        : '/api/assets?scope=global'
      const materialParams = new URLSearchParams({
        projectId: selectedProjectId || 'global',
        limit: '500',
      })
      const [response, materialResponse] = await Promise.all([
        apiFetch(url),
        apiFetch(`/api/frameos/materials?${materialParams.toString()}`),
      ])
      if (!response.ok) throw new Error(await readApiErrorMessage(response, '加载资产失败'))
      if (!materialResponse.ok) throw new Error(await readApiErrorMessage(materialResponse, '加载分类素材失败'))
      const payload = await response.json() as { assets?: AssetSummary[] }
      const materialPayload = await materialResponse.json() as { materials?: FrameosMaterialItem[] }
      const mapped = (Array.isArray(payload.assets) ? payload.assets : [])
        .map((asset) => mapAsset(asset, sourceLabel))
        .filter((asset): asset is Asset => Boolean(asset))
      const materials = Array.isArray(materialPayload.materials) ? materialPayload.materials : []
      const merged = mergeBoundCharacterMaterials(mapped, materials)
      const classified = materials
        .map((material) => mapClassifiedMaterial(material, sourceLabel))
        .filter((asset): asset is Asset => Boolean(asset))
      setAssets([...merged, ...classified])
      const requestedLightboxId = params?.get('lightbox')
      if (requestedLightboxId) {
        setLightbox(mapped.find((asset) => asset.id === requestedLightboxId) || null)
      }
    } catch (loadError) {
      logError('[FosAssetLibrary] 加载账号资产失败', loadError)
      setAssets([])
      setError(loadError instanceof Error ? loadError.message : '加载资产失败')
    } finally {
      setLoading(false)
    }
  }, [accountKey, params, selectedProjectId, sourceLabel])

  useEffect(() => {
    void loadProjects()
  }, [loadProjects])

  useEffect(() => {
    void loadAssets()
  }, [loadAssets])

  useEffect(() => {
    setSelected(new Set())
    setLightbox(null)
  }, [category, selectedProjectId])

  const displayed = useMemo(
    () => assets.filter((asset) => asset.category === category),
    [assets, category],
  )
  const categoryPath = category === 'characters' ? 'characters' : category === 'items' ? 'items' : 'environments'
  const uploadCategory: FrameosAssetCategory = category === 'characters'
    ? 'character'
    : category === 'items'
      ? 'prop'
      : 'location'

  const toggle = (key: string) => setSelected((current) => {
    const next = new Set(current)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  })

  const selectSource = (projectId: string | null) => {
    setSelectedProjectId(projectId)
    setProjectMenuOpen(false)
  }

  return (
    <div className="fal-layout flex min-h-0 flex-1">
      <aside className="fal-tree flex w-[230px] min-h-0 flex-none flex-col overflow-y-auto border-r border-[var(--fos-border-soft)] p-3">
        <div className="mb-1 px-2 text-[12px] font-bold text-[var(--fos-text-4)]">账号资产</div>
        <TreeRow icon="folderOpen" label="全局资产" active={!selectedProjectId} caret onClick={() => selectSource(null)} />
        {(['characters', 'items', 'environments'] as AssetCategory[]).map((item) => (
          <TreeRow
            key={item}
            icon={item === 'characters' ? 'user' : item === 'items' ? 'package' : 'imageLandscape'}
            label={CATEGORY_LABELS[item]}
            depth={1}
            active={category === item}
            onClick={() => setCategory(item)}
          />
        ))}
        {projects.length > 0 ? <div className="mb-1 mt-4 px-2 text-[12px] font-bold text-[var(--fos-text-4)]">我的项目</div> : null}
        {projects.map((project) => (
          <TreeRow
            key={project.id}
            icon="folder"
            label={project.name}
            active={selectedProjectId === project.id}
            onClick={() => selectSource(project.id)}
          />
        ))}
      </aside>

      <main className="fal-main flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="fal-toolbar flex items-center gap-3 border-b border-[var(--fos-border-soft)] px-5 py-3">
          <div className="fal-source-picker relative">
            <button
              type="button"
              onClick={() => setProjectMenuOpen((open) => !open)}
              onBlur={() => window.setTimeout(() => setProjectMenuOpen(false), 150)}
              className="flex h-9 w-[220px] items-center justify-between rounded-[8px] border border-[var(--fos-border-strong)] bg-[var(--fos-bg-1)] px-3 text-[13px] text-white"
            >
              <span className="truncate">{sourceLabel}</span>
              <AppIcon name="chevronDown" className="h-3.5 w-3.5 text-[var(--fos-text-4)]" />
            </button>
            {projectMenuOpen ? (
              <div className="fos-menu left-0 mt-1 w-[220px]">
                <button type="button" className={`fos-menu-item${selectedProjectId ? '' : ' active'}`} onMouseDown={() => selectSource(null)}>全局资产</button>
                {projects.map((project) => (
                  <button
                    type="button"
                    key={project.id}
                    className={`fos-menu-item${selectedProjectId === project.id ? ' active' : ''}`}
                    onMouseDown={() => selectSource(project.id)}
                  >
                    {project.name}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <span className="fal-count text-[12px] text-[var(--fos-text-4)]">{CATEGORY_LABELS[category]} {displayed.length} 项</span>
          <div className="fal-toolbar-actions ml-auto flex items-center gap-2">
            {selectedProjectId ? <Link href={{ pathname: `/workflow/${selectedProjectId}/workbench-premium2/assets/${categoryPath}` }} className="fos-btn fos-btn-ghost fos-btn-sm"><AppIcon name="plus" className="h-3.5 w-3.5" />新增资产</Link> : null}
            <button type="button" className="fos-btn fos-btn-primary fos-btn-sm" disabled={!canEditAssets} title={canEditAssets ? `上传${CATEGORY_LABELS[category]}图片到${sourceLabel}` : '当前角色没有资产编辑权限'} onClick={() => setUploadOpen(true)}><AppIcon name="upload" className="h-3.5 w-3.5" />上传图片</button>
            <button type="button" onClick={() => void loadAssets()} className="fos-btn fos-btn-ghost fos-btn-sm" disabled={loading}>
              <AppIcon name="refresh" className={`h-3.5 w-3.5${loading ? ' animate-spin' : ''}`} />刷新
            </button>
            <button type="button" onClick={() => { setBatch((value) => !value); setSelected(new Set()) }} className="fos-btn fos-btn-primary fos-btn-sm">
              <AppIcon name="checkDot" className="h-3.5 w-3.5" />批量操作
            </button>
          </div>
        </div>

        {batch ? (
          <div className="fal-batch-toolbar flex items-center gap-3 border-b border-[var(--fos-border-soft)] bg-[var(--fos-primary-soft)] px-5 py-2.5">
            <span className="flex items-center gap-1 text-[13px] font-bold text-white"><span className="h-3 w-1 rounded bg-[var(--fos-primary)]" />已选 <span className="text-[var(--fos-primary)]">{selected.size}</span> 项</span>
            <div className="ml-auto flex items-center gap-2">
              <button type="button" className="fos-btn fos-btn-ghost fos-btn-sm" disabled={selected.size === 0}><AppIcon name="download" className="h-3.5 w-3.5" />下载</button>
              <button type="button" onClick={() => { setBatch(false); setSelected(new Set()) }} className="fos-btn fos-btn-ghost fos-btn-sm"><AppIcon name="close" className="h-3.5 w-3.5" />退出</button>
            </div>
          </div>
        ) : null}

        <div className="fal-content min-h-0 flex-1 overflow-y-auto p-5">
          {loading ? (
            <div className="fal-grid grid grid-cols-3 gap-4">
              {Array.from({ length: 6 }).map((_, index) => <div key={index} className="h-[160px] animate-pulse rounded-[12px] bg-[var(--fos-bg-2)]" />)}
            </div>
          ) : error ? (
            <div className="flex h-full min-h-[320px] flex-col items-center justify-center gap-3 text-center">
              <AppIcon name="infoCircle" className="h-8 w-8 text-red-300/70" />
              <div className="text-[14px] font-bold text-white">资产加载失败</div>
              <div className="max-w-[520px] text-[12px] text-[var(--fos-text-4)]">{error}</div>
              <button type="button" onClick={() => void loadAssets()} className="fos-btn fos-btn-primary fos-btn-sm">重试</button>
            </div>
          ) : displayed.length === 0 ? (
            <div className="flex h-full min-h-[320px] flex-col items-center justify-center gap-3 text-center">
              <AppIcon name={category === 'characters' ? 'user' : category === 'items' ? 'package' : 'imageLandscape'} className="h-9 w-9 text-white/15" />
              <div className="text-[14px] font-bold text-white">当前账号暂无{CATEGORY_LABELS[category]}资产</div>
              <div className="text-[12px] text-[var(--fos-text-4)]">可直接上传到当前分类；选择项目后也可新增可绑定变体与音色的完整资产。</div>
            </div>
          ) : (
            <div className="fal-grid grid grid-cols-3 gap-4">
              {displayed.map((asset) => (
                <AssetCard
                  key={asset.key}
                  asset={asset}
                  batch={batch}
                  checked={selected.has(asset.key)}
                  onToggle={() => toggle(asset.key)}
                  onOpen={() => setLightbox(asset)}
                />
              ))}
            </div>
          )}
        </div>
      </main>

      {lightbox ? <AssetLightbox asset={lightbox} onClose={() => setLightbox(null)} /> : null}
      {uploadOpen && canEditAssets ? (
        <MaterialUploadDialog
          projects={projects}
          initialProjectId={selectedProjectId}
          initialAssetCategory={uploadCategory}
          lockAssetCategory
          imageOnly
          onCreated={() => {
            setUploadOpen(false)
            void loadAssets()
          }}
          onClose={() => setUploadOpen(false)}
        />
      ) : null}
    </div>
  )
}

function AssetLightbox({ asset, onClose }: { asset: Asset; onClose: () => void }) {
  const previews = asset.imageUrls.length > 0 ? asset.imageUrls : Array.from({ length: asset.poses }, () => undefined)
  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-black/92" onClick={onClose}>
      <div className="relative flex items-center justify-center gap-3 py-3 text-[13px] font-bold text-white/80">
        <span>{asset.name}</span>
        <span className="text-[12px] font-normal text-white/40">{asset.sourceLabel}</span>
        {asset.voice?.bound ? <span className="rounded-md border border-violet-300/20 bg-violet-400/10 px-2 py-1 text-[10px] text-violet-100">{asset.voice.label}</span> : null}
        <button type="button" onClick={onClose} className="absolute right-5 top-2 flex h-9 w-9 items-center justify-center rounded-full bg-white/10 hover:bg-white/20"><AppIcon name="close" className="h-5 w-5" /></button>
      </div>
      {asset.voice?.bound ? <div className="mx-auto mb-3 flex w-[min(720px,calc(100vw-32px))] items-center gap-3 rounded-[10px] border border-violet-300/15 bg-violet-400/[.07] px-4 py-2.5"><AppIcon name="audioWave" className="h-4 w-4 shrink-0 text-violet-200" /><span className="shrink-0 text-[11px] font-bold text-violet-100">角色音色</span>{asset.voice.url ? <audio src={toDisplayImageUrl(asset.voice.url) || asset.voice.url} controls preload="metadata" className="h-8 min-w-0 flex-1" /> : <span className="text-[11px] text-white/45">已绑定平台音色，无独立试听文件</span>}</div> : null}
      <div className="flex min-h-0 flex-1 items-center justify-center px-10 pb-8" onClick={(event) => event.stopPropagation()}>
        <div className="grid h-full max-h-[72vh] w-full max-w-[1100px] overflow-hidden rounded-[8px]" style={{ gridTemplateColumns: `repeat(${Math.min(previews.length, 4)}, minmax(0, 1fr))` }}>
          {previews.slice(0, 4).map((imageUrl, index) => (
            <div key={`${imageUrl || 'placeholder'}:${index}`} className="min-w-0 border-r border-white/5 last:border-r-0">
              <AssetPreview kind={asset.category} imageUrl={imageUrl} />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
