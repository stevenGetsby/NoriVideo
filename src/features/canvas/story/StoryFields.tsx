'use client'

import { useState } from 'react'
import { Plus, X } from '@/components/ui/icons'
import { STORY_COMPARE_OPS, type StoryCompareOp, type StoryCondition, type StoryEffect, type StoryValue, type StoryVariable } from '@/lib/interactive/types'

const OP_LABEL: Record<StoryCompareOp, string> = { '==': '等于', '!=': '不等于', '>': '大于', '>=': '至少', '<': '小于', '<=': '至多' }

function ValueInput({ variable, value, disabled, onChange }: { variable?: StoryVariable; value: StoryValue; disabled: boolean; onChange: (value: StoryValue) => void }) {
  if (variable?.type === 'boolean') {
    return (
      <select className="nodrag" value={value === true ? 'true' : 'false'} disabled={disabled} onChange={(event) => onChange(event.target.value === 'true')}>
        <option value="true">是</option>
        <option value="false">否</option>
      </select>
    )
  }
  return (
    <input
      className="nodrag is-number"
      type="number"
      value={typeof value === 'number' ? value : 0}
      disabled={disabled}
      onChange={(event) => onChange(Number.isFinite(event.target.valueAsNumber) ? event.target.valueAsNumber : 0)}
    />
  )
}

function VariableSelect({ variables, value, disabled, onChange }: { variables: StoryVariable[]; value: string; disabled: boolean; onChange: (variable: StoryVariable) => void }) {
  const known = variables.some((variable) => variable.id === value)
  return (
    <select className={`nodrag${known ? '' : ' is-invalid'}`} value={value} disabled={disabled} onChange={(event) => {
      const next = variables.find((variable) => variable.id === event.target.value)
      if (next) onChange(next)
    }}>
      {known ? null : <option value={value}>变量已删除</option>}
      {variables.map((variable) => <option key={variable.id} value={variable.id}>{variable.name}</option>)}
    </select>
  )
}

function NoVariables({ onManage }: { onManage?: () => void }) {
  return <button type="button" className="nori-story-hint-button nodrag" onClick={onManage} disabled={!onManage}>先添加全局变量</button>
}

export function StoryEffectsEditor({ effects, variables, disabled, onChange, onManageVariables }: {
  effects: StoryEffect[]
  variables: StoryVariable[]
  disabled: boolean
  onChange: (effects: StoryEffect[]) => void
  onManageVariables?: () => void
}) {
  const byId = new Map(variables.map((variable) => [variable.id, variable]))
  const update = (index: number, patch: Partial<StoryEffect>) => onChange(effects.map((effect, i) => (i === index ? { ...effect, ...patch } : effect)))
  return (
    <div className="nori-story-rules">
      {effects.map((effect, index) => {
        const variable = byId.get(effect.variableId)
        return (
          <div className="nori-story-rule" key={index}>
            <VariableSelect variables={variables} value={effect.variableId} disabled={disabled} onChange={(next) => update(index, {
              variableId: next.id, op: next.type === 'boolean' ? 'set' : effect.op, value: next.type === 'boolean' ? true : 1,
            })} />
            <select className="nodrag" value={effect.op} disabled={disabled || variable?.type === 'boolean'} onChange={(event) => update(index, { op: event.target.value === 'add' ? 'add' : 'set' })}>
              <option value="set">设为</option>
              <option value="add">增加</option>
            </select>
            <ValueInput variable={variable} value={effect.value} disabled={disabled} onChange={(value) => update(index, { value })} />
            {disabled ? null : <button type="button" className="nori-story-icon-button nodrag" aria-label="删除效果" onClick={() => onChange(effects.filter((_, i) => i !== index))}><X /></button>}
          </div>
        )
      })}
      {disabled ? null : variables.length === 0 ? <NoVariables onManage={onManageVariables} /> : (
        <button type="button" className="nori-story-add-rule nodrag" onClick={() => {
          const first = variables[0]
          onChange([...effects, { variableId: first.id, op: first.type === 'boolean' ? 'set' : 'add', value: first.type === 'boolean' ? true : 1 }])
        }}><Plus />变量效果</button>
      )}
    </div>
  )
}

