'use client'

import type { Dispatch, SetStateAction } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { CanvasAgentSettings } from './CanvasAgentSettings'
import { AppIcon, ShieldCheck } from '@/components/ui/icons'
import { PasswordInput } from '@/components/ui/PasswordInput'
import { AdminHealthBadge, AdminSearch } from '@/components/admin/PlatformAdminShell'
import {
  MODEL_TIER_LABELS,
  MODEL_TIER_TONES,
  MODEL_TYPE_LABELS,
  formatDate,
  formatNumber,
  PROVIDER_DISPLAY_NAMES,
  modelKey,
  type AdminServicesSection,
  type HealthRow,
  type ModelViewUser,
  type ProviderDraft,
  type ServiceConfig,
  type UsageOverview,
} from '@/components/admin/platform-admin-services'
import { formatUsageMoney, MODEL_USAGE_TYPE_LABELS, normalizeModelUsageType } from '@/lib/platform-services/model-type-usage'

function StatusBadge({ health }: { health?: HealthRow }) {
  return <AdminHealthBadge status={health?.status} latencyMs={health?.latencyMs} />
}

type SectionKey = 'connections' | 'models' | 'visibility' | 'storage' | 'usage'
type ModelTypeFilter = 'all' | 'llm' | 'image' | 'video' | 'audio' | 'agent'
type ProviderKeyFilter = 'all' | 'configured' | 'missing'

const SECTION_ANCHORS: Record<SectionKey, string> = {
  connections: 'service-connections-panel',
  models: 'purpose-models-panel',
  visibility: 'customer-visibility-panel',
  storage: 'asset-storage-panel',
  usage: 'service-usage-panel',
}

type PanelsProps = {
  section?: AdminServicesSection
  config: ServiceConfig
  usage: UsageOverview | null
  modelViewUsers: ModelViewUser[]
  rangeDays: number
  healthMap: Map<string, HealthRow>
  usageByProvider: Map<string, { calls: number; cost: number }>
  providerSecrets: Record<string, string>
  storageAccessKey: string
  storageSecretKey: string
  probing: string
  markConfig: (updater: (current: ServiceConfig) => ServiceConfig) => void
  updateProvider: (index: number, patch: Partial<ProviderDraft>) => void
  setProviderSecrets: Dispatch<SetStateAction<Record<string, string>>>
  setStorageAccessKey: (value: string) => void
  setStorageSecretKey: (value: string) => void
  setDirty: (value: boolean) => void
  setRangeDays: (value: number) => void
  probe: (targetType: 'provider' | 'storage', targetId: string) => void
}

