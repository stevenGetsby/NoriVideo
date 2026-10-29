'use client'

import { memo, useEffect, useState } from 'react'
import { useUpdateNodeInternals, type NodeProps } from '@xyflow/react'
import { Plus, X } from '@/components/ui/icons'
import { readChoiceData, readConditionData } from '@/lib/interactive/compile'
import { STORY_ELSE_HANDLE, type StoryChoiceOption, type StoryConditionBranch } from '@/lib/interactive/types'
import { StoryConditionsEditor, StoryEffectsEditor } from './StoryFields'
import { StoryHandle, StoryNodeShell, useStoryNodeEditing } from './StoryNodeShell'

const MAX_ROWS = 6
const TIMEOUT_OPTIONS = [0, 5, 10, 15, 30, 60]
const titleOf = (data: NodeProps['data']) => (typeof data?.title === 'string' ? data.title : '')
const newId = (prefix: string) => `${prefix}_${crypto.randomUUID().slice(0, 8)}`
const ORDINAL = ['一', '二', '三', '四', '五', '六']

function useHandleSync(id: string, handleKey: string) {
  const updateNodeInternals = useUpdateNodeInternals()
  useEffect(() => { updateNodeInternals(id) }, [handleKey, id, updateNodeInternals])
}

export const StoryChoiceNode = memo(function StoryChoiceNode({ id, data, selected }: NodeProps) {
  const { readOnly, variables, manageVariables, patch } = useStoryNodeEditing(id)
  const choice = readChoiceData(data)
  const [openEffects, setOpenEffects] = useState<string | null>(null)
  useHandleSync(id, choice.options.map((option) => option.id).join('|'))

  const setOptions = (options: StoryChoiceOption[], label: string, extra: Record<string, unknown> = {}) => patch({ options, ...extra }, label)
  const updateOption = (optionId: string, next: Partial<StoryChoiceOption>, label?: string) => {
    const options = choice.options.map((option) => (option.id === optionId ? { ...option, ...next } : option))
    if (label) setOptions(options, label)
    else patch({ options })
  }

  return (
    <StoryNodeShell id={id} type="story_choice" selected={selected} title={titleOf(data)}>
      <input
        className="nodrag nori-story-input"
        value={choice.prompt}
        placeholder="向玩家提问（可选）"
        readOnly={readOnly}
        onChange={(event) => patch({ prompt: event.target.value })}
      />
      <ol className="nori-story-options">
        {choice.options.map((option, index) => (
          <li key={option.id} className="nori-story-option">
            <div className="nori-story-row">
              <span className="nori-story-row-index">{index + 1}</span>
              <input
                className="nodrag nori-story-input"
                value={option.label}
                placeholder={`选项${ORDINAL[index] ?? index + 1}`}
                readOnly={readOnly}
                onChange={(event) => updateOption(option.id, { label: event.target.value })}
              />
              <button type="button" className={`nori-story-chip nodrag${option.effects.length ? ' is-active' : ''}`} onClick={() => setOpenEffects((current) => (current === option.id ? null : option.id))}>
                效果{option.effects.length ? ` ${option.effects.length}` : ''}
              </button>
              {readOnly || choice.options.length <= 1 ? null : (
                <button type="button" className="nori-story-icon-button nodrag" aria-label="删除选项" onClick={() => setOptions(
                  choice.options.filter((item) => item.id !== option.id),
                  '删除选项',
                  choice.defaultOptionId === option.id ? { defaultOptionId: null } : {},
                )}><X /></button>
              )}
              <StoryHandle id={option.id} side="out" />
            </div>
            {openEffects === option.id ? (
              <StoryEffectsEditor effects={option.effects} variables={variables} disabled={readOnly} onManageVariables={manageVariables}
                onChange={(effects) => updateOption(option.id, { effects }, '编辑选项效果')} />
            ) : null}
          </li>
        ))}
      </ol>
      {readOnly || choice.options.length >= MAX_ROWS ? null : (
        <button type="button" className="nori-story-add-rule nodrag" onClick={() => setOptions(
          [...choice.options, { id: newId('opt'), label: `选项${ORDINAL[choice.options.length] ?? choice.options.length + 1}`, effects: [] }],
          '添加选项',
        )}><Plus />选项</button>
      )}
      <div className="nori-story-footer">
        <label>
          <span>限时</span>
          <select className="nodrag" value={choice.timeoutSec ?? 0} disabled={readOnly}
            onChange={(event) => patch({ timeoutSec: Number(event.target.value) || null }, '设置选择限时')}>
            {(choice.timeoutSec && !TIMEOUT_OPTIONS.includes(choice.timeoutSec) ? [...TIMEOUT_OPTIONS, choice.timeoutSec].sort((a, b) => a - b) : TIMEOUT_OPTIONS).map((sec) => <option key={sec} value={sec}>{sec ? `${sec} 秒` : '不限时'}</option>)}
          </select>
        </label>
        {choice.timeoutSec ? (
          <label>
            <span>超时选</span>
            <select className="nodrag" value={choice.defaultOptionId ?? ''} disabled={readOnly}
              onChange={(event) => patch({ defaultOptionId: event.target.value || null }, '设置默认选项')}>
              <option value="">第一个选项</option>
              {choice.options.map((option, index) => <option key={option.id} value={option.id}>{option.label || `选项${index + 1}`}</option>)}
            </select>
          </label>
        ) : null}
      </div>
    </StoryNodeShell>
  )
})

