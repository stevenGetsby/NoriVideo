'use client'

import type { AgentCreativeParameters, AgentExecutionMode } from '@/lib/super-agent/types'
import { fieldStyle, numberValue } from './super-agent-ui'

interface SuperQuickParametersProps {
  executionMode: AgentExecutionMode
  parameters: AgentCreativeParameters
  disabled: boolean
  onExecutionModeChange: (mode: AgentExecutionMode) => void
  onParameterChange: <K extends keyof AgentCreativeParameters>(
    key: K,
    value: AgentCreativeParameters[K],
  ) => void
}

export function SuperQuickParameters({
  executionMode,
  parameters,
  disabled,
  onExecutionModeChange,
  onParameterChange,
}: SuperQuickParametersProps) {
  return (
    <div
      className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3"
      style={{ color: 'var(--glass-text-secondary)' }}
    >
      <label className="text-sm">
        <span className="mb-1 block">执行模式</span>
        <select
          value={executionMode}
          onChange={(event) => onExecutionModeChange(event.target.value as AgentExecutionMode)}
          disabled={disabled}
          className="w-full rounded-md px-3 py-2"
          style={fieldStyle}
        >
          <option value="mock">Mock 跑通流程</option>
          <option value="live">真实 API 执行</option>
        </select>
      </label>

      <label className="text-sm">
        <span className="mb-1 block">时长（秒）</span>
        <input
          type="number"
          min={5}
          max={300}
          value={numberValue(parameters.durationSeconds)}
          onChange={(event) => onParameterChange('durationSeconds', Number(event.target.value))}
          disabled={disabled}
          className="w-full rounded-md px-3 py-2"
          style={fieldStyle}
        />
      </label>

      <label className="text-sm">
        <span className="mb-1 block">旁白</span>
        <select
          value={parameters.narration || 'auto'}
          onChange={(event) => onParameterChange('narration', event.target.value as AgentCreativeParameters['narration'])}
          disabled={disabled}
          className="w-full rounded-md px-3 py-2"
          style={fieldStyle}
        >
          <option value="auto">自动</option>
          <option value="on">开启</option>
          <option value="off">关闭</option>
        </select>
      </label>

      <label className="text-sm">
        <span className="mb-1 block">镜头数</span>
        <input
          type="number"
          min={1}
          max={12}
          value={numberValue(parameters.shotCount)}
          onChange={(event) => onParameterChange('shotCount', Number(event.target.value))}
          disabled={disabled}
          className="w-full rounded-md px-3 py-2"
          style={fieldStyle}
        />
      </label>

      <label className="text-sm">
        <span className="mb-1 block">单镜头分镜数</span>
        <input
          type="number"
          min={1}
          max={8}
          value={numberValue(parameters.panelsPerShot)}
          onChange={(event) => onParameterChange('panelsPerShot', Number(event.target.value))}
          disabled={disabled}
          className="w-full rounded-md px-3 py-2"
          style={fieldStyle}
        />
      </label>

      <label className="text-sm">
        <span className="mb-1 block">目标受众</span>
        <input
          value={parameters.targetAudience || ''}
          onChange={(event) => onParameterChange('targetAudience', event.target.value)}
          disabled={disabled}
          className="w-full rounded-md px-3 py-2"
          style={fieldStyle}
        />
      </label>

      <label className="text-sm">
        <span className="mb-1 block">语气</span>
        <input
          value={parameters.tone || ''}
          onChange={(event) => onParameterChange('tone', event.target.value)}
          disabled={disabled}
          className="w-full rounded-md px-3 py-2"
          style={fieldStyle}
        />
      </label>

      <label className="text-sm">
        <span className="mb-1 block">卖点</span>
        <input
          value={parameters.sellingPoints || ''}
          onChange={(event) => onParameterChange('sellingPoints', event.target.value)}
          disabled={disabled}
          className="w-full rounded-md px-3 py-2"
          style={fieldStyle}
        />
      </label>

      <label className="text-sm md:col-span-2 lg:col-span-1">
        <span className="mb-1 block">行动号召</span>
        <input
          value={parameters.callToAction || ''}
          onChange={(event) => onParameterChange('callToAction', event.target.value)}
          disabled={disabled}
          className="w-full rounded-md px-3 py-2"
          style={fieldStyle}
        />
      </label>

      <label className="text-sm md:col-span-2 lg:col-span-3">
        <span className="mb-1 block">Mock Prompt</span>
        <textarea
          value={parameters.mockPrompt || ''}
          onChange={(event) => onParameterChange('mockPrompt', event.target.value)}
          disabled={disabled}
          rows={2}
          className="w-full resize-y rounded-md px-3 py-2"
          style={fieldStyle}
        />
      </label>
    </div>
  )
}
