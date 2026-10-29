'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { AppIcon } from '@/components/ui/icons'
import { apiFetch } from '@/lib/api-fetch'
import { readApiErrorMessage } from '@/lib/api/read-error-message'
import { notifyProjectChanged } from '@/lib/projects/change-client'
import { ViewportDialogLayer } from './ViewportDialogLayer'
import { ProjectDownloadDirectory } from './ProjectDownloadDirectory'
import { DEFAULT_VIDEO_EXPORT_TEMPLATE, validateVideoExportTemplate } from '@/lib/novel-promotion/video-export-name'

type ModelField = 'analysisModel' | 'characterModel' | 'locationModel' | 'editModel' | 'videoModel'
type ModelTier = 'mini' | 'fast' | 'standard' | 'pro'
type ModelOption = { value: string; label: string; tier?: ModelTier }
type ProjectStyle = 'live-action' | 'anime-3d' | 'anime-2.5d' | 'anime-2d' | 'anime'
type TargetAudience = 'zh-platform' | 'global-platform'
type VideoRatio = '9:16' | '16:9'
type VideoResolution = '480p' | '720p' | '1080p' | '4K'
type EpisodeDurationMode = 'per-episode' | 'per-1000-chars'

const MODEL_TIER_LABELS: Record<ModelTier, string> = {
  mini: 'Mini',
  fast: 'Fast',
  standard: '标准',
  pro: 'Pro',
}

function modelOptionLabel(model: ModelOption) {
  return `${model.label} · ${MODEL_TIER_LABELS[model.tier || 'standard']}`
}

interface UserModelsPayload {
  text: ModelOption[]
  image: ModelOption[]
  video: ModelOption[]
}

type ModelConfig = Record<ModelField, string | null>

interface ProjectSettings {
  projectStyle: ProjectStyle
  targetAudience: TargetAudience
  videoRatio: VideoRatio
  videoResolution: VideoResolution
  episodeDurationMode: EpisodeDurationMode
  episodeDurationValue: number | ''
  artStylePrompt: string
  exportNamingTemplate: string
  exportDirectoryHint: string
}

const FIELD_DEFINITIONS: Array<{
  field: ModelField
  label: string
  description: string
  type: keyof UserModelsPayload
}> = [
  { field: 'analysisModel', label: '文本分析', description: '剧本分析、资产抽取与分镜文本', type: 'text' },
  { field: 'characterModel', label: '角色图片', description: '角色定妆与形象生成', type: 'image' },
  { field: 'locationModel', label: '场景图片', description: '环境与场景资产生成', type: 'image' },
  { field: 'editModel', label: '图片编辑', description: '参考图修改与局部重绘', type: 'image' },
  { field: 'videoModel', label: '分镜视频', description: '镜头视频生成', type: 'video' },
]

const STYLE_OPTIONS: Array<{ value: ProjectStyle; label: string }> = [
  { value: 'live-action', label: '仿真人' },
  { value: 'anime-3d', label: '3D 动漫' },
  { value: 'anime-2.5d', label: '2.5D 动漫' },
  { value: 'anime-2d', label: '2D 动漫' },
  { value: 'anime', label: '动漫' },
]

const AUDIENCE_OPTIONS: Array<{ value: TargetAudience; label: string }> = [
  { value: 'global-platform', label: '海外平台' },
  { value: 'zh-platform', label: '中文平台' },
]

const RATIO_OPTIONS: Array<{ value: VideoRatio; label: string }> = [
  { value: '9:16', label: '竖版 9:16' },
  { value: '16:9', label: '横版 16:9' },
]

const RESOLUTION_OPTIONS: Array<{ value: VideoResolution; label: string }> = [
  { value: '480p', label: '480p' },
  { value: '720p', label: '720p' },
  { value: '1080p', label: '1080p' },
  { value: '4K', label: '4K' },
]

const DURATION_MODE_OPTIONS: Array<{ value: EpisodeDurationMode; label: string }> = [
  { value: 'per-episode', label: '每集' },
  { value: 'per-1000-chars', label: '每千字' },
]

