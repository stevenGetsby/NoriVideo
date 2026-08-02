'use client'

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { signOut, useSession } from 'next-auth/react'
import { useLocale } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import { apiFetch } from '@/lib/api-fetch'
import { readApiErrorMessage } from '@/lib/api/read-error-message'

type ModelType = 'llm' | 'image' | 'video' | 'audio' | 'lipsync'
type DefaultField = 'analysisModel' | 'characterModel' | 'locationModel' | 'storyboardModel' | 'editModel' | 'videoModel' | 'audioModel' | 'lipSyncModel'

interface BusinessModelDraft {
  key: string
  name: string
  description: string
  type: 'llm' | 'image' | 'video' | 'audio'
  tier: 'mini' | 'fast' | 'standard' | 'pro'
}

interface ProviderDraft {
  id: string
  name: string
  baseUrl?: string
  assetGroupId?: string
  gatewayRoute?: 'official' | 'openai-compat'
  apiMode?: 'gemini-sdk' | 'openai-official'
  hasApiKey: boolean
}

interface ModelDraft {
  modelId: string
  modelKey?: string
  name?: string
  type: ModelType
  provider: string
  llmProtocol?: 'responses' | 'chat-completions'
}

interface ServiceConfig {
  sourceFile: string
  updatedAt: string | null
  providers: ProviderDraft[]
  models: ModelDraft[]
  defaultModels: Partial<Record<DefaultField, string>>
  businessModels: BusinessModelDraft[]
  modelRouting: Record<string, string>
  storage: {
    type: 'tos'
    endpoint: string
    publicEndpoint: string
    region: string
    bucket: string
    forcePathStyle: boolean
    hasAccessKey: boolean
    hasSecretKey: boolean
  }
  videoRepaint: {
    providerId: string
    understandingModel: string
    adaptationModel: string
    fps: number
  }
}

interface HealthRow {
  targetType: 'provider' | 'storage'
  targetId: string
  status: 'healthy' | 'unhealthy'
  latencyMs: number | null
  message: string | null
  checkedAt: string
}

interface UsageRow {
  provider: string
  modelKey: string | null
  serviceType: string
  operation: string
  calls: number
  success: number
  failed: number
  inputTokens: number
  outputTokens: number
  units: number
  averageLatencyMs: number | null
  lastUsedAt: string
  cost: number
}

interface UsageOverview {
  rangeDays: number
  collectedSince: string
  summary: {
    calls: number
    success: number
    failed: number
    inputTokens: number
    outputTokens: number
    cost: number
    averageLatencyMs: number | null
  }
  rows: UsageRow[]
  storage: { objectCount: number; knownBytes: number }
}

interface ServicesPayload {
  config: ServiceConfig
  health: HealthRow[]
  usage: UsageOverview
}

interface ModelDiscoveryPayload {
  providerId: string
  availableCount: number
  models: ModelDraft[]
}

const MODEL_TYPE_LABELS: Record<ModelType, string> = {
  llm: '文本 LLM',
  image: '图片',
  video: '视频',
  audio: '语音',
  lipsync: '口型同步',
}

const MODEL_TIER_LABELS: Record<BusinessModelDraft['tier'], string> = {
  mini: 'Mini',
  fast: 'Fast',
  standard: '标准',
  pro: 'Pro',
}

const MODEL_TIER_TONES: Record<BusinessModelDraft['tier'], string> = {
  mini: 'border-emerald-400/25 bg-emerald-400/[.08] text-emerald-200',
  fast: 'border-cyan-400/25 bg-cyan-400/[.08] text-cyan-200',
  standard: 'border-blue-400/25 bg-blue-400/[.08] text-blue-200',
  pro: 'border-violet-400/25 bg-violet-400/[.09] text-violet-200',
}

function modelKey(model: ModelDraft) {
  return `${model.provider}::${model.modelId}`
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('zh-CN', { notation: value >= 100_000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(value)
}

function formatBytes(value: number) {
  if (!value) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1)
  return `${(value / 1024 ** index).toFixed(index > 1 ? 1 : 0)} ${units[index]}`
}

function formatDate(value: string | null) {
  if (!value) return '尚未检测'
  return new Date(value).toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Shanghai',
  })
}

