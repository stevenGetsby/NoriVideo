'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSession } from 'next-auth/react'
import { AppIcon } from '@/components/ui/icons'
import { MediaImage } from '@/components/media/MediaImage'
import { apiFetch } from '@/lib/api-fetch'
import { readApiErrorMessage } from '@/lib/api/read-error-message'
import { hasAccountPermissions } from '@/lib/account/permissions'
import { logError } from '@/lib/logging/core'
import { toDisplayImageUrl } from '@/lib/media/image-url'
import {
  useTaskTargetStateMap,
  type TaskTargetState,
} from '@/lib/query/hooks/useTaskTargetStateMap'
import {
  extractSeedanceVideoPromptBody,
  formatSeedancePromptForEditor,
  type SeedancePromptAsset,
} from '@/lib/novel-promotion/seedance-prompt-assets'
import { selectStoryboardCharacterAppearance } from '@/lib/novel-promotion/storyboard-character-appearance'
import type { FosEpisode, FosProjectData, FosAsset } from '../useFosProject'
import { MaterialPickerDialog } from '../materials/MaterialPickerDialog'
import { MentionPromptEditor } from '../materials/MentionPromptEditor'
import type { FrameosMaterialItem } from '../materials/contracts'
import type { CollaborationAssignment } from '../assignments-view-model'

type StoryAssetKind = '角色' | '物品' | '环境'
type SegIntent = 'establish' | 'conflict' | 'emotion' | 'reverse'

interface StoryAssetRef {
  materialId?: string | null
  kind: StoryAssetKind
  name: string
  promptName?: string
  imageUrl?: string | null
}

interface StorySegment {
  id: string
  panelId?: string
  panelIndex: number
  location?: string | null
  intent: SegIntent
  intentLabel: string
  duration: number | null
  scriptHeading: string
  scriptText: string
  refs: StoryAssetRef[]
  shotType?: string | null
  cameraMove?: string | null
  imagePrompt?: string | null
  videoPrompt?: string | null
  imageUrl?: string | null
  freeform: boolean
}

interface StoryScene {
  code: string
  storyboardId: string
  location: string
  env: string
  segments: StorySegment[]
}

interface StoryboardEpisode {
  episodeNumber: number
  sceneCount: number
  segmentCount: number
  totalSeconds: number | null
  scenes: StoryScene[]
  source: 'live'
}

interface StoryboardPanelRaw {
  id?: string
  panelIndex?: number
  panelNumber?: number | null
  shotType?: string | null
  cameraMove?: string | null
  description?: string | null
  location?: string | null
  characters?: string | null
  props?: string | null
  srtSegment?: string | null
  duration?: number | null
  imagePrompt?: string | null
  videoPrompt?: string | null
  sceneType?: string | null
  imageUrl?: string | null
  assetBindings?: Array<{ materialId?: string | null; kind?: string; name?: string; appearance?: string | null; appearanceId?: string | null; imageUrl?: string | null }>
}

interface StoryboardRaw {
  id: string
  clip?: {
    id?: string
    start?: number | null
    end?: number | null
    location?: string | null
    summary?: string | null
  } | null
  panels?: StoryboardPanelRaw[]
}

interface StoryboardStageState {
  reviewState?: string | null
  status?: string | null
}

interface StoryboardCacheEntry {
  storyboards: StoryboardRaw[]
  reviewState: string | null
  assignmentStatus: string | null
  lastReviewNote: string | null
  storedAt: number
}

const FAILED = new Set<number>()
const STORYBOARD_TASK_TYPE = 'script_to_storyboard_run'
const ASSET_QUOTA_PREFIX = '分镜参考素材配额'
const STORYBOARD_CACHE_TTL_MS = 15_000
const storyboardCache = new Map<string, StoryboardCacheEntry>()

function compact(value: string | null | undefined): string {
  return (value || '').replace(/\s+/g, ' ').trim()
}

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[\s"'“”‘’`·。、，,;；:：()（）[\]【】\-_/|]/g, '')
}

function parseNamesJson(value: string | null | undefined): string[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((item) => {
        if (typeof item === 'string') return item.trim()
        if (item && typeof item === 'object' && typeof (item as { name?: unknown }).name === 'string') {
          return ((item as { name: string }).name).trim()
        }
        return ''
      })
      .filter(Boolean)
  } catch {
    return []
  }
}

function splitCharacterNameAndAppearance(value: string): { name: string; appearance: string | null } {
  const [name, ...rest] = value.split(/\s*[·|｜]\s*/)
  return { name: compact(name) || compact(value), appearance: compact(rest.join(' · ')) || null }
}

function resolveAssetRef(
  kind: StoryAssetKind,
  name: string,
  data: FosProjectData,
  episodeNumber: number,
  context: { appearance?: string | null; sceneId?: string | null; sourceText?: string | null } = {},
): StoryAssetRef {
  const parsedCharacter = kind === '角色' ? splitCharacterNameAndAppearance(name) : null
  const lookupName = parsedCharacter?.name || name
  const key = normalizeName(lookupName)
  const pick = (assets: FosAsset[]) => assets.find((asset) => {
    const assetKey = normalizeName(asset.name)
    return key === assetKey || key.includes(assetKey) || assetKey.includes(key)
  })

  if (kind === '角色') {
    const asset = pick(data.characters)
    if (!asset) return { kind, name }
    const selected = selectStoryboardCharacterAppearance([
      { id: asset.mainAppearanceId, label: '初始形象', isPrimary: true },
      ...(asset.variants || []).map((variant) => ({
        id: variant.appearanceId,
        label: variant.label,
        isPrimary: false,
        coverageEpisodes: variant.episodes ? [variant.episodes] : [],
        coverageScenes: variant.coverageScenes || [],
        variant,
      })),
    ], {
      episodeNumber,
      sceneId: context.sceneId,
      requestedAppearance: context.appearance || parsedCharacter?.appearance,
      sourceText: context.sourceText,
    })
    const variant = selected && 'variant' in selected ? selected.variant : null
    return {
      kind,
      name: variant ? `${asset.name} · ${variant.label}` : asset.name,
      promptName: asset.name,
      imageUrl: variant?.imageUrl || asset.imageUrl,
    }
  }

  const asset = pick(kind === '物品' ? data.items : data.environments)
  return asset ? { kind, name: asset.name, imageUrl: asset.imageUrl } : { kind, name }
}

