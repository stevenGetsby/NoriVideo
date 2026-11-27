'use client'

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useSearchParams } from 'next/navigation'
import { useRouter } from '@/i18n/navigation'
import { Link } from '@/i18n/navigation'
import { AppIcon } from '@/components/ui/icons'
import { MediaImage } from '@/components/media/MediaImage'
import { apiFetch } from '@/lib/api-fetch'
import { readApiErrorMessage } from '@/lib/api/read-error-message'
import type { AssetSummary, VisualAssetSummary } from '@/lib/assets/contracts'
import { logError } from '@/lib/logging/core'
import { toCanvasDisplayImageUrl, toDisplayImageUrl, toPlayableAudioUrl } from '@/lib/media/image-url'
import { CharacterMaterialVoiceDialog } from '../materials/CharacterMaterialVoiceDialog'
import {
  materialSourceLabel,
  type FrameosMaterialItem,
} from '@/components/frameos/materials/contracts'
import {
  frameosAssetCategoryFromMetadata,
  frameosCharacterBindingFromMetadata,
  type FrameosAssetCategory,
} from '@/lib/frameos/material-category'
import { isInheritedMaterial, isUserManagedMaterial } from '@/lib/frameos/material-inherit'
import { hasAccountPermissions } from '@/lib/account/permissions'
import { MaterialUploadDialog } from './FosMaterialLibrary'
import { fetchAllFrameosMaterials } from '../materials/fetch-all-materials'
import { fetchAllProjectOptions } from '../works/fetch-all-projects'
import { ConfirmActionDialog, RenameDialog } from '../works/FosWorksDialogs'
import { notifyCanvasRevisions } from '@/lib/canvas/revision-broadcast'
import {
  describeCanvasSync,
  describeMaterialImageReplacement,
  renameFrameosMaterial,
  replaceFrameosMaterialImage,
  trashFrameosMaterials,
} from '../materials/material-actions'

type AssetCategory = 'characters' | 'items' | 'environments'
type RoleTag = '角色' | '道具' | '环境'

interface ProjectItem {
  id: string
  name: string
  workId: string
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
  /** Set for rows people manage themselves: uploads and copies inherited from another 作品. */
  uploadMaterialId?: string
  inherited?: boolean
  materialId?: string
  projectId?: string
  voice?: {
    bound: boolean
    label: string
    url: string | null
  }
}

const ROLE_COLORS: Record<RoleTag, string> = {
  '角色': '#e0a23a',
  '道具': '#3265ff',
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
  const inherited = isInheritedMaterial(material)
  if (material.type !== 'image' || (material.source !== 'toolbox' && material.source !== 'upload' && !inherited)) return null
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
    sourceLabel: `${sourceLabel} · ${materialSourceLabel(material)}`,
    imageUrls: imageUrl ? [imageUrl] : [],
    poses: 1,
    materialId: material.id,
    projectId: material.projectId,
    ...(materialCategory === 'character' ? { voice: {
      bound: Boolean(material.voice), label: material.voice ? '角色音色' : '未绑定音色', url: material.voice?.url || null,
    } } : {}),
    ...(isUserManagedMaterial(material) ? { uploadMaterialId: material.id } : {}),
    ...(inherited ? { inherited: true } : {}),
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
    // Structured character voice fields are authoritative. Old audio metadata
    // must not re-bind a voice visually after the user explicitly unlinked it.
    const voice = asset.voice
    return {
      ...asset,
      imageUrls,
      poses: Math.max(1, Math.min(4, imageUrls.length || asset.poses)),
      voice,
    }
  })
}

function AssetPreview({ kind, imageUrl, full = false }: { kind: AssetCategory; imageUrl?: string; full?: boolean }) {
  const src = full ? toDisplayImageUrl(imageUrl) : toCanvasDisplayImageUrl(imageUrl, 960)
  return (
    <div className="relative flex h-full w-full items-center justify-center overflow-hidden bg-[var(--fos-bg-3)]">
      {src ? (
        <MediaImage src={src} alt="" fill sizes="280px" style={{ objectFit: 'cover' }} />
      ) : (
        <AppIcon name={kind === 'characters' ? 'user' : kind === 'items' ? 'package' : 'imageLandscape'} className="h-7 w-7 text-white/12" />
      )}
    </div>
  )
}

function VoiceBadge({ bound }: { bound: boolean }) {
  return (
    <span className={`nori-voice-badge ${bound ? 'nori-voice-badge-bound' : 'nori-voice-badge-missing'}`}>
      <AppIcon name={bound ? 'audioWave' : 'infoCircle'} className="h-3 w-3" />
      {bound ? '有音色' : '缺音色'}
    </span>
  )
}

