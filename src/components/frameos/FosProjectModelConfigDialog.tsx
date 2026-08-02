'use client'

import { useCallback, useEffect, useState } from 'react'
import { AppIcon } from '@/components/ui/icons'
import { apiFetch } from '@/lib/api-fetch'
import { readApiErrorMessage } from '@/lib/api/read-error-message'

type ModelField = 'analysisModel' | 'characterModel' | 'locationModel' | 'editModel' | 'videoModel'
type ModelTier = 'mini' | 'fast' | 'standard' | 'pro'
type ModelOption = { value: string; label: string; tier?: ModelTier }

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
}: {
  projectId: string
  open: boolean
  onClose: () => void
}) {
  const [models, setModels] = useState<UserModelsPayload>({ text: [], image: [], video: [] })
  const [config, setConfig] = useState<ModelConfig>(EMPTY_CONFIG)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [modelsResponse, projectResponse] = await Promise.all([
        apiFetch('/api/user/models'),
        apiFetch(`/api/novel-promotion/${encodeURIComponent(projectId)}`),
      ])
      if (!modelsResponse.ok) throw new Error(await readApiErrorMessage(modelsResponse, '获取业务模型失败'))
      if (!projectResponse.ok) throw new Error(await readApiErrorMessage(projectResponse, '获取项目模型配置失败'))
      const modelPayload = await modelsResponse.json() as UserModelsPayload
      const projectPayload = await projectResponse.json() as { modelConfig?: Partial<ModelConfig> }
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
    } catch (loadError) {
      setError(errorText(loadError, '获取项目模型配置失败'))
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    if (open) void load()
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
    setSaving(true)
    setError('')
    try {
      const response = await apiFetch(`/api/novel-promotion/${encodeURIComponent(projectId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      })
      if (!response.ok) throw new Error(await readApiErrorMessage(response, '保存项目模型配置失败'))
      onClose()
    } catch (saveError) {
      setError(errorText(saveError, '保存项目模型配置失败'))
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose() }}>
      <section role="dialog" aria-modal="true" aria-label="项目模型配置" className="w-full max-w-[760px] overflow-hidden rounded-2xl border border-[var(--fos-border-strong)] bg-[var(--fos-bg-2)] shadow-[0_28px_90px_rgba(0,0,0,.62)]">
        <header className="flex items-start justify-between border-b border-[var(--fos-border-mid)] bg-[linear-gradient(110deg,rgba(59,130,246,.14),rgba(124,92,255,.08),transparent_70%)] px-6 py-5">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--fos-primary-border)] bg-[var(--fos-primary-soft)] text-[#8fb0ff]"><AppIcon name="settingsHex" className="h-5 w-5" /></span>
            <div><h2 className="text-[18px] font-bold text-white">项目模型配置</h2><p className="mt-1 text-[12px] leading-5 text-[var(--fos-text-3)]">为当前项目选择业务模型；真实供应商与密钥由平台管理端统一路由。</p></div>
          </div>
          <button type="button" className="fos-icon-btn" aria-label="关闭" disabled={saving} onClick={onClose}><AppIcon name="close" className="h-4 w-4" /></button>
        </header>
        <div className="max-h-[68vh] overflow-y-auto p-6">
          {loading ? <div className="py-20 text-center text-[13px] text-[var(--fos-text-3)]">正在读取模型配置…</div> : (
            <div className="grid gap-4 sm:grid-cols-2">
              {FIELD_DEFINITIONS.map((definition) => (
                <label key={definition.field} className="rounded-xl border border-[var(--fos-border-mid)] bg-[var(--fos-bg-3)] p-4 transition-colors focus-within:border-[var(--fos-primary-border)]">
                  <span className="block text-[13px] font-bold text-white">{definition.label}</span>
                  <span className="mt-1 block text-[12px] leading-5 text-[var(--fos-text-3)]">{definition.description}</span>
                  <select className="fos-input mt-3 h-10 w-full text-[13px]" disabled={models[definition.type].length === 0} value={config[definition.field] || ''} onChange={(event) => setConfig((current) => ({ ...current, [definition.field]: event.target.value || null }))}>
                    <option value="">{models[definition.type].length ? '请选择模型' : '平台尚未接入此类模型'}</option>
                    {models[definition.type].map((model) => <option key={model.value} value={model.value}>{modelOptionLabel(model)}</option>)}
                  </select>
                </label>
              ))}
            </div>
          )}
          <div className="mt-4 rounded-xl border border-blue-400/15 bg-blue-500/[.06] px-4 py-3 text-[12px] leading-5 text-[#9eb8ff]">分镜设计只生成结构化镜头文本；项目不会单独生成“分镜静态图”。镜头制作阶段直接使用“分镜视频”模型。</div>
          {error ? <div className="mt-4 rounded-lg border border-red-400/20 bg-red-400/[.08] px-3 py-2 text-[12px] text-red-200">{error}</div> : null}
        </div>
        <footer className="flex justify-end gap-2 border-t border-[var(--fos-border-mid)] bg-[var(--fos-bg-1)] px-6 py-4"><button type="button" className="fos-btn fos-btn-ghost" disabled={saving} onClick={onClose}>取消</button><button type="button" className="fos-btn fos-btn-primary" disabled={loading || saving} onClick={() => void save()}>{saving ? '保存中…' : '保存配置'}</button></footer>
      </section>
    </div>
  )
}
