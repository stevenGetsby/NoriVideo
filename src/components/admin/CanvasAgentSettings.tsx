'use client'

import { AppIcon } from '@/components/ui/icons'
import { CANVAS_AGENT_SELECTION_KEY, type CanvasAgentModelCatalogEntry } from '@/lib/canvas-agent/model-catalog'
import type { ServiceConfig } from './platform-admin-services'

const unavailable: Record<NonNullable<CanvasAgentModelCatalogEntry['unavailableReason']>, string> = {
  MODEL_UNAVAILABLE: '缺少 API Key',
  MODEL_PROTOCOL_UNSUPPORTED: '协议不支持',
  MODEL_PRICING_MISSING: '缺少输入或输出 Token 计价',
  TOOL_STREAMING_UNVERIFIED: '未通过工具流合同测试',
}

export function CanvasAgentSettings({ config, markConfig, query = '' }: {
  config: ServiceConfig
  markConfig: (updater: (current: ServiceConfig) => ServiceConfig) => void
  query?: string
}) {
  const candidates = config.canvasAgentModelCatalog?.models ?? []
  const normalizedQuery = query.trim().toLowerCase()
  const visibleCandidates = normalizedQuery
    ? candidates.filter((item) =>
        item.displayName.toLowerCase().includes(normalizedQuery)
        || item.modelKey.toLowerCase().includes(normalizedQuery)
        || item.providerId.toLowerCase().includes(normalizedQuery))
    : candidates
  const enabled = candidates.filter((item) => config.agentModels?.[item.modelKey]?.canvasAgent === true)
  const defaultKey = config.modelRouting[CANVAS_AGENT_SELECTION_KEY] || ''

  const toggle = (key: string, on: boolean) => {
    if (!on && enabled.length === 1 && !window.confirm('停用后，所有用户都无法发起喵导对话，已有对话仍可查看。')) return
    markConfig((current) => {
      const agentModels = { ...current.agentModels, [key]: { ...current.agentModels?.[key], canvasAgent: on } }
      const currentDefault = current.modelRouting[CANVAS_AGENT_SELECTION_KEY]
      const nextDefault = currentDefault === key && !on ? '' : currentDefault || (on && !enabled.length ? key : '')
      return { ...current, agentModels, modelRouting: { ...current.modelRouting, [CANVAS_AGENT_SELECTION_KEY]: nextDefault } }
    })
  }

  return (
    <section className="nori-admin-purpose is-agent" aria-labelledby="canvas-agent-models-title">
      <div className="nori-admin-purpose-head">
        <div className="nori-admin-purpose-head-main">
          <span className="nori-admin-purpose-icon"><AppIcon name="sparklesAlt" className="h-4 w-4" /></span>
          <div>
            <h3 id="canvas-agent-models-title">喵导模型</h3>
            <p>仅用于画布对话与工具调用，不影响其他文本功能。</p>
          </div>
        </div>
        <span className="nori-admin-purpose-count">已开放 {enabled.length}/{candidates.length}</span>
      </div>
      <div className="nori-admin-purpose-list">
        <label className="nori-admin-purpose-row">
          <span>
            <strong>喵导默认模型</strong>
            <small>新对话默认使用的 Agent 推理模型</small>
          </span>
          <select
            className="fos-input nori-admin-input-dense"
            aria-label="喵导默认模型"
            value={defaultKey}
            onChange={(event) => {
              const value = event.target.value
              markConfig((current) => ({ ...current, modelRouting: { ...current.modelRouting, [CANVAS_AGENT_SELECTION_KEY]: value } }))
            }}
          >
            <option value="">{enabled.length ? '请选择一个已开放模型' : '已停用'}</option>
            {enabled.map((item) => <option key={item.modelKey} value={item.modelKey}>{item.displayName}</option>)}
          </select>
        </label>
        {visibleCandidates.map((item) => (
          <label key={item.modelKey} className="nori-admin-purpose-row">
            <span>
              <strong>{item.displayName}</strong>
              <small>
                {item.protocol}
                {item.unavailableReason
                  ? <span className="nori-admin-inline-warn">{unavailable[item.unavailableReason]}</span>
                  : ' · 已配置计价'}
              </small>
            </span>
            <input
              type="checkbox"
              className="nori-admin-toggle-check"
              aria-label={`开放 ${item.displayName}`}
              checked={config.agentModels?.[item.modelKey]?.canvasAgent === true}
              disabled={Boolean(item.unavailableReason) && config.agentModels?.[item.modelKey]?.canvasAgent !== true}
              onChange={(event) => toggle(item.modelKey, event.target.checked)}
            />
          </label>
        ))}
        {(['openai'] as const)
          .filter((provider) => !candidates.some((candidate) => candidate.providerId === provider))
          .map((provider) => (
            <div key={provider} className="nori-admin-purpose-row">
              <span className="nori-admin-subtle">OpenAI：待完成模型登记</span>
              <span className="nori-admin-purpose-count justify-self-end">待登记</span>
            </div>
          ))}
        <details className="nori-admin-advanced">
          <summary>高级设置<AppIcon name="chevronDown" /></summary>
          <div className="nori-admin-panel-body">
            <p className="m-0 text-[12px] nori-admin-muted">
              保留 24 条上下文 · 每轮最多 8 次请求 / 24 次工具 · 输出上限 4096 tokens · 自动回退关闭
            </p>
          </div>
        </details>
      </div>
    </section>
  )
}
