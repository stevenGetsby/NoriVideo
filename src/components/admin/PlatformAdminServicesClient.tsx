'use client'

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
            Object.entries(config.modelRouting).map(([key, value]) => [key, value && availableKeys.has(value) ? value : '']),
          ),
          storage: {
            ...config.storage,
            accessKey: storageAccessKey || undefined,
            secretKey: storageSecretKey || undefined,
          },
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

  const healthyProviders = config?.providers.filter((provider) => healthMap.get(`provider:${provider.id}`)?.status === 'healthy').length || 0

  return (
    <PlatformAdminShell
      active="services"
      eyebrow="平台管理"
      title="服务配置"
      description="两套 API，清晰分工；创作模型、素材存储和调用用量各归其位。"
      actions={(
        <>
          <span className={dirty ? 'nori-admin-dirty' : 'nori-admin-muted'}>
            {dirty ? '有未保存修改' : config?.updatedAt ? `更新于 ${formatDate(config.updatedAt)}` : ''}
          </span>
          <button type="button" onClick={() => void save()} disabled={!dirty || saving || !config} title={!config ? '正在读取服务配置' : saving ? '正在保存并热加载' : dirty ? '保存全部服务配置并立即生效' : '当前没有待保存的修改'} className="fos-btn fos-btn-primary">
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
            markConfig={markConfig}
            updateProvider={updateProvider}
            setProviderSecrets={setProviderSecrets}
            setStorageAccessKey={setStorageAccessKey}
            setStorageSecretKey={setStorageSecretKey}
            setDirty={setDirty}
            setRangeDays={setRangeDays}
            probe={probe}
          />
        </>
      )}
    </PlatformAdminShell>
  )
}