function errorText(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

function StatusBadge({ health }: { health?: HealthRow }) {
  if (!health) return <span className="inline-flex items-center gap-1.5 text-[12px] text-slate-400"><i className="h-1.5 w-1.5 rounded-full bg-white/20" />未检测</span>
  const healthy = health.status === 'healthy'
  return (
    <span className={`inline-flex items-center gap-1.5 text-[12px] ${healthy ? 'text-emerald-300' : 'text-red-300'}`}>
      <i className={`h-1.5 w-1.5 rounded-full ${healthy ? 'bg-emerald-400' : 'bg-red-400'}`} />
      {healthy ? '正常' : '异常'}{health.latencyMs != null ? ` · ${health.latencyMs}ms` : ''}
    </span>
  )
}

export function PlatformAdminServicesClient() {
  const { data: session } = useSession()
  const locale = useLocale()
  const [config, setConfig] = useState<ServiceConfig | null>(null)
  const [health, setHealth] = useState<HealthRow[]>([])
  const [usage, setUsage] = useState<UsageOverview | null>(null)
  const [providerSecrets, setProviderSecrets] = useState<Record<string, string>>({})
  const [storageAccessKey, setStorageAccessKey] = useState('')
  const [storageSecretKey, setStorageSecretKey] = useState('')
  const [rangeDays, setRangeDays] = useState(30)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [probing, setProbing] = useState('')
  const [syncingProvider, setSyncingProvider] = useState('')
  const [dirty, setDirty] = useState(false)
  const [pageError, setPageError] = useState('')
  const [notice, setNotice] = useState('')

  const loadServices = useCallback(async (days = 30, preserveDraft = false) => {
    if (session?.user?.role !== 'super_admin') return
    setLoading(!preserveDraft)
    setPageError('')
    try {
      const response = await apiFetch(`/api/admin/services?days=${days}`, {
        cache: 'no-store',
        signal: AbortSignal.timeout(20_000),
      })
      if (!response.ok) throw new Error(await readApiErrorMessage(response, '获取服务配置失败'))
      const payload = await response.json() as ServicesPayload
      if (!preserveDraft) {
        setConfig(payload.config)
        setProviderSecrets({})
        setStorageAccessKey('')
        setStorageSecretKey('')
        setDirty(false)
      }
      setHealth(Array.isArray(payload.health) ? payload.health : [])
      setUsage(payload.usage)
    } catch (error) {
      setPageError(errorText(error, '获取服务配置失败'))
    } finally {
      setLoading(false)
    }
  }, [session?.user?.role])

  useEffect(() => { void loadServices(rangeDays) }, [loadServices, rangeDays])

  const healthMap = useMemo(() => new Map(health.map((row) => [`${row.targetType}:${row.targetId}`, row])), [health])
  const usageByProvider = useMemo(() => {
    const map = new Map<string, { calls: number; inputTokens: number; outputTokens: number; totalTokens: number }>()
    for (const row of usage?.rows || []) {
      const current = map.get(row.provider) || { calls: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 }
      current.calls += row.calls
      current.inputTokens += row.inputTokens
      current.outputTokens += row.outputTokens
      current.totalTokens += row.inputTokens + row.outputTokens
      map.set(row.provider, current)
    }
    return map
  }, [usage])

  const markConfig = (updater: (current: ServiceConfig) => ServiceConfig) => {
    setConfig((current) => current ? updater(current) : current)
    setDirty(true)
    setNotice('')
  }

  const updateProvider = (index: number, patch: Partial<ProviderDraft>) => markConfig((current) => ({
    ...current,
    providers: current.providers.map((provider, providerIndex) => providerIndex === index ? { ...provider, ...patch } : provider),
  }))

  const addProvider = () => {
    const suffix = Date.now().toString(36)
    markConfig((current) => ({
      ...current,
      providers: [...current.providers, {
        id: `openai-compatible:service-${suffix}`,
        name: '新的 LLM 服务',
        baseUrl: '',
        gatewayRoute: 'openai-compat',
        hasApiKey: false,
      }],
    }))
  }

  const removeProvider = (providerId: string) => {
    if (!window.confirm(`删除服务“${providerId}”及其模型配置？`)) return
    markConfig((current) => {
      const removedKeys = new Set(current.models.filter((model) => model.provider === providerId).map(modelKey))
      const nextDefaults = Object.fromEntries(Object.entries(current.defaultModels).filter(([, value]) => !removedKeys.has(value || ''))) as ServiceConfig['defaultModels']
      return {
        ...current,
        providers: current.providers.filter((provider) => provider.id !== providerId),
        models: current.models.filter((model) => model.provider !== providerId),
        defaultModels: nextDefaults,
        modelRouting: Object.fromEntries(
          Object.entries(current.modelRouting).filter(([, value]) => !removedKeys.has(value)),
        ),
      }
    })
  }

  const addModel = () => {
    if (!config?.providers.length) return
    markConfig((current) => ({
      ...current,
      models: [...current.models, {
        provider: current.providers[0].id,
        modelId: `model-${Date.now().toString(36)}`,
        name: '新模型',
        type: 'llm',
        llmProtocol: 'chat-completions',
      }],
    }))
  }

  const updateModel = (index: number, patch: Partial<ModelDraft>) => markConfig((current) => ({
    ...current,
    models: current.models.map((model, modelIndex) => modelIndex === index ? { ...model, ...patch } : model),
  }))

  const removeModel = (index: number) => markConfig((current) => {
    const removed = current.models[index]
    const removedKey = removed ? modelKey(removed) : ''
    return {
      ...current,
      models: current.models.filter((_, modelIndex) => modelIndex !== index),
      defaultModels: Object.fromEntries(Object.entries(current.defaultModels).filter(([, value]) => value !== removedKey)) as ServiceConfig['defaultModels'],
      modelRouting: Object.fromEntries(
        Object.entries(current.modelRouting).filter(([, value]) => value !== removedKey),
      ),
    }
  })

  const save = async () => {
    if (!config) return
    const changedProviderIds = config.providers
      .filter((provider) => Boolean(providerSecrets[provider.id]?.trim()))
      .map((provider) => provider.id)
    setSaving(true)
    setPageError('')
    setNotice('')
    try {
      const availableKeys = new Set(config.models.map(modelKey))
      const response = await apiFetch('/api/admin/services', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          providers: config.providers.map((provider) => ({
            ...provider,
            apiKey: providerSecrets[provider.id] || undefined,
          })),
          models: config.models,
          defaultModels: Object.fromEntries(Object.entries(config.defaultModels).filter(([, value]) => value && availableKeys.has(value))),
          modelRouting: Object.fromEntries(
            Object.entries(config.modelRouting).filter(([, value]) => value && availableKeys.has(value)),
          ),
          storage: {
            ...config.storage,
            accessKey: storageAccessKey || undefined,
            secretKey: storageSecretKey || undefined,
          },
          videoRepaint: config.videoRepaint,
        }),
        signal: AbortSignal.timeout(20_000),
      })
      if (!response.ok) throw new Error(await readApiErrorMessage(response, '保存服务配置失败'))
      const payload = await response.json() as { config: ServiceConfig }
      setConfig(payload.config)
      setProviderSecrets({})
      setStorageAccessKey('')
      setStorageSecretKey('')
      setDirty(false)
      setNotice(changedProviderIds.length
        ? '配置已保存并热加载，正在验证新密钥…'
        : '配置已保存并热加载，不需要重启服务。')

      const probeResults: HealthRow[] = []
      const probeFailures: string[] = []
      for (const providerId of changedProviderIds) {
        try {
          const probeResponse = await apiFetch('/api/admin/services/probe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ targetType: 'provider', targetId: providerId }),
          })
          if (!probeResponse.ok) {
            probeFailures.push(`${providerId}（${await readApiErrorMessage(probeResponse, '检测失败')}）`)
            continue
          }
          const probePayload = await probeResponse.json() as { health: HealthRow }
          probeResults.push(probePayload.health)
        } catch (error) {
          probeFailures.push(`${providerId}（${errorText(error, '检测失败')}）`)
        }
      }

      if (probeResults.length) {
        setHealth((current) => [
          ...probeResults,
          ...current.filter((row) => !probeResults.some((result) =>
            result.targetType === row.targetType && result.targetId === row.targetId)),
        ])
      }
      const unhealthy = probeResults.filter((row) => row.status !== 'healthy')
      const probeIssues = [
        ...unhealthy.map((row) => `${row.targetId}（${row.message || '连接失败'}）`),
        ...probeFailures,
      ]
      if (changedProviderIds.length) {
        setNotice(probeIssues.length
          ? `配置已保存，但连接检测异常：${probeIssues.join('、')}`
          : `配置已保存，${probeResults.map((row) => `${row.targetId} 连接正常${row.latencyMs == null ? '' : `（${row.latencyMs}ms）`}`).join('、')}。`)
      }
      await loadServices(rangeDays, true)
    } catch (error) {
      setPageError(errorText(error, '保存服务配置失败'))
    } finally {
      setSaving(false)
    }
  }

  const probe = async (targetType: 'provider' | 'storage', targetId: string) => {
    if (dirty) {
      setPageError('请先保存配置，再执行健康检测。')
      return
    }
    const probeKey = `${targetType}:${targetId}`
    setProbing(probeKey)
    setPageError('')
    try {
      const response = await apiFetch('/api/admin/services/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetType, targetId }),
      })
      if (!response.ok) throw new Error(await readApiErrorMessage(response, '健康检测失败'))
      const payload = await response.json() as { health: HealthRow }
      setHealth((current) => [payload.health, ...current.filter((row) => `${row.targetType}:${row.targetId}` !== probeKey)])
      await loadServices(rangeDays, true)
    } catch (error) {
      setPageError(errorText(error, '健康检测失败'))
    } finally {
      setProbing('')
    }
  }

  const syncProviderModels = async (providerId: string) => {
    if (!config) return
    if (dirty) {
      setPageError('请先保存当前配置，再同步服务商模型。')
      return
    }
    setSyncingProvider(providerId)
    setPageError('')
    setNotice('')
    try {
      const response = await apiFetch('/api/admin/services/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerId }),
      })
      if (!response.ok) throw new Error(await readApiErrorMessage(response, '同步模型失败'))
      const payload = await response.json() as ModelDiscoveryPayload
      const discoveredKeys = new Set(payload.models.map(modelKey))
      const syncsAllModalities = providerId.split(':')[0] === 'kuaizi'
      const currentProviderModels = config.models.filter((model) => (
        model.provider === providerId && (syncsAllModalities || model.type === 'llm')
      ))
      const addedCount = payload.models.filter((model) => !currentProviderModels.some((current) => modelKey(current) === modelKey(model))).length
      const removedKeys = new Set(currentProviderModels.filter((model) => !discoveredKeys.has(modelKey(model))).map(modelKey))

      markConfig((current) => ({
        ...current,
        models: [
          ...current.models.filter((model) => (
            model.provider !== providerId || (!syncsAllModalities && model.type !== 'llm')
          )),
          ...payload.models,
        ],
        defaultModels: Object.fromEntries(
          Object.entries(current.defaultModels).filter(([, value]) => !removedKeys.has(value || '')),
        ) as ServiceConfig['defaultModels'],
        modelRouting: Object.fromEntries(
          Object.entries(current.modelRouting).filter(([, value]) => !removedKeys.has(value)),
        ),
      }))
      setNotice(`已从 ${providerId} 读取 ${payload.availableCount} 个服务模型，整理出 ${payload.models.length} 个可配置模型；新增 ${addedCount} 个、移除 ${removedKeys.size} 个失效项。请点击“保存并热加载”。`)
    } catch (error) {
      setPageError(errorText(error, '同步模型失败'))
    } finally {
      setSyncingProvider('')
    }
  }

  const logout = () => { void signOut({ callbackUrl: `/${locale}/admin/signin` }) }
  const healthyProviders = config?.providers.filter((provider) => healthMap.get(`provider:${provider.id}`)?.status === 'healthy').length || 0

  return (
    <main
      className="nori-admin min-h-screen text-white"
      style={{
        '--fos-bg-1': '#0c1220',
        '--fos-bg-2': '#121a2a',
        '--fos-bg-3': '#182237',
        '--fos-bg-4': '#202d46',
        '--fos-text-1': '#f8faff',
        '--fos-text-2': '#dbe3f3',
        '--fos-text-3': '#aab7cd',
        '--fos-text-4': '#7f8da6',
        '--fos-primary': '#5c82f6',
        '--fos-primary-hover': '#6a8df8',
        '--fos-primary-soft': 'rgba(92,130,246,.13)',
        '--fos-primary-border': 'rgba(111,145,248,.34)',
        '--fos-border-soft': 'rgba(180,198,230,.08)',
        '--fos-border-mid': 'rgba(180,198,230,.13)',
        '--fos-border-strong': 'rgba(180,198,230,.2)',
        '--fos-fill-soft': 'rgba(255,255,255,.04)',
        '--fos-fill-mid': 'rgba(255,255,255,.08)',
        fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", "Segoe UI", sans-serif',
      } as CSSProperties}
    >
      <header className="nori-admin-header sticky top-0 z-30 flex h-[68px] items-center px-5 lg:px-8">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-blue-400/25 bg-[linear-gradient(145deg,rgba(82,215,255,.16),rgba(77,124,255,.18),rgba(124,92,255,.2))] text-[#8fb0ff]"><AppIcon name="lock" className="h-[18px] w-[18px]" /></span>
          <div><strong className="block text-[16px] font-bold tracking-[-.01em]">NoriVideo <span className="font-medium text-[#8fb0ff]">Admin</span></strong><span className="mt-0.5 block text-[11px] text-white/45">平台管理中心</span></div>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <div className="hidden text-right sm:block"><span className="block text-[13px] font-semibold text-white/90">{session?.user?.name || 'Platform Admin'}</span><span className="block text-[11px] text-white/45">平台最高管理员</span></div>
          <button type="button" onClick={logout} className="flex h-9 items-center gap-2 rounded-lg border border-white/[.12] bg-white/[.04] px-3 text-[13px] text-white/70 transition hover:bg-white/[.08] hover:text-white"><AppIcon name="logout" className="h-4 w-4" />退出</button>
        </div>
      </header>

      <div className="nori-admin-layout mx-auto flex w-full max-w-[1540px]">
        <aside className="nori-admin-sidebar sticky top-[68px] hidden h-[calc(100vh-68px)] w-[236px] shrink-0 px-4 py-6 lg:block">
          <p className="px-3 text-[11px] font-semibold tracking-[.12em] text-white/40">平台管理</p>
          <nav className="mt-3 space-y-1.5">
            <a href={`/${locale}/admin/accounts`} className="flex items-center gap-3 rounded-lg px-3 py-3 text-[14px] text-white/60 transition hover:bg-white/[.05] hover:text-white"><AppIcon name="usersRound" className="h-[18px] w-[18px]" />账号与用量</a>
            <a href={`/${locale}/admin/reviewers`} className="flex items-center gap-3 rounded-lg px-3 py-3 text-[14px] text-white/60 transition hover:bg-white/[.05] hover:text-white"><AppIcon name="clipboardCheck" className="h-[18px] w-[18px]" />审核分配</a>
            <a href={`/${locale}/admin/services`} className="flex items-center gap-3 rounded-lg border border-blue-400/25 bg-blue-500/[.12] px-3 py-3 text-[14px] font-semibold text-[#b8c9ff]"><AppIcon name="settingsHex" className="h-[18px] w-[18px]" />服务配置</a>
          </nav>
          <div className="mt-8 rounded-xl border border-amber-300/15 bg-amber-300/[.05] p-4"><AppIcon name="alert" className="h-4 w-4 text-amber-200/80" /><p className="mt-3 text-[12px] leading-6 text-white/60">这里修改的是全平台服务，保存后会影响全部管理账号和角色子账号。</p></div>
        </aside>

        <section className="nori-admin-content min-w-0 flex-1 px-5 py-7 lg:px-9 lg:py-9">
          <div className="mb-5 flex gap-2 lg:hidden"><a href={`/${locale}/admin/accounts`} className="fos-btn fos-btn-ghost fos-btn-sm">管理账号</a><a href={`/${locale}/admin/reviewers`} className="fos-btn fos-btn-ghost fos-btn-sm">审核分配</a><a href={`/${locale}/admin/services`} className="fos-btn fos-btn-primary fos-btn-sm">服务配置</a></div>
          <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
            <div><span className="text-[12px] font-semibold tracking-[.1em] text-[#8fb0ff]">SERVICE GOVERNANCE</span><h1 className="mt-2 text-[28px] font-bold tracking-[-.025em]">服务配置</h1><p className="mt-2 text-[14px] text-white/55">统一管理模型、密钥、生成服务、健康状态和 TOS，不再手改环境变量。</p></div>
            <div className="flex items-center gap-2"><span className={`text-[12px] ${dirty ? 'text-amber-300' : 'text-white/45'}`}>{dirty ? '有未保存修改' : config?.updatedAt ? `更新于 ${formatDate(config.updatedAt)}` : ''}</span><button type="button" onClick={() => void save()} disabled={!dirty || saving || !config} className="flex h-10 items-center gap-2 rounded-lg bg-[#4d7cff] px-4 text-[14px] font-semibold text-white shadow-[0_8px_24px_rgba(77,124,255,.22)] transition hover:bg-[#3b6df0] disabled:cursor-not-allowed disabled:opacity-40"><AppIcon name={saving ? 'loader' : 'check'} className={`h-4 w-4 ${saving ? 'animate-spin' : ''}`} />{saving ? '保存中' : '保存并热加载'}</button></div>
          </div>

          {pageError ? <div className="mb-5 rounded-lg border border-red-400/20 bg-red-400/[.08] px-4 py-3 text-[13px] text-red-200">{pageError}</div> : null}
          {notice ? <div className="mb-5 rounded-lg border border-emerald-400/20 bg-emerald-400/[.07] px-4 py-3 text-[13px] text-emerald-200">{notice}</div> : null}

          {loading || !config ? <div className="nori-admin-panel rounded-xl border py-24 text-center text-[13px] text-white/50">正在读取服务器服务配置…</div> : (
            <div className="space-y-6">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {[
                  ['外部服务', config.providers.length, 'cpu'],
                  ['健康服务', `${healthyProviders}/${config.providers.length}`, 'badgeCheck'],
                  [`${usage?.rangeDays || rangeDays} 天调用`, formatNumber(usage?.summary.calls || 0), 'chart'],
                  ['TOS 已登记', `${usage?.storage.objectCount || 0} · ${formatBytes(usage?.storage.knownBytes || 0)}`, 'cloudUpload'],
                ].map(([label, value, icon]) => <div key={String(label)} className="nori-admin-metric rounded-xl border p-4"><div className="flex items-center justify-between text-[12px] text-white/50"><span>{label}</span><AppIcon name={icon as 'cpu'} className="h-4 w-4 text-[#7ea4ff]" /></div><strong className="mt-3 block text-[22px] font-semibold">{value}</strong></div>)}
              </div>

              <section className="nori-admin-panel rounded-xl border">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-600/50 px-5 py-4"><div><h2 className="text-[15px] font-semibold">LLM 与生成服务</h2><p className="mt-1 text-[12px] text-slate-400">API Key 永不回显；输入新 Key 才会替换旧值。</p></div><button type="button" className="fos-btn fos-btn-ghost fos-btn-sm" onClick={addProvider}><AppIcon name="plus" className="h-3.5 w-3.5" />添加服务</button></div>
                <div className="grid gap-4 p-5 xl:grid-cols-2">
                  {config.providers.map((provider, index) => {
                    const providerHealth = healthMap.get(`provider:${provider.id}`)
                    const providerUsage = usageByProvider.get(provider.id)
                    const isArk = provider.id.split(':')[0] === 'ark'
                    const isKuaizi = provider.id.split(':')[0] === 'kuaizi'
                    const canSyncModels = ['ghc', 'deepseek', 'kuaizi'].includes(provider.id.split(':')[0])
                    const hasPendingSecret = Boolean(providerSecrets[provider.id]?.trim())
                    return <article key={`${provider.id}-${index}`} className="nori-admin-card rounded-xl border p-4">
                      <div className="mb-4 flex items-start justify-between gap-3"><div><div className="flex items-center gap-2"><strong className="text-[14px]">{provider.name || provider.id}</strong><StatusBadge health={providerHealth} /></div><p className="mt-1 text-[12px] text-slate-400">{providerHealth?.message || '保存后可以执行连通性检测'} · {formatDate(providerHealth?.checkedAt || null)}</p></div><div className="flex flex-wrap justify-end gap-1">{canSyncModels ? <button type="button" className="fos-btn fos-btn-ghost fos-btn-sm" disabled={syncingProvider === provider.id} onClick={() => void syncProviderModels(provider.id)}>{syncingProvider === provider.id ? '同步中' : '同步模型'}</button> : null}<button type="button" className="fos-btn fos-btn-ghost fos-btn-sm" disabled={probing === `provider:${provider.id}`} onClick={() => void probe('provider', provider.id)}>{probing === `provider:${provider.id}` ? '检测中' : '检测'}</button><button type="button" className="fos-icon-btn text-red-300" onClick={() => removeProvider(provider.id)}><AppIcon name="trash" className="h-3.5 w-3.5" /></button></div></div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className="text-[12px] text-slate-300">服务名称<input className="fos-input mt-1.5 w-full text-[13px]" value={provider.name} onChange={(event) => updateProvider(index, { name: event.target.value })} /></label>
                        <label className="text-[12px] text-slate-300">Provider ID<input className="fos-input mt-1.5 w-full text-[13px]" value={provider.id} disabled={provider.hasApiKey} onChange={(event) => updateProvider(index, { id: event.target.value.toLowerCase() })} /></label>
                        {!isArk ? <label className="text-[12px] text-slate-300 sm:col-span-2">Base URL<input className="fos-input mt-1.5 w-full text-[13px]" value={provider.baseUrl || ''} placeholder="https://api.example.com/v1" onChange={(event) => updateProvider(index, { baseUrl: event.target.value })} /></label> : null}
                        {isKuaizi ? <label className="text-[12px] text-slate-300 sm:col-span-2">素材组 ID<input className="fos-input mt-1.5 w-full text-[13px]" value={provider.assetGroupId || ''} placeholder="筷子丽帧素材组 ID" onChange={(event) => updateProvider(index, { assetGroupId: event.target.value.trim() })} /></label> : null}
                        <label className="text-[12px] text-slate-300 sm:col-span-2"><span className="flex items-center justify-between"><span>API Key</span><span className={hasPendingSecret ? 'text-amber-300' : provider.hasApiKey ? 'text-emerald-300' : 'text-red-300'}>{hasPendingSecret ? '待保存' : provider.hasApiKey ? '已配置' : '未配置'}</span></span><input type="password" autoComplete="new-password" className="fos-input mt-1.5 w-full text-[13px]" value={providerSecrets[provider.id] || ''} placeholder={provider.hasApiKey ? '已配置；留空表示不修改' : '请输入 API Key'} onChange={(event) => { setProviderSecrets((current) => ({ ...current, [provider.id]: event.target.value })); setDirty(true) }} /></label>
                      </div>
                      <div className="mt-3 flex items-center justify-between border-t border-white/[.08] pt-3 text-[12px] text-white/50"><span>{config.models.filter((model) => model.provider === provider.id).length} 个模型</span><span>{providerUsage ? `${providerUsage.calls} 次 · input ${formatNumber(providerUsage.inputTokens)} / output ${formatNumber(providerUsage.outputTokens)}` : '暂无用量'}</span></div>
                    </article>
                  })}
                </div>
              </section>

              <section className="nori-admin-panel overflow-hidden rounded-xl border">
                <div className="flex items-center justify-between border-b border-slate-600/50 px-5 py-4"><div><h2 className="text-[15px] font-semibold">模型配置</h2><p className="mt-1 text-[12px] text-slate-400">模型键由 Provider ID 与 Model ID 自动组成。</p></div><button type="button" className="fos-btn fos-btn-ghost fos-btn-sm" onClick={addModel}><AppIcon name="plus" className="h-3.5 w-3.5" />添加模型</button></div>
                <div className="overflow-x-auto"><div className="min-w-[1040px]"><div className="grid grid-cols-[180px_190px_190px_130px_180px_52px] gap-3 border-b border-slate-600/40 px-5 py-3 text-[12px] font-semibold text-slate-400"><span>名称</span><span>Model ID</span><span>服务</span><span>类型</span><span>LLM 协议</span><span /></div>{config.models.map((model, index) => <div key={`${modelKey(model)}-${index}`} className="grid grid-cols-[180px_190px_190px_130px_180px_52px] items-center gap-3 border-b border-slate-600/30 px-5 py-3 last:border-0"><input className="fos-input h-9 text-[13px]" value={model.name || ''} onChange={(event) => updateModel(index, { name: event.target.value })} /><input className="fos-input h-9 text-[13px]" value={model.modelId} onChange={(event) => updateModel(index, { modelId: event.target.value })} /><select className="fos-input h-9 text-[13px]" value={model.provider} onChange={(event) => updateModel(index, { provider: event.target.value })}>{config.providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}</select><select className="fos-input h-9 text-[13px]" value={model.type} onChange={(event) => updateModel(index, { type: event.target.value as ModelType })}>{Object.entries(MODEL_TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>{model.type === 'llm' ? <select className="fos-input h-9 text-[13px]" value={model.llmProtocol || ''} onChange={(event) => updateModel(index, { llmProtocol: event.target.value as ModelDraft['llmProtocol'] })}><option value="">官方协议</option><option value="responses">Responses API</option><option value="chat-completions">Chat Completions</option></select> : <span className="text-[12px] text-slate-500">—</span>}<button type="button" className="fos-icon-btn text-red-300" onClick={() => removeModel(index)}><AppIcon name="trash" className="h-4 w-4" /></button></div>)}</div></div>
              </section>

              <div className="grid gap-6 xl:grid-cols-2">
                <section className="nori-admin-panel rounded-xl border p-5">
                  <h2 className="text-[16px] font-semibold">业务模型路由</h2>
                  <p className="mt-1 text-[13px] text-white/55">Mini 用于低成本预演，Fast 用于快速迭代，Pro 用于正式生产；未接入的档位会在创作端禁用。</p>
                  <div className="mt-4 space-y-3">
                    {config.businessModels.map((businessModel) => {
                      const targetKey = config.modelRouting[businessModel.key] || ''
                      const targetProvider = targetKey.split('::')[0] || ''
                      return (
                        <label key={businessModel.key} className="nori-admin-card grid gap-2 rounded-lg border p-3 sm:grid-cols-[170px_1fr] sm:items-center">
                          <span>
                            <span className="flex items-center gap-2">
                              <strong className="block text-[13px] text-white">{businessModel.name}</strong>
                              <em className={`rounded-full border px-1.5 py-0.5 text-[9px] font-bold not-italic ${MODEL_TIER_TONES[businessModel.tier]}`}>{MODEL_TIER_LABELS[businessModel.tier]}</em>
                            </span>
                            <span className="mt-1 block text-[12px] text-white/50">{businessModel.description}</span>
                          </span>
                          <span>
                            <select className="fos-input h-9 w-full text-[13px]" value={targetKey} onChange={(event) => markConfig((current) => ({ ...current, modelRouting: { ...current.modelRouting, [businessModel.key]: event.target.value } }))}>
                              <option value="">未接入</option>
                              {config.models.filter((model) => model.type === businessModel.type).map((model) => <option key={modelKey(model)} value={modelKey(model)}>{model.name || model.modelId} · {model.provider}</option>)}
                            </select>
                            <span className="mt-1.5 flex items-center justify-between text-[12px] text-white/50"><span>{targetKey || '该档位暂不可用'}</span>{targetProvider ? <StatusBadge health={healthMap.get(`provider:${targetProvider}`)} /> : null}</span>
                          </span>
                        </label>
                      )
                    })}
                  </div>
                </section>

                <section className="nori-admin-panel rounded-xl border p-5"><h2 className="text-[16px] font-semibold">视频转绘模型</h2><p className="mt-1 text-[13px] text-white/55">直接控制视频反译、分镜提取和海外改编，不再读取 ARK 模型环境变量。</p><div className="mt-4 grid gap-3 sm:grid-cols-2"><label className="text-[13px] text-white/75">服务<select className="fos-input mt-1.5 h-9 w-full text-[13px]" value={config.videoRepaint.providerId} onChange={(event) => markConfig((current) => ({ ...current, videoRepaint: { ...current.videoRepaint, providerId: event.target.value } }))}>{config.providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}</select></label><label className="text-[13px] text-white/75">抽帧 FPS<input type="number" min="0.1" max="10" step="0.1" className="fos-input mt-1.5 h-9 w-full text-[13px]" value={config.videoRepaint.fps} onChange={(event) => markConfig((current) => ({ ...current, videoRepaint: { ...current.videoRepaint, fps: Number(event.target.value) } }))} /></label><label className="text-[13px] text-white/75 sm:col-span-2">视频理解模型 ID<input className="fos-input mt-1.5 w-full text-[13px]" value={config.videoRepaint.understandingModel} onChange={(event) => markConfig((current) => ({ ...current, videoRepaint: { ...current.videoRepaint, understandingModel: event.target.value } }))} /></label><label className="text-[13px] text-white/75 sm:col-span-2">剧本转绘模型 ID<input className="fos-input mt-1.5 w-full text-[13px]" value={config.videoRepaint.adaptationModel} onChange={(event) => markConfig((current) => ({ ...current, videoRepaint: { ...current.videoRepaint, adaptationModel: event.target.value } }))} /></label></div></section>
              </div>

              <section className="nori-admin-panel rounded-xl border p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><h2 className="text-[16px] font-semibold">火山 TOS 存储</h2><StatusBadge health={healthMap.get('storage:tos')} /></div><p className="mt-1 text-[13px] text-white/55">检测会执行一次极小文件的上传、读取、签名访问与删除。</p></div><button type="button" className="fos-btn fos-btn-ghost fos-btn-sm" disabled={probing === 'storage:tos'} onClick={() => void probe('storage', 'tos')}>{probing === 'storage:tos' ? '检测中' : '检测 TOS'}</button></div><div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3"><label className="text-[13px] text-white/75">Endpoint<input className="fos-input mt-1.5 w-full text-[13px]" value={config.storage.endpoint} onChange={(event) => markConfig((current) => ({ ...current, storage: { ...current.storage, endpoint: event.target.value } }))} /></label><label className="text-[13px] text-white/75">Public Endpoint<input className="fos-input mt-1.5 w-full text-[13px]" value={config.storage.publicEndpoint} onChange={(event) => markConfig((current) => ({ ...current, storage: { ...current.storage, publicEndpoint: event.target.value } }))} /></label><label className="text-[13px] text-white/75">Region<input className="fos-input mt-1.5 w-full text-[13px]" value={config.storage.region} onChange={(event) => markConfig((current) => ({ ...current, storage: { ...current.storage, region: event.target.value } }))} /></label><label className="text-[13px] text-white/75">Bucket<input className="fos-input mt-1.5 w-full text-[13px]" value={config.storage.bucket} onChange={(event) => markConfig((current) => ({ ...current, storage: { ...current.storage, bucket: event.target.value } }))} /></label><label className="text-[13px] text-white/75">AccessKey ID<input type="password" className="fos-input mt-1.5 w-full text-[13px]" autoComplete="new-password" value={storageAccessKey} placeholder={config.storage.hasAccessKey ? '已配置；留空不修改' : '请输入 AccessKey ID'} onChange={(event) => { setStorageAccessKey(event.target.value); setDirty(true) }} /></label><label className="text-[13px] text-white/75">SecretAccessKey<input type="password" className="fos-input mt-1.5 w-full text-[13px]" autoComplete="new-password" value={storageSecretKey} placeholder={config.storage.hasSecretKey ? '已配置；留空不修改' : '请输入 SecretAccessKey'} onChange={(event) => { setStorageSecretKey(event.target.value); setDirty(true) }} /></label></div></section>

              <section className="nori-admin-panel overflow-hidden rounded-xl border">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[.08] px-5 py-4">
                  <div><h2 className="text-[16px] font-semibold">服务用量</h2><p className="mt-1 text-[13px] text-white/55">按模型记录 input token、output token、调用次数、耗时与失败次数。</p></div>
                  <select className="fos-input h-9 w-auto text-[13px]" value={rangeDays} onChange={(event) => setRangeDays(Number(event.target.value))}><option value={7}>近 7 天</option><option value={30}>近 30 天</option><option value={90}>近 90 天</option></select>
                </div>
                <div className="grid gap-3 border-b border-white/[.08] p-5 sm:grid-cols-2 xl:grid-cols-7">
                  {[
                    ['调用', usage?.summary.calls || 0],
                    ['成功', usage?.summary.success || 0],
                    ['失败', usage?.summary.failed || 0],
                    ['输入 Token', usage?.summary.inputTokens || 0],
                    ['输出 Token', usage?.summary.outputTokens || 0],
                    ['总 Token', (usage?.summary.inputTokens || 0) + (usage?.summary.outputTokens || 0)],
                    ['计费金额', `¥${(usage?.summary.cost || 0).toFixed(4)}`],
                  ].map(([label, value]) => <div key={String(label)} className="nori-admin-metric rounded-lg px-4 py-3"><span className="text-[12px] text-white/50">{label}</span><strong className="mt-1 block text-[19px]">{typeof value === 'number' ? formatNumber(value) : value}</strong></div>)}
                </div>
                <div className="overflow-x-auto">
                  <div className="min-w-[1280px]">
                    <div className="grid grid-cols-[135px_230px_80px_80px_135px_135px_135px_105px_105px_130px] gap-3 border-b border-white/[.08] px-5 py-3 text-[12px] font-semibold text-white/45"><span>服务</span><span>模型</span><span>调用</span><span>失败</span><span>Input Token</span><span>Output Token</span><span>Total Token</span><span>金额</span><span>平均耗时</span><span>最近使用</span></div>
                    {usage?.rows.length ? usage.rows.map((row) => (
                      <div key={`${row.provider}-${row.modelKey}-${row.serviceType}-${row.operation}`} className="grid grid-cols-[135px_230px_80px_80px_135px_135px_135px_105px_105px_130px] gap-3 border-b border-white/[.06] px-5 py-3 text-[13px] last:border-0">
                        <span className="truncate font-medium text-white">{row.provider}</span><span className="truncate text-white/70">{row.modelKey || row.serviceType}</span><span>{row.calls}</span><span className={row.failed ? 'text-red-300' : 'text-white/65'}>{row.failed}</span><span>{formatNumber(row.inputTokens)}</span><span>{formatNumber(row.outputTokens)}</span><strong>{formatNumber(row.inputTokens + row.outputTokens)}</strong><span>¥{row.cost.toFixed(4)}</span><span>{row.averageLatencyMs == null ? '—' : `${row.averageLatencyMs}ms`}</span><span className="text-white/50">{formatDate(row.lastUsedAt)}</span>
                      </div>
                    )) : <div className="px-5 py-12 text-center text-[13px] text-white/45">暂无已采集的服务用量</div>}
                  </div>
                </div>
              </section>
            </div>
          )}
        </section>
      </div>
    </main>
  )
}