function AssetCard({
  asset,
  onOpen,
  onVoice,
  onReplace,
  replacing,
  replaceDisabled,
}: {
  asset: Asset
  onOpen: () => void
  onVoice?: () => void
  onReplace?: () => void
  replacing?: boolean
  replaceDisabled?: boolean
}) {
  const color = ROLE_COLORS[asset.role]
  return (
    <div className="overflow-hidden rounded-[12px] border border-[var(--fos-border-soft)] bg-[var(--fos-bg-2)] transition-colors hover:border-[var(--fos-border-mid)]">
      <div className="relative">
        <button
          type="button"
          onClick={onOpen}
          className="grid w-full"
          style={{ gridTemplateColumns: asset.poses > 1 ? `1.3fr repeat(${asset.poses - 1}, minmax(0, 1fr))` : 'minmax(0, 1fr)', aspectRatio: '16 / 7' }}
        >
          {Array.from({ length: asset.poses }).map((_, index) => (
            <div key={index} className="min-w-0 border-r border-black/30 last:border-r-0">
              <AssetPreview kind={asset.category} imageUrl={asset.imageUrls[index]} />
            </div>
          ))}
        </button>
        {asset.category === 'characters' ? <span className="fal-voice-badge"><VoiceBadge bound={Boolean(asset.voice?.bound)} /></span> : null}
      </div>
      <div className="flex min-h-[68px] flex-col justify-center gap-2 border-t border-[var(--fos-border-soft)] px-3 py-2.5">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <span className="min-w-0 truncate text-[13px] font-bold leading-5 text-white" title={asset.name}>{asset.name}</span>
          <span className="flex-none rounded-md px-2 py-0.5 text-[11px] font-bold leading-4" style={{ background: `${color}26`, color }}>{asset.role}</span>
        </div>
        <div className="flex min-w-0 items-center gap-2 text-[11px] leading-4 text-[var(--fos-text-4)]"><span className="min-w-0 flex-1 truncate">{asset.sourceLabel}</span></div>
        {onVoice || onReplace ? <div className="mt-1 flex flex-wrap items-center gap-2 pr-9">
          {onVoice ? <button type="button" className="fos-btn fos-btn-soft fos-btn-sm" onClick={(event) => { event.stopPropagation(); onVoice() }}><AppIcon name="audioWave" className="h-3.5 w-3.5" />{asset.voice?.bound ? '管理角色音色' : '设置角色音色'}</button> : null}
          {onReplace ? <button type="button" className="fos-btn fos-btn-soft fos-btn-sm" aria-label={`替换图片 ${asset.name}`} title="只更换图片，名称、分类和已绑定的角色音色保持不变" disabled={replaceDisabled || replacing} onClick={(event) => { event.stopPropagation(); onReplace() }}><AppIcon name="upload" className="h-3.5 w-3.5" />{replacing ? '替换中…' : '替换图片'}</button> : null}
        </div> : null}
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
  path,
}: {
  icon?: string
  label: string
  active?: boolean
  depth?: number
  caret?: boolean
  onClick?: () => void
  path?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={path || label}
      aria-current={active ? 'page' : undefined}
      title={path || label}
      className="flex w-full items-center gap-2 rounded-[8px] py-2 pr-3 text-left text-[13px]"
      style={{ paddingLeft: 12 + depth * 16, background: active ? 'var(--fos-primary-soft)' : 'transparent', color: active ? 'var(--fos-primary-text)' : 'var(--fos-text-2)', fontWeight: active ? 700 : 500 }}
    >
      {caret ? <AppIcon name="chevronDown" className="h-3 w-3 shrink-0 text-[var(--fos-text-4)]" /> : <span className="w-3 shrink-0" />}
      {icon ? <AppIcon name={icon as never} className="h-4 w-4 shrink-0" /> : null}
      <span className="min-w-0 truncate">{label}</span>
    </button>
  )
}