export function StoryConditionsEditor({ conditions, variables, disabled, onChange, onManageVariables }: {
  conditions: StoryCondition[]
  variables: StoryVariable[]
  disabled: boolean
  onChange: (conditions: StoryCondition[]) => void
  onManageVariables?: () => void
}) {
  const byId = new Map(variables.map((variable) => [variable.id, variable]))
  const update = (index: number, patch: Partial<StoryCondition>) => onChange(conditions.map((condition, i) => (i === index ? { ...condition, ...patch } : condition)))
  return (
    <div className="nori-story-rules">
      {conditions.map((condition, index) => {
        const variable = byId.get(condition.variableId)
        const ops = variable?.type === 'boolean' ? (['==', '!='] as const) : STORY_COMPARE_OPS
        return (
          <div className="nori-story-rule" key={index}>
            <VariableSelect variables={variables} value={condition.variableId} disabled={disabled} onChange={(next) => update(index, {
              variableId: next.id, op: next.type === 'boolean' ? '==' : condition.op, value: next.type === 'boolean' ? true : 1,
            })} />
            <select className="nodrag" value={condition.op} disabled={disabled} onChange={(event) => update(index, { op: event.target.value as StoryCompareOp })}>
              {ops.map((op) => <option key={op} value={op}>{OP_LABEL[op]}</option>)}
            </select>
            <ValueInput variable={variable} value={condition.value} disabled={disabled} onChange={(value) => update(index, { value })} />
            {disabled ? null : <button type="button" className="nori-story-icon-button nodrag" aria-label="删除条件" onClick={() => onChange(conditions.filter((_, i) => i !== index))}><X /></button>}
          </div>
        )
      })}
      {disabled ? null : variables.length === 0 ? <NoVariables onManage={onManageVariables} /> : (
        <button type="button" className="nori-story-add-rule nodrag" onClick={() => {
          const first = variables[0]
          onChange([...conditions, { variableId: first.id, op: first.type === 'boolean' ? '==' : '>=', value: first.type === 'boolean' ? true : 1 }])
        }}><Plus />条件</button>
      )}
    </div>
  )
}

const SUMMARY_PILLS = 3

function describeEffect(effect: StoryEffect, variable: StoryVariable | undefined) {
  if (!variable) return { text: '变量已删除', invalid: true }
  if (variable.type === 'boolean') return { text: `${variable.name} = ${effect.value === true ? '是' : '否'}`, invalid: false }
  const value = typeof effect.value === 'number' ? effect.value : 0
  if (effect.op === 'add') return { text: `${variable.name} ${value < 0 ? '−' : '+'}${Math.abs(value)}`, invalid: false }
  return { text: `${variable.name} = ${value}`, invalid: false }
}

/** Scene effects read as a one-line summary; the editor opens in place only while it is being changed. */
export function StoryEffectsSection({ effects, variables, disabled, onChange, onManageVariables }: {
  effects: StoryEffect[]
  variables: StoryVariable[]
  disabled: boolean
  onChange: (effects: StoryEffect[]) => void
  onManageVariables?: () => void
}) {
  const [open, setOpen] = useState(false)
  if (disabled && !effects.length) return null
  const byId = new Map(variables.map((variable) => [variable.id, variable]))
  const pills = effects.map((effect) => describeEffect(effect, byId.get(effect.variableId)))
  const editing = open && !disabled
  return (
    <div className={`nori-story-effects${editing ? ' is-open' : ''}`}>
      <div className="nori-story-effects-head">
        <span className="nori-story-section-label">进入时</span>
        {editing ? <span className="nori-story-effects-hint">播放到这里时改变变量</span> : (
          <span className="nori-story-effect-pills">
            {pills.length ? pills.slice(0, SUMMARY_PILLS).map((pill, index) => (
              <span key={index} className={`nori-story-effect-pill${pill.invalid ? ' is-invalid' : ''}`}>{pill.text}</span>
            )) : <span className="nori-story-effect-none">不改变变量</span>}
            {pills.length > SUMMARY_PILLS ? <span className="nori-story-effect-pill is-more">+{pills.length - SUMMARY_PILLS}</span> : null}
          </span>
        )}
        {disabled ? null : (
          <button type="button" className="nori-story-effects-toggle nodrag" aria-expanded={editing} onClick={() => setOpen((value) => !value)}>
            {editing ? '完成' : effects.length ? '编辑' : '设置'}
          </button>
        )}
      </div>
      {editing ? <StoryEffectsEditor effects={effects} variables={variables} disabled={disabled} onChange={onChange} onManageVariables={onManageVariables} /> : null}
    </div>
  )
}
