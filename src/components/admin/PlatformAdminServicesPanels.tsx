'use client'

import type { Dispatch, SetStateAction } from 'react'
import { AppIcon } from '@/components/ui/icons'
import { AdminHealthBadge } from '@/components/admin/PlatformAdminShell'
import {
  MODEL_TIER_LABELS,
  MODEL_TIER_TONES,
  MODEL_TYPE_LABELS,
  formatBytes,
  formatDate,
  formatNumber,
  modelKey,
  type HealthRow,
  type ModelDraft,
  type ModelType,
  type ProviderDraft,
  type ServiceConfig,
  type UsageOverview,
} from '@/components/admin/platform-admin-services'
import { formatUsageMoney, MODEL_USAGE_TYPE_LABELS, normalizeModelUsageType } from '@/lib/platform-services/model-type-usage'

function usageTypeLabel(serviceType: string) {
  const type = normalizeModelUsageType(serviceType)
  return type ? MODEL_USAGE_TYPE_LABELS[type] : serviceType
}

function StatusBadge({ health }: { health?: HealthRow }) {
  return (
    <AdminHealthBadge
      status={health?.status}
      latencyMs={health?.latencyMs}
    />
  )
}

export function PlatformAdminServicesPanels({
  config,
  usage,
  rangeDays,
  healthMap,
  usageByProvider,
  providerSecrets,
  storageAccessKey,
  storageSecretKey,
  probing,
  syncingProvider,
  markConfig,
  updateProvider,
  addProvider,
  removeProvider,
  addModel,
  updateModel,
  removeModel,
  setProviderSecrets,
  setStorageAccessKey,
  setStorageSecretKey,
  setDirty,
  setRangeDays,
  probe,
  syncProviderModels,
}: {
  config: ServiceConfig
  usage: UsageOverview | null
  rangeDays: number
  healthMap: Map<string, HealthRow>
  usageByProvider: Map<string, { calls: number; cost: number }>
  providerSecrets: Record<string, string>
  storageAccessKey: string
  storageSecretKey: string
  probing: string
  syncingProvider: string
  markConfig: (updater: (current: ServiceConfig) => ServiceConfig) => void
  updateProvider: (index: number, patch: Partial<ProviderDraft>) => void
  addProvider: () => void
  removeProvider: (providerId: string) => void
  addModel: () => void
  updateModel: (index: number, patch: Partial<ModelDraft>) => void
  removeModel: (index: number) => void
  setProviderSecrets: Dispatch<SetStateAction<Record<string, string>>>
  setStorageAccessKey: (value: string) => void
  setStorageSecretKey: (value: string) => void
  setDirty: (value: boolean) => void
  setRangeDays: (value: number) => void
  probe: (targetType: 'provider' | 'storage', targetId: string) => void
  syncProviderModels: (providerId: string) => void
}) {
  return (
    <div className="nori-admin-stack">
      <section className="nori-admin-panel">
        <div className="nori-admin-panel-head">
          <div>
            <h2>LLM 与生成服务</h2>
            <p>API Key 永不回显；输入新 Key 才会替换旧值。</p>
          </div>
          <button type="button" className="fos-btn fos-btn-ghost fos-btn-sm" onClick={addProvider}>
            <AppIcon name="plus" className="h-3.5 w-3.5" />添加服务
          </button>
        </div>
        <div className="grid gap-4 p-4 xl:grid-cols-2">
          {config.providers.map((provider, index) => {
            const providerHealth = healthMap.get(`provider:${provider.id}`)
            const providerUsage = usageByProvider.get(provider.id)
            const family = provider.id.split(':')[0]
            const isArk = family === 'ark'
            const isKuaizi = family === 'kuaizi'
            const canSyncModels = ['deepseek', 'kuaizi'].includes(family)
            const hasPendingSecret = Boolean(providerSecrets[provider.id]?.trim())
            return (
              <article key={`${provider.id}-${index}`} className="nori-admin-card p-4">
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <strong className="text-[14px]">{provider.name || provider.id}</strong>
                      <StatusBadge health={providerHealth} />
                    </div>
                    <p className="nori-admin-subtle">{providerHealth?.message || '保存后可以执行连通性检测'} · {formatDate(providerHealth?.checkedAt || null)}</p>
                  </div>
                  <div className="nori-admin-actions">
                    {canSyncModels ? (
                      <button type="button" className="fos-btn fos-btn-ghost fos-btn-sm" disabled={syncingProvider === provider.id} onClick={() => void syncProviderModels(provider.id)}>
                        {syncingProvider === provider.id ? '同步中' : '同步模型'}
                      </button>
                    ) : null}
                    <button type="button" className="fos-btn fos-btn-ghost fos-btn-sm" disabled={probing === `provider:${provider.id}`} onClick={() => void probe('provider', provider.id)}>
                      {probing === `provider:${provider.id}` ? '检测中' : '检测'}
                    </button>
                    <button type="button" className="fos-icon-btn text-red-300" onClick={() => removeProvider(provider.id)}>
                      <AppIcon name="trash" className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="nori-admin-field">服务名称<input className="fos-input" value={provider.name} onChange={(event) => updateProvider(index, { name: event.target.value })} /></label>
                  <label className="nori-admin-field">Provider ID<input className="fos-input" value={provider.id} disabled={provider.hasApiKey} onChange={(event) => updateProvider(index, { id: event.target.value.toLowerCase() })} /></label>
                  {!isArk ? <label className="nori-admin-field sm:col-span-2">Base URL<input className="fos-input" value={provider.baseUrl || ''} placeholder="https://api.example.com/v1" onChange={(event) => updateProvider(index, { baseUrl: event.target.value })} /></label> : null}
                  {isKuaizi ? <label className="nori-admin-field sm:col-span-2">素材组 ID<input className="fos-input" value={provider.assetGroupId || ''} placeholder="筷子丽帧素材组 ID" onChange={(event) => updateProvider(index, { assetGroupId: event.target.value.trim() })} /></label> : null}
                  <label className="nori-admin-field sm:col-span-2">
                    <span className="nori-admin-field-label">
                      <span>API Key</span>
                      <span className={hasPendingSecret ? 'text-amber-300' : provider.hasApiKey ? 'text-emerald-300' : 'text-red-300'}>
                        {hasPendingSecret ? '待保存' : provider.hasApiKey ? '已配置' : '未配置'}
                      </span>
                    </span>
                    <input type="password" autoComplete="new-password" className="fos-input" value={providerSecrets[provider.id] || ''} placeholder={provider.hasApiKey ? '已配置；留空表示不修改' : '请输入 API Key'} onChange={(event) => { setProviderSecrets((current) => ({ ...current, [provider.id]: event.target.value })); setDirty(true) }} />
                  </label>
                </div>
                <div className="mt-3 flex items-center justify-between border-t border-white/[.08] pt-3 text-[12px] text-white/50">
                  <span>{config.models.filter((model) => model.provider === provider.id).length} 个模型</span>
                  <span>{providerUsage ? `${providerUsage.calls} 次 · ${formatUsageMoney(providerUsage.cost)}` : '暂无用量'}</span>
                </div>
              </article>
            )
          })}
        </div>
      </section>

      <section className="nori-admin-panel">
        <div className="nori-admin-panel-head">
          <div>
            <h2>模型配置</h2>
            <p>模型键由 Provider ID 与 Model ID 自动组成。</p>
          </div>
          <button type="button" className="fos-btn fos-btn-ghost fos-btn-sm" onClick={addModel}>
            <AppIcon name="plus" className="h-3.5 w-3.5" />添加模型
          </button>
        </div>
        <div className="nori-admin-table-wrap">
          <table className="nori-admin-table min-w-[1040px]">
            <thead>
              <tr>
                <th>名称</th><th>Model ID</th><th>服务</th><th>类型</th><th>LLM 协议</th><th />
              </tr>
            </thead>
            <tbody>
              {config.models.map((model, index) => (
                <tr key={`${modelKey(model)}-${index}`}>
                  <td><input className="fos-input h-9" value={model.name || ''} onChange={(event) => updateModel(index, { name: event.target.value })} /></td>
                  <td><input className="fos-input h-9" value={model.modelId} onChange={(event) => updateModel(index, { modelId: event.target.value })} /></td>
                  <td>
                    <select className="fos-input h-9" value={model.provider} onChange={(event) => updateModel(index, { provider: event.target.value })}>
                      {config.providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}
                    </select>
                  </td>
                  <td>
                    <select className="fos-input h-9" value={model.type} onChange={(event) => updateModel(index, { type: event.target.value as ModelType })}>
                      {Object.entries(MODEL_TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                  </td>
                  <td>
                    {model.type === 'llm' ? (
                      <select className="fos-input h-9" value={model.llmProtocol || ''} onChange={(event) => updateModel(index, { llmProtocol: event.target.value as ModelDraft['llmProtocol'] })}>
                        <option value="">官方协议</option>
                        <option value="responses">Responses API</option>
                        <option value="chat-completions">Chat Completions</option>
                      </select>
                    ) : <span className="nori-admin-muted">—</span>}
                  </td>
                  <td>
                    <button type="button" className="fos-icon-btn text-red-300" onClick={() => removeModel(index)}>
                      <AppIcon name="trash" className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="nori-admin-panel">
          <div className="nori-admin-panel-head">
            <div>
              <h2>业务模型路由</h2>
              <p>Mini 用于低成本预演，Fast 用于快速迭代，Pro 用于正式生产；未接入的档位会在创作端禁用。</p>
            </div>
          </div>
          <div className="nori-admin-panel-body nori-admin-stack">
            {config.businessModels.map((businessModel) => {
              const targetKey = config.modelRouting[businessModel.key] || ''
              const targetProvider = targetKey.split('::')[0] || ''
              return (
                <label key={businessModel.key} className="nori-admin-card grid gap-2 p-3 sm:grid-cols-[170px_1fr] sm:items-center">
                  <span>
                    <span className="flex items-center gap-2">
                      <strong className="text-[13px]">{businessModel.name}</strong>
                      <em className={`rounded-full border px-1.5 py-0.5 text-[9px] font-bold not-italic ${MODEL_TIER_TONES[businessModel.tier]}`}>{MODEL_TIER_LABELS[businessModel.tier]}</em>
                    </span>
                    <span className="mt-1 block text-[12px] text-white/50">{businessModel.description}</span>
                  </span>
                  <span>
                    <select className="fos-input h-9 w-full" value={targetKey} onChange={(event) => markConfig((current) => ({ ...current, modelRouting: { ...current.modelRouting, [businessModel.key]: event.target.value } }))}>
                      <option value="">未接入</option>
                      {config.models.filter((model) => model.type === businessModel.type).map((model) => (
                        <option key={modelKey(model)} value={modelKey(model)}>{model.name || model.modelId} · {model.provider}</option>
                      ))}
                    </select>
                    <span className="mt-1.5 flex items-center justify-between text-[12px] text-white/50">
                      <span>{targetKey || '该档位暂不可用'}</span>
                      {targetProvider ? <StatusBadge health={healthMap.get(`provider:${targetProvider}`)} /> : null}
                    </span>
                  </span>
                </label>
              )
            })}
          </div>
        </section>

        <section className="nori-admin-panel">
          <div className="nori-admin-panel-head">
            <div>
              <h2>视频转绘模型</h2>
              <p>直接控制视频反译、分镜提取和海外改编，不再读取 ARK 模型环境变量。</p>
            </div>
          </div>
          <div className="nori-admin-panel-body grid gap-3 sm:grid-cols-2">
            <label className="nori-admin-field">服务
              <select className="fos-input" value={config.videoRepaint.providerId} onChange={(event) => markConfig((current) => ({ ...current, videoRepaint: { ...current.videoRepaint, providerId: event.target.value } }))}>
                {config.providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}
              </select>
            </label>
            <label className="nori-admin-field">抽帧 FPS
              <input type="number" min="0.1" max="10" step="0.1" className="fos-input" value={config.videoRepaint.fps} onChange={(event) => markConfig((current) => ({ ...current, videoRepaint: { ...current.videoRepaint, fps: Number(event.target.value) } }))} />
            </label>
            <label className="nori-admin-field sm:col-span-2">视频理解模型 ID
              <input className="fos-input" value={config.videoRepaint.understandingModel} onChange={(event) => markConfig((current) => ({ ...current, videoRepaint: { ...current.videoRepaint, understandingModel: event.target.value } }))} />
            </label>
            <label className="nori-admin-field sm:col-span-2">剧本转绘模型 ID
              <input className="fos-input" value={config.videoRepaint.adaptationModel} onChange={(event) => markConfig((current) => ({ ...current, videoRepaint: { ...current.videoRepaint, adaptationModel: event.target.value } }))} />
            </label>
          </div>
        </section>
      </div>

      <section className="nori-admin-panel">
        <div className="nori-admin-panel-head">
          <div>
            <div className="flex items-center gap-2">
              <h2>火山 TOS 存储</h2>
              <StatusBadge health={healthMap.get('storage:tos')} />
            </div>
            <p>检测会执行一次极小文件的上传、读取、签名访问与删除。</p>
          </div>
          <button type="button" className="fos-btn fos-btn-ghost fos-btn-sm" disabled={probing === 'storage:tos'} onClick={() => void probe('storage', 'tos')}>
            {probing === 'storage:tos' ? '检测中' : '检测 TOS'}
          </button>
        </div>
        <div className="nori-admin-panel-body grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <label className="nori-admin-field">Endpoint<input className="fos-input" value={config.storage.endpoint} onChange={(event) => markConfig((current) => ({ ...current, storage: { ...current.storage, endpoint: event.target.value } }))} /></label>
          <label className="nori-admin-field">Public Endpoint<input className="fos-input" value={config.storage.publicEndpoint} onChange={(event) => markConfig((current) => ({ ...current, storage: { ...current.storage, publicEndpoint: event.target.value } }))} /></label>
          <label className="nori-admin-field">Region<input className="fos-input" value={config.storage.region} onChange={(event) => markConfig((current) => ({ ...current, storage: { ...current.storage, region: event.target.value } }))} /></label>
          <label className="nori-admin-field">Bucket<input className="fos-input" value={config.storage.bucket} onChange={(event) => markConfig((current) => ({ ...current, storage: { ...current.storage, bucket: event.target.value } }))} /></label>
          <label className="nori-admin-field">AccessKey ID
            <input type="password" className="fos-input" autoComplete="new-password" value={storageAccessKey} placeholder={config.storage.hasAccessKey ? '已配置；留空不修改' : '请输入 AccessKey ID'} onChange={(event) => { setStorageAccessKey(event.target.value); setDirty(true) }} />
          </label>
          <label className="nori-admin-field">SecretAccessKey
            <input type="password" className="fos-input" autoComplete="new-password" value={storageSecretKey} placeholder={config.storage.hasSecretKey ? '已配置；留空不修改' : '请输入 SecretAccessKey'} onChange={(event) => { setStorageSecretKey(event.target.value); setDirty(true) }} />
          </label>
        </div>
      </section>

      <section className="nori-admin-panel">
        <div className="nori-admin-panel-head">
          <div>
            <h2>服务用量</h2>
            <p>按文本、图片、视频、语音统计已计价金额，不再把不同类型模型折成一个 Token 总数。</p>
          </div>
          <select className="fos-input h-9 w-auto" value={rangeDays} onChange={(event) => setRangeDays(Number(event.target.value))}>
            <option value={7}>近 7 天</option>
            <option value={30}>近 30 天</option>
            <option value={90}>近 90 天</option>
          </select>
        </div>
        <div className="nori-admin-metrics nori-admin-metrics--compact is-usage border-b border-white/[.08] p-4">
          {[
            ['调用', formatNumber(usage?.summary.calls || 0)],
            ['成功', formatNumber(usage?.summary.success || 0)],
            ['失败', formatNumber(usage?.summary.failed || 0)],
            ...((usage?.summary.byType || []).map((row) => (
              [`${row.label}模型`, formatUsageMoney(row.cost)] as const
            ))),
          ].map(([label, value]) => (
            <div key={String(label)} className="nori-admin-metric">
              <span className="text-[12px] text-white/50">{label}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </div>
        <div className="nori-admin-table-wrap">
          <table className="nori-admin-table min-w-[1280px]">
            <thead>
              <tr>
                <th>服务</th><th>模型</th><th>类型</th><th>调用</th><th>失败</th><th>金额</th><th>平均耗时</th><th>最近使用</th>
              </tr>
            </thead>
            <tbody>
              {usage?.rows.length ? usage.rows.map((row) => (
                <tr key={`${row.provider}-${row.modelKey}-${row.serviceType}-${row.operation}`}>
                  <td className="font-medium">{row.provider}</td>
                  <td className="nori-admin-muted">{row.modelKey || row.serviceType}</td>
                  <td>{usageTypeLabel(row.serviceType)}</td>
                  <td>{row.calls}</td>
                  <td className={row.failed ? 'text-red-300' : 'nori-admin-muted'}>{row.failed}</td>
                  <td><strong>{formatUsageMoney(row.cost)}</strong></td>
                  <td>{row.averageLatencyMs == null ? '—' : `${row.averageLatencyMs}ms`}</td>
                  <td className="nori-admin-muted">{formatDate(row.lastUsedAt)}</td>
                </tr>
              )) : (
                <tr><td colSpan={8} className="nori-admin-empty">暂无已采集的服务用量</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
