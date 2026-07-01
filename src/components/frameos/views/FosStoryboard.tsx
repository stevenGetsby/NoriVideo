'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AppIcon } from '@/components/ui/icons'
import { MediaImage } from '@/components/media/MediaImage'
import { apiFetch } from '@/lib/api-fetch'
import { readApiErrorMessage } from '@/lib/api/read-error-message'
import { logError } from '@/lib/logging/core'
import { toDisplayImageUrl } from '@/lib/media/image-url'
import { demoEpisodes, demoStoryboard } from '../fosDemoData'
import type { FosEpisode, FosProjectData, FosAsset } from '../useFosProject'

type StoryAssetKind = '角色' | '物品' | '环境'
type SegIntent = 'establish' | 'conflict' | 'emotion' | 'reverse'

interface StoryAssetRef {
  kind: StoryAssetKind
  name: string
  imageUrl?: string | null
}

interface StorySegment {
  id: string
  panelId?: string
  location?: string | null
  intent: SegIntent
  intentLabel: string
  duration: number
  scriptHeading: string
  scriptText: string
  refs: StoryAssetRef[]
  shotType?: string | null
  cameraMove?: string | null
  imagePrompt?: string | null
  videoPrompt?: string | null
  imageUrl?: string | null
}

interface StoryScene {
  code: string
  location: string
  env: string
  segments: StorySegment[]
}

interface StoryboardEpisode {
  episodeNumber: number
  sceneCount: number
  segmentCount: number
  totalSeconds: number
  scenes: StoryScene[]
  source: 'demo' | 'live' | 'draft'
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
  assetBindings?: Array<{ kind?: string; name?: string; imageUrl?: string | null }>
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
  storedAt: number
}

const FAILED = new Set<number>()
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

function assetEpisodeHit(episodes: string | null | undefined, episodeNumber: number): boolean {
  if (!episodes) return false
  const normalized = episodes.replace(/\s+/g, '').toUpperCase()
  return normalized.includes(`E${episodeNumber}`) || normalized.includes(`EP${episodeNumber}`)
}

