'use client'

import type { Dispatch, SetStateAction } from 'react'
import { AppIcon } from '@/components/ui/icons'
import { AdminHealthBadge } from '@/components/admin/PlatformAdminShell'
import {
  MODEL_TIER_LABELS,
  MODEL_TIER_TONES,
  MODEL_TYPE_LABELS,
  formatDate,
  formatNumber,
  modelKey,
  type HealthRow,
  type ProviderDraft,
  type ServiceConfig,
  type UsageOverview,
} from '@/components/admin/platform-admin-services'
import { formatUsageMoney, MODEL_USAGE_TYPE_LABELS, normalizeModelUsageType } from '@/lib/platform-services/model-type-usage'

function StatusBadge({ health }: { health?: HealthRow }) {
  return <AdminHealthBadge status={health?.status} latencyMs={health?.latencyMs} />
}

type PanelsProps = {
  config: ServiceConfig
  usage: UsageOverview | null
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
  const { config, usage, rangeDays, healthMap, usageByProvider, providerSecrets, probing } = props
  return (
    <div className="nori-admin-stack">
      <section className="nori-admin-panel" aria-labelledby="service-connections">
        <div className="nori-admin-panel-head">
          <div><span className="nori-admin-step">01</span><h2 id="service-connections">API 连接</h2><p>只需维护两套平台密钥。DeepSeek 负责文本，Kuaizi 负责图片、视频和语音。</p></div>
        </div>
        <div className="grid gap-4 p-4 xl:grid-cols-2">
          {config.providers.map((provider, index) => {
            const isKuaizi = provider.id === 'kuaizi'
            const health = healthMap.get(`provider:${provider.id}`)
            const providerUsage = usageByProvider.get(provider.id)
            const pending = Boolean(providerSecrets[provider.id]?.trim())
            return (
              <article key={provider.id} className={`nori-admin-card nori-admin-provider p-4 is-${provider.id}`}>
                <div className="nori-admin-connection-head">
                  <span className="nori-admin-provider-icon"><AppIcon name={isKuaizi ? 'sparklesAlt' : 'cpu'} /></span>
                  <div><h3>{provider.name}</h3><p>{isKuaizi ? '创意媒体服务' : '官方文本服务'}</p></div>
                  <StatusBadge health={health} />
                </div>
                <div className="nori-admin-capabilities">
                  {(isKuaizi ? ['图片', '视频', '语音合成'] : ['剧本', '提示词', '文本分析']).map((item) => <span key={item}>{item}</span>)}
                </div>
                <label className="nori-admin-field">
                  <span className="nori-admin-field-label"><span>API Key</span><span className={`nori-admin-secret-status ${pending ? 'is-pending' : provider.hasApiKey ? 'is-ok' : 'is-missing'}`}>{pending ? '待保存' : provider.hasApiKey ? '已配置' : '待配置'}</span></span>
                  <input type="password" autoComplete="new-password" className="fos-input" value={providerSecrets[provider.id] || ''} placeholder={provider.hasApiKey ? '已安全保存；留空不修改' : '粘贴平台 API Key'} onChange={(event) => { props.setProviderSecrets((current) => ({ ...current, [provider.id]: event.target.value })); props.setDirty(true) }} />
                </label>
                {isKuaizi ? <label className="nori-admin-field mt-3">素材组 ID <span className="nori-admin-muted">选填</span><input className="fos-input" value={provider.assetGroupId || ''} placeholder="用于 Kuaizi 素材归属" onChange={(event) => props.updateProvider(index, { assetGroupId: event.target.value.trim() })} /></label> : null}
                <div className="nori-admin-provider-foot">
                  <span title={provider.baseUrl}>{provider.baseUrl}</span>
                  <button type="button" className="fos-btn fos-btn-ghost fos-btn-sm" disabled={probing === `provider:${provider.id}`} onClick={() => props.probe('provider', provider.id)}>{probing === `provider:${provider.id}` ? '检测中' : '检测连接'}</button>
                </div>
                <p className="nori-admin-subtle">{health?.message || '保存密钥后可检测连接'} · {providerUsage ? `${providerUsage.calls} 次 · ${formatUsageMoney(providerUsage.cost)}` : '暂无用量'}</p>
              </article>
            )
          })}
        </div>
      </section>

      <section className="nori-admin-panel" aria-labelledby="purpose-models">
        <div className="nori-admin-panel-head"><div><span className="nori-admin-step">02</span><h2 id="purpose-models">按用途选择模型</h2><p>创作端始终使用稳定能力名称；这里只决定它调用哪一个官方模型，无需管理模型表或 Provider ID。</p></div></div>
        <div className="nori-admin-purpose-grid">
          {(['llm', 'image', 'video', 'audio'] as const).map((type) => (
            <section key={type} className={`nori-admin-purpose is-${type}`}>
              <div className="nori-admin-purpose-head"><AppIcon name={type === 'llm' ? 'fileText' : type === 'image' ? 'image' : type === 'video' ? 'video' : 'volume'} /><div><h3>{MODEL_TYPE_LABELS[type]}</h3><p>{type === 'llm' ? 'DeepSeek 官方' : 'Kuaizi API'}{type === 'audio' ? ' · 仅语音合成' : ''}</p></div></div>
              <div className="nori-admin-purpose-list">
                {config.businessModels.filter((model) => model.type === type).map((model) => {
                  const options = config.models.filter((candidate) => candidate.type === type)
                  const value = config.modelRouting[model.key] || ''
                  return <label key={model.key} className="nori-admin-purpose-row">
                    <span><strong>{model.name}</strong><em className={MODEL_TIER_TONES[model.tier]}>{MODEL_TIER_LABELS[model.tier]}</em><small>{model.description}</small></span>
                    <select className="fos-input nori-admin-input-dense" aria-label={`${model.name}运行模型`} value={value} onChange={(event) => props.markConfig((current) => ({ ...current, modelRouting: { ...current.modelRouting, [model.key]: event.target.value } }))}>
                      <option value="">{config.modelRouting[model.key] ? '不提供此能力' : '未提供此能力'}</option>
                      {options.map((option) => <option key={modelKey(option)} value={modelKey(option)}>{option.name || option.modelId}</option>)}
                    </select>
                  </label>
                })}
              </div>
            </section>
          ))}
        </div>
      </section>

      <section className="nori-admin-panel" aria-labelledby="asset-storage">
        <div className="nori-admin-panel-head"><div><span className="nori-admin-step">03</span><div className="flex items-center gap-2"><h2 id="asset-storage">素材存储</h2><StatusBadge health={healthMap.get('storage:tos')} /></div><p>TOS 只用于保存生成素材，不是模型 API。密钥留空表示不修改。</p></div><button type="button" className="fos-btn fos-btn-ghost fos-btn-sm" disabled={probing === 'storage:tos'} onClick={() => props.probe('storage', 'tos')}>{probing === 'storage:tos' ? '检测中' : '检测存储'}</button></div>
        <details className="nori-admin-advanced" open={!config.storage.hasAccessKey || !config.storage.hasSecretKey}>
          <summary>存储连接与高级设置<AppIcon name="chevronDown" /></summary>
          <div className="nori-admin-panel-body grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {([['endpoint', 'Endpoint'], ['publicEndpoint', 'Public Endpoint'], ['region', 'Region'], ['bucket', 'Bucket']] as const).map(([field, label]) => <label key={field} className="nori-admin-field">{label}<input className="fos-input" value={config.storage[field]} onChange={(event) => props.markConfig((current) => ({ ...current, storage: { ...current.storage, [field]: event.target.value } }))} /></label>)}
            <label className="nori-admin-field">AccessKey ID<input type="password" autoComplete="new-password" className="fos-input" value={props.storageAccessKey} placeholder={config.storage.hasAccessKey ? '已配置；留空不修改' : '请输入 AccessKey ID'} onChange={(event) => { props.setStorageAccessKey(event.target.value); props.setDirty(true) }} /></label>
            <label className="nori-admin-field">SecretAccessKey<input type="password" autoComplete="new-password" className="fos-input" value={props.storageSecretKey} placeholder={config.storage.hasSecretKey ? '已配置；留空不修改' : '请输入 SecretAccessKey'} onChange={(event) => { props.setStorageSecretKey(event.target.value); props.setDirty(true) }} /></label>
          </div>
        </details>
      </section>


      <section className="nori-admin-panel" aria-labelledby="service-usage">
        <div className="nori-admin-panel-head"><div><span className="nori-admin-step">04</span><h2 id="service-usage">调用用量</h2><p>只读统计；按实际服务类型分别计价。</p></div><select aria-label="用量时间范围" className="fos-input nori-admin-input-dense w-auto" value={rangeDays} onChange={(event) => props.setRangeDays(Number(event.target.value))}><option value={7}>近 7 天</option><option value={30}>近 30 天</option><option value={90}>近 90 天</option></select></div>
        <div className="nori-admin-metrics nori-admin-metrics--compact is-usage nori-admin-usage-metrics">
          {[['调用', formatNumber(usage?.summary.calls || 0)], ['成功', formatNumber(usage?.summary.success || 0)], ['失败', formatNumber(usage?.summary.failed || 0)], ...((usage?.summary.byType || []).map((row) => [`${row.label}模型`, formatUsageMoney(row.cost)] as const))].map(([label, value]) => <div key={String(label)} className="nori-admin-metric"><span className="text-[12px] nori-admin-muted">{label}</span><strong>{value}</strong></div>)}
        </div>
        <div className="nori-admin-table-wrap"><table className="nori-admin-table min-w-[900px]"><thead><tr><th>服务</th><th>模型</th><th>类型</th><th>调用</th><th>失败</th><th>金额</th><th>平均耗时</th><th>最近使用</th></tr></thead><tbody>
          {usage?.rows.length ? usage.rows.map((row) => {
            const type = normalizeModelUsageType(row.serviceType)
            return <tr key={`${row.provider}-${row.modelKey}-${row.serviceType}-${row.operation}`}><td className="font-medium">{row.provider}</td><td className="nori-admin-muted">{row.modelKey || row.serviceType}</td><td>{type ? MODEL_USAGE_TYPE_LABELS[type] : row.serviceType}</td><td>{row.calls}</td><td className={row.failed ? 'nori-admin-danger-text' : 'nori-admin-muted'}>{row.failed}</td><td><strong>{formatUsageMoney(row.cost)}</strong></td><td>{row.averageLatencyMs == null ? '—' : `${row.averageLatencyMs}ms`}</td><td className="nori-admin-muted">{formatDate(row.lastUsedAt)}</td></tr>
          }) : <tr><td colSpan={8} className="nori-admin-empty">暂无已采集的服务用量</td></tr>}
        </tbody></table></div>
      </section>
    </div>
  )
}
