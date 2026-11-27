'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSession } from 'next-auth/react'
import { AppIcon } from '@/components/ui/icons'
import { AdminAlert, AdminLoading, AdminMetric, PlatformAdminShell, type AdminNavKey } from '@/components/admin/PlatformAdminShell'
import { PlatformAdminServicesPanels } from '@/components/admin/PlatformAdminServicesPanels'
import { apiFetch } from '@/lib/api-fetch'
import { readApiErrorMessage } from '@/lib/api/read-error-message'
import { formatUsageMoney } from '@/lib/platform-services/model-type-usage'
import {
  errorText,
  formatBytes,
  formatDate,
  formatNumber,
  modelKey,
  type AdminServicesSection,
  type HealthRow,
  type ModelViewUser,
  type ProviderDraft,
  type ServiceConfig,
  type ServicesPayload,
  type UsageOverview,
} from '@/components/admin/platform-admin-services'

const SECTION_META: Record<AdminServicesSection, {
  active: AdminNavKey
  eyebrow: string
  title: string
  description: string
}> = {
  providers: {
    active: 'services',
    eyebrow: '核心平台',
    title: '服务商与密钥',
    description: '管理上游模型服务商的 API Key、接口地址、Kuaizi 专项参数与连接健康检测。',
  },
  models: {
    active: 'models',
    eyebrow: '核心平台',
    title: '模型与全局路由',
    description: '统一控制全局视频模型开关、文本/图片/语音默认底层路由与画布喵导（Agent）模型开放策略。',
  },
  customers: {
    active: 'customer-models',
    eyebrow: '核心平台',
    title: '客户模型策略',
    description: '管理全局默认白标模型、按客户主账号定制可见模型与专属底层供应商，以及内部完整视图白名单。',
  },
  usage: {
    active: 'usage',
    eyebrow: '核心平台',
    title: '存储与用量',
    description: '检查 TOS 素材存储连通性与对象登记，并按服务商与模型维度核对上游调用量及估算成本。',
  },
  all: {
    active: 'services',
    eyebrow: '核心平台',
    title: '服务配置',
    description: '统一管理上游服务商密钥、模型开关与路由、客户白标视图与内部白名单、素材存储及调用对账。',
  },
}

function countRecordDiffs(
  before: Record<string, unknown> | undefined,
  after: Record<string, unknown> | undefined,
): number {
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})])
  let count = 0
  for (const key of keys) {
    if (JSON.stringify(before?.[key]) !== JSON.stringify(after?.[key])) count += 1
  }
  return count
}

function computeConfigDiffCount(
  baseline: ServiceConfig | null,
  current: ServiceConfig | null,
  providerSecrets: Record<string, string>,
  storageAccessKey: string,
  storageSecretKey: string,
): number {
  if (!baseline || !current) return 0
  let count = 0
  for (const value of Object.values(providerSecrets)) {
    if (value.trim()) count += 1
  }
  if (storageAccessKey.trim()) count += 1
  if (storageSecretKey.trim()) count += 1

  const baseProviders = new Map(baseline.providers.map((item) => [item.id, item]))
  for (const provider of current.providers) {
    const prev = baseProviders.get(provider.id)
    if (!prev) { count += 1; continue }
    if ((prev.assetGroupId || '') !== (provider.assetGroupId || '')) count += 1
    if ((prev.seedance25IntlKzep || '') !== (provider.seedance25IntlKzep || '')) count += 1
  }

  count += countRecordDiffs(baseline.modelEnabled, current.modelEnabled)
  count += countRecordDiffs(baseline.modelRouting, current.modelRouting)
  count += countRecordDiffs(baseline.customerVisibleModels, current.customerVisibleModels)
  count += countRecordDiffs(baseline.customerModelOverrides, current.customerModelOverrides)
  count += countRecordDiffs(baseline.customerModelRoutingOverrides, current.customerModelRoutingOverrides)
  count += countRecordDiffs(baseline.agentModels, current.agentModels)

  const prevInternal = [...(baseline.internalModelViewUserIds ?? [])].sort().join(',')
  const nextInternal = [...(current.internalModelViewUserIds ?? [])].sort().join(',')
  if (prevInternal !== nextInternal) count += 1

  for (const field of ['endpoint', 'publicEndpoint', 'region', 'bucket'] as const) {
    if (baseline.storage[field] !== current.storage[field]) count += 1
  }
  return count
}