const DEFAULT_SETTINGS: ProjectSettings = {
  projectStyle: 'live-action',
  targetAudience: 'global-platform',
  videoRatio: '9:16',
  videoResolution: '480p',
  episodeDurationMode: 'per-episode',
  episodeDurationValue: 120,
  artStylePrompt: '',
  exportNamingTemplate: DEFAULT_VIDEO_EXPORT_TEMPLATE,
  exportDirectoryHint: '',
}

function normalizeEnumValue<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && allowed.includes(value as T) ? value as T : fallback
}

function durationBounds(mode: EpisodeDurationMode) {
  return mode === 'per-episode' ? { minimum: 10, maximum: 3600 } : { minimum: 1, maximum: 600 }
}

function ProjectSettingsSelect<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: Array<{ value: T; label: string }>
  onChange: (value: T) => void
}) {
  return (
    <label className="rounded-xl border border-[var(--fos-border-mid)] bg-[var(--fos-bg-3)] p-4 transition-colors focus-within:border-[var(--fos-primary-border)]">
      <span className="block text-[13px] font-bold text-white">{label}</span>
      <select className="fos-input mt-3 w-full text-[13px]" value={value} onChange={(event) => onChange(event.target.value as T)}>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  )
}

const EMPTY_CONFIG: ModelConfig = {
  analysisModel: null,
  characterModel: null,
  locationModel: null,
  editModel: null,
  videoModel: null,
}

