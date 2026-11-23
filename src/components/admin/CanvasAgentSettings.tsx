'use client'

import { CANVAS_AGENT_SELECTION_KEY, type CanvasAgentModelCatalogEntry } from '@/lib/canvas-agent/model-catalog'
import type { ServiceConfig } from './platform-admin-services'

const unavailable: Record<NonNullable<CanvasAgentModelCatalogEntry['unavailableReason']>, string> = {
  MODEL_UNAVAILABLE: '缺少 API Key',
  MODEL_PROTOCOL_UNSUPPORTED: '协议不支持',
  MODEL_PRICING_MISSING: '缺少输入或输出 Token 计价',
  TOOL_STREAMING_UNVERIFIED: '未通过工具流合同测试',
}

export function CanvasAgentSettings({ config, markConfig }: {
  config: ServiceConfig
  markConfig: (updater: (current: ServiceConfig) => ServiceConfig) => void
}) {
  const candidates = config.canvasAgentModelCatalog?.models ?? []
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
  return <section className="nori-admin-purpose" aria-labelledby="canvas-agent-models-title">
    <div className="nori-admin-purpose-head"><div><h3 id="canvas-agent-models-title">喵导模型</h3><p>仅用于画布对话与工具调用，不影响其他文本功能。</p></div></div>
    <div className="nori-admin-purpose-list">
      <label className="nori-admin-purpose-row">
        <span>喵导默认模型</span>
        <select className="fos-input nori-admin-input-dense" value={defaultKey} onChange={(event) => {
          const value = event.target.value
          markConfig((current) => ({ ...current, modelRouting: { ...current.modelRouting, [CANVAS_AGENT_SELECTION_KEY]: value } }))
        }}>
          <option value="">{enabled.length ? '请选择一个已开放模型' : '已停用'}</option>
          {enabled.map((item) => <option key={item.modelKey} value={item.modelKey}>{item.displayName}</option>)}
        </select>
      </label>
      {candidates.map((item) => <label key={item.modelKey} className="nori-admin-purpose-row">
        <span><strong>{item.displayName}</strong><small>{item.protocol} · {item.unavailableReason ? unavailable[item.unavailableReason] : '已配置计价'}</small></span>
        <input type="checkbox" aria-label={`开放 ${item.displayName}`} checked={config.agentModels?.[item.modelKey]?.canvasAgent === true}
          disabled={Boolean(item.unavailableReason) && config.agentModels?.[item.modelKey]?.canvasAgent !== true}
          onChange={(event) => toggle(item.modelKey, event.target.checked)} />
      </label>)}
      {(['kimi', 'openai'] as const).filter((provider) => !candidates.some((candidate) => candidate.providerId === provider))
        .map((provider) => <p className="nori-admin-subtle" key={provider}>{provider === 'kimi' ? 'Kimi' : 'OpenAI'}：待完成模型登记</p>)}
      <details><summary>高级设置</summary><p>保留 24 条上下文 · 每轮最多 8 次请求 / 24 次工具 · 输出上限 4096 tokens · 自动回退关闭</p></details>
    </div>
  </section>
}
