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
  type VideoProviderStatus,
  type VideoSwitchPlan,
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
  const [videoProvider, setVideoProvider] = useState<VideoProviderStatus | null>(null)
  const [videoPlan, setVideoPlan] = useState<VideoSwitchPlan | null>(null)
  const [videoSwitching, setVideoSwitching] = useState(false)
  const [videoNotice, setVideoNotice] = useState('')

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

  const loadVideoProviderStatus = useCallback(async (): Promise<VideoProviderStatus | null> => {
    if (session?.user?.role !== 'super_admin') return null
    try {
      const response = await apiFetch('/api/admin/services/video-provider', {
        cache: 'no-store',
        signal: AbortSignal.timeout(20_000),
      })
      if (!response.ok) throw new Error(await readApiErrorMessage(response, '获取视频服务商状态失败'))
      const payload = await response.json() as VideoProviderStatus & { success: boolean }
      const status: VideoProviderStatus = { current: payload.current, inFlight: payload.inFlight }
      setVideoProvider(status)
      return status
    } catch (error) {
      setPageError(errorText(error, '获取视频服务商状态失败'))
      return null
    }
  }, [session?.user?.role])

  useEffect(() => { void loadVideoProviderStatus() }, [loadVideoProviderStatus])

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
    setVideoPlan(null)
  }

  const updateProvider = (index: number, patch: Partial<ProviderDraft>) => markConfig((current) => ({
    ...current,
    providers: current.providers.map((provider, providerIndex) => providerIndex === index ? { ...provider, ...patch } : provider),
  }))

  const requestVideoPlan = async (target: 'kuaizi' | 'tgg') => {
    setVideoSwitching(true)
    setPageError('')
    setVideoNotice('')
    try {
      const response = await apiFetch('/api/admin/services/video-provider', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target, dryRun: true }),
        signal: AbortSignal.timeout(20_000),
      })
      if (!response.ok) throw new Error(await readApiErrorMessage(response, '获取切换预览失败'))
      const payload = await response.json() as { success: boolean; plan: VideoSwitchPlan }
      setVideoPlan(payload.plan)
    } catch (error) {
      setPageError(errorText(error, '获取切换预览失败'))
    } finally {
      setVideoSwitching(false)
    }
  }

  const cancelVideoPlan = () => setVideoPlan(null)

  const applyVideoPlan = async () => {
    if (!videoPlan) return
    const target = videoPlan.target
    setVideoSwitching(true)
    setPageError('')
    setVideoNotice('')
    try {
      const response = await apiFetch('/api/admin/services/video-provider', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target }),
        signal: AbortSignal.timeout(20_000),
      })
      const payload = await response.json().catch(() => null) as { success?: boolean; plan?: VideoSwitchPlan } | null
      if (!response.ok || !payload?.success) {
        if (payload?.plan) setVideoPlan(payload.plan)
        throw new Error(payload?.plan?.blockers?.length ? payload.plan.blockers.join('；') : '视频服务商切换失败')
      }
      const switchedKeys = (payload.plan?.rows || []).map((row) => row.businessKey)
      setVideoPlan(null)
      const status = await loadVideoProviderStatus()
      const counts = status?.inFlight || videoProvider?.inFlight || { kuaizi: 0, tgg: 0 }
      setVideoNotice(`已切换到 ${target === 'tgg' ? 'TGG' : 'Kuaizi'}，新任务立即生效；进行中的 ${counts.kuaizi + counts.tgg} 个任务不受影响`)
      // 切换只改视频路由：仅用服务端结果覆盖本次涉及的业务键，保留用户未保存的其它修改
      const servicesResponse = await apiFetch(`/api/admin/services?days=${rangeDays}`, {
        cache: 'no-store',
        signal: AbortSignal.timeout(20_000),
      })
      if (!servicesResponse.ok) throw new Error('切换已生效，但刷新服务配置失败，请刷新页面')
      const servicesPayload = await servicesResponse.json() as ServicesPayload
      setConfig((current) => {
        if (!current) return current
        const modelRouting = { ...current.modelRouting }
        for (const key of switchedKeys) modelRouting[key] = servicesPayload.config.modelRouting[key] || ''
        return { ...current, modelRouting }
      })
    } catch (error) {
      setPageError(errorText(error, '视频服务商切换失败'))
    } finally {
      setVideoSwitching(false)
    }
  }






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
      setVideoPlan(null)
      void loadVideoProviderStatus()
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
      description="五套 API 各司其职：DeepSeek 文本、Kuaizi 语音，图片可在 OpenLux / 绘梦工坊 之间切换，视频可在 Kuaizi / 绘梦工坊 / TGG 之间切换。"
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
            videoProvider={videoProvider}
            videoPlan={videoPlan}
            videoSwitching={videoSwitching}
            videoNotice={videoNotice}
            dirty={dirty}
            requestVideoPlan={(target) => void requestVideoPlan(target)}
            cancelVideoPlan={cancelVideoPlan}
            applyVideoPlan={() => void applyVideoPlan()}
          />
        </>
      )}
    </PlatformAdminShell>
  )
}