function errorText(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

export function FosProjectModelConfigDialog({
  projectId,
  open,
  onClose,
  onSaved,
}: {
  projectId: string
  open: boolean
  onClose: () => void
  onSaved?: () => void
}) {
  const [models, setModels] = useState<UserModelsPayload>({ text: [], image: [], video: [] })
  const [config, setConfig] = useState<ModelConfig>(EMPTY_CONFIG)
  const [settings, setSettings] = useState<ProjectSettings>(DEFAULT_SETTINGS)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [details, setDetails] = useState({ name: '', description: '' })
  const [loaded, setLoaded] = useState(false)
  const originalDetails = useRef({ name: '', description: '' })
  const loadSequence = useRef(0)

  const load = useCallback(async () => {
    const sequence = ++loadSequence.current
    setLoading(true)
    setLoaded(false)
    setError('')
    try {
      const [modelsResponse, projectResponse, detailsResponse] = await Promise.all([
        apiFetch('/api/user/models'),
        apiFetch(`/api/novel-promotion/${encodeURIComponent(projectId)}`),
        apiFetch(`/api/projects/${encodeURIComponent(projectId)}`, { cache: 'no-store' }),
      ])
      if (!modelsResponse.ok) throw new Error(await readApiErrorMessage(modelsResponse, '获取业务模型失败'))
      if (!projectResponse.ok) throw new Error(await readApiErrorMessage(projectResponse, '获取作品模型配置失败'))
      if (!detailsResponse.ok) throw new Error(await readApiErrorMessage(detailsResponse, '获取作品信息失败'))
      const modelPayload = await modelsResponse.json() as UserModelsPayload
      const projectPayload = await projectResponse.json() as { modelConfig?: Partial<ModelConfig> } & Partial<ProjectSettings>
      const detailsPayload = await detailsResponse.json() as { project?: { name?: string; description?: string | null } }
      if (sequence !== loadSequence.current) return
      const nextDetails = { name: detailsPayload.project?.name || '', description: detailsPayload.project?.description || '' }
      originalDetails.current = nextDetails
      setDetails(nextDetails)
      setModels({
        text: Array.isArray(modelPayload.text) ? modelPayload.text : [],
        image: Array.isArray(modelPayload.image) ? modelPayload.image : [],
        video: Array.isArray(modelPayload.video) ? modelPayload.video : [],
      })
      const incoming = projectPayload.modelConfig || {}
      setConfig({
        analysisModel: incoming.analysisModel || null,
        characterModel: incoming.characterModel || null,
        locationModel: incoming.locationModel || null,
        editModel: incoming.editModel || null,
        videoModel: incoming.videoModel || null,
      })
      const duration = Number(projectPayload.episodeDurationValue)
      setSettings({
        projectStyle: normalizeEnumValue(projectPayload.projectStyle, STYLE_OPTIONS.map((option) => option.value), 'live-action'),
        targetAudience: normalizeEnumValue(projectPayload.targetAudience, AUDIENCE_OPTIONS.map((option) => option.value), 'global-platform'),
        videoRatio: normalizeEnumValue(projectPayload.videoRatio, RATIO_OPTIONS.map((option) => option.value), '9:16'),
        videoResolution: normalizeEnumValue(projectPayload.videoResolution, RESOLUTION_OPTIONS.map((option) => option.value), '480p'),
        episodeDurationMode: normalizeEnumValue(projectPayload.episodeDurationMode, DURATION_MODE_OPTIONS.map((option) => option.value), 'per-episode'),
        episodeDurationValue: Number.isFinite(duration) && duration > 0 ? Math.floor(duration) : '',
        artStylePrompt: typeof projectPayload.artStylePrompt === 'string' ? projectPayload.artStylePrompt : '',
        exportNamingTemplate: typeof projectPayload.exportNamingTemplate === 'string' && projectPayload.exportNamingTemplate.trim()
          ? projectPayload.exportNamingTemplate
          : DEFAULT_SETTINGS.exportNamingTemplate,
        exportDirectoryHint: typeof projectPayload.exportDirectoryHint === 'string' ? projectPayload.exportDirectoryHint : '',
      })
      setLoaded(true)
    } catch (loadError) {
      if (sequence === loadSequence.current) setError(errorText(loadError, '获取作品模型配置失败'))
    } finally {
      if (sequence === loadSequence.current) setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    if (open) void load()
    return () => { loadSequence.current += 1 }
  }, [load, open])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose, open, saving])

  const save = async () => {
    if (!loaded || saving) return
    setSaving(true)
    setError('')
    let configSaved = false
    try {
      const name = details.name.trim()
      if (!name || name.length > 191) throw new Error('作品名称须为 1–191 个字符')
      const duration = Number(settings.episodeDurationValue)
      if (!validateVideoExportTemplate(settings.exportNamingTemplate.trim() || DEFAULT_VIDEO_EXPORT_TEMPLATE)) throw new Error('导出规则包含未知占位符或路径；请使用下方列出的字段。')
      const bounds = durationBounds(settings.episodeDurationMode)
      if (!Number.isInteger(duration) || duration < bounds.minimum || duration > bounds.maximum) {
        throw new Error(`单集时长必须是 ${bounds.minimum}-${bounds.maximum} 之间的整数`)
      }
      const response = await apiFetch(`/api/novel-promotion/${encodeURIComponent(projectId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...config,
          ...settings,
          episodeDurationValue: duration,
          targetEpisodeDurationSeconds: duration,
          artStylePrompt: settings.artStylePrompt.trim(),
          exportNamingTemplate: settings.exportNamingTemplate.trim() || DEFAULT_SETTINGS.exportNamingTemplate,
          exportDirectoryHint: settings.exportDirectoryHint.trim(),
        }),
      })
      if (!response.ok) throw new Error(await readApiErrorMessage(response, '保存作品模型配置失败'))
      configSaved = true
      notifyProjectChanged(projectId)
      if (name !== originalDetails.current.name || details.description.trim() !== originalDetails.current.description) {
        const detailResponse = await apiFetch(`/api/projects/${encodeURIComponent(projectId)}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, description: details.description.trim() || null }),
        })
        if (!detailResponse.ok) throw new Error(await readApiErrorMessage(detailResponse, '保存作品名称与简介失败'))
        notifyProjectChanged(projectId)
      }
      onSaved?.()
      onClose()
    } catch (saveError) {
      setError(`${configSaved ? '生成配置已保存，作品信息尚未保存：' : ''}${errorText(saveError, '保存作品失败')}`)
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null
  return (
    <ViewportDialogLayer>
    <div className="fos-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose() }}>
      <section role="dialog" aria-modal="true" aria-label="编辑作品" className="fos-dialog w-full max-w-[760px] rounded-2xl shadow-[0_28px_90px_rgba(0,0,0,.62)]">
        <header className="fos-dialog-head flex items-start justify-between bg-[linear-gradient(110deg,rgba(255,255,255,.1),rgba(255,255,255,.08),transparent_70%)]">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--fos-primary-border)] bg-[var(--fos-primary-soft)] text-[var(--fos-primary-text)]"><AppIcon name="settingsHex" className="h-5 w-5" /></span>
            <div><h2 className="text-[18px] font-bold text-white">编辑作品</h2><p className="mt-1 text-[12px] leading-5 text-[var(--fos-text-3)]">作品参与人员可修改名称、简介和后续生成配置，不会删除已有剧本与资产；删除作品由管理员维护。</p></div>
          </div>
          <button type="button" className="fos-icon-btn" aria-label="关闭" disabled={saving} onClick={onClose}><AppIcon name="close" className="h-4 w-4" /></button>
        </header>
        <div className="fos-dialog-body max-h-[68vh] overflow-y-auto p-6">
          {loaded ? <section className="mb-6 grid gap-4">
            <h3 className="text-[14px] font-bold text-white">基本信息</h3>
            <label><span className="mb-2 block">作品名称</span><input aria-label="作品名称" className="fos-input" maxLength={191} value={details.name} onChange={(event) => setDetails((current) => ({ ...current, name: event.target.value }))} /></label>
            <label><span className="mb-2 block">作品简介</span><textarea aria-label="作品简介" className="fos-textarea" maxLength={5000} value={details.description} onChange={(event) => setDetails((current) => ({ ...current, description: event.target.value }))} /></label>
          </section> : null}
          {loading ? null : (
            <section className="mb-6">
              <h3 className="mb-3 text-[14px] font-bold text-white">生成配置</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <ProjectSettingsSelect
                  label="作品风格"
                  value={settings.projectStyle}
                  options={STYLE_OPTIONS}
                  onChange={(value) => setSettings((current) => ({ ...current, projectStyle: value }))}
                />
                <ProjectSettingsSelect
                  label="目标受众"
                  value={settings.targetAudience}
                  options={AUDIENCE_OPTIONS}
                  onChange={(value) => setSettings((current) => ({ ...current, targetAudience: value }))}
                />
                <ProjectSettingsSelect
                  label="视频比例"
                  value={settings.videoRatio}
                  options={RATIO_OPTIONS}
                  onChange={(value) => setSettings((current) => ({ ...current, videoRatio: value }))}
                />
                <ProjectSettingsSelect
                  label="视频分辨率"
                  value={settings.videoResolution}
                  options={RESOLUTION_OPTIONS}
                  onChange={(value) => setSettings((current) => ({ ...current, videoResolution: value }))}
                />
                <ProjectSettingsSelect
                  label="单集时长方式"
                  value={settings.episodeDurationMode}
                  options={DURATION_MODE_OPTIONS}
                  onChange={(value) => setSettings((current) => ({ ...current, episodeDurationMode: value }))}
                />
                <label className="rounded-xl border border-[var(--fos-border-mid)] bg-[var(--fos-bg-3)] p-4 transition-colors focus-within:border-[var(--fos-primary-border)]">
                  <span className="block text-[13px] font-bold text-white">单集时长</span>
                  <span className="mt-1 block text-[12px] text-[var(--fos-text-3)]">{settings.episodeDurationMode === 'per-episode' ? '秒 / 集' : '秒 / 千字'}</span>
                  <input
                    className="fos-input mt-3 w-full text-[13px]"
                    type="number"
                    min={durationBounds(settings.episodeDurationMode).minimum}
                    max={durationBounds(settings.episodeDurationMode).maximum}
                    step={1}
                    value={settings.episodeDurationValue}
                    onChange={(event) => setSettings((current) => ({ ...current, episodeDurationValue: event.target.value === '' ? '' : Number(event.target.value) }))}
                  />
                </label>
              </div>
              <label className="mt-4 block rounded-xl border border-[var(--fos-border-mid)] bg-[var(--fos-bg-3)] p-4 transition-colors focus-within:border-[var(--fos-primary-border)]">
                <span className="block text-[13px] font-bold text-white">自定义画风提示词</span>
                <span className="mt-1 block text-[12px] leading-5 text-[var(--fos-text-3)]">填写后完全覆盖作品风格；留空则按所选作品风格生成。修改会影响后续资产、分镜和视频任务。</span>
                <textarea
                  className="fos-input mt-3 min-h-[110px] w-full resize-y text-[13px] leading-6"
                  maxLength={5000}
                  value={settings.artStylePrompt}
                  onChange={(event) => setSettings((current) => ({ ...current, artStylePrompt: event.target.value }))}
                />
                <span className="mt-2 block text-right text-[11px] text-[var(--fos-text-4)]">{settings.artStylePrompt.length} / 5000</span>
              </label>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <label className="rounded-xl border border-[var(--fos-border-mid)] bg-[var(--fos-bg-3)] p-4">
                  <span className="block text-[13px] font-bold text-white">导出视频命名规则</span>
                  <span className="mt-1 block text-[12px] leading-5 text-[var(--fos-text-3)]">可用：{'{project}'} {'{episode}'} {'{sequence}'} {'{generation}'} {'{creator}'} {'{attempt}'}</span>
                  <input className="fos-input mt-3 w-full text-[13px]" maxLength={191} value={settings.exportNamingTemplate} onChange={(event) => setSettings((current) => ({ ...current, exportNamingTemplate: event.target.value }))} />
                  <span className="mt-2 block text-[11px] text-[var(--fos-text-4)]">默认：项目_生成名_视频001_创建者.mp4；详细规则可设置为 {'{project}_{episode}_{generation}_{attempt}次生成_{creator}'}。</span>
                </label>
                <label className="rounded-xl border border-[var(--fos-border-mid)] bg-[var(--fos-bg-3)] p-4">
                  <span className="block text-[13px] font-bold text-white">成员本地下载目录提示</span>
                  <span className="mt-1 block text-[12px] leading-5 text-[var(--fos-text-3)]">每位成员首次导出时选择自己电脑的目录；系统会按作品记住该成员的选择。</span>
                  <input className="fos-input mt-3 w-full text-[13px]" maxLength={500} placeholder="例如：D:\NoriVideoDownloads\机甲三国" value={settings.exportDirectoryHint} onChange={(event) => setSettings((current) => ({ ...current, exportDirectoryHint: event.target.value }))} />
                  <div className="mt-3"><ProjectDownloadDirectory projectId={projectId} /></div>
                  <p className="mt-2 text-[11px] text-[var(--fos-text-4)]">此路径是团队提示，不会让服务器写入本机。每位成员需要点击选择自己设备的目录；其它账号和电脑不会继承授权。</p>
                </label>
              </div>
            </section>
          )}
          {loading ? <div className="py-20 text-center text-[13px] text-[var(--fos-text-3)]">正在读取模型配置…</div> : (
            <div className="grid gap-4 sm:grid-cols-2">
              {FIELD_DEFINITIONS.map((definition) => (
                <label key={definition.field} className="rounded-xl border border-[var(--fos-border-mid)] bg-[var(--fos-bg-3)] p-4 transition-colors focus-within:border-[var(--fos-primary-border)]">
                  <span className="block text-[13px] font-bold text-white">{definition.label}</span>
                  <span className="mt-1 block text-[12px] leading-5 text-[var(--fos-text-3)]">{definition.description}</span>
                  <select className="fos-input mt-3 w-full text-[13px]" disabled={models[definition.type].length === 0} value={config[definition.field] || ''} onChange={(event) => setConfig((current) => ({ ...current, [definition.field]: event.target.value || null }))}>
                    <option value="">{models[definition.type].length ? '请选择模型' : '平台尚未接入此类模型'}</option>
                    {models[definition.type].map((model) => <option key={model.value} value={model.value}>{modelOptionLabel(model)}</option>)}
                  </select>
                </label>
              ))}
            </div>
          )}
          <div className="mt-4 rounded-xl border border-[var(--fos-primary-border)] bg-[var(--fos-primary-soft)] px-4 py-3 text-[12px] leading-5 text-[var(--fos-text-1)]">分镜设计只生成结构化镜头文本；作品不会单独生成“分镜静态图”。镜头制作阶段直接使用“分镜视频”模型。</div>
          {error ? <div className="mt-4 rounded-lg border border-red-400/20 bg-red-400/[.08] px-3 py-2 text-[12px] text-red-200">{error}</div> : null}
        </div>
        <footer className="fos-dialog-foot"><button type="button" className="fos-btn fos-btn-ghost" disabled={saving} onClick={onClose}>取消</button><button type="button" className="fos-btn fos-btn-primary" disabled={!loaded || loading || saving || !details.name.trim()} onClick={() => void save()}>{saving ? '保存中…' : '保存作品'}</button></footer>
      </section>
    </div>
    </ViewportDialogLayer>
  )
}
