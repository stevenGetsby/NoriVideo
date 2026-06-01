'use client'

import { Sparkles } from '@/components/ui/icons'
import type {
  AgentCreativeParameters,
  AgentExecutionMode,
  AgentExecutionPlan,
  SkillId,
} from '@/lib/super-agent/types'
import { fieldStyle, numberValue, SKILL_OPTIONS } from './super-agent-ui'

interface SuperPlanEditorProps {
  plan: AgentExecutionPlan
  onPlanChange: (updater: (current: AgentExecutionPlan) => AgentExecutionPlan) => void
  onConfirm: () => void
  onCancel: () => void
}

export function SuperPlanEditor({ plan, onPlanChange, onConfirm, onCancel }: SuperPlanEditorProps) {
  const updateProjectConfig = <K extends keyof AgentExecutionPlan['projectConfig']>(
    key: K,
    value: AgentExecutionPlan['projectConfig'][K],
  ) => {
    onPlanChange((current) => ({
      ...current,
      projectConfig: { ...current.projectConfig, [key]: value },
    }))
  }

  const updateEpisodeConfig = <K extends keyof AgentExecutionPlan['episodeConfig']>(
    key: K,
    value: AgentExecutionPlan['episodeConfig'][K],
  ) => {
    onPlanChange((current) => ({
      ...current,
      episodeConfig: { ...current.episodeConfig, [key]: value },
    }))
  }

  const updateParameter = <K extends keyof AgentCreativeParameters>(
    key: K,
    value: AgentCreativeParameters[K],
  ) => {
    onPlanChange((current) => ({
      ...current,
      creativeParameters: { ...current.creativeParameters, [key]: value },
    }))
  }

  return (
    <div
      className="mt-6 p-6"
      style={{
        background: 'var(--glass-bg-surface-strong)',
        borderRadius: 'var(--glass-radius-md)',
        border: '2px solid var(--glass-stroke-focus)',
        boxShadow: 'var(--glass-shadow-lg)',
      }}
    >
      <div className="flex items-center gap-3 mb-4">
        <div className="p-2 rounded-lg" style={{ background: 'var(--glass-tone-info-bg)' }}>
          <Sparkles className="w-5 h-5" style={{ color: 'var(--glass-tone-info-fg)' }} />
        </div>
        <h3 className="text-lg font-semibold" style={{ color: 'var(--glass-text-primary)' }}>执行计划</h3>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6">
        <TextInput label="项目名称" value={plan.projectConfig.name} onChange={(value) => updateProjectConfig('name', value)} />
        <TextInput label="剧集名称" value={plan.episodeConfig.name} onChange={(value) => updateEpisodeConfig('name', value)} />
        <SelectField
          label="执行模式"
          value={plan.executionMode}
          options={[
            { value: 'mock', label: 'Mock 跑通流程' },
            { value: 'live', label: '真实 API 执行' },
          ]}
          onChange={(value) => onPlanChange((current) => ({ ...current, executionMode: value as AgentExecutionMode }))}
        />
        <SelectField
          label="视频类型"
          value={plan.selectedSkill}
          options={SKILL_OPTIONS}
          onChange={(value) => onPlanChange((current) => ({
            ...current,
            selectedSkill: value as SkillId,
            skillDescription: SKILL_OPTIONS.find((item) => item.value === value)?.label || current.skillDescription,
          }))}
        />
        <SelectField
          label="视频比例"
          value={plan.projectConfig.videoRatio}
          options={[
            { value: '9:16', label: '9:16' },
            { value: '16:9', label: '16:9' },
            { value: '1:1', label: '1:1' },
          ]}
          onChange={(value) => updateProjectConfig('videoRatio', value as AgentExecutionPlan['projectConfig']['videoRatio'])}
        />
        <TextInput label="视觉风格 Key" value={plan.projectConfig.artStyle} onChange={(value) => updateProjectConfig('artStyle', value)} />
        <TextAreaField className="md:col-span-2" label="故事文本" value={plan.episodeConfig.novelText} rows={4} onChange={(value) => updateEpisodeConfig('novelText', value)} />
        <TextAreaField className="md:col-span-2" label="风格 Prompt" value={plan.projectConfig.artStylePrompt || ''} rows={3} onChange={(value) => updateProjectConfig('artStylePrompt', value)} />
        <NumberInput label="时长（秒）" min={5} max={300} value={plan.creativeParameters.durationSeconds} onChange={(value) => updateParameter('durationSeconds', value)} />
        <SelectField
          label="旁白"
          value={plan.creativeParameters.narration || 'auto'}
          options={[
            { value: 'auto', label: '自动' },
            { value: 'on', label: '开启' },
            { value: 'off', label: '关闭' },
          ]}
          onChange={(value) => updateParameter('narration', value as AgentCreativeParameters['narration'])}
        />
        <NumberInput label="镜头数" min={1} max={12} value={plan.creativeParameters.shotCount} onChange={(value) => updateParameter('shotCount', value)} />
        <NumberInput label="单镜头分镜数" min={1} max={8} value={plan.creativeParameters.panelsPerShot} onChange={(value) => updateParameter('panelsPerShot', value)} />
        <TextInput label="目标受众" value={plan.creativeParameters.targetAudience || ''} onChange={(value) => updateParameter('targetAudience', value)} />
        <TextInput label="语气" value={plan.creativeParameters.tone || ''} onChange={(value) => updateParameter('tone', value)} />
        <TextInput label="卖点" value={plan.creativeParameters.sellingPoints || ''} onChange={(value) => updateParameter('sellingPoints', value)} />
        <TextInput label="行动号召" value={plan.creativeParameters.callToAction || ''} onChange={(value) => updateParameter('callToAction', value)} />
        <TextAreaField className="md:col-span-2" label="Mock Prompt" value={plan.creativeParameters.mockPrompt || ''} rows={3} onChange={(value) => updateParameter('mockPrompt', value)} />
      </div>

      <div className="mb-6">
        <h4 className="text-sm font-medium mb-3" style={{ color: 'var(--glass-text-secondary)' }}>执行阶段</h4>
        <div className="space-y-2">
          {plan.stages.map((stage) => (
            <div key={stage.stageId} className="flex items-start gap-3 p-3" style={{ background: 'var(--glass-bg-muted)', borderRadius: 'var(--glass-radius-sm)' }}>
              <div className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold" style={{ background: 'var(--glass-tone-info-bg)', color: 'var(--glass-tone-info-fg)' }}>
                {stage.stageNumber}
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium" style={{ color: 'var(--glass-text-primary)' }}>{stage.title}</p>
                <p className="text-xs mt-1" style={{ color: 'var(--glass-text-tertiary)' }}>{stage.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex gap-3">
        <button onClick={onConfirm} className="flex-1 py-3 rounded-lg font-medium transition-all duration-200" style={{ background: 'linear-gradient(135deg, var(--glass-accent-from), var(--glass-accent-to))', color: 'var(--glass-text-on-accent)', boxShadow: 'var(--glass-shadow-md)' }}>
          开始执行
        </button>
        <button onClick={onCancel} className="flex-1 py-3 rounded-lg font-medium transition-all duration-200" style={{ background: 'var(--glass-bg-muted)', color: 'var(--glass-text-secondary)' }}>
          取消
        </button>
      </div>
    </div>
  )
}

function TextInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="text-sm" style={{ color: 'var(--glass-text-secondary)' }}>
      <span className="mb-1 block">{label}</span>
      <input value={value} onChange={(event) => onChange(event.target.value)} className="w-full rounded-md px-3 py-2" style={fieldStyle} />
    </label>
  )
}

function NumberInput({ label, min, max, value, onChange }: { label: string; min: number; max: number; value?: number; onChange: (value: number) => void }) {
  return (
    <label className="text-sm" style={{ color: 'var(--glass-text-secondary)' }}>
      <span className="mb-1 block">{label}</span>
      <input type="number" min={min} max={max} value={numberValue(value)} onChange={(event) => onChange(Number(event.target.value))} className="w-full rounded-md px-3 py-2" style={fieldStyle} />
    </label>
  )
}

function SelectField({ label, value, options, onChange }: { label: string; value: string; options: Array<{ value: string; label: string }>; onChange: (value: string) => void }) {
  return (
    <label className="text-sm" style={{ color: 'var(--glass-text-secondary)' }}>
      <span className="mb-1 block">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} className="w-full rounded-md px-3 py-2" style={fieldStyle}>
        {options.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
      </select>
    </label>
  )
}

function TextAreaField({ label, value, rows, className, onChange }: { label: string; value: string; rows: number; className?: string; onChange: (value: string) => void }) {
  return (
    <label className={`text-sm ${className || ''}`} style={{ color: 'var(--glass-text-secondary)' }}>
      <span className="mb-1 block">{label}</span>
      <textarea value={value} onChange={(event) => onChange(event.target.value)} rows={rows} className="w-full resize-y rounded-md px-3 py-2" style={fieldStyle} />
    </label>
  )
}
