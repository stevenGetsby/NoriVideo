'use client'

import { confirmAction } from '@/lib/ui/feedback'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSession } from 'next-auth/react'
import { AppIcon } from '@/components/ui/icons'
import { AdminAlert, AdminEmpty, AdminMetric, PlatformAdminShell } from '@/components/admin/PlatformAdminShell'
import { PlatformAdminServicesPanels } from '@/components/admin/PlatformAdminServicesPanels'
import { apiFetch } from '@/lib/api-fetch'
import { readApiErrorMessage } from '@/lib/api/read-error-message'
import {
  errorText,
  formatBytes,
  formatDate,
  formatNumber,
  modelKey,
  type HealthRow,
  type ModelDiscoveryPayload,
  type ModelDraft,
  type ProviderDraft,
  type ServiceConfig,
  type ServicesPayload,
  type UsageOverview,
} from '@/components/admin/platform-admin-services'

export function PlatformAdminServicesClient() {
  const { data: session } = useSession()
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
    const map = new Map<string, { calls: number; cost: number }>()
    for (const row of usage?.rows || []) {
      const current = map.get(row.provider) || { calls: 0, cost: 0 }
      current.calls += row.calls
      current.cost += row.cost
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

  const removeProvider = async (providerId: string) => {
    if (!await confirmAction({
      title: `删除服务「${providerId}」？`,
      message: '该服务下的模型配置会一并移除，引用这些模型的默认配置也会被清空。',
      confirmLabel: '删除',
      danger: true,
    })) return
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

  const healthyProviders = config?.providers.filter((provider) => healthMap.get(`provider:${provider.id}`)?.status === 'healthy').length || 0

  return (
    <PlatformAdminShell
      active="services"
      eyebrow="平台管理"
      title="服务配置"
      description="统一管理模型、密钥、生成服务、健康状态和 TOS，不再手改环境变量。"
      actions={(
        <>
          <span className={dirty ? 'nori-admin-dirty' : 'nori-admin-muted'}>
            {dirty ? '有未保存修改' : config?.updatedAt ? `更新于 ${formatDate(config.updatedAt)}` : ''}
          </span>
          <button type="button" onClick={() => void save()} disabled={!dirty || saving || !config} className="fos-btn fos-btn-primary">
            <AppIcon name={saving ? 'loader' : 'check'} className={`h-4 w-4 ${saving ? 'animate-spin' : ''}`} />
            {saving ? '保存中' : '保存并热加载'}
          </button>
        </>
      )}
    >
      {pageError ? <AdminAlert tone="error">{pageError}</AdminAlert> : null}
      {notice ? <AdminAlert tone="success">{notice}</AdminAlert> : null}
      {loading || !config ? <AdminEmpty>正在读取服务器服务配置…</AdminEmpty> : (
        <>
          <div className="nori-admin-metrics">
            <AdminMetric label="外部服务" value={config.providers.length} icon="cpu" />
            <AdminMetric label="健康服务" value={`${healthyProviders}/${config.providers.length}`} icon="badgeCheck" />
            <AdminMetric label={`${usage?.rangeDays || rangeDays} 天调用`} value={formatNumber(usage?.summary.calls || 0)} icon="chart" />
            <AdminMetric label="TOS 已登记" value={`${usage?.storage.objectCount || 0} · ${formatBytes(usage?.storage.knownBytes || 0)}`} icon="cloudUpload" />
          </div>
          <PlatformAdminServicesPanels
            config={config}
            usage={usage}
            rangeDays={rangeDays}
            healthMap={healthMap}
            usageByProvider={usageByProvider}
            providerSecrets={providerSecrets}
            storageAccessKey={storageAccessKey}
            storageSecretKey={storageSecretKey}
            probing={probing}
            syncingProvider={syncingProvider}
            markConfig={markConfig}
            updateProvider={updateProvider}
            addProvider={addProvider}
            removeProvider={removeProvider}
            addModel={addModel}
            updateModel={updateModel}
            removeModel={removeModel}
            setProviderSecrets={setProviderSecrets}
            setStorageAccessKey={setStorageAccessKey}
            setStorageSecretKey={setStorageSecretKey}
            setDirty={setDirty}
            setRangeDays={setRangeDays}
            probe={probe}
            syncProviderModels={syncProviderModels}
          />
        </>
      )}
    </PlatformAdminShell>
  )
}