export function FosAssetLibrary() {
  const { data: session } = useSession()
  const router = useRouter()
  const params = useSearchParams()
  const [category, setCategory] = useState<AssetCategory>('characters')
  const [lightbox, setLightbox] = useState<Asset | null>(null)
  const [projects, setProjects] = useState<ProjectItem[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [assets, setAssets] = useState<Asset[]>([])
  const [loadedScope, setLoadedScope] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [warning, setWarning] = useState<string | null>(null)
  const [deletingMaterialId, setDeletingMaterialId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Asset | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [selectedAssetKeys, setSelectedAssetKeys] = useState<string[]>([])
  const [batchDeleteTarget, setBatchDeleteTarget] = useState<string[]>([])
  const [batchDeleting, setBatchDeleting] = useState(false)
  const [voiceTarget, setVoiceTarget] = useState<Asset | null>(null)
  const [missingVoiceOnly, setMissingVoiceOnly] = useState(false)
  const [renameTarget, setRenameTarget] = useState<Asset | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [replacingMaterialId, setReplacingMaterialId] = useState<string | null>(null)
  const [replaceNotice, setReplaceNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)
  const replaceInput = useRef<HTMLInputElement | null>(null)
  const replaceTarget = useRef<Asset | null>(null)
  const mutationBusy = useRef(false)
  const assetSequence = useRef(0)
  const assetAbort = useRef<AbortController | null>(null)
  const projectSequence = useRef(0)
  const uploadedCategory = useRef<FrameosAssetCategory | null>(null)
  const uploadedProjectId = useRef<string | null>(null)
  const accountKey = session?.user?.name || session?.user?.email || (TEST_MODE ? 'test-mode' : '')
  const canEditAssets = hasAccountPermissions(
    { role: session?.user?.role, permissions: session?.user?.permissions },
    ['assetWrite'],
  )

  const voiceHandlerFor = (asset: Asset): (() => void) | undefined => {
    if (asset.category !== 'characters' || !canEditAssets) return undefined
    if (asset.materialId) return () => setVoiceTarget(asset)
    if (selectedProjectId) return () => router.push({ pathname: `/workflow/${selectedProjectId}/workbench-premium2/assets/timbre`, query: { characterId: asset.id } })
    return () => setVoiceTarget(asset)
  }

  const selectedProject = projects.find((project) => project.id === selectedProjectId) || null
  const sourceLabel = selectedProjectId === 'personal'
    ? '个人素材'
    : selectedProject?.name || '全局资产'
  const requestedLightboxId = params?.get('lightbox') || ''
  const scopeKey = `${accountKey}:${selectedProjectId || 'global'}:${category}:${sourceLabel}`
  const currentScope = useRef(scopeKey)
  currentScope.current = scopeKey

  const loadProjects = useCallback(async () => {
    if (!accountKey) return
    const sequence = ++projectSequence.current
    try {
      const projects = await fetchAllProjectOptions()
      if (sequence === projectSequence.current) setProjects(projects)
    } catch (loadError) {
      if (sequence !== projectSequence.current) return
      logError('[FosAssetLibrary] 加载账号作品失败', loadError)
      setProjects([])
    }
  }, [accountKey])

  const loadAssets = useCallback(async () => {
    if (!accountKey) return
    const sequence = ++assetSequence.current
    assetAbort.current?.abort()
    const controller = new AbortController()
    assetAbort.current = controller
    setLoading(true)
    setError(null)
    setWarning(null)
    try {
      const url = selectedProjectId === 'personal'
        ? null
        : selectedProjectId
          ? `/api/assets?scope=project&projectId=${encodeURIComponent(selectedProjectId)}`
          : '/api/assets?scope=global'
      const kind = category === 'characters' ? 'character' : category === 'items' ? 'prop' : 'location'
      const materialParams = selectedProjectId === 'personal'
        ? new URLSearchParams({ scope: 'personal', type: 'image', limit: '500' })
        : new URLSearchParams({
            projectId: selectedProjectId || 'global',
            type: 'image',
            limit: '500',
          })
      const fetchJson = async <T,>(endpoint: string, fallback: string): Promise<T> => {
        const response = await apiFetch(endpoint, { cache: 'no-store', signal: controller.signal })
        if (!response.ok) throw new Error(await readApiErrorMessage(response, fallback))
        return await response.json() as T
      }
      const [assetResult, materialResult] = await Promise.allSettled([
        url ? fetchJson<{ assets?: AssetSummary[] }>(`${url}&kind=${kind}`, '加载结构化资产失败') : Promise.resolve({}),
        fetchAllFrameosMaterials(materialParams, controller.signal),
      ])
      if (sequence !== assetSequence.current || currentScope.current !== scopeKey || controller.signal.aborted) return
      if (assetResult.status === 'rejected' && materialResult.status === 'rejected') throw assetResult.reason
      const payload: { assets?: AssetSummary[] } = assetResult.status === 'fulfilled' ? assetResult.value : {}
      const failed = [assetResult, materialResult].find((result) => result.status === 'rejected')
      if (failed?.status === 'rejected') setWarning(`部分资产未加载：${failed.reason instanceof Error ? failed.reason.message : '请刷新重试'}。其他素材及目录仍可使用。`)
      const mapped = (Array.isArray(payload.assets) ? payload.assets : [])
        .map((asset: AssetSummary) => mapAsset(asset, sourceLabel))
        .filter((asset): asset is Asset => Boolean(asset))
      const materials = materialResult.status === 'fulfilled' ? materialResult.value : []
      const merged = mergeBoundCharacterMaterials(mapped, materials)
      const classified = materials
        .map((material) => mapClassifiedMaterial(material, sourceLabel))
        .filter((asset): asset is Asset => Boolean(asset))
      setAssets([...merged, ...classified])
      setLoadedScope(scopeKey)
      if (requestedLightboxId) {
        setLightbox([...merged, ...classified].find((asset) => asset.id === requestedLightboxId) || null)
      }
    } catch (loadError) {
      if (sequence !== assetSequence.current || controller.signal.aborted || currentScope.current !== scopeKey) return
      logError('[FosAssetLibrary] 加载账号资产失败', loadError)
      setAssets([])
      setLoadedScope(scopeKey)
      setError(loadError instanceof Error ? loadError.message : '加载资产失败')
    } finally {
      if (sequence === assetSequence.current && currentScope.current === scopeKey) setLoading(false)
    }
  }, [accountKey, category, requestedLightboxId, scopeKey, selectedProjectId, sourceLabel])

  useEffect(() => {
    void loadProjects()
    return () => { projectSequence.current += 1 }
  }, [loadProjects])

  useEffect(() => {
    setAssets([])
    void loadAssets()
    return () => { assetSequence.current += 1; assetAbort.current?.abort() }
  }, [loadAssets])

  useEffect(() => {
    setLightbox(null)
    setSelectedAssetKeys([])
    setRenameTarget(null)
    setMissingVoiceOnly(false)
    setReplaceNotice(null)
  }, [category, selectedProjectId])

  const displayed = useMemo(
    () => loadedScope === scopeKey ? assets.filter((asset) => asset.category === category) : [],
    [assets, category, loadedScope, scopeKey],
  )
  const voiceBoundCount = useMemo(
    () => category === 'characters' ? displayed.filter((asset) => asset.voice?.bound).length : 0,
    [category, displayed],
  )
  const voiceMissingCount = category === 'characters' ? displayed.length - voiceBoundCount : 0
  const allCharactersVoiced = missingVoiceOnly && displayed.length > 0
  const visibleAssets = useMemo(
    () => category === 'characters' && missingVoiceOnly
      ? displayed.filter((asset) => !asset.voice?.bound)
      : displayed,
    [category, displayed, missingVoiceOnly],
  )
  const showingLoading = loading || loadedScope !== scopeKey
  const deletableAssets = visibleAssets.filter((asset) => Boolean(asset.uploadMaterialId))
  const selectedMaterialIds = deletableAssets
    .filter((asset) => selectedAssetKeys.includes(asset.key))
    .map((asset) => asset.uploadMaterialId!)
  const allDeletableSelected = deletableAssets.length > 0 && selectedMaterialIds.length === deletableAssets.length
  const deletableIncludesInherited = deletableAssets.some((asset) => asset.inherited)
  const batchIncludesInherited = batchDeleteTarget.length > 0
    && assets.some((asset) => asset.inherited && asset.uploadMaterialId && batchDeleteTarget.includes(asset.uploadMaterialId))
  const categoryPath = category === 'characters' ? 'characters' : category === 'items' ? 'items' : 'environments'
  const uploadCategory: FrameosAssetCategory = category === 'characters'
    ? 'character'
    : category === 'items'
      ? 'prop'
      : 'location'

  const selectSource = (projectId: string | null) => {
    setSelectedProjectId(projectId)
  }
  const deleteUploadedMaterial = async (materialId: string) => {
    if (!canEditAssets || deletingMaterialId) return
    setDeletingMaterialId(materialId)
    setDeleteError(null)
    try {
      const response = await apiFetch(`/api/frameos/materials/${encodeURIComponent(materialId)}`, { method: 'DELETE' })
      if (!response.ok) throw new Error(await readApiErrorMessage(response, '删除上传素材失败'))
      setDeleteTarget(null)
      await loadAssets()
    } catch (deleteError) {
      const message = deleteError instanceof Error ? deleteError.message : '删除上传素材失败'
      setDeleteError(message)
      throw new Error(message)
    } finally {
      setDeletingMaterialId(null)
    }
  }
  const deleteSelectedAssets = async () => {
    if (!canEditAssets || mutationBusy.current || batchDeleteTarget.length === 0) return
    mutationBusy.current = true
    setBatchDeleting(true)
    try {
      const result = await trashFrameosMaterials(batchDeleteTarget)
      const deleted = new Set(result.deletedIds)
      const keptKeys = new Set(assets
        .filter((asset) => !asset.uploadMaterialId || !deleted.has(asset.uploadMaterialId))
        .map((asset) => asset.key))
      setAssets((current) => current.filter((asset) => !asset.uploadMaterialId || !deleted.has(asset.uploadMaterialId)))
      setSelectedAssetKeys((current) => current.filter((key) => keptKeys.has(key)))
      setBatchDeleteTarget([])
      if (result.skipped.length > 0) {
        setWarning(`已删除 ${deleted.size} 个资产，保留 ${result.skipped.length} 个：${result.skipped.map((item) => item.reason || '暂不可删除').join('；')}`)
      } else {
        setWarning(`已将 ${deleted.size} 个${batchIncludesInherited ? '上传或继承的' : '上传'}资产移入回收站。`)
      }
      assetSequence.current++
      assetAbort.current?.abort()
      setLoading(false)
    } finally {
      mutationBusy.current = false
      setBatchDeleting(false)
    }
  }
  const renameAsset = async (title: string) => {
    if (!canEditAssets || !renameTarget?.materialId || mutationBusy.current) return
    mutationBusy.current = true
    setRenaming(true)
    try {
      const updated = await renameFrameosMaterial(renameTarget.materialId, title)
      assetSequence.current++
      assetAbort.current?.abort()
      setLoading(false)
      setAssets((current) => current.map((asset) => asset.materialId === updated.id ? { ...asset, name: updated.title! } : asset))
      setLightbox((current) => current?.materialId === updated.id ? { ...current, name: updated.title! } : current)
      setRenameTarget(null)
      const syncNotice = describeCanvasSync(updated.canvasSync)
      if (syncNotice) setReplaceNotice({ tone: 'success', text: syncNotice })
      notifyCanvasRevisions(session?.user?.id || '', updated.canvasSync?.canvases)
    } finally {
      mutationBusy.current = false
      setRenaming(false)
    }
  }
  const startReplaceImage = (asset: Asset) => {
    const input = replaceInput.current
    if (!canEditAssets || !asset.uploadMaterialId || mutationBusy.current || !input) return
    replaceTarget.current = asset
    setReplaceNotice(null)
    input.value = ''
    input.click()
  }
  const replaceAssetImage = async (file: File) => {
    const target = replaceTarget.current
    replaceTarget.current = null
    if (!canEditAssets || !target?.uploadMaterialId || mutationBusy.current) return
    mutationBusy.current = true
    setReplacingMaterialId(target.uploadMaterialId)
    setReplaceNotice(null)
    try {
      const result = await replaceFrameosMaterialImage(target.uploadMaterialId, file)
      setLightbox(null)
      setSelectedAssetKeys((current) => current.filter((key) => key !== target.key))
      setReplaceNotice({ tone: 'success', text: describeMaterialImageReplacement(target.name, result) })
      await loadAssets()
    } catch (replaceError) {
      logError('[FosAssetLibrary] 替换资产图片失败', replaceError)
      setReplaceNotice({ tone: 'error', text: replaceError instanceof Error ? replaceError.message : '替换图片失败，请重试。' })
    } finally {
      mutationBusy.current = false
      setReplacingMaterialId(null)
    }
  }
  const replaceDisabled = mutationBusy.current || Boolean(deletingMaterialId)

  return (
    <div className="fal-layout flex min-h-0 flex-1">
      <input
        ref={replaceInput}
        type="file"
        accept="image/*"
        hidden
        aria-label="选择替换图片"
        onChange={(event) => {
          const file = event.target.files?.[0] || null
          event.target.value = ''
          if (file) void replaceAssetImage(file)
          else replaceTarget.current = null
        }}
      />
      <aside className="fal-tree flex w-[230px] min-h-0 flex-none flex-col overflow-y-auto border-r border-[var(--fos-border-soft)] p-3">
        <div className="mb-1 px-2 text-[12px] font-bold text-[var(--fos-text-4)]">账号资产</div>
        <TreeRow icon="folderOpen" label="全局资产" active={!selectedProjectId} caret onClick={() => selectSource(null)} />
        {(['characters', 'items', 'environments'] as AssetCategory[]).map((item) => (
          <TreeRow
            key={item}
            icon={item === 'characters' ? 'user' : item === 'items' ? 'package' : 'imageLandscape'}
            label={CATEGORY_LABELS[item]}
            depth={1}
            path={`全局资产/${CATEGORY_LABELS[item]}`}
            active={!selectedProjectId && category === item}
            onClick={() => { selectSource(null); setCategory(item) }}
          />
        ))}
        {(['characters', 'items', 'environments'] as AssetCategory[]).map((item) => (
          <TreeRow
            key={`personal:${item}`}
            icon={item === 'characters' ? 'user' : item === 'items' ? 'package' : 'imageLandscape'}
            label={item === 'characters' ? '个人素材 · 角色' : `个人素材 · ${CATEGORY_LABELS[item]}`}
            depth={1}
            path={`个人素材/${CATEGORY_LABELS[item]}`}
            active={selectedProjectId === 'personal' && category === item}
            onClick={() => { selectSource('personal'); setCategory(item) }}
          />
        ))}
        {projects.length > 0 ? <div className="mb-1 mt-4 px-2 text-[12px] font-bold text-[var(--fos-text-4)]">我的作品</div> : null}
        {projects.map((project) => (<Fragment key={project.id}>
          <TreeRow
            icon="folder"
            label={project.name}
            active={selectedProjectId === project.id}
            caret={selectedProjectId === project.id}
            onClick={() => selectSource(project.id)}
          />
          {selectedProjectId === project.id ? (['characters', 'items', 'environments'] as AssetCategory[]).map((item) => <TreeRow
            key={item}
            icon={item === 'characters' ? 'user' : item === 'items' ? 'package' : 'imageLandscape'}
            label={CATEGORY_LABELS[item]}
            path={`${project.name}/${CATEGORY_LABELS[item]}`}
            depth={1}
            active={category === item}
            onClick={() => { selectSource(project.id); setCategory(item) }}
          />) : null}
        </Fragment>))}
      </aside>

      <main className="fal-main flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="fal-toolbar flex items-center gap-3 border-b border-[var(--fos-border-soft)] px-5 py-3">
          <div className="fal-source-picker relative">
            <select aria-label="资产来源作品" className="fos-input" value={selectedProjectId || 'global'} onChange={(event) => selectSource(event.target.value === 'global' ? null : event.target.value)}>
              <option value="global">全局资产</option>
              <option value="personal">个人素材</option>
              {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
          </div>
          <span className="fal-count text-[12px] text-[var(--fos-text-4)]">{CATEGORY_LABELS[category]} {displayed.length} 项</span>
          {category === 'characters' ? <>
            <span className="fal-count text-[12px] text-[var(--fos-text-4)]">音色 {voiceBoundCount}/{displayed.length}</span>
            <button
              type="button"
              aria-pressed={missingVoiceOnly}
              className={`fos-btn fos-btn-sm ${missingVoiceOnly ? 'fos-btn-primary' : 'fos-btn-ghost'}`}
              onClick={() => setMissingVoiceOnly((current) => !current)}
            >只看缺音色{voiceMissingCount > 0 ? ` (${voiceMissingCount})` : ''}</button>
          </> : null}
          <div className="fal-toolbar-actions ml-auto flex items-center gap-2">
            {canEditAssets ? <>
              <button type="button" className="fos-btn fos-btn-ghost fos-btn-sm" disabled={showingLoading || deletableAssets.length === 0 || mutationBusy.current} onClick={() => setSelectedAssetKeys(allDeletableSelected ? [] : deletableAssets.map((asset) => asset.key))}>{allDeletableSelected ? '取消全选' : deletableIncludesInherited ? '全选上传与继承资产' : '全选上传资产'}</button>
              <button type="button" className="fos-btn fos-btn-danger fos-btn-sm" disabled={showingLoading || selectedMaterialIds.length === 0 || selectedMaterialIds.length > 200 || mutationBusy.current} title={deletableIncludesInherited ? '仅删除当前目录勾选的上传或继承资产；每批最多 200 个' : '仅删除当前目录勾选的上传资产；每批最多 200 个'} onClick={() => setBatchDeleteTarget(selectedMaterialIds)}><AppIcon name="trash" className="h-3.5 w-3.5" />批量删除{selectedMaterialIds.length > 0 ? ` (${selectedMaterialIds.length})` : ''}</button>
            </> : null}
            {selectedProjectId ? <Link href={{ pathname: `/workflow/${selectedProjectId}/workbench-premium2/assets/${categoryPath}` }} className="fos-btn fos-btn-ghost fos-btn-sm"><AppIcon name="plus" className="h-3.5 w-3.5" />新增资产</Link> : null}
            <button type="button" className="fos-btn fos-btn-primary fos-btn-sm" disabled={!canEditAssets} title={canEditAssets ? `批量上传图片到 ${sourceLabel}/${CATEGORY_LABELS[category]}` : '当前角色没有资产编辑权限'} onClick={() => { uploadedCategory.current = null; setUploadOpen(true) }}><AppIcon name="upload" className="h-3.5 w-3.5" />批量上传图片</button>
            <button type="button" onClick={() => void loadAssets()} className="fos-btn fos-btn-ghost fos-btn-sm" disabled={loading}>
              <AppIcon name="refresh" className={`h-3.5 w-3.5${loading ? ' animate-spin' : ''}`} />刷新
            </button>
          </div>
        </div>

        <div className="flex items-center gap-1.5 border-b border-[var(--fos-border-soft)] px-5 py-1.5 text-[11px] text-[var(--fos-text-4)]">
          <AppIcon name="infoCircle" className="h-3.5 w-3.5 flex-none" />
          <span>资产库按角色 / 场景 / 道具聚合设定并绑定音色；原始图片、视频和音频文件在<Link href="/material" className="mx-1 font-bold text-white hover:underline">素材库</Link>。</span>
        </div>

        <div className="fal-content min-h-0 flex-1 overflow-y-auto p-5">
          {replaceNotice ? (
            <div
              role={replaceNotice.tone === 'error' ? 'alert' : 'status'}
              className={`mb-3 flex items-start gap-2 rounded-lg border p-3 text-[12px] ${replaceNotice.tone === 'error' ? 'border-red-400/25 bg-red-500/10 text-red-100' : 'border-emerald-400/25 bg-emerald-500/10 text-emerald-100'}`}
            >
              <span className="min-w-0 flex-1">{replaceNotice.text}</span>
              <button type="button" aria-label="关闭提示" className="shrink-0 text-white/60 hover:text-white" onClick={() => setReplaceNotice(null)}><AppIcon name="close" className="h-3.5 w-3.5" /></button>
            </div>
          ) : null}
          {warning && loadedScope === scopeKey ? <div role="status" className="mb-3 rounded-lg border border-amber-400/25 bg-amber-500/10 p-3 text-[12px] text-amber-100">{warning}</div> : null}
          {showingLoading ? (
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
          ) : visibleAssets.length === 0 ? (
            <div className="flex h-full min-h-[320px] flex-col items-center justify-center gap-3 text-center">
              <AppIcon name={allCharactersVoiced ? 'badgeCheck' : category === 'characters' ? 'user' : category === 'items' ? 'package' : 'imageLandscape'} className="h-9 w-9 text-white/15" />
              <div className="text-[14px] font-bold text-white">{allCharactersVoiced ? '当前角色都已绑定音色' : `当前账号暂无${CATEGORY_LABELS[category]}资产`}</div>
              <div className="text-[12px] text-[var(--fos-text-4)]">{allCharactersVoiced ? '可以关闭「只看缺音色」查看全部角色，或继续完善现有音色。' : '可直接上传到当前分类；选择作品后也可新增可绑定变体与音色的完整资产。'}</div>
            </div>
          ) : (
            <div className="fal-grid grid grid-cols-3 gap-4">
              {visibleAssets.map((asset) => (
                <div key={asset.key} className="fal-asset-card relative">
                <AssetCard
                  key={asset.key}
                  asset={asset}
                  onOpen={() => setLightbox(asset)}
                  onVoice={voiceHandlerFor(asset)}
                  onReplace={asset.uploadMaterialId && canEditAssets ? () => startReplaceImage(asset) : undefined}
                  replacing={Boolean(asset.uploadMaterialId) && replacingMaterialId === asset.uploadMaterialId}
                  replaceDisabled={replaceDisabled}
                />
                {asset.uploadMaterialId && canEditAssets ? <input
                  type="checkbox"
                  aria-label={`选择资产 ${asset.name}`}
                  checked={selectedAssetKeys.includes(asset.key)}
                  disabled={mutationBusy.current}
                  className="fal-card-select"
                  onChange={(event) => setSelectedAssetKeys((current) => event.target.checked ? [...current, asset.key] : current.filter((key) => key !== asset.key))}
                /> : null}
                {asset.materialId && canEditAssets ? <button type="button" aria-label={`重命名资产 ${asset.name}`} title="修改资产名称" className="fal-card-rename text-[var(--fos-text-3)] hover:text-white" disabled={mutationBusy.current} onClick={() => setRenameTarget(asset)}><AppIcon name="edit" className="h-4 w-4" /></button> : null}
                {asset.uploadMaterialId && canEditAssets ? <button
                  type="button"
                  aria-label={`${asset.inherited ? '删除继承资产' : '删除上传资产'} ${asset.name}`}
                  title={asset.inherited ? '删除继承资产' : '删除上传资产'}
                  className="absolute right-2 top-2 z-10 rounded-md bg-black/75 px-2 py-1 text-[10px] font-semibold text-red-200 hover:bg-red-500/80"
                  disabled={Boolean(deletingMaterialId)}
                  onClick={() => { setDeleteError(null); setDeleteTarget(asset) }}
                >{deletingMaterialId === asset.id ? '删除中…' : '删除'}</button> : null}
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

      {lightbox ? <AssetLightbox
        asset={lightbox}
        onClose={() => setLightbox(null)}
        onVoice={(() => { const open = voiceHandlerFor(lightbox); return open ? () => { setLightbox(null); open() } : undefined })()}
        onReplace={lightbox.uploadMaterialId && canEditAssets ? () => startReplaceImage(lightbox) : undefined}
        replacing={Boolean(lightbox.uploadMaterialId) && replacingMaterialId === lightbox.uploadMaterialId}
        replaceDisabled={replaceDisabled}
      /> : null}
      {voiceTarget && canEditAssets ? <CharacterMaterialVoiceDialog material={{ id: voiceTarget.materialId || voiceTarget.id, name: voiceTarget.name, projectId: voiceTarget.projectId || selectedProjectId || 'global', voiceUrl: voiceTarget.voice?.url, globalCharacter: !voiceTarget.materialId }} onSaved={() => { void loadAssets() }} onClose={() => setVoiceTarget(null)} /> : null}
      {renameTarget?.materialId && canEditAssets ? <RenameDialog kind="素材" initialName={renameTarget.name} busy={renaming} onClose={() => { if (!mutationBusy.current) setRenameTarget(null) }} onSave={renameAsset} /> : null}
      {batchDeleteTarget.length > 0 && canEditAssets ? <ConfirmActionDialog
        title={batchIncludesInherited ? '批量删除上传与继承资产' : '批量删除上传资产'}
        description={`确定将当前目录勾选的 ${batchDeleteTarget.length} 个${batchIncludesInherited ? '上传或继承的' : '上传'}资产移入回收站吗？可删除的资产会正常处理；仍被画布或角色音色引用的资产会保留，并显示逐项原因。`}
        confirmLabel="确认批量删除"
        danger
        busy={batchDeleting}
        onClose={() => { if (!mutationBusy.current) setBatchDeleteTarget([]) }}
        onConfirm={deleteSelectedAssets}
      /> : null}
      {deleteTarget?.uploadMaterialId && canEditAssets ? <ConfirmActionDialog
        title={deleteTarget.inherited ? '删除继承资产' : '删除上传资产'}
        description={`确定删除「${deleteTarget.name}」吗？素材将移入回收站，不直接删除存储文件。仍被画布引用时会拒绝操作。${deleteError ? ` ${deleteError}` : ''}`}
        confirmLabel="确认删除"
        danger
        busy={Boolean(deletingMaterialId)}
        onClose={() => { setDeleteTarget(null); setDeleteError(null) }}
        onConfirm={() => deleteUploadedMaterial(deleteTarget.uploadMaterialId!)}
      /> : null}
      {uploadOpen && canEditAssets ? (
        <MaterialUploadDialog
          key={`${selectedProjectId || 'global'}:${uploadCategory}`}
          projects={projects}
          initialProjectId={selectedProjectId}
          initialAssetCategory={uploadCategory}
          assetCategoryOptions={['character', 'location', 'prop']}
          imageOnly
          onCreated={(material) => {
            uploadedCategory.current = frameosAssetCategoryFromMetadata(material.metadata)
            uploadedProjectId.current = material.projectId
            const asset = mapClassifiedMaterial(material, sourceLabel)
            if (asset?.category === category && material.projectId === selectedProjectId) {
              setAssets((current) => [asset, ...current.filter((item) => item.key !== asset.key)])
            }
          }}
          onClose={() => {
            setUploadOpen(false)
            const next = uploadedCategory.current
            if (next === 'character' || next === 'location' || next === 'prop') {
              setCategory(next === 'character' ? 'characters' : next === 'prop' ? 'items' : 'environments')
            }
            if (uploadedProjectId.current) setSelectedProjectId(uploadedProjectId.current)
            void loadAssets()
          }}
        />
      ) : null}
    </div>
  )
}

function AssetLightbox({ asset, onClose, onVoice, onReplace, replacing, replaceDisabled }: {
  asset: Asset
  onClose: () => void
  onVoice?: () => void
  onReplace?: () => void
  replacing?: boolean
  replaceDisabled?: boolean
}) {
  const previews = asset.imageUrls.length > 0 ? asset.imageUrls : Array.from({ length: asset.poses }, () => undefined)
  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-black/92" onClick={onClose}>
      <div className="relative flex items-center justify-center gap-3 py-3 text-[13px] font-bold text-white/80">
        <span>{asset.name}</span>
        <span className="text-[12px] font-normal text-white/40">{asset.sourceLabel}</span>
        {asset.voice?.bound ? <span className="rounded-md border border-violet-300/20 bg-violet-400/10 px-2 py-1 text-[10px] text-violet-100">{asset.voice.label}</span> : null}
        {onReplace ? <button type="button" className="fos-btn fos-btn-soft fos-btn-sm" aria-label={`在预览中替换图片 ${asset.name}`} disabled={replaceDisabled || replacing} onClick={(event) => { event.stopPropagation(); onReplace() }}><AppIcon name="upload" className="h-3.5 w-3.5" />{replacing ? '替换中…' : '替换图片'}</button> : null}
        <button type="button" onClick={onClose} className="absolute right-5 top-2 flex h-9 w-9 items-center justify-center rounded-full bg-white/10 hover:bg-white/20"><AppIcon name="close" className="h-5 w-5" /></button>
      </div>
      {asset.voice?.bound || onVoice ? <div className="mx-auto mb-3 flex w-[min(720px,calc(100vw-32px))] items-center gap-3 rounded-[10px] border border-violet-300/15 bg-violet-400/[.07] px-4 py-2.5" onClick={(event) => event.stopPropagation()}><AppIcon name="audioWave" className="h-4 w-4 shrink-0 text-violet-200" /><span className="shrink-0 text-[11px] font-bold text-violet-100">角色音色</span>{asset.voice?.bound ? asset.voice.url ? <audio src={toPlayableAudioUrl(asset.voice.url) || asset.voice.url} controls preload="metadata" className="h-8 min-w-0 flex-1" /> : <span className="min-w-0 flex-1 text-[11px] text-white/45">已绑定平台音色，无独立试听文件</span> : <span className="min-w-0 flex-1 text-[11px] text-white/45">尚未绑定音色</span>}{onVoice ? <button type="button" className="fos-btn fos-btn-soft fos-btn-sm shrink-0" onClick={onVoice}>{asset.voice?.bound ? '更换音色' : '设置音色'}</button> : null}</div> : null}
      <div className="flex min-h-0 flex-1 items-center justify-center px-10 pb-8" onClick={(event) => event.stopPropagation()}>
        <div className="grid h-full max-h-[72vh] w-full max-w-[1100px] overflow-hidden rounded-[8px]" style={{ gridTemplateColumns: `repeat(${Math.min(previews.length, 4)}, minmax(0, 1fr))` }}>
          {previews.slice(0, 4).map((imageUrl, index) => (
            <div key={`${imageUrl || 'placeholder'}:${index}`} className="min-w-0 border-r border-white/5 last:border-r-0">
              <AssetPreview kind={asset.category} imageUrl={imageUrl} full />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
