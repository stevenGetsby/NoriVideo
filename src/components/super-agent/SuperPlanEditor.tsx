'use client'

import { useEffect, useMemo, useState } from 'react'
import { Sparkles } from '@/components/ui/icons'
import type {
  AgentExecutionPlan,
  SkillId,
} from '@/lib/super-agent/types'
import { fieldStyle, SKILL_OPTIONS } from './super-agent-ui'

interface SuperPlanEditorProps {
  plan: AgentExecutionPlan
  onPlanChange: (updater: (current: AgentExecutionPlan) => AgentExecutionPlan) => void
  onConfirm: () => void
  onCancel: () => void
}

export function SuperPlanEditor({ plan, onPlanChange, onConfirm, onCancel }: SuperPlanEditorProps) {
  const [skillOptions, setSkillOptions] = useState<Array<{ value: string; label: string }>>(SKILL_OPTIONS)

  useEffect(() => {
    let cancelled = false
    async function loadSkills() {
      try {
        const response = await fetch('/api/super-agent/skills')
        if (!response.ok) return
        const data = await response.json() as { skills?: Array<{ id?: string; name?: string }> }
        const next = (data.skills || [])
          .map((skill) => {
            if (!skill.id || !skill.name) return null
            return { value: skill.id, label: skill.name }
          })
          .filter((item): item is { value: string; label: string } => Boolean(item))
        if (!cancelled && next.length > 0) {
          setSkillOptions(next)
        }
      } catch {
        // Keep built-in options when the skills endpoint is unavailable.
      }
    }
    void loadSkills()
    return () => {
      cancelled = true
    }
  }, [])

  const planSkillOptions = useMemo(() => {
    if (skillOptions.some((item) => item.value === plan.selectedSkill)) return skillOptions
    return [
      ...skillOptions,
      { value: plan.selectedSkill, label: plan.skillDescription || plan.selectedSkill },
    ]
  }, [plan.selectedSkill, plan.skillDescription, skillOptions])

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

  return (
    <div
      className="mt-6 p-6"
      style={{
        background: '#fafcfe',
        borderRadius: '24px',
        border: '1px solid rgba(14,14,44,.08)',
        boxShadow: '0 22px 54px rgba(14,14,44,.095), 0 4px 12px rgba(14,14,44,.055)',
      }}
    >
      <div className="flex items-center gap-3 mb-4">
        <div className="p-2 rounded-xl" style={{ background: '#EFEFFD' }}>
          <Sparkles className="w-5 h-5" style={{ color: '#4B4DED' }} />
        </div>
        <h3 className="text-lg font-semibold" style={{ color: '#0e0e2c' }}>执行计划</h3>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6">
        <TextInput label="项目名称" value={plan.projectConfig.name} onChange={(value) => updateProjectConfig('name', value)} />
        <TextInput label="剧集名称" value={plan.episodeConfig.name} onChange={(value) => updateEpisodeConfig('name', value)} />
        <SelectField
          label="视频类型"
          value={plan.selectedSkill}
          options={planSkillOptions}
          onChange={(value) => onPlanChange((current) => ({
            ...current,
            selectedSkill: value as SkillId,
            skillDescription: planSkillOptions.find((item) => item.value === value)?.label || current.skillDescription,
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
      </div>

      <div className="mb-6">
        <h4 className="text-sm font-medium mb-3" style={{ color: '#4a4a68' }}>执行阶段</h4>
        <div className="space-y-2">
          {plan.stages.map((stage) => (
            <div key={stage.stageId} className="flex items-start gap-3 p-3" style={{ background: '#ffffff', border: '1px solid rgba(14,14,44,.06)', borderRadius: '16px' }}>
              <div className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold" style={{ background: stage.stageNumber === 3 ? '#f5ffe0' : '#EFEFFD', color: stage.stageNumber === 3 ? '#0e0e2c' : '#4B4DED' }}>
                {stage.stageNumber}
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium" style={{ color: '#0e0e2c' }}>{stage.title}</p>
                <p className="text-xs mt-1" style={{ color: '#8c8ca1' }}>{stage.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex gap-3">
        <button onClick={onConfirm} className="flex-1 py-3 rounded-[16px] font-medium transition-all duration-200" style={{ background: '#D6FF00', color: '#0e0e2c', border: '1px solid rgba(14,14,44,.10)', boxShadow: '0 7px 18px rgba(14,14,44,.08), inset 0 -1px 0 rgba(14,14,44,.10)' }}>
          开始执行
        </button>
        <button onClick={onCancel} className="flex-1 py-3 rounded-[16px] font-medium transition-all duration-200" style={{ background: '#ECF1F4', color: '#4a4a68', border: '1px solid rgba(14,14,44,.08)' }}>
          取消
        </button>
      </div>
    </div>
  )
}

function TextInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="text-sm" style={{ color: '#4a4a68' }}>
      <span className="mb-1 block">{label}</span>
      <input value={value} onChange={(event) => onChange(event.target.value)} className="w-full rounded-md px-3 py-2" style={fieldStyle} />
    </label>
  )
}

function SelectField({ label, value, options, onChange }: { label: string; value: string; options: Array<{ value: string; label: string }>; onChange: (value: string) => void }) {
  return (
    <label className="text-sm" style={{ color: '#4a4a68' }}>
      <span className="mb-1 block">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} className="w-full rounded-md px-3 py-2" style={fieldStyle}>
        {options.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
      </select>
    </label>
  )
}

function TextAreaField({ label, value, rows, className, onChange }: { label: string; value: string; rows: number; className?: string; onChange: (value: string) => void }) {
  return (
    <label className={`text-sm ${className || ''}`} style={{ color: '#4a4a68' }}>
      <span className="mb-1 block">{label}</span>
      <textarea value={value} onChange={(event) => onChange(event.target.value)} rows={rows} className="w-full resize-y rounded-md px-3 py-2" style={fieldStyle} />
    </label>
  )
}