export const StoryConditionNode = memo(function StoryConditionNode({ id, data, selected }: NodeProps) {
  const { readOnly, variables, manageVariables, patch } = useStoryNodeEditing(id)
  const { branches } = readConditionData(data)
  useHandleSync(id, branches.map((branch) => branch.id).join('|'))

  const updateBranch = (branchId: string, next: Partial<StoryConditionBranch>, label?: string) => patch(
    { branches: branches.map((branch) => (branch.id === branchId ? { ...branch, ...next } : branch)) },
    label,
  )

  return (
    <StoryNodeShell id={id} type="story_condition" selected={selected} title={titleOf(data)}>
      <p className="nori-story-note">按顺序检查，走第一个满足的分支</p>
      <ol className="nori-story-options">
        {branches.map((branch, index) => (
          <li key={branch.id} className="nori-story-option is-branch">
            <div className="nori-story-row">
              <span className="nori-story-row-index">{index + 1}</span>
              <input
                className="nodrag nori-story-input"
                value={branch.label}
                placeholder={`分支${ORDINAL[index] ?? index + 1}`}
                readOnly={readOnly}
                onChange={(event) => updateBranch(branch.id, { label: event.target.value })}
              />
              <button type="button" className="nori-story-chip nodrag" disabled={readOnly} title="切换匹配方式"
                onClick={() => updateBranch(branch.id, { match: branch.match === 'all' ? 'any' : 'all' }, '切换匹配方式')}>
                {branch.match === 'all' ? '全部满足' : '任一满足'}
              </button>
              {readOnly ? null : (
                <button type="button" className="nori-story-icon-button nodrag" aria-label="删除分支"
                  onClick={() => patch({ branches: branches.filter((item) => item.id !== branch.id) }, '删除分支')}><X /></button>
              )}
              <StoryHandle id={branch.id} side="out" />
            </div>
            <StoryConditionsEditor conditions={branch.conditions} variables={variables} disabled={readOnly} onManageVariables={manageVariables}
              onChange={(conditions) => updateBranch(branch.id, { conditions }, '编辑分支条件')} />
          </li>
        ))}
      </ol>
      {readOnly || branches.length >= MAX_ROWS ? null : (
        <button type="button" className="nori-story-add-rule nodrag" onClick={() => patch(
          { branches: [...branches, { id: newId('br'), label: `分支${ORDINAL[branches.length] ?? branches.length + 1}`, match: 'all', conditions: [] }] },
          '添加分支',
        )}><Plus />分支</button>
      )}
      <div className="nori-story-row is-else">
        <span className="nori-story-row-index">否</span>
        <span className="nori-story-else-label">否则</span>
        <StoryHandle id={STORY_ELSE_HANDLE} side="out" />
      </div>
    </StoryNodeShell>
  )
})