function resolveAssetRef(kind: StoryAssetKind, name: string, data: FosProjectData, episodeNumber: number): StoryAssetRef {
  const key = normalizeName(name)
  const pick = (assets: FosAsset[]) => assets.find((asset) => {
    const assetKey = normalizeName(asset.name)
    return key === assetKey || key.includes(assetKey) || assetKey.includes(key)
  })

  if (kind === '角色') {
    const asset = pick(data.characters)
    if (!asset) return { kind, name }
    const variant = asset.variants?.find((item) => (
      name.includes(item.label) || assetEpisodeHit(item.episodes, episodeNumber)
    ))
    return {
      kind,
      name: variant ? `${asset.name} · ${variant.label}` : asset.name,
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

function readPanelAssetRefs(panel: StoryboardPanelRaw, data: FosProjectData, episodeNumber: number): StoryAssetRef[] {
  const bound = Array.isArray(panel.assetBindings)
    ? panel.assetBindings
      .map((item): StoryAssetRef | null => {
        const name = compact(item.name)
        const kind = item.kind === '角色' || item.kind === '物品' || item.kind === '环境' ? item.kind : null
        if (!name || !kind) return null
        const resolved = resolveAssetRef(kind, name, data, episodeNumber)
        return { ...resolved, imageUrl: item.imageUrl || resolved.imageUrl || null }
      })
      .filter((item): item is StoryAssetRef => Boolean(item))
    : []
  if (bound.length > 0) return uniqueRefs(bound)

  return uniqueRefs([
    ...parseNamesJson(panel.characters).map((name) => resolveAssetRef('角色', name, data, episodeNumber)),
    ...(panel.location ? [resolveAssetRef('环境', panel.location, data, episodeNumber)] : []),
    ...parseNamesJson(panel.props).map((name) => resolveAssetRef('物品', name, data, episodeNumber)),
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

function toDuration(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(4, Math.round(value)) : 8
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
        location: compact(panel.location) || scene.location,
        intent: inferred.intent,
        intentLabel: inferred.label,
        duration: toDuration(panel.duration),
        scriptHeading: compact(panel.shotType) || `镜头 ${panel.panelNumber || segmentIndex}`,
        scriptText: panelScriptText(panel),
        refs: readPanelAssetRefs(panel, data, episode.episodeNumber),
        shotType: panel.shotType,
        cameraMove: panel.cameraMove,
        imagePrompt: panel.imagePrompt,
        videoPrompt: panel.videoPrompt,
        imageUrl: panel.imageUrl,
      })
    }
  }
  if (scenes.length === 0) return null

  const segmentCount = scenes.reduce((sum, scene) => sum + scene.segments.length, 0)
  const totalSeconds = scenes.reduce((sum, scene) => (
    sum + scene.segments.reduce((sceneSum, segment) => sceneSum + segment.duration, 0)
  ), 0)

  return {
    episodeNumber: episode.episodeNumber,
    sceneCount: scenes.length,
    segmentCount,
    totalSeconds,
    scenes,
    source: 'live',
  }
}

function findMentionedRefs(text: string, data: FosProjectData, episodeNumber: number): StoryAssetRef[] {
  const includesName = (asset: FosAsset) => text.includes(asset.name) || assetEpisodeHit(asset.episodes, episodeNumber)
  return uniqueRefs([
    ...data.characters.filter(includesName).map((asset) => resolveAssetRef('角色', asset.name, data, episodeNumber)),
    ...data.items.filter(includesName).map((asset) => resolveAssetRef('物品', asset.name, data, episodeNumber)),
    ...data.environments.filter(includesName).map((asset) => resolveAssetRef('环境', asset.name, data, episodeNumber)),
  ])
}

function buildDraftStoryboard(episode: FosEpisode | undefined, data: FosProjectData): StoryboardEpisode | null {
  if (!episode) return null
  const scenes: StoryScene[] = []
  const episodeText = episode.novelText || ''

  if (episode.scenes?.length) {
    for (let index = 0; index < episode.scenes.length; index += 1) {
      const scene = episode.scenes[index]
      const code = scene.sceneNumber?.startsWith('S') ? scene.sceneNumber : `S${String(index + 1).padStart(2, '0')}`
      const refs = uniqueRefs([
        ...scene.characters.map((name) => resolveAssetRef('角色', name, data, episode.episodeNumber)),
        ...(scene.location ? [resolveAssetRef('环境', scene.location, data, episode.episodeNumber)] : []),
        ...findMentionedRefs(scene.content || episodeText, data, episode.episodeNumber),
      ])
      scenes.push({
        code,
        location: compact(scene.location) || '待识别场景',
        env: [scene.intExt, scene.time].map(compact).filter(Boolean).join(' · ') || '待设计',
        segments: [{
          id: `${code}-SEG01`,
          intent: 'establish',
          intentLabel: '待设计',
          duration: 8,
          scriptHeading: scene.heading || `场景 ${index + 1}`,
          scriptText: compact(scene.content) || '等待分镜设计拆分片段。',
          refs,
        }],
      })
    }
  }

  if (scenes.length === 0) {
    const refs = findMentionedRefs(episodeText, data, episode.episodeNumber)
    scenes.push({
      code: 'S01',
      location: refs.find((ref) => ref.kind === '环境')?.name || data.environments[0]?.name || '待识别场景',
      env: '待设计',
      segments: [{
        id: 'S01-SEG01',
        intent: 'establish',
        intentLabel: '待设计',
        duration: 8,
        scriptHeading: `E${episode.episodeNumber} ${episode.name}`,
        scriptText: compact(episodeText).slice(0, 240) || '本集尚未生成分镜，点击开始设计。',
        refs,
      }],
    })
  }

  const segmentCount = scenes.reduce((sum, scene) => sum + scene.segments.length, 0)
  const totalSeconds = scenes.reduce((sum, scene) => sum + scene.segments.reduce((n, segment) => n + segment.duration, 0), 0)
  return {
    episodeNumber: episode.episodeNumber,
    sceneCount: scenes.length,
    segmentCount,
    totalSeconds,
    scenes,
    source: 'draft',
  }
}

function demoToStoryboardEpisode(): StoryboardEpisode {
  return {
    ...demoStoryboard,
    source: 'demo',
    scenes: demoStoryboard.scenes.map((scene) => ({
      ...scene,
      segments: scene.segments.map((segment) => ({
        ...segment,
        refs: segment.refs,
      })),
    })),
  }
}

function MentionText({ text }: { text: string }) {
  const parts = text.split(/(@[^，。；：\s,]+)/g)
  return (
    <>
      {parts.map((part, index) => part.startsWith('@')
        ? <span key={index} className="tb-mention-tag">{part}</span>
        : <span key={index}>{part}</span>)}
    </>
  )
}

function SegCard({ seg, selected, onSelect }: { seg: StorySegment; selected: boolean; onSelect: () => void }) {
  const [open, setOpen] = useState(false)
  const tagCls = seg.intent === 'conflict' ? ' sd3-seg-tag--conflict' : seg.intent === 'reverse' ? ' sd3-seg-tag--reverse' : ''
  const groups: Array<[StoryAssetKind, string[]]> = (['角色', '物品', '环境'] as const).map((kind) => [kind, seg.refs.filter((ref) => ref.kind === kind).map((ref) => ref.name)])
  return (
    <div className={`sd3-seg-card${selected ? ' is-selected' : ''}`} onClick={onSelect}>
      <div className="sd3-seg-head">
        <span className="sd3-seg-id">{seg.id}</span>
        <span className={`sd3-seg-tag${tagCls}`}>{seg.intentLabel}</span>
        <span className="sd3-seg-dur">{seg.duration}s</span>
        {seg.location ? <span className="sd3-shot-micro-chip">{seg.location}</span> : null}
        {seg.shotType ? <span className="sd3-shot-micro-chip">{seg.shotType}</span> : null}
        {seg.cameraMove ? <span className="sd3-shot-micro-chip">{seg.cameraMove}</span> : null}
        <span className="sd3-seg-actions">
          <button className="sd3-seg-act-btn" title="展开详情" onClick={(event) => { event.stopPropagation(); setOpen((value) => !value) }}>{open ? '⌄' : '›'}</button>
        </span>
      </div>
      <div className="sd3-seg-script-excerpt">
        <div className="sd3-seg-script-excerpt-hd">
          <button className="sd3-seg-script-excerpt-toggle" onClick={(event) => { event.stopPropagation(); setOpen((value) => !value) }}>
            <span className="sd3-seg-script-excerpt-caret">{open ? '⌄' : '›'}</span>
            <span className="sd3-seg-script-excerpt-label">剧本原文</span>
            {!open ? <span className="sd3-seg-script-excerpt-preview">{seg.scriptText}</span> : null}
          </button>
        </div>
        {open ? <div className="sd3-seg-fn" style={{ marginTop: 6, fontSize: 12, lineHeight: 1.6, color: 'var(--fos-text-2)' }}>{seg.scriptText}</div> : null}
      </div>
      <div className="sd3-shot-asset-hint">
        {groups.map(([key, names]) => names.length ? (
          <span key={key} className="flex items-center gap-1.5" style={{ flexWrap: 'wrap' }}>
            <span className="sd3-shot-asset-key">{key}</span>
            {names.map((name) => <span key={name} className="sd3-shot-micro-chip">{name}</span>)}
          </span>
        ) : null)}
        {seg.refs.length === 0 ? <span className="sd3-shot-asset-key">未绑定资产</span> : null}
      </div>
    </div>
  )
}

function AssetThumb({ asset }: { asset: StoryAssetRef }) {
  const src = toDisplayImageUrl(asset.imageUrl)
  return (
    <div className="sd3-asset-thumb-card">
      <div className="sd3-asset-thumb-img">
        {src ? (
          <MediaImage src={src} alt={asset.name} fill sizes="72px" style={{ objectFit: 'cover' }} />
        ) : (
          <AppIcon name={asset.kind === '角色' ? 'user' : asset.kind === '物品' ? 'package' : 'imageLandscape'} className="absolute left-1/2 top-1/2 h-8 w-8 -translate-x-1/2 -translate-y-1/2 text-white/12" />
        )}
        <button className="sd3-asset-thumb-replace" title="替换参考资产">替换</button>
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

function RightPanel({ seg, scene }: { seg: StorySegment; scene: StoryScene }) {
  const groups: Array<[StoryAssetKind, StoryAssetRef[]]> = (['角色', '物品', '环境'] as const).map((kind) => [kind, seg.refs.filter((ref) => ref.kind === kind)])
  const prompt = seg.videoPrompt || seg.imagePrompt || '等待分镜设计生成视频提示词。'
  const refCount = seg.refs.filter((ref) => ref.imageUrl).length
  const audioRefCount = /内心独白|对白|：\{|:\s*\{/.test(prompt) ? 1 : 0
  return (
    <aside className="sd3-right">
      <div className="sd3-right-header">
        <span className="sd3-right-shot-id">{seg.id}</span>
        <span className="sd3-right-scene-name">{seg.location || scene.location}</span>
        <span className="sd3-right-shot-dur">{seg.duration}s</span>
      </div>
      <div className="sd3-right-scroll">
        <section className="sd3-right-section sd3-right-section--assets">
          <div className="sd3-right-section-title" style={{ marginBottom: 8 }}>◎ 参考资产</div>
          <div className="sd3-ref-constraint">{ASSET_QUOTA_PREFIX}：参考图 {refCount}/9 · 参考视频 0/3 · 参考音频 {audioRefCount}/3</div>
          {groups.map(([key, assets]) => (
            <div key={key} className="sd3-asset-group">
              <div className="sd3-asset-group-label">{key}</div>
              <div className="sd3-asset-thumb-row">
                {assets.map((asset) => <AssetThumb key={`${asset.kind}:${asset.name}`} asset={asset} />)}
                <button className="sd3-asset-add-btn" title={`添加${key}参考资产`}><AppIcon name="plus" className="h-4 w-4" /><span>添加</span></button>
              </div>
            </div>
          ))}
          <div className="mt-1 flex flex-col gap-2">
            <button className="fos-btn fos-btn-ghost w-full fos-btn-sm">参考前一镜视频</button>
            <button className="fos-btn fos-btn-ghost w-full fos-btn-sm">添加额外参考素材</button>
          </div>
        </section>

        <div className="sd3-right-divider" />

        <section className="sd3-right-section sd3-right-section--preset">
          <div className="sd3-right-section-title" style={{ marginBottom: 10 }}>◎ 输出参数</div>
          <div className="spp-row">
            <div className="spp-field"><span className="spp-field-label">视频模型</span><span className="fos-pill" style={{ height: 28 }}>Seedance 2.0</span></div>
            <div className="spp-field" style={{ flex: '1 1 0px', minWidth: 90 }}><span className="spp-field-label">分辨率</span><span className="fos-pill" style={{ height: 28 }}>480p</span></div>
            <div className="spp-field" style={{ flex: '1 1 0px', minWidth: 90 }}><span className="spp-field-label">视频秒数</span><span className="fos-pill" style={{ height: 28 }}>{seg.duration}s</span></div>
          </div>
        </section>

        <div className="sd3-right-divider" />

        <section className="sd3-right-section sd3-right-section--consistency">
          <div className="flex items-center justify-between" style={{ marginBottom: 8 }}>
            <span className="sd3-right-section-title">◈ 一致性控制</span>
            <span className="sd3-prompt-charcount">0 字</span>
          </div>
          <div className="sd3-prompt-textarea" style={{ minHeight: 52 }} />
        </section>

        <div className="sd3-right-divider" />

        <section className="sd3-right-section sd3-right-section--prompt">
          <div className="flex items-center justify-between" style={{ marginBottom: 8 }}>
            <span className="sd3-right-section-title">◈ 视频提示词</span>
            <span className="sd3-prompt-charcount">{prompt.length} 字</span>
          </div>
          <div className="sd3-prompt-textarea" style={{ maxHeight: 260, overflowY: 'auto', whiteSpace: 'pre-wrap' }}>
            <MentionText text={prompt} />
          </div>
        </section>

        <div className="sd3-right-section sd3-right-section--style" style={{ paddingTop: 0 }}>
          <div className="sd3-right-section-title" style={{ marginBottom: 8 }}>◈ 画风描述</div>
          <textarea className="sd3-prompt-textarea" style={{ minHeight: 64 }} defaultValue={dataStylePromptFallback} />
        </div>
      </div>
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

function StoryboardSuccess({
  sb,
  episodes,
  activeEp,
  loading,
  submitting,
  error,
  notice,
  reviewState,
  reviewSubmitting,
  onSwitchEp,
  onStartDesign,
  onConfirmEpisode,
  onUnconfirmEpisode,
}: {
  sb: StoryboardEpisode
  episodes: FosEpisode[]
  activeEp: number
  loading: boolean
  submitting: boolean
  error: string | null
  notice: string | null
  reviewState: string | null
  reviewSubmitting: boolean
  onSwitchEp: (n: number) => void
  onStartDesign: () => void
  onConfirmEpisode: () => void
  onUnconfirmEpisode: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [selectedSeg, setSelectedSeg] = useState('')
  const visibleEps = expanded ? episodes : episodes.slice(0, 10)
  const epName = episodes.find((episode) => episode.episodeNumber === activeEp)?.name ?? ''
  const isConfirmed = reviewState === 'confirmed'

  useEffect(() => {
    setSelectedSeg('')
  }, [sb.episodeNumber, sb.source])

  let selScene: StoryScene | null = null
  let selSeg: StorySegment | null = null
  for (const scene of sb.scenes) {
    const found = scene.segments.find((segment) => segment.id === selectedSeg)
    if (found) { selScene = scene; selSeg = found; break }
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

      {(error || notice || loading) ? (
        <div className="border-b border-[var(--fos-border-soft)] px-4 py-2 text-[12px] font-semibold">
          {loading ? <span className="text-[var(--fos-text-3)]">正在加载本集分镜…</span> : null}
          {notice ? <span className="text-[#8fb0ff]">{notice}</span> : null}
          {error ? <span className="text-[#ff7777]">{error}</span> : null}
        </div>
      ) : null}

      <div className="sd3-body">
        <div className="sd3-middle">
          <div className="sd3-mid-ep-header">
            <div className="min-w-0">
              <div className="sd3-ep-name">E{sb.episodeNumber} · {epName}</div>
              <div className="sd3-ep-meta">
                {sb.sceneCount} 场景 · {sb.segmentCount} 片段 · {sb.totalSeconds}秒 · {sb.source === 'live' ? '已生成分镜' : sb.source === 'draft' ? '资产绑定草稿' : 'FrameOS TEST 参考'}
              </div>
            </div>
            <button className="sd3-redesign-entry-btn" style={{ marginLeft: 'auto' }} disabled={submitting} onClick={onStartDesign}>
              <AppIcon name="refresh" className="h-3.5 w-3.5" />{submitting ? '提交中…' : sb.source === 'live' ? '重新设计本集分镜' : '开始设计本集分镜'}
            </button>
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
                  <span className="sd3-sc-stats">{scene.segments.length} 段 · {scene.segments.reduce((sum, segment) => sum + segment.duration, 0)}s</span>
                </div>
                <div className="sd3-seg-list">
                  {scene.segments.map((segment) => (
                    <SegCard key={segment.id} seg={segment} selected={segment.id === selectedSeg} onSelect={() => setSelectedSeg(segment.id)} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
        {selSeg && selScene ? <RightPanel seg={selSeg} scene={selScene} /> : <RightPanelEmpty />}
      </div>

      <div className="sd3-bottom">
        <div className="sd3-action-bar">
          <div className="sd3-action-bar-left" />
          <div className="sd3-action-bar-right">
            {sb.source === 'live' ? (
              isConfirmed ? (
                <>
                  <span className="sd3-confirmed-hint">✓ 本集分镜已确认</span>
                  <button className="sd3-bottom-btn" disabled={reviewSubmitting} onClick={onUnconfirmEpisode}>取消确认</button>
                </>
              ) : (
                <button className="sd3-bottom-btn sd3-bottom-btn--primary" disabled={reviewSubmitting} onClick={onConfirmEpisode}>
                  <AppIcon name="check" className="h-4 w-4" />{reviewSubmitting ? '提交中…' : '确认本集分镜'}
                </button>
              )
            ) : (
              <button className="sd3-bottom-btn" disabled>{sb.source === 'draft' ? '生成分镜后可确认' : 'FrameOS TEST 参考'}</button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export function FosStoryboard({ data }: { data: FosProjectData }) {
  const episodes = data.usingDemo ? demoEpisodes : data.episodes
  const [activeEp, setActiveEp] = useState(data.usingDemo ? demoStoryboard.episodeNumber : (episodes[0]?.episodeNumber ?? 1))
  const [storyboards, setStoryboards] = useState<StoryboardRaw[]>([])
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [reviewSubmitting, setReviewSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [storyboardReviewState, setStoryboardReviewState] = useState<string | null>(null)
  const refreshTimers = useRef<number[]>([])

  const activeEpisode = episodes.find((episode) => episode.episodeNumber === activeEp) || episodes[0]

  useEffect(() => {
    if (episodes.length === 0) return
    if (!episodes.some((episode) => episode.episodeNumber === activeEp)) {
      setActiveEp(data.usingDemo ? demoStoryboard.episodeNumber : episodes[0].episodeNumber)
    }
  }, [activeEp, data.usingDemo, episodes])

  const loadStoryboards = useCallback(async (force = false) => {
    if (!activeEpisode || data.usingDemo) {
      setStoryboards([])
      setStoryboardReviewState(null)
      setLoading(false)
      return
    }
    const cacheKey = `${data.projectId}:${activeEpisode.id}`
    const cached = storyboardCache.get(cacheKey)
    if (!force && cached && Date.now() - cached.storedAt < STORYBOARD_CACHE_TTL_MS) {
      setStoryboards(cached.storyboards)
      setStoryboardReviewState(cached.reviewState)
      setLoading(false)
      return
    }
    if (!force && cached) {
      setStoryboards(cached.storyboards)
      setStoryboardReviewState(cached.reviewState)
    }
    setLoading(true)
    setError(null)
    try {
      const [json, stageJson] = await Promise.all([
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
      ])
      const nextStoryboards = Array.isArray(json.storyboards) ? json.storyboards : []
      const nextReviewState = stageJson?.stage?.reviewState || null
      storyboardCache.set(cacheKey, {
        storyboards: nextStoryboards,
        reviewState: nextReviewState,
        storedAt: Date.now(),
      })
      setStoryboards(nextStoryboards)
      setStoryboardReviewState(nextReviewState)
    } catch (err) {
      logError('[FosStoryboard] 加载分镜失败', err)
      setStoryboards([])
      setStoryboardReviewState(null)
      setError(err instanceof Error ? err.message : '加载分镜失败')
    } finally {
      setLoading(false)
    }
  }, [activeEpisode, data.projectId, data.usingDemo])

  useEffect(() => {
    void loadStoryboards()
  }, [loadStoryboards])

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
    if (!activeEpisode || data.usingDemo || submitting) return
    setSubmitting(true)
    setError(null)
    setNotice(null)
    try {
      const runRes = await apiFetch('/api/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: data.projectId,
          workflowType: 'script_to_storyboard_run',
          taskType: 'script_to_storyboard_run',
          targetType: 'NovelPromotionEpisode',
          targetId: activeEpisode.id,
          episodeId: activeEpisode.id,
          input: { episodeId: activeEpisode.id },
        }),
      })
      if (!runRes.ok) throw new Error(await readApiErrorMessage(runRes, '创建分镜运行失败'))
      const runJson = await runRes.json() as { runId?: string }
      const runId = runJson.runId
      if (!runId) throw new Error('创建分镜运行失败：缺少 runId')

      const submitRes = await apiFetch(`/api/novel-promotion/${data.projectId}/script-to-storyboard-stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          episodeId: activeEpisode.id,
          async: true,
          runId,
          meta: { runId },
        }),
      })
      if (!submitRes.ok) throw new Error(await readApiErrorMessage(submitRes, '提交分镜设计失败'))
      setNotice('已提交本集分镜设计任务，完成后会自动刷新。')
      scheduleRefreshes()
    } catch (err) {
      logError('[FosStoryboard] 提交分镜设计失败', err)
      setError(err instanceof Error ? err.message : '提交分镜设计失败')
    } finally {
      setSubmitting(false)
    }
  }

  const handleReviewAction = async (confirmed: boolean) => {
    if (!activeEpisode || data.usingDemo || reviewSubmitting) return
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
  const draftStoryboard = useMemo(
    () => buildDraftStoryboard(activeEpisode, data),
    [activeEpisode, data],
  )
  const sb = data.usingDemo ? demoToStoryboardEpisode() : (liveStoryboard || draftStoryboard)

  if (!sb) {
    return (
      <div className="flex flex-1 items-center justify-center text-[13px] text-[var(--fos-text-3)]">
        暂无分集数据，请先完成剧本解析。
      </div>
    )
  }

  return (
    <StoryboardSuccess
      sb={sb}
      episodes={episodes}
      activeEp={sb.episodeNumber}
      loading={loading}
      submitting={submitting}
      error={error}
      notice={notice}
      reviewState={storyboardReviewState}
      reviewSubmitting={reviewSubmitting}
      onSwitchEp={setActiveEp}
      onStartDesign={handleStartDesign}
      onConfirmEpisode={() => void handleReviewAction(true)}
      onUnconfirmEpisode={() => void handleReviewAction(false)}
    />
  )
}