function uniqueRefs(refs: StoryAssetRef[]): StoryAssetRef[] {
  const seen = new Set<string>()
  const result: StoryAssetRef[] = []
  for (const ref of refs) {
    const name = compact(ref.name)
    if (!name) continue
    const key = `${ref.kind}:${normalizeName(name)}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push({ ...ref, name })
  }
  return result
}

function parseCharacterRefs(value: string | null | undefined): Array<{ name: string; appearance?: string | null; appearanceId?: string | null }> {
  if (!value) return []
  try {
    const parsed = JSON.parse(value) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.map((item) => {
      if (typeof item === 'string') return splitCharacterNameAndAppearance(item)
      if (item && typeof item === 'object' && typeof (item as { name?: unknown }).name === 'string') {
        const row = item as { name: string; appearance?: unknown; appearanceId?: unknown }
        return {
          name: row.name.trim(),
          appearance: typeof row.appearance === 'string' ? row.appearance.trim() : null,
          appearanceId: typeof row.appearanceId === 'string' ? row.appearanceId.trim() : null,
        }
      }
      return { name: '' }
    }).filter((item) => item.name)
  } catch {
    return []
  }
}

function readPanelAssetRefs(panel: StoryboardPanelRaw, data: FosProjectData, episodeNumber: number, sceneId: string): StoryAssetRef[] {
  const bound = Array.isArray(panel.assetBindings)
    ? panel.assetBindings
      .map((item): StoryAssetRef | null => {
        const name = compact(item.name)
        const kind = item.kind === '角色' || item.kind === '物品' || item.kind === '环境' ? item.kind : null
        if (!name || !kind) return null
        const resolved = resolveAssetRef(kind, name, data, episodeNumber, {
          appearance: item.appearanceId || item.appearance,
          sceneId,
          sourceText: panel.srtSegment || panel.description,
        })
        return {
          ...resolved,
          materialId: typeof (item as { materialId?: unknown }).materialId === 'string'
            ? (item as { materialId: string }).materialId
            : null,
          imageUrl: item.imageUrl || resolved.imageUrl || null,
        }
      })
      .filter((item): item is StoryAssetRef => Boolean(item))
    : []
  if (bound.length > 0) return uniqueRefs(bound)

  return uniqueRefs([
    ...parseCharacterRefs(panel.characters).map((character) => resolveAssetRef('角色', character.name, data, episodeNumber, {
      appearance: character.appearanceId || character.appearance,
      sceneId,
      sourceText: panel.srtSegment || panel.description,
    })),
    ...(panel.location ? [resolveAssetRef('环境', panel.location, data, episodeNumber, { sceneId })] : []),
    ...parseNamesJson(panel.props).map((name) => resolveAssetRef('物品', name, data, episodeNumber, { sceneId })),
  ])
}

function inferIntent(panel: StoryboardPanelRaw): { intent: SegIntent; label: string } {
  const label = compact(panel.sceneType) || compact(panel.shotType) || '建立情境'
  const text = `${label} ${panel.description || ''} ${panel.srtSegment || ''}`
  if (/反转|钩子|悬念|转折/.test(text)) return { intent: 'reverse', label: label === '建立情境' ? '反转钩子' : label }
  if (/冲突|对抗|争执|威胁|压迫|打|抓|踹|逼/.test(text)) return { intent: 'conflict', label: label === '建立情境' ? '制造冲突' : label }
  if (/情绪|内心|眼神|泪|惊恐|恐惧|冷汗|沉默|特写/.test(text)) return { intent: 'emotion', label: label === '建立情境' ? '情绪承载' : label }
  return { intent: 'establish', label }
}

function toDuration(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

function panelScriptText(panel: StoryboardPanelRaw): string {
  return compact(panel.srtSegment) || compact(panel.description) || compact(panel.imagePrompt) || '暂无分镜原文。'
}

function buildLiveStoryboard(
  episode: FosEpisode,
  storyboards: StoryboardRaw[],
  data: FosProjectData,
): StoryboardEpisode | null {
  const scenes: StoryScene[] = []
  const orderedStoryboards = [...storyboards].sort((a, b) => (
    (a.clip?.start ?? Number.MAX_SAFE_INTEGER) - (b.clip?.start ?? Number.MAX_SAFE_INTEGER)
  ))

  for (const storyboard of orderedStoryboards) {
    const panels = [...(storyboard.panels || [])]
      .sort((a, b) => (a.panelIndex ?? a.panelNumber ?? 0) - (b.panelIndex ?? b.panelNumber ?? 0))
    if (panels.length === 0) continue

    const firstPanel = panels[0]
    const scene: StoryScene = {
      code: `S${String(scenes.length + 1).padStart(2, '0')}`,
      storyboardId: storyboard.id,
      location: compact(storyboard.clip?.location) || compact(firstPanel.location) || '未命名场景',
      env: compact(storyboard.clip?.summary) || compact(firstPanel.sceneType) || '按分镜设计',
      segments: [],
    }
    scenes.push(scene)

    for (const panel of panels) {
      const segmentIndex = scene.segments.length + 1
      const inferred = inferIntent(panel)
      scene.segments.push({
        id: `${scene.code}-SEG${String(segmentIndex).padStart(2, '0')}`,
        panelId: panel.id,
        panelIndex: panel.panelIndex ?? segmentIndex - 1,
        location: compact(panel.location) || scene.location,
        intent: inferred.intent,
        intentLabel: inferred.label,
        duration: toDuration(panel.duration),
        scriptHeading: compact(panel.shotType) || `镜头 ${panel.panelNumber || segmentIndex}`,
        scriptText: panelScriptText(panel),
        refs: readPanelAssetRefs(panel, data, episode.episodeNumber, scene.code),
        shotType: panel.shotType,
        cameraMove: panel.cameraMove,
        imagePrompt: panel.imagePrompt,
        videoPrompt: panel.videoPrompt,
        imageUrl: panel.imageUrl,
        freeform: panel.sceneType === 'manual-freeform',
      })
    }
  }
  if (scenes.length === 0) return null

  const segmentCount = scenes.reduce((sum, scene) => sum + scene.segments.length, 0)
  const hasDuration = scenes.some((scene) => scene.segments.some((segment) => segment.duration !== null))
  const totalSeconds = hasDuration
    ? scenes.reduce((sum, scene) => (
      sum + scene.segments.reduce((sceneSum, segment) => sceneSum + (segment.duration ?? 0), 0)
    ), 0)
    : null

  return {
    episodeNumber: episode.episodeNumber,
    sceneCount: scenes.length,
    segmentCount,
    totalSeconds,
    scenes,
    source: 'live',
  }
}

function SegCard({
  seg,
  selected,
  canEdit,
  canMoveUp,
  canMoveDown,
  actionBusy,
  confirmingDelete,
  onSelect,
  onMove,
  onDelete,
}: {
  seg: StorySegment
  selected: boolean
  canEdit: boolean
  canMoveUp: boolean
  canMoveDown: boolean
  actionBusy: boolean
  confirmingDelete: boolean
  onSelect: () => void
  onMove: (direction: 'up' | 'down') => void
  onDelete: () => void
}) {
  const [open, setOpen] = useState(false)
  const tagCls = seg.intent === 'conflict' ? ' sd3-seg-tag--conflict' : seg.intent === 'reverse' ? ' sd3-seg-tag--reverse' : ''
  const groups: Array<[StoryAssetKind, string[]]> = (['角色', '物品', '环境'] as const).map((kind) => [kind, seg.refs.filter((ref) => ref.kind === kind).map((ref) => ref.name)])
  return (
    <div className={`sd3-seg-card${selected ? ' is-selected' : ''}`} onClick={onSelect}>
      <div className="sd3-seg-head">
        <span className="sd3-seg-id">{seg.id}</span>
        <span className={`sd3-seg-tag${tagCls}`}>{seg.freeform ? '自由创作' : seg.intentLabel}</span>
        {seg.duration !== null ? <span className="sd3-seg-dur">{seg.duration}s</span> : null}
        {seg.location ? <span className="sd3-shot-micro-chip">{seg.location}</span> : null}
        {seg.shotType ? <span className="sd3-shot-micro-chip">{seg.shotType}</span> : null}
        {seg.cameraMove ? <span className="sd3-shot-micro-chip">{seg.cameraMove}</span> : null}
        <span className="sd3-seg-actions">
          {canEdit ? <>
            <button type="button" className="sd3-seg-act-btn" title="上移 Segment" aria-label={`上移 ${seg.id}`} disabled={!canMoveUp || actionBusy} onClick={(event) => { event.stopPropagation(); onMove('up') }}><AppIcon name="chevronUp" className="h-3 w-3" /></button>
            <button type="button" className="sd3-seg-act-btn" title="下移 Segment" aria-label={`下移 ${seg.id}`} disabled={!canMoveDown || actionBusy} onClick={(event) => { event.stopPropagation(); onMove('down') }}><AppIcon name="chevronDown" className="h-3 w-3" /></button>
            <button type="button" className="sd3-seg-act-btn" style={confirmingDelete ? { color: '#ff8383', width: 74 } : { color: '#ff9292' }} title={confirmingDelete ? '再次点击确认删除' : '删除 Segment'} aria-label={confirmingDelete ? `确认删除 ${seg.id}` : `删除 ${seg.id}`} disabled={actionBusy} onClick={(event) => { event.stopPropagation(); onDelete() }}>{confirmingDelete ? '确认删除' : <AppIcon name="trash" className="h-3 w-3" />}</button>
          </> : null}
          <button className="sd3-seg-act-btn" title="展开详情" onClick={(event) => { event.stopPropagation(); setOpen((value) => !value) }}>{open ? '⌄' : '›'}</button>
        </span>
      </div>
      {!seg.freeform ? <div className="sd3-seg-script-excerpt">
        <div className="sd3-seg-script-excerpt-hd">
          <button className="sd3-seg-script-excerpt-toggle" onClick={(event) => { event.stopPropagation(); setOpen((value) => !value) }}>
            <span className="sd3-seg-script-excerpt-caret">{open ? '⌄' : '›'}</span>
            <span className="sd3-seg-script-excerpt-label">剧本原文</span>
            {!open ? <span className="sd3-seg-script-excerpt-preview">{seg.scriptText}</span> : null}
          </button>
        </div>
        {open ? <div className="sd3-seg-fn" style={{ marginTop: 6, fontSize: 12, lineHeight: 1.6, color: 'var(--fos-text-2)' }}>{seg.scriptText}</div> : null}
      </div> : null}
      <div className="sd3-shot-asset-hint">
        {groups.map(([key, names]) => names.length ? (
          <span key={key} className="flex items-center gap-1.5" style={{ flexWrap: 'wrap' }}>
            <span className="sd3-shot-asset-key">{key}</span>
            {names.map((name) => <span key={name} className="sd3-shot-micro-chip">{name}</span>)}
          </span>
        ) : null)}
        {seg.freeform && groups.every(([, names]) => names.length === 0) ? <span className="text-[11px] text-[var(--fos-text-4)]">等待在右侧添加角色、物品或环境</span> : null}
      </div>
    </div>
  )
}

function AssetThumb({ asset, onRemove }: { asset: StoryAssetRef; onRemove?: () => void }) {
  const src = toDisplayImageUrl(asset.imageUrl)
  return (
    <div className="sd3-asset-thumb-card">
      <div className="sd3-asset-thumb-img">
        {src ? (
          <MediaImage src={src} alt={asset.name} fill sizes="72px" style={{ objectFit: 'cover' }} />
        ) : (
          <AppIcon name={asset.kind === '角色' ? 'user' : asset.kind === '物品' ? 'package' : 'imageLandscape'} className="absolute left-1/2 top-1/2 h-8 w-8 -translate-x-1/2 -translate-y-1/2 text-white/12" />
        )}
        {onRemove ? <button type="button" className="sd3-asset-thumb-replace" title="从本分镜移除" onClick={onRemove}>移除</button> : null}
        <span className="sd3-asset-thumb-name">{asset.name}</span>
      </div>
      {asset.kind === '角色' ? (
        <div className="sd3-char-checks">
          <span className="sd3-check-ui">出镜</span>
          <span className="sd3-check-ui is-off">说话</span>
        </div>
      ) : null}
    </div>
  )
}

function RightPanel({ seg, scene, projectId, canEdit, onChanged }: { seg: StorySegment; scene: StoryScene; projectId: string; canEdit: boolean; onChanged: () => void | Promise<void> }) {
  const [refs, setRefs] = useState<StoryAssetRef[]>(seg.refs)
  const [pickerKind, setPickerKind] = useState<StoryAssetKind | null>(null)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [panelError, setPanelError] = useState<string | null>(null)
  const prompt = seg.videoPrompt || seg.imagePrompt || (seg.freeform ? '' : '等待分镜设计生成视频提示词。')
  const promptAssets: SeedancePromptAsset[] = useMemo(() => seg.refs.map((ref) => ({
    kind: ref.kind === '角色' ? 'character' : ref.kind === '物品' ? 'prop' : 'location',
    name: ref.promptName || ref.name,
  })), [seg.refs])
  const initialPrompt = useMemo(() => formatSeedancePromptForEditor(
    extractSeedanceVideoPromptBody(prompt),
    promptAssets,
  ), [prompt, promptAssets])
  const [displayPrompt, setDisplayPrompt] = useState(initialPrompt)
  useEffect(() => {
    setRefs(seg.refs)
    setDisplayPrompt(initialPrompt)
    setNotice(null)
    setPanelError(null)
  }, [seg.id, initialPrompt, seg.refs])
  const groups: Array<[StoryAssetKind, StoryAssetRef[]]> = (['角色', '物品', '环境'] as const).map((kind) => [kind, refs.filter((ref) => ref.kind === kind)])
  const refCount = refs.filter((ref) => ref.imageUrl).length
  const audioRefCount = /内心独白|对白|：\{|:\s*\{/.test(prompt) ? 1 : 0

  const addMaterial = async (material: FrameosMaterialItem) => {
    if (!canEdit || !seg.panelId || !pickerKind) return
    setPanelError(null)
    const kind = pickerKind === '角色' ? 'character' : pickerKind === '环境' ? 'location' : 'prop'
    const response = await apiFetch(`/api/novel-promotion/${projectId}/panels/${seg.panelId}/materials`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ materialId: material.id, kind }),
    })
    if (!response.ok) {
      setPanelError(await readApiErrorMessage(response, '添加素材失败'))
      setPickerKind(null)
      return
    }
    const payload = await response.json() as { assets?: Array<{ materialId?: string | null; kind: string; name: string; imageUrl: string }> }
    setRefs((payload.assets || []).map((asset) => ({
      materialId: asset.materialId,
      kind: asset.kind === 'character' ? '角色' : asset.kind === 'location' ? '环境' : '物品',
      name: asset.name,
      promptName: asset.name,
      imageUrl: asset.imageUrl,
    })))
    setNotice(`已添加 @${material.title || '未命名素材'}`)
    setPickerKind(null)
    await onChanged()
  }

  const removeMaterial = async (materialId: string) => {
    if (!canEdit || !seg.panelId) return
    const response = await apiFetch(`/api/novel-promotion/${projectId}/panels/${seg.panelId}/materials?materialId=${encodeURIComponent(materialId)}`, { method: 'DELETE' })
    if (!response.ok) {
      setPanelError(await readApiErrorMessage(response, '移除素材失败'))
      return
    }
    setRefs((current) => current.filter((ref) => ref.materialId !== materialId))
    await onChanged()
  }

  const savePrompt = async () => {
    if (!canEdit || !seg.panelId) return
    setSaving(true)
    setPanelError(null)
    try {
      const response = await apiFetch(`/api/novel-promotion/${projectId}/panel`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ panelId: seg.panelId, videoPrompt: displayPrompt }),
      })
      if (!response.ok) throw new Error(await readApiErrorMessage(response, '保存视频提示词失败'))
      setNotice('视频提示词已保存；请前往“制作剪辑”生成视频。')
    } catch (saveError) {
      setPanelError(saveError instanceof Error ? saveError.message : '保存视频提示词失败')
    } finally {
      setSaving(false)
    }
  }

  const mentionAssets = refs.map((ref) => ({ id: ref.materialId || `${ref.kind}:${ref.name}`, name: ref.promptName || ref.name, imageUrl: ref.imageUrl }))
  const selectedMaterialIds = refs.map((ref) => ref.materialId).filter((id): id is string => Boolean(id))
  return (
    <aside className="sd3-right">
      <div className="sd3-right-header">
        <span className="sd3-right-shot-id">{seg.id}</span>
        <span className="sd3-right-scene-name">{seg.location || scene.location}</span>
        {seg.duration !== null ? <span className="sd3-right-shot-dur">{seg.duration}s</span> : null}
      </div>
      <div className="sd3-right-scroll">
        <section className="sd3-right-section sd3-right-section--assets">
          <div className="sd3-right-section-title" style={{ marginBottom: 8 }}>◎ 参考资产</div>
          <div className="sd3-ref-constraint">{ASSET_QUOTA_PREFIX}：参考图 {refCount}/9 · 参考视频 0/3 · 参考音频 {audioRefCount}/3</div>
          {groups.map(([key, assets]) => (
            <div key={key} className="sd3-asset-group">
              <div className="sd3-asset-group-label">{key}</div>
              <div className="sd3-asset-thumb-row">
                {assets.map((asset) => <AssetThumb key={`${asset.kind}:${asset.name}:${asset.materialId || ''}`} asset={asset} onRemove={canEdit && asset.materialId ? () => void removeMaterial(asset.materialId!) : undefined} />)}
                <button type="button" className="sd3-asset-add-btn" title={canEdit ? `从素材库添加${key}` : '只读模式'} onClick={() => setPickerKind(key)} disabled={!canEdit || !seg.panelId}><AppIcon name="plus" className="h-4 w-4" /><span>{canEdit ? '添加' : '只读'}</span></button>
              </div>
            </div>
          ))}
          <div className="mt-2 rounded-lg border border-[var(--fos-border-soft)] bg-[var(--fos-bg-2)] px-3 py-2 text-[11px] text-[var(--fos-text-4)]">所有参考图统一从素材库添加；素材选择器内也支持本地命名上传。</div>
        </section>

        <div className="sd3-right-divider" />

        <section className="sd3-right-section sd3-right-section--prompt">
          <div className="flex items-center justify-between" style={{ marginBottom: 8 }}>
            <span className="sd3-right-section-title">◈ 视频提示词</span>
            <span className="flex items-center gap-2"><span className="sd3-prompt-charcount">{Array.from(displayPrompt.replace(/\s+/g, '')).length} 字</span><button type="button" className="text-[11px] font-bold text-[#8fa9ff]" disabled={!canEdit || saving || !seg.panelId} onClick={() => void savePrompt()}>{canEdit ? saving ? '保存中…' : '保存' : '只读'}</button></span>
          </div>
          <MentionPromptEditor value={displayPrompt} assets={mentionAssets} onChange={setDisplayPrompt} minHeight={260} placeholder="输入视频提示词；键入 @ 可选择当前分镜素材" readOnly={!canEdit} />
          {notice ? <div className="mt-2 text-[11px] text-[#8fb0ff]">{notice}</div> : null}
          {panelError ? <div className="mt-2 text-[11px] text-[#ff8b8b]">{panelError}</div> : null}
        </section>

        <div className="sd3-right-section sd3-right-section--style" style={{ paddingTop: 0 }}>
          <div className="sd3-right-section-title" style={{ marginBottom: 8 }}>◈ 画风描述</div>
          <textarea className="sd3-prompt-textarea" style={{ minHeight: 64 }} defaultValue={dataStylePromptFallback} readOnly={!canEdit} />
        </div>
      </div>
      {canEdit && pickerKind && seg.panelId ? <MaterialPickerDialog projectId={projectId} type="image" assetCategory={pickerKind === '角色' ? 'character' : pickerKind === '环境' ? 'location' : 'prop'} title={`添加${pickerKind}素材`} selectedIds={selectedMaterialIds} maxSelected={9} onSelect={(material) => void addMaterial(material)} onClose={() => setPickerKind(null)} /> : null}
    </aside>
  )
}

const dataStylePromptFallback = '院线电影质感，角色外观和场景资产保持连续，光影、景别、动作方向与上一镜头严格衔接。'

function RightPanelEmpty() {
  return (
    <aside className="sd3-right sd3-right-empty">
      <div className="sd3-right-empty-icon">◈</div>
      <div className="text-[14px] font-semibold text-[var(--fos-text-2)]">选择片段</div>
      <div className="text-[12px] text-[var(--fos-text-3)]">点击中间栏的片段卡片</div>
      <div className="text-[12px] text-[var(--fos-text-3)]">审阅并编辑视频提示词</div>
    </aside>
  )
}

function storyboardTaskStage(state: TaskTargetState): string {
  const translatedProgressLabels: Record<string, string> = {
    'progress.runtime.llm.processing': '模型正在处理',
    'progress.runtime.llm.output': '模型正在生成分镜',
    'progress.runtime.llm.reasoning': '模型正在规划镜头',
    'progress.runtime.llm.completed': '模型输出完成',
    'progress.runtime.llm.failed': '模型输出失败',
    'progress.runtime.stage.llmSubmit': '正在提交模型请求',
    'progress.runtime.stage.llmStreaming': '模型正在生成分镜',
    'progress.runtime.stage.llmFallbackNonStream': '模型正在继续处理',
    'progress.runtime.stage.llmCompleted': '模型输出完成',
    'progress.runtime.stage.llmFailed': '模型输出失败',
    'progress.stage.scriptToStoryboardPrepare': '准备本集分镜',
    'progress.stage.scriptToStoryboardStep': '生成镜头与画面调度',
    'progress.stage.scriptToStoryboardPersist': '保存本集分镜',
    'progress.stage.scriptToStoryboardPersistDone': '本集分镜保存完成',
  }
  const translate = (value: string) => {
    if (translatedProgressLabels[value]) return translatedProgressLabels[value]
    if (value === 'step retry complete') return '分镜步骤重试完成'
    // Never expose untranslated implementation keys in the product UI.
    if (/^(?:progress\.|[a-z][\w.-]*_[\w.-]+)/i.test(value)) return ''
    return value
  }
  const rawMessage = state.progressDetails?.message
  const message = typeof rawMessage === 'string'
    ? translate(rawMessage.trim())
    : ''
  if (message) return message
  if (state.stageLabel) {
    const label = translate(state.stageLabel)
    if (label) return label
  }
  const labels: Record<string, string> = {
    received: '任务已接收',
    script_to_storyboard_prepare_clip: '从单集剧本准备分镜片段',
    script_to_storyboard_prepare: '准备分镜生成',
    script_to_storyboard_step: '生成镜头与画面调度',
    worker_llm_submit: '正在请求文本模型',
    worker_llm_streaming: '模型正在生成',
    worker_llm_complete: '模型输出完成',
    script_to_storyboard_persist: '保存分镜结果',
    script_to_storyboard_persist_done: '分镜与台词已保存',
  }
  if (state.stage && labels[state.stage]) return labels[state.stage]
  if (state.phase === 'queued') return '等待任务执行'
  if (state.phase === 'processing') return '正在生成本集分镜'
  if (state.phase === 'completed') return '本集分镜已生成'
  return '本集分镜生成失败'
}

function friendlyStoryboardTaskError(message: string) {
  if (/column is too long|value for the column is too long|Column:\s*(?:content|screenplay)/i.test(message)) {
    return '上次分镜结果写入失败。存储结构现已修复，请点击“重新解析本集分镜”完成本集。'
  }
  if (/Invalid `(?:tx\.)?novelPromotionClip\.create\(\)` invocation/i.test(message)) {
    return '上次分镜结果保存失败，请重新解析本集分镜。'
  }
  if (/permission|forbidden|没有执行此操作的权限|当前账号没有/i.test(message)) {
    return '当前账号没有解析本集分镜的权限。'
  }
  return '本集分镜生成未完成，请重新解析；若再次失败，请在任务记录中查看原因。'
}

function StoryboardRunProgress({ state, hideCompleted = false }: { state: TaskTargetState | null; hideCompleted?: boolean }) {
  if (!state || state.phase === 'idle') return null
  if (hideCompleted && state.phase === 'completed') return null
  const running = state.phase === 'queued' || state.phase === 'processing'
  const failed = state.phase === 'failed'
  const progress = state.phase === 'completed' ? 100 : Math.max(1, state.progress || 0)
  return (
    <div className={`mx-4 my-3 rounded-xl border px-4 py-3 ${failed ? 'border-red-400/30 bg-red-500/10' : 'border-blue-400/25 bg-blue-500/[.08]'}`} data-testid="episode-storyboard-progress">
      <div className="flex items-center justify-between gap-3 text-[12px]">
        <span className={`font-bold ${failed ? 'text-red-200' : 'text-white'}`}>{storyboardTaskStage(state)}</span>
        <span className={`font-mono font-bold ${failed ? 'text-red-300' : 'text-[#8fa9ff]'}`}>{failed ? '失败' : `${Math.min(100, progress)}%`}</span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[.08]">
        <div className={`h-full rounded-full transition-[width] duration-700 ${failed ? 'bg-[#ff7272]' : 'bg-gradient-to-r from-[#4f7cff] via-[#8d74ff] to-[#5bd5c4]'}`} style={{ width: `${failed ? Math.max(4, state.progress || 0) : Math.min(100, progress)}%` }} />
      </div>
      {failed && state.lastError?.message ? <p className="mt-2 text-[11px] leading-5 text-red-200">{friendlyStoryboardTaskError(state.lastError.message)}</p> : null}
      {running ? <p className="mt-2 text-[11px] text-[var(--fos-text-3)]">任务在后台持续执行；离开本页后，项目工作台的“分镜设计”进度会同步显示。</p> : null}
    </div>
  )
}

function StoryboardSuccess({
  projectId,
  sb,
  episodes,
  activeEp,
  loading,
  submitting,
  error,
  notice,
  taskState,
  reviewState,
  reviewAssignmentStatus,
  reviewNote,
  reviewSubmitting,
  canEdit,
  onSwitchEp,
  onStartDesign,
  onConfirmEpisode,
  onUnconfirmEpisode,
  onStoryboardChanged,
}: {
  projectId: string
  sb: StoryboardEpisode
  episodes: FosEpisode[]
  activeEp: number
  loading: boolean
  submitting: boolean
  error: string | null
  notice: string | null
  taskState: TaskTargetState | null
  reviewState: string | null
  reviewAssignmentStatus: string | null
  reviewNote: string | null
  reviewSubmitting: boolean
  canEdit: boolean
  onSwitchEp: (n: number) => void
  onStartDesign: () => void
  onConfirmEpisode: () => void
  onUnconfirmEpisode: () => void
  onStoryboardChanged: (message?: string) => void | Promise<void>
}) {
  const [expanded, setExpanded] = useState(false)
  const [selectedSeg, setSelectedSeg] = useState('')
  const [creatingManual, setCreatingManual] = useState(false)
  const [manualError, setManualError] = useState<string | null>(null)
  const [pendingPanelId, setPendingPanelId] = useState('')
  const [panelActionId, setPanelActionId] = useState('')
  const [deleteConfirmPanelId, setDeleteConfirmPanelId] = useState('')
  const visibleEps = expanded ? episodes : episodes.slice(0, 10)
  const activeEpisode = episodes.find((episode) => episode.episodeNumber === activeEp)
  const epName = activeEpisode?.name ?? ''
  const isConfirmed = reviewState === 'confirmed'

  useEffect(() => {
    setSelectedSeg('')
    setDeleteConfirmPanelId('')
  }, [sb.episodeNumber, sb.source])

  useEffect(() => {
    if (!pendingPanelId) return
    const segment = sb.scenes.flatMap((scene) => scene.segments).find((item) => item.panelId === pendingPanelId)
    if (!segment) return
    setSelectedSeg(segment.id)
    setPendingPanelId('')
  }, [pendingPanelId, sb.scenes])

  let selScene: StoryScene | null = null
  let selSeg: StorySegment | null = null
  for (const scene of sb.scenes) {
    const found = scene.segments.find((segment) => segment.id === selectedSeg)
    if (found) { selScene = scene; selSeg = found; break }
  }
  const fallbackScene = sb.scenes.at(-1) || null
  const fallbackSegment = fallbackScene?.segments.at(-1) || null
  const manualTarget = selScene && selSeg?.panelId
    ? { storyboardId: selScene.storyboardId, panelId: selSeg.panelId, label: selSeg.id, location: selScene.location }
    : fallbackScene && fallbackSegment?.panelId
      ? { storyboardId: fallbackScene.storyboardId, panelId: fallbackSegment.panelId, label: fallbackSegment.id, location: fallbackScene.location }
      : null

  const createFreeformSegment = async (target: { storyboardId: string; panelId: string } | null) => {
    if (!activeEpisode || !canEdit || creatingManual) return
    setCreatingManual(true)
    setManualError(null)
    try {
      const response = await apiFetch(`/api/novel-promotion/${projectId}/panel/manual`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          episodeId: activeEpisode.id,
          storyboardId: target?.storyboardId || null,
          insertAfterPanelId: target?.panelId || null,
          freeform: true,
        }),
      })
      if (!response.ok) throw new Error(await readApiErrorMessage(response, '添加自由创作 Segment 失败'))
      const payload = await response.json() as { panel?: { id?: string } }
      setPendingPanelId(payload.panel?.id || '')
      await onStoryboardChanged('已添加自由创作 Segment，请在右侧选择参考资产并编写视频提示词。')
    } catch (createError) {
      setManualError(createError instanceof Error ? createError.message : '添加自由创作 Segment 失败')
    } finally {
      setCreatingManual(false)
    }
  }

  const moveSegment = async (panelId: string, direction: 'up' | 'down') => {
    if (!canEdit || panelActionId) return
    setPanelActionId(panelId)
    setDeleteConfirmPanelId('')
    setManualError(null)
    try {
      const response = await apiFetch(`/api/novel-promotion/${projectId}/panel`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ panelId, reorderDirection: direction }),
      })
      if (!response.ok) throw new Error(await readApiErrorMessage(response, '移动 Segment 失败'))
      const payload = await response.json() as { changed?: boolean }
      if (payload.changed === false) return
      setPendingPanelId(panelId)
      await onStoryboardChanged(direction === 'up' ? 'Segment 已上移。' : 'Segment 已下移。')
    } catch (moveError) {
      setManualError(moveError instanceof Error ? moveError.message : '移动 Segment 失败')
    } finally {
      setPanelActionId('')
    }
  }

  const deleteSegment = async (panelId: string) => {
    if (!canEdit || panelActionId) return
    if (deleteConfirmPanelId !== panelId) {
      setDeleteConfirmPanelId(panelId)
      return
    }
    setPanelActionId(panelId)
    setDeleteConfirmPanelId('')
    setManualError(null)
    try {
      const response = await apiFetch(`/api/novel-promotion/${projectId}/panel?panelId=${encodeURIComponent(panelId)}`, {
        method: 'DELETE',
      })
      if (!response.ok) throw new Error(await readApiErrorMessage(response, '删除 Segment 失败'))
      const selected = sb.scenes.flatMap((scene) => scene.segments).find((segment) => segment.id === selectedSeg)
      if (selected?.panelId === panelId) setSelectedSeg('')
      await onStoryboardChanged('Segment 已删除，其余镜头已自动重新编号。')
    } catch (deleteError) {
      setManualError(deleteError instanceof Error ? deleteError.message : '删除 Segment 失败')
    } finally {
      setPanelActionId('')
    }
  }

  return (
    <div className="sd3-page">
      <div className="sd3-ep-tabs">
        <span className="sd3-ep-label">分集：</span>
        <div className="sd3-ep-tabs-body">
          {visibleEps.map((episode) => (
            <button key={episode.id} className={`sd3-ep-tab${episode.episodeNumber === activeEp ? ' is-active' : ''}`} onClick={() => onSwitchEp(episode.episodeNumber)}>
              E{episode.episodeNumber} {episode.name}
              {FAILED.has(episode.episodeNumber) ? <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-[#ff5f5f] px-1 text-[10px] text-white">!</span> : null}
            </button>
          ))}
        </div>
        {!expanded ? <button className="sd3-ep-toggle" onClick={() => setExpanded(true)}>展开全部 {episodes.length} 集</button> : null}
      </div>

      <StoryboardRunProgress state={taskState} hideCompleted />

      {reviewAssignmentStatus === 'rejected' ? <div className="mx-4 mt-3 rounded-[10px] border border-red-400/25 bg-red-500/10 px-4 py-3"><div className="flex items-center gap-2 text-[12px] font-bold text-red-200"><AppIcon name="alert" className="h-4 w-4" />标记需修改</div><p className="mt-2 whitespace-pre-wrap text-[12px] leading-6 text-white/85">{reviewNote || '审核人员已退回本集分镜，请按任务中的意见修改后重新提交。'}</p></div> : null}

      {(error || manualError || notice || loading) ? (
        <div className="border-b border-[var(--fos-border-soft)] px-4 py-2 text-[12px] font-semibold">
          {loading ? <span className="text-[var(--fos-text-3)]">正在加载本集分镜…</span> : null}
          {notice ? <span className="text-[#8fb0ff]">{notice}</span> : null}
          {error || manualError ? <span className="text-[#ff7777]">{error || manualError}</span> : null}
        </div>
      ) : null}

      <div className="sd3-body">
        <div className="sd3-middle">
          <div className="sd3-mid-ep-header">
            <div className="min-w-0">
              <div className="sd3-ep-name">E{sb.episodeNumber} · {epName}</div>
              <div className="sd3-ep-meta">
                {sb.sceneCount} 场景 · {sb.segmentCount} 片段{sb.totalSeconds !== null ? ` · ${sb.totalSeconds}秒` : ''} · 已生成分镜
              </div>
            </div>
            <div className="ml-auto flex items-center gap-2"><button className="fos-btn fos-btn-primary fos-btn-sm" disabled={!canEdit || !manualTarget || creatingManual} onClick={() => void createFreeformSegment(manualTarget)}><AppIcon name={creatingManual ? 'loader' : 'plus'} className={`h-3.5 w-3.5 ${creatingManual ? 'animate-spin' : ''}`} />{creatingManual ? '正在添加…' : '添加自由 Segment'}</button><button className="sd3-redesign-entry-btn" disabled={!canEdit || submitting} onClick={onStartDesign}><AppIcon name="refresh" className="h-3.5 w-3.5" />{!canEdit ? '只读模式' : submitting ? '提交中…' : '重新解析本集分镜'}</button></div>
          </div>
          <div className="sd3-scene-nav-wrap">
            {sb.scenes.map((scene) => (
              <span key={scene.code} className="sd3-scene-anchor"><AppIcon name="folderOpen" className="h-3 w-3" />{scene.code} {scene.location}</span>
            ))}
          </div>
          <div className="sd3-scene-scroll">
            {sb.scenes.map((scene) => (
              <div key={scene.code} className="sd3-scene-block">
                <div className="sd3-sc-header">
                  <span className="sd3-sc-badge">{scene.code}</span>
                  <span className="sd3-sc-location">{scene.location}</span>
                  <span className="sd3-sc-env">{scene.env}</span>
                  <span className="sd3-sc-stats">
                    {scene.segments.length} 段
                    {scene.segments.some((segment) => segment.duration !== null)
                      ? ` · ${scene.segments.reduce((sum, segment) => sum + (segment.duration ?? 0), 0)}s`
                      : ''}
                  </span>
                </div>
                <div className="sd3-seg-list">
                  {scene.segments.map((segment, segmentIndex) => (
                    <div key={segment.id}>
                      <SegCard
                        seg={segment}
                        selected={segment.id === selectedSeg}
                        canEdit={canEdit && Boolean(segment.panelId)}
                        canMoveUp={segmentIndex > 0}
                        canMoveDown={segmentIndex < scene.segments.length - 1}
                        actionBusy={panelActionId === segment.panelId}
                        confirmingDelete={deleteConfirmPanelId === segment.panelId}
                        onSelect={() => { setSelectedSeg(segment.id); setDeleteConfirmPanelId('') }}
                        onMove={(direction) => { if (segment.panelId) void moveSegment(segment.panelId, direction) }}
                        onDelete={() => { if (segment.panelId) void deleteSegment(segment.panelId) }}
                      />
                      {canEdit && segment.panelId ? <div className="my-2 flex items-center gap-2 px-2"><span className="h-px flex-1 bg-[var(--fos-border-soft)]" /><button type="button" className="inline-flex items-center gap-1 rounded-full border border-[var(--fos-border-mid)] bg-[var(--fos-bg-2)] px-3 py-1 text-[11px] font-bold text-[#8fa9ff] hover:border-[var(--fos-primary)]" disabled={creatingManual} onClick={() => void createFreeformSegment({ storyboardId: scene.storyboardId, panelId: segment.panelId! })}><AppIcon name="plus" className="h-3 w-3" />在此后添加自由 Segment</button><span className="h-px flex-1 bg-[var(--fos-border-soft)]" /></div> : null}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
        {selSeg && selScene ? <RightPanel seg={selSeg} scene={selScene} projectId={projectId} canEdit={canEdit} onChanged={() => onStoryboardChanged()} /> : <RightPanelEmpty />}
      </div>

      <div className="sd3-bottom">
        <div className="sd3-action-bar">
          <div className="sd3-action-bar-left" />
          <div className="sd3-action-bar-right">
            {reviewAssignmentStatus === 'rejected' ? <button type="button" className="sd3-bottom-btn" style={{ borderColor: 'rgba(239,68,68,.45)', color: '#ffaaaa' }} disabled><AppIcon name="alert" className="h-4 w-4" />标记需修改</button> : reviewAssignmentStatus === 'completed' ? <span className="sd3-confirmed-hint">✓ 审核已通过</span> : isConfirmed ? (
              <>
                <span className="sd3-confirmed-hint">✓ 本集分镜已确认</span>
                <button className="sd3-bottom-btn" disabled={!canEdit || reviewSubmitting} onClick={onUnconfirmEpisode}>取消确认</button>
              </>
            ) : (
              <button className="sd3-bottom-btn sd3-bottom-btn--primary" disabled={!canEdit || reviewSubmitting} onClick={onConfirmEpisode}>
                <AppIcon name="check" className="h-4 w-4" />{!canEdit ? '只读 · 分镜师可操作' : reviewSubmitting ? '提交中…' : '确认本集分镜'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export function FosStoryboard({ data, initialEpisodeId }: { data: FosProjectData; initialEpisodeId?: string }) {
  const { data: session } = useSession()
  const canEdit = hasAccountPermissions({ role: session?.user?.role, permissions: session?.user?.permissions }, ['storyboardWrite'])
  const episodes = data.episodes
  const [activeEp, setActiveEp] = useState(
    episodes.find((episode) => episode.id === initialEpisodeId)?.episodeNumber
      ?? episodes[0]?.episodeNumber
      ?? 1,
  )
  const [storyboards, setStoryboards] = useState<StoryboardRaw[]>([])
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [reviewSubmitting, setReviewSubmitting] = useState(false)
  const [manualCreating, setManualCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [storyboardReviewState, setStoryboardReviewState] = useState<string | null>(null)
  const [reviewAssignmentStatus, setReviewAssignmentStatus] = useState<string | null>(null)
  const [reviewNote, setReviewNote] = useState<string | null>(null)
  const refreshTimers = useRef<number[]>([])
  const refreshedTask = useRef('')
  const initialEpisodeApplied = useRef(false)

  const activeEpisode = episodes.find((episode) => episode.episodeNumber === activeEp) || episodes[0]
  const activeEpisodeId = activeEpisode?.id || ''
  const storyboardTaskTargets = useMemo(() => activeEpisodeId ? [{
    targetType: 'NovelPromotionEpisode',
    targetId: activeEpisodeId,
    types: [STORYBOARD_TASK_TYPE],
  }] : [], [activeEpisodeId])
  const storyboardTaskQuery = useTaskTargetStateMap(data.projectId, storyboardTaskTargets, { staleTime: 1_000 })
  const storyboardTaskState = activeEpisodeId
    ? storyboardTaskQuery.getState('NovelPromotionEpisode', activeEpisodeId)
    : null
  const storyboardTaskRunning = storyboardTaskState?.phase === 'queued' || storyboardTaskState?.phase === 'processing'

  useEffect(() => {
    if (episodes.length === 0) return
    if (!initialEpisodeApplied.current) {
      initialEpisodeApplied.current = true
      const requestedEpisode = episodes.find((episode) => episode.id === initialEpisodeId)
      if (requestedEpisode) {
        setActiveEp(requestedEpisode.episodeNumber)
        return
      }
    }
    if (!episodes.some((episode) => episode.episodeNumber === activeEp)) {
      setActiveEp(episodes[0].episodeNumber)
    }
  }, [activeEp, episodes, initialEpisodeId])

  const loadStoryboards = useCallback(async (force = false) => {
    if (!activeEpisode) {
      setStoryboards([])
      setStoryboardReviewState(null)
      setReviewAssignmentStatus(null)
      setReviewNote(null)
      setLoading(false)
      return
    }
    const cacheKey = `${data.projectId}:${activeEpisode.id}`
    const cached = storyboardCache.get(cacheKey)
    if (!force && cached && Date.now() - cached.storedAt < STORYBOARD_CACHE_TTL_MS) {
      setStoryboards(cached.storyboards)
      setStoryboardReviewState(cached.reviewState)
      setReviewAssignmentStatus(cached.assignmentStatus)
      setReviewNote(cached.lastReviewNote)
      setLoading(false)
      return
    }
    if (!force && cached) {
      setStoryboards(cached.storyboards)
      setStoryboardReviewState(cached.reviewState)
      setReviewAssignmentStatus(cached.assignmentStatus)
      setReviewNote(cached.lastReviewNote)
    }
    setLoading(true)
    setError(null)
    try {
      const [json, stageJson, assignmentJson] = await Promise.all([
        (async () => {
          const res = await apiFetch(`/api/novel-promotion/${data.projectId}/storyboards?episodeId=${encodeURIComponent(activeEpisode.id)}`)
          if (!res.ok) throw new Error(await readApiErrorMessage(res, '加载分镜失败'))
          return await res.json() as { storyboards?: StoryboardRaw[] }
        })(),
        (async () => {
          const res = await apiFetch(`/api/workflow/projects/${data.projectId}/stages/storyboard?episodeId=${encodeURIComponent(activeEpisode.id)}`)
          if (!res.ok) return null
          return await res.json() as { stage?: StoryboardStageState }
        })().catch(() => null),
        (async () => {
          const res = await apiFetch(`/api/collaboration/assignments/list?projectId=${encodeURIComponent(data.projectId)}`)
          if (!res.ok) return null
          return await res.json() as { assignments?: CollaborationAssignment[] }
        })().catch(() => null),
      ])
      const nextStoryboards = Array.isArray(json.storyboards) ? json.storyboards : []
      const nextReviewState = stageJson?.stage?.reviewState || null
      const reviewAssignment = (assignmentJson?.assignments || []).find((assignment) => assignment.stage === 'storyboard' && assignment.episodeId === activeEpisode.id)
      const nextAssignmentStatus = reviewAssignment?.status || null
      const nextReviewNote = reviewAssignment?.lastReviewNote?.trim() || null
      storyboardCache.set(cacheKey, {
        storyboards: nextStoryboards,
        reviewState: nextReviewState,
        assignmentStatus: nextAssignmentStatus,
        lastReviewNote: nextReviewNote,
        storedAt: Date.now(),
      })
      setStoryboards(nextStoryboards)
      setStoryboardReviewState(nextReviewState)
      setReviewAssignmentStatus(nextAssignmentStatus)
      setReviewNote(nextReviewNote)
    } catch (err) {
      logError('[FosStoryboard] 加载分镜失败', err)
      setStoryboards([])
      setStoryboardReviewState(null)
      setReviewAssignmentStatus(null)
      setReviewNote(null)
      setError(err instanceof Error ? err.message : '加载分镜失败')
    } finally {
      setLoading(false)
    }
  }, [activeEpisode, data.projectId])

  useEffect(() => {
    void loadStoryboards()
  }, [loadStoryboards])

  const taskCompletionSignature = storyboardTaskState?.phase === 'completed'
    ? `${activeEpisodeId}:${storyboardTaskState.updatedAt || ''}`
    : ''
  useEffect(() => {
    if (!taskCompletionSignature || refreshedTask.current === taskCompletionSignature) return
    refreshedTask.current = taskCompletionSignature
    storyboardCache.delete(`${data.projectId}:${activeEpisodeId}`)
    data.refetch()
    void loadStoryboards(true)
  }, [activeEpisodeId, data, loadStoryboards, taskCompletionSignature])

  useEffect(() => {
    return () => {
      refreshTimers.current.forEach((timer) => window.clearTimeout(timer))
    }
  }, [])

  const scheduleRefreshes = () => {
    refreshTimers.current.forEach((timer) => window.clearTimeout(timer))
    refreshTimers.current = [4_000, 10_000, 20_000, 40_000].map((delay) => (
      window.setTimeout(() => {
        data.refetch()
        void loadStoryboards(true)
      }, delay)
    ))
  }

  const handleStartDesign = async () => {
    if (!canEdit || !activeEpisode || submitting || storyboardTaskRunning) return
    setSubmitting(true)
    setError(null)
    setNotice(null)
    try {
      const submitRes = await apiFetch(`/api/novel-promotion/${data.projectId}/script-to-storyboard-stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          episodeId: activeEpisode.id,
          async: true,
          displayMode: 'detail',
        }),
      })
      if (!submitRes.ok) throw new Error(await readApiErrorMessage(submitRes, '提交分镜设计失败'))
      setNotice('已提交本集分镜设计任务；本页与项目工作台将同步显示进度。')
      await storyboardTaskQuery.refetch()
      scheduleRefreshes()
    } catch (err) {
      logError('[FosStoryboard] 提交分镜设计失败', err)
      setError(err instanceof Error ? err.message : '提交分镜设计失败')
    } finally {
      setSubmitting(false)
    }
  }

  const handleStartFreeform = async () => {
    if (!canEdit || !activeEpisode || manualCreating || storyboardTaskRunning) return
    setManualCreating(true)
    setError(null)
    setNotice(null)
    try {
      const response = await apiFetch(`/api/novel-promotion/${data.projectId}/panel/manual`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ episodeId: activeEpisode.id, freeform: true }),
      })
      if (!response.ok) throw new Error(await readApiErrorMessage(response, '进入手动分镜制作失败'))
      storyboardCache.delete(`${data.projectId}:${activeEpisode.id}`)
      await loadStoryboards(true)
      data.refetch()
      setNotice('已进入自由创作模式，请选择 Segment 后在右侧添加参考资产并填写视频提示词。')
    } catch (manualError) {
      setError(manualError instanceof Error ? manualError.message : '进入手动分镜制作失败')
    } finally {
      setManualCreating(false)
    }
  }

  const handleReviewAction = async (confirmed: boolean) => {
    if (!canEdit || !activeEpisode || reviewSubmitting) return
    setReviewSubmitting(true)
    setError(null)
    setNotice(null)
    try {
      const action = confirmed ? 'approve' : 'unapprove'
      const res = await apiFetch(`/api/workflow/projects/${data.projectId}/stages/storyboard/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ episodeId: activeEpisode.id }),
      })
      if (!res.ok) throw new Error(await readApiErrorMessage(res, confirmed ? '确认本集分镜失败' : '取消确认失败'))
      const nextReviewState = confirmed ? 'confirmed' : 'review'
      setStoryboardReviewState(nextReviewState)
      if (activeEpisode) {
        storyboardCache.set(`${data.projectId}:${activeEpisode.id}`, {
          storyboards,
          reviewState: nextReviewState,
          assignmentStatus: reviewAssignmentStatus,
          lastReviewNote: reviewNote,
          storedAt: Date.now(),
        })
      }
      setNotice(confirmed ? '本集分镜已确认。' : '已取消本集分镜确认。')
      data.refetch()
    } catch (err) {
      logError('[FosStoryboard] 更新分镜确认状态失败', err)
      setError(err instanceof Error ? err.message : '更新分镜确认状态失败')
    } finally {
      setReviewSubmitting(false)
    }
  }

  const liveStoryboard = useMemo(
    () => activeEpisode ? buildLiveStoryboard(activeEpisode, storyboards, data) : null,
    [activeEpisode, data, storyboards],
  )
  if (!activeEpisode) {
    return (
      <div className="flex flex-1 items-center justify-center text-[13px] text-[var(--fos-text-3)]">
        暂无分集数据，请先完成剧本解析。
      </div>
    )
  }

  if (!liveStoryboard) {
    const assetCount = data.characters.length + data.items.length + data.environments.length
    const waitingForResult = storyboardTaskRunning
    return (
      <div className="sd3-page">
        <div className="sd3-ep-tabs">
          <span className="sd3-ep-label">分集：</span>
          <div className="sd3-ep-tabs-body">
            {episodes.map((episode) => (
              <button key={episode.id} className={`sd3-ep-tab${episode.episodeNumber === activeEp ? ' is-active' : ''}`} onClick={() => setActiveEp(episode.episodeNumber)}>
                E{episode.episodeNumber} {episode.name}
              </button>
            ))}
          </div>
        </div>
        <StoryboardRunProgress state={storyboardTaskState} />
        <div className="flex flex-1 items-center justify-center overflow-y-auto p-8">
          <div className="w-full max-w-[620px] rounded-2xl border border-[var(--fos-border-mid)] bg-[var(--fos-bg-2)] p-8 text-center">
            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--fos-primary-soft)] text-[#7ea4ff]"><AppIcon name="film" className="h-7 w-7" /></span>
            <h2 className="mt-5 text-[20px] font-bold text-white">本集尚未解析分镜</h2>
            <p className="mt-2 text-[14px] font-semibold text-[var(--fos-text-2)]">E{activeEpisode.episodeNumber} · {activeEpisode.name}</p>
            <p className="mt-3 text-[13px] leading-6 text-[var(--fos-text-3)]">可以让 AI 解析本集，也可以直接进入自由创作面板，从空 Segment 开始选择资产并编写视频提示词。</p>
            <div className="mt-5 flex justify-center gap-3 text-[12px] text-[var(--fos-text-3)]"><span>{activeEpisode.wordCount} 字剧本</span><span>·</span><span>{assetCount} 个项目资产</span></div>
            {assetCount === 0 ? <p className="mt-3 text-[11px] text-amber-200/80">AI 解析需要先完成项目资产；手动制作仍可直接开始。</p> : null}
            {error ? <div className="mt-4 rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-[13px] text-red-200">{error}</div> : null}
            {notice ? <div className="mt-4 rounded-lg border border-blue-400/30 bg-blue-500/10 px-3 py-2 text-[13px] text-blue-200">{notice}</div> : null}
            {loading ? <div className="mt-5 text-[13px] text-[var(--fos-text-3)]">正在检查本集分镜状态…</div> : <div className="mt-6 flex flex-wrap justify-center gap-3">
              <button type="button" className="fos-btn fos-btn-primary fos-btn-lg" title={assetCount === 0 ? '请先完成项目资产解析' : undefined} disabled={!canEdit || submitting || waitingForResult || assetCount === 0} onClick={() => void handleStartDesign()}>
                <AppIcon name={submitting || waitingForResult ? 'loader' : 'sparkles'} className={`h-4 w-4 ${submitting || waitingForResult ? 'animate-spin' : ''}`} />
                {!canEdit ? '只读 · 分镜师可操作' : submitting ? '正在提交…' : waitingForResult ? `正在生成 ${Math.max(1, storyboardTaskState?.progress || 0)}%` : '解析本集分镜'}
              </button>
              <button type="button" className="fos-btn fos-btn-ghost fos-btn-lg" disabled={!canEdit || loading || waitingForResult || manualCreating} onClick={() => void handleStartFreeform()}><AppIcon name={manualCreating ? 'loader' : 'plus'} className={`h-4 w-4 ${manualCreating ? 'animate-spin' : ''}`} />{manualCreating ? '正在进入…' : '手动制作分镜'}</button>
            </div>}
          </div>
        </div>
      </div>
    )
  }

  return (
    <StoryboardSuccess
      projectId={data.projectId}
      sb={liveStoryboard}
      episodes={episodes}
      activeEp={liveStoryboard.episodeNumber}
      loading={loading}
      submitting={submitting || storyboardTaskRunning}
      error={error}
      notice={notice}
      taskState={storyboardTaskState}
      reviewState={storyboardReviewState}
      reviewAssignmentStatus={reviewAssignmentStatus}
      reviewNote={reviewNote}
      reviewSubmitting={reviewSubmitting}
      canEdit={canEdit}
      onSwitchEp={setActiveEp}
      onStartDesign={handleStartDesign}
      onConfirmEpisode={() => void handleReviewAction(true)}
      onUnconfirmEpisode={() => void handleReviewAction(false)}
      onStoryboardChanged={async (message) => {
        storyboardCache.delete(`${data.projectId}:${activeEpisode.id}`)
        await loadStoryboards(true)
        data.refetch()
        if (message) setNotice(message)
      }}
    />
  )
}