export function PlatformAdminServicesClient({ section = 'providers' }: { section?: AdminServicesSection }) {
  const { data: session } = useSession()
  const [config, setConfig] = useState<ServiceConfig | null>(null)
  const [savedConfig, setSavedConfig] = useState<ServiceConfig | null>(null)
  const [health, setHealth] = useState<HealthRow[]>([])
  const [usage, setUsage] = useState<UsageOverview | null>(null)
  const [modelViewUsers, setModelViewUsers] = useState<ModelViewUser[]>([])
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
        setSavedConfig(payload.config)
        setProviderSecrets({})
        setStorageAccessKey('')
        setStorageSecretKey('')
        setDirty(false)
      }
      setHealth(Array.isArray(payload.health) ? payload.health : [])
      setUsage(payload.usage)
      setModelViewUsers(Array.isArray(payload.modelViewUsers) ? payload.modelViewUsers : [])
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

  const changeCount = useMemo(
    () => computeConfigDiffCount(savedConfig, config, providerSecrets, storageAccessKey, storageSecretKey),
    [savedConfig, config, providerSecrets, storageAccessKey, storageSecretKey],
  )

  const markConfig = (updater: (current: ServiceConfig) => ServiceConfig) => {
    setConfig((current) => current ? updater(current) : current)
    setDirty(true)
    setNotice('')
  }

  const updateProvider = (index: number, patch: Partial<ProviderDraft>) => markConfig((current) => ({
    ...current,
    providers: current.providers.map((provider, providerIndex) => providerIndex === index ? { ...provider, ...patch } : provider),
  }))

  const resetDraft = () => {
    if (!savedConfig) return
    setConfig(savedConfig)
    setProviderSecrets({})
    setStorageAccessKey('')
    setStorageSecretKey('')
    setDirty(false)
    setPageError('')
    setNotice('已放弃未保存修改，恢复至当前生效配置。')
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
            Object.entries(config.modelRouting).map(([key, value]) =>
              [key, key === 'nori::canvas-agent' || (value && availableKeys.has(value)) ? value : '']),
          ),
          modelEnabled: config.modelEnabled,
          customerVisibleModels: config.customerVisibleModels,
          internalModelViewUserIds: config.internalModelViewUserIds,
          customerModelOverrides: config.customerModelOverrides !== undefined
            ? Object.fromEntries(
                Object.entries(config.customerModelOverrides)
                  .map(([userId, overrides]) => [userId.trim(), overrides] as const)
                  .filter(([userId, overrides]) => Boolean(userId) && Object.keys(overrides).length > 0),
              )
            : undefined,
          customerModelRoutingOverrides: config.customerModelRoutingOverrides !== undefined
            ? Object.fromEntries(
                Object.entries(config.customerModelRoutingOverrides)
                  .map(([userId, routes]) => [
                    userId.trim(),
                    Object.fromEntries(
                      Object.entries(routes)
                        .map(([businessKey, runtimeKey]) => [businessKey.trim(), runtimeKey.trim()] as const)
                        .filter(([businessKey, runtimeKey]) => Boolean(businessKey) && Boolean(runtimeKey)),
                    ),
                  ] as const)
                  .filter(([userId, routes]) => Boolean(userId) && Object.keys(routes).length > 0),
              )
            : undefined,
          agentModels: config.agentModels,
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
      setSavedConfig(payload.config)
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

  const meta = SECTION_META[section]
  const isEditableSection = section === 'providers' || section === 'models' || section === 'customers' || section === 'all'
  const healthyProviders = config?.providers.filter((provider) => healthMap.get(`provider:${provider.id}`)?.status === 'healthy').length || 0
  const configuredProviders = config?.providers.filter((provider) => provider.hasApiKey || Boolean(providerSecrets[provider.id]?.trim())).length || 0
  const videoModels = config?.models.filter((model) => model.type === 'video') || []
  const enabledVideoModels = videoModels.filter((model) => config?.modelEnabled?.[modelKey(model)] === true).length
  const nonVideoBusinessModels = config?.businessModels.filter((model) => model.type !== 'video') || []
  const routedBusinessModels = nonVideoBusinessModels.filter((model) => Boolean(config?.modelRouting[model.key])).length
  const agentCandidates = config?.canvasAgentModelCatalog?.models ?? []
  const enabledAgentModels = agentCandidates.filter((item) => config?.agentModels?.[item.modelKey]?.canvasAgent === true).length
  const visibleCustomerModels = config?.businessModels.filter((model) => config.customerVisibleModels?.[model.key] === true).length || 0
  const customizedCustomerCount = config ? new Set([
    ...Object.keys(config.customerModelOverrides ?? {}).filter((id) => Object.keys(config.customerModelOverrides?.[id] ?? {}).length > 0),
    ...Object.keys(config.customerModelRoutingOverrides ?? {}).filter((id) => Object.keys(config.customerModelRoutingOverrides?.[id] ?? {}).length > 0),
  ]).size : 0
  const internalUserIds = config?.internalModelViewUserIds ?? []
  const customerMainAccountCount = modelViewUsers.filter((user) => (
    !user.workspaceOwnerId
    && user.role !== 'super_admin'
    && !internalUserIds.includes(user.id)
  )).length
  const storageHealth = healthMap.get('storage:tos')
  const storageStatusLabel = storageHealth?.status === 'healthy'
    ? '连接正常'
    : storageHealth?.status === 'unhealthy'
      ? '连接异常'
      : config?.storage.hasAccessKey && config?.storage.hasSecretKey
        ? '已配待检'
        : '待配置'

  return (
    <PlatformAdminShell
      active={meta.active}
      eyebrow={meta.eyebrow}
      title={meta.title}
      description={meta.description}
      actions={isEditableSection ? (
        <>
          <span className={dirty ? 'nori-admin-dirty' : 'nori-admin-muted'}>
            {dirty
              ? `有未保存修改${changeCount > 0 ? `（${changeCount} 项）` : ''}`
              : config?.updatedAt ? `更新于 ${formatDate(config.updatedAt)}` : ''}
          </span>
          {dirty ? (
            <button
              type="button"
              onClick={resetDraft}
              disabled={saving}
              className="fos-btn fos-btn-ghost"
            >
              <AppIcon name="undo" className="h-3.5 w-3.5" />
              放弃修改
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void save()}
            disabled={!dirty || saving || !config}
            title={!config ? '正在读取服务配置' : saving ? '正在保存并热加载' : dirty ? '保存全部服务配置并立即生效' : '当前没有待保存的修改'}
            className="fos-btn fos-btn-primary"
          >
            <AppIcon name={saving ? 'loader' : 'check'} className={`h-4 w-4 ${saving ? 'animate-spin' : ''}`} />
            {saving ? '保存中' : '保存并热加载'}
          </button>
        </>
      ) : (
        <>
          {dirty ? (
            <>
              <span className="nori-admin-dirty">存储配置已修改</span>
              <button type="button" onClick={resetDraft} disabled={saving} className="fos-btn fos-btn-ghost">
                <AppIcon name="undo" className="h-3.5 w-3.5" />
                放弃修改
              </button>
              <button type="button" onClick={() => void save()} disabled={saving || !config} className="fos-btn fos-btn-primary">
                <AppIcon name={saving ? 'loader' : 'check'} className={`h-4 w-4 ${saving ? 'animate-spin' : ''}`} />
                {saving ? '保存中' : '保存存储配置'}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => void loadServices(rangeDays, false)}
              disabled={loading}
              className="fos-btn fos-btn-ghost"
            >
              <AppIcon name="refresh" className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              刷新统计
            </button>
          )}
        </>
      )}
    >
      {pageError ? <AdminAlert tone="error" onDismiss={() => setPageError('')}>{pageError}</AdminAlert> : null}
      {notice ? <AdminAlert tone="success" onDismiss={() => setNotice('')}>{notice}</AdminAlert> : null}
      {loading || !config ? <AdminLoading label="正在读取服务器服务配置…" /> : (
        <>
          {section === 'providers' ? (
            <div className="nori-admin-metrics">
              <AdminMetric label="外部服务" value={config.providers.length} icon="unplug" />
              <AdminMetric label="已配密钥" value={`${configuredProviders}/${config.providers.length}`} icon="lock" />
              <AdminMetric label="健康服务" value={`${healthyProviders}/${config.providers.length}`} icon="badgeCheck" />
              <AdminMetric label={`${usage?.rangeDays || rangeDays} 天调用`} value={formatNumber(usage?.summary.calls || 0)} icon="chart" />
            </div>
          ) : section === 'models' ? (
            <div className="nori-admin-metrics">
              <AdminMetric label="已开视频模型" value={`${enabledVideoModels}/${videoModels.length}`} icon="video" />
              <AdminMetric label="已路由能力" value={`${routedBusinessModels}/${nonVideoBusinessModels.length}`} icon="link" />
              <AdminMetric label="喵导已开放" value={`${enabledAgentModels}/${agentCandidates.length}`} icon="sparklesAlt" />
              <AdminMetric label="接入底层模型" value={config.models.length} icon="cpu" />
            </div>
          ) : section === 'customers' ? (
            <div className="nori-admin-metrics">
              <AdminMetric label="全局白标模型" value={`${visibleCustomerModels}/${config.businessModels.length}`} icon="eye" />
              <AdminMetric label="独立策略客户" value={customizedCustomerCount} icon="userRoundCog" />
              <AdminMetric label="客户主账号" value={customerMainAccountCount} icon="usersRound" />
              <AdminMetric label="内部白名单" value={internalUserIds.length} icon="badgeCheck" />
            </div>
          ) : section === 'usage' ? (
            <div className="nori-admin-metrics">
              <AdminMetric label="存储状态" value={storageStatusLabel} icon="cloudUpload" />
              <AdminMetric label="TOS 已登记" value={`${usage?.storage.objectCount || 0} · ${formatBytes(usage?.storage.knownBytes || 0)}`} icon="folder" />
              <AdminMetric label={`${usage?.rangeDays || rangeDays} 天调用`} value={formatNumber(usage?.summary.calls || 0)} icon="chart" />
              <AdminMetric label="估算上游成本" value={formatUsageMoney(usage?.summary.cost || 0)} icon="coins" />
            </div>
          ) : (
            <div className="nori-admin-metrics">
              <AdminMetric label="外部服务" value={config.providers.length} icon="cpu" />
              <AdminMetric label="健康服务" value={`${healthyProviders}/${config.providers.length}`} icon="badgeCheck" />
              <AdminMetric label={`${usage?.rangeDays || rangeDays} 天调用`} value={formatNumber(usage?.summary.calls || 0)} icon="chart" />
              <AdminMetric label="TOS 已登记" value={`${usage?.storage.objectCount || 0} · ${formatBytes(usage?.storage.knownBytes || 0)}`} icon="cloudUpload" />
            </div>
          )}
          <PlatformAdminServicesPanels
            section={section}
            config={config}
            usage={usage}
            modelViewUsers={modelViewUsers}
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
          {isEditableSection && dirty ? (
            <div className="nori-admin-savebar" role="region" aria-label="未保存更改操作栏">
              <div className="nori-admin-savebar-info">
                <span className="nori-admin-savebar-dot" aria-hidden="true" />
                <div className="nori-admin-savebar-text">
                  <strong>检测到 {Math.max(1, changeCount)} 项未保存变更</strong>
                  <span>保存后将立即热加载到全平台，无需重启服务</span>
                </div>
              </div>
              <div className="nori-admin-savebar-actions">
                <button type="button" className="fos-btn fos-btn-ghost fos-btn-sm" disabled={saving} onClick={resetDraft}>
                  还原更改
                </button>
                <button type="button" className="fos-btn fos-btn-primary fos-btn-sm" disabled={saving} onClick={() => void save()}>
                  <AppIcon name={saving ? 'loader' : 'check'} className={`h-3.5 w-3.5 ${saving ? 'animate-spin' : ''}`} />
                  {saving ? '保存中…' : '立即保存生效'}
                </button>
              </div>
            </div>
          ) : null}
        </>
      )}
    </PlatformAdminShell>
  )
}