export function PlatformAdminServicesPanels(props: PanelsProps) {
  const { section = 'all', config, usage, modelViewUsers, rangeDays, healthMap, usageByProvider, providerSecrets, probing } = props
  const showJumpbar = section === 'all'
  const showProviders = section === 'all' || section === 'providers'
  const showModels = section === 'all' || section === 'models'
  const showCustomers = section === 'all' || section === 'customers'
  const showUsage = section === 'all' || section === 'usage'
  const [activeSection, setActiveSection] = useState<SectionKey>('connections')
  const [providerFilter, setProviderFilter] = useState<ProviderKeyFilter>('all')
  const [modelSearch, setModelSearch] = useState('')
  const [modelTypeFilter, setModelTypeFilter] = useState<ModelTypeFilter>('all')
  const [visibilitySearch, setVisibilitySearch] = useState('')
  const [customerSearch, setCustomerSearch] = useState('')
  const [customerModelSearch, setCustomerModelSearch] = useState('')
  const [customerModalityFilter, setCustomerModalityFilter] = useState<'all' | 'video' | 'image' | 'llm' | 'audio'>('all')
  const [onlyCustomizedRows, setOnlyCustomizedRows] = useState(false)
  const [draftCustomerIds, setDraftCustomerIds] = useState<string[]>([])
  const [selectedCustomerId, setSelectedCustomerId] = useState('')
  const [usagePurpose, setUsagePurpose] = useState('all')
  const [usageSearch, setUsageSearch] = useState('')
  const [internalUserPick, setInternalUserPick] = useState('')
  const [internalUserInput, setInternalUserInput] = useState('')
  const [overrideUserPick, setOverrideUserPick] = useState('')
  const [overrideUserInput, setOverrideUserInput] = useState('')

  useEffect(() => {
    if (!showJumpbar || typeof IntersectionObserver === 'undefined') return
    const entries = Object.entries(SECTION_ANCHORS) as Array<[SectionKey, string]>
    const elements = entries
      .map(([key, id]) => [key, document.getElementById(id)] as const)
      .filter((pair): pair is readonly [SectionKey, HTMLElement] => Boolean(pair[1]))
    if (!elements.length) return
    const idToKey = new Map(elements.map(([key, el]) => [el.id, key]))
    const observer = new IntersectionObserver(
      (observed) => {
        const visible = observed
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        const top = visible[0]
        if (top) {
          const next = idToKey.get(top.target.id)
          if (next) setActiveSection(next)
        }
      },
      { rootMargin: '-120px 0px -58% 0px', threshold: 0.01 },
    )
    for (const [, el] of elements) observer.observe(el)
    return () => observer.disconnect()
  }, [showJumpbar])

  const scrollToSection = (key: SectionKey) => {
    setActiveSection(key)
    const target = document.getElementById(SECTION_ANCHORS[key])
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const modelViewUserMap = useMemo(() => new Map(modelViewUsers.map((user) => [user.id, user])), [modelViewUsers])
  const roleLabel = (role: string) => role === 'super_admin' ? '超管' : (role === 'admin' || role === 'ADMIN') ? '管理员' : '客户'
  const getSubAccountCount = (user?: ModelViewUser) => (typeof user?.subAccountCount === 'number' && user.subAccountCount > 0 ? user.subAccountCount : 0)
  const internalUserIds = config.internalModelViewUserIds ?? []
  const customerVisibleModels = config.customerVisibleModels ?? {}
  const customerModelOverrides = config.customerModelOverrides ?? {}
  const customerModelRoutingOverrides = config.customerModelRoutingOverrides ?? {}

  const configuredCustomerIds = useMemo(() => {
    const seen = new Set<string>()
    const ordered: string[] = []
    for (const id of [
      ...Object.keys(customerModelRoutingOverrides),
      ...Object.keys(customerModelOverrides),
      ...draftCustomerIds,
    ]) {
      const trimmed = id.trim()
      if (!trimmed || seen.has(trimmed)) continue
      seen.add(trimmed)
      ordered.push(trimmed)
    }
    return ordered
  }, [customerModelOverrides, customerModelRoutingOverrides, draftCustomerIds])

  const activeCustomerId = configuredCustomerIds.includes(selectedCustomerId)
    ? selectedCustomerId
    : (configuredCustomerIds[0] || '')

  const normalizedCustomerSearch = customerSearch.trim().toLowerCase()
  const visibleCustomerIds = useMemo(() => {
    if (!normalizedCustomerSearch) return configuredCustomerIds
    return configuredCustomerIds.filter((userId) => {
      const user = modelViewUserMap.get(userId)
      return userId.toLowerCase().includes(normalizedCustomerSearch)
        || (user?.name || '').toLowerCase().includes(normalizedCustomerSearch)
    })
  }, [configuredCustomerIds, modelViewUserMap, normalizedCustomerSearch])

  const selectableCustomerMainAccounts = useMemo(() => (
    modelViewUsers.filter((user) => (
      !user.workspaceOwnerId
      && user.role !== 'super_admin'
      && !configuredCustomerIds.includes(user.id)
      && !internalUserIds.includes(user.id)
    ))
  ), [modelViewUsers, configuredCustomerIds, internalUserIds])

  const selectableInternalUsers = useMemo(() => (
    modelViewUsers.filter((user) => (
      !user.workspaceOwnerId
      && !internalUserIds.includes(user.id)
    ))
  ), [modelViewUsers, internalUserIds])

  const quickPickCustomers = useMemo(() => (
    selectableCustomerMainAccounts.slice(0, 6)
  ), [selectableCustomerMainAccounts])

  const configuredProviderCount = config.providers.filter((provider) => provider.hasApiKey || Boolean(providerSecrets[provider.id]?.trim())).length
  const videoModels = config.models.filter((model) => model.type === 'video')
  const enabledVideoCount = videoModels.filter((model) => config.modelEnabled?.[modelKey(model)] === true).length
  const visibleCustomerModelCount = config.businessModels.filter((model) => customerVisibleModels[model.key] === true).length
  const storageHealth = healthMap.get('storage:tos')

  const filteredProviders = useMemo(() => {
    return config.providers
      .map((provider, index) => ({ provider, index }))
      .filter(({ provider }) => {
        const configured = provider.hasApiKey || Boolean(providerSecrets[provider.id]?.trim())
        if (providerFilter === 'configured') return configured
        if (providerFilter === 'missing') return !configured
        return true
      })
  }, [config.providers, providerFilter, providerSecrets])

  const normalizedModelSearch = modelSearch.trim().toLowerCase()
  const normalizedVisibilitySearch = visibilitySearch.trim().toLowerCase()
  const normalizedUsageSearch = usageSearch.trim().toLowerCase()

  const usageRows = (usage?.rows ?? []).filter((row) => {
    if (usagePurpose !== 'all' && (usagePurpose === 'agent') !== (row.operation === 'canvas_agent')) return false
    if (!normalizedUsageSearch) return true
    return row.provider.toLowerCase().includes(normalizedUsageSearch)
      || (row.modelKey || '').toLowerCase().includes(normalizedUsageSearch)
      || row.serviceType.toLowerCase().includes(normalizedUsageSearch)
  })

  const addInternalViewer = (rawId: string) => {
    const userId = rawId.trim()
    if (!userId || internalUserIds.includes(userId) || internalUserIds.length >= 100) return
    props.markConfig((current) => ({
      ...current,
      internalModelViewUserIds: [...(current.internalModelViewUserIds ?? []), userId],
    }))
    setInternalUserPick('')
    setInternalUserInput('')
  }
  const removeInternalViewer = (userId: string) => {
    props.markConfig((current) => ({
      ...current,
      internalModelViewUserIds: (current.internalModelViewUserIds ?? []).filter((id) => id !== userId),
    }))
  }
  const addCustomerProfile = (rawId: string) => {
    const trimmed = rawId.trim()
    if (!trimmed) return
    const matched = modelViewUserMap.get(trimmed)
    const targetId = matched?.workspaceOwnerId ? matched.workspaceOwnerId : trimmed
    setDraftCustomerIds((current) => current.includes(targetId) ? current : [targetId, ...current])
    setSelectedCustomerId(targetId)
    setOverrideUserPick('')
    setOverrideUserInput('')
  }
  const resetCustomerProfile = (userId: string) => {
    const hasVisibility = Object.prototype.hasOwnProperty.call(customerModelOverrides, userId)
    const hasRouting = Object.prototype.hasOwnProperty.call(customerModelRoutingOverrides, userId)
    setDraftCustomerIds((current) => current.filter((id) => id !== userId))
    if (hasVisibility || hasRouting) {
      props.markConfig((current) => {
        const nextVis = { ...(current.customerModelOverrides ?? {}) }
        const nextRoute = { ...(current.customerModelRoutingOverrides ?? {}) }
        delete nextVis[userId]
        delete nextRoute[userId]
        return {
          ...current,
          customerModelOverrides: nextVis,
          customerModelRoutingOverrides: nextRoute,
        }
      })
    }
  }
  const setOverrideValue = (userId: string, businessKey: string, mode: 'inherit' | 'show' | 'hide') => {
    props.markConfig((current) => {
      const all = { ...(current.customerModelOverrides ?? {}) }
      const entry = { ...(all[userId] ?? {}) }
      if (mode === 'inherit') delete entry[businessKey]
      else entry[businessKey] = mode === 'show'
      if (Object.keys(entry).length === 0) delete all[userId]
      else all[userId] = entry
      return { ...current, customerModelOverrides: all }
    })
  }
  const setCustomerRouteOverride = (userId: string, businessKey: string, runtimeKey: string) => {
    props.markConfig((current) => {
      const all = { ...(current.customerModelRoutingOverrides ?? {}) }
      const entry = { ...(all[userId] ?? {}) }
      const trimmed = runtimeKey.trim()
      if (!trimmed) delete entry[businessKey]
      else entry[businessKey] = trimmed
      if (Object.keys(entry).length === 0) delete all[userId]
      else all[userId] = entry
      return { ...current, customerModelRoutingOverrides: all }
    })
  }
  const formatRuntimeModelLabel = (runtimeKey: string) => {
    if (!runtimeKey) return '未配置路由'
    const matched = config.models.find((candidate) => modelKey(candidate) === runtimeKey)
    if (!matched) return runtimeKey
    return `${PROVIDER_DISPLAY_NAMES[matched.provider] || matched.provider} · ${matched.name || matched.modelId}`
  }
  const runtimeReadiness = (runtimeKey: string) => {
    if (!runtimeKey) return { providerReady: true, kzepReady: true }
    const matched = config.models.find((candidate) => modelKey(candidate) === runtimeKey)
    if (!matched) return { providerReady: false, kzepReady: true }
    const provider = config.providers.find((item) => item.id === matched.provider)
    const providerReady = Boolean(provider?.hasApiKey || providerSecrets[matched.provider]?.trim())
    const kzepReady = runtimeKey !== 'kuaizi::doubao-seedance-2-5-260628-intl' || Boolean(provider?.seedance25IntlKzep?.trim())
    return { providerReady, kzepReady }
  }

  const customizedCustomerCount = new Set([
    ...Object.keys(customerModelOverrides).filter((id) => Object.keys(customerModelOverrides[id] ?? {}).length > 0),
    ...Object.keys(customerModelRoutingOverrides).filter((id) => Object.keys(customerModelRoutingOverrides[id] ?? {}).length > 0),
  ]).size

  const jumpItems: Array<{ key: SectionKey; num: string; label: string; meta: string }> = [
    { key: 'connections', num: '01', label: '服务商与密钥', meta: `${configuredProviderCount}/${config.providers.length}` },
    { key: 'models', num: '02', label: '模型开关与路由', meta: `视频 ${enabledVideoCount}/${videoModels.length}` },
    { key: 'visibility', num: '03', label: '客户白标与内部视图', meta: `${visibleCustomerModelCount} 白标 · ${customizedCustomerCount} 独立客户` },
    { key: 'storage', num: '04', label: '素材存储', meta: storageHealth?.status === 'healthy' ? '正常' : config.storage.hasAccessKey ? '已配' : '待配' },
    { key: 'usage', num: '05', label: '调用用量', meta: `近 ${rangeDays} 天` },
  ]

  return (
    <div className="nori-admin-stack">
      {showJumpbar ? (
        <nav className="nori-admin-jumpbar" aria-label="服务配置分区导航">
          {jumpItems.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`nori-admin-jump-btn${activeSection === item.key ? ' is-active' : ''}`}
              onClick={() => scrollToSection(item.key)}
            >
              <span className="nori-admin-jump-num">{item.num}</span>
              <span>{item.label}</span>
              <span className="nori-admin-jump-meta">{item.meta}</span>
            </button>
          ))}
        </nav>
      ) : null}

      {/* 01 API Connections */}
      {showProviders ? (
      <section id={SECTION_ANCHORS.connections} className="nori-admin-panel" aria-labelledby="service-connections">
        <div className="nori-admin-panel-head">
          <div>
            <span className="nori-admin-step">{showJumpbar ? '01' : '上游服务商'}</span>
            <h2 id="service-connections">服务商与 API 密钥</h2>
            <p>文本模型按用途开放：Kimi 与 OpenAI 的连接仅用于喵导；其他文本、图片、视频和语音继续沿用各自的服务。</p>
          </div>
          <div className="nori-admin-seg" role="group" aria-label="按密钥状态筛选服务商">
            {([
              ['all', '全部', config.providers.length],
              ['configured', '已配置', configuredProviderCount],
              ['missing', '待配置', config.providers.length - configuredProviderCount],
            ] as const).map(([key, label, count]) => (
              <button
                key={key}
                type="button"
                className={`nori-admin-seg-btn${providerFilter === key ? ' is-active' : ''}`}
                onClick={() => setProviderFilter(key)}
              >
                {label}<em>{count}</em>
              </button>
            ))}
          </div>
        </div>
        <div className="grid gap-4 p-5 xl:grid-cols-2">
          {filteredProviders.map(({ provider, index }) => {
            const isKuaizi = provider.id === 'kuaizi'
            const isOpenLux = provider.id === 'openlux'
            const isHuimengi = provider.id === 'huimengi'
            const isVideoOnly = provider.id === 'ailink' || provider.id === 'topenrouter'
            const health = healthMap.get(`provider:${provider.id}`)
            const providerUsage = usageByProvider.get(provider.id)
            const pending = Boolean(providerSecrets[provider.id]?.trim())
            const isProbing = probing === `provider:${provider.id}`
            const providerSummary = isKuaizi
              ? { icon: 'video' as const, description: '视频与语音服务', capabilities: ['视频', '语音合成'] }
              : isOpenLux
                ? { icon: 'image' as const, description: '图像生成服务', capabilities: ['文生图', '参考图编辑', '蒙版重绘'] }
                : isHuimengi
                  ? { icon: 'sparklesAlt' as const, description: '图像与视频服务', capabilities: ['文生图', '参考图', '文生视频', '多模态参考'] }
                  : isVideoOnly
                    ? { icon: 'video' as const, description: '视频服务（Seedance 2.5，官方协议）', capabilities: ['视频', '首尾帧', '多模态参考'] }
                    : { icon: 'cpu' as const, description: '官方文本服务', capabilities: ['剧本', '提示词', '文本分析'] }
            return (
              <article key={provider.id} className={`nori-admin-card nori-admin-provider p-4 is-${provider.id}`}>
                <div className="nori-admin-connection-head">
                  <span className="nori-admin-provider-icon"><AppIcon name={providerSummary.icon} /></span>
                  <div><h3>{provider.name}</h3><p>{providerSummary.description}</p></div>
                  <StatusBadge health={health} />
                </div>
                <div className="nori-admin-capabilities">
                  {providerSummary.capabilities.map((item) => <span key={item}>{item}</span>)}
                </div>
                <label className="nori-admin-field">
                  <span className="nori-admin-field-label">
                    <span>API Key</span>
                    <span className={`nori-admin-secret-status ${pending ? 'is-pending' : provider.hasApiKey ? 'is-ok' : 'is-missing'}`}>
                      {pending ? '待保存' : provider.hasApiKey ? '已配置' : '待配置'}
                    </span>
                  </span>
                  <PasswordInput
                    autoComplete="new-password"
                    className="fos-input"
                    value={providerSecrets[provider.id] || ''}
                    placeholder={provider.hasApiKey ? '已安全保存；留空不修改' : '粘贴平台 API Key'}
                    onChange={(event) => {
                      props.setProviderSecrets((current) => ({ ...current, [provider.id]: event.target.value }))
                      props.setDirty(true)
                    }}
                  />
                </label>
                {isKuaizi ? (
                  <>
                    <label className="nori-admin-field mt-3">
                      <span className="nori-admin-field-label"><span>素材组 ID</span><span className="nori-admin-muted">选填</span></span>
                      <input
                        className="fos-input"
                        value={provider.assetGroupId || ''}
                        placeholder="用于 Kuaizi 素材归属"
                        onChange={(event) => props.updateProvider(index, { assetGroupId: event.target.value.trim() })}
                      />
                    </label>
                    <label className="nori-admin-field mt-3">
                      <span className="nori-admin-field-label"><span>Seedance 2.5 国际版 EP (kzep)</span><span className="nori-admin-muted">选填</span></span>
                      <input
                        className="fos-input"
                        value={provider.seedance25IntlKzep || ''}
                        placeholder="例如 kzep_xxxxxxxxxx_xxxxxx"
                        onChange={(event) => props.updateProvider(index, { seedance25IntlKzep: event.target.value.trim() })}
                      />
                    </label>
                  </>
                ) : null}
                <div className="nori-admin-provider-foot">
                  <span className="nori-admin-url-chip" title={provider.baseUrl}>{provider.baseUrl}</span>
                  <button
                    type="button"
                    className="fos-btn fos-btn-ghost fos-btn-sm shrink-0"
                    disabled={isProbing}
                    onClick={() => props.probe('provider', provider.id)}
                  >
                    {isProbing ? <AppIcon name="loader" className="h-3.5 w-3.5 animate-spin" /> : null}
                    {isProbing ? '检测中' : '检测连接'}
                  </button>
                </div>
                <p className="nori-admin-subtle mt-2">
                  {health?.message || '保存密钥后可检测连接'} · {providerUsage ? `${providerUsage.calls} 次 · ${formatUsageMoney(providerUsage.cost)}` : '暂无用量'}
                </p>
              </article>
            )
          })}
          {filteredProviders.length === 0 ? (
            <div className="col-span-full nori-admin-empty">当前筛选条件下暂无服务商</div>
          ) : null}
        </div>
      </section>
      ) : null}

      {/* 02 Model Switches & Routing */}
      {showModels ? (
      <section id={SECTION_ANCHORS.models} className="nori-admin-panel" aria-labelledby="purpose-models">
        <div className="nori-admin-panel-head">
          <div>
            <span className="nori-admin-step">{showJumpbar ? '02' : '全局开关与路由'}</span>
            <h2 id="purpose-models">按用途选择模型</h2>
            <p>文本、图片、语音由稳定能力名称映射到官方模型；视频模型不再映射，开启哪个创作端就能选哪个，用量按服务商分别统计。</p>
          </div>
          <div className="nori-admin-filter-row">
            <div className="nori-admin-seg" role="group" aria-label="按模型类型筛选">
              {([
                ['all', '全部'],
                ['llm', '文本'],
                ['image', '图片'],
                ['video', '视频'],
                ['audio', '语音'],
                ['agent', '喵导'],
              ] as const).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  className={`nori-admin-seg-btn${modelTypeFilter === key ? ' is-active' : ''}`}
                  onClick={() => setModelTypeFilter(key)}
                >
                  {label}
                </button>
              ))}
            </div>
            <AdminSearch value={modelSearch} onChange={setModelSearch} placeholder="搜索模型或服务商" />
          </div>
        </div>
        <div className="nori-admin-purpose-grid">
          {(['llm', 'image', 'video', 'audio'] as const)
            .filter((type) => modelTypeFilter === 'all' || modelTypeFilter === type)
            .map((type) => {
              const allVideoModels = type === 'video' ? config.models.filter((model) => model.type === 'video') : []
              const filteredVideoModels = type === 'video'
                ? allVideoModels.filter((model) => {
                    if (!normalizedModelSearch) return true
                    const pName = (PROVIDER_DISPLAY_NAMES[model.provider] || model.provider).toLowerCase()
                    return (model.name || '').toLowerCase().includes(normalizedModelSearch)
                      || model.modelId.toLowerCase().includes(normalizedModelSearch)
                      || pName.includes(normalizedModelSearch)
                  })
                : []
              const allBusinessOfType = type === 'video' ? [] : config.businessModels.filter((model) => model.type === type)
              const filteredBusinessOfType = type === 'video'
                ? []
                : allBusinessOfType.filter((model) => {
                    if (!normalizedModelSearch) return true
                    const routed = (config.modelRouting[model.key] || '').toLowerCase()
                    return model.name.toLowerCase().includes(normalizedModelSearch)
                      || model.description.toLowerCase().includes(normalizedModelSearch)
                      || model.key.toLowerCase().includes(normalizedModelSearch)
                      || routed.includes(normalizedModelSearch)
                  })
              const activeCount = type === 'video'
                ? allVideoModels.filter((model) => config.modelEnabled?.[modelKey(model)] === true).length
                : allBusinessOfType.filter((model) => Boolean(config.modelRouting[model.key])).length
              const totalCount = type === 'video' ? allVideoModels.length : allBusinessOfType.length

              return (
                <section key={type} className={`nori-admin-purpose is-${type}`}>
                  <div className="nori-admin-purpose-head">
                    <div className="nori-admin-purpose-head-main">
                      <span className="nori-admin-purpose-icon">
                        <AppIcon name={type === 'llm' ? 'fileText' : type === 'image' ? 'image' : type === 'video' ? 'video' : 'volume'} className="h-4 w-4" />
                      </span>
                      <div>
                        <h3>{MODEL_TYPE_LABELS[type]}</h3>
                        <p>{type === 'llm' ? 'DeepSeek 官方' : type === 'image' ? 'OpenLux / 绘梦工坊 API' : type === 'video' ? '全部已开启的视频模型' : 'Kuaizi API'}{type === 'audio' ? ' · 仅语音合成' : ''}</p>
                      </div>
                    </div>
                    <span className="nori-admin-purpose-count">
                      {type === 'video' ? `已开 ${activeCount}/${totalCount}` : `已路由 ${activeCount}/${totalCount}`}
                    </span>
                  </div>
                  <div className="nori-admin-purpose-list">
                    {type === 'video' ? (
                      filteredVideoModels.length > 0 ? filteredVideoModels.map((model) => {
                        const key = modelKey(model)
                        const provider = config.providers.find((item) => item.id === model.provider)
                        const providerReady = Boolean(provider?.hasApiKey || providerSecrets[model.provider])
                        const needsKzep = key === 'kuaizi::doubao-seedance-2-5-260628-intl'
                        const kzepReady = !needsKzep || Boolean(provider?.seedance25IntlKzep?.trim())
                        const ready = providerReady && kzepReady
                        const enabled = config.modelEnabled?.[key] === true
                        return (
                          <label key={key} className="nori-admin-purpose-row">
                            <span>
                              <strong>{model.name || model.modelId}</strong>
                              <small>
                                {PROVIDER_DISPLAY_NAMES[model.provider] || model.provider}
                                {!providerReady ? <span className="nori-admin-inline-warn">未配置密钥</span> : !kzepReady ? <span className="nori-admin-inline-warn">未配置 EP</span> : null}
                              </small>
                            </span>
                            <input
                              type="checkbox"
                              role="switch"
                              aria-label={`${PROVIDER_DISPLAY_NAMES[model.provider] || model.provider} ${model.name || model.modelId} 开关`}
                              checked={enabled}
                              disabled={!ready && !enabled}
                              onChange={(event) => props.markConfig((current) => ({
                                ...current,
                                modelEnabled: { ...current.modelEnabled, [key]: event.target.checked },
                              }))}
                            />
                          </label>
                        )
                      }) : <div className="nori-admin-purpose-row"><span className="nori-admin-subtle">没有匹配的视频模型</span></div>
                    ) : (
                      filteredBusinessOfType.length > 0 ? filteredBusinessOfType.map((model) => {
                        const options = config.models.filter((candidate) => candidate.type === type)
                        const value = config.modelRouting[model.key] || ''
                        return (
                          <label key={model.key} className="nori-admin-purpose-row">
                            <span>
                              <strong>{model.name}</strong>
                              <em className={MODEL_TIER_TONES[model.tier]}>{MODEL_TIER_LABELS[model.tier]}</em>
                              <small>{model.description}</small>
                            </span>
                            <select
                              className="fos-input nori-admin-input-dense"
                              aria-label={`${model.name}运行模型`}
                              value={value}
                              onChange={(event) => props.markConfig((current) => ({
                                ...current,
                                modelRouting: { ...current.modelRouting, [model.key]: event.target.value },
                              }))}
                            >
                              <option value="">{config.modelRouting[model.key] ? '不提供此能力' : '未提供此能力'}</option>
                              {options.map((option) => (
                                <option key={modelKey(option)} value={modelKey(option)}>
                                  {`${PROVIDER_DISPLAY_NAMES[option.provider] || option.provider} · ${option.name || option.modelId}`}
                                </option>
                              ))}
                            </select>
                          </label>
                        )
                      }) : <div className="nori-admin-purpose-row"><span className="nori-admin-subtle">没有匹配的模型</span></div>
                    )}
                  </div>
                </section>
              )
            })}
          {(modelTypeFilter === 'all' || modelTypeFilter === 'agent') ? (
            <CanvasAgentSettings config={config} markConfig={props.markConfig} query={modelSearch} />
          ) : null}
        </div>
      </section>
      ) : null}

      {/* 03 Customer White-Label View, Per-Customer Policy & Internal Full View */}
      {showCustomers ? (
      <>
      <div id={SECTION_ANCHORS.visibility} className="nori-admin-view-banner is-standalone">
        <div className="nori-admin-view-card is-customer">
          <span className="nori-admin-view-icon"><AppIcon name="eye" className="h-4 w-4" /></span>
          <div className="nori-admin-view-copy">
            <div className="nori-admin-view-title">
              <strong>客户白标视图</strong>
              <span className="nori-admin-pill is-customer"><i />全局默认 {visibleCustomerModelCount}/{config.businessModels.length}</span>
              {customizedCustomerCount > 0 ? (
                <span className="nori-admin-pill is-info"><i />{customizedCustomerCount} 个独立客户配置</span>
              ) : null}
            </div>
            <p>面向所有非白名单客户账号：仅展示纯净业务模型名，隐藏上游供应商标识；支持按客户主账号定制可见模型与专属供应商，并自动覆盖名下全部子账号。</p>
          </div>
        </div>
        <div className="nori-admin-view-card is-internal">
          <span className="nori-admin-view-icon"><ShieldCheck className="h-4 w-4" /></span>
          <div className="nori-admin-view-copy">
            <div className="nori-admin-view-title">
              <strong>内部完整视图</strong>
              <span className="nori-admin-pill is-internal"><i />白名单 {internalUserIds.length} 人</span>
            </div>
            <p>面向内部团队账号：在画布、工具箱与分镜生成中完整展示底层供应商名称、路由和全部已开启模型，不受客户白标配置影响。</p>
          </div>
        </div>
      </div>

      <section className="nori-admin-panel" aria-labelledby="customer-model-visibility">
        <div className="nori-admin-panel-head">
          <div>
            <span className="nori-admin-step">{showJumpbar ? '03-A' : '全局默认白标'}</span>
            <h2 id="customer-model-visibility">全局客户默认可见模型</h2>
            <p>未做单客户独立配置的客户账号，默认按下方开关展示纯净业务模型名，底层自动跟随全局默认路由。</p>
          </div>
          <AdminSearch value={visibilitySearch} onChange={setVisibilitySearch} placeholder="搜索白标模型" />
        </div>

        <div className="nori-admin-purpose-grid">
          {(['video', 'image', 'llm', 'audio'] as const).map((type) => {
            const allOfType = config.businessModels.filter((model) => model.type === type)
            if (allOfType.length === 0) return null
            const modelsOfType = normalizedVisibilitySearch
              ? allOfType.filter((model) =>
                  (model.customerName || model.name).toLowerCase().includes(normalizedVisibilitySearch)
                  || model.key.toLowerCase().includes(normalizedVisibilitySearch)
                  || (config.modelRouting[model.key] || '').toLowerCase().includes(normalizedVisibilitySearch))
              : allOfType
            const enabledInType = allOfType.filter((model) => customerVisibleModels[model.key] === true).length
            return (
              <section key={type} className={`nori-admin-purpose is-${type}`}>
                <div className="nori-admin-purpose-head">
                  <div className="nori-admin-purpose-head-main">
                    <span className="nori-admin-purpose-icon">
                      <AppIcon name={type === 'llm' ? 'fileText' : type === 'image' ? 'image' : type === 'video' ? 'video' : 'volume'} className="h-4 w-4" />
                    </span>
                    <div>
                      <h3>客户可见 · {MODEL_TYPE_LABELS[type]}</h3>
                      <p>向客户展示纯净模型名，底层路由自动生效</p>
                    </div>
                  </div>
                  <span className="nori-admin-purpose-count">开放 {enabledInType}/{allOfType.length}</span>
                </div>
                <div className="nori-admin-purpose-list">
                  {modelsOfType.length > 0 ? modelsOfType.map((model) => {
                    const visible = customerVisibleModels[model.key] === true
                    const routedKey = config.modelRouting[model.key] || ''
                    const routedModel = routedKey ? config.models.find((candidate) => modelKey(candidate) === routedKey) : null
                    const routedLabel = routedModel
                      ? `${PROVIDER_DISPLAY_NAMES[routedModel.provider] || routedModel.provider} · ${routedModel.name || routedModel.modelId}`
                      : routedKey || '未配置路由'
                    const displayName = model.customerName || model.name
                    const missingRoute = !routedKey
                    return (
                      <label key={model.key} className="nori-admin-purpose-row">
                        <span>
                          <strong>{displayName}</strong>
                          <em className={MODEL_TIER_TONES[model.tier]}>{MODEL_TIER_LABELS[model.tier]}</em>
                          <small className="flex flex-wrap items-center gap-1.5">
                            <span>{model.key}</span>
                            <span className={`nori-admin-route-tag${missingRoute && visible ? ' is-missing' : ''}`}>
                              路由：{routedLabel}
                            </span>
                          </small>
                        </span>
                        <input
                          type="checkbox"
                          role="switch"
                          aria-label={`客户可见 ${displayName}`}
                          checked={visible}
                          onChange={(event) => props.markConfig((current) => ({
                            ...current,
                            customerVisibleModels: {
                              ...(current.customerVisibleModels ?? {}),
                              [model.key]: event.target.checked,
                            },
                          }))}
                        />
                      </label>
                    )
                  }) : <div className="nori-admin-purpose-row"><span className="nori-admin-subtle">没有匹配的白标模型</span></div>}
                </div>
              </section>
            )
          })}
        </div>

      </section>

      <section className="nori-admin-panel" aria-labelledby="customer-routing-workbench-title">
        <div className="nori-admin-panel-head">
          <div>
            <span className="nori-admin-step">{showJumpbar ? '03-B' : '单客户策略'}</span>
            <h2 id="customer-routing-workbench-title">单客户独立配置 · 可见模型与底层供应商</h2>
            <p className="nori-admin-policy-hint">
              <AppIcon name="infoCircle" />
              <span>按客户主账号配置，自动覆盖该主账号及其名下全部子账号，无需单独添加子账号。</span>
            </p>
          </div>
          <div className="nori-admin-workbench-add">
            {selectableCustomerMainAccounts.length > 0 ? (
              <select
                aria-label="选择要添加独立配置的客户主账号"
                className="fos-input nori-admin-input-dense w-auto min-w-[260px]"
                value={overrideUserPick}
                onChange={(event) => {
                  const value = event.target.value
                  setOverrideUserPick(value)
                  if (value) addCustomerProfile(value)
                }}
              >
                <option value="">+ 选择客户主账号添加配置…</option>
                {selectableCustomerMainAccounts.map((user) => {
                  const subCount = getSubAccountCount(user)
                  return (
                    <option key={user.id} value={user.id}>
                      {`${user.name}${subCount > 0 ? `（含 ${subCount} 个子账号）` : ''} · ${roleLabel(user.role)} · ${user.id}`}
                    </option>
                  )
                })}
              </select>
            ) : null}
            <input
              type="text"
              aria-label="输入客户主账号 User ID"
              className="fos-input nori-admin-input-dense w-auto min-w-[200px]"
              value={overrideUserInput}
              placeholder="或手动输入主账号 User ID"
              onChange={(event) => setOverrideUserInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  addCustomerProfile(overrideUserInput)
                }
              }}
            />
            <button
              type="button"
              className="fos-btn fos-btn-primary fos-btn-sm"
              disabled={!overrideUserInput.trim()}
              onClick={() => addCustomerProfile(overrideUserInput)}
            >
              <AppIcon name="plus" className="h-3.5 w-3.5" />
              添加客户
            </button>
          </div>
        </div>

        <div>
            {configuredCustomerIds.length === 0 ? (
              <div className="nori-admin-workbench-empty">
                <span className="nori-admin-empty-icon"><AppIcon name="usersRound" className="h-4 w-4" /></span>
                <strong className="text-[13.5px] text-white">尚未配置单客户独立规则</strong>
                <p>当前所有普通客户均沿用上方的全局默认白标模型与全局底层路由。选择任意客户主账号即可为其单独控制可见模型与专属供应商（例如客户 A 走 Kuaizi、客户 B 走绘梦工坊或 AILink），并自动对该主账号名下全部子账号生效。</p>
                {quickPickCustomers.length > 0 ? (
                  <div className="nori-admin-quick-picks">
                    {quickPickCustomers.map((user) => {
                      const subCount = getSubAccountCount(user)
                      return (
                        <button
                          key={user.id}
                          type="button"
                          className="fos-btn fos-btn-ghost fos-btn-sm nori-admin-quick-pick-btn"
                          onClick={() => addCustomerProfile(user.id)}
                        >
                          <AppIcon name="plus" className="h-3 w-3" />
                          <span>{user.name}</span>
                          {subCount > 0 ? <span className="nori-admin-mini-badge is-sub">含 {subCount} 个子账号</span> : null}
                          <span className="nori-admin-mini-badge is-owner">{roleLabel(user.role)}</span>
                        </button>
                      )
                    })}
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="nori-admin-workbench-body">
                <aside className="nori-admin-customer-rail" aria-label="已配置的客户列表">
                  {configuredCustomerIds.length > 4 ? (
                    <AdminSearch value={customerSearch} onChange={setCustomerSearch} placeholder="筛选已配置客户" />
                  ) : null}
                  <div className="nori-admin-customer-list">
                    {visibleCustomerIds.map((userId) => {
                      const user = modelViewUserMap.get(userId)
                      const isLegacySub = Boolean(user?.workspaceOwnerId)
                      const subCount = getSubAccountCount(user)
                      const visCount = Object.keys(customerModelOverrides[userId] ?? {}).length
                      const routeCount = Object.keys(customerModelRoutingOverrides[userId] ?? {}).length
                      const isInternal = internalUserIds.includes(userId)
                      const isSelected = userId === activeCustomerId
                      const initial = (user?.name || userId).slice(0, 1).toUpperCase()
                      return (
                        <button
                          key={userId}
                          type="button"
                          className={`nori-admin-customer-item${isSelected ? ' is-active' : ''}`}
                          onClick={() => setSelectedCustomerId(userId)}
                        >
                          <div className="nori-admin-customer-item-top">
                            <span className="nori-admin-customer-avatar" aria-hidden="true">{initial}</span>
                            <span className="nori-admin-customer-name">
                              <strong>{user ? user.name : '自定义账号'}</strong>
                              <code>{userId}</code>
                            </span>
                            {isLegacySub ? (
                              <span className="nori-admin-mini-badge is-warn">历史子账号</span>
                            ) : (
                              <span className="nori-admin-mini-badge is-owner">{user ? roleLabel(user.role) : '主账号'}</span>
                            )}
                          </div>
                          <div className="nori-admin-customer-badges">
                            {!isLegacySub && subCount > 0 ? <span className="nori-admin-mini-badge is-sub">含 {subCount} 个子账号</span> : null}
                            {visCount > 0 ? <span className="nori-admin-mini-badge is-vis">{visCount} 项可见性</span> : null}
                            {routeCount > 0 ? <span className="nori-admin-mini-badge is-route">{routeCount} 项独立路由</span> : null}
                            {visCount === 0 && routeCount === 0 ? <span className="nori-admin-mini-badge">跟随全局默认</span> : null}
                            {isInternal ? <span className="nori-admin-mini-badge is-warn">内部全视图</span> : null}
                          </div>
                        </button>
                      )
                    })}
                    {visibleCustomerIds.length === 0 ? (
                      <span className="p-2 text-[11.5px] nori-admin-muted">没有匹配的客户</span>
                    ) : null}
                  </div>
                </aside>

                {activeCustomerId ? (() => {
                  const selectedUser = modelViewUserMap.get(activeCustomerId)
                  const selectedLabel = selectedUser?.name || activeCustomerId
                  const selectedVisOverrides = customerModelOverrides[activeCustomerId] ?? {}
                  const selectedRouteOverrides = customerModelRoutingOverrides[activeCustomerId] ?? {}
                  const parentOwnerId = selectedUser?.workspaceOwnerId || null
                  const selectedSubCount = getSubAccountCount(selectedUser)
                  const parentVisOverrides = parentOwnerId ? (customerModelOverrides[parentOwnerId] ?? {}) : {}
                  const parentRouteOverrides = parentOwnerId ? (customerModelRoutingOverrides[parentOwnerId] ?? {}) : {}
                  const isSelectedInternal = internalUserIds.includes(activeCustomerId)
                  const selectedVisCount = Object.keys(selectedVisOverrides).length
                  const selectedRouteCount = Object.keys(selectedRouteOverrides).length
                  const normalizedRowQuery = customerModelSearch.trim().toLowerCase()

                  const rows = config.businessModels.filter((model) => {
                    if (customerModalityFilter !== 'all' && model.type !== customerModalityFilter) return false
                    const hasVis = Object.prototype.hasOwnProperty.call(selectedVisOverrides, model.key)
                    const hasRoute = Boolean(selectedRouteOverrides[model.key])
                    if (onlyCustomizedRows && !hasVis && !hasRoute) return false
                    if (!normalizedRowQuery) return true
                    const displayName = (model.customerName || model.name).toLowerCase()
                    const currentRoute = (selectedRouteOverrides[model.key] || config.modelRouting[model.key] || '').toLowerCase()
                    return displayName.includes(normalizedRowQuery)
                      || model.key.toLowerCase().includes(normalizedRowQuery)
                      || currentRoute.includes(normalizedRowQuery)
                  })

                  return (
                    <div className="nori-admin-customer-pane">
                      <div className="nori-admin-customer-pane-head">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <strong className="text-[14px] text-white">{selectedLabel}</strong>
                            {parentOwnerId ? (
                              <span className="nori-admin-mini-badge is-warn">历史子账号配置</span>
                            ) : (
                              <>
                                <span className="nori-admin-mini-badge is-owner">
                                  {selectedUser ? roleLabel(selectedUser.role) : '主账号'}
                                </span>
                                {selectedSubCount > 0 ? (
                                  <span className="nori-admin-mini-badge is-sub">含 {selectedSubCount} 个子账号</span>
                                ) : null}
                              </>
                            )}
                            {selectedVisCount > 0 ? <span className="nori-admin-mini-badge is-vis">{selectedVisCount} 项可见性</span> : null}
                            {selectedRouteCount > 0 ? <span className="nori-admin-mini-badge is-route">{selectedRouteCount} 项独立路由</span> : null}
                          </div>
                          <p className="m-0 mt-1 text-[11px] nori-admin-muted">
                            User ID: <code>{activeCustomerId}</code>
                            {parentOwnerId
                              ? ` · 所属主账号 ${modelViewUserMap.get(parentOwnerId)?.name || parentOwnerId}（历史子账号规则，建议迁移至主账号管理或点击右侧恢复默认移除）`
                              : selectedSubCount > 0
                                ? ` · 自动覆盖该主账号及其名下全部 ${selectedSubCount} 个子账号`
                                : ' · 按客户主账号生效，自动覆盖名下全部子账号'}
                          </p>
                        </div>
                        <button
                          type="button"
                          className="fos-btn fos-btn-ghost fos-btn-sm"
                          onClick={() => resetCustomerProfile(activeCustomerId)}
                        >
                          <AppIcon name="undo" className="h-3.5 w-3.5" />
                          {parentOwnerId ? '移除历史子账号配置' : '恢复该客户全部默认'}
                        </button>
                      </div>

                      {isSelectedInternal ? (
                        <div className="px-4 pt-3">
                          <div className="nori-admin-alert is-warn mb-0">
                            <div className="nori-admin-alert-body">
                              <AppIcon name="alert" className="mt-0.5 h-4 w-4 shrink-0" />
                              <span>该账号当前位于「内部完整模型视图白名单」，登录创作端将直接看到全部底层供应商模型，下方客户白标配置对其暂不生效。</span>
                            </div>
                          </div>
                        </div>
                      ) : null}

                      <div className="nori-admin-customer-pane-tools">
                        <div className="nori-admin-filter-row">
                          <div className="nori-admin-seg" role="group" aria-label="按模型类型筛选客户配置">
                            {([
                              ['all', '全部'],
                              ['video', '视频'],
                              ['image', '图片'],
                              ['llm', '文本'],
                              ['audio', '语音'],
                            ] as const).map(([key, label]) => (
                              <button
                                key={key}
                                type="button"
                                className={`nori-admin-seg-btn${customerModalityFilter === key ? ' is-active' : ''}`}
                                onClick={() => setCustomerModalityFilter(key)}
                              >
                                {label}
                              </button>
                            ))}
                          </div>
                          <button
                            type="button"
                            className={`nori-admin-seg-btn border border-white/10${onlyCustomizedRows ? ' is-active' : ''}`}
                            onClick={() => setOnlyCustomizedRows((prev) => !prev)}
                          >
                            仅看已定制
                          </button>
                        </div>
                        <AdminSearch value={customerModelSearch} onChange={setCustomerModelSearch} placeholder="搜索模型或供应商" />
                      </div>

                      <div className="nori-admin-table-wrap">
                        <table className="nori-admin-table nori-admin-route-table min-w-[740px]">
                          <thead>
                            <tr>
                              <th>客户看到的模型名</th>
                              <th>可见性</th>
                              <th>专属底层供应商</th>
                            </tr>
                          </thead>
                          <tbody>
                            {rows.length > 0 ? rows.map((model) => {
                              const displayName = model.customerName || model.name
                              const directVis = selectedVisOverrides[model.key]
                              const visMode: 'inherit' | 'show' | 'hide' = directVis === true ? 'show' : directVis === false ? 'hide' : 'inherit'
                              const inheritedVis = parentOwnerId && Object.prototype.hasOwnProperty.call(parentVisOverrides, model.key)
                                ? parentVisOverrides[model.key] === true
                                : customerVisibleModels[model.key] === true
                              const effectiveVisible = visMode === 'show' ? true : visMode === 'hide' ? false : inheritedVis

                              const directRoute = selectedRouteOverrides[model.key] || ''
                              const parentRoute = parentOwnerId ? (parentRouteOverrides[model.key] || '') : ''
                              const globalRoute = config.modelRouting[model.key] || ''
                              const inheritedRoute = parentRoute || globalRoute
                              const effectiveRoute = directRoute || inheritedRoute
                              const sameTypeOptions = config.models.filter((candidate) => candidate.type === model.type)
                              const isCustomized = visMode !== 'inherit' || Boolean(directRoute)
                              const readiness = runtimeReadiness(effectiveRoute)

                              return (
                                <tr key={model.key} className={isCustomized ? 'is-customized' : undefined}>
                                  <td>
                                    <div className="flex flex-wrap items-center gap-1.5">
                                      <strong className="text-[12.5px] text-white">{displayName}</strong>
                                      <em className={MODEL_TIER_TONES[model.tier]}>{MODEL_TIER_LABELS[model.tier]}</em>
                                      <span className="nori-admin-mini-badge">{MODEL_TYPE_LABELS[model.type]}</span>
                                      {directRoute ? <span className="nori-admin-mini-badge is-route">独立路由</span> : null}
                                    </div>
                                    <div className="mt-1 text-[11px] nori-admin-muted">
                                      <code>{model.key}</code>
                                    </div>
                                  </td>
                                  <td>
                                    <div className="nori-admin-vis-seg" role="group" aria-label={`${selectedLabel} 的 ${displayName} 可见性`}>
                                      {([
                                        ['inherit', '继承默认'],
                                        ['show', '强制可见'],
                                        ['hide', '强制隐藏'],
                                      ] as const).map(([modeKey, modeLabel]) => (
                                        <button
                                          key={modeKey}
                                          type="button"
                                          aria-pressed={visMode === modeKey}
                                          className={`nori-admin-vis-btn is-${modeKey}${visMode === modeKey ? ' is-active' : ''}`}
                                          onClick={() => setOverrideValue(activeCustomerId, model.key, modeKey)}
                                        >
                                          {modeLabel}
                                        </button>
                                      ))}
                                    </div>
                                    <div>
                                      <span className={`nori-admin-effective-pill${effectiveVisible ? ' is-visible' : ''}`}>
                                        <i />
                                        生效：{effectiveVisible ? '客户可见' : '对客户隐藏'}
                                        {visMode === 'inherit' && parentOwnerId && Object.prototype.hasOwnProperty.call(parentVisOverrides, model.key) ? '（继承主账号）' : ''}
                                      </span>
                                    </div>
                                  </td>
                                  <td>
                                    <select
                                      aria-label={`${selectedLabel} 的 ${displayName} 底层供应商`}
                                      className={`fos-input nori-admin-input-dense nori-admin-route-select${directRoute ? ' is-overridden' : ''}`}
                                      value={directRoute}
                                      onChange={(event) => setCustomerRouteOverride(activeCustomerId, model.key, event.target.value)}
                                    >
                                      <option value="">
                                        {parentRoute
                                          ? `跟随主账号（${formatRuntimeModelLabel(parentRoute)}）`
                                          : `跟随全局默认（${formatRuntimeModelLabel(globalRoute)}）`}
                                      </option>
                                      {sameTypeOptions.map((option) => {
                                        const optKey = modelKey(option)
                                        const optReady = runtimeReadiness(optKey)
                                        const globalVideoOff = option.type === 'video' && config.modelEnabled?.[optKey] !== true
                                        const suffix = !optReady.providerReady
                                          ? '（未配密钥）'
                                          : !optReady.kzepReady
                                            ? '（未配 EP）'
                                            : globalVideoOff
                                              ? '（全局关闭·单客生效）'
                                              : ''
                                        return (
                                          <option key={optKey} value={optKey}>
                                            {`${PROVIDER_DISPLAY_NAMES[option.provider] || option.provider} · ${option.name || option.modelId}${suffix}`}
                                          </option>
                                        )
                                      })}
                                    </select>
                                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10.5px]">
                                      {directRoute ? (
                                        <span className="nori-admin-mini-badge is-route">独立路由已生效</span>
                                      ) : (
                                        <span className="nori-admin-muted">{parentRoute ? '继承主账号路由' : '跟随全局路由'}</span>
                                      )}
                                      {effectiveVisible && !effectiveRoute ? (
                                        <span className="nori-admin-mini-badge is-warn">未配置底层路由</span>
                                      ) : effectiveRoute && !readiness.providerReady ? (
                                        <span className="nori-admin-mini-badge is-warn">目标服务商未配密钥</span>
                                      ) : effectiveRoute && !readiness.kzepReady ? (
                                        <span className="nori-admin-mini-badge is-warn">未配置国际版 EP</span>
                                      ) : null}
                                    </div>
                                  </td>
                                </tr>
                              )
                            }) : (
                              <tr>
                                <td colSpan={3} className="nori-admin-empty">当前筛选条件下没有模型</td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )
                })() : null}
              </div>
            )}
        </div>
      </section>

      <section className="nori-admin-panel" aria-labelledby="internal-whitelist-title">
        <div className="nori-admin-panel-head">
          <div>
            <span className="nori-admin-step">{showJumpbar ? '03-C' : '内部白名单'}</span>
            <h2 id="internal-whitelist-title">内部完整模型视图白名单</h2>
            <p>名单内的内部账号（如 caoshuang、王卓、admin@caoshuang 等）在画布、工具箱与分镜生成中可见全部底层供应商与路由信息（最多 100 个）。</p>
          </div>
          <span className="nori-admin-pill is-internal"><i />已添加 {internalUserIds.length} 人</span>
        </div>
        <div className="nori-admin-panel-body">
          <div className="flex flex-wrap gap-2">
            {internalUserIds.length > 0 ? internalUserIds.map((userId) => {
              const user = modelViewUserMap.get(userId)
              const initial = (user?.name || userId).slice(0, 1).toUpperCase()
              return (
                <span key={userId} className="nori-admin-viewer-chip">
                  <span className="nori-admin-viewer-avatar" aria-hidden="true">{initial}</span>
                  <strong>{user ? `${user.name}（${roleLabel(user.role)}）` : '账号'}</strong>
                  <code className="text-[10.5px] opacity-65">{userId}</code>
                  <button
                    type="button"
                    className="nori-admin-viewer-remove"
                    aria-label={`移除内部视图白名单 ${user?.name || userId}`}
                    onClick={() => removeInternalViewer(userId)}
                  >
                    ×
                  </button>
                </span>
              )
            }) : <span className="text-[11.5px] nori-admin-muted">暂未配置内部白名单账号，所有账号默认使用客户白标视图。</span>}
          </div>
          <div className="mt-3.5 flex flex-wrap items-center gap-2">
            {selectableInternalUsers.length > 0 ? (
              <select
                aria-label="选择要加入内部完整模型视图的账号"
                className="fos-input nori-admin-input-dense w-auto min-w-[250px]"
                value={internalUserPick}
                onChange={(event) => {
                  const value = event.target.value
                  setInternalUserPick(value)
                  if (value) addInternalViewer(value)
                }}
              >
                <option value="">从管理员/主账号快速添加…</option>
                {selectableInternalUsers.map((user) => {
                  const subCount = getSubAccountCount(user)
                  return (
                    <option key={user.id} value={user.id}>
                      {`${user.name}（${roleLabel(user.role)}${subCount > 0 ? ` · 含 ${subCount} 个子账号` : ''}）· ${user.id}`}
                    </option>
                  )
                })}
              </select>
            ) : null}
            <input
              type="text"
              aria-label="输入内部视图账号 User ID"
              className="fos-input nori-admin-input-dense w-auto min-w-[220px]"
              value={internalUserInput}
              placeholder="或手动输入 User ID"
              onChange={(event) => setInternalUserInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  addInternalViewer(internalUserInput)
                }
              }}
            />
            <button
              type="button"
              className="fos-btn fos-btn-ghost fos-btn-sm"
              disabled={!internalUserInput.trim() || internalUserIds.includes(internalUserInput.trim()) || internalUserIds.length >= 100}
              onClick={() => addInternalViewer(internalUserInput)}
            >
              <AppIcon name="plus" className="h-3.5 w-3.5" />
              添加
            </button>
          </div>
        </div>
      </section>
      </>
      ) : null}

      {/* 04 Asset Storage */}
      {showUsage ? (
      <>
      <section id={SECTION_ANCHORS.storage} className="nori-admin-panel" aria-labelledby="asset-storage">
        <div className="nori-admin-panel-head">
          <div>
            <span className="nori-admin-step">{showJumpbar ? '04' : '对象存储'}</span>
            <div className="flex items-center gap-2.5">
              <h2 id="asset-storage">素材存储</h2>
              <StatusBadge health={storageHealth} />
            </div>
            <p>TOS 只用于保存生成素材，不是模型 API。密钥留空表示不修改。</p>
          </div>
          <button
            type="button"
            className="fos-btn fos-btn-ghost fos-btn-sm"
            disabled={probing === 'storage:tos'}
            onClick={() => props.probe('storage', 'tos')}
          >
            {probing === 'storage:tos' ? <AppIcon name="loader" className="h-3.5 w-3.5 animate-spin" /> : null}
            {probing === 'storage:tos' ? '检测中' : '检测存储'}
          </button>
        </div>
        <div className="nori-admin-storage-strip">
          <div className="nori-admin-storage-kv">
            <span>Bucket</span>
            <strong title={config.storage.bucket}>{config.storage.bucket || '未配置'}</strong>
          </div>
          <div className="nori-admin-storage-kv">
            <span>Region</span>
            <strong>{config.storage.region || '—'}</strong>
          </div>
          <div className="nori-admin-storage-kv">
            <span>Endpoint</span>
            <strong title={config.storage.endpoint}>{config.storage.endpoint || '—'}</strong>
          </div>
          <div className="nori-admin-storage-kv">
            <span>访问凭证</span>
            <div className="flex items-center gap-1.5 pt-0.5">
              <span className={`nori-admin-secret-status ${props.storageAccessKey.trim() ? 'is-pending' : config.storage.hasAccessKey ? 'is-ok' : 'is-missing'}`}>
                AK {props.storageAccessKey.trim() ? '待保存' : config.storage.hasAccessKey ? '已配' : '缺失'}
              </span>
              <span className={`nori-admin-secret-status ${props.storageSecretKey.trim() ? 'is-pending' : config.storage.hasSecretKey ? 'is-ok' : 'is-missing'}`}>
                SK {props.storageSecretKey.trim() ? '待保存' : config.storage.hasSecretKey ? '已配' : '缺失'}
              </span>
            </div>
          </div>
        </div>
        <details className="nori-admin-advanced" open={!config.storage.hasAccessKey || !config.storage.hasSecretKey}>
          <summary>存储连接与高级设置<AppIcon name="chevronDown" /></summary>
          <div className="nori-admin-panel-body grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {([['endpoint', 'Endpoint'], ['publicEndpoint', 'Public Endpoint'], ['region', 'Region'], ['bucket', 'Bucket']] as const).map(([field, label]) => (
              <label key={field} className="nori-admin-field">
                {label}
                <input
                  className="fos-input"
                  value={config.storage[field]}
                  onChange={(event) => props.markConfig((current) => ({ ...current, storage: { ...current.storage, [field]: event.target.value } }))}
                />
              </label>
            ))}
            <label className="nori-admin-field">
              AccessKey ID
              <PasswordInput
                autoComplete="new-password"
                className="fos-input"
                value={props.storageAccessKey}
                placeholder={config.storage.hasAccessKey ? '已配置；留空不修改' : '请输入 AccessKey ID'}
                onChange={(event) => { props.setStorageAccessKey(event.target.value); props.setDirty(true) }}
              />
            </label>
            <label className="nori-admin-field">
              SecretAccessKey
              <PasswordInput
                autoComplete="new-password"
                className="fos-input"
                value={props.storageSecretKey}
                placeholder={config.storage.hasSecretKey ? '已配置；留空不修改' : '请输入 SecretAccessKey'}
                onChange={(event) => { props.setStorageSecretKey(event.target.value); props.setDirty(true) }}
              />
            </label>
          </div>
        </details>
      </section>

      {/* 05 Service Usage */}
      <section id={SECTION_ANCHORS.usage} className="nori-admin-panel" aria-labelledby="service-usage">
        <div className="nori-admin-panel-head">
          <div>
            <span className="nori-admin-step">{showJumpbar ? '05' : '调用对账'}</span>
            <h2 id="service-usage">调用用量</h2>
            <p>只读统计；按实际服务类型分别计价。</p>
          </div>
          <select
            aria-label="用量时间范围"
            className="fos-input nori-admin-input-dense w-auto"
            value={rangeDays}
            onChange={(event) => props.setRangeDays(Number(event.target.value))}
          >
            <option value={7}>近 7 天</option>
            <option value={30}>近 30 天</option>
            <option value={90}>近 90 天</option>
          </select>
        </div>
        <div className="nori-admin-metrics nori-admin-metrics--compact is-usage nori-admin-usage-metrics">
          {[
            ['调用', formatNumber(usage?.summary.calls || 0)],
            ['成功', formatNumber(usage?.summary.success || 0)],
            ['失败', formatNumber(usage?.summary.failed || 0)],
            ...((usage?.summary.byType || []).map((row) => [`${row.label}模型`, formatUsageMoney(row.cost)] as const)),
          ].map(([label, value]) => (
            <div key={String(label)} className="nori-admin-metric">
              <span className="text-[12px] nori-admin-muted">{label}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </div>
        <div className="nori-admin-panel-body">
          <p className="nori-admin-subtle">按服务商对账 · 金额为按上游定价估算的成本，不等于向用户收取的积分</p>
        </div>
        <div className="nori-admin-table-wrap">
          <table className="nori-admin-table" aria-label="按服务商对账">
            <thead>
              <tr><th>服务商</th><th>调用</th><th>失败</th><th>视频(次 / 秒 / 成本)</th><th>其它成本</th><th>合计成本</th></tr>
            </thead>
            <tbody>
              {usage?.byProvider.length ? usage.byProvider.map((row) => {
                const video = row.byType.filter((item) => normalizeModelUsageType(item.serviceType) === 'video')
                const videoCalls = video.reduce((total, item) => total + item.calls, 0)
                const videoUnits = video.reduce((total, item) => total + item.units, 0)
                const videoCost = video.reduce((total, item) => total + item.cost, 0)
                return (
                  <tr key={row.provider}>
                    <td className="font-medium">{row.provider}</td>
                    <td>{row.calls}</td>
                    <td className={row.failed ? 'nori-admin-danger-text' : 'nori-admin-muted'}>{row.failed}</td>
                    <td>{videoCalls ? `${videoCalls} 次 / ${videoUnits} 秒 / ${formatUsageMoney(videoCost)}` : '—'}</td>
                    <td>{formatUsageMoney(row.cost - videoCost)}</td>
                    <td><strong>{formatUsageMoney(row.cost)}</strong></td>
                  </tr>
                )
              }) : <tr><td colSpan={6} className="nori-admin-empty">暂无已采集的服务用量</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="nori-admin-subbar">
          <label className="nori-admin-subbar-field">
            <span>用途</span>
            <select
              aria-label="用途"
              className="fos-input nori-admin-input-dense w-auto"
              value={usagePurpose}
              onChange={(event) => setUsagePurpose(event.target.value)}
            >
              <option value="all">全部</option>
              <option value="agent">喵导</option>
              <option value="other">其他</option>
            </select>
          </label>
          <div className="nori-admin-filter-row">
            <span className="text-[11.5px] nori-admin-muted">共 {usageRows.length} 条明细</span>
            <AdminSearch value={usageSearch} onChange={setUsageSearch} placeholder="筛选服务商或模型" />
          </div>
        </div>
        <div className="nori-admin-table-wrap">
          <table className="nori-admin-table min-w-[900px]">
            <thead>
              <tr><th>服务</th><th>模型</th><th>用途 / 类型</th><th>调用</th><th>失败</th><th>输入 Token</th><th>输出 Token</th><th>金额</th><th>平均耗时</th><th>最近使用</th></tr>
            </thead>
            <tbody>
              {usageRows.length ? usageRows.map((row) => {
                const type = normalizeModelUsageType(row.serviceType)
                return (
                  <tr key={`${row.provider}-${row.modelKey}-${row.serviceType}-${row.operation}`}>
                    <td className="font-medium">{row.provider}</td>
                    <td className="nori-admin-muted">{row.modelKey || row.serviceType}</td>
                    <td>{row.operation === 'canvas_agent' ? '喵导' : type ? MODEL_USAGE_TYPE_LABELS[type] : row.serviceType}</td>
                    <td>{row.calls}</td>
                    <td className={row.failed ? 'nori-admin-danger-text' : 'nori-admin-muted'}>{row.failed}</td>
                    <td>{row.inputTokens}</td>
                    <td>{row.outputTokens}</td>
                    <td><strong>{formatUsageMoney(row.cost)}</strong></td>
                    <td>{row.averageLatencyMs == null ? '—' : `${row.averageLatencyMs}ms`}</td>
                    <td className="nori-admin-muted">{formatDate(row.lastUsedAt)}</td>
                  </tr>
                )
              }) : <tr><td colSpan={10} className="nori-admin-empty">暂无已采集的服务用量</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
      </>
      ) : null}
    </div>
  )
}
